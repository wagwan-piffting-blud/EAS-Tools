//! VDS mode pops whole characters in and out at the edges with no gap on either side: a
//! character shows as soon as it fits inside the crawl area and hides as soon as it starts to
//! leave it. A non-zero crawl inset still sets where those edges are.

use eas_tools_e2e::*;

use crate::common::open_tool;

const TEXT: &str = "ABCDEFGHIJKLMNOPQRSTUVWXYZ ABCDEFGHIJKLMNOPQRSTUVWXYZ ABCDEFGHIJKLMNOPQRSTUVWXYZ ABCDEFGHIJKLMNOPQRSTUVWXYZ";

const INK_JS: &str = r#"
const done = arguments[arguments.length - 1];
const [text, inset] = [arguments[0], arguments[1]];
(async () => {
    try {
        const set = (id, value, type) => {
            const el = document.getElementById(id);
            if (el.type === 'checkbox') el.checked = value === true;
            else el.value = value;
            el.dispatchEvent(new Event(type || 'change', { bubbles: true }));
        };
        set('crawlMode', 'custom');
        set('crawlText', text, 'input');
        set('crawlBackgroundMode', 'solid');
        set('crawlBgColor', '#000000');
        set('crawlTextColor', '#FFFFFF');
        set('crawlFontFamily', 'Arial');
        set('crawlFontSize', '24');
        set('crawlSpeed', '4');
        set('crawlWidth', '640');
        set('crawlHeight', '120');
        set('crawlInset', String(inset));
        set('crawlUseVDSMode', true);
        const deadline = Date.now() + 20000;
        while (Date.now() < deadline) {
            let saved = null;
            try { saved = JSON.parse(localStorage.getItem('eas-tools-crawl-settings')); } catch (error) { }
            const gen = window.crawlGenerator;
            if (saved && saved.text === text && String(saved.crawlInset) === String(inset) && saved.useVDSMode === true
                && gen && gen.vdsMode && gen.canvas.width === 640) {
                break;
            }
            await new Promise((resolve) => setTimeout(resolve, 25));
        }
        const gen = window.crawlGenerator;
        const { width, height } = gen.canvas;
        const extents = () => {
            const data = gen.canvas.getContext('2d').getImageData(0, 0, width, height).data;
            let left = -1;
            let right = -1;
            for (let x = 0; x < width; x++) {
                for (let y = 0; y < height; y++) {
                    const i = (y * width + x) * 4;
                    if (Math.min(data[i], data[i + 1], data[i + 2]) > 160) {
                        if (left < 0) left = x;
                        right = x;
                        break;
                    }
                }
            }
            return { left, right };
        };
        // The text is wider than the canvas, so once its start reaches the left edge it covers the right one too.
        for (let frame = 0; frame < 3000; frame++) {
            gen.getNextFrame();
            const { left, right } = extents();
            if (left >= 0 && left < inset + 26) {
                done({ ok: true, left, right, frame });
                return;
            }
        }
        done({ ok: false, error: 'the text never reached the left edge', last: extents() });
    } catch (error) {
        done({ ok: false, error: String(error) });
    }
})();
"#;

async fn ink(tab: &Tab, inset: u32) -> Result<(i64, i64)> {
    let result: Value = tab.js_async(INK_JS, json!([TEXT, inset])).await?;
    ensure!(result["ok"] == true, "{result}");
    let left = result["left"].as_i64().context("left")?;
    let right = result["right"].as_i64().context("right")?;
    ensure!(left >= 0 && right > left, "no text drawn: {result}");
    Ok((left, right))
}

/// Widest capital in 24 px Arial is about 23 px, so a whole character always fits in this slack.
const CELL: i64 = 26;

pub fn cases() -> Vec<Case> {
    vec![case(
        "vds_characters_reach_both_edges_and_respect_the_inset",
        |tab| async move {
            open_tool(&tab, "crawl").await?;
            let (left, right) = ink(&tab, 0).await?;
            ensure!(left < CELL, "gap on the left: text starts at x={left}");
            ensure!(
                right > 639 - CELL,
                "gap on the right: text ends at x={right}"
            );

            let (left, right) = ink(&tab, 60).await?;
            ensure!(
                left >= 60 && right <= 580,
                "text outside the 60 px inset: {left}..{right}"
            );
            ensure!(left < 60 + CELL, "gap inside the left inset: x={left}");
            ensure!(right > 580 - CELL, "gap inside the right inset: x={right}");
            Ok(())
        },
    )]
}
