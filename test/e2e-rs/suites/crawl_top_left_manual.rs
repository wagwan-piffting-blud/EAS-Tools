//! The Crawl Top-Left Location fields only ever reached the generator when a background image
//! happened to be loaded, so in Solid Color mode -- the default -- typing a position did
//! nothing at all. They are now gated on an explicit "Position the crawl manually" checkbox
//! instead, in every background mode.

use eas_tools_e2e::*;

use crate::common::open_tool;

const SETTINGS_KEY: &str = "eas-tools-crawl-settings";

/// Waits until the crawl's debounced apply has run against what the form shows now -- the
/// settings it persists match the inputs -- and nothing has moved for QUIET_MS.
const SETTLE_AND_READ: &str = r#"
const QUIET_MS = 500;
const read = () => {
    const generator = window.crawlGenerator;
    return {
        toggleChecked: document.getElementById('crawlTopLeftManual').checked,
        toggleDisabled: document.getElementById('crawlTopLeftManual').disabled,
        inputY: document.getElementById('crawlTopLeftPixelY').value,
        inputDisabled: document.getElementById('crawlTopLeftPixelY').disabled,
        generatorY: generator ? generator._topLeftOffsetY : null,
        active: generator ? generator._topLeftActive : null,
        backgroundMode: document.getElementById('crawlBackgroundMode').value,
    };
};
const persisted = () => {
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem('eas-tools-crawl-settings')); } catch (error) { }
    const value = (id) => document.getElementById(id).value;
    return !!saved && !!window.crawlGenerator
        && saved.crawlBackgroundMode === value('crawlBackgroundMode')
        && saved.crawlBackgroundPremade === value('crawlBackgroundPremadeSelect')
        && saved.crawlTopLeftManual === document.getElementById('crawlTopLeftManual').checked
        && saved.crawlTopLeftOffsetX === value('crawlTopLeftPixelX')
        && saved.crawlTopLeftOffsetY === value('crawlTopLeftPixelY')
        && saved.crawlWidth === value('crawlWidth')
        && saved.crawlHeight === value('crawlHeight');
};
const settle = async () => {
    const deadline = Date.now() + 30000;
    let last = null;
    let since = Date.now();
    while (Date.now() < deadline) {
        const snapshot = JSON.stringify([read(), localStorage.getItem('eas-tools-crawl-settings')]);
        if (snapshot !== last) {
            last = snapshot;
            since = Date.now();
        }
        if (persisted() && Date.now() - since >= QUIET_MS) return;
        await new Promise((resolve) => setTimeout(resolve, 25));
    }
};
"#;

const SET_AND_READ_BODY: &str = r#"
const done = arguments[arguments.length - 1];
const mode = arguments[0];
const manual = arguments[1];
const y = arguments[2];
(async () => {
    const set = (id, value) => {
        const el = document.getElementById(id);
        if (!el) return;
        if (el.type === 'checkbox') el.checked = value;
        else el.value = value;
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
    };
    set('crawlMode', 'custom');
    const text = document.getElementById('crawlText');
    text.value = 'TOP LEFT REGRESSION';
    text.dispatchEvent(new Event('input', { bubbles: true }));
    set('crawlWidth', '640');
    set('crawlHeight', '480');
    set('crawlBackgroundMode', mode);
    set('crawlTopLeftManual', manual);
    set('crawlTopLeftPixelY', y);
    await settle();
    done(read());
})();
"#;

const READ_STATE_BODY: &str = r#"
const done = arguments[arguments.length - 1];
settle().then(() => done(read()));
"#;

async fn set_and_read(tab: &Tab, mode: &str, manual: bool, y: &str) -> Result<Value> {
    tab.js_async(&format!("{SETTLE_AND_READ}{SET_AND_READ_BODY}"), json!([mode, manual, y])).await
}

async fn read_state(tab: &Tab) -> Result<Value> {
    tab.js_async(&format!("{SETTLE_AND_READ}{READ_STATE_BODY}"), json!([])).await
}

