//! Right-click (a long press on touch screens) deletes in WarnGen: a selected county or zone in
//! "Click whole areas" mode, and the drawn polygon in "Draw polygon" mode. It leaves unselected
//! areas, clicks outside the polygon, and a polygon held by Leaflet.draw's edit tool alone.

use eas_tools_e2e::*;

/// Interior points of Douglas NE, Pottawattamie IA and Sarpy NE.
const DOUGLAS: (f64, f64) = (41.30, -96.15);
const POTTAWATTAMIE: (f64, f64) = (41.34, -95.54);
const SARPY: (f64, f64) = (41.11, -96.11);

async fn open(tab: &Tab) -> Result<()> {
    tab.goto("warngen/").await?;
    tab.wait_until(
        "document.readyState === 'complete' && typeof countyGeojson !== 'undefined' && !!countyGeojson
         && cityDBAll.length > 0 && !!document.querySelector('.bullet-option')",
        Duration::from_secs(40),
    )
    .await
}

async fn show_omaha(tab: &Tab) -> Result<()> {
    tab.exec(
        "map.setView([41.25, -95.85], 9, { animate: false });",
        json!([]),
    )
    .await
}

/// Viewport pixel of a map point, after scrolling the map into view.
async fn pixel(tab: &Tab, (lat, lng): (f64, f64)) -> Result<(f64, f64)> {
    tab.js(
        "const el = map.getContainer();
         el.scrollIntoView({ block: 'center', inline: 'center' });
         const r = el.getBoundingClientRect();
         const p = map.latLngToContainerPoint([arguments[0], arguments[1]]);
         return [r.left + p.x, r.top + p.y];",
        json!([lat, lng]),
    )
    .await
}

async fn click_map(tab: &Tab, at: (f64, f64)) -> Result<()> {
    let (x, y) = pixel(tab, at).await?;
    tab.click_at(x, y).await
}

async fn right_click_map(tab: &Tab, at: (f64, f64)) -> Result<()> {
    let (x, y) = pixel(tab, at).await?;
    tab.right_click_at(x, y).await
}

async fn selected(tab: &Tab) -> Result<Vec<String>> {
    tab.eval("Object.keys(selectedAreaKeys).sort()").await
}

async fn wait_selected(tab: &Tab, want: &[&str]) -> Result<()> {
    let deadline = std::time::Instant::now() + Duration::from_secs(15);
    loop {
        let got = selected(tab).await?;
        if got == want {
            return Ok(());
        }
        ensure!(
            std::time::Instant::now() < deadline,
            "selection is {got:?}, expected {want:?}"
        );
        tokio::time::sleep(Duration::from_millis(25)).await;
    }
}

const DRAW_POLYGON_JS: &str = "
const [lat, lng, d] = [arguments[0], arguments[1], arguments[2]];
const layer = L.polygon([[lat - d, lng - d], [lat - d, lng + d], [lat + d, lng + d], [lat + d, lng - d]]);
map.fire(L.Draw.Event.CREATED, { layer, layerType: 'polygon' });
return currentRing ? currentRing.length : 0;";

const POLYGON_STATE_JS: &str = "
return {
    ring: currentRing ? currentRing.length : 0,
    layers: drawLayer.getLayers().length,
    polygon: !!currentPolygon,
    status: document.getElementById('status').textContent,
};";

async fn draw_polygon(tab: &Tab) -> Result<()> {
    let points: i64 = tab
        .js(DRAW_POLYGON_JS, json!([DOUGLAS.0, DOUGLAS.1, 0.08]))
        .await?;
    ensure!(points == 5, "the test polygon did not register: {points}");
    Ok(())
}

async fn polygon_state(tab: &Tab) -> Result<Value> {
    tab.js(POLYGON_STATE_JS, json!([])).await
}

pub fn cases() -> Vec<Case> {
    vec![
        case(
            "right_click_removes_a_selected_area_only",
            |tab| async move {
                open(&tab).await?;
                tab.click("#mode-areas").await?;
                show_omaha(&tab).await?;
                click_map(&tab, DOUGLAS).await?;
                wait_selected(&tab, &["NE:31055"]).await?;
                click_map(&tab, POTTAWATTAMIE).await?;
                wait_selected(&tab, &["IA:19155", "NE:31055"]).await?;

                right_click_map(&tab, SARPY).await?;
                tokio::time::sleep(Duration::from_millis(150)).await;
                wait_selected(&tab, &["IA:19155", "NE:31055"]).await?;

                right_click_map(&tab, DOUGLAS).await?;
                wait_selected(&tab, &["IA:19155"]).await?;
                let status: String = tab
                    .eval("document.getElementById('status').textContent")
                    .await?;
                ensure!(
                    status.starts_with("Deselected Douglas County")
                        && status.ends_with("1 area selected."),
                    "{status}"
                );
                let count: String = tab
                    .eval("document.getElementById('area-count').textContent")
                    .await?;
                ensure!(count == "1 selected", "{count}");
                Ok(())
            },
        ),
        case("right_click_inside_deletes_the_polygon", |tab| async move {
            open(&tab).await?;
            show_omaha(&tab).await?;
            draw_polygon(&tab).await?;

            right_click_map(&tab, POTTAWATTAMIE).await?;
            tokio::time::sleep(Duration::from_millis(150)).await;
            let state = polygon_state(&tab).await?;
            ensure!(
                state["ring"] == 5 && state["layers"] == 1,
                "a right-click outside kept nothing: {state}"
            );

            right_click_map(&tab, DOUGLAS).await?;
            tab.wait_until("currentRing === null", Duration::from_secs(10))
                .await?;
            let state = polygon_state(&tab).await?;
            ensure!(
                state["layers"] == 0
                    && state["polygon"] == false
                    && state["status"] == "Polygon deleted.",
                "{state}"
            );
            tab.wait_until(
                "(JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}').polygon ?? null) === null",
                Duration::from_secs(10),
            )
            .await?;
            Ok(())
        }),
        case("edit_and_draw_tools_keep_the_polygon", |tab| async move {
            open(&tab).await?;
            show_omaha(&tab).await?;
            draw_polygon(&tab).await?;

            tab.exec(
                "drawControl._toolbars.edit._modes.edit.handler.enable();",
                json!([]),
            )
            .await?;
            right_click_map(&tab, DOUGLAS).await?;
            tokio::time::sleep(Duration::from_millis(150)).await;
            ensure!(
                polygon_state(&tab).await?["ring"] == 5,
                "deleted while the edit tool was open"
            );
            tab.exec(
                "drawControl._toolbars.edit._modes.edit.handler.disable();",
                json!([]),
            )
            .await?;

            tab.exec("polygonDrawer.enable();", json!([])).await?;
            right_click_map(&tab, DOUGLAS).await?;
            tokio::time::sleep(Duration::from_millis(150)).await;
            ensure!(
                polygon_state(&tab).await?["ring"] == 5,
                "deleted while drawing a new polygon"
            );
            tab.exec("polygonDrawer.disable();", json!([])).await?;

            right_click_map(&tab, DOUGLAS).await?;
            tab.wait_until("currentRing === null", Duration::from_secs(10))
                .await?;
            Ok(())
        }),
    ]
}
