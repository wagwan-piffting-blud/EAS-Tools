//! WarnGen's office and template pickers as searchable comboboxes (#126).

use eas_tools_e2e::*;

async fn open(tab: &Tab) -> Result<()> {
    tab.goto("warngen/").await?;
    tab.wait_until(
        "!!document.querySelector('.bullet-option') && document.querySelectorAll('#office-select option').length > 100",
        Duration::from_secs(40),
    )
    .await
}

fn button(id: &str) -> String {
    format!("#{id} + .ss-combo .ss-combo__btn")
}

fn search(id: &str) -> String {
    format!("#{id} + .ss-combo .ss-combo__search")
}

async fn visible_options(tab: &Tab, id: &str) -> Result<Vec<String>> {
    tab.js(
        "return Array.from(document.querySelectorAll(arguments[0]), (li) => li.textContent);",
        json!([format!("#{id} + .ss-combo .ss-combo__opt")]),
    )
    .await
}

async fn label(tab: &Tab, id: &str) -> Result<String> {
    tab.js("return document.querySelector(arguments[0]).textContent;", json!([format!("#{id} + .ss-combo .ss-combo__label")])).await
}

async fn wait_for_label(tab: &Tab, id: &str, text: &str) -> Result<()> {
    let selector = json!(format!("#{id} + .ss-combo .ss-combo__label"));
    if tab.wait_until(&format!("document.querySelector({selector}).textContent === {}", json!(text)), Duration::from_secs(10)).await.is_err() {
        bail!("{id} label never became {text:?}; it is {:?}", label(tab, id).await?);
    }
    Ok(())
}

async fn count_changes(tab: &Tab, id: &str) -> Result<()> {
    tab.exec(
        "window.__changes = window.__changes || {};
         window.__changes[arguments[0]] = 0;
         const id = arguments[0];
         document.getElementById(id).addEventListener('change', () => window.__changes[id]++);",
        json!([id]),
    )
    .await
}

async fn changes(tab: &Tab, id: &str) -> Result<i64> {
    tab.js("return window.__changes[arguments[0]];", json!([id])).await
}

async fn value(tab: &Tab, id: &str) -> Result<String> {
    tab.js("return document.getElementById(arguments[0]).value;", json!([id])).await
}

async fn is_active(tab: &Tab, selector: &str) -> Result<bool> {
    tab.js("return document.activeElement === document.querySelector(arguments[0]);", json!([selector])).await
}

async fn expanded(tab: &Tab, id: &str) -> Result<Option<String>> {
    tab.js("return document.querySelector(arguments[0]).getAttribute('aria-expanded');", json!([button(id)])).await
}

async fn open_and_type(tab: &Tab, id: &str, text: &str) -> Result<()> {
    tab.click(&button(id)).await?;
    tab.type_text(text).await
}

