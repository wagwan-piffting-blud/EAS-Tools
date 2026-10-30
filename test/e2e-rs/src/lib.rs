pub mod axe;
pub mod browser;
pub mod img;
pub mod server;
pub mod tab;

use std::future::Future;
use std::pin::Pin;
use std::sync::Arc;

pub use anyhow::{anyhow, bail, ensure, Context, Result};
pub use serde_json::{json, Value};
pub use std::time::Duration;
pub use tab::Tab;

type BoxFuture = Pin<Box<dyn Future<Output = Result<()>> + Send + 'static>>;

enum Body {
    Browser(Arc<dyn Fn(Tab) -> BoxFuture + Send + Sync>),
    Plain(Arc<dyn Fn() -> Result<()> + Send + Sync>),
}

pub struct Case {
    name: String,
    body: Body,
}

/// A test that gets its own isolated browser tab.
pub fn case<F, Fut>(name: impl Into<String>, f: F) -> Case
where
    F: Fn(Tab) -> Fut + Send + Sync + 'static,
    Fut: Future<Output = Result<()>> + Send + 'static,
{
    Case { name: name.into(), body: Body::Browser(Arc::new(move |tab| Box::pin(f(tab)))) }
}

/// A test that never touches the browser.
pub fn plain<F>(name: impl Into<String>, f: F) -> Case
where
    F: Fn() -> Result<()> + Send + Sync + 'static,
{
    Case { name: name.into(), body: Body::Plain(Arc::new(f)) }
}

fn run_case(body: &Body) -> Result<()> {
    match body {
        Body::Plain(f) => f(),
        Body::Browser(f) => {
            let f = Arc::clone(f);
            browser::runtime().block_on(async move {
                let tab = browser::open_tab().await?;
                let outcome = tokio::spawn(f(tab.clone())).await;
                tab.close().await;
                match outcome {
                    Ok(result) => result,
                    Err(join) => Err(anyhow!("test panicked: {join}")),
                }
            })
        }
    }
}

pub fn run(groups: Vec<(&'static str, Vec<Case>)>) -> std::process::ExitCode {
    let mut args = libtest_mimic::Arguments::from_args();
    if args.test_threads.is_none() {
        args.test_threads = Some(
            std::env::var("EAS_TOOLS_TABS").ok().and_then(|v| v.parse().ok()).unwrap_or(browser::DEFAULT_TABS),
        );
    }
    let trials = groups
        .into_iter()
        .flat_map(|(module, cases)| {
            cases.into_iter().map(move |c| {
                let body = c.body;
                let name = format!("{module}::{}", c.name);
                libtest_mimic::Trial::test(name.clone(), move || {
                    let started = std::time::Instant::now();
                    let outcome = run_case(&body).map_err(|e| format!("{e:#}").into());
                    let elapsed = started.elapsed();
                    if elapsed > Duration::from_secs(2) {
                        eprintln!("[slow] {name} {:.1}s", elapsed.as_secs_f64());
                    }
                    outcome
                })
            })
        })
        .collect();
    let conclusion = libtest_mimic::run(&args, trials);
    browser::runtime().block_on(browser::shutdown());
    conclusion.exit_code()
}
