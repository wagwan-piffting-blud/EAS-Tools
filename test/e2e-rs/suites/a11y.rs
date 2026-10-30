//! axe-core baseline: no critical/serious violations on each tool panel, the document-level
//! structure of index.html, or the static pages. A baseline only; it cannot judge alt text,
//! keyboard behavior or live-region timing.

use eas_tools_e2e::*;

const MAIN_TOOLS: [&str; 6] = ["decoder", "encoder", "crawl", "splicer", "phoneme", "normalizer"];
const STATIC_PAGES: [&str; 4] = ["faq.html", "tts-docs.html", "credits.html", "changelog.html"];

/// Rules demoted because the violation lives in vendored markup: CodeMirror 5's dracula gutter
/// contrast and its hidden-textarea scroll region on tts-docs.html.
fn allowlist(page: &str) -> &'static [&'static str] {
    match page {
        "tts-docs.html" => &["color-contrast", "scrollable-region-focusable"],
        _ => &[],
    }
}

pub fn cases() -> Vec<Case> {
    let mut cases = Vec::new();
    for tool in MAIN_TOOLS {
        cases.push(case(format!("main_app_tab_a11y_baseline[{tool}]"), move |tab| async move {
            tab.goto(&format!("index.html?tool={tool}")).await?;
            tab.click(&format!("button[data-tool=\"{tool}\"]")).await?;
            tab.wait_until(&format!("document.getElementById('{tool}-panel').classList.contains('active')"), Duration::from_secs(25))
                .await?;
            // Inactive panels are display:none and unreachable, so only the active one is checked.
            axe::assert_clean(&tab, json!(format!("#{tool}-panel")), &[], &format!("tool={tool}")).await
        }));
    }
    cases.push(case("main_app_global_landmarks_a11y", |tab| async move {
        tab.goto("index.html?tool=decoder").await?;
        let options = json!({
            "runOnly": { "type": "tag", "values": ["cat.structure", "cat.language", "cat.aria"] },
            "resultTypes": ["violations"],
        });
        let violations = axe::failing_with(&tab, Value::Null, options, &[]).await?;
        ensure!(violations.is_empty(), "{}", axe::describe(&violations, "global"));
        Ok(())
    }));
    for page in STATIC_PAGES {
        cases.push(case(format!("static_pages_a11y_baseline[{page}]"), move |tab| async move {
            tab.goto(page).await?;
            axe::assert_clean(&tab, Value::Null, allowlist(page), page).await
        }));
    }
    cases
}