pub fn cases() -> Vec<Case> {
    let mut cases = vec![case("native_selects_stay_in_the_dom_and_get_an_accessible_button", |tab| async move {
        open(&tab).await?;
        let info: Vec<Value> = tab
            .eval(
                "['office-select', 'template-select'].map((id) => {
                    const sel = document.getElementById(id);
                    const btn = sel.nextElementSibling.querySelector('.ss-combo__btn');
                    const names = (btn.getAttribute('aria-labelledby') || '').split(' ')
                        .map((x) => document.getElementById(x).textContent.trim());
                    return { hidden: getComputedStyle(sel).display === 'none', ariaHidden: sel.getAttribute('aria-hidden'),
                             popup: btn.getAttribute('aria-haspopup'), name: names.join(' ') };
                })",
            )
            .await?;
        let (office, template) = (&info[0], &info[1]);
        ensure!(office["hidden"] == true && template["hidden"] == true, "{info:?}");
        ensure!(office["ariaHidden"] == "true" && template["ariaHidden"] == "true", "{info:?}");
        ensure!(office["popup"] == "listbox", "{office}");
        ensure!(office["name"] == "Office KOAX Omaha/Valley NE", "{office}");
        ensure!(template["name"].as_str().unwrap_or("").starts_with("Template: "), "{template}");
        Ok(())
    })];
    for query in ["omaha", "KOAX", "oax"] {
        cases.push(case(format!("office_search_finds_omaha[{query}]"), move |tab| async move {
            open(&tab).await?;
            tab.click(&button("office-select")).await?;
            ensure!(is_active(&tab, &search("office-select")).await?, "the search box did not take focus");
            tab.type_text(query).await?;
            let options = visible_options(&tab, "office-select").await?;
            ensure!(options.iter().any(|o| o == "KOAX Omaha/Valley NE") && options.len() <= 3, "{options:?}");
            Ok(())
        }));
    }
    cases.push(case("office_search_matches_city_and_state_terms", |tab| async move {
        open(&tab).await?;
        open_and_type(&tab, "office-select", "hastings ne").await?;
        ensure!(visible_options(&tab, "office-select").await? == ["KGID Hastings NE"]);
        tab.type_text("zzz").await?;
        ensure!(visible_options(&tab, "office-select").await?.is_empty());
        let list: String = tab.eval("document.querySelector('#office-select + .ss-combo .ss-combo__list').innerText").await?;
        ensure!(list.contains("No offices match."), "{list}");
        Ok(())
    }));
    cases.push(case("picking_an_office_sets_the_select_and_fires_change", |tab| async move {
        open(&tab).await?;
        count_changes(&tab, "office-select").await?;
        open_and_type(&tab, "office-select", "hastings").await?;
        tab.press("Enter", &[]).await?;
        ensure!(value(&tab, "office-select").await? == "GID");
        ensure!(changes(&tab, "office-select").await? == 1);
        ensure!(label(&tab, "office-select").await? == "KGID Hastings NE");
        ensure!(is_active(&tab, &button("office-select")).await?, "focus did not return to the button");
        ensure!(expanded(&tab, "office-select").await?.as_deref() == Some("false"));
        tab.wait_until(
            "(() => { const t = document.getElementById('output').innerText;
               return t.includes('GID') || t.includes('Hastings') || t.includes('Draw a polygon'); })()",
            Duration::from_secs(10),
        )
        .await
    }));
    cases.push(case("clicking_an_office_option_picks_it", |tab| async move {
        open(&tab).await?;
        count_changes(&tab, "office-select").await?;
        open_and_type(&tab, "office-select", "Des Moines").await?;
        let text: String = tab.eval("document.querySelector('#office-select + .ss-combo .ss-combo__opt').innerText").await?;
        ensure!(text == "KDMX Des Moines IA", "{text}");
        tab.click("#office-select + .ss-combo .ss-combo__opt").await?;
        ensure!(value(&tab, "office-select").await? == "DMX");
        ensure!(changes(&tab, "office-select").await? == 1);
        Ok(())
    }));
    cases.push(case("escape_closes_without_changing", |tab| async move {
        open(&tab).await?;
        count_changes(&tab, "office-select").await?;
        open_and_type(&tab, "office-select", "hastings").await?;
        tab.press("Escape", &[]).await?;
        ensure!(value(&tab, "office-select").await? == "OAX");
        ensure!(changes(&tab, "office-select").await? == 0);
        ensure!(expanded(&tab, "office-select").await?.as_deref() == Some("false"));
        Ok(())
    }));
    cases.push(case("template_search_matches_labels_and_group_names", |tab| async move {
        open(&tab).await?;
        open_and_type(&tab, "template-select", "tornado").await?;
        let options = visible_options(&tab, "template-select").await?;
        ensure!(!options.is_empty() && options.iter().all(|o| o.to_lowercase().contains("tornado")), "{options:?}");
        tab.replace_text(&search("template-select"), "watches spc").await?;
        let options = visible_options(&tab, "template-select").await?;
        ensure!(options == ["Tornado Watch (SEL/WOU/WWP)", "Severe Thunderstorm Watch (SEL/WOU/WWP)"], "{options:?}");
        let groups: Vec<String> = tab
            .eval("Array.from(document.querySelectorAll('#template-select + .ss-combo .ss-combo__group'), (g) => g.getAttribute('aria-label'))")
            .await?;
        ensure!(groups == ["Watches (SPC)"], "{groups:?}");
        Ok(())
    }));
    cases.push(case("picking_an_spc_watch_switches_the_office_label", |tab| async move {
        open(&tab).await?;
        count_changes(&tab, "template-select").await?;
        open_and_type(&tab, "template-select", "tornado watch").await?;
        tab.press("Enter", &[]).await?;
        ensure!(value(&tab, "template-select").await? == "watch:SPC-TO");
        ensure!(changes(&tab, "template-select").await? == 1);
        ensure!(label(&tab, "template-select").await? == "Tornado Watch (SEL/WOU/WWP)");
        ensure!(value(&tab, "office-select").await? == "SPC");
        wait_for_label(&tab, "office-select", "KWNS Storm Prediction Center (SPC watches)").await?;

        open_and_type(&tab, "template-select", "severeThunderstormWarning").await?;
        ensure!(visible_options(&tab, "template-select").await?.is_empty());
        tab.replace_text(&search("template-select"), "severe thunderstorm warning").await?;
        tab.press("Enter", &[]).await?;
        ensure!(value(&tab, "office-select").await? == "OAX");
        wait_for_label(&tab, "office-select", "KOAX Omaha/Valley NE").await
    }));
    cases.push(case("programmatic_value_and_era_rebuild_update_the_labels", |tab| async move {
        open(&tab).await?;
        tab.exec("document.getElementById('office-select').value = 'DMX';", json!([])).await?;
        ensure!(label(&tab, "office-select").await? == "KDMX Des Moines IA");
        tab.exec("document.getElementById('office-select').selectedIndex = 0;", json!([])).await?;
        ensure!(label(&tab, "office-select").await? == "-- All US (auto-pick office on draw) --");
        tab.exec(
            "const era = document.getElementById('era-select'); era.value = 'modern'; era.dispatchEvent(new Event('change', { bubbles: true }));",
            json!([]),
        )
        .await?;
        let expected: String = tab.eval("(() => { const s = document.getElementById('template-select'); return s.options[s.selectedIndex].textContent; })()").await?;
        wait_for_label(&tab, "template-select", &expected).await?;
        open_and_type(&tab, "template-select", "IBW").await?;
        let options = visible_options(&tab, "template-select").await?;
        ensure!(options.iter().any(|o| o == "Tornado Warning (IBW)"), "{options:?}");
        Ok(())
    }));
    cases.push(case("saved_state_restores_the_visible_labels", |tab| async move {
        open(&tab).await?;
        let state = json!({ "form": { "era": "legacy", "template": "flashFloodWarning.vm", "office": "GID" } });
        tab.local_storage_set("warngen-state-v1", &state.to_string()).await?;
        tab.goto("warngen/").await?;
        tab.wait_until("document.getElementById('office-select').value === 'GID'", Duration::from_secs(40)).await?;
        wait_for_label(&tab, "office-select", "KGID Hastings NE").await?;
        wait_for_label(&tab, "template-select", "Flash Flood Warning (legacy)").await
    }));
    cases.push(case("label_click_focuses_the_combo_button", |tab| async move {
        open(&tab).await?;
        tab.click("label[for='office-select']").await?;
        ensure!(is_active(&tab, &button("office-select")).await?, "focus is on {:?}", tab.active_id().await?);
        Ok(())
    }));
    for width in [390i64, 1280] {
        cases.push(case(format!("meta_bar_stays_inside_the_viewport[{width}]"), move |tab| async move {
            open(&tab).await?;
            tab.set_viewport(width, 900).await?;
            tab.wait_until(&format!("window.innerWidth === {width}"), Duration::from_secs(5)).await?;
            let boxes: Vec<(String, f64, f64, f64, f64)> = tab
                .eval(
                    "(() => { const vw = document.documentElement.clientWidth;
                       return ['template-select', 'office-select'].map((id) => {
                           const r = document.getElementById(id).nextElementSibling.getBoundingClientRect();
                           return [id, Math.round(r.left), Math.round(r.right), vw, Math.round(r.height)]; }); })()",
                )
                .await?;
            for (id, left, right, vw, height) in boxes {
                ensure!(left >= 0.0 && right <= vw, "{id}: {left}..{right} in {vw}");
                ensure!((16.0..=40.0).contains(&height), "{id}: height {height}");
            }
            tab.click(&button("office-select")).await?;
            let pop: (f64, f64, f64) = tab
                .eval("(() => { const r = document.querySelector('#office-select + .ss-combo .ss-combo__pop').getBoundingClientRect(); return [r.left, r.right, document.documentElement.clientWidth]; })()")
                .await?;
            ensure!(pop.0 >= 0.0 && pop.1 <= pop.2 + 1.0, "{pop:?}");
            Ok(())
        }));
    }
    cases
}
