//! "Send to…" menus hand a result from one tool to another in place, without a page reload.

use std::f64::consts::PI;

use eas_tools_e2e::*;

use crate::common::{generate, open_tool, open_tool_tracking_errors, set_field, temp_file, wait_for_tool};

const HEADER: &str = "ZCZC-WXR-TOR-029095-029047+0030-2521820-KEAX/NWS-";
const PRODUCT: &str = "WFUS53 KEAX 201820
TOREAX
MOC095-201900-
/O.NEW.KEAX.TO.W.0001.261020T1820Z-261020T1900Z/

BULLETIN - EAS ACTIVATION REQUESTED
Tornado Warning
National Weather Service Kansas City/Pleasant Hill MO
120 PM CDT Tue Oct 20 2026

The National Weather Service in Pleasant Hill has issued a

* Tornado Warning for...
  Jackson County in west central Missouri...

* Until 200 PM CDT.

$$
";
const RATE: u32 = 22050;
const BAUD: f64 = 520.8333333333334;

/// Opens the menu under `arguments[0]` and clicks the item whose text starts with `arguments[1]`.
const SEND_JS: &str = r#"
const scope = document.querySelector(arguments[0]);
if (!scope) return { ok: false, error: 'no scope ' + arguments[0] };
const button = scope.querySelector('.send-menu__button');
if (!button) return { ok: false, error: 'no send menu in ' + arguments[0] };
button.click();
const items = Array.from(scope.querySelectorAll('[role="menuitem"]'));
const labels = items.map((item) => item.textContent);
const item = items.find((entry) => entry.textContent.startsWith(arguments[1]));
if (!item) return { ok: false, error: 'no item', labels };
if (item.getAttribute('aria-disabled') === 'true') return { ok: false, error: 'disabled', labels };
item.click();
return { ok: true, labels };
"#;

async fn send(tab: &Tab, scope: &str, item: &str) -> Result<()> {
    let result: Value = tab.js(SEND_JS, json!([scope, item])).await?;
    ensure!(result["ok"] == true, "send via {scope} / {item}: {result}");
    Ok(())
}

async fn active_tool(tab: &Tab) -> Result<String> {
    tab.eval("document.querySelector('button[data-tool].active')?.dataset.tool || ''").await
}

fn afsk(text: &str) -> Vec<f64> {
    let data: Vec<u8> = std::iter::repeat(0xABu8).take(16).chain(text.bytes()).collect();
    let bits: Vec<u8> = data.iter().flat_map(|byte| (0..8).map(move |i| (byte >> i) & 1)).collect();
    let rate = RATE as f64;
    let mut phase = 0.0;
    (0..(bits.len() as f64 * rate / BAUD) as usize)
        .map(|n| {
            let bit = bits[((n as f64 * BAUD / rate) as usize).min(bits.len() - 1)];
            phase += 2.0 * PI * if bit == 1 { 2083.3333333333335 } else { 1562.5 } / rate;
            0.3 * phase.sin()
        })
        .collect()
}

fn header_wav() -> Result<std::path::PathBuf> {
    let silence = vec![0.0; RATE as usize];
    let burst = afsk(HEADER);
    let samples: Vec<f64> = [&silence, &burst, &silence, &burst, &silence, &burst, &silence]
        .iter()
        .flat_map(|part| part.iter().copied())
        .collect();
    let mut bytes = Vec::with_capacity(44 + samples.len() * 2);
    let data_len = (samples.len() * 2) as u32;
    bytes.extend_from_slice(b"RIFF");
    bytes.extend_from_slice(&(36 + data_len).to_le_bytes());
    bytes.extend_from_slice(b"WAVEfmt ");
    bytes.extend_from_slice(&16u32.to_le_bytes());
    bytes.extend_from_slice(&1u16.to_le_bytes());
    bytes.extend_from_slice(&1u16.to_le_bytes());
    bytes.extend_from_slice(&RATE.to_le_bytes());
    bytes.extend_from_slice(&(RATE * 2).to_le_bytes());
    bytes.extend_from_slice(&2u16.to_le_bytes());
    bytes.extend_from_slice(&16u16.to_le_bytes());
    bytes.extend_from_slice(b"data");
    bytes.extend_from_slice(&data_len.to_le_bytes());
    for s in samples {
        bytes.extend_from_slice(&((s * 32767.0).round() as i16).to_le_bytes());
    }
    temp_file("handoff_header.wav", &bytes)
}

