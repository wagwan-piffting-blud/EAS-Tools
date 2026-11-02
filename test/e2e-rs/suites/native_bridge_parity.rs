//! Bridge additions behind the 2026-11 app parity pass: decoder alert details, normalizer and
//! crawl time zones, WarnGen's Send to… when the apps load it as the whole page, and iOS system
//! voices in the Splicer.

use eas_tools_e2e::browser::repo_root;
use eas_tools_e2e::*;

use crate::common::open_tool_tracking_errors;

const FAKE_BRIDGE_JS: &str = "
window.__bridgeHandlers = {};
window.__bridgeSent = [];
window.EASBridge = {
    on(name, fn) { window.__bridgeHandlers[name] = fn; },
    send(name, payload) { window.__bridgeSent.push([name, JSON.parse(JSON.stringify(payload))]); },
};
";

/// Stands in for the iOS Splicer's `window.EASNativeSpeech` (SplicerView.swift NativeSpeechBridge):
/// half a second of 440 Hz at 22,050 Hz as base64 Float32.
const FAKE_NATIVE_SPEECH_JS: &str = "
window.__speechCalls = [];
window.EASNativeSpeech = {
    voices: async () => [{ id: 'ios-native:com.apple.voice.compact.en-US.Samantha', label: '[iOS] Samantha (Compact, en-US)' }],
    synth: async (o) => {
        window.__speechCalls.push(JSON.parse(JSON.stringify(o)));
        const pcm = new Float32Array(11025);
        for (let i = 0; i < pcm.length; i++) pcm[i] = 0.25 * Math.sin(2 * Math.PI * 440 * i / 22050);
        const bytes = new Uint8Array(pcm.buffer);
        let s = '';
        for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
        return { pcm: btoa(s), sampleRate: 22050 };
    },
};
";

async fn open(tab: &Tab, tool: &str, handler: &str) -> Result<()> {
    tab.add_init_script(FAKE_BRIDGE_JS).await?;
    open_tool_tracking_errors(tab, tool).await?;
    tab.wait_until(
        &format!("!!(window.__bridgeHandlers && window.__bridgeHandlers['{handler}'])"),
        Duration::from_secs(30),
    )
    .await
}

/// Calls a bridge handler, then waits for `reply` and returns its latest payload.
async fn call_until(tab: &Tab, channel: &str, payload: Value, reply: &str) -> Result<Value> {
    tab.exec(
        "window.__bridgeSent.length = 0; window.__bridgeHandlers[arguments[0]](arguments[1]);",
        json!([channel, payload]),
    )
    .await?;
    tab.wait_until(
        &format!("window.__bridgeSent.some(([n]) => n === '{reply}')"),
        Duration::from_secs(15),
    )
    .await?;
    tab.js(
        "return window.__bridgeSent.filter(([n]) => n === arguments[0]).pop()[1];",
        json!([reply]),
    )
    .await
}

