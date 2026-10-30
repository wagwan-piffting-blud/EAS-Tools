//! The crawl's Override Sender ID replaces the header's sender (issue #110).
//!
//! Headers typed into the old Atari 800XL program often carry a sender like "Channel 4 EASNet",
//! which is not SAME-legal; with an override set they must still render.

use eas_tools_e2e::*;

use crate::common::open_tool;

const LEGAL: &str = "ZCZC-WXR-SVA-039045-039073-039129+0300-2521800-KEPZ/NWS-";
const ILLEGAL_SENDER: &str = "ZCZC-WXR-SVA-039045-039073-039129+0300-2521800-Channel 4 EASNet-";

const BUILD_AND_COPY_JS: &str = r#"
const done = arguments[arguments.length - 1];
const header = arguments[0];
const sender = arguments[1];
(async () => {
    try {
        const set = (id, value, type) => {
            const el = document.getElementById(id);
            el.value = value;
            el.dispatchEvent(new Event(type, { bubbles: true }));
        };
        window.__dasdecBackground = null;
        set('crawlMode', 'header', 'change');
        set('crawlOverrideSender', sender, 'input');
        set('crawlRawHeader', header, 'input');
        set('crawlBackgroundMode', 'premade', 'change');
        set('crawlBackgroundPremadeSelect', 'atari:atari_800xl', 'change');

        const deadline = Date.now() + 25000;
        while (Date.now() < deadline) {
            const bg = window.__dasdecBackground;
            if (bg && Array.isArray(bg.pages) && bg.pages.length === 2) break;
            await new Promise((resolve) => setTimeout(resolve, 25));
        }

        let copied = null;
        const original = navigator.clipboard.writeText.bind(navigator.clipboard);
        navigator.clipboard.writeText = (text) => { copied = text; return Promise.resolve(); };
        try {
            document.getElementById('copyCrawlText').click();
            const until = Date.now() + 15000;
            while (Date.now() < until && copied === null) {
                await new Promise((resolve) => setTimeout(resolve, 25));
            }
        } finally {
            navigator.clipboard.writeText = original;
        }
        done({ ok: copied !== null, text: copied });
    } catch (error) {
        done({ ok: false, error: String(error) });
    }
})();
"#;

async fn screen_lines(tab: &Tab, header: &str, sender: &str) -> Result<Vec<String>> {
    open_tool(tab, "crawl").await?;
    let result: Value = tab.js_async(BUILD_AND_COPY_JS, json!([header, sender])).await?;
    ensure!(result["ok"] == true, "{result}");
    Ok(result["text"].as_str().unwrap_or_default().split('\n').filter(|l| !l.trim().is_empty()).map(str::to_string).collect())
}

pub fn cases() -> Vec<Case> {
    vec![
        case("an_illegal_sender_renders_once_overridden", |tab| async move {
            let lines = screen_lines(&tab, ILLEGAL_SENDER, "Channel 4 EASNet").await?;
            ensure!(lines.join(" ").contains("SEVERE THUNDERSTORM WATCH"), "{lines:?}");
            ensure!(lines.last().map(String::as_str) == Some("CHANNEL 4 EASNET"), "{lines:?}");
            Ok(())
        }),
        case("the_override_replaces_a_legal_sender", |tab| async move {
            let lines = screen_lines(&tab, LEGAL, "WAGS TV").await?;
            ensure!(lines.last().map(String::as_str) == Some("WAGS TV"), "{lines:?}");
            Ok(())
        }),
        case("a_blank_override_keeps_the_header_sender", |tab| async move {
            let lines = screen_lines(&tab, LEGAL, "").await?;
            ensure!(lines.last().map(String::as_str) == Some("KEPZ/NWS"), "{lines:?}");
            Ok(())
        }),
    ]
}