async fn set_mode(tab: &Tab, mode: &str) -> Result<()> {
    tab.exec(
        "const mode = document.getElementById('crawlBackgroundMode');
         mode.value = arguments[0];
         mode.dispatchEvent(new Event('change', { bubbles: true }));",
        json!([mode]),
    )
    .await
}

/// Seeds a settings blob from before the toggle existed, from a same-origin page that runs no
/// crawl code (a live crawl page could persist its own settings over the seed), then loads
/// the crawl onto it.
async fn load_legacy(tab: &Tab, settings: Value) -> Result<Value> {
    tab.goto("demos.html").await?;
    tab.local_storage_set(SETTINGS_KEY, &settings.to_string()).await?;
    open_tool(tab, "crawl").await?;
    let mode = settings["crawlBackgroundMode"].as_str().unwrap_or_default();
    let y = settings["crawlTopLeftPixelY"].as_str().unwrap_or_default();
    tab.wait_until(
        &format!(
            "!!window.crawlGenerator && document.getElementById('crawlBackgroundMode').value === {} \
             && document.getElementById('crawlTopLeftPixelY').value === {}",
            json!(mode),
            json!(y)
        ),
        Duration::from_secs(40),
    )
    .await?;
    read_state(tab).await
}

fn y_of(state: &Value) -> String {
    match &state["generatorY"] {
        Value::String(s) => s.clone(),
        other => other.to_string(),
    }
}

async fn wait_for_dialog(tab: &Tab, count: usize) -> Result<()> {
    let deadline = std::time::Instant::now() + Duration::from_secs(15);
    while tab.dialogs().len() < count {
        ensure!(std::time::Instant::now() < deadline, "no alert appeared");
        tokio::time::sleep(Duration::from_millis(25)).await;
    }
    Ok(())
}

