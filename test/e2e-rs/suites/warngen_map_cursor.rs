//! Keyboard and touch access to the WarnGen map. The map is a role="application" widget so NVDA
//! focus mode and JAWS application mode hand the arrow keys to the page; these tests drive the
//! cursor the way a screen reader user would and read back what the live regions would speak.

use eas_tools_e2e::*;

/// Downtown Omaha, in Douglas County NE; ten miles east is Pottawattamie County IA.
const OMAHA: (f64, f64) = (41.2565, -95.9345);
const MILES_PER_DEG_LAT: f64 = 69.0;

async fn open(tab: &Tab) -> Result<()> {
    tab.goto("warngen/").await?;
    tab.wait_until(
        "document.readyState === 'complete' && typeof countyGeojson !== 'undefined' && !!countyGeojson
         && cityDBAll.length > 0 && !!document.querySelector('.bullet-option')",
        Duration::from_secs(40),
    )
    .await
}

async fn live_text(tab: &Tab, region: &str) -> Result<String> {
    tab.js("return document.getElementById(arguments[0]).textContent.replace(/\\u00a0/g, '').trim();", json!([region])).await
}

async fn wait_for_speech(tab: &Tab, region: &str, accept: impl Fn(&str) -> bool) -> Result<String> {
    let deadline = std::time::Instant::now() + Duration::from_secs(15);
    loop {
        let text = live_text(tab, region).await?;
        if accept(&text) {
            return Ok(text);
        }
        ensure!(std::time::Instant::now() < deadline, "#{region} never said the expected thing; it says {text:?}");
        tokio::time::sleep(Duration::from_millis(25)).await;
    }
}

async fn clear_region(tab: &Tab, region: &str) -> Result<()> {
    tab.exec("document.getElementById(arguments[0]).textContent = '';", json!([region])).await
}

async fn focus_map_at(tab: &Tab, (lat, lng): (f64, f64)) -> Result<()> {
    tab.exec(
        "document.getElementById('map').focus();
         clearTimeout(mapFocusTimer);
         placeMapCursor(arguments[0], arguments[1]);
         document.getElementById('map-live').textContent = '';",
        json!([lat, lng]),
    )
    .await
}

/// A key sent to the map, refocusing it first the way Selenium's element.send_keys does.
async fn key(tab: &Tab, name: &str) -> Result<()> {
    tab.exec("const m = document.getElementById('map'); if (document.activeElement !== m) m.focus();", json!([])).await?;
    tab.press(name, &[]).await
}

async fn keys(tab: &Tab, names: &[&str]) -> Result<()> {
    for name in names {
        key(tab, name).await?;
    }
    Ok(())
}

async fn shift_enter(tab: &Tab) -> Result<()> {
    tab.press("Enter", &["Shift"]).await
}

async fn cursor(tab: &Tab) -> Result<(f64, f64)> {
    tab.eval("[mapCursor.lat, mapCursor.lng]").await
}

async fn markers(tab: &Tab) -> Result<i64> {
    tab.eval("polygonDrawer._markers.length").await
}

/// Offsets are fractions of the county's bounding-box half extents, the scale both
/// pointSubdivision and the bulletin's directionalSubdivision measure on.
const PART_OF_COUNTY_JS: &str = r#"
const byFips = (fips) => countyGeojson.features.find((f) => f.properties.fips === fips);
const bounds = (f) => {
    const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const poly of polys) {
        const b = WarngenIntersect.bbox(poly[0]);
        if (b[2] - b[0] <= 0 || b[3] - b[1] <= 0) continue;
        minX = Math.min(minX, b[0]); minY = Math.min(minY, b[1]);
        maxX = Math.max(maxX, b[2]); maxY = Math.max(maxY, b[3]);
    }
    return { minX, minY, maxX, maxY, cx: (minX + maxX) / 2, cy: (minY + maxY) / 2,
             halfW: (maxX - minX) / 2, halfH: (maxY - minY) / 2 };
};
const at = (f, ox, oy) => { const b = bounds(f); return [b.cx + ox * b.halfW, b.cy + oy * b.halfH]; };

