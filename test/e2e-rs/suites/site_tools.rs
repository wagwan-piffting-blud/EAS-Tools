//! Smoke tests across the tools: tab switching, phoneme conversion, the decoder's raw-header
//! flow, an encoder header-mode render and the crawl's header mode.

use eas_tools_e2e::*;

use crate::common::{generate, open_tool, set_field, status_text, wait_for_dialog};

const VALID_HEADER: &str = "ZCZC-WXR-SVR-010001+0030-0010600-KNHC/NWS-";
const INVALID_HEADER: &str = "INVALID HEADER";

async fn stub_prompt(tab: &Tab, value: &str) -> Result<()> {
    tab.exec("window.__testPromptValue = arguments[0]; window.prompt = () => window.__testPromptValue;", json!([value])).await
}

async fn crawl_header_mode(tab: &Tab, header: &str) -> Result<()> {
    set_field(tab, "#crawlMode", "header").await?;
    tab.wait_until("getComputedStyle(document.getElementById('crawlRawHeader')).display !== 'none'", Duration::from_secs(30)).await?;
    tab.wait_until(
        "(() => {
            const sel = document.getElementById('crawlFontFamily');
            if (!sel || !sel.options || !sel.options.length) return false;
            const fallback = Array.from(sel.options).find((o) => o.value && o.value !== 'User-Upload');
            if (!fallback) return false;
            sel.value = fallback.value;
            sel.dispatchEvent(new Event('input', { bubbles: true }));
            sel.dispatchEvent(new Event('change', { bubbles: true }));
            return sel.value;
        })()",
        Duration::from_secs(25),
    )
    .await?;
    let font: String = tab.eval("document.getElementById('crawlFontFamily')?.value || ''").await?;
    ensure!(font != "User-Upload", "crawlFontFamily is still User-Upload");
    set_field(tab, "#crawlRawHeader", header).await
}

