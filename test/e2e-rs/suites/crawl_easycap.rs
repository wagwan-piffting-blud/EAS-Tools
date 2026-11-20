//! The Trilithic EASyCAP alert screen: DejaVu (Bitstream Vera) Sans Bold on (16,16,200), the
//! title and event name stacked over the alert text, "- N of M -" page counters, each page held
//! for its characters at the set speed, and the SDI output's 16:9 sizes and row-based crawl.
//! The RWT wording, wrap points and layout come from a photo of a real unit and a 2018 NPT capture.

use eas_tools_e2e::img::{self, Rgb};
use eas_tools_e2e::*;
use image::RgbImage;

use crate::common::open_tool;

const BLUE: Rgb = (16, 16, 200);
const RWT: &str = "ZCZC-EAS-RWT-024000+0015-1910700-WAGS/TV -";
const SVR: &str = "ZCZC-WXR-SVR-042001-042003-042005-042007-042009-042011-042013-042015-042017-042019-042021-042023-042025-042027-042029-042031-042033-042035-042037-042039+0100-1910700-KCTP/NWS-";

const BUILD_JS: &str = r#"
const done = arguments[arguments.length - 1];
const opts = arguments[0];
(async () => {
    try {
        const deadline = Date.now() + 30000;
        if (opts.eventCode) {
            while (Date.now() < deadline && !document.querySelector('#easyplusEventCode option[value="' + opts.eventCode + '"]')) {
                await new Promise((resolve) => setTimeout(resolve, 25));
            }
        }
        const set = (id, value, type) => {
            const el = document.getElementById(id);
            if (!el) throw new Error('missing #' + id);
            if (el.type === 'checkbox') el.checked = value === true;
            else el.value = value;
            el.dispatchEvent(new Event(type || 'change', { bubbles: true }));
        };
        window.__easycapLastRender = null;
        set('crawlMode', opts.header ? 'header' : 'custom');
        if (opts.header) set('crawlRawHeader', opts.header, 'input');
        else set('crawlText', opts.text, 'input');
        if (opts.eventCode) set('easyplusEventCode', opts.eventCode);
        set('crawlUseOverrideTZ', opts.tz || '');
        for (const [id, value] of Object.entries(opts.settings || {})) set(id, value);
        set('crawlBackgroundMode', 'premade');
        set('crawlBackgroundPremadeSelect', opts.premade);
        const source = opts.premade.split(':')[1];
        while (Date.now() < deadline) {
            let saved = null;
            try { saved = JSON.parse(localStorage.getItem('eas-tools-crawl-settings')); } catch (error) { }
            const render = window.__easycapLastRender;
            const settled = saved && saved.crawlBackgroundPremade === opts.premade && saved.crawlBackgroundMode === 'premade'
                && (opts.header ? saved.rawHeader === opts.header : saved.text === opts.text)
                && Object.entries(opts.settings || {}).every(([id, value]) => saved[id] === value)
                && render && render.source === source;
            if (settled) {
                const gen = window.crawlGenerator;
                const bg = window.__dasdecBackground;
                const rotation = window.__dasdecRotationState;
                done({
                    ok: true,
                    render,
                    images: bg && Array.isArray(bg.pages) ? bg.pages.map((page) => page.src) : [gen.bgImage.src],
                    pageDelaysMs: bg ? bg.pageDelaysMs : null,
                    rotationDelays: rotation ? rotation.pageDelays : null,
                    width: Number(document.getElementById('crawlWidth').value),
                    height: Number(document.getElementById('crawlHeight').value),
                    topY: Number(document.getElementById('crawlTopLeftPixelY').value),
                    gen: { fontFamily: gen.fontFamily, fontSize: gen.fontSize, speed: Number(gen.speed), text: gen.text },
                    settingsVisible: !document.getElementById('easycapSettings').hidden,
                    sdiRowsVisible: Array.from(document.querySelectorAll('#easycapSettings [data-easycap="sdi"]')).some((row) => !row.hidden),
                    optionText: document.querySelector('#crawlBackgroundPremadeSelect option[value="' + opts.premade + '"]')?.textContent || '',
                });
                return;
            }
            await new Promise((resolve) => setTimeout(resolve, 25));
        }
        done({ ok: false, error: 'the EASyCAP screen never rendered', render: window.__easycapLastRender });
    } catch (error) {
        done({ ok: false, error: String(error) });
    }
})();
"#;

async fn build(tab: &Tab, opts: Value) -> Result<(Value, Vec<RgbImage>)> {
    let result: Value = tab.js_async(BUILD_JS, json!([opts])).await?;
    ensure!(result["ok"] == true, "{result}");
    let images = result["images"]
        .as_array()
        .context("images")?
        .iter()
        .map(|src| img::decode_data_url(src.as_str().unwrap_or_default()))
        .collect::<Result<Vec<_>>>()?;
    Ok((result, images))
}