const douglas = byFips('31055');
const orleans = byFips('22071');
const richmond = byFips('51760');

const b = bounds(douglas);
const single = { type: 'FeatureCollection', features: [douglas] };
let checked = 0;
const mismatches = [];
for (let i = 1; i < 20; i++) {
    for (let j = 1; j < 20; j++) {
        const pt = [b.minX + (i / 20) * (b.maxX - b.minX), b.minY + (j / 20) * (b.maxY - b.minY)];
        if (!WarngenIntersect.findFeatureContaining(pt, single)) continue;
        const dx = b.halfW * 0.1, dy = b.halfH * 0.1;
        const ring = [[pt[0] - dx, pt[1] - dy], [pt[0] + dx, pt[1] - dy], [pt[0] + dx, pt[1] + dy],
                      [pt[0] - dx, pt[1] + dy], [pt[0] - dx, pt[1] - dy]];
        const point = WarngenIntersect.pointSubdivision(pt, douglas).join(' ');
        const bulletin = WarngenIntersect.directionalSubdivision(ring, douglas).join(' ');
        checked++;
        if (point !== bulletin) mismatches.push(pt.join(',') + ' point=' + point + ' bulletin=' + bulletin);
    }
}

return {
    central: countyPositionLabel(douglas, at(douglas, 0, 0), true),
    extreme: countyPositionLabel(douglas, at(douglas, -0.9, 0.9), true),
    parish: countyPositionLabel(orleans, at(orleans, 0, 0.5), false),
    city: countyPositionLabel(richmond, at(richmond, 0.5, 0), true),
    checked: checked,
    mismatches: mismatches,
};
"#;

