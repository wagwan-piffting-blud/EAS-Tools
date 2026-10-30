use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use anyhow::{anyhow, bail, Context, Result};
use chromiumoxide::cdp::browser_protocol::browser::BrowserContextId;
use chromiumoxide::cdp::browser_protocol::dom::SetFileInputFilesParams;
use chromiumoxide::cdp::browser_protocol::emulation::{
    ClearDeviceMetricsOverrideParams, MediaFeature, SetDeviceMetricsOverrideParams, SetEmulatedMediaParams,
};
use chromiumoxide::cdp::browser_protocol::input::{
    DispatchKeyEventParams, DispatchKeyEventType, DispatchMouseEventParams, DispatchMouseEventType, InsertTextParams,
    MouseButton,
};
use chromiumoxide::cdp::browser_protocol::page::{
    AddScriptToEvaluateOnNewDocumentParams, EventJavascriptDialogOpening, HandleJavaScriptDialogParams, NavigateParams,
};
use chromiumoxide::cdp::browser_protocol::storage::ClearDataForOriginParams;
use chromiumoxide::cdp::js_protocol::runtime::EvaluateParams;
use chromiumoxide::Page;
use futures::StreamExt;
use serde::de::DeserializeOwned;
use serde_json::Value;
use tokio::sync::OwnedSemaphorePermit;

use crate::browser::Shared;

pub const SCRIPT_TIMEOUT: Duration = Duration::from_secs(30);

/// Everything a test can leave behind for its origin, except the HTTP cache.
const STORAGE_TYPES: &str = "cookies,file_systems,indexeddb,local_storage,websql,service_workers,cache_storage";

struct Inner {
    page: Page,
    slot: usize,
    context: Mutex<Option<BrowserContextId>>,
    shared: Arc<Shared>,
    dialogs: Arc<Mutex<Vec<String>>>,
    _permit: OwnedSemaphorePermit,
}

/// One isolated page. Cheap to clone; the runner closes it when the test ends.
#[derive(Clone)]
pub struct Tab(Arc<Inner>);

impl Tab {
    pub(crate) async fn attach(
        page: Page,
        slot: usize,
        context: BrowserContextId,
        shared: Arc<Shared>,
        permit: OwnedSemaphorePermit,
    ) -> Result<Tab> {
        let dialogs = Arc::new(Mutex::new(Vec::new()));
        let mut events = page.event_listener::<EventJavascriptDialogOpening>().await?;
        let seen = Arc::clone(&dialogs);
        let dialog_page = page.clone();
        tokio::spawn(async move {
            while let Some(event) = events.next().await {
                seen.lock().unwrap().push(event.message.clone());
                let _ = dialog_page.execute(HandleJavaScriptDialogParams::new(false)).await;
            }
        });
        Ok(Tab(Arc::new(Inner { page, slot, context: Mutex::new(Some(context)), shared, dialogs, _permit: permit })))
    }

    pub fn page(&self) -> &Page {
        &self.0.page
    }

    pub fn base(&self) -> &str {
        &self.0.shared.base
    }

    pub fn origin(&self) -> &str {
        &self.0.shared.origin
    }

    pub fn url(&self, path: &str) -> String {
        format!("{}/{}", self.base(), path.trim_start_matches('/'))
    }

    /// Messages of every alert/confirm/prompt the page raised; each was dismissed.
    pub fn dialogs(&self) -> Vec<String> {
        self.0.dialogs.lock().unwrap().clone()
    }

    /// Wipes the origin's storage and hands the context back for reuse; a context whose wipe
    /// fails is disposed instead, so nothing a test stored can reach the next one.
    pub(crate) async fn close(&self) {
        let wiped = self
            .0
            .page
            .execute(ClearDataForOriginParams::new(self.origin(), STORAGE_TYPES))
            .await
            .is_ok();
        let _ = self.0.page.clone().close().await;
        let context = self.0.context.lock().unwrap().take();
        if let Some(context) = context {
            self.0.shared.release(self.0.slot, context, wiped).await;
        }
    }

    pub async fn goto(&self, path: &str) -> Result<()> {
        let url = if path.starts_with("http") || path.starts_with("about:") { path.to_string() } else { self.url(path) };
        self.0.page.goto(NavigateParams::new(url.clone())).await.with_context(|| format!("navigate to {url}"))?;
        self.wait_until("document.readyState === 'complete'", Duration::from_secs(45)).await
    }