pub fn cases() -> Vec<Case> {
    vec![
        case("tab_navigation_updates_active_panel_and_query", |tab| async move {
            open_tool(&tab, "decoder").await?;
            for tool in ["decoder", "encoder", "crawl", "splicer", "phoneme", "muxer"] {
                tab.click(&format!("button[data-tool=\"{tool}\"]")).await?;
                tab.wait_until(&format!("document.getElementById('{tool}-panel').classList.contains('active')"), Duration::from_secs(25))
                    .await?;
                let query: Option<String> = tab.eval("new URLSearchParams(location.search).get('tool')").await?;
                ensure!(query.as_deref() == Some(tool), "?tool= is {query:?} after clicking {tool}");
            }
            tab.wait_for_selector("#muxer-container iframe[src='muxer.html']", Duration::from_secs(25)).await
        }),
        case("phoneme_convert_produces_expected_markup", |tab| async move {
            open_tool(&tab, "phoneme").await?;
            set_field(&tab, "#phonemeOutBackend", "vtml").await?;
            set_field(&tab, "#phonemeText", "tornado").await?;
            tab.click("#phonemeConvert").await?;
            let output: String = tab
                .wait_for("document.getElementById('phonemeOutput').innerText.trim()", Duration::from_secs(25), |t: &String| !t.is_empty())
                .await?;
            ensure!(!output.starts_with("[ERROR]"), "{output}");
            ensure!(output.contains("<vtml_phoneme"), "{output}");
            let ph = output.split("ph=\"").nth(1).and_then(|r| r.split('"').next()).unwrap_or_default();
            ensure!(!ph.is_empty() && ph.chars().all(|c| c.is_ascii_uppercase() || ('0'..='2').contains(&c) || c == ' '), "{output}");
            Ok(())
        }),
        case("decoder_raw_header_flow_shows_alert_modal", |tab| async move {
            open_tool(&tab, "decoder").await?;
            stub_prompt(&tab, VALID_HEADER).await?;
            tab.click("button[data-decoder-load-raw]").await?;
            tab.wait_until(&format!("document.getElementById('output').innerText.includes({})", json!(VALID_HEADER)), Duration::from_secs(25))
                .await?;
            let found: bool = tab
                .eval(
                    "(() => {
                        const b = Array.from(document.querySelectorAll('#output button')).find((el) => el.innerText.trim() === 'View Alert');
                        if (b) b.setAttribute('data-test-view-alert', '');
                        return !!b;
                    })()",
                )
                .await?;
            ensure!(found, "no View Alert button in the output");
            tab.click("[data-test-view-alert]").await?;
            tab.wait_until("getComputedStyle(document.querySelector('.modalContainer')).display !== 'none'", Duration::from_secs(25)).await?;
            tab.wait_until("document.querySelector('.modalInfo').innerText.includes('Severity:')", Duration::from_secs(25)).await?;
            let modal: String = tab.eval("document.querySelector('.modalInfo').innerText").await?;
            ensure!(modal.contains("Human-Readable Alert Text:"), "{modal}");
            ensure!(modal.contains("Send alert to…"), "{modal}");
            Ok(())
        }),
        case("encoder_header_mode_generates_audio_and_status", |tab| async move {
            open_tool(&tab, "encoder").await?;
            set_field(&tab, "#encoderMode", "header").await?;
            tab.wait_until("getComputedStyle(document.getElementById('stringEncoder')).display !== 'none'", Duration::from_secs(60)).await?;
            set_field(&tab, "#announcementType", "none").await?;
            set_field(&tab, "#att", "3").await?;
            set_field(&tab, "#cheader", VALID_HEADER).await?;
            generate(&tab, "header mode").await?;
            let status = status_text(&tab).await?;
            ensure!(status.contains("Generated header:") && status.contains(VALID_HEADER), "{status}");
            tab.wait_until("document.getElementById('audioPlayback').src.startsWith('blob:')", Duration::from_secs(60)).await
        }),
        case("crawl_header_mode_builds_generator_with_text", |tab| async move {
            open_tool(&tab, "crawl").await?;
            crawl_header_mode(&tab, VALID_HEADER).await?;
            let waited = tab
                .wait_until(
                    "window.crawlGenerator && typeof window.crawlGenerator.getCrawlText === 'function'
                     && window.crawlGenerator.getCrawlText().trim().length > 0",
                    Duration::from_secs(30),
                )
                .await;
            if let Some(dialog) = tab.dialogs().first() {
                bail!("unexpected alert while starting the crawl: {dialog}");
            }
            waited
        }),
        case("decoder_invalid_raw_header_shows_validation_alert", |tab| async move {
            open_tool(&tab, "decoder").await?;
            stub_prompt(&tab, INVALID_HEADER).await?;
            let before = tab.dialogs().len();
            tab.click("button[data-decoder-load-raw]").await?;
            let message = wait_for_dialog(&tab, before).await?;
            ensure!(message.contains("Invalid SAME header format"), "{message}");
            Ok(())
        }),
        case("crawl_invalid_header_shows_validation_alert", |tab| async move {
            open_tool(&tab, "crawl").await?;
            crawl_header_mode(&tab, INVALID_HEADER).await?;
            tab.wait_until("document.getElementById('status-crawl').innerText.includes('not a valid EAS header')", Duration::from_secs(25))
                .await
        }),
        // #150: phones have no Ctrl+A and iOS offers no Select All in CodeMirror's editor.
        case("splicer_clear_text_empties_the_tts_box_and_can_be_undone", |tab| async move {
            open_tool(&tab, "splicer").await?;
            tab.wait_until("!!window.splicerEditor && !!document.querySelector('[data-splice-tts-clear]')", Duration::from_secs(30))
                .await?;
            tab.exec("window.splicerEditor.setValue('THIS IS A TEST\\nOF THE EMERGENCY ALERT SYSTEM');", json!([])).await?;
            tab.click("[data-splice-tts-clear]").await?;
            let cleared: Value = tab
                .eval("({ editor: window.splicerEditor.getValue(), textarea: document.getElementById('ttsText2').value })")
                .await?;
            ensure!(cleared["editor"] == "" && cleared["textarea"] == "", "Clear Text left {cleared}");
            tab.exec("window.splicerEditor.undo();", json!([])).await?;
            let restored: String = tab.eval("window.splicerEditor.getValue()").await?;
            ensure!(restored == "THIS IS A TEST\nOF THE EMERGENCY ALERT SYSTEM", "undo gave {restored:?}");
            Ok(())
        }),
    ]
}
