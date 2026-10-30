//! The synthetic radar generator: Level II volume shape, determinism, storm structure, and the
//! dialog that drives it.

use eas_tools_e2e::*;

use crate::warngen_radar::{open_warngen, wait_for_map_to_settle};

const GENERATE_JS: &str = "
const opts = Object.assign({
    site: arguments[0], icao: 'KOAX', storm: arguments[1],
    motionBearing: 45, motionSpeedMph: 35, type: 'supercell',
    tornadic: false, intensity: 'moderate', seed: 1234,
    time: Date.UTC(2026, 4, 20, 22, 0, 0)
}, arguments[2] || {});
window.__synth = WarngenRadarSynth.generate(opts);";

/// Samples a moment through the same raster the map paints from.
const SAMPLE_JS: &str = "
const vol = window.__synth;
const raster = WarngenRadarLayer.buildRaster(vol, vol.sweeps[arguments[2] || 0], arguments[0],
    WarngenRadarPalette.defaultTable(arguments[0]));
const p = arguments[1];
const s = WarngenRadarLayer.sample(raster, p.lat, p.lon);
return s ? s.value : 'OUT';";

const OFFSET_JS: &str = "
const p = arguments[0], bearing = arguments[1], km = arguments[2];
const R = 6371, d = km / R, t = bearing * Math.PI / 180;
const p1 = p.lat * Math.PI / 180, l1 = p.lon * Math.PI / 180;
const p2 = Math.asin(Math.sin(p1) * Math.cos(d) + Math.cos(p1) * Math.sin(d) * Math.cos(t));
const l2 = l1 + Math.atan2(Math.sin(t) * Math.sin(d) * Math.cos(p1), Math.cos(d) - Math.sin(p1) * Math.sin(p2));
return { lat: p2 * 180 / Math.PI, lon: l2 * 180 / Math.PI };";

const DIGEST_JS: &str = "(() => {
    const v = window.__synth;
    let h = 2166136261 >>> 0;
    for (const s of v.sweeps) for (const r of s.radials) for (const k of s.moments) {
        const d = r.moments[k].data;
        for (let i = 0; i < d.length; i++) h = Math.imul(h ^ d[i], 16777619) >>> 0;
    }
    return h;
})()";

fn koax() -> Value {
    json!({ "lat": 41.32, "lon": -96.37 })
}

fn storm() -> Value {
    json!({ "lat": 41.75, "lon": -96.95 })
}

async fn generate(tab: &Tab, overrides: Value) -> Result<()> {
    tab.exec(GENERATE_JS, json!([koax(), storm(), overrides])).await
}

/// Equality that treats 2 and 2.0 alike, since CDP may hand back either.
fn same_json(a: &Value, b: &Value) -> bool {
    match (a, b) {
        (Value::Number(x), Value::Number(y)) => x.as_f64() == y.as_f64(),
        (Value::Array(x), Value::Array(y)) => x.len() == y.len() && x.iter().zip(y).all(|(p, q)| same_json(p, q)),
        _ => a == b,
    }
}

/// None when the gate is empty; an error when the point is off the raster.
async fn sample(tab: &Tab, moment: &str, point: &Value, sweep: i64) -> Result<Option<f64>> {
    let value: Value = tab.js(SAMPLE_JS, json!([moment, point, sweep])).await?;
    ensure!(value != "OUT", "{point} is outside the {moment} raster");
    Ok(value.as_f64())
}

async fn offset(tab: &Tab, point: &Value, bearing: f64, km: f64) -> Result<Value> {
    tab.js(OFFSET_JS, json!([point, bearing, km])).await
}

async fn shown(tab: &Tab, id: &str) -> Result<bool> {
    tab.js("return document.getElementById(arguments[0]).checkVisibility();", json!([id])).await
}

