//! WarnGen draws Alaska, Hawaii and the territories where they really are (GH #171): roads
//! stay in their states, shapes stay whole across the antimeridian, products print real
//! coordinates, and sessions saved by the old inset map are moved over once.

use eas_tools_e2e::*;

/// Same origin as WarnGen but runs none of its code.
const BLANK_PAGE: &str = "test/e2e-rs/fixtures/blank.html";

const PRODUCT_JS: &str = "(() => { const raw = lastRawOutput;
   const ll = raw.match(/^LAT\\.\\.\\.LON[\\s\\S]*?(?=\\n[A-Z$&]|\\n\\n|$)/m);
   const hw = raw.match(/This includes the following highways[\\s\\S]*?\\n\\n/);
   return { latlon: ll ? ll[0].replace(/\\s+/g, ' ') : '',
            highways: hw ? hw[0].replace(/\\s+/g, ' ').trim() : '' }; })()";

#[derive(serde::Deserialize)]
struct Rendered {
    latlon: String,
    highways: String,
}

/// Opens WarnGen on a saved session. A booting WarnGen page reads the session, then saves it
/// again from the bullet panel's deferred first onChange (a setTimeout that hidden-tab throttling
/// can hold for a second), so a session written from that page in between is overwritten.
/// Writing it from a page without WarnGen's code rules that out.
async fn open_with(tab: &Tab, state: &Value) -> Result<()> {
    tab.goto(BLANK_PAGE).await?;
    tab.local_storage_set("warngen-state-v1", &state.to_string())
        .await?;
    tab.goto("warngen/").await
}

async fn load_state(tab: &Tab, state: Value) -> Result<Rendered> {
    open_with(tab, &state).await?;
    tab.wait_until(
        "typeof lastRawOutput !== 'undefined' && /^LAT\\.\\.\\.LON/m.test(lastRawOutput || '')",
        Duration::from_secs(60),
    )
    .await?;
    tab.eval(PRODUCT_JS).await
}

fn state(ring: Value, office: &str) -> Value {
    json!({
        "polygon": ring, "selectionMode": "polygon", "bullets": [],
        "form": { "era": "modern", "office": office, "mode": "O", "etn": "1", "issued": "2026-06-14T15:12",
                  "allcaps": false, "wrap": true, "highways": true },
    })
}

/// A small square around a real point, east longitudes unwrapped the way the map draws them.
async fn render(tab: &Tab, lon: f64, lat: f64, office: &str) -> Result<Rendered> {
    let x = if lon > 0.0 { lon - 360.0 } else { lon };
    let d = 0.06;
    let ring = json!([
        [x - d, lat - d],
        [x + d, lat - d],
        [x + d, lat + d],
        [x - d, lat + d],
        [x - d, lat - d]
    ]);
    load_state(tab, state(ring, office)).await
}

fn pairs(latlon: &str) -> Vec<(f64, f64)> {
    let nums: Vec<f64> = latlon
        .split_whitespace()
        .filter_map(|w| w.parse::<f64>().ok())
        .collect();
    nums.chunks(2)
        .map(|c| (c[0] / 100.0, c[1] / 100.0))
        .collect()
}

/// Every LAT...LON pair within 0.2 degrees of the real point; both print unsigned.
fn ensure_near(latlon: &str, lon: f64, lat: f64, what: &str) -> Result<()> {
    let pts = pairs(latlon);
    ensure!(!pts.is_empty(), "{what}: no LAT...LON");
    for (la, lo) in pts {
        ensure!(
            (la - lat.abs()).abs() < 0.2 && (lo - lon.abs()).abs() < 0.2,
            "{what}: {latlon} is not near {lat},{lon}"
        );
    }
    Ok(())
}

