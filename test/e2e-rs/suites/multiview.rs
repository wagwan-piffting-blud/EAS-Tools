//! #155: Multi-View shows 2 to 4 tools at once as rearrangeable panes, routes hand-offs between
//! them, and stays out of the way on narrow screens.

use eas_tools_e2e::*;

const LAYOUT_KEY: &str = "eas-tools-multiview";
const PANE_TOOLS_JS: &str = "[...document.querySelectorAll('.mv-pane')].sort((a, b) => a.style.order - b.style.order).map((p) => p.dataset.tool)";
const HEADER: &str = "ZCZC-WXR-TOR-048453+0030-2701505-KEWX/NWS-";

async fn open(tab: &Tab, layout: Option<&[&str]>) -> Result<()> {
    if let Some(layout) = layout {
        tab.goto("demos.html").await?;
        tab.local_storage_set(LAYOUT_KEY, &json!(layout).to_string())
            .await?;
    }
    tab.goto("index.html?tool=multiview").await?;
    tab.wait_until(
        "document.getElementById('multiview-panel')?.dataset.ready === 'true'",
        Duration::from_secs(25),
    )
    .await
}

async fn pane_tools(tab: &Tab) -> Result<Vec<String>> {
    tab.eval(PANE_TOOLS_JS).await
}

fn pane(slot: usize) -> String {
    format!(".mv-pane[data-slot=\"{slot}\"]")
}

async fn wait_pane_ready(tab: &Tab, tool: &str) -> Result<()> {
    tab.wait_until(
        &format!(
            "(() => {{ const f = document.querySelector('.mv-pane[data-tool=\"{tool}\"] iframe'); try {{ return !!f && f.contentDocument.readyState === 'complete' && !!f.contentWindow.EASHandoff; }} catch (e) {{ return false; }} }})()"
        ),
        Duration::from_secs(40),
    )
    .await
}

async fn status(tab: &Tab) -> Result<String> {
    tab.wait_until(
        "document.getElementById('mv-status').textContent.length > 0",
        Duration::from_secs(5),
    )
    .await?;
    tab.eval("document.getElementById('mv-status').textContent")
        .await
}

