//! Encoder location picker: searchable state/county lists, the all-locations search box, and
//! keyboard-removable table rows (#126).

use eas_tools_e2e::*;

use crate::common::open_tool_tracking_errors;

async fn open(tab: &Tab) -> Result<()> {
    open_tool_tracking_errors(tab, "encoder").await?;
    tab.wait_until(
        "!!document.querySelector('#stateselect + .ss-combo') && document.querySelectorAll('#stateselect option').length > 50",
        Duration::from_secs(25),
    )
    .await
}

async fn locations(tab: &Tab) -> Result<Vec<String>> {
    tab.eval("window.locations.slice()").await
}

async fn announcement(tab: &Tab) -> Result<String> {
    tab.eval("document.getElementById('encoderAnnouncer').textContent").await
}

async fn wait_announcement(tab: &Tab, text: &str) -> Result<()> {
    tab.wait_until(&format!("document.getElementById('encoderAnnouncer').textContent.includes({})", json!(text)), Duration::from_secs(5))
        .await
}

async fn no_errors(tab: &Tab) -> Result<()> {
    let errors: Vec<String> = tab.eval("window.__testErrors || []").await?;
    ensure!(errors.is_empty(), "{errors:?}");
    Ok(())
}

async fn attr(tab: &Tab, selector: &str, name: &str) -> Result<Option<String>> {
    tab.js("const el = document.querySelector(arguments[0]); return el ? el.getAttribute(arguments[1]) : null;", json!([selector, name]))
        .await
}

async fn active_attr(tab: &Tab, name: &str) -> Result<Option<String>> {
    tab.js("return document.activeElement ? document.activeElement.getAttribute(arguments[0]) : null;", json!([name])).await
}

