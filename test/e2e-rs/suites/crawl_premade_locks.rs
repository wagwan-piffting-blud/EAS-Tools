//! Each pre-made background drives a different subset of the geometry fields, so only the
//! ones it actually writes are locked. The easyplus backgrounds are rendered rather than
//! loaded from an image, so they set the crawl origin but leave the canvas size to the user.

use std::collections::BTreeSet;

use eas_tools_e2e::*;

use crate::common::open_tool;

const LOCKABLE: [&str; 5] = ["crawlWidth", "crawlHeight", "crawlInset", "crawlTopLeftPixelX", "crawlTopLeftPixelY"];
const SIZE_AND_ORIGIN: &[&str] = &["crawlWidth", "crawlHeight", "crawlTopLeftPixelX", "crawlTopLeftPixelY"];
const ORIGIN: &[&str] = &["crawlTopLeftPixelX", "crawlTopLeftPixelY"];

const EXPECTED_LOCKS: [(&str, &[&str]); 9] = [
    ("atari:atari_800xl", SIZE_AND_ORIGIN),
    ("dasdec:dasdec", SIZE_AND_ORIGIN),
    ("dasdec:dasdec_black", SIZE_AND_ORIGIN),
    ("dasdec:dasdec_blue", SIZE_AND_ORIGIN),
    ("easyplus:easyplus", ORIGIN),
    ("easyplus:easyplus_gray", ORIGIN),
    ("gorman:eas_1cg", SIZE_AND_ORIGIN),
    ("image:assets/screens/directv.jpg", SIZE_AND_ORIGIN),
    ("image:assets/screens/xfinity.png", SIZE_AND_ORIGIN),
];

const SET_BACKGROUND_MODE: &str = "
const mode = document.getElementById('crawlBackgroundMode');
mode.value = arguments[0];
mode.dispatchEvent(new Event('change', { bubbles: true }));";

const SELECT_PREMADE: &str = "
const select = document.getElementById('crawlBackgroundPremadeSelect');
select.value = arguments[0];
select.dispatchEvent(new Event('change', { bubbles: true }));";

const READ_STATE: &str = "
const out = { locked: [], values: {} };
for (const id of arguments[0]) {
    const el = document.getElementById(id);
    if (!el) continue;
    if (el.disabled) out.locked.push(id);
    out.values[id] = el.value;
}
const note = document.getElementById('crawlPremadeLockNote');
out.noteVisible = note ? !note.hidden : null;
return out;";

/// The top-left pair is also greyed out by its own "Position the crawl manually" checkbox,
/// so tests about the pre-made locks turn that checkbox on first.
const ENABLE_MANUAL_TOP_LEFT: &str = "
const toggle = document.getElementById('crawlTopLeftManual');
if (!toggle || toggle.disabled) return false;
toggle.checked = true;
toggle.dispatchEvent(new Event('change', { bubbles: true }));
return true;";

async fn state(tab: &Tab) -> Result<Value> {
    tab.js(READ_STATE, json!([LOCKABLE])).await
}

fn locked(state: &Value) -> BTreeSet<String> {
    state["locked"].as_array().into_iter().flatten().filter_map(|v| v.as_str().map(str::to_string)).collect()
}

fn set_of(ids: &[&str]) -> BTreeSet<String> {
    ids.iter().map(|s| s.to_string()).collect()
}

async fn wait_for_locks(tab: &Tab, accept: impl Fn(&BTreeSet<String>) -> bool) -> Result<()> {
    let deadline = std::time::Instant::now() + Duration::from_secs(15);
    loop {
        if accept(&locked(&state(tab).await?)) {
            return Ok(());
        }
        ensure!(std::time::Instant::now() < deadline, "locks never settled: {:?}", locked(&state(tab).await?));
        tokio::time::sleep(Duration::from_millis(25)).await;
    }
}

pub fn cases() -> Vec<Case> {
    let mut cases = vec![
        case("geometry_fields_start_editable", |tab| async move {
            open_tool(&tab, "crawl").await?;
            let s = state(&tab).await?;
            ensure!(locked(&s) == set_of(ORIGIN), "only the manual-positioning pair should be greyed out: {s}");
            ensure!(s["noteVisible"] == false);
            ensure!(tab.js::<bool>(ENABLE_MANUAL_TOP_LEFT, json!([])).await?);
            ensure!(locked(&state(&tab).await?).is_empty());
            Ok(())
        }),
        case("premade_options_are_the_ones_under_test", |tab| async move {
            open_tool(&tab, "crawl").await?;
            let options: BTreeSet<String> = tab
                .eval("Array.from(document.querySelectorAll('#crawlBackgroundPremadeSelect option')).map(o => o.value)")
                .await?;
            let expected: BTreeSet<String> = EXPECTED_LOCKS.iter().map(|(v, _)| v.to_string()).collect();
            ensure!(options == expected, "the pre-made list changed; update EXPECTED_LOCKS: {options:?}");
            Ok(())
        }),
        case("locked_fields_reject_typing", |tab| async move {
            open_tool(&tab, "crawl").await?;
            tab.exec(SET_BACKGROUND_MODE, json!(["premade"])).await?;
            tab.exec(SELECT_PREMADE, json!(["dasdec:dasdec"])).await?;
            wait_for_locks(&tab, |l| l.contains("crawlWidth")).await?;
            let before = state(&tab).await?["values"]["crawlWidth"].clone();
            tab.click("#crawlWidth").await?;
            tab.type_text("999").await?;
            ensure!(state(&tab).await?["values"]["crawlWidth"] == before, "a locked field took typing");
            let title: String = tab.eval("document.getElementById('crawlWidth').getAttribute('title') || ''").await?;
            ensure!(!title.is_empty(), "a locked field should explain itself on hover");
            Ok(())
        }),
    ];
    for (premade, expected) in EXPECTED_LOCKS {
        let id = premade.rsplit(':').next().unwrap();
        cases.push(case(format!("premade_locks_only_the_fields_it_sets[{id}]"), move |tab| async move {
            open_tool(&tab, "crawl").await?;
            tab.exec(SET_BACKGROUND_MODE, json!(["premade"])).await?;
            tab.exec(SELECT_PREMADE, json!([premade])).await?;
            let want = set_of(expected);
            wait_for_locks(&tab, |l| *l == want).await?;
            ensure!(state(&tab).await?["noteVisible"] == true, "the explanation for the greyed-out fields is hidden");
            Ok(())
        }));
    }
    for mode in ["solid", "transparent", "image"] {
        cases.push(case(format!("leaving_premade_mode_releases_every_lock[{mode}]"), move |tab| async move {
            open_tool(&tab, "crawl").await?;
            tab.exec(SET_BACKGROUND_MODE, json!(["premade"])).await?;
            wait_for_locks(&tab, |l| !l.is_empty()).await?;
            tab.exec(SET_BACKGROUND_MODE, json!([mode])).await?;
            ensure!(
                tab.js::<bool>(ENABLE_MANUAL_TOP_LEFT, json!([])).await?,
                "leaving pre-made mode must hand the manual-positioning checkbox back"
            );
            let s = state(&tab).await?;
            ensure!(locked(&s).is_empty(), "{mode} mode still has locked fields: {:?}", locked(&s));
            ensure!(s["noteVisible"] == false);
            Ok(())
        }));
    }
    cases
}