pub fn cases() -> Vec<Case> {
    let mut cases: Vec<Case> = ["dark", "light"]
        .into_iter()
        .map(|scheme| {
            case(
                format!("multiview_controls_have_no_serious_axe_violations[{scheme}]"),
                move |tab| async move {
                    tab.emulate_media(&[("prefers-color-scheme", scheme)])
                        .await?;
                    open(&tab, Some(&["encoder", "crawl", "normalizer"])).await?;
                    // Each tool's own markup is audited by a11y.rs; this covers the Multi-View chrome.
                    let options = json!({ "resultTypes": ["violations"], "iframes": false });
                    let violations =
                        axe::failing_with(&tab, json!("#multiview-root"), options, &[]).await?;
                    ensure!(
                        violations.is_empty(),
                        "{}",
                        axe::describe(&violations, &format!("multiview ({scheme})"))
                    );
                    Ok(())
                },
            )
        })
        .collect();
    cases.extend(vec![
        case("opens_the_big_four_as_bare_tool_panes", |tab| async move {
            open(&tab, None).await?;
            ensure!(pane_tools(&tab).await? == ["warngen", "splicer", "encoder", "crawl"]);
            for tool in ["warngen", "splicer", "encoder", "crawl"] {
                wait_pane_ready(&tab, tool).await?;
                let (pane_class, header, active): (String, String, String) = tab
                    .eval(&format!(
                        "(() => {{ const d = document.querySelector('.mv-pane[data-tool=\"{tool}\"] iframe').contentDocument; return [d.documentElement.className, getComputedStyle(d.querySelector('header')).display, d.querySelector('.tool-panel.active').id]; }})()"
                    ))
                    .await?;
                ensure!(pane_class.contains("eas-pane") && header == "none", "{tool}: {pane_class} {header}");
                ensure!(active == format!("{tool}-panel"), "{tool}: {active}");
                let nested: bool = tab
                    .eval(&format!("!document.querySelector('.mv-pane[data-tool=\"{tool}\"] iframe').contentDocument.getElementById('multiview-panel')"))
                    .await?;
                ensure!(nested, "{tool}: a pane must not offer Multi-View itself");
            }
            Ok(())
        }),
        case("dragging_a_handle_swaps_panes_without_reloading_them", |tab| async move {
            open(&tab, Some(&["encoder", "crawl", "normalizer"])).await?;
            wait_pane_ready(&tab, "encoder").await?;
            tab.exec("document.querySelector('.mv-pane[data-tool=\"encoder\"] iframe').contentWindow.__kept = true;", json!([])).await?;
            tab.drag(&format!("{} .mv-pane__grip", pane(0)), &pane(2)).await?;
            ensure!(pane_tools(&tab).await? == ["normalizer", "crawl", "encoder"], "{:?}", pane_tools(&tab).await?);
            let kept: bool = tab.eval("document.querySelector('.mv-pane[data-tool=\"encoder\"] iframe').contentWindow.__kept === true").await?;
            ensure!(kept, "moving a pane reloaded its tool");
            let (first, third): (f64, f64) = tab
                .eval("['0', '2'].map((s) => document.querySelector('.mv-pane[data-slot=\"' + s + '\"]').getBoundingClientRect().width)")
                .await?;
            ensure!(third > first * 1.8, "the third of three panes should span the row: {first} vs {third}");
            let saved: String = tab.eval(&format!("localStorage.getItem('{LAYOUT_KEY}')")).await?;
            ensure!(saved == r#"["normalizer","crawl","encoder"]"#, "{saved}");
            Ok(())
        }),
        case("dropping_a_tool_on_a_pane_replaces_it_or_swaps_if_already_open", |tab| async move {
            open(&tab, Some(&["encoder", "crawl"])).await?;
            tab.drag(".mv-chip[data-mv-tool=\"decoder\"]", &pane(1)).await?;
            ensure!(pane_tools(&tab).await? == ["encoder", "decoder"], "{:?}", pane_tools(&tab).await?);
            ensure!(status(&tab).await?.contains("Replaced Text Crawl Generator with Decoder in pane 2"));
            let src: String = tab.eval(&format!("document.querySelector('{} iframe').getAttribute('src')", pane(1))).await?;
            ensure!(src == "index.html?tool=decoder&pane=1", "{src}");
            tab.drag(".mv-chip[data-mv-tool=\"decoder\"]", &pane(0)).await?;
            ensure!(pane_tools(&tab).await? == ["decoder", "encoder"], "{:?}", pane_tools(&tab).await?);
            let chips: Vec<String> =
                tab.eval("[...document.querySelectorAll('.mv-chip[aria-pressed=\"true\"]')].map((c) => c.dataset.mvTool)").await?;
            ensure!(chips == ["decoder", "encoder"], "{chips:?}");
            Ok(())
        }),
        case("keeps_between_two_and_four_panes", |tab| async move {
            open(&tab, Some(&["encoder", "crawl", "splicer"])).await?;
            tab.click(&format!("{} .mv-pane__close", pane(2))).await?;
            ensure!(pane_tools(&tab).await? == ["encoder", "crawl"]);
            let disabled: bool = tab.eval("[...document.querySelectorAll('.mv-pane__close')].every((b) => b.disabled)").await?;
            ensure!(disabled, "closing below two panes must be impossible");
            tab.click(".mv-chip[data-mv-tool=\"phoneme\"]").await?;
            tab.click(".mv-chip[data-mv-tool=\"normalizer\"]").await?;
            ensure!(pane_tools(&tab).await? == ["encoder", "crawl", "phoneme", "normalizer"]);
            tab.click(".mv-chip[data-mv-tool=\"decoder\"]").await?;
            ensure!(pane_tools(&tab).await?.len() == 4);
            ensure!(status(&tab).await?.contains("at most 4 tools"));
            tab.exec("const s = document.querySelector('.mv-pane[data-slot=\"0\"] select'); s.value = 'muxer'; s.dispatchEvent(new Event('change'));", json!([])).await?;
            ensure!(pane_tools(&tab).await? == ["muxer", "crawl", "phoneme", "normalizer"]);
            tab.click(&format!("{} .mv-pane__move[data-move=\"1\"]", pane(0))).await?;
            ensure!(pane_tools(&tab).await? == ["crawl", "muxer", "phoneme", "normalizer"]);
            tab.goto("index.html?tool=multiview").await?;
            tab.wait_until("document.getElementById('multiview-panel')?.dataset.ready === 'true'", Duration::from_secs(25)).await?;
            ensure!(pane_tools(&tab).await? == ["crawl", "muxer", "phoneme", "normalizer"], "layout did not persist");
            Ok(())
        }),
        case("a_send_lands_in_the_pane_holding_the_target_tool", |tab| async move {
            open(&tab, Some(&["encoder", "crawl"])).await?;
            wait_pane_ready(&tab, "encoder").await?;
            wait_pane_ready(&tab, "crawl").await?;
            let sent: bool = tab
                .js(
                    "return document.querySelector('.mv-pane[data-tool=\"encoder\"] iframe').contentWindow.EASHandoff.sendTo('crawl', { header: arguments[0] }, { what: 'Alert' });",
                    json!([HEADER]),
                )
                .await?;
            ensure!(sent);
            tab.wait_until(
                &format!("document.querySelector('.mv-pane[data-tool=\"crawl\"] iframe').contentDocument.getElementById('crawlRawHeader').value === {}", json!(HEADER)),
                Duration::from_secs(20),
            )
            .await?;
            ensure!(pane_tools(&tab).await? == ["encoder", "crawl"], "the sending pane must not switch tools");
            let active: String = tab.eval("document.querySelector('.mv-pane[data-tool=\"encoder\"] iframe').contentDocument.querySelector('.tool-panel.active').id").await?;
            ensure!(active == "encoder-panel", "{active}");
            ensure!(status(&tab).await?.contains("Alert sent to Text Crawl Generator in pane 2"));

            tab.exec(
                "document.querySelector('.mv-pane[data-tool=\"crawl\"] iframe').contentWindow.EASHandoff.sendTo('normalizer', { text: 'WWUS84 KEWX 271505' });",
                json!([]),
            )
            .await?;
            tab.wait_until("document.querySelectorAll('.mv-pane').length === 3", Duration::from_secs(5)).await?;
            ensure!(pane_tools(&tab).await? == ["encoder", "crawl", "normalizer"]);
            tab.wait_until(
                "(() => { try { const d = document.querySelector('.mv-pane[data-tool=\"normalizer\"] iframe').contentDocument; return d.getElementById('productToNormalize').value.includes('WWUS84'); } catch (e) { return false; } })()",
                Duration::from_secs(40),
            )
            .await?;
            Ok(())
        }),
        case("narrow_windows_get_no_multiview", |tab| async move {
            tab.set_viewport(800, 1000).await?;
            tab.goto("index.html?tool=decoder").await?;
            let (button_shown, option): (bool, bool) = tab
                .eval("[getComputedStyle(document.getElementById('tab-multiview')).display !== 'none', !!document.querySelector('#nav-select option[value=\"multiview\"]')]")
                .await?;
            ensure!(!button_shown && !option, "Multi-View offered at 800px: button {button_shown}, option {option}");
            tab.goto("index.html?tool=multiview").await?;
            tab.wait_until("document.getElementById('multiview-panel')?.dataset.ready === 'true'", Duration::from_secs(25)).await?;
            let (notice, grid_hidden, frames): (bool, bool, i64) = tab
                .eval("[!document.querySelector('.mv-narrow').hidden, document.getElementById('mv-grid').hidden, document.querySelectorAll('.mv-pane iframe').length]")
                .await?;
            ensure!(notice && grid_hidden && frames == 0, "notice {notice}, grid hidden {grid_hidden}, {frames} panes loaded while unusable");
            tab.set_viewport(1400, 1000).await?;
            tab.wait_until(
                "!document.getElementById('mv-grid').hidden && document.querySelectorAll('.mv-pane iframe').length === 4 && !!document.querySelector('#nav-select option[value=\"multiview\"]')",
                Duration::from_secs(5),
            )
            .await?;
            tab.clear_viewport().await
        }),
    ]);
    cases
}
