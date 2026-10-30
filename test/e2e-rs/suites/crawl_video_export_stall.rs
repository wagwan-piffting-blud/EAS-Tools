//! A video encoder that stops taking frames partway through (GH #133) no longer freezes the export.
//!
//! The stub below wraps the real VideoEncoder: after ten frames it swallows input and reports a full
//! queue without ever firing `dequeue`, which is how stalled hardware encoders look to mediabunny.
//! The export has to notice, then finish on the software WebCodecs encoder, or on the wasm H.264
//! encoder when the browser has no software WebCodecs encoder for the codec.

use eas_tools_e2e::*;

use crate::common::{open_tool_tracking_errors, set_field};

const STALL_ENCODER_JS: &str = r#"
const noSoftware = arguments[0];
const Real = window.VideoEncoder;
window.__encoderModes = [];
class StallingEncoder extends Real {
    static async isConfigSupported(config) {
        if (noSoftware && config && config.hardwareAcceleration === 'prefer-software') {
            return { supported: false, config };
        }
        return Real.isConfigSupported(config);
    }
    configure(config) {
        const mode = (config && config.hardwareAcceleration) || 'unset';
        this.__canStall = mode !== 'prefer-software';
        this.__count = 0;
        this.__stalled = false;
        window.__encoderModes.push(mode);
        return super.configure(config);
    }
    encode(frame, options) {
        this.__count++;
        if (this.__canStall && this.__count > 10) {
            this.__stalled = true;
            return;
        }
        return super.encode(frame, options);
    }
    get encodeQueueSize() {
        return this.__stalled ? 8 : super.encodeQueueSize;
    }
}
window.VideoEncoder = StallingEncoder;
"#;

const EXPORT_JS: &str = r#"
const done = arguments[arguments.length - 1];
(async () => {
    try {
        let captured = null;
        const previous = window.EASDownloads;
        window.EASDownloads = { saveBlob: async (blob) => { captured = blob; } };
        try {
            document.getElementById('exportCrawlVideo').click();
            const deadline = Date.now() + 150000;
            while (Date.now() < deadline && captured === null) {
                await new Promise((resolve) => setTimeout(resolve, 50));
            }
        } finally {
            window.EASDownloads = previous;
        }
        const status = (document.getElementById('status-crawl') || document.body).textContent;
        if (!captured) { done({ ok: false, error: 'the export never finished', status: status.slice(-2000) }); return; }
        const bytes = new Uint8Array(await captured.slice(0, 16).arrayBuffer());
        done({
            ok: true,
            type: captured.type,
            size: captured.size,
            ftyp: String.fromCharCode(...bytes.slice(4, 8)),
            ebml: bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3,
            modes: window.__encoderModes,
            status: status.slice(-4000)
        });
    } catch (error) {
        done({ ok: false, error: String(error) });
    }
})();
"#;

async fn setup(tab: &Tab, no_software: bool) -> Result<()> {
    open_tool_tracking_errors(tab, "crawl").await?;
    set_field(tab, "#crawlMode", "custom").await?;
    tab.wait_until("!!window.crawlEditor", Duration::from_secs(20)).await?;
    tab.exec("window.crawlEditor.setValue('STALL TEST');", json!([])).await?;
    set_field(tab, "#crawlWidth", "320").await?;
    set_field(tab, "#crawlHeight", "64").await?;
    set_field(tab, "#crawlSpeed", "8").await?;
    set_field(tab, "#crawlRestartDelay", "0").await?;
    set_field(tab, "#crawlExportVideoFps", "30").await?;
    set_field(tab, "#crawlExportVideoFormat", "webm").await?;
    tab.wait_until("window.crawlGenerator && window.crawlGenerator.canvas.width === 320", Duration::from_secs(10)).await?;
    let has_encoder: bool = tab.eval("typeof VideoEncoder === 'function'").await?;
    ensure!(has_encoder, "this Chrome has no WebCodecs VideoEncoder to stall");
    tab.exec(STALL_ENCODER_JS, json!([no_software])).await
}

async fn export(tab: &Tab) -> Result<Value> {
    let result: Value = tab.js_async(EXPORT_JS, json!([])).await?;
    ensure!(result["ok"] == true, "{result}");
    let errors: Vec<String> = tab.eval("window.__testErrors || []").await?;
    ensure!(errors.is_empty(), "page errors {errors:?}");
    Ok(result)
}

pub fn cases() -> Vec<Case> {
    vec![
        case("stalled_hardware_encoder_retries_on_the_software_encoder", |tab| async move {
            setup(&tab, false).await?;
            let result = export(&tab).await?;
            let status = result["status"].as_str().unwrap_or_default();
            ensure!(status.contains("restarting the export with its software encoder"), "no retry notice: {result}");
            let modes: Vec<String> = serde_json::from_value(result["modes"].clone())?;
            ensure!(modes.iter().any(|mode| mode == "prefer-software"), "never asked for a software encoder: {modes:?}");
            ensure!(result["ebml"] == true && result["size"].as_u64().unwrap_or(0) > 1000, "not a WebM: {result}");
            Ok(())
        }),
        case("stalled_encoder_without_software_webcodecs_uses_wasm_h264", |tab| async move {
            setup(&tab, true).await?;
            let result = export(&tab).await?;
            let status = result["status"].as_str().unwrap_or_default();
            ensure!(status.contains("built-in H.264 encoder"), "no wasm fallback notice: {result}");
            ensure!(result["ftyp"] == "ftyp" && result["type"] == "video/mp4", "not an MP4: {result}");
            Ok(())
        }),
    ]
}
