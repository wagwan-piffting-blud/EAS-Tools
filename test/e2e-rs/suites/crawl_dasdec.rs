//! The DASDEC pre-made screens (issues #126 and #129).
//!
//! The classic DASDEC draws its text over assets/screens/dasdec.png the way the unit's
//! video_server does: Luxi Mono Bold at 25px with no added tracking, centered, wrapped by
//! pixel width (576px), an empty title band above the body, a 34px line pitch and the page
//! counter on its own baseline near the bottom. The black and blue variants are the plain
//! full-screen layouts seen on later units.

use eas_tools_e2e::img::{self, Rgb};
use eas_tools_e2e::*;
use image::RgbImage;

use crate::common::{approx, copy_text, open_tool};

const BORDER_RED: Rgb = (214, 7, 10);
const FILL: Rgb = (69, 69, 99);
const BLACK: Rgb = (0, 0, 0);
const BLUE: Rgb = (0, 0, 255);

const LONG_HEADER: &str = "ZCZC-WXR-SVR-051093-037091-051800-051175-037073-051620-037185-051550+0045-2422117-KAKQ/NWS-";
const SHORT_HEADER: &str = "ZCZC-WXR-SVR-055035+0045-1722337-KMPX/NWS-";

pub const BUILD_PAGES_JS: &str = r#"
const done = arguments[arguments.length - 1];
const [premade, mode, value] = [arguments[0], arguments[1], arguments[2]];
(async () => {
    try {
        const set = (id, next, type) => {
            const el = document.getElementById(id);
            el.value = next;
            el.dispatchEvent(new Event(type || 'change', { bubbles: true }));
        };
        const previous = window.__dasdecBackground;
        if (previous) previous.__seenByTest = true;
        set('crawlMode', mode);
        set(mode === 'header' ? 'crawlRawHeader' : 'crawlText', value, 'input');
        set('crawlBackgroundMode', 'premade');
        set('crawlBackgroundPremadeSelect', premade);

        // The crawl persists its settings in the same pass that renders the background, so a
        // saved copy matching what was just set means the background is that pass's.
        const applied = () => {
            let saved = null;
            try { saved = JSON.parse(localStorage.getItem('eas-tools-crawl-settings')); } catch (error) { }
            return !!saved && saved.crawlMode === mode && saved.crawlBackgroundMode === 'premade'
                && saved.crawlBackgroundPremade === premade
                && (mode === 'header' ? saved.rawHeader === value : saved.text === value);
        };
        const deadline = Date.now() + 25000;
        while (Date.now() < deadline) {
            const bg = window.__dasdecBackground;
            if (bg && !bg.__seenByTest && Array.isArray(bg.pages) && bg.pages.length && applied()) {
                bg.__seenByTest = true;
                for (const page of bg.pages) {
                    if (!page.complete) {
                        await new Promise((resolve) => { page.onload = resolve; page.onerror = resolve; });
                    }
                }
                done({
                    ok: true,
                    pages: bg.pages.map((page) => page.src),
                    rotationDelayMs: bg.rotationDelayMs,
                    drivesTotalFrames: bg.drivesTotalFrames,
                    width: bg.width,
                    height: bg.height,
                    locked: document.getElementById('crawlWidth').disabled,
                });
                return;
            }
            await new Promise((resolve) => setTimeout(resolve, 25));
        }
        done({ ok: false, error: 'no DASDEC pages appeared' });
    } catch (error) {
        done({ ok: false, error: String(error) });
    }
})();
"#;

async fn build(tab: &Tab, premade: &str, value: &str, mode: &str) -> Result<(Value, Vec<RgbImage>)> {
    open_tool(tab, "crawl").await?;
    let result: Value = tab.js_async(BUILD_PAGES_JS, json!([premade, mode, value])).await?;
    ensure!(result["ok"] == true, "{result}");
    let pages = result["pages"]
        .as_array()
        .context("pages")?
        .iter()
        .map(|src| img::decode_data_url(src.as_str().unwrap_or_default()))
        .collect::<Result<Vec<_>>>()?;
    Ok((result, pages))
}

