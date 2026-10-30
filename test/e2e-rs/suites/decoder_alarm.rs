//! The weather-radio alarm plays real BC370/CRS recordings, one per severity band. Web Audio
//! output cannot be sampled, so this covers the wiring: the three assets are served and
//! decodable, ticking the option preloads all of them, and the cache stops refetches.

use eas_tools_e2e::*;

use crate::common::{checkbox_state, open_tool, set_checkbox};

const ALARM_FILES: [&str; 3] = ["assets/bc370crs_warn.wav", "assets/bc370crs_watch.wav", "assets/bc370crs_adv.wav"];

const FETCH_SPY_JS: &str = "
window.__fetched = [];
const original = window.fetch;
window.fetch = function (...args) {
    try { window.__fetched.push(String(args[0])); } catch (e) { }
    return original.apply(this, args);
};
return true;";

const PROBE_ASSET_JS: &str = "
const done = arguments[arguments.length - 1];
fetch(arguments[0])
    .then((r) => r.ok ? r.arrayBuffer().then((b) => ({ ok: true, status: r.status, bytes: b.byteLength,
        riff: new TextDecoder().decode(new Uint8Array(b, 0, 4)),
        wave: new TextDecoder().decode(new Uint8Array(b, 8, 4)) }))
        : { ok: false, status: r.status })
    .then(done)
    .catch((e) => done({ ok: false, error: String(e) }));";

const DECODE_ASSET_JS: &str = "
const done = arguments[arguments.length - 1];
const ctx = new (window.AudioContext || window.webkitAudioContext)();
fetch(arguments[0])
    .then((r) => r.arrayBuffer())
    .then((b) => ctx.decodeAudioData(b))
    .then((buf) => done({ ok: true, duration: buf.duration, channels: buf.numberOfChannels }))
    .catch((e) => done({ ok: false, error: String(e) }))
    .finally(() => { try { ctx.close(); } catch (e) { } });";

async fn alarm_fetches(tab: &Tab) -> Result<Vec<String>> {
    let fetched: Vec<String> = tab.eval("window.__fetched || []").await?;
    Ok(fetched.into_iter().filter(|u| u.contains("bc370crs")).collect())
}

pub fn cases() -> Vec<Case> {
    let mut cases = Vec::new();
    for asset in ALARM_FILES {
        let name = asset.rsplit('/').next().unwrap();
        cases.push(case(format!("alarm_asset_is_served_as_a_wav[{name}]"), move |tab| async move {
            open_tool(&tab, "decoder").await?;
            let result: Value = tab.js_async(PROBE_ASSET_JS, json!([tab.url(asset)])).await?;
            ensure!(result["ok"] == true, "{asset} not served: {result}");
            ensure!(result["riff"] == "RIFF" && result["wave"] == "WAVE", "{result}");
            ensure!(result["bytes"].as_i64().unwrap_or(0) > 1000, "{result}");
            Ok(())
        }));
        cases.push(case(format!("alarm_asset_decodes_and_is_long_enough_to_cover_the_cap[{name}]"), move |tab| async move {
            open_tool(&tab, "decoder").await?;
            let result: Value = tab.js_async(DECODE_ASSET_JS, json!([tab.url(asset)])).await?;
            ensure!(result["ok"] == true, "{asset} did not decode: {result}");
            ensure!(result["duration"].as_f64().unwrap_or(0.0) >= 5.0, "{asset} is shorter than the 5 s cap: {result}");
            Ok(())
        }));
    }
    cases.push(case("enabling_the_alarm_preloads_every_severity_sound", |tab| async move {
        open_tool(&tab, "decoder").await?;
        ensure!(!checkbox_state(&tab, "decoder-alarm-beep").await?);
        tab.exec(FETCH_SPY_JS, json!([])).await?;
        set_checkbox(&tab, "decoder-alarm-beep", true).await?;
        tab.wait_until(
            &format!("(() => {{ const f = window.__fetched || []; return {}.every((n) => f.some((u) => u.includes(n))); }})()", json!(ALARM_FILES)),
            Duration::from_secs(20),
        )
        .await?;
        let before = alarm_fetches(&tab).await?.len();
        set_checkbox(&tab, "decoder-alarm-beep", false).await?;
        set_checkbox(&tab, "decoder-alarm-beep", true).await?;
        let after = alarm_fetches(&tab).await?.len();
        ensure!(after == before, "alarm sounds were refetched instead of served from the cache ({before} -> {after})");
        Ok(())
    }));
    cases.push(case("alarm_option_defaults_off_and_auto_record_defaults_on", |tab| async move {
        open_tool(&tab, "decoder").await?;
        ensure!(!checkbox_state(&tab, "decoder-alarm-beep").await?);
        ensure!(checkbox_state(&tab, "decoder-auto-record").await?);
        Ok(())
    }));
    cases
}