pub fn cases() -> Vec<Case> {
    vec![
        case(
            "arizona_polygons_print_arizona_coordinates",
            |tab| async move {
                for (lon, lat, office) in [(-110.97, 32.22, "TWC"), (-112.07, 33.45, "PSR")] {
                    let r = render(&tab, lon, lat, office).await?;
                    ensure_near(&r.latlon, lon, lat, office)?;
                }
                Ok(())
            },
        ),
        case(
            "territory_polygons_print_real_coordinates",
            |tab| async move {
                for (lon, lat, office, what) in [
                    (144.78, 13.45, "GUM", "Guam"),
                    (145.21, 14.15, "GUM", "Rota"),
                    (145.74, 15.19, "GUM", "Saipan"),
                    (172.90, 52.85, "AFC", "Attu"),
                    (-149.95, 61.20, "AFC", "Anchorage"),
                    (-157.85, 21.33, "HFO", "Honolulu"),
                    (-170.70, -14.28, "PPG", "Pago Pago"),
                    (-66.06, 18.40, "SJU", "San Juan"),
                    (-64.75, 17.73, "SJU", "St. Croix"),
                ] {
                    let r = render(&tab, lon, lat, office).await?;
                    ensure_near(&r.latlon, lon, lat, what)?;
                    ensure!(!r.highways.contains("Interstate"), "{what}: {}", r.highways);
                }
                Ok(())
            },
        ),
        case(
            "alaska_and_hawaii_polygons_list_their_roads",
            |tab| async move {
                let ak = render(&tab, -149.95, 61.20, "AFC").await?;
                ensure!(ak.highways.contains("Highway 1"), "AK: {:?}", ak.highways);
                let hi = render(&tab, -157.85, 21.33, "HFO").await?;
                ensure!(hi.highways.contains("Highway 61"), "HI: {:?}", hi.highways);
                Ok(())
            },
        ),
        case("roads_and_territories_sit_on_real_land", |tab| async move {
            tab.goto("warngen/").await?;
            tab.wait_until(
                "typeof highwaysGeojson !== 'undefined' && highwaysGeojson.features.length > 0 && !!countyGeojson",
                Duration::from_secs(40),
            )
            .await?;
            let wrong: Vec<String> = tab
                .eval(
                    "(() => { const out = [];
                       const each = (c, f) => typeof c[0] === 'number' ? f(c) : c.forEach((x) => each(x, f));
                       const boxes = {};
                       countyGeojson.features.forEach((f) => {
                         const b = boxes[f.properties.state] || (boxes[f.properties.state] = [1e9, 1e9, -1e9, -1e9]);
                         each(f.geometry.coordinates, (p) => { b[0] = Math.min(b[0], p[0]); b[1] = Math.min(b[1], p[1]);
                           b[2] = Math.max(b[2], p[0]); b[3] = Math.max(b[3], p[1]); });
                       });
                       const inBox = (b, p) => p[0] >= b[0] - 0.25 && p[1] >= b[1] - 0.25 && p[0] <= b[2] + 0.25 && p[1] <= b[3] + 0.25;
                       const all = Object.values(boxes);
                       highwaysGeojson.features.forEach((f) => each(f.geometry.coordinates, (p) => {
                         if (!all.some((b) => inBox(b, p))) out.push(f.properties.displayName + ' ' + p);
                       }));
                       const gu = boxes.GU, ak = boxes.AK;
                       if (!(gu[0] < -214 && gu[2] > -216 && gu[1] > 13 && gu[3] < 14)) out.push('Guam at ' + gu);
                       if (!(ak[0] < -185 && ak[3] > 70)) out.push('Alaska at ' + ak);
                       if (boxes.AZ[1] < 31) out.push('Arizona at ' + boxes.AZ);
                       return out.slice(0, 10); })()",
                )
                .await?;
            ensure!(wrong.is_empty(), "{wrong:?}");
            Ok(())
        }),
        case(
            "polygons_stay_whole_across_the_antimeridian",
            |tab| async move {
                open_with(&tab, &state(Value::Null, "AFC")).await?;
                // The office is set in the same task that finishes WarnGen's boot.
                tab.wait_until(
                "typeof countyGeojson !== 'undefined' && !!countyGeojson && cityDBAll.length > 0
                 && document.getElementById('office-select').value === 'AFC'",
                Duration::from_secs(40),
            )
            .await?;
                let ring: Vec<Vec<f64>> = tab
                    .eval(
                        "(() => {
                       polygonDrawer.enable();
                       [[51.3, -181.0], [51.3, -179.6], [51.7, -179.6], [51.7, -181.0]]
                         .forEach((p) => polygonDrawer.addVertex(L.latLng(p[0], p[1])));
                       polygonDrawer.completeShape();
                       return currentRing; })()",
                    )
                    .await?;
                ensure!(ring.len() == 5, "{ring:?}");
                for p in &ring {
                    ensure!(p[0] > -181.01 && p[0] < -179.59, "vertex jumped: {ring:?}");
                }
                tab.wait_until(
                    "/^LAT\\.\\.\\.LON/m.test(lastRawOutput || '') && /AKC016/.test(lastRawOutput)",
                    Duration::from_secs(30),
                )
                .await?;
                let r: Rendered = tab.eval(PRODUCT_JS).await?;
                for (la, lo) in pairs(&r.latlon) {
                    ensure!(
                        (51.2..51.8).contains(&la) && (179.0..=180.0).contains(&lo),
                        "{}",
                        r.latlon
                    );
                }
                Ok(())
            },
        ),
        case(
            "sessions_saved_by_the_inset_map_move_once",
            |tab| async move {
                // Guam as the old map stored it: 256 degrees west and 19 north of where it is.
                let d = 0.06;
                let (x, y) = (144.78 - 256.0, 13.45 + 19.0);
                let old = json!([
                    [x - d, y - d],
                    [x + d, y - d],
                    [x + d, y + d],
                    [x - d, y + d],
                    [x - d, y - d]
                ]);
                let first = load_state(&tab, state(old, "GUM")).await?;
                ensure_near(&first.latlon, 144.78, 13.45, "migrated Guam")?;
                let stored: Value = tab
                .eval("(() => { saveState(); return JSON.parse(localStorage.getItem('warngen-state-v1')); })()")
                .await?;
                ensure!(stored["geo"] == json!(1), "{stored}");
                let lon = stored["polygon"][0][0].as_f64().context("no polygon")?;
                ensure!(lon < -215.0 && lon > -216.0, "{stored}");
                tab.goto("warngen/").await?;
                tab.wait_until(
                "typeof lastRawOutput !== 'undefined' && /^LAT\\.\\.\\.LON/m.test(lastRawOutput || '')",
                Duration::from_secs(60),
            )
            .await?;
                let again: Rendered = tab.eval(PRODUCT_JS).await?;
                ensure!(
                    again.latlon == first.latlon,
                    "{} vs {}",
                    again.latlon,
                    first.latlon
                );
                Ok(())
            },
        ),
    ]
}
