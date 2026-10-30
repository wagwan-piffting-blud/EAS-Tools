//! Level II radar in WarnGen: the bzip2 decoder, loading a real KHGX volume, painting tiles,
//! the shipped AWIPS reflectivity table and a non-radar file.

use std::io::Read;

use eas_tools_e2e::browser::repo_root;
use eas_tools_e2e::*;
use sha1::Digest;

use crate::common::temp_file;

const SAMPLE_PATH: &str = "test/e2e-rs/fixtures/radar/KHGX20260927_034306_V06.ar2v";
const PALETTE_PATH: &str = "test/e2e-rs/fixtures/radar/8_bit_refl_[awips_ii_official_mod].pal";

/// SHA-1 of every bzip2 record in the archive, decompressed natively.
fn reference_records(data: &[u8]) -> Result<Vec<String>> {
    let mut pos = 24;
    let mut digests = Vec::new();
    while pos + 4 <= data.len() {
        let size = i32::from_be_bytes(data[pos..pos + 4].try_into()?);
        let len = size.unsigned_abs() as usize;
        let mut raw = Vec::new();
        bzip2::read::BzDecoder::new(&data[pos + 4..pos + 4 + len]).read_to_end(&mut raw)?;
        digests.push(sha1::Sha1::digest(&raw).iter().map(|b| format!("{b:02x}")).collect());
        pos += 4 + len;
        if size < 0 {
            break;
        }
    }
    Ok(digests)
}

pub async fn open_warngen(tab: &Tab) -> Result<()> {
    tab.goto("warngen/").await?;
    tab.wait_until("!!document.querySelector('.bullet-option')", Duration::from_secs(40)).await
}

/// The office's area fit lands after boot; a view set before it gets overwritten.
pub async fn wait_for_map_to_settle(tab: &Tab) -> Result<()> {
    let mut last: Option<Vec<f64>> = None;
    for _ in 0..40 {
        let now: Vec<f64> = tab.eval("(() => { const c = map.getCenter(); return [map.getZoom(), c.lat, c.lng]; })()").await?;
        if last.as_ref() == Some(&now) {
            return Ok(());
        }
        last = Some(now);
        tokio::time::sleep(Duration::from_millis(500)).await;
    }
    Ok(())
}

async fn load_sample(tab: &Tab) -> Result<()> {
    wait_for_map_to_settle(tab).await?;
    tab.exec("document.getElementById('status').textContent = '';", json!([])).await?;
    tab.set_files("#radar-file", &[repo_root().join(SAMPLE_PATH)]).await?;
    tab.wait_until("/^(Loaded|Couldn)/.test(document.getElementById('status').textContent)", Duration::from_secs(30)).await
}

