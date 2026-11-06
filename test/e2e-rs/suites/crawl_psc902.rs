//! #164: the Trilithic PSC-902 (Texscan-MSI) screen: blue background, white "EMERGENCY ALERT
//! SYSTEM" and event lines in the ROM font with a drop shadow, and a crawl band coloured by
//! severity (green tests, red warnings, #FF9100 watches) that the crawl scrolls through.

use eas_tools_e2e::img::{self, Rgb};
use eas_tools_e2e::*;
use image::RgbImage;

use crate::common::open_tool;

const BLUE: Rgb = (0, 26, 198);
const WHITE: Rgb = (255, 255, 255);
const GREEN: Rgb = (73, 216, 49);
const RED: Rgb = (244, 7, 40);
const ORANGE: Rgb = (255, 145, 0);

const TEST: &str = "ZCZC-EAS-RMT-034039+0030-1352200-WAGS TV -";
const WARNING: &str = "ZCZC-WXR-TOR-034039+0030-1352200-KOKX/NWS-";
const WATCH: &str = "ZCZC-WXR-SVA-034039+0300-1352200-KOKX/NWS-";

const BUILD_JS: &str = r#"
const done = arguments[arguments.length - 1];
const header = arguments[0];
(async () => {
    try {
        document.getElementById('crawlMode').value = 'header';
        document.getElementById('crawlMode').dispatchEvent(new Event('change', { bubbles: true }));
        document.getElementById('crawlRawHeader').value = header;
        document.getElementById('crawlRawHeader').dispatchEvent(new Event('input', { bubbles: true }));
        document.getElementById('crawlStylePreset').value = 'psc_902';
        document.getElementById('applyCrawlStylePreset').click();
        const deadline = Date.now() + 25000;
        while (Date.now() < deadline) {
            let saved = null;
            try { saved = JSON.parse(localStorage.getItem('eas-tools-crawl-settings')); } catch (error) { }
            const gen = window.crawlGenerator;
            const bg = gen && gen.bgImage;
            if (saved && saved.rawHeader === header && saved.crawlBackgroundPremade === 'trilithic:psc_902'
                && bg && bg.naturalWidth === 640 && gen.textShadow && gen.fontFamily === 'Texscan PSC-902') {
                done({
                    ok: true,
                    src: bg.src,
                    shadow: gen.textShadow,
                    fontLoaded: document.fonts.check('80px "Texscan PSC-902"'),
                    optionText: document.querySelector('#crawlBackgroundPremadeSelect option[value="trilithic:psc_902"]')?.textContent || '',
                    topY: document.getElementById('crawlTopLeftPixelY').value,
                });
                return;
            }
            await new Promise((resolve) => setTimeout(resolve, 25));
        }
        done({ ok: false, error: 'the PSC-902 background never appeared' });
    } catch (error) {
        done({ ok: false, error: String(error) });
    }
})();
"#;

async fn build(tab: &Tab, header: &str) -> Result<(Value, RgbImage)> {
    let result: Value = tab.js_async(BUILD_JS, json!([header])).await?;
    ensure!(result["ok"] == true, "{result}");
    let image = img::decode_data_url(result["src"].as_str().unwrap_or_default())?;
    Ok((result, image))
}

fn band_color(image: &RgbImage) -> Rgb {
    img::px(image, 5, 335)
}

const FRAME_JS: &str = r#"
const gen = window.crawlGenerator;
for (let i = 0; i < 150; i++) gen.getNextFrame();
return gen.canvas.toDataURL('image/png');
"#;

pub fn cases() -> Vec<Case> {
    vec![
        case("the_crawl_scrolls_inside_the_band", |tab| async move {
            open_tool(&tab, "crawl").await?;
            build(&tab, TEST).await?;
            let src: String = tab.js(FRAME_JS, json!([])).await?;
            let frame = img::decode_data_url(&src)?;
            if let Ok(path) = std::env::var("EAS_PSC902_FRAME") {
                frame.save(&path)?;
            }
            ensure!(
                frame.width() == 640 && frame.height() == 480,
                "{}x{}",
                frame.width(),
                frame.height()
            );
            let in_band = (0..frame.width())
                .step_by(2)
                .any(|x| (331..386).any(|y| img::near(img::px(&frame, x, y), WHITE, 10)));
            ensure!(in_band, "no crawl text in the band");
            let outside = (0..frame.width())
                .step_by(2)
                .any(|x| (392..480).any(|y| img::near(img::px(&frame, x, y), WHITE, 10)));
            ensure!(!outside, "crawl text spills below the band");
            Ok(())
        }),
        case("screen_and_crawl_band_follow_severity", |tab| async move {
            open_tool(&tab, "crawl").await?;
            for (header, color, label) in [
                (TEST, GREEN, "test"),
                (WARNING, RED, "warning"),
                (WATCH, ORANGE, "watch"),
            ] {
                let (result, image) = build(&tab, header).await?;
                ensure!(
                    image.width() == 640 && image.height() == 480,
                    "{label}: {}x{}",
                    image.width(),
                    image.height()
                );
                ensure!(
                    img::near(img::px(&image, 620, 20), BLUE, 6),
                    "{label}: background {:?}",
                    img::px(&image, 620, 20)
                );
                ensure!(
                    img::near(img::px(&image, 620, 440), BLUE, 6),
                    "{label}: lower background"
                );
                ensure!(
                    img::near(band_color(&image), color, 6),
                    "{label}: band {:?}",
                    band_color(&image)
                );
                ensure!(result["fontLoaded"] == true, "{label}: font not loaded");
                ensure!(result["shadow"]["offset"] == 3, "{label}: {result}");
            }
            Ok(())
        }),
        case(
            "heading_and_event_lines_are_white_with_a_shadow",
            |tab| async move {
                open_tool(&tab, "crawl").await?;
                let (result, image) = build(&tab, TEST).await?;
                ensure!(
                    result["optionText"] == "Trilithic PSC-902 (Texscan-MSI)",
                    "{result}"
                );
                let white = img::color_rows(&image, WHITE, 10);
                ensure!(
                    white.len() == 4,
                    "heading + 3 event lines expected: {white:?}"
                );
                for (got, want) in white.iter().zip([112.0, 160.0, 225.0, 290.0]) {
                    ensure!(
                        (got - want).abs() <= 3.0,
                        "text centred at {got}, expected {want}: {white:?}"
                    );
                }
                let shadow = img::color_rows(&image, (0, 0, 0), 10);
                ensure!(
                    shadow.iter().any(|y| (y - 115.0).abs() <= 4.0),
                    "the heading has no drop shadow: {shadow:?}"
                );
                let (_, two_lines) = build(&tab, WARNING).await?;
                let white = img::color_rows(&two_lines, WHITE, 10);
                ensure!(
                    white.len() == 3,
                    "heading + TORNADO / WARNING expected: {white:?}"
                );
                for (got, want) in white.iter().zip([112.0, 225.0, 290.0]) {
                    ensure!(
                        (got - want).abs() <= 3.0,
                        "two event lines sit on the band like the WDBJ capture: {white:?}"
                    );
                }
                Ok(())
            },
        ),
    ]
}