    async fn evaluate_raw(&self, expression: String, timeout: Duration) -> Result<Value> {
        let params = EvaluateParams::builder()
            .expression(expression)
            .await_promise(true)
            .return_by_value(true)
            .user_gesture(true)
            .build()
            .map_err(|e| anyhow!(e))?;
        let reply = tokio::time::timeout(timeout, self.0.page.execute(params))
            .await
            .map_err(|_| anyhow!("script timed out after {:?}", timeout))??;
        if let Some(details) = &reply.result.exception_details {
            let description = details
                .exception
                .as_ref()
                .and_then(|e| e.description.clone())
                .unwrap_or_else(|| details.text.clone());
            bail!("page script threw: {description}");
        }
        Ok(reply.result.result.value.clone().unwrap_or(Value::Null))
    }

    /// Evaluates an expression; promises are awaited.
    pub async fn eval<T: DeserializeOwned>(&self, expression: &str) -> Result<T> {
        let value = self.evaluate_raw(expression.to_string(), SCRIPT_TIMEOUT).await?;
        serde_json::from_value(value.clone()).with_context(|| format!("unexpected script result {value}"))
    }

    /// Runs a Selenium execute_script style body: `arguments[n]` holds `args` and `return` hands back the value.
    pub async fn js<T: DeserializeOwned>(&self, body: &str, args: Value) -> Result<T> {
        let expression = format!("(function() {{\n{body}\n}}).apply(null, {})", args_array(args));
        let value = self.evaluate_raw(expression, SCRIPT_TIMEOUT).await?;
        serde_json::from_value(value.clone()).with_context(|| format!("unexpected script result {value}"))
    }

    /// Runs a Selenium execute_async_script style body: the last argument is the `done` callback.
    pub async fn js_async<T: DeserializeOwned>(&self, body: &str, args: Value) -> Result<T> {
        self.js_async_timeout(body, args, Duration::from_secs(90)).await
    }

    pub async fn js_async_timeout<T: DeserializeOwned>(&self, body: &str, args: Value, timeout: Duration) -> Result<T> {
        let expression = format!(
            "new Promise((__done, __fail) => {{ try {{ (function() {{\n{body}\n}}).apply(null, [...{}, __done]); }} catch (e) {{ __fail(e); }} }})",
            args_array(args)
        );
        let value = self.evaluate_raw(expression, timeout).await?;
        serde_json::from_value(value.clone()).with_context(|| format!("unexpected script result {value}"))
    }

    pub async fn exec(&self, body: &str, args: Value) -> Result<()> {
        let _: Value = self.js(body, args).await?;
        Ok(())
    }

    /// Polls a JS expression until it is truthy. Evaluation errors (e.g. mid-navigation) count as not yet.
    pub async fn wait_until(&self, expression: &str, timeout: Duration) -> Result<()> {
        let deadline = Instant::now() + timeout;
        let check = format!("!!(() => {{ try {{ return ({expression}); }} catch (e) {{ return false; }} }})()");
        let mut last_error = None;
        loop {
            match self.evaluate_raw(check.clone(), Duration::from_secs(10)).await {
                Ok(Value::Bool(true)) => return Ok(()),
                Ok(_) => {}
                Err(e) => last_error = Some(e),
            }
            if Instant::now() >= deadline {
                match last_error {
                    Some(e) => bail!("timed out after {timeout:?} waiting for `{expression}` (last error: {e:#})"),
                    None => bail!("timed out after {timeout:?} waiting for `{expression}`"),
                }
            }
            tokio::time::sleep(Duration::from_millis(25)).await;
        }
    }

    /// Polls an expression until `accept` approves its value, returning that value.
    pub async fn wait_for<T: DeserializeOwned>(
        &self,
        expression: &str,
        timeout: Duration,
        accept: impl Fn(&T) -> bool,
    ) -> Result<T> {
        let deadline = Instant::now() + timeout;
        loop {
            if let Ok(value) = self.eval::<T>(expression).await {
                if accept(&value) {
                    return Ok(value);
                }
            }
            if Instant::now() >= deadline {
                bail!("timed out after {timeout:?} waiting on `{expression}`");
            }
            tokio::time::sleep(Duration::from_millis(25)).await;
        }
    }

    pub async fn exists(&self, selector: &str) -> Result<bool> {
        self.js("return !!document.querySelector(arguments[0]);", serde_json::json!([selector])).await
    }

    pub async fn wait_for_selector(&self, selector: &str, timeout: Duration) -> Result<()> {
        let expr = format!("!!document.querySelector({})", serde_json::to_string(selector)?);
        self.wait_until(&expr, timeout).await
    }

    /// Center of the element in viewport coordinates after scrolling it into view.
    pub async fn center_of(&self, selector: &str) -> Result<(f64, f64)> {
        let point: Option<(f64, f64)> = self
            .js(
                "const el = document.querySelector(arguments[0]);
                 if (!el) return null;
                 el.scrollIntoView({ block: 'center', inline: 'center' });
                 const r = el.getBoundingClientRect();
                 return [r.left + r.width / 2, r.top + r.height / 2];",
                serde_json::json!([selector]),
            )
            .await?;
        point.ok_or_else(|| anyhow!("no element matches `{selector}`"))
    }