pub fn cases() -> Vec<Case> {
    vec![
        case("bzip2_decoder_matches_a_native_decoder", |tab| async move {
            open_warngen(&tab).await?;
            let js: Value = tab
                .js_async(
                    "const done = arguments[arguments.length - 1];
                     fetch(arguments[0]).then((r) => r.arrayBuffer()).then(async (buf) => {
                         const bytes = new Uint8Array(buf);
                         const view = new DataView(buf);
                         const out = [];
                         let pos = 24;
                         while (pos + 4 <= bytes.length) {
                             const size = view.getInt32(pos);
                             const raw = WarngenBzip2.decompress(bytes.subarray(pos + 4, pos + 4 + Math.abs(size)));
                             const digest = await crypto.subtle.digest('SHA-1', raw);
                             out.push(Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join(''));
                             pos += 4 + Math.abs(size);
                             if (size < 0) break;
                         }
                         done(out);
                     }).catch((e) => done('ERR ' + e.message));",
                    json!([tab.url(SAMPLE_PATH)]),
                )
                .await?;
            let expected = reference_records(&std::fs::read(repo_root().join(SAMPLE_PATH))?)?;
            ensure!(js == json!(expected), "JS digests {js} differ from {expected:?}");
            Ok(())
        }),
        case("sample_volume_loads_into_controls", |tab| async move {
            open_warngen(&tab).await?;
            load_sample(&tab).await?;
            let status: String = tab.eval("document.getElementById('status').innerText").await?;
            ensure!(status == "Loaded KHGX radar: 3 tilts.", "{status}");
            let info: String = tab.eval("document.getElementById('radar-info').innerText").await?;
            ensure!(info.starts_with("KHGX 2026-09-27 03:43:06Z") && info.contains("VCP 212"), "{info}");
            let tilts: Vec<String> = tab.eval("Array.from(document.querySelectorAll('#radar-tilt option'), (o) => o.textContent)").await?;
            ensure!(
                tilts == ["0.5° (cut 1, 03:43:06Z)", "0.9° (cut 2, 03:43:19Z)", "1.3° (cut 3, 03:43:32Z)"],
                "{tilts:?}"
            );
            let products: Vec<String> = tab.eval("Array.from(document.querySelectorAll('#radar-product option'), (o) => o.value)").await?;
            ensure!(products == ["REF", "VEL", "SW"], "{products:?}");
            ensure!(
                tab.eval::<bool>("document.documentElement.classList.contains('wg-radar') && countyStyle().fillOpacity === 0").await?,
                "county fill should clear while radar is shown"
            );
            ensure!(
                tab.eval::<bool>("map.getBounds().contains(L.latLng(radarLayer._raster.site.lat, radarLayer._raster.site.lon))").await?,
                "a radar outside the office's view should bring itself into view"
            );
            Ok(())
        }),
        case("tiles_paint_and_probe_reads_the_gate", |tab| async move {
            open_warngen(&tab).await?;
            load_sample(&tab).await?;
            let result: Value = tab
                .js_async(
                    "const done = arguments[arguments.length - 1];
                     const site = radarLayer._raster.site;
                     const ground = WarngenRadarLayer.groundRange(2125 + 419 * 250, 0.5);
                     const R = 6371000, d = ground / R, t = 312.75 * Math.PI / 180;
                     const p1 = site.lat * Math.PI / 180, l1 = site.lon * Math.PI / 180;
                     const p2 = Math.asin(Math.sin(p1) * Math.cos(d) + Math.cos(p1) * Math.sin(d) * Math.cos(t));
                     const l2 = l1 + Math.atan2(Math.sin(t) * Math.sin(d) * Math.cos(p1), Math.cos(d) - Math.sin(p1) * Math.sin(p2));
                     const storm = L.latLng(p2 * 180 / Math.PI, l2 * 180 / Math.PI);
                     radarLayer.once('load', () => {
                         let painted = 0;
                         map.getPane('radarPane').querySelectorAll('canvas').forEach((c) => {
                             const px = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
                             for (let i = 3; i < px.length; i += 4) if (px[i]) painted++;
                         });
                         const probe = radarLayer.sampleAt(storm);
                         done({ painted, value: probe && probe.value, bearing: probe && probe.bearing });
                     });
                     map.setView(storm, 9, { animate: false });
                     radarLayer.redraw();",
                    json!([]),
                )
                .await?;
            // The strongest gate in the sample: 312.75 deg, gate 419 (slant 106.875 km).
            ensure!(result["painted"].as_i64().unwrap_or(0) > 500, "{result}");
            ensure!(result["value"] == 54.5, "{result}");
            ensure!((result["bearing"].as_f64().unwrap_or(0.0) - 312.75).abs() < 0.25, "{result}");
            Ok(())
        }),
        case("shipped_reflectivity_table_matches_the_awips_file", |tab| async move {
            open_warngen(&tab).await?;
            let text = std::fs::read_to_string(repo_root().join(PALETTE_PATH))?;
            let same: Value = tab
                .js(
                    "const a = WarngenRadarPalette.parse(arguments[0]);
                     const b = WarngenRadarPalette.defaultTable('REF');
                     return JSON.stringify(a.entries) === JSON.stringify(b.entries)
                         ? [a.entries.length, WarngenRadarPalette.colorAt(b, 45), WarngenRadarPalette.colorAt(b, -35)]
                         : null;",
                    json!([text]),
                )
                .await?;
            ensure!(!same.is_null(), "defaultTable('REF') drifted from the AWIPS .pal");
            ensure!(same == json!([14, [255, 177, 0, 255], null]), "{same}");
            Ok(())
        }),
        case("non_radar_file_reports_an_error", |tab| async move {
            open_warngen(&tab).await?;
            let mut junk = b"AR2V0006.001".to_vec();
            junk.extend([0u8; 64]);
            tab.set_files("#radar-file", &[temp_file("not_radar.ar2v", &junk)?]).await?;
            tab.wait_until(
                "document.getElementById('status').textContent.startsWith(\"Couldn't read that radar file\")",
                Duration::from_secs(20),
            )
            .await?;
            ensure!(tab.eval::<bool>("document.getElementById('radar-tilt').disabled").await?);
            Ok(())
        }),
    ]
}