pub fn cases() -> Vec<Case> {
    vec![
        case("state_and_county_lists_are_searchable", |tab| async move {
            open(&tab).await?;
            const STATE_BTN: &str = "#stateselect + .ss-combo .ss-combo__btn";
            let hidden: bool = tab.eval("document.getElementById('stateselect').offsetParent === null").await?;
            ensure!(hidden, "the native state select is still visible");
            ensure!(attr(&tab, STATE_BTN, "aria-haspopup").await?.as_deref() == Some("listbox"));
            let labelled = attr(&tab, STATE_BTN, "aria-labelledby").await?.unwrap_or_default();
            let first = labelled.split_whitespace().next().unwrap_or_default().to_string();
            let label: String = tab.js("return document.getElementById(arguments[0]).innerText;", json!([first])).await?;
            ensure!(label.starts_with("State"), "{label}");
            tab.click(STATE_BTN).await?;
            ensure!(active_attr(&tab, "role").await?.as_deref() == Some("combobox"));
            tab.type_text("TX").await?;
            tab.press("Enter", &[]).await?;
            ensure!(tab.eval::<String>("document.getElementById('stateselect').value").await? == "48");
            let button_text: String = tab.js("return document.querySelector(arguments[0]).innerText;", json!([STATE_BTN])).await?;
            ensure!(button_text.contains("TX"), "{button_text}");
            tab.focus("#countyselect + .ss-combo .ss-combo__btn").await?;
            tab.press("Enter", &[]).await?;
            tab.type_text("travis").await?;
            tab.press("Enter", &[]).await?;
            ensure!(tab.eval::<String>("document.getElementById('countyselect').value").await? == "453");
            tab.click("button[data-encoder-add-loc]").await?;
            ensure!(locations(&tab).await?.contains(&"048453".to_string()));
            ensure!(announcement(&tab).await?.contains("Added Travis County, TX"));
            no_errors(&tab).await
        }),
        case("search_all_locations_adds_and_keeps_focus", |tab| async move {
            open(&tab).await?;
            tab.click("#locSearch").await?;
            tab.type_text("travis tx").await?;
            tab.wait_until("document.getElementById('locSearchList').offsetParent !== null", Duration::from_secs(5)).await?;
            ensure!(attr(&tab, "#locSearch", "aria-expanded").await?.as_deref() == Some("true"));
            let first: Value = tab
                .eval("(() => { const o = document.querySelector('#locSearchList [role=option]'); return { text: o.innerText, id: o.id }; })()")
                .await?;
            ensure!(first["text"].as_str().unwrap_or("").contains("Travis County, TX"), "{first}");
            ensure!(attr(&tab, "#locSearch", "aria-activedescendant").await? == first["id"].as_str().map(str::to_string));
            tab.press("Enter", &[]).await?;
            ensure!(locations(&tab).await?.contains(&"048453".to_string()));
            ensure!(tab.active_id().await? == "locSearch");
            wait_announcement(&tab, "Added Travis County, TX").await?;
            let label = attr(&tab, "#locSearchList [role=option]", "aria-label").await?.unwrap_or_default();
            ensure!(label.contains("already added"), "{label}");
            tab.press("Enter", &[]).await?;
            ensure!(locations(&tab).await?.iter().filter(|l| *l == "048453").count() == 1);
            wait_announcement(&tab, "already in the list").await?;
            tab.replace_text("#locSearch", "state of delaware").await?;
            tab.press("Enter", &[]).await?;
            ensure!(locations(&tab).await?.contains(&"010000".to_string()));
            tab.exec("const r = document.getElementById('rgselect'); r.value = '5'; r.dispatchEvent(new Event('change'));", json!([])).await?;
            tab.replace_text("#locSearch", "kent county de").await?;
            tab.press("Enter", &[]).await?;
            ensure!(locations(&tab).await?.contains(&"510001".to_string()), "the current Region digit is used");
            tab.press("Escape", &[]).await?;
            ensure!(attr(&tab, "#locSearch", "aria-expanded").await?.as_deref() == Some("false"));
            no_errors(&tab).await
        }),
        case("search_caps_rendered_results", |tab| async move {
            open(&tab).await?;
            let elapsed: f64 = tab
                .eval(
                    "(() => { const box = document.getElementById('locSearch'); box.value = 'co';
                       const t0 = performance.now(); box.dispatchEvent(new Event('input', { bubbles: true }));
                       return performance.now() - t0; })()",
                )
                .await?;
            let options: i64 = tab.eval("document.querySelectorAll('#locSearchList [role=option]').length").await?;
            let note: String = tab.eval("document.querySelector('#locSearchList .loc-search__note').innerText").await?;
            ensure!(options == 100, "{options} options rendered");
            ensure!(note.contains("Keep typing"), "{note}");
            ensure!(elapsed < 250.0, "filter+render took {elapsed:.1} ms");
            let count: String = tab.eval("document.getElementById('locSearchCount').textContent").await?;
            ensure!(count.contains("showing the first 100"), "{count}");
            Ok(())
        }),
        case("search_follows_canada_mode", |tab| async move {
            open(&tab).await?;
            tab.exec("const m = document.getElementById('fipsMode'); m.value = 'ca'; m.dispatchEvent(new Event('change'));", json!([])).await?;
            tab.click("#locSearch").await?;
            tab.type_text("juan de fuca strait east").await?;
            tab.press("Enter", &[]).await?;
            ensure!(locations(&tab).await? == ["001111"], "{:?}", locations(&tab).await?);
            let row: String = tab.eval("document.querySelector('#container tr').innerText").await?;
            ensure!(row.contains("Juan de Fuca Strait - East entrance"), "{row}");
            no_errors(&tab).await
        }),
        case("rows_are_removable_by_keyboard", |tab| async move {
            open(&tab).await?;
            tab.click("#fipsinput").await?;
            tab.type_text("048453-010001").await?;
            tab.click("button[data-encoder-add-loc]").await?;
            ensure!(locations(&tab).await? == ["036071", "048453", "010001"], "{:?}", locations(&tab).await?);
            let count: i64 = tab.eval("document.querySelectorAll('#container .loc-remove').length").await?;
            ensure!(count == 3);
            let label: String = tab.eval("document.querySelectorAll('#container .loc-remove')[1].getAttribute('aria-label')").await?;
            ensure!(label.starts_with("Remove Travis County, TX") && label.contains("048453"), "{label}");
            tab.exec("document.querySelectorAll('#container .loc-remove')[1].focus();", json!([])).await?;
            tab.press("Enter", &[]).await?;
            ensure!(locations(&tab).await? == ["036071", "010001"]);
            wait_announcement(&tab, "Removed Travis County, TX").await?;
            let focused = active_attr(&tab, "aria-label").await?.unwrap_or_default();
            ensure!(focused.starts_with("Remove Kent County, DE"), "{focused}");
            tab.press(" ", &[]).await?;
            ensure!(locations(&tab).await? == ["036071"]);
            tab.click("#container tr td").await?;
            ensure!(locations(&tab).await?.is_empty());
            no_errors(&tab).await
        }),
    ]
}