    /// A real mouse click (trusted events), like Selenium's element.click().
    pub async fn click(&self, selector: &str) -> Result<()> {
        let (x, y) = self.center_of(selector).await?;
        self.click_at(x, y).await
    }

    pub async fn click_at(&self, x: f64, y: f64) -> Result<()> {
        let page = &self.0.page;
        page.execute(mouse(DispatchMouseEventType::MouseMoved, x, y, None)?).await?;
        page.execute(mouse(DispatchMouseEventType::MousePressed, x, y, Some(1))?).await?;
        page.execute(mouse(DispatchMouseEventType::MouseReleased, x, y, Some(1))?).await?;
        Ok(())
    }

    /// A real wheel tick over the element's center (JS WheelEvents skip the browser's own handling).
    pub async fn wheel(&self, selector: &str, delta_y: f64) -> Result<()> {
        let (x, y): (f64, f64) = self
            .js(
                "const r = document.querySelector(arguments[0]).getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2];",
                serde_json::json!([selector]),
            )
            .await?;
        let params = DispatchMouseEventParams::builder()
            .r#type(DispatchMouseEventType::MouseWheel)
            .x(x)
            .y(y)
            .delta_x(0.0)
            .delta_y(delta_y)
            .build()
            .map_err(|e| anyhow!(e))?;
        self.0.page.execute(params).await?;
        Ok(())
    }

    /// Focuses a field, selects its content and types over it, like send_keys after Ctrl+A.
    pub async fn replace_text(&self, selector: &str, text: &str) -> Result<()> {
        let found: bool = self
            .js(
                "const el = document.querySelector(arguments[0]); if (!el) return false;
                 el.scrollIntoView({ block: 'center' }); el.focus(); if (el.select) el.select(); return true;",
                serde_json::json!([selector]),
            )
            .await?;
        if !found {
            bail!("no element matches `{selector}`");
        }
        if text.is_empty() {
            self.press("Delete", &[]).await
        } else {
            self.type_text(text).await
        }
    }

    pub async fn focus(&self, selector: &str) -> Result<()> {
        let found: bool = self
            .js(
                "const el = document.querySelector(arguments[0]); if (!el) return false; el.focus(); return true;",
                serde_json::json!([selector]),
            )
            .await?;
        if !found {
            bail!("no element matches `{selector}`");
        }
        Ok(())
    }

    /// Presses a key by name (`Tab`, `Enter`, `ArrowDown`, `a`, ...) with optional modifiers
    /// (`"Shift"`, `"Control"`, `"Alt"`, `"Meta"`).
    pub async fn press(&self, key: &str, modifiers: &[&str]) -> Result<()> {
        let spec = key_spec(key);
        let mask = modifiers.iter().fold(0i64, |m, k| {
            m | match *k {
                "Alt" => 1,
                "Control" => 2,
                "Meta" => 4,
                "Shift" => 8,
                _ => 0,
            }
        });
        let text = if mask & 0b110 == 0 { spec.text.clone() } else { None };
        let down_type = if text.is_some() { DispatchKeyEventType::KeyDown } else { DispatchKeyEventType::RawKeyDown };
        let mut down = DispatchKeyEventParams::builder()
            .r#type(down_type)
            .key(spec.key.clone())
            .code(spec.code.clone())
            .windows_virtual_key_code(spec.vk)
            .native_virtual_key_code(spec.vk)
            .modifiers(mask);
        if let Some(text) = text {
            down = down.text(text.clone()).unmodified_text(text);
        }
        self.0.page.execute(down.build().map_err(|e| anyhow!(e))?).await?;
        let up = DispatchKeyEventParams::builder()
            .r#type(DispatchKeyEventType::KeyUp)
            .key(spec.key)
            .code(spec.code)
            .windows_virtual_key_code(spec.vk)
            .native_virtual_key_code(spec.vk)
            .modifiers(mask)
            .build()
            .map_err(|e| anyhow!(e))?;
        self.0.page.execute(up).await?;
        Ok(())
    }

    /// Types text into the focused element one key at a time, like Selenium's send_keys.
    pub async fn type_text(&self, text: &str) -> Result<()> {
        for ch in text.chars() {
            if ch.is_ascii_alphanumeric() || " .,-_/:;'\"!?()[]{}@#$%^&*+=<>|\\`~".contains(ch) {
                let s = ch.to_string();
                let shift = ch.is_ascii_uppercase();
                self.press(&s, if shift { &["Shift"] } else { &[] }).await?;
            } else {
                self.0.page.execute(InsertTextParams::new(ch.to_string())).await?;
            }
        }
        Ok(())
    }

