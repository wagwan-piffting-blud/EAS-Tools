//! The crawl canvas is handed even dimensions because the GIF and WebM encoders need them.
//! That rounding used to run on every `input` event and write the result straight back into
//! the field, so a keystroke of "1" became "2" and typing 1920 one character at a time ended
//! up as 3020. It only bit once a crawl was running, because the rewrite lived behind a
//! generator check.

use eas_tools_e2e::*;

use crate::common::open_tool;

const START_CRAWL: &str = "
const mode = document.getElementById('crawlMode');
if (mode) { mode.value = 'text'; mode.dispatchEvent(new Event('change', { bubbles: true })); }
const text = document.getElementById('crawlText');
text.value = 'THIS IS A TEST OF THE EMERGENCY ALERT SYSTEM.';
text.dispatchEvent(new Event('input', { bubbles: true }));
text.dispatchEvent(new Event('change', { bubbles: true }));
const font = document.getElementById('crawlFontFamily');
if (font) { font.value = 'Arial'; font.dispatchEvent(new Event('change', { bubbles: true })); }";

/// The font list is populated asynchronously and the default selection asks for an uploaded
/// font file, so wait for Arial before pinning the font.
async fn running_crawl(tab: &Tab) -> Result<()> {
    open_tool(tab, "crawl").await?;
    tab.wait_for_selector("#crawlFontFamily option[value=\"Arial\"]", Duration::from_secs(30)).await?;
    tab.exec(START_CRAWL, json!([])).await?;
    let font: String = tab.eval("document.getElementById('crawlFontFamily').value").await?;
    ensure!(font == "Arial", "font is {font}");
    tab.wait_until("!!window.crawlGenerator", Duration::from_secs(30)).await
}

async fn field(tab: &Tab, id: &str) -> Result<String> {
    tab.js("return document.getElementById(arguments[0]).value;", json!([id])).await
}

/// Focuses the field the way a click would and clears it with select-all + Delete.
async fn retype(tab: &Tab, id: &str) -> Result<()> {
    tab.click(&format!("#{id}")).await?;
    tab.exec("document.getElementById(arguments[0]).select();", json!([id])).await?;
    tab.press("Delete", &[]).await
}

async fn type_one_char_at_a_time(tab: &Tab, id: &str, typed: &str) -> Result<()> {
    for (index, ch) in typed.chars().enumerate() {
        tab.press(&ch.to_string(), &[]).await?;
        let expected = &typed[..=index];
        let actual = field(tab, id).await?;
        ensure!(
            actual == expected,
            "after typing {expected:?} the field read {actual:?}; the even-number rounding is running while the user is still typing"
        );
    }
    Ok(())
}

pub fn cases() -> Vec<Case> {
    let mut cases = vec![
        case("an_odd_dimension_is_rounded_when_the_field_is_committed", |tab| async move {
            running_crawl(&tab).await?;
            retype(&tab, "crawlWidth").await?;
            type_one_char_at_a_time(&tab, "crawlWidth", "801").await?;
            tab.press("Tab", &[]).await?;
            tab.wait_until("document.getElementById('crawlWidth').value === '802'", Duration::from_secs(10)).await?;
            let width: i64 = tab.eval("window.crawlGenerator.canvas.width").await?;
            ensure!(width == 802, "canvas width {width}");
            Ok(())
        }),
        case("a_single_digit_survives_until_the_field_is_committed", |tab| async move {
            running_crawl(&tab).await?;
            retype(&tab, "crawlWidth").await?;
            type_one_char_at_a_time(&tab, "crawlWidth", "1").await?;
            tab.press("Tab", &[]).await?;
            tab.wait_until("document.getElementById('crawlWidth').value === '2'", Duration::from_secs(10)).await
        }),
        case("dimensions_commit_the_same_way_before_the_crawl_animates", |tab| async move {
            open_tool(&tab, "crawl").await?;
            tab.wait_until("!!window.crawlGenerator", Duration::from_secs(30)).await?;
            let animating: bool = tab.eval("window.crawlGenerator.isAnimating").await?;
            ensure!(!animating, "the crawl should sit paused after load");
            retype(&tab, "crawlWidth").await?;
            type_one_char_at_a_time(&tab, "crawlWidth", "1").await?;
            tab.press("Tab", &[]).await?;
            ensure!(field(&tab, "crawlWidth").await? == "2");
            Ok(())
        }),
    ];
    for (id, typed) in [("crawlWidth", "1920"), ("crawlHeight", "1080"), ("crawlWidth", "640")] {
        cases.push(case(format!("typing_a_dimension_is_not_rewritten_mid_keystroke[{id}-{typed}]"), move |tab| async move {
            running_crawl(&tab).await?;
            retype(&tab, id).await?;
            type_one_char_at_a_time(&tab, id, typed).await?;
            ensure!(field(&tab, id).await? == typed);
            Ok(())
        }));
    }
    cases
}