pub fn cases() -> Vec<Case> {
    let mut cases = vec![
        case("volume_matches_the_level2_shape", |tab| async move {
            open_warngen(&tab).await?;
            generate(&tab, Value::Null).await?;
            let shape: Value = tab
                .eval(
                    "(() => { const v = window.__synth; const s = v.sweeps[0]; const r = s.radials[0]; const m = r.moments.REF;
                       return {
                           icao: v.icao, vcp: v.vcp, time: v.time.toISOString(), site: [v.site.lat, v.site.lon],
                           elevations: v.sweeps.map((x) => x.elevation), cuts: v.sweeps.map((x) => x.elevationNumber),
                           indexes: v.sweeps.map((x) => x.index), sweepTimes: v.sweeps.map((x) => x.time - v.time.getTime()),
                           moments: s.moments, radials: v.sweeps.map((x) => x.radials.length),
                           firstAz: r.azimuth, lastAz: s.radials[719].azimuth, res: r.azimuthResolution,
                           status: [r.status, s.radials[1].status, s.radials[719].status, v.sweeps[5].radials[719].status],
                           ref: [m.name, m.gates, m.first, m.spacing, m.wordSize, m.scale, m.offset, m.data.length, m.data instanceof Uint8Array],
                           enc: ['VEL', 'SW', 'ZDR', 'RHO'].map((k) => [r.moments[k].scale, r.moments[k].offset]),
                           sorted: s.radials.every((x, i) => i === 0 || x.azimuth > s.radials[i - 1].azimuth),
                           synthetic: v.synthetic.type,
                       }; })()",
                )
                .await?;
            let expected = json!({
                "icao": "KOAX", "vcp": 212, "time": "2026-05-20T22:00:00.000Z", "site": [41.32, -96.37],
                "elevations": [0.5, 0.9, 1.3, 1.8, 2.4, 3.1], "cuts": [1, 2, 3, 4, 5, 6], "indexes": [0, 1, 2, 3, 4, 5],
                "sweepTimes": [0, 13000, 26000, 39000, 52000, 65000], "moments": ["REF", "VEL", "SW", "ZDR", "RHO"],
                "radials": [720, 720, 720, 720, 720, 720], "firstAz": 0.25, "lastAz": 359.75, "res": 0.5,
                "status": [3, 1, 2, 4], "ref": ["REF", 920, 2125, 250, 8, 2, 66, 920, true],
                "enc": [[2, 129], [2, 129], [16, 128], [300, -60.5]], "sorted": true, "synthetic": "supercell",
            });
            for (key, want) in expected.as_object().unwrap() {
                ensure!(same_json(&shape[key], want), "{key}: got {}, want {want}", shape[key]);
            }
            Ok(())
        }),
        case("same_seed_is_byte_identical_and_a_new_seed_is_not", |tab| async move {
            open_warngen(&tab).await?;
            generate(&tab, json!({ "seed": 99 })).await?;
            let a: u64 = tab.eval(DIGEST_JS).await?;
            generate(&tab, json!({ "seed": 99 })).await?;
            let b: u64 = tab.eval(DIGEST_JS).await?;
            generate(&tab, json!({ "seed": 100 })).await?;
            let c: u64 = tab.eval(DIGEST_JS).await?;
            ensure!(a == b, "same seed gave {a} and {b}");
            ensure!(a != c, "a new seed gave the same volume");
            Ok(())
        }),
    ];
    for storm_type in ["supercell", "qlcs"] {
        cases.push(case(format!("core_is_intense_and_clear_air_is_empty[{storm_type}]"), move |tab| async move {
            open_warngen(&tab).await?;
            generate(&tab, json!({ "type": storm_type })).await?;
            let core: Value = tab.eval("window.__synth.synthetic.features.core").await?;
            let at_core = sample(&tab, "REF", &core, 0).await?;
            ensure!(at_core.is_some_and(|v| v >= 55.0), "core REF {at_core:?}");
            let away = offset(&tab, &storm(), 135.0, 120.0).await?;
            ensure!(sample(&tab, "REF", &away, 0).await?.is_none());
            ensure!(sample(&tab, "VEL", &away, 0).await?.is_none());
            Ok(())
        }));
    }
    cases.push(case("tornadic_supercell_has_a_couplet_and_a_debris_ball", |tab| async move {
        open_warngen(&tab).await?;
        generate(&tab, json!({ "tornadic": true, "intensity": "strong" })).await?;
        let tornado: Value = tab.eval("window.__synth.synthetic.features.tornado").await?;
        let bearing: f64 = tab
            .js(
                "const t = arguments[0]; return WarngenRadarLayer.bearingDistance(arguments[1].lat, arguments[1].lon, t.lat, t.lon).bearing;",
                json!([tornado, koax()]),
            )
            .await?;
        let left = sample(&tab, "VEL", &offset(&tab, &tornado, bearing - 90.0, 0.5).await?, 0).await?.context("no inbound velocity")?;
        let right = sample(&tab, "VEL", &offset(&tab, &tornado, bearing + 90.0, 0.5).await?, 0).await?.context("no outbound velocity")?;
        ensure!(left < 0.0 && 0.0 < right && right - left >= 50.0, "couplet {left} / {right}");
        let rho = sample(&tab, "RHO", &tornado, 0).await?;
        ensure!(rho.is_some_and(|v| v < 0.85), "debris RHO {rho:?}");
        let refl = sample(&tab, "REF", &tornado, 0).await?;
        ensure!(refl.is_some_and(|v| v >= 50.0), "debris REF {refl:?}");
        let behind = sample(&tab, "RHO", &offset(&tab, &tornado, bearing + 180.0, 30.0).await?, 0).await?;
        ensure!(behind.map_or(true, |v| (v - 0.98).abs() <= 0.06), "RHO behind the storm {behind:?}");
        Ok(())
    }));
    cases.push(case("non_tornadic_supercell_has_no_debris_ball", |tab| async move {
        open_warngen(&tab).await?;
        generate(&tab, json!({ "tornadic": false })).await?;
        let features: Value = tab.eval("window.__synth.synthetic.features").await?;
        ensure!(features["tornado"].is_null(), "{features}");
        let rho = sample(&tab, "RHO", &features["meso"], 0).await?;
        ensure!(rho.map_or(true, |v| v > 0.9), "{rho:?}");
        Ok(())
    }));
    cases.push(case("storm_out_of_range_is_refused", |tab| async move {
        open_warngen(&tab).await?;
        let message: String = tab
            .js(
                "try { WarngenRadarSynth.generate({ site: arguments[0], storm: { lat: 45.5, lon: -96.4 }, seed: 1 }); return 'no error'; }
                 catch (e) { return e.message; }",
                json!([koax()]),
            )
            .await?;
        ensure!(message.starts_with("The storm is 289 mi from the radar"), "{message}");
        Ok(())
    }));
    cases.push(case("dialog_generates_a_volume_that_paints", |tab| async move {
        open_warngen(&tab).await?;
        wait_for_map_to_settle(&tab).await?;
        tab.exec("map.setView(L.latLng(41.75, -96.95), 8, { animate: false });", json!([])).await?;
        tab.click("#radar-synth-btn").await?;
        ensure!(shown(&tab, "synth-overlay").await?, "the dialog did not open");
        ensure!(tab.active_id().await? == "synth-type");
        let defaults: Vec<String> = tab
            .eval("['synth-icao', 'synth-site-lat', 'synth-site-lon', 'synth-storm-lat', 'synth-storm-lon', 'synth-seed'].map((id) => document.getElementById(id).value)")
            .await?;
        ensure!(defaults[0] == "KOAX" && defaults.iter().all(|d| !d.is_empty()), "{defaults:?}");
        let (lat, lon): (f64, f64) = (defaults[3].parse()?, defaults[4].parse()?);
        ensure!((lat - 41.75).abs() < 0.01 && (lon + 96.95).abs() < 0.01, "{defaults:?}");

        tab.focus("#synth-type").await?;
        tab.press("Escape", &[]).await?;
        ensure!(!shown(&tab, "synth-overlay").await?, "Escape did not close the dialog");
        ensure!(tab.active_id().await? == "radar-synth-btn");

        tab.click("#radar-synth-btn").await?;
        tab.exec("document.getElementById('synth-tornadic').checked = true;", json!([])).await?;
        tab.click("#synth-generate-btn").await?;
        tab.wait_until("/^Generated a synthetic/.test(document.getElementById('status').textContent)", Duration::from_secs(30)).await?;
        ensure!(!shown(&tab, "synth-overlay").await?);
        let info: String = tab.eval("document.getElementById('radar-info').innerText").await?;
        ensure!(info.starts_with("SYNTHETIC KOAX ") && info.contains("VCP 212") && info.contains("made-up"), "{info}");
        let products: Vec<String> = tab.eval("Array.from(document.querySelectorAll('#radar-product option'), (o) => o.value)").await?;
        ensure!(products == ["REF", "VEL", "SW", "ZDR", "RHO"], "{products:?}");
        ensure!(tab.eval::<i64>("document.querySelectorAll('#radar-tilt option').length").await? == 6);
        let painted: i64 = tab
            .js_async(
                "const done = arguments[arguments.length - 1];
                 radarLayer.once('load', () => {
                     let painted = 0;
                     map.getPane('radarPane').querySelectorAll('canvas').forEach((c) => {
                         const px = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
                         for (let i = 3; i < px.length; i += 4) if (px[i]) painted++;
                     });
                     done(painted);
                 });
                 radarLayer.redraw();",
                json!([]),
            )
            .await?;
        ensure!(painted > 5000, "{painted} painted pixels");
        Ok(())
    }));
    cases.push(case("dialog_reports_an_out_of_range_storm", |tab| async move {
        open_warngen(&tab).await?;
        tab.click("#radar-synth-btn").await?;
        tab.exec(
            "document.getElementById('synth-site-lat').value = '41.32';
             document.getElementById('synth-site-lon').value = '-96.37';
             document.getElementById('synth-storm-lat').value = '45.5';
             document.getElementById('synth-storm-lon').value = '-96.4';",
            json!([]),
        )
        .await?;
        tab.click("#synth-generate-btn").await?;
        tab.wait_until("document.getElementById('synth-error').innerText.startsWith('The storm is')", Duration::from_secs(10)).await?;
        ensure!(shown(&tab, "synth-overlay").await?);
        ensure!(tab.eval::<bool>("document.getElementById('radar-tilt').disabled").await?);
        Ok(())
    }));
    cases
}