async fn wait_decoded(tab: &Tab) -> Result<()> {
    tab.wait_until(
        &format!("document.getElementById('output').innerText.split({HEADER:?}).length > 3"),
        Duration::from_secs(90),
    )
    .await
}

/// Decodes the synthetic header and opens its alert modal, marking the page so a reload shows.
async fn open_decoded_alert(tab: &Tab) -> Result<()> {
    open_tool(tab, "decoder").await?;
    tab.exec("document.getElementById('output').innerHTML = ''; window.__samePage = true;", json!([])).await?;
    tab.set_files("#audiofile", &[header_wav()?]).await?;
    wait_decoded(tab).await?;
    tab.exec("document.querySelector('#output .alert button').click();", json!([])).await?;
    tab.wait_until("!!document.querySelector('#modal-info .send-menu__button')", Duration::from_secs(10)).await
}

async fn generate_alert(tab: &Tab) -> Result<()> {
    generate_alert_as(tab, "DEFAULT").await
}

async fn generate_alert_as(tab: &Tab, endec_mode: &str) -> Result<()> {
    open_tool_tracking_errors(tab, "encoder").await?;
    set_field(tab, "#encoderMode", "header").await?;
    set_field(tab, "#cheader", HEADER).await?;
    set_field(tab, "#overallEndecMode", endec_mode).await?;
    set_field(tab, "#announcementType", "none").await?;
    generate(tab, "handoff").await
}

pub fn cases() -> Vec<Case> {
    let mut cases: Vec<Case> = [("TFT", "TFT"), ("HOLLYANNE", "HOLLYANNE"), ("DASDEC", "DASDEC")]
        .into_iter()
        .map(|(mode, expected)| {
            // These ENDECs differ from DEFAULT only in the sample rate the encoder emulates, so the
            // handoff has to carry the emulated-rate audio (as the download does) for the decoder
            // to tell them apart.
            case(format!("encoder_handoff_keeps_the_endec_sample_rate[{mode}]"), move |tab| async move {
                generate_alert_as(&tab, mode).await?;
                let emulating: bool = tab.eval("document.getElementById('endecResample').checked").await?;
                ensure!(emulating, "ENDEC rate emulation should be on by default");
                tab.exec("window.endecDebug = true; window.endecDebugHistory = []; window.lastEndecDebug = null;", json!([])).await?;
                send(&tab, "#encoderSendMenu", "Decoder").await?;
                tab.wait_until("!!(window.lastEndecDebug && window.lastEndecDebug.mode)", Duration::from_secs(90)).await?;
                let record: Value = tab.eval("window.lastEndecDebug").await?;
                ensure!(record["mode"] == expected, "expected {expected}: {} via {} {}", record["mode"], record["rule"], record["segments"]);
                Ok(())
            })
        })
        .collect();
    cases.extend(cases_without_endec_rates());
    cases
}