    pub async fn set_viewport(&self, width: i64, height: i64) -> Result<()> {
        let params = SetDeviceMetricsOverrideParams::builder()
            .width(width)
            .height(height)
            .device_scale_factor(1.0)
            .mobile(false)
            .build()
            .map_err(|e| anyhow!(e))?;
        self.0.page.execute(params).await?;
        Ok(())
    }

    pub async fn clear_viewport(&self) -> Result<()> {
        self.0.page.execute(ClearDeviceMetricsOverrideParams::default()).await?;
        Ok(())
    }

    pub async fn emulate_media(&self, features: &[(&str, &str)]) -> Result<()> {
        let features: Vec<MediaFeature> = features.iter().map(|(n, v)| MediaFeature::new(*n, *v)).collect();
        self.0.page.execute(SetEmulatedMediaParams::builder().features(features).build()).await?;
        Ok(())
    }

    /// Puts files on an `<input type=file>` and fires its change event, like send_keys(path).
    pub async fn set_files(&self, selector: &str, paths: &[std::path::PathBuf]) -> Result<()> {
        let element = self.0.page.find_element(selector).await.with_context(|| format!("no `{selector}`"))?;
        let files = paths.iter().map(|p| p.to_string_lossy().into_owned()).collect::<Vec<_>>();
        let params = SetFileInputFilesParams::builder()
            .files(files)
            .backend_node_id(element.backend_node_id)
            .build()
            .map_err(|e| anyhow!(e))?;
        self.0.page.execute(params).await?;
        Ok(())
    }

    /// Runs `source` before any page script on every later navigation of this tab.
    pub async fn add_init_script(&self, source: &str) -> Result<()> {
        self.0.page.execute(AddScriptToEvaluateOnNewDocumentParams::new(source)).await?;
        Ok(())
    }

    pub async fn active_id(&self) -> Result<String> {
        self.eval("document.activeElement ? (document.activeElement.id || '') : ''").await
    }

    pub async fn local_storage_set(&self, key: &str, value: &str) -> Result<()> {
        self.exec("localStorage.setItem(arguments[0], arguments[1]);", serde_json::json!([key, value])).await
    }
}

fn args_array(args: Value) -> String {
    match args {
        Value::Array(_) => args.to_string(),
        Value::Null => "[]".to_string(),
        other => Value::Array(vec![other]).to_string(),
    }
}

fn mouse(kind: DispatchMouseEventType, x: f64, y: f64, clicks: Option<i64>) -> Result<DispatchMouseEventParams> {
    let mut builder = DispatchMouseEventParams::builder().r#type(kind).x(x).y(y);
    if let Some(count) = clicks {
        builder = builder.button(MouseButton::Left).buttons(1).click_count(count);
    }
    builder.build().map_err(|e| anyhow!(e))
}

struct KeySpec {
    key: String,
    code: String,
    vk: i64,
    text: Option<String>,
}

fn key_spec(key: &str) -> KeySpec {
    let named = |key: &str, code: &str, vk: i64, text: Option<&str>| KeySpec {
        key: key.into(),
        code: code.into(),
        vk,
        text: text.map(Into::into),
    };
    match key {
        "Enter" => named("Enter", "Enter", 13, Some("\r")),
        "Tab" => named("Tab", "Tab", 9, None),
        "Escape" => named("Escape", "Escape", 27, None),
        "Backspace" => named("Backspace", "Backspace", 8, None),
        "Delete" => named("Delete", "Delete", 46, None),
        "ArrowUp" => named("ArrowUp", "ArrowUp", 38, None),
        "ArrowDown" => named("ArrowDown", "ArrowDown", 40, None),
        "ArrowLeft" => named("ArrowLeft", "ArrowLeft", 37, None),
        "ArrowRight" => named("ArrowRight", "ArrowRight", 39, None),
        "Home" => named("Home", "Home", 36, None),
        "End" => named("End", "End", 35, None),
        "PageUp" => named("PageUp", "PageUp", 33, None),
        "PageDown" => named("PageDown", "PageDown", 34, None),
        " " | "Space" => named(" ", "Space", 32, Some(" ")),
        other => {
            let ch = other.chars().next().unwrap_or(' ');
            let upper = ch.to_ascii_uppercase();
            let (code, vk) = if ch.is_ascii_alphabetic() {
                (format!("Key{upper}"), upper as i64)
            } else if ch.is_ascii_digit() {
                (format!("Digit{ch}"), ch as i64)
            } else {
                (String::new(), 0)
            };
            KeySpec { key: other.to_string(), code, vk, text: Some(other.to_string()) }
        }
    }
}