fn text_bounds(page: &RgbImage) -> Option<(u32, u32, u32, u32)> {
    img::bright_bounds(page, 170)
}

fn text_rows(page: &RgbImage) -> Vec<(f64, u32, u32)> {
    img::bright_rows(page, 170)
}

fn ink_width(page: &RgbImage, top: u32, bottom: u32) -> u32 {
    let xs: Vec<u32> = (0..page.width())
        .filter(|&x| (top..=bottom).any(|y| img::min_channel(img::px(page, x, y)) >= 170))
        .collect();
    xs.last().unwrap_or(&0) - xs.first().unwrap_or(&0)
}

const FAKE_BRIDGE_JS: &str = "
window.__bridgeHandlers = {};
window.__bridgeSent = [];
window.EASBridge = {
    on(name, fn) { window.__bridgeHandlers[name] = fn; },
    send(name, payload) { window.__bridgeSent.push([name, payload]); },
};
";

// The apps preview a premade with crawl:renderPremade, then export with crawl:export, whose payload
// (before the 2026-10-24 app builds) carries only the converted text. Issue #143: the export forced
// custom mode, so DASDEC re-wrapped that text instead of laying out the header like the preview.
const BRIDGE_PREVIEW_THEN_EXPORT_JS: &str = r#"
const done = arguments[arguments.length - 1];
const [header, text] = [arguments[0], arguments[1]];
(async () => {
    const h = window.__bridgeHandlers;
    await h['crawl:renderPremade']({ requestId: 7, premade: 'dasdec:dasdec', applySizing: true, crawlMode: 'header', header, text, endecMode: '', repetitions: 1 });
    const sent = window.__bridgeSent.find(([name, payload]) => name === 'crawl:premadeImage' && payload.requestId === 7);
    const preview = sent ? sent[1].images : [];
    await h['crawl:export']({ format: 'gif', text, bgMode: 'premade', repetitions: 1 });
    const bg = window.__dasdecBackground;
    const exported = bg && Array.isArray(bg.pages) ? bg.pages.map((page) => page.src) : [];
    const mode = document.getElementById('crawlMode').value;
    h['crawl:cancelExport']();
    done({ preview, exported, mode });
})().catch((error) => done({ error: String(error) }));
"#;

