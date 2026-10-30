//! The EASyPLUS screen prints the event name straight from the SAME event table. A rewrite in
//! the crawl bundle used to shorten a leading "National Emergency" to "Emergency", so an EAN
//! rendered as "Emergency Message" while every other part of the site called it "National
//! Emergency Message".
//!
//! The grey EASyPLUS layout drops the crawl 100px lower when the event name wraps onto a second
//! line, which makes the rendered string observable from the DOM.

use eas_tools_e2e::*;

use crate::common::open_tool;

const EVENT_LABELS: [(&str, &str); 5] = [
    ("EAN", "National Emergency Message"),
    ("EAT", "Emergency Action Termination"),
    ("NPT", "National Periodic Test"),
    ("NIC", "National Information Center"),
    ("TOR", "Tornado Warning"),
];
const SINGLE_LINE: &str = "720";
const TWO_LINE: &str = "820";
const WRAPPING: [(&str, &str); 4] = [("EAN", TWO_LINE), ("EAT", TWO_LINE), ("TOR", SINGLE_LINE), ("NPT", SINGLE_LINE)];

async fn open(tab: &Tab) -> Result<()> {
    open_tool(tab, "crawl").await?;
    tab.wait_for_selector("#easyplusEventCode option[value=\"EAN\"]", Duration::from_secs(30)).await
}

pub fn cases() -> Vec<Case> {
    let mut cases = vec![case("ean_is_not_shortened_to_emergency_message", |tab| async move {
        open(&tab).await?;
        let label: Option<String> = tab.eval("window.events ? window.events.EAN : null").await?;
        ensure!(label.as_deref() == Some("National Emergency Message"), "the EASyPLUS event name is shortened: {label:?}");
        Ok(())
    })];
    for (code, expected) in EVENT_LABELS {
        cases.push(case(format!("event_table_label[{code}]"), move |tab| async move {
            open(&tab).await?;
            let label: Option<String> = tab
                .js(
                    "const o = document.querySelector('#easyplusEventCode option[value=\"' + arguments[0] + '\"]');
                     return o ? o.textContent.trim() : null;",
                    json!([code]),
                )
                .await?;
            ensure!(label.as_deref() == Some(expected), "{code}: {label:?}");
            Ok(())
        }));
    }
    for (code, expected_y) in WRAPPING {
        cases.push(case(format!("easyplus_layout_reflects_the_full_event_name[{code}]"), move |tab| async move {
            open(&tab).await?;
            tab.exec(
                "const mode = document.getElementById('crawlBackgroundMode');
                 mode.value = 'premade';
                 mode.dispatchEvent(new Event('change', { bubbles: true }));
                 const premade = document.getElementById('crawlBackgroundPremadeSelect');
                 premade.value = 'easyplus:easyplus_gray';
                 premade.dispatchEvent(new Event('change', { bubbles: true }));",
                json!([]),
            )
            .await?;
            tab.wait_until("document.getElementById('crawlTopLeftPixelY').value !== '0'", Duration::from_secs(20)).await?;
            tab.exec(
                "const event = document.getElementById('easyplusEventCode');
                 event.value = arguments[0];
                 event.dispatchEvent(new Event('change', { bubbles: true }));
                 document.getElementById('crawlBackgroundPremadeSelect').dispatchEvent(new Event('change', { bubbles: true }));",
                json!([code]),
            )
            .await?;
            let actual: String = tab
                .wait_for("document.getElementById('crawlTopLeftPixelY').value", Duration::from_secs(20), |v: &String| {
                    v == SINGLE_LINE || v == TWO_LINE
                })
                .await?;
            ensure!(
                actual == expected_y,
                "{code} rendered with the {} EASyPLUS layout; the event name reaching the renderer is the wrong length",
                if actual == SINGLE_LINE { "single-line" } else { "two-line" }
            );
            Ok(())
        }));
    }
    cases
}