/// Set `EAS_EASYCAP_DIR=<dir>` to save the rendered pages and the SDI crawl frame for a visual check.
fn save(image: &RgbImage, name: &str) -> Result<()> {
    if let Ok(dir) = std::env::var("EAS_EASYCAP_DIR") {
        image.save(std::path::Path::new(&dir).join(name))?;
    }
    Ok(())
}

fn strings(value: &Value) -> Vec<String> {
    value
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|v| v.as_str().map(str::to_string))
        .collect()
}

fn pages(result: &Value) -> Vec<Vec<String>> {
    result["render"]["pages"]
        .as_array()
        .into_iter()
        .flatten()
        .map(strings)
        .collect()
}

/// Ink runs as (top, bottom) rows, ignoring anti-aliased fringes.
fn ink_runs(image: &RgbImage) -> Vec<(u32, u32)> {
    img::bright_rows(image, 170)
        .into_iter()
        .map(|(_, top, bottom)| (top, bottom))
        .collect()
}

fn delay_for(lines: &[String], cps: f64) -> u64 {
    let chars = lines.join(" ").trim().chars().count() as f64;
    ((chars / cps).round().max(1.0) as u64) * 1000
}

const NATIVE_BRIDGE_JS: &str = r#"
const done = arguments[arguments.length - 1];
const header = arguments[0];
(async () => {
    const h = window.__bridgeHandlers;
    await h['crawl:renderPremade']({ requestId: 3, premade: 'trilithic:easycap', applySizing: true, crawlMode: 'header', header, text: '', endecMode: '', repetitions: 1, overrideTZ: 'America/New_York', easycap: { speed: 20 } });
    await h['crawl:renderPremade']({ requestId: 4, premade: 'trilithic:easycap_sdi', applySizing: true, crawlMode: 'header', header, text: '', endecMode: '', repetitions: 1, overrideTZ: 'America/New_York', easycap: { crawl: true, displayMode: '720p', position: 12 } });
    await h['crawl:convertHeader']({ header, endecMode: 'TRILITHIC8PLUS', premade: 'trilithic:easycap_sdi', overrideTZ: 'America/New_York' });
    const sent = (name, id) => {
        const hit = window.__bridgeSent.find(([n, payload]) => n === name && (id === undefined || payload.requestId === id));
        return hit ? hit[1] : null;
    };
    const paged = sent('crawl:premadeImage', 3);
    const crawl = sent('crawl:premadeImage', 4);
    done({
        paged: paged && { images: paged.images.length, rotationDelaysMs: paged.rotationDelaysMs, scroll: paged.scroll, width: paged.width, crawlStyle: paged.crawlStyle },
        crawl: crawl && { images: crawl.images.length, scroll: crawl.scroll, width: crawl.width, height: crawl.height, topLeftY: crawl.topLeftY, crawlStyle: crawl.crawlStyle },
        converted: sent('crawl:headerConverted')?.text || null,
        premadeList: (sent('crawl:premadeList')?.options || []).map((option) => option.value),
    });
})().catch((error) => done({ error: String(error) }));
"#;

const FAKE_BRIDGE_JS: &str = "
window.__bridgeHandlers = {};
window.__bridgeSent = [];
window.EASBridge = {
    on(name, fn) { window.__bridgeHandlers[name] = fn; },
    send(name, payload) { window.__bridgeSent.push([name, payload]); },
};
";

const FRAME_JS: &str = r#"
const gen = window.crawlGenerator;
for (let i = 0; i < 240; i++) gen.getNextFrame();
return gen.canvas.toDataURL('image/png');
"#;

