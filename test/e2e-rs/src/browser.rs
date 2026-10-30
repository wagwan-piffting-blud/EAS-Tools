use std::path::PathBuf;
use std::sync::{Arc, OnceLock};
use std::time::Duration;

use anyhow::{anyhow, Context, Result};
use chromiumoxide::browser::{Browser, BrowserConfig};
use chromiumoxide::cdp::browser_protocol::browser::BrowserContextId;
use chromiumoxide::cdp::browser_protocol::target::{CreateBrowserContextParams, CreateTargetParams};
use futures::StreamExt;
use tokio::runtime::Runtime;
use tokio::sync::{OnceCell, RwLock, Semaphore};

use crate::server;
use crate::tab::Tab;

pub const DEFAULT_TABS: usize = 8;
const WINDOWS_CHROME: &str = r"C:\Program Files\Google\Chrome\Application\chrome.exe";

/// One Chrome and the single browser context its tests take turns in. A browser per slot,
/// rather than tabs in one browser, because every tab of a browser shares its one browser
/// process: at 8 tabs that process saturated while the renderers sat mostly idle.
struct Slot {
    browser: OnceCell<RwLock<Browser>>,
    context: std::sync::Mutex<Option<BrowserContextId>>,
}

pub struct Shared {
    pub base: String,
    pub origin: String,
    tabs: Arc<Semaphore>,
    slots: Vec<Slot>,
    free: std::sync::Mutex<Vec<usize>>,
}

static RUNTIME: OnceLock<Runtime> = OnceLock::new();
static SHARED: OnceLock<Arc<Shared>> = OnceLock::new();

pub fn runtime() -> &'static Runtime {
    RUNTIME.get_or_init(|| {
        tokio::runtime::Builder::new_multi_thread()
            .worker_threads(4)
            .enable_all()
            .build()
            .expect("tokio runtime")
    })
}

pub fn repo_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..").join("..").canonicalize().expect("repo root")
}

fn tab_limit() -> usize {
    std::env::var("EAS_TOOLS_TABS").ok().and_then(|v| v.parse().ok()).filter(|n| *n > 0).unwrap_or(DEFAULT_TABS)
}

fn base_url() -> String {
    match std::env::var("EAS_TOOLS_BASE_URL") {
        Ok(url) if !url.trim().is_empty() => url.trim().trim_end_matches('/').to_string(),
        _ => server::start(repo_root()),
    }
}

fn origin_of(base: &str) -> String {
    let after_scheme = base.find("://").map(|i| i + 3).unwrap_or(0);
    let end = base[after_scheme..].find('/').map(|i| i + after_scheme).unwrap_or(base.len());
    base[..end].to_string()
}

/// EAS_TOOLS_CHROME wins; otherwise the stock Windows install, and failing that chromiumoxide's
/// own lookup (google-chrome, chromium, ... on PATH).
fn chrome_executable() -> Option<PathBuf> {
    if let Some(path) = std::env::var_os("EAS_TOOLS_CHROME").filter(|v| !v.is_empty()) {
        return Some(PathBuf::from(path));
    }
    let windows = PathBuf::from(WINDOWS_CHROME);
    windows.exists().then_some(windows)
}

fn profile_dir(slot: usize) -> PathBuf {
    std::env::temp_dir().join(format!("eas-tools-e2e-chrome-{}-{slot}", std::process::id()))
}

pub fn shared() -> Arc<Shared> {
    Arc::clone(SHARED.get_or_init(|| {
        let base = base_url();
        let origin = origin_of(&base);
        let count = tab_limit();
        Arc::new(Shared {
            base,
            origin,
            tabs: Arc::new(Semaphore::new(count)),
            slots: (0..count).map(|_| Slot { browser: OnceCell::new(), context: std::sync::Mutex::new(None) }).collect(),
            free: std::sync::Mutex::new((0..count).rev().collect()),
        })
    }))
}