pub fn cases() -> Vec<Case> {
    let mut cases = vec![
        case("app_export_keeps_the_previewed_header_layout", |tab| async move {
            tab.add_init_script(FAKE_BRIDGE_JS).await?;
            open_tool(&tab, "crawl").await?;
            tab.wait_until("!!(window.__bridgeHandlers && window.__bridgeHandlers['crawl:export'])", Duration::from_secs(30))
                .await?;
            let text = "The National Weather Service has issued a Severe Thunderstorm Warning for the following counties or areas: Minnesota; at 5:37 PM on JUN 17, 2026 Effective until 6:22 PM. Message from KMPX/NWS.";
            let result: Value = tab.js_async(BRIDGE_PREVIEW_THEN_EXPORT_JS, json!([SHORT_HEADER, text])).await?;
            ensure!(result.get("error").is_none(), "{result}");
            ensure!(result["mode"] == "header", "export switched the crawl mode: {}", result["mode"]);
            let preview = result["preview"].as_array().context("preview")?;
            ensure!(!preview.is_empty(), "no preview pages");
            ensure!(result["exported"] == result["preview"], "exported DASDEC pages differ from the preview");
            Ok(())
        }),
        case("dasdec_draws_the_screen_image_instead_of_a_built_border", |tab| async move {
            let (result, pages) = build(&tab, "dasdec:dasdec", SHORT_HEADER, "header").await?;
            ensure!(result["width"] == 640 && result["height"] == 480, "{result}");
            ensure!(result["rotationDelayMs"] == 4000 && result["drivesTotalFrames"] == true, "{result}");
            ensure!(result["locked"] == true, "the size inputs are not locked");
            for page in &pages {
                ensure!(page.dimensions() == (640, 480));
                for (x, y, tol) in [(320, 0, 16), (320, 479, 16), (0, 240, 24), (639, 240, 24)] {
                    let p = img::px(page, x, y);
                    ensure!(img::near(p, BORDER_RED, tol), "({x},{y}) is {p:?}, not the border red");
                }
                ensure!(img::px(page, 60, 466) == FILL);
                ensure!(img::px(page, 620, 30) == FILL);
                ensure!(!img::near(img::px(page, 60, 466), (46, 50, 81), 4), "still the old built fill");
            }
            Ok(())
        }),
        case("dasdec_text_stays_inside_the_border_at_the_default_size", |tab| async move {
            let (_, pages) = build(&tab, "dasdec:dasdec", LONG_HEADER, "header").await?;
            ensure!(pages.len() == 2, "{} pages", pages.len());
            let mut widest = 0;
            for (index, page) in pages.iter().enumerate() {
                let (left, top, right, bottom) = text_bounds(page).with_context(|| format!("page {} has no text", index + 1))?;
                ensure!(left >= 12 && right <= 627, "page {index}: {left}..{right}");
                ensure!(top >= 12 && bottom <= 467, "page {index}: {top}..{bottom}");
                widest = widest.max(right - left);
            }
            ensure!((450..=580).contains(&widest), "widest line {widest}px");
            let rows = text_rows(&pages[0]);
            let tallest = rows.iter().map(|(_, t, b)| b - t).max().unwrap_or(0);
            ensure!(tallest <= 30, "glyph rows up to {tallest}px tall");
            ensure!(rows[0].1 >= 50, "the empty title band keeps the body off the top border");
            ensure!((427..=432).contains(&rows.last().unwrap().2), "the page counter sits on baseline 427");
            Ok(())
        }),
        case("dasdec_uses_the_fonts_own_advance_with_no_added_tracking", |tab| async move {
            let (_, pages) = build(&tab, "dasdec:dasdec", "IIIIIIIIII", "custom").await?;
            let middle = text_rows(&pages[0])[0].0 as u32;
            let lit: Vec<u32> = (0..640).filter(|&x| img::min_channel(img::px(&pages[0], x, middle)) >= 170).collect();
            let starts: Vec<u32> = lit.iter().copied().filter(|x| *x == 0 || !lit.contains(&(x - 1))).collect();
            ensure!(starts.len() == 10, "{starts:?}");
            let pitches: std::collections::BTreeSet<u32> = starts.windows(2).map(|w| w[1] - w[0]).collect();
            ensure!(pitches.iter().all(|p| *p == 15), "Luxi Mono Bold advances 15px at 25px: {pitches:?}");
            Ok(())
        }),
        case("dasdec_header_text_matches_the_reference_unit", |tab| async move {
            build(&tab, "dasdec:dasdec", "ZCZC-EAS-RMT-018000+0300-0781849-WFBQ FM -", "header").await?;
            let text = copy_text(&tab, "copyCrawlText").await?;
            let lines: Vec<&str> = text.split('\n').collect();
            ensure!(
                lines[..4] == ["An EAS Participant has issued A", "REQUIRED MONTHLY TEST for the", "following counties or areas:", "Indiana;"],
                "{lines:?}"
            );
            ensure!(*lines.last().unwrap() == "Message from WFBQ FM.", "{lines:?}");
            Ok(())
        }),
        case("dasdec_wraps_like_the_reference_unit", |tab| async move {
            let text = "An EAS Participant has issued A REQUIRED MONTHLY TEST for the following counties or areas:\n\
                        Indiana;\nat 1:49 PM\non MAR 19, 2026\nEffective until 4:49 PM.\nMessage from WFBQ FM.";
            let (_, pages) = build(&tab, "dasdec:dasdec", text, "custom").await?;
            let rows = text_rows(&pages[0]);
            ensure!(rows.len() == 9, "{:?}", rows.iter().map(|r| r.0.round()).collect::<Vec<_>>());
            let first = ink_width(&pages[0], rows[0].1, rows[0].2);
            let second = ink_width(&pages[0], rows[1].1, rows[1].2);
            ensure!((440..=465).contains(&first), "first line {first}px");
            ensure!((410..=435).contains(&second), "second line {second}px");
            let pitch = (rows[6].1 as f64 - rows[1].1 as f64) / 5.0;
            ensure!(approx(pitch, 34.0, 0.5), "line pitch {pitch}");
            Ok(())
        }),
        case("an_unbreakable_line_shrinks_the_page_to_fit", |tab| async move {
            let text = format!("SHORT LINE {}", "X".repeat(40));
            let (_, pages) = build(&tab, "dasdec:dasdec", &text, "custom").await?;
            let (left, _, right, _) = text_bounds(&pages[0]).context("no text")?;
            ensure!(left >= 12 && right <= 627, "{left}..{right}");
            Ok(())
        }),
        case("the_blue_variant_wraps_like_the_reference_unit", |tab| async move {
            build(&tab, "dasdec:dasdec_blue", LONG_HEADER, "header").await?;
            let text = copy_text(&tab, "copyCrawlText").await?;
            let lines: Vec<&str> = text.split('\n').collect();
            ensure!(
                lines[..5]
                    == [
                        "Emergency Alert System",
                        "The National Weather Service has issued A",
                        "SEVERE THUNDERSTORM WARNING for the",
                        "following counties or areas:",
                        "Isle of Wight;",
                    ],
                "{lines:?}"
            );
            Ok(())
        }),
        case("the_black_variant_wraps_at_thirty_six_columns", |tab| async move {
            build(&tab, "dasdec:dasdec_black", SHORT_HEADER, "header").await?;
            let text = copy_text(&tab, "copyCrawlText").await?;
            let lines: Vec<&str> = text.split('\n').collect();
            ensure!(
                lines[..5]
                    == [
                        "Emergency Alert System",
                        "The National Weather Service has",
                        "issued A SEVERE THUNDERSTORM WARNING",
                        "for the following counties or areas:",
                        "Eau Claire, WI;",
                    ],
                "{lines:?}"
            );
            Ok(())
        }),
        case("builder_templates_match_the_built_in_screens", |tab| async move {
            open_tool(&tab, "crawl").await?;
            let layouts: Value = tab
                .js_async(
                    "const done = arguments[arguments.length - 1];
                     import(arguments[0]).then(async (m) => {
                         const out = {};
                         for (const kind of ['dasdec', 'dasdec_black', 'dasdec_blue']) {
                             out[kind] = await m.createScreenTemplate(kind);
                         }
                         out.choices = m.templateChoices().map((choice) => choice.value);
                         done(out);
                     }).catch((e) => done({ error: String(e) }));",
                    json!(["./assets/js/crawl-screen-builder.js"]),
                )
                .await?;
            ensure!(layouts.get("error").is_none(), "{layouts}");
            let choices: Vec<&str> = layouts["choices"].as_array().unwrap().iter().filter_map(|v| v.as_str()).collect();
            for kind in ["dasdec", "dasdec_black", "dasdec_blue"] {
                ensure!(choices.contains(&kind), "{kind} missing from {choices:?}");
            }
            let dasdec = &layouts["dasdec"];
            ensure!(dasdec["name"] == "My DASDEC Screen");
            ensure!(dasdec["background"]["image"].as_str().unwrap_or("").starts_with("data:image/png;base64,"));
            let elements = dasdec["elements"].as_array().unwrap();
            ensure!(elements.len() == 2 && elements.iter().all(|e| e["type"] == "text"), "{elements:?}");
            let text = &elements[0];
            ensure!(text["font"] == "Luxi Mono" && text["size"] == 25 && text["letterSpacing"] == 0, "{text}");
            ensure!(text["x"] == 32 && text["width"] == 576 && text["wrap"] == "width", "{text}");
            ensure!(text["maxLines"] == 10 && text["overflow"] == "continue", "{text}");
            ensure!(elements[1]["text"] == "{PAGE}/{PAGES}" && elements[1]["page"] == -1, "{}", elements[1]);
            ensure!(layouts["dasdec_black"]["background"]["color"] == "#000000");
            ensure!(layouts["dasdec_blue"]["background"]["color"] == "#0000FF");
            for kind in ["dasdec_black", "dasdec_blue"] {
                let texts: Vec<&str> = layouts[kind]["elements"].as_array().unwrap().iter().filter_map(|e| e["text"].as_str()).collect();
                ensure!(texts == ["Emergency Alert System", "{TEXT}", "{PAGE}/{PAGES}"], "{kind}: {texts:?}");
            }
            Ok(())
        }),
        case("builder_template_pages_long_text_like_the_built_in_screen", |tab| async move {
            let text: String = (1..=15).map(|n| format!("LINE {n}")).collect::<Vec<_>>().join("\n");
            let (_, built_in) = build(&tab, "dasdec:dasdec_black", &text, "custom").await?;
            let rendered: Value = tab
                .js_async(
                    "const done = arguments[arguments.length - 1];
                     import(arguments[0]).then(async (m) => {
                         const layout = await m.createScreenTemplate('dasdec_black');
                         const out = await m.renderScreenFrames(layout, { TEXT: arguments[1] });
                         done({ pageCount: out.pageCount, rotationDelayMs: out.rotationDelayMs, pages: out.frames.map((f) => f.src) });
                     }).catch((e) => done({ error: String(e) }));",
                    json!(["./assets/js/crawl-screen-builder.js", text]),
                )
                .await?;
            ensure!(rendered.get("error").is_none(), "{rendered}");
            ensure!(rendered["pageCount"] == 2 && rendered["rotationDelayMs"] == 4000, "{}", rendered["pageCount"]);
            ensure!(built_in.len() == 2, "the built-in screen made {} pages", built_in.len());
            let custom = rendered["pages"]
                .as_array()
                .context("pages")?
                .iter()
                .map(|src| img::decode_data_url(src.as_str().unwrap_or_default()))
                .collect::<Result<Vec<_>>>()?;
            for (index, (ours, theirs)) in custom.iter().zip(&built_in).enumerate() {
                let ours = text_rows(ours);
                let theirs = text_rows(theirs);
                ensure!(ours.len() == theirs.len(), "page {}: {} rows vs the built-in's {}", index + 1, ours.len(), theirs.len());
                for (a, b) in ours.iter().zip(&theirs) {
                    ensure!(approx(a.0, b.0, 3.0), "page {}: row at {} vs the built-in's {}", index + 1, a.0, b.0);
                }
            }
            Ok(())
        }),
    ];
    for (id, premade, background) in [("black", "dasdec:dasdec_black", BLACK), ("blue", "dasdec:dasdec_blue", BLUE)] {
        cases.push(case(format!("variants_page_a_long_alert_on_a_plain_background[{id}]"), move |tab| async move {
            let (result, pages) = build(&tab, premade, LONG_HEADER, "header").await?;
            ensure!(result["width"] == 640 && result["height"] == 480 && result["rotationDelayMs"] == 4000, "{result}");
            ensure!(result["locked"] == true);
            ensure!(pages.len() == 2, "{} pages", pages.len());
            for page in &pages {
                for (x, y) in [(4, 4), (636, 476), (4, 240)] {
                    ensure!(img::px(page, x, y) == background, "({x},{y}) is {:?}", img::px(page, x, y));
                }
                let (left, _, right, _) = text_bounds(page).context("no text")?;
                ensure!(left >= 12 && right <= 627, "{premade}: {left}..{right}");
                let rows = text_rows(page);
                ensure!(rows[0].0 < 90.0, "the Emergency Alert System title belongs at the top");
                ensure!(approx(rows.last().unwrap().0, 450.0, 6.0), "the page counter sits at the bottom");
            }
            let second = text_rows(&pages[1]);
            ensure!(second[second.len() - 1].0 - second[second.len() - 2].0 > 150.0);
            Ok(())
        }));
    }
    cases
}