pub fn cases() -> Vec<Case> {
    vec![
        case("the_rwt_wraps_like_the_real_screen", |tab| async move {
            open_tool(&tab, "crawl").await?;
            let (result, images) = build(
                &tab,
                json!({ "header": RWT, "tz": "America/New_York", "premade": "trilithic:easycap" }),
            )
            .await?;
            ensure!(result["optionText"] == "Trilithic EASyCAP", "{result}");
            ensure!(
                result["settingsVisible"] == true && result["sdiRowsVisible"] == false,
                "{result}"
            );
            ensure!(
                strings(&result["render"]["header"])
                    == ["Emergency Alert System", "Required Weekly Test"],
                "{}",
                result["render"]["header"]
            );
            let got = pages(&result);
            ensure!(
                got == vec![vec![
                    "An EAS Participant has issued".to_string(),
                    "a Required Weekly Test for".to_string(),
                    "All of Maryland. Effective until".to_string(),
                    "July 10, 03:15 AM EDT.".to_string(),
                    "WAGS/TV".to_string(),
                ]],
                "wrap differs from the photo: {got:?}"
            );
            ensure!(
                result["pageDelaysMs"] == json!([delay_for(&got[0], 12.0)]),
                "{result}"
            );
            ensure!(
                result["width"] == 640 && result["height"] == 480 && result["topY"] == 9999,
                "{result}"
            );
            let page = &images[0];
            save(page, "rwt.png")?;
            ensure!(page.width() == 640 && page.height() == 480);
            ensure!(
                img::near(img::px(page, 3, 3), BLUE, 3),
                "{:?}",
                img::px(page, 3, 3)
            );
            ensure!(img::near(img::px(page, 636, 476), BLUE, 3));
            let runs = ink_runs(page);
            ensure!(
                runs.len() == 7,
                "title, event and five body lines: {runs:?}"
            );
            for ((_, bottom), baseline) in runs.iter().zip([48u32, 92, 144, 184, 224, 264, 304]) {
                ensure!(
                    *bottom >= baseline - 1 && *bottom <= baseline + 10,
                    "line ink ends at {bottom}, baseline {baseline}: {runs:?}"
                );
            }
            ensure!(
                runs.iter().all(|(_, bottom)| *bottom < 400),
                "a single page shows no counter: {runs:?}"
            );
            Ok(())
        }),
        case(
            "long_alerts_page_with_counters_and_timing",
            |tab| async move {
                open_tool(&tab, "crawl").await?;
                let (result, images) = build(
                &tab,
                json!({ "header": SVR, "tz": "America/New_York", "premade": "trilithic:easycap", "settings": { "crawlEasycapSpeed": "15" } }),
            )
            .await?;
                let got = pages(&result);
                ensure!(got.len() >= 2, "{got:?}");
                ensure!(got.iter().all(|page| page.len() <= 7), "{got:?}");
                ensure!(
                    strings(&result["render"]["header"])
                        == ["Emergency Alert System", "Severe Thunderstorm", "Warning"],
                    "{}",
                    result["render"]["header"]
                );
                ensure!(
                    got[..got.len() - 1].iter().all(|page| page.len() == 6),
                    "a three-line title block leaves six body lines: {got:?}"
                );
                let text = got.concat().join(" ");
                ensure!(
                text.starts_with("The National Weather Service has issued a Severe Thunderstorm Warning for the following Pennsylvania counties: Adams, Allegheny,"),
                "{text}"
            );
                ensure!(text.ends_with("EDT. KCTP/NWS"), "{text}");
                let expected: Vec<u64> = got.iter().map(|page| delay_for(page, 15.0)).collect();
                ensure!(result["pageDelaysMs"] == json!(expected), "{result}");
                ensure!(result["rotationDelays"] == json!(expected), "{result}");
                for (index, page) in images.iter().enumerate() {
                    save(page, &format!("svr-{}.png", index + 1))?;
                    let runs = ink_runs(page);
                    let last = runs.last().context("no ink")?;
                    ensure!(
                        last.1 >= 438 && last.1 <= 442,
                        "the counter sits at the bottom: {runs:?}"
                    );
                }

                let (top, top_images) = build(
                &tab,
                json!({ "header": SVR, "tz": "America/New_York", "premade": "trilithic:easycap", "settings": { "crawlEasycapSpeed": "15", "crawlEasycapPageNumbersBottom": false } }),
            )
            .await?;
                ensure!(pages(&top).len() == got.len(), "{top}");
                let runs = ink_runs(&top_images[0]);
                ensure!(
                    runs[0].1 >= 46 && runs[0].1 <= 50,
                    "the counter moves to the top: {runs:?}"
                );
                ensure!(
                    runs.iter().all(|(top, _)| *top < 410),
                    "nothing is left in the bottom counter slot: {runs:?}"
                );
                Ok(())
            },
        ),
        case("sdi_crawl_runs_on_the_chosen_row", |tab| async move {
            open_tool(&tab, "crawl").await?;
            let (result, images) = build(
                &tab,
                json!({
                    "header": RWT,
                    "tz": "America/New_York",
                    "premade": "trilithic:easycap_sdi",
                    "settings": { "crawlEasycapCrawl": true, "crawlEasycapDisplayMode": "1080i", "crawlEasycapPosition": "2" }
                }),
            )
            .await?;
            ensure!(result["sdiRowsVisible"] == true, "{result}");
            ensure!(
                result["width"] == 1920 && result["height"] == 1080 && result["topY"] == 91,
                "{result}"
            );
            ensure!(
                result["gen"]["fontFamily"] == "Bitstream Vera Sans"
                    && result["gen"]["fontSize"] == 79
                    && result["gen"]["speed"] == 9,
                "{}",
                result["gen"]
            );
            ensure!(
                result["gen"]["text"] == "An EAS Participant has issued a Required Weekly Test for All of Maryland. Effective until July 10, 03:15 AM EDT. WAGS/TV",
                "{}",
                result["gen"]["text"]
            );
            let runs = ink_runs(&images[0]);
            ensure!(runs.len() == 2, "{runs:?}");
            ensure!(
                runs[0].0 > 400 && runs[1].1 < 680,
                "the title block moves to the middle, clear of row 2: {runs:?}"
            );
            let src: String = tab.js(FRAME_JS, json!([])).await?;
            let frame = img::decode_data_url(&src)?;
            save(&frame, "sdi-crawl.png")?;
            let crawl_ink = (0..frame.width())
                .step_by(2)
                .any(|x| (95..175).any(|y| img::min_channel(img::px(&frame, x, y)) >= 200));
            ensure!(crawl_ink, "no crawl text on row 2");

            let (paged, paged_images) = build(
                &tab,
                json!({
                    "header": RWT,
                    "tz": "America/New_York",
                    "premade": "trilithic:easycap_sdi",
                    "settings": { "crawlEasycapCrawl": false, "crawlEasycapDisplayMode": "720p", "crawlEasycapSdiSpeed": "2" }
                }),
            )
            .await?;
            ensure!(
                paged["width"] == 1280 && paged["height"] == 720 && paged["topY"] == 9999,
                "{paged}"
            );
            ensure!(
                paged_images[0].width() == 1280,
                "{}",
                paged_images[0].width()
            );
            let got = pages(&paged);
            ensure!(got.len() == 1, "{got:?}");
            ensure!(
                paged["pageDelaysMs"] == json!([delay_for(&got[0], 6.0)]),
                "{paged}"
            );
            Ok(())
        }),
        case("custom_text_shows_the_picked_event", |tab| async move {
            open_tool(&tab, "crawl").await?;
            let (result, _) = build(
                &tab,
                json!({ "text": "Testing one two three.", "eventCode": "RWT", "premade": "trilithic:easycap", "settings": { "crawlEasycapTitle": "Alerta de Emergencia" } }),
            )
            .await?;
            ensure!(
                strings(&result["render"]["header"])
                    == ["Alerta de Emergencia", "Required Weekly Test"],
                "{}",
                result["render"]["header"]
            );
            ensure!(
                pages(&result) == vec![vec!["Testing one two three.".to_string()]],
                "{result}"
            );

            let (hidden, _) = build(
                &tab,
                json!({ "text": "Testing one two three.", "eventCode": "RWT", "premade": "trilithic:easycap", "settings": { "crawlEasycapTitle": "", "crawlEasycapShowEvent": false } }),
            )
            .await?;
            ensure!(strings(&hidden["render"]["header"]).is_empty(), "{hidden}");
            Ok(())
        }),
        case(
            "the_apps_get_page_timing_and_the_crawl_style",
            |tab| async move {
                tab.add_init_script(FAKE_BRIDGE_JS).await?;
                open_tool(&tab, "crawl").await?;
                tab.wait_until(
                    "!!(window.__bridgeHandlers && window.__bridgeHandlers['crawl:renderPremade'])",
                    Duration::from_secs(30),
                )
                .await?;
                let result: Value = tab.js_async(NATIVE_BRIDGE_JS, json!([RWT])).await?;
                ensure!(result.get("error").is_none(), "{result}");
                ensure!(
                    result["paged"]["images"] == 1
                        && result["paged"]["rotationDelaysMs"] == json!([6000])
                        && result["paged"]["scroll"] == false
                        && result["paged"]["width"] == 640
                        && result["paged"]["crawlStyle"].is_null(),
                    "{result}"
                );
                ensure!(
                    result["crawl"]["scroll"] == true
                        && result["crawl"]["width"] == 1280
                        && result["crawl"]["height"] == 720
                        && result["crawl"]["topLeftY"] == 659
                        && result["crawl"]["crawlStyle"]["fontSize"] == 53,
                    "{result}"
                );
                ensure!(
                result["converted"] == "An EAS Participant has issued a Required Weekly Test for All of Maryland. Effective until July 10, 03:15 AM EDT. WAGS/TV",
                "{result}"
            );
                ensure!(
                    strings(&result["premadeList"]).contains(&"trilithic:easycap_sdi".to_string()),
                    "{result}"
                );
                Ok(())
            },
        ),
    ]
}