fn cases_without_endec_rates() -> Vec<Case> {
    vec![
        case("decoder_alert_opens_in_the_encoder_without_a_reload", |tab| async move {
            open_decoded_alert(&tab).await?;
            send(&tab, "#modal-info", "SAME Encoder (header)").await?;
            wait_for_tool(&tab, "encoder").await?;
            tab.wait_until(&format!("document.getElementById('cheader').value === {HEADER:?}"), Duration::from_secs(10)).await?;
            let state: Value = tab
                .eval(
                    "({ same: window.__samePage === true, mode: window.mode, select: document.getElementById('encoderMode').value,
                        shown: getComputedStyle(document.getElementById('stringEncoder')).display !== 'none',
                        modal: window.modalShown })",
                )
                .await?;
            ensure!(state["same"] == true, "the page reloaded: {state}");
            ensure!(state["mode"] == "header" && state["select"] == "header" && state["shown"] == true, "{state}");
            ensure!(state["modal"] == false, "the alert modal stayed open: {state}");
            Ok(())
        }),
        case("decoder_alert_opens_in_the_crawl_header_mode", |tab| async move {
            open_decoded_alert(&tab).await?;
            send(&tab, "#modal-info", "Text Crawl Generator (header)").await?;
            wait_for_tool(&tab, "crawl").await?;
            tab.wait_until(
                &format!("document.getElementById('crawlRawHeader').value === {HEADER:?} && document.getElementById('crawlMode').value === 'header'"),
                Duration::from_secs(20),
            )
            .await?;
            tab.wait_until("/TORNADO/i.test(window.crawlGenerator.getCrawlText() || '')", Duration::from_secs(20)).await?;
            Ok(())
        }),
        case("decoder_audio_opens_in_the_splicer", |tab| async move {
            open_decoded_alert(&tab).await?;
            send(&tab, "#modal-info", "Audio Splicer (decoded audio)").await?;
            wait_for_tool(&tab, "splicer").await?;
            tab.wait_until("!document.querySelector('[data-splice-export]').disabled", Duration::from_secs(30)).await?;
            Ok(())
        }),
        case("encoder_alert_decodes_in_the_decoder", |tab| async move {
            generate_alert(&tab).await?;
            send(&tab, "#encoderSendMenu", "Decoder").await?;
            ensure!(active_tool(&tab).await? == "decoder", "the decoder tab did not open");
            wait_decoded(&tab).await?;
            Ok(())
        }),
        case("encoder_alert_opens_on_splicer_tracks", |tab| async move {
            generate_alert(&tab).await?;
            send(&tab, "#encoderSendMenu", "Audio Splicer").await?;
            wait_for_tool(&tab, "splicer").await?;
            tab.wait_until(
                "/Opened the alert from the Encoder: [1-9]/.test(document.querySelector('[data-splice-persist]').textContent)",
                Duration::from_secs(60),
            )
            .await?;
            Ok(())
        }),
        case("header_query_param_selects_header_mode", |tab| async move {
            tab.goto(&format!("index.html?tool=encoder&header={}", HEADER.replace('+', "%2B"))).await?;
            wait_for_tool(&tab, "encoder").await?;
            let state: Value = tab
                .eval("({ mode: window.mode, header: document.getElementById('cheader').value, shown: getComputedStyle(document.getElementById('stringEncoder')).display !== 'none' })")
                .await?;
            ensure!(state["mode"] == "header" && state["header"] == HEADER && state["shown"] == true, "{state}");
            Ok(())
        }),
        case("normalizer_output_becomes_encoder_tts_text", |tab| async move {
            open_tool(&tab, "normalizer").await?;
            tab.exec(
                "window.normalizerEditor.setValue(arguments[0]);
                 document.getElementById('normalizeButton').click();",
                json!([PRODUCT]),
            )
            .await?;
            let normalized: String = tab.eval("document.getElementById('normalizedProduct').textContent.trim()").await?;
            ensure!(!normalized.is_empty(), "the normalizer produced nothing");
            send(&tab, "#normalizer-panel", "SAME Encoder").await?;
            wait_for_tool(&tab, "encoder").await?;
            tab.wait_until(
                &format!("window.encoderEditor.getValue() === {normalized:?} && window.ttsText === {normalized:?} && document.getElementById('announcementType').value === 'tts'"),
                Duration::from_secs(20),
            )
            .await?;
            Ok(())
        }),
        case("typing_in_other_tools_leaves_the_encoder_tts_text_alone", |tab| async move {
            open_tool(&tab, "encoder").await?;
            tab.exec("window.encoderEditor.setValue('encoder text');", json!([])).await?;
            tab.exec("document.getElementById('tab-normalizer').click();", json!([])).await?;
            wait_for_tool(&tab, "normalizer").await?;
            tab.exec("window.normalizerEditor.setValue('normalizer text');", json!([])).await?;
            tab.exec("document.getElementById('tab-phoneme').click();", json!([])).await?;
            wait_for_tool(&tab, "phoneme").await?;
            tab.wait_until("!!window.phonemeEditor", Duration::from_secs(20)).await?;
            tab.exec("window.phonemeEditor.setValue('phoneme text');", json!([])).await?;
            let text: String = tab.eval("window.ttsText").await?;
            ensure!(text == "encoder text", "window.ttsText became {text:?}");
            Ok(())
        }),
        case("send_menu_is_keyboard_operable", |tab| async move {
            open_tool(&tab, "normalizer").await?;
            tab.focus("#normalizer-panel .send-menu__button").await?;
            tab.press("ArrowDown", &[]).await?;
            let opened: Value = tab
                .eval(
                    "(() => { const b = document.querySelector('#normalizer-panel .send-menu__button');
                     return { expanded: b.getAttribute('aria-expanded'), focused: document.activeElement.getAttribute('role'),
                              disabled: document.activeElement.getAttribute('aria-disabled'), text: document.activeElement.textContent }; })()",
                )
                .await?;
            ensure!(opened["expanded"] == "true" && opened["focused"] == "menuitem", "{opened}");
            ensure!(opened["disabled"] == "true", "an empty normalizer should not offer a send: {opened}");
            tab.press("ArrowDown", &[]).await?;
            tab.press("Escape", &[]).await?;
            let closed: Value = tab
                .eval(
                    "(() => { const b = document.querySelector('#normalizer-panel .send-menu__button');
                     return { expanded: b.getAttribute('aria-expanded'), back: document.activeElement === b, tool: document.querySelector('button[data-tool].active').dataset.tool }; })()",
                )
                .await?;
            ensure!(closed["expanded"] == "false" && closed["back"] == true && closed["tool"] == "normalizer", "{closed}");
            Ok(())
        }),
        case("warngen_stays_loaded_across_tab_switches", |tab| async move {
            open_tool(&tab, "warngen").await?;
            tab.wait_until(
                // The iframe's initial about:blank document is also 'complete', so wait for WarnGen's own.
                "(() => { const f = document.querySelector('#warngen-container iframe'); const d = f && f.contentDocument;
                   return !!d && /\\/warngen\\/(index\\.html)?$/.test(d.location.pathname) && d.readyState === 'complete'; })()",
                Duration::from_secs(30),
            )
            .await?;
            tab.exec("document.querySelector('#warngen-container iframe').contentWindow.__kept = true; document.getElementById('tab-decoder').click();", json!([])).await?;
            tab.exec("document.getElementById('tab-warngen').click();", json!([])).await?;
            let kept: bool = tab.eval("document.querySelector('#warngen-container iframe')?.contentWindow.__kept === true").await?;
            ensure!(kept, "the WarnGen iframe was reloaded");
            // The menu attaches once the parent's handoff.js import lands, which may trail the iframe's load.
            tab.wait_until(
                "!!document.querySelector('#warngen-container iframe').contentDocument.querySelector('.send-menu:not([hidden]) .send-menu__button')",
                Duration::from_secs(10),
            )
            .await
            .context("WarnGen has no Send to… menu")?;
            Ok(())
        }),
        case("warngen_product_resolves_to_a_header_in_the_encoder", |tab| async move {
            open_tool(&tab, "warngen").await?;
            tab.wait_until(
                "(() => { const f = document.querySelector('#warngen-container iframe'); return !!f && !!f.contentDocument && !!f.contentDocument.querySelector('.send-menu__button'); })()",
                Duration::from_secs(30),
            )
            .await?;
            let result: Value = tab
                .js(
                    "const frame = document.querySelector('#warngen-container iframe');
                     frame.contentWindow.lastFormattedOutput = arguments[0];
                     const doc = frame.contentDocument;
                     doc.querySelector('.send-menu__button').click();
                     const item = Array.from(doc.querySelectorAll('[role=\"menuitem\"]')).find((e) => e.textContent.startsWith('SAME Encoder'));
                     if (!item) return { ok: false };
                     item.click();
                     return { ok: true };",
                    json!([PRODUCT]),
                )
                .await?;
            ensure!(result["ok"] == true, "{result}");
            wait_for_tool(&tab, "encoder").await?;
            tab.wait_until("/^ZCZC-WXR-TOR-029095\\+/.test(document.getElementById('headerPreview').textContent)", Duration::from_secs(20))
                .await?;
            Ok(())
        }),
    ]
}