pub fn cases() -> Vec<Case> {
    let mut cases = vec![
        case("the_toggle_starts_off_and_greys_out_the_coordinates", |tab| async move {
            open_tool(&tab, "crawl").await?;
            let state: Value = tab
                .eval(
                    "({ checked: document.getElementById('crawlTopLeftManual').checked,
                        x: document.getElementById('crawlTopLeftPixelX').disabled,
                        y: document.getElementById('crawlTopLeftPixelY').disabled })",
                )
                .await?;
            ensure!(state == json!({ "checked": false, "x": true, "y": true }), "{state}");
            Ok(())
        }),
        case("turning_the_toggle_back_off_re_centers_the_crawl", |tab| async move {
            open_tool(&tab, "crawl").await?;
            ensure!(set_and_read(&tab, "solid", true, "300").await?["active"] == true);
            let off = set_and_read(&tab, "solid", false, "300").await?;
            ensure!(off["active"] == false, "unticking the box left the crawl pinned");
            Ok(())
        }),
        case("a_premade_background_still_positions_the_crawl_itself", |tab| async move {
            open_tool(&tab, "crawl").await?;
            set_mode(&tab, "premade").await?;
            tab.exec(
                "const select = document.getElementById('crawlBackgroundPremadeSelect');
                 select.value = 'image:assets/screens/xfinity.png';
                 select.dispatchEvent(new Event('change', { bubbles: true }));",
                json!([]),
            )
            .await?;
            tab.wait_until("document.getElementById('crawlTopLeftPixelY').value === '475'", Duration::from_secs(30)).await?;
            let state = read_state(&tab).await?;
            ensure!(state["active"] == true && y_of(&state) == "475" && state["inputDisabled"] == true, "{state}");
            ensure!(state["toggleDisabled"] == true, "the toggle must be out of play while a pre-made layout owns the origin");
            Ok(())
        }),
        case("legacy_image_settings_keep_the_origin_they_already_had", |tab| async move {
            let migrated = load_legacy(
                &tab,
                json!({ "crawlBackgroundMode": "image", "crawlTopLeftPixelX": "12", "crawlTopLeftPixelY": "340" }),
            )
            .await?;
            ensure!(migrated["backgroundMode"] == "image" && migrated["toggleChecked"] == true, "{migrated}");
            ensure!(migrated["inputY"] == "340" && y_of(&migrated) == "340", "{migrated}");
            Ok(())
        }),
        case("legacy_settings_that_never_set_a_position_stay_centered", |tab| async move {
            let untouched = load_legacy(
                &tab,
                json!({ "crawlBackgroundMode": "solid", "crawlTopLeftPixelX": "0", "crawlTopLeftPixelY": "0" }),
            )
            .await?;
            ensure!(untouched["toggleChecked"] == false && untouched["active"] == false, "{untouched}");
            Ok(())
        }),
        case("a_legacy_premade_preset_does_not_inherit_the_layouts_coordinates", |tab| async move {
            let migrated = load_legacy(
                &tab,
                json!({
                    "crawlBackgroundMode": "premade",
                    "crawlBackgroundPremadeSelect": "image:assets/screens/xfinity.png",
                    "crawlTopLeftPixelX": "0",
                    "crawlTopLeftPixelY": "475"
                }),
            )
            .await?;
            ensure!(migrated["toggleChecked"] == false, "{migrated}");
            set_mode(&tab, "solid").await?;
            let state = read_state(&tab).await?;
            ensure!(state["toggleChecked"] == false, "{state}");
            ensure!(state["active"] == false, "leaving pre-made mode kept the layout's origin");
            Ok(())
        }),
        case("the_toggle_round_trips_through_a_saved_preset", |tab| async move {
            open_tool(&tab, "crawl").await?;
            set_and_read(&tab, "solid", true, "150").await?;
            tab.exec(
                "document.getElementById('crawlUserPreset').value = '1';
                 setTimeout(() => document.getElementById('saveUserPreset').click(), 0);",
                json!([]),
            )
            .await?;
            wait_for_dialog(&tab, 1).await?;
            let saved: Value = serde_json::from_str(&tab.eval::<String>("localStorage.getItem('crawlPreset_1')").await?)?;
            ensure!(saved["crawlTopLeftManual"] == true && saved["crawlTopLeftPixelY"] == "150", "{saved}");

            open_tool(&tab, "crawl").await?;
            let before = tab.dialogs().len();
            tab.exec(
                "document.getElementById('crawlUserPreset').value = '1';
                 setTimeout(() => document.getElementById('loadUserPreset').click(), 0);",
                json!([]),
            )
            .await?;
            wait_for_dialog(&tab, before + 1).await?;
            let restored = read_state(&tab).await?;
            ensure!(restored["toggleChecked"] == true && restored["inputY"] == "150", "{restored}");
            ensure!(y_of(&restored) == "150", "{restored}");
            Ok(())
        }),
    ];
    for mode in ["solid", "image"] {
        cases.push(case(format!("the_coordinates_move_the_crawl_once_the_toggle_is_on[{mode}]"), move |tab| async move {
            open_tool(&tab, "crawl").await?;
            let result = set_and_read(&tab, mode, true, "200").await?;
            ensure!(result["inputDisabled"] == false && result["active"] == true && y_of(&result) == "200", "{result}");
            Ok(())
        }));
        cases.push(case(format!("the_crawl_stays_centered_while_the_toggle_is_off[{mode}]"), move |tab| async move {
            open_tool(&tab, "crawl").await?;
            let result = set_and_read(&tab, mode, false, "200").await?;
            ensure!(result["inputDisabled"] == true && result["active"] == false, "{result}");
            Ok(())
        }));
    }
    for (x, y) in [("0", "20"), ("35", "0"), ("35", "20")] {
        cases.push(case(format!("a_legacy_solid_preset_with_a_position_gets_the_toggle_turned_on[{x}-{y}]"), move |tab| async move {
            let migrated = load_legacy(
                &tab,
                json!({ "crawlBackgroundMode": "solid", "crawlTopLeftPixelX": x, "crawlTopLeftPixelY": y }),
            )
            .await?;
            ensure!(migrated["toggleChecked"] == true && migrated["inputDisabled"] == false, "{migrated}");
            ensure!(migrated["active"] == true && y_of(&migrated) == y, "{migrated}");
            Ok(())
        }));
    }
    cases
}
