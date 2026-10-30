//! Radar Save PNG/SVG (#126): a georeferenced Web Mercator PNG and an editable banded SVG.

use std::collections::HashMap;

use base64::Engine;
use eas_tools_e2e::*;

use crate::warngen_radar::open_warngen;

const SVG_NS: &str = "http://www.w3.org/2000/svg";
const WARNGEN_NS: &str = "https://eas.tools/warngen/radar";
const IDS: [&str; 2] = ["radar-save-png-btn", "radar-save-svg-btn"];

const GENERATE_JS: &str = "
window.__synth = WarngenRadarSynth.generate({
    site: { lat: 41.32, lon: -96.37 }, icao: 'KOAX', storm: { lat: 41.75, lon: -96.95 },
    motionBearing: 45, motionSpeedMph: 35, type: 'supercell',
    tornadic: true, intensity: 'strong', seed: 1234,
    time: Date.UTC(2026, 4, 20, 22, 0, 0)
});
showRadarVolume(window.__synth);";

/// Records every <a download> the page clicks and reads its blob before the page revokes it.
const CAPTURE_JS: &str = "
window.__saved = [];
HTMLAnchorElement.prototype.click = function () {
    if (!this.download) return;
    const entry = { name: this.download, b64: null };
    window.__saved.push(entry);
    fetch(this.href).then((r) => r.arrayBuffer()).then((buf) => {
        const bytes = new Uint8Array(buf);
        let bin = '';
        for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
        entry.b64 = btoa(bin);
    });
};";

/// Decodes the saved PNG in the browser: alpha of the top-left pixel, and how many pixels of the
/// radar square carry any paint.
const DECODE_JS: &str = "
const done = arguments[arguments.length - 1];
const bin = atob(window.__saved[0].b64);
const bytes = new Uint8Array(bin.length);
for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
createImageBitmap(new Blob([bytes], { type: 'image/png' })).then((bmp) => {
    const c = document.createElement('canvas');
    c.width = bmp.width;
    c.height = bmp.height;
    const ctx = c.getContext('2d');
    ctx.drawImage(bmp, 0, 0);
    const px = ctx.getImageData(0, 0, bmp.width, bmp.width).data;
    let painted = 0;
    for (let i = 3; i < px.length; i += 4) if (px[i]) painted++;
    const strip = ctx.getImageData(0, bmp.width, 1, 1).data;
    done({ ok: true, width: bmp.width, height: bmp.height, corner: px[3], painted: painted, strip: Array.from(strip) });
}, (e) => done({ ok: false, error: String(e) }));";

async fn generate(tab: &Tab) -> Result<()> {
    tab.exec(GENERATE_JS, json!([])).await
}

async fn save(tab: &Tab, button: &str) -> Result<(String, Vec<u8>)> {
    tab.exec(CAPTURE_JS, json!([])).await?;
    tab.click(&format!("#{button}")).await?;
    tab.wait_until("window.__saved.length === 1 && !!window.__saved[0].b64", Duration::from_secs(60)).await?;
    let (name, b64): (String, String) = tab.eval("[window.__saved[0].name, window.__saved[0].b64]").await?;
    Ok((name, base64::engine::general_purpose::STANDARD.decode(b64)?))
}

async fn disabled(tab: &Tab) -> Result<Vec<bool>> {
    tab.js("return arguments[0].map((id) => document.getElementById(id).disabled);", json!([IDS])).await
}

fn png_chunks(data: &[u8]) -> Result<Vec<([u8; 4], Vec<u8>)>> {
    ensure!(data.starts_with(b"\x89PNG\r\n\x1a\n"), "not a PNG");
    let mut pos = 8;
    let mut chunks = Vec::new();
    while pos < data.len() {
        let length = u32::from_be_bytes(data[pos..pos + 4].try_into()?) as usize;
        let kind: [u8; 4] = data[pos + 4..pos + 8].try_into()?;
        let body = &data[pos + 8..pos + 8 + length];
        let crc = u32::from_be_bytes(data[pos + 8 + length..pos + 12 + length].try_into()?);
        ensure!(crc32fast::hash(&data[pos + 4..pos + 8 + length]) == crc, "bad CRC on {}", String::from_utf8_lossy(&kind));
        chunks.push((kind, body.to_vec()));
        pos += 12 + length;
    }
    Ok(chunks)
}