async fn launch(origin: &str, slot: usize) -> Result<RwLock<Browser>> {
    let host = origin.split("://").nth(1).unwrap_or("127.0.0.1").split(':').next().unwrap_or("127.0.0.1").to_string();
    let headless = std::env::var("EAS_TOOLS_HEADLESS").map(|v| v != "0" && v.to_lowercase() != "false").unwrap_or(true);
    let mut builder = BrowserConfig::builder();
    if let Some(chrome) = chrome_executable() {
        builder = builder.chrome_executable(chrome);
    }
    builder = builder
        .user_data_dir(profile_dir(slot))
        .window_size(1600, 1200)
        .viewport(None)
        .request_timeout(Duration::from_secs(60))
        .launch_timeout(Duration::from_secs(30))
        .no_sandbox()
        .args([
            format!("host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE {host}"),
            "blink-settings=primaryPointerType=4,availablePointerTypes=4,primaryHoverType=2,availableHoverTypes=2".to_string(),
            "autoplay-policy=no-user-gesture-required".to_string(),
            "disable-background-timer-throttling".to_string(),
            "disable-gpu".to_string(),
            "disable-dev-shm-usage".to_string(),
            "log-level=3".to_string(),
        ]);
    if std::env::var("EAS_TOOLS_NETLOG").map(|v| v == "1").unwrap_or(false) {
        let path = std::env::temp_dir().join(format!("eas-tools-netlog-{slot}.json"));
        builder = builder.args([format!("log-net-log={}", path.display()), "net-log-capture-mode=Everything".to_string()]);
    }
    builder = if headless { builder.new_headless_mode() } else { builder.with_head() };
    let config = builder.build().map_err(|e| anyhow!(e))?;
    let (browser, mut handler) = Browser::launch(config).await.with_context(|| format!("launch Chrome for slot {slot}"))?;
    tokio::spawn(async move { while handler.next().await.is_some() {} });
    Ok(RwLock::new(browser))
}

/// Opens a page on a browser no other running test is using, holding one of the concurrency
/// permits until the tab is closed. Each slot's context is reused: Tab::close wipes the origin's
/// storage before handing it back, but its HTTP and V8 code caches survive, so later tests skip
/// refetching and recompiling the tool bundles.
pub async fn open_tab() -> Result<Tab> {
    let shared = shared();
    let permit = Arc::clone(&shared.tabs).acquire_owned().await.context("tab semaphore closed")?;
    let slot = shared.free.lock().unwrap().pop().context("no free browser slot")?;
    match open_in_slot(&shared, slot).await {
        Ok((page, context)) => Tab::attach(page, slot, context, Arc::clone(&shared), permit).await,
        Err(e) => {
            shared.free.lock().unwrap().push(slot);
            Err(e)
        }
    }
}

async fn open_in_slot(shared: &Shared, slot: usize) -> Result<(chromiumoxide::Page, BrowserContextId)> {
    let browser = shared.slots[slot].browser.get_or_try_init(|| launch(&shared.origin, slot)).await?.read().await;
    let pooled = shared.slots[slot].context.lock().unwrap().take();
    let context = match pooled {
        Some(context) => context,
        None => browser
            .create_browser_context(CreateBrowserContextParams::default())
            .await
            .context("create browser context")?,
    };
    let params = CreateTargetParams::builder()
        .url("about:blank")
        .browser_context_id(context.clone())
        .build()
        .map_err(|e| anyhow!(e))?;
    let page = browser.new_page(params).await.context("open page")?;
    Ok((page, context))
}

impl Shared {
    /// Returns a slot after its test; `context` is kept for the next test when the wipe worked.
    pub(crate) async fn release(&self, slot: usize, context: BrowserContextId, reuse: bool) {
        if reuse {
            *self.slots[slot].context.lock().unwrap() = Some(context);
        } else if let Some(browser) = self.slots[slot].browser.get() {
            let _ = browser.read().await.dispose_browser_context(context).await;
        }
        self.free.lock().unwrap().push(slot);
    }
}

pub async fn shutdown() {
    let Some(shared) = SHARED.get() else { return };
    let closing = shared.slots.iter().enumerate().filter_map(|(i, slot)| slot.browser.get().map(|b| (i, b))).map(|(i, browser)| async move {
        let mut browser = browser.write().await;
        let _ = browser.close().await;
        let _ = browser.wait().await;
        let _ = std::fs::remove_dir_all(profile_dir(i));
    });
    futures::future::join_all(closing).await;
}