pub fn cases() -> Vec<Case> {
    vec![
        case("map_is_a_described_application_with_leaflet_keys_off", |tab| async move {
            open(&tab).await?;
            let info: Value = tab
                .eval(
                    "(() => { const m = document.getElementById('map');
                       const hint = document.getElementById(m.getAttribute('aria-describedby'));
                       return { role: m.getAttribute('role'), tabindex: m.getAttribute('tabindex'), label: m.getAttribute('aria-label'),
                                hint: hint ? hint.textContent.trim() : '', leafletKeyboard: map.keyboard.enabled(),
                                markerTabStops: L.Marker.prototype.options.keyboard }; })()",
                )
                .await?;
            ensure!(info["role"] == "application" && info["tabindex"] == "0", "{info}");
            ensure!(info["label"].as_str().is_some_and(|l| !l.is_empty()), "{info}");
            ensure!(info["hint"].as_str().unwrap_or("").contains("Arrow keys"), "{info}");
            ensure!(info["leafletKeyboard"] == false, "Leaflet's own arrow/zoom keys would fight the cursor");
            ensure!(info["markerTabStops"] == false, "{info}");
            Ok(())
        }),
        case("arrows_move_the_cursor_and_announce_county_changes", |tab| async move {
            open(&tab).await?;
            focus_map_at(&tab, OMAHA).await?;
            key(&tab, " ").await?;
            let text = wait_for_speech(&tab, "map-live", |t| t.contains("In southeastern Douglas County, Nebraska")).await?;
            ensure!(text.contains("Step 5 miles") && text.contains("41.26 north, 95.93 west"), "{text}");

            clear_region(&tab, "map-live").await?;
            let start = cursor(&tab).await?;
            key(&tab, "ArrowUp").await?;
            let text = wait_for_speech(&tab, "map-live", |t| !t.is_empty()).await?;
            let moved = cursor(&tab).await?;
            ensure!(((moved.0 - start.0) - 5.0 / MILES_PER_DEG_LAT).abs() < 1e-9, "{start:?} -> {moved:?}");
            ensure!((moved.1 - start.1).abs() < 1e-12, "{start:?} -> {moved:?}");
            ensure!(text.starts_with("In northeastern Douglas County."), "{text}");
            ensure!(!text.contains("Nebraska"), "a new part of the same county should not repeat the state: {text}");

            key(&tab, "-").await?;
            wait_for_speech(&tab, "map-live", |t| t.contains("Step 10 miles")).await?;
            key(&tab, "ArrowRight").await?;
            wait_for_speech(&tab, "map-live", |t| t.starts_with("In western Pottawattamie County, Iowa")).await?;
            Ok(())
        }),
        case("staying_in_one_part_of_a_county_only_reads_the_city", |tab| async move {
            open(&tab).await?;
            focus_map_at(&tab, OMAHA).await?;
            key(&tab, " ").await?;
            wait_for_speech(&tab, "map-live", |t| t.contains("In southeastern Douglas County")).await?;
            for expected in ["Step 2 miles.", "Step 1 mile."] {
                key(&tab, "+").await?;
                wait_for_speech(&tab, "map-live", |t| t.contains(expected)).await?;
            }
            clear_region(&tab, "map-live").await?;
            key(&tab, "ArrowLeft").await?;
            let text = wait_for_speech(&tab, "map-live", |t| !t.is_empty()).await?;
            ensure!(!text.contains("County"), "a step that stays in southeastern Douglas County should only read the city: {text}");
            Ok(())
        }),
        case("part_of_county_wording_matches_the_bulletins", |tab| async move {
            open(&tab).await?;
            let result: Value = tab.js(PART_OF_COUNTY_JS, json!([])).await?;
            ensure!(result["central"] == "In central Douglas County, Nebraska", "{result}");
            ensure!(result["extreme"] == "In extreme northwestern Douglas County, Nebraska", "{result}");
            ensure!(result["parish"] == "In northern Orleans Parish", "{result}");
            ensure!(result["city"] == "In the eastern part of the City of Richmond, Virginia", "{result}");
            ensure!(result["checked"].as_i64().unwrap_or(0) > 200, "{result}");
            ensure!(
                result["mismatches"].as_array().is_some_and(|m| m.is_empty()),
                "the cursor names a different part of Douglas County than a bulletin would: {}",
                result["mismatches"]
            );
            Ok(())
        }),
        case("plus_and_minus_walk_the_step_sizes", |tab| async move {
            open(&tab).await?;
            focus_map_at(&tab, OMAHA).await?;
            for expected in ["Step 2 miles.", "Step 1 mile.", "Step half a mile.", "Smallest step."] {
                key(&tab, "+").await?;
                wait_for_speech(&tab, "map-live", |t| t.contains(expected)).await?;
            }
            key(&tab, "PageDown").await?;
            wait_for_speech(&tab, "map-live", |t| t == "Step 1 mile.").await?;
            Ok(())
        }),
        case("keyboard_polygon_closes_and_renders_the_bulletin", |tab| async move {
            open(&tab).await?;
            focus_map_at(&tab, OMAHA).await?;
            key(&tab, "-").await?;
            wait_for_speech(&tab, "map-live", |t| t.contains("Step 10 miles")).await?;
            key(&tab, "Enter").await?;
            wait_for_speech(&tab, "map-live", |t| t.contains("Point 1.")).await?;
            for step in ["ArrowUp", "ArrowLeft", "ArrowDown"] {
                keys(&tab, &[step, "Enter"]).await?;
            }
            wait_for_speech(&tab, "map-live", |t| t.contains("Point 4.")).await?;
            ensure!(markers(&tab).await? == 4);

            clear_region(&tab, "status-live").await?;
            shift_enter(&tab).await?;
            let text = wait_for_speech(&tab, "map-live", |t| t.contains("Polygon closed with 4 points")).await?;
            ensure!(text.contains("Douglas County, Nebraska"), "{text}");
            let state: Value = tab
                .eval(
                    "({ ring: currentRing && currentRing.length, drawing: polygonDrawer.enabled(),
                        impacted: document.getElementById('impacted-list').textContent,
                        output: document.getElementById('output').textContent })",
                )
                .await?;
            ensure!(state["ring"] == 5 && state["drawing"] == false, "{state}");
            ensure!(state["impacted"].as_str().unwrap_or("").contains("Douglas"), "{state}");
            ensure!(state["output"].as_str().unwrap_or("").to_lowercase().contains("douglas"), "{state}");
            let status = live_text(&tab, "status-live").await?;
            ensure!(!status.contains("Rendered"), "the render summary should stay quiet during a map command: {status}");
            Ok(())
        }),
        case("backspace_removes_points_then_cancels", |tab| async move {
            open(&tab).await?;
            focus_map_at(&tab, OMAHA).await?;
            keys(&tab, &["Enter", "ArrowUp", "Enter"]).await?;
            wait_for_speech(&tab, "map-live", |t| t.contains("Point 2.")).await?;
            key(&tab, "Backspace").await?;
            wait_for_speech(&tab, "map-live", |t| t == "Removed point 2. 1 point left.").await?;
            key(&tab, "Backspace").await?;
            wait_for_speech(&tab, "map-live", |t| t == "Polygon drawing cancelled.").await?;
            ensure!(!tab.eval::<bool>("polygonDrawer.enabled()").await?);
            Ok(())
        }),
        case("close_refuses_short_flat_and_crossing_shapes", |tab| async move {
            open(&tab).await?;
            focus_map_at(&tab, OMAHA).await?;
            shift_enter(&tab).await?;
            wait_for_speech(&tab, "map-live", |t| t.starts_with("No polygon in progress")).await?;

            keys(&tab, &["Enter", "ArrowUp", "Enter"]).await?;
            shift_enter(&tab).await?;
            wait_for_speech(&tab, "map-live", |t| t.contains("needs at least 3 points")).await?;

            keys(&tab, &["ArrowUp", "Enter"]).await?;
            shift_enter(&tab).await?;
            wait_for_speech(&tab, "map-live", |t| t.contains("in a straight line")).await?;

            keys(&tab, &["Backspace", "Backspace", "Backspace"]).await?;
            wait_for_speech(&tab, "map-live", |t| t == "Polygon drawing cancelled.").await?;

            // (0,0) (2,0) (2,2) (3,1) in five-mile steps: the closing edge crosses the right side.
            focus_map_at(&tab, OMAHA).await?;
            key(&tab, "Enter").await?;
            for moves in [["ArrowRight", "ArrowRight"], ["ArrowUp", "ArrowUp"], ["ArrowRight", "ArrowDown"]] {
                keys(&tab, &moves).await?;
                key(&tab, "Enter").await?;
            }
            wait_for_speech(&tab, "map-live", |t| t.contains("Point 4.")).await?;
            shift_enter(&tab).await?;
            wait_for_speech(&tab, "map-live", |t| t.contains("closing edge would cross")).await?;

            // From (3,1) to (0,-1) cuts through the bottom edge.
            keys(&tab, &["ArrowLeft", "ArrowLeft", "ArrowLeft", "ArrowDown", "ArrowDown", "Enter"]).await?;
            wait_for_speech(&tab, "map-live", |t| t.contains("Can't place a point here")).await?;
            ensure!(markers(&tab).await? == 4);
            Ok(())
        }),
        case("enter_toggles_the_county_in_whole_area_mode", |tab| async move {
            open(&tab).await?;
            tab.click("#mode-areas").await?;
            let place: String = tab.eval("document.getElementById('map-pad-place').textContent").await?;
            ensure!(place == "Select area", "{place}");
            focus_map_at(&tab, OMAHA).await?;
            key(&tab, "Enter").await?;
            let text = wait_for_speech(&tab, "map-live", |t| t.starts_with("Selected")).await?;
            ensure!(text.contains("Douglas County, Nebraska") && text.contains("1 area selected"), "{text}");
            ensure!(tab.eval::<bool>("!!selectedAreaKeys['NE:31055']").await?);
            key(&tab, "Enter").await?;
            wait_for_speech(&tab, "map-live", |t| t.starts_with("Deselected")).await?;
            ensure!(!tab.eval::<bool>("!!selectedAreaKeys['NE:31055']").await?);
            Ok(())
        }),
        case("status_messages_reach_the_live_regions", |tab| async move {
            open(&tab).await?;
            const RAW: &str = "document.getElementById('status-live').textContent";
            tab.exec("setStatus('Copied 12 chars to clipboard.', false);", json!([])).await?;
            let first: String = tab.eval(RAW).await?;
            ensure!(live_text(&tab, "status-live").await? == "Copied 12 chars to clipboard.");
            tab.exec("setStatus('Copied 12 chars to clipboard.', false);", json!([])).await?;
            ensure!(tab.eval::<String>(RAW).await? != first, "a repeated message must still change the region to be re-read");

            tab.exec("setStatus('Import failed: bad file', true);", json!([])).await?;
            ensure!(live_text(&tab, "status-alert").await? == "Import failed: bad file");
            ensure!(tab.eval::<String>("document.getElementById('status').innerText").await? == "Import failed: bad file");

            tab.exec("setStatus('Rendered quietly', false, '');", json!([])).await?;
            ensure!(tab.eval::<String>("document.getElementById('status').innerText").await? == "Rendered quietly");
            ensure!(live_text(&tab, "status-live").await? != "Rendered quietly");
            Ok(())
        }),
        case("render_summary_is_spoken_only_when_it_changes", |tab| async move {
            open(&tab).await?;
            tab.click("#mode-areas").await?;
            let pick = |fips: &'static str| {
                let tab = tab.clone();
                async move {
                    tab.exec(
                        "const fips = arguments[0]; toggleAreaSelection(visibleCounties.features.find((f) => f.properties.fips === fips));",
                        json!([fips]),
                    )
                    .await
                }
            };
            pick("31055").await?;
            wait_for_speech(&tab, "status-live", |t| t.starts_with("Rendered 1 counties")).await?;
            clear_region(&tab, "status-live").await?;
            tab.exec("doRender();", json!([])).await?;
            ensure!(live_text(&tab, "status-live").await?.is_empty(), "an identical re-render should not be spoken again");
            pick("31153").await?;
            wait_for_speech(&tab, "status-live", |t| t.starts_with("Rendered 2 counties")).await?;
            Ok(())
        }),
        case("touch_pad_drives_the_cursor_without_stealing_focus", |tab| async move {
            open(&tab).await?;
            // Chrome is launched with a fine primary pointer, so this checks the stylesheet
            // rather than the host's touch digitizer.
            let display: String = tab.eval("getComputedStyle(document.getElementById('map-pad')).display").await?;
            ensure!(display == "none", "the pad should stay hidden on a wide mouse-first window");
            tab.set_viewport(480, 1000).await?;
            tab.wait_until("document.getElementById('map-pad').offsetParent !== null", Duration::from_secs(15)).await?;

            tab.exec("placeMapCursor(arguments[0], arguments[1]);", json!([OMAHA.0, OMAHA.1])).await?;
            tab.click("[data-map-cmd=\"north\"]").await?;
            wait_for_speech(&tab, "map-live", |t| !t.is_empty()).await?;
            tab.click("#map-pad-place").await?;
            wait_for_speech(&tab, "map-live", |t| t.contains("Point 1.")).await?;
            ensure!(
                tab.active_id().await? == "map-pad-place",
                "Leaflet.draw focuses the map when drawing starts; the pad must keep focus"
            );
            axe::assert_clean(
                &tab,
                json!({ "include": [["#map"], ["#map-pad"], ["#map-live"], ["#status-live"], ["#status-alert"]] }),
                &[],
                "map cursor",
            )
            .await
        }),
    ]
}