fn is(node: &roxmltree::Node, ns: &str, name: &str) -> bool {
    node.is_element() && node.tag_name().namespace() == Some(ns) && node.tag_name().name() == name
}

pub fn cases() -> Vec<Case> {
    let mut cases = vec![
        case("save_buttons_follow_the_radar_volume", |tab| async move {
            open_warngen(&tab).await?;
            ensure!(disabled(&tab).await? == [true, true]);
            generate(&tab).await?;
            ensure!(disabled(&tab).await? == [false, false]);
            let names: Vec<String> =
                tab.js("return arguments[0].map((id) => document.getElementById(id).getAttribute('aria-label'));", json!([IDS])).await?;
            ensure!(names == ["Save PNG radar image", "Save SVG radar image"], "{names:?}");
            tab.click("#radar-clear-btn").await?;
            ensure!(disabled(&tab).await? == [true, true]);
            Ok(())
        }),
        case("png_export_is_a_georeferenced_radar_image", |tab| async move {
            open_warngen(&tab).await?;
            generate(&tab).await?;
            let (name, data) = save(&tab, "radar-save-png-btn").await?;
            ensure!(name == "KOAX_SYNTH_REF_0.5_20260520T2200Z.png", "{name}");
            let chunks = png_chunks(&data)?;
            let text: HashMap<String, String> = chunks
                .iter()
                .filter(|(kind, _)| kind == b"tEXt")
                .filter_map(|(_, body)| {
                    let split = body.iter().position(|&b| b == 0)?;
                    let latin1 = |b: &[u8]| b.iter().map(|&c| c as char).collect::<String>();
                    Some((latin1(&body[..split]), latin1(&body[split + 1..])))
                })
                .collect();
            ensure!(text["Title"].starts_with("SYNTHETIC KOAX Reflectivity (REF) 0.5"), "{text:?}");
            ensure!(text["Warning"].contains("not a real radar scan"), "{text:?}");
            let world: Vec<f64> = text["WorldFile"].split('\n').map(str::parse).collect::<Result<_, _>>()?;
            ensure!(world.len() == 6 && world[0] > 0.0 && world[3] == -world[0], "{world:?}");
            ensure!(text["Georeference"].contains("EPSG:3857"), "{text:?}");
            let ihdr = &chunks.iter().find(|(kind, _)| kind == b"IHDR").context("no IHDR")?.1;
            ensure!((ihdr[8], ihdr[9]) == (8, 6), "expected 8-bit RGBA, got depth {} type {}", ihdr[8], ihdr[9]);

            let decoded: Value = tab.js_async(DECODE_JS, json!([])).await?;
            ensure!(decoded["ok"] == true, "{decoded}");
            ensure!(decoded["width"] == 2048 && decoded["height"].as_i64().unwrap_or(0) > 2048, "{decoded}");
            ensure!(decoded["corner"] == 0, "radar square should be transparent outside the coverage");
            ensure!(decoded["painted"].as_i64().unwrap_or(0) > 20000, "{decoded}");
            ensure!(decoded["strip"][3] == 255, "legend strip should be opaque");
            let status: String = tab.eval("document.getElementById('status').innerText").await?;
            ensure!(status.starts_with("Saved KOAX_SYNTH_REF_0.5_20260520T2200Z.png"), "{status}");
            Ok(())
        }),
        case("png_pixel_lands_over_the_storm_core", |tab| async move {
            open_warngen(&tab).await?;
            generate(&tab).await?;
            let hit: Value = tab
                .js_async(
                    "const done = arguments[arguments.length - 1];
                     buildRadarPng().then((file) => {
                         const g = file.result.georef;
                         const core = window.__synth.synthetic.features.core;
                         const merc = (lat) => { const s = Math.sin(lat * Math.PI / 180); return 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI); };
                         const x = Math.floor(((core.lon - g.bounds.west) / (g.bounds.east - g.bounds.west)) * g.pixels[0]);
                         const y = Math.floor((merc(core.lat) - merc(g.bounds.north)) / (merc(g.bounds.south) - merc(g.bounds.north)) * g.pixels[1]);
                         const px = file.result.canvas.getContext('2d').getImageData(x, y, 1, 1).data;
                         done([x, y, Array.from(px), file.name]);
                     }, (e) => done(String(e)));",
                    json!([]),
                )
                .await?;
            ensure!(hit.is_array(), "{hit}");
            ensure!(hit[2][3] == 255, "{hit}");
            ensure!(hit[2][0].as_i64().unwrap_or(0) > 150, "core should paint a hot reflectivity color: {hit}");
            Ok(())
        }),
        case("svg_export_is_editable_vector", |tab| async move {
            open_warngen(&tab).await?;
            generate(&tab).await?;
            let (name, data) = save(&tab, "radar-save-svg-btn").await?;
            ensure!(name == "KOAX_SYNTH_REF_0.5_20260520T2200Z.svg", "{name}");
            ensure!(data.len() < 4_000_000, "{} bytes", data.len());
            let source = String::from_utf8(data)?;
            let doc = roxmltree::Document::parse(&source)?;
            let root = doc.root_element();
            ensure!(is(&root, SVG_NS, "svg"), "root is {:?}", root.tag_name());
            let title = root.children().find(|n| is(n, SVG_NS, "title")).and_then(|n| n.text()).unwrap_or_default();
            ensure!(title.starts_with("SYNTHETIC KOAX Reflectivity"), "{title}");
            let meta = root.children().find(|n| is(n, SVG_NS, "metadata")).context("no <metadata>")?;
            let radar = meta.children().find(|n| is(n, WARNGEN_NS, "radar")).context("no warngen:radar")?;
            let georef = meta.children().find(|n| is(n, WARNGEN_NS, "georef")).context("no warngen:georef")?;
            ensure!(
                radar.attribute("icao") == Some("KOAX") && radar.attribute("product") == Some("REF") && radar.attribute("synthetic") == Some("true"),
                "{:?}",
                radar.attributes().collect::<Vec<_>>()
            );
            ensure!(georef.attribute("crs").unwrap_or("").contains("+proj=aeqd") && georef.attribute("siteLat") == Some("41.32"));

            let groups: HashMap<&str, roxmltree::Node> =
                root.descendants().filter(|n| is(n, SVG_NS, "g")).filter_map(|g| Some((g.attribute("id")?, g))).collect();
            let radar_group = groups.get("radar").context("no radar group")?;
            let bands: Vec<roxmltree::Node> = radar_group.children().filter(|n| is(n, SVG_NS, "g")).collect();
            let paths = bands.iter().flat_map(|g| g.descendants()).filter(|n| is(n, SVG_NS, "path")).count();
            ensure!(bands.len() >= 10, "{} bands", bands.len());
            ensure!(paths > 1000, "{paths} paths");
            ensure!(bands.iter().all(|g| g.attribute("fill").unwrap_or("").starts_with('#')));
            let legend = groups.get("legend").context("no legend group")?;
            let bar = groups.get("legend-bar").context("no legend-bar group")?;
            ensure!(bar.descendants().filter(|n| is(n, SVG_NS, "rect")).count() >= 10);
            ensure!(
                legend.descendants().filter(|n| is(n, SVG_NS, "text")).any(|t| t.text().unwrap_or("").contains("not a real radar scan")),
                "the legend lacks the synthetic warning"
            );
            Ok(())
        }),
    ];
    for product in ["VEL", "RHO"] {
        cases.push(case(format!("svg_and_png_follow_the_selected_product_and_tilt[{product}]"), move |tab| async move {
            open_warngen(&tab).await?;
            generate(&tab).await?;
            tab.exec(
                "const tilt = document.getElementById('radar-tilt');
                 tilt.value = '2';
                 tilt.dispatchEvent(new Event('change'));
                 const prod = document.getElementById('radar-product');
                 prod.value = arguments[0];
                 prod.dispatchEvent(new Event('change'));",
                json!([product]),
            )
            .await?;
            let names: Value = tab
                .js_async(
                    "const done = arguments[arguments.length - 1];
                     const svg = buildRadarSvg();
                     buildRadarPng().then((png) => done([svg.name, png.name, svg.result.paths, png.result.painted]));",
                    json!([]),
                )
                .await?;
            ensure!(names[0] == format!("KOAX_SYNTH_{product}_1.3_20260520T2200Z.svg"), "{names}");
            ensure!(names[1] == format!("KOAX_SYNTH_{product}_1.3_20260520T2200Z.png"), "{names}");
            ensure!(names[2].as_i64().unwrap_or(0) > 100 && names[3].as_i64().unwrap_or(0) > 1000, "{names}");
            Ok(())
        }));
    }
    cases
}