pub fn cases() -> Vec<Case> {
    vec![
        case(
            "decoder_headers_carry_expiry_and_endec_for_the_alert_details",
            |tab| async move {
                open(&tab, "decoder", "decoder:loadRawHeader").await?;
                let header = "ZCZC-WXR-TOR-048453+0030-2951711-KEWX/NWS-";
                let sent = call_until(
                    &tab,
                    "decoder:loadRawHeader",
                    json!({ "header": header }),
                    "decoder:header",
                )
                .await?;
                ensure!(sent["endecMode"] == "NONE (Raw Header)", "{sent}");
                let expires = sent["expiresAt"]
                    .as_f64()
                    .ok_or_else(|| anyhow!("no expiresAt: {sent}"))?;
                let issued: f64 = tab.eval("(() => { const y = new Date().getUTCFullYear(); return Date.UTC(y, 0, 295, 17, 11); })()").await?;
                ensure!(
                    (expires - issued - 30.0 * 60_000.0).abs() < 1.0,
                    "expiresAt {expires} is not issue time + 30 min ({issued})"
                );
                Ok(())
            },
        ),
        case(
            "play_back_audio_source_plays_the_ios_native_mic",
            |tab| async move {
                tab.add_init_script(
                "window.__ctxRates = [];
                 const AC = window.AudioContext;
                 window.AudioContext = class extends AC { constructor(o) { super(o); window.__ctxRates.push(o && o.sampleRate); } };",
            )
            .await?;
                open(&tab, "decoder", "decoder:nativePCM").await?;
                tab.exec(
                "const h = window.__bridgeHandlers;
                 h['decoder:setLoopback']({ enabled: true });
                 h['decoder:nativeStreamStart']({ sampleRate: 48000 });
                 const pcm = new Float32Array(4800).map((_, i) => 0.3 * Math.sin(2 * Math.PI * 440 * i / 48000));
                 const u8 = new Uint8Array(pcm.buffer); let s = '';
                 for (let i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]);
                 h['decoder:nativePCM']({ pcm: btoa(s) });",
                json!([]),
            )
            .await?;
                tab.wait_until("window.__ctxRates.includes(48000)", Duration::from_secs(5))
                    .await?;
                Ok(())
            },
        ),
        case(
            "the_normalizer_reads_time_zones_when_asked",
            |tab| async move {
                open(&tab, "normalizer", "normalizer:run").await?;
                let product = "BULLETIN - EAS ACTIVATION REQUESTED\nTornado Warning\nNational Weather Service Austin/San Antonio TX\n1211 PM CDT Wed Oct 22 2026\n\n* Until 1245 PM CDT.\n";
                let plain = call_until(
                    &tab,
                    "normalizer:run",
                    json!({ "text": product, "timeZone": false }),
                    "normalizer:result",
                )
                .await?;
                let zoned = call_until(
                    &tab,
                    "normalizer:run",
                    json!({ "text": product, "timeZone": true }),
                    "normalizer:result",
                )
                .await?;
                let (plain, zoned) = (
                    plain["result"].as_str().unwrap_or(""),
                    zoned["result"].as_str().unwrap_or(""),
                );
                ensure!(
                    zoned.contains("Central Daylight Time")
                        && !plain.contains("Central Daylight Time"),
                    "plain: {plain}\nzoned: {zoned}"
                );
                Ok(())
            },
        ),
        case(
            "the_crawl_header_text_follows_the_time_zone_choice",
            |tab| async move {
                open(&tab, "crawl", "crawl:convertHeader").await?;
                let header = "ZCZC-WXR-TOR-048453+0030-2951711-KEWX/NWS-";
                let options =
                    call_until(&tab, "crawl:requestData", json!({}), "crawl:timezonesData").await?;
                ensure!(
                    options["options"]
                        .as_array()
                        .is_some_and(|items| items.iter().any(|item| item["value"] == "UTC")),
                    "{options}"
                );
                let utc = call_until(
                    &tab,
                    "crawl:convertHeader",
                    json!({ "header": header, "overrideTZ": "UTC", "useLocalTZ": false }),
                    "crawl:headerConverted",
                )
                .await?;
                let eastern = call_until(&tab, "crawl:convertHeader", json!({ "header": header, "overrideTZ": "America/New_York", "useLocalTZ": false }), "crawl:headerConverted").await?;
                let (utc, eastern) = (
                    utc["text"].as_str().unwrap_or(""),
                    eastern["text"].as_str().unwrap_or(""),
                );
                ensure!(
                    utc.contains("5:11 PM") && eastern.contains("1:11 PM"),
                    "UTC: {utc}\nEastern: {eastern}"
                );
                let applied: String = tab
                    .eval("document.getElementById('crawlUseOverrideTZ').value")
                    .await?;
                ensure!(applied == "America/New_York", "{applied}");
                Ok(())
            },
        ),
        case(
            "a_crawl_export_uses_the_font_file_the_app_sends",
            |tab| async move {
                use base64::Engine;
                open(&tab, "crawl", "crawl:export").await?;
                let font = std::fs::read(repo_root().join("assets/fonts/UPD6465.ttf"))?;
                let data = base64::engine::general_purpose::STANDARD.encode(&font);
                tab.exec(
                "window.__bridgeHandlers['crawl:export']({ format: 'gif', text: 'FONT CHECK', crawlMode: 'custom', fontFamily: 'custom',
                    customFontData: arguments[0], customFontName: 'Mine.ttf', speed: 5, fontSize: 24, width: 320, height: 60, bgMode: 'color' });",
                json!([data]),
            )
            .await?;
                tab.wait_until(
                "document.getElementById('crawlFontFamily').value === 'User-Upload' && (window.__nativeCrawlFiles || {}).crawlCustomFontFile?.name === 'Mine.ttf'",
                Duration::from_secs(10),
            )
            .await?;
                let size: i64 = tab
                    .eval("window.__nativeCrawlFiles.crawlCustomFontFile.size")
                    .await?;
                ensure!(
                    size as usize == font.len(),
                    "font arrived as {size} bytes, sent {}",
                    font.len()
                );
                tab.exec("window.__bridgeHandlers['crawl:cancelExport'] && window.__bridgeHandlers['crawl:cancelExport']({});", json!([])).await
            },
        ),
        case(
            "the_splicer_lists_and_speaks_ios_system_voices",
            |tab| async move {
                tab.add_init_script(FAKE_NATIVE_SPEECH_JS).await?;
                open_tool_tracking_errors(&tab, "splicer").await?;
                let voice = "ios-native:com.apple.voice.compact.en-US.Samantha";
                tab.wait_until(
                    &format!("!!document.querySelector('#ttsVoice2 option[value=\"{voice}\"]')"),
                    Duration::from_secs(30),
                )
                .await?;
                tab.exec(
                "const s = document.getElementById('ttsVoice2'); s.value = arguments[0]; s.dispatchEvent(new Event('change'));
                 const r = document.getElementById('ttsRate2'); r.value = '4'; r.dispatchEvent(new Event('input'));
                 window.splicerEditor.setValue('THIS IS A TEST');",
                json!([voice]),
            )
            .await?;
                let sliders_hidden: bool = tab
                    .eval("document.getElementById('ttsRatePitchControls2').hidden")
                    .await?;
                ensure!(
                    !sliders_hidden,
                    "the speed and pitch sliders stay hidden for an iOS voice"
                );
                tab.click("[data-splice-tts-generate]").await?;
                tab.wait_until("(document.querySelector('[data-splice-tts-status]').textContent || '').includes('iOS TTS audio')", Duration::from_secs(15)).await?;
                let call: Value = tab.eval("window.__speechCalls[0]").await?;
                ensure!(
                    call["voiceId"] == "com.apple.voice.compact.en-US.Samantha"
                        && call["text"] == "THIS IS A TEST",
                    "{call}"
                );
                ensure!(
                    (call["rate"].as_f64().unwrap_or(0.0) - 0.7).abs() < 1e-9,
                    "speed slider 4 should map to rate 0.7: {call}"
                );
                let status: String = tab
                    .eval("document.querySelector('[data-splice-tts-status]').textContent")
                    .await?;
                ensure!(status.contains("Added 0.50s"), "{status}");
                let errors: Vec<String> = tab.eval("window.__testErrors").await?;
                ensure!(errors.is_empty(), "{errors:?}");
                Ok(())
            },
        ),
        case(
            "warngen_offers_send_to_when_the_app_loads_it_as_the_page",
            |tab| async move {
                tab.add_init_script(
                "window.__nativeSends = []; window.EASNativeHandoff = (tool, payload, what) => { window.__nativeSends.push([tool, payload, what]); return true; };",
            )
            .await?;
                tab.goto("warngen/").await?;
                tab.wait_until(
                    "!!document.querySelector('#copy-btn + .send-menu')",
                    Duration::from_secs(40),
                )
                .await?;
                let hidden: bool = tab
                    .eval("document.querySelector('#copy-btn + .send-menu').hidden")
                    .await?;
                ensure!(
                    !hidden,
                    "the menu is attached but hidden, so no tool counted as reachable"
                );
                Ok(())
            },
        ),
    ]
}
