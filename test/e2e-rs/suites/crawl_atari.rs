//! The Atari 800XL override screen renders from a SAME header and flashes the event code.
//!
//! Two frames are built per alert: the whole screen, and the same screen minus the event
//! code. Everything below asserts against those two rendered PNGs and the flash metadata,
//! because that pair is what both the live preview and the exporter consume.

use base64::Engine;
use eas_tools_e2e::img::{self, Rgb};
use eas_tools_e2e::*;
use image::RgbImage;

use crate::common::{approx, copy_text, open_tool, set_field};

const BROWN: Rgb = (165, 126, 66);
const WHITE: Rgb = (255, 255, 255);
const RED: Rgb = (255, 42, 16);
const ORANGE: Rgb = (255, 128, 0);
const GREEN: Rgb = (2, 211, 6);

const WARNING: &str = "ZCZC-CIV-CAE-006000+0000-2521800-KTLA TV5-";
const WATCH: &str = "ZCZC-WXR-SVA-039045-039073-039129+0300-2521800-KEPZ/NWS-";
const TEST: &str = "ZCZC-EAS-RWT-012057+0015-2521800-WAGS TV -";

const BUILD_SCREEN_JS: &str = r#"
const done = arguments[arguments.length - 1];
const header = arguments[0];
(async () => {
    try {
        document.getElementById('crawlMode').value = 'header';
        document.getElementById('crawlMode').dispatchEvent(new Event('change', { bubbles: true }));
        document.getElementById('crawlRawHeader').value = header;
        document.getElementById('crawlRawHeader').dispatchEvent(new Event('input', { bubbles: true }));
        document.getElementById('crawlBackgroundMode').value = 'premade';
        document.getElementById('crawlBackgroundMode').dispatchEvent(new Event('change', { bubbles: true }));
        const select = document.getElementById('crawlBackgroundPremadeSelect');
        select.value = 'atari:atari_800xl';
        select.dispatchEvent(new Event('change', { bubbles: true }));

        const applied = () => {
            let saved = null;
            try { saved = JSON.parse(localStorage.getItem('eas-tools-crawl-settings')); } catch (error) { }
            return !!saved && saved.crawlMode === 'header' && saved.rawHeader === header
                && saved.crawlBackgroundMode === 'premade' && saved.crawlBackgroundPremade === 'atari:atari_800xl';
        };
        const deadline = Date.now() + 25000;
        while (Date.now() < deadline) {
            const bg = window.__dasdecBackground;
            if (bg && Array.isArray(bg.pages) && bg.pages.length === 2 && applied()) {
                done({
                    ok: true,
                    frames: bg.pages.map((page) => page.src),
                    rotationDelayMs: bg.rotationDelayMs,
                    drivesTotalFrames: bg.drivesTotalFrames,
                    width: bg.width,
                    height: bg.height,
                    rotating: !!window.__dasdecRotationState,
                });
                return;
            }
            await new Promise((resolve) => setTimeout(resolve, 25));
        }
        done({ ok: false, error: 'the Atari background never appeared' });
    } catch (error) {
        done({ ok: false, error: String(error) });
    }
})();
"#;

const EXPORT_GIF_JS: &str = r#"
const done = arguments[arguments.length - 1];
(async () => {
    try {
        let captured = null;
        const previous = window.EASDownloads;
        window.EASDownloads = { saveBlob: async (blob) => { captured = blob; } };
        try {
            document.getElementById('exportCrawlGIF').click();
            const deadline = Date.now() + 120000;
            while (Date.now() < deadline && captured === null) {
                await new Promise((resolve) => setTimeout(resolve, 50));
            }
        } finally {
            window.EASDownloads = previous;
        }
        if (!captured) { done({ ok: false, error: 'the GIF export produced nothing' }); return; }
        const bytes = new Uint8Array(await captured.arrayBuffer());
        let binary = '';
        for (let i = 0; i < bytes.length; i += 0x8000) {
            binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
        }
        done({ ok: true, gif: btoa(binary), fps: Number(document.getElementById('crawlExportGifFps').value) });
    } catch (error) {
        done({ ok: false, error: String(error) });
    }
})();
"#;

/// Exports a video and reports each encoded frame's timestamp, duration and whether the red event code is lit.
const EXPORT_VIDEO_FRAMES_JS: &str = r#"
const done = arguments[arguments.length - 1];
(async () => {
    try {
        let captured = null;
        const previous = window.EASDownloads;
        window.EASDownloads = { saveBlob: async (blob) => { captured = blob; } };
        try {
            document.getElementById('exportCrawlVideo').click();
            const deadline = Date.now() + 150000;
            while (Date.now() < deadline && captured === null) {
                await new Promise((resolve) => setTimeout(resolve, 50));
            }
        } finally {
            window.EASDownloads = previous;
        }
        if (!captured) { done({ ok: false, error: 'the video export produced nothing' }); return; }
        const mb = await import(new URL('assets/js/mediabunny/mediabunny.min.js', document.baseURI).href);
        const input = new mb.Input({ source: new mb.BlobSource(captured), formats: mb.ALL_FORMATS });
        const track = await input.getPrimaryVideoTrack();
        const duration = await track.computeDuration();
        const sink = new mb.CanvasSink(track);
        const frames = [];
        for await (const { canvas, timestamp, duration: length } of sink.canvases()) {
            const { data } = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height);
            let red = 0;
            for (let i = 0; i < data.length; i += 4) {
                if (data[i] > 200 && data[i + 1] < 100 && data[i + 2] < 80) red++;
            }
            frames.push({ t: timestamp, d: length, lit: red > 200 });
        }
        done({ ok: true, duration, frames, status: document.getElementById('status-crawl').innerText });
    } catch (error) {
        done({ ok: false, error: String(error) });
    }
})();
"#;

const BUILD_CUSTOM_SCREEN_JS: &str = r#"
const done = arguments[arguments.length - 1];
const [originator, eventCode, text] = [arguments[0], arguments[1], arguments[2]];
(async () => {
    try {
        const deadline = Date.now() + 25000;
        while (Date.now() < deadline
            && !document.querySelector('#easyplusEventCode option[value="' + eventCode + '"]')) {
            await new Promise((resolve) => setTimeout(resolve, 25));
        }
        const set = (id, value, type) => {
            const el = document.getElementById(id);
            el.value = value;
            el.dispatchEvent(new Event(type || 'change', { bubbles: true }));
        };
        const previous = window.__dasdecBackground;
        if (previous) previous.__seenByTest = true;
        set('crawlMode', 'custom');
        set('crawlText', text, 'input');
        set('crawlBackgroundMode', 'premade');
        set('crawlBackgroundPremadeSelect', 'atari:atari_800xl');
        set('easyplusOriginator', originator);
        set('easyplusEventCode', eventCode);

        const applied = () => {
            let saved = null;
            try { saved = JSON.parse(localStorage.getItem('eas-tools-crawl-settings')); } catch (error) { }
            return !!saved && saved.crawlMode === 'custom' && saved.text === text
                && saved.crawlBackgroundMode === 'premade' && saved.crawlBackgroundPremade === 'atari:atari_800xl'
                && saved.easyplusOriginator === originator && saved.easyplusEventCode === eventCode;
        };
        while (Date.now() < deadline) {
            const bg = window.__dasdecBackground;
            if (bg && !bg.__seenByTest && Array.isArray(bg.pages) && bg.pages.length === 2
                && document.getElementById('easyplusEventCode').value === eventCode && applied()) {
                bg.__seenByTest = true;
                const settings = document.getElementById('easyplusSettings');
                done({
                    ok: true,
                    frames: bg.pages.map((page) => page.src),
                    rotationDelayMs: bg.rotationDelayMs,
                    pickersVisible: getComputedStyle(settings).display !== 'none',
                    labels: Array.from(settings.querySelectorAll('label')).map((label) => label.textContent.trim()),
                });
                return;
            }
            await new Promise((resolve) => setTimeout(resolve, 25));
        }
        done({ ok: false, error: 'the Atari background never re-rendered' });
    } catch (error) {
        done({ ok: false, error: String(error) });
    }
})();
"#;

fn frames_of(result: &Value) -> Result<Vec<RgbImage>> {
    result["frames"]
        .as_array()
        .context("frames")?
        .iter()
        .map(|src| img::decode_data_url(src.as_str().unwrap_or_default()))
        .collect()
}

async fn build(tab: &Tab, header: &str) -> Result<(Value, Vec<RgbImage>)> {
    open_tool(tab, "crawl").await?;
    let result: Value = tab.js_async(BUILD_SCREEN_JS, json!([header])).await?;
    ensure!(result["ok"] == true, "{result}");
    let frames = frames_of(&result)?;
    Ok((result, frames))
}

async fn build_custom(tab: &Tab, originator: &str, event: &str) -> Result<(Value, Vec<RgbImage>)> {
    let result: Value = tab.js_async(BUILD_CUSTOM_SCREEN_JS, json!([originator, event, "testing the crawl text"])).await?;
    ensure!(result["ok"] == true, "{result}");
    let frames = frames_of(&result)?;
    Ok((result, frames))
}

struct ExportedFrame {
    t: f64,
    d: f64,
    lit: bool,
}

/// Builds the warning screen with a short crawl and exports it as WebM at the given Video FPS choice.
async fn export_video_frames(tab: &Tab, fps: &str) -> Result<(f64, Vec<ExportedFrame>, String)> {
    build(tab, WARNING).await?;
    set_field(tab, "#crawlSpeed", "20").await?;
    set_field(tab, "#crawlRepetitions", "1").await?;
    set_field(tab, "#crawlExportVideoFormat", "webm").await?;
    set_field(tab, "#crawlExportVideoFps", fps).await?;
    let result: Value = tab.js_async_timeout(EXPORT_VIDEO_FRAMES_JS, json!([]), Duration::from_secs(180)).await?;
    ensure!(result["ok"] == true, "{}", result["error"]);
    let frames = result["frames"]
        .as_array()
        .context("frames")?
        .iter()
        .map(|f| ExportedFrame { t: f["t"].as_f64().unwrap_or(-1.0), d: f["d"].as_f64().unwrap_or(-1.0), lit: f["lit"] == true })
        .collect();
    Ok((result["duration"].as_f64().unwrap_or_default(), frames, result["status"].as_str().unwrap_or_default().to_string()))
}

fn palette(image: &RgbImage) -> Vec<Rgb> {
    img::palette(image, 40, 150)
}

fn has(palette: &[Rgb], target: Rgb) -> bool {
    palette.iter().any(|c| img::near(*c, target, 12))
}

fn rows(image: &RgbImage, target: Rgb) -> Vec<f64> {
    img::color_rows(image, target, 12)
}

fn non_empty_lines(text: &str) -> Vec<String> {
    text.split('\n').filter(|l| !l.trim().is_empty()).map(str::to_string).collect()
}

pub fn cases() -> Vec<Case> {
    let mut cases = vec![
        case("the_screen_is_640x480_on_black_and_flashes_twice_a_second", |tab| async move {
            let (result, frames) = build(&tab, WARNING).await?;
            ensure!(result["width"] == 640 && result["height"] == 480, "{result}");
            ensure!(result["rotationDelayMs"] == 500 && result["rotating"] == true, "{result}");
            ensure!(frames.iter().all(|f| f.dimensions() == (640, 480)));
            ensure!(img::px(&frames[0], 5, 5) == (0, 0, 0));
            Ok(())
        }),
        case("the_flash_only_removes_the_event_code", |tab| async move {
            let (_, frames) = build(&tab, WARNING).await?;
            let (lit, dark) = (&frames[0], &frames[1]);
            ensure!(!rows(lit, RED).is_empty(), "the lit frame has no event code");
            ensure!(rows(dark, RED).is_empty(), "the dark frame still shows the event code");
            for target in [BROWN, WHITE] {
                ensure!(rows(lit, target) == rows(dark, target), "{target:?} lines moved between frames");
            }
            Ok(())
        }),
        case("the_brown_and_white_lines_sit_where_the_reference_puts_them", |tab| async move {
            let (_, frames) = build(&tab, WARNING).await?;
            let brown = rows(&frames[0], BROWN);
            let white = rows(&frames[0], WHITE);
            ensure!(brown.len() == 3, "{brown:?}");
            ensure!((0.10..0.14).contains(&(brown[0] / 480.0)), "{brown:?}");
            ensure!((0.83..0.87).contains(&(brown[2] / 480.0)), "{brown:?}");
            ensure!(white.len() == 2, "{white:?}");
            ensure!(brown[0] < white[0] && white[0] < brown[2], "{brown:?} {white:?}");
            ensure!(approx(white[1], brown[1], 1.0), "UNTIL and the purge time must share a line");
            Ok(())
        }),
        case("copying_the_crawl_text_gives_the_screen_text", |tab| async move {
            build(&tab, WATCH).await?;
            let lines = non_empty_lines(&copy_text(&tab, "copyCrawlText").await?);
            let joined = lines.join(" ");
            ensure!(lines[0] == "EMERGENCY ALERT SYSTEM", "{lines:?}");
            ensure!(joined.contains("SEVERE THUNDERSTORM WATCH"), "{lines:?}");
            ensure!(joined.contains("FOR FAIRFIELD, HOCKING AND PICKAWAY COUNTIES"), "{lines:?}");
            ensure!(lines.iter().any(|l| l.starts_with("UNTIL ") && l.ends_with('.')), "{lines:?}");
            ensure!(lines.last().unwrap() == "KEPZ/NWS", "{lines:?}");
            Ok(())
        }),
        case("a_single_county_is_not_pluralized_and_a_statewide_code_reads_as_all_of", |tab| async move {
            build(&tab, TEST).await?;
            let single = copy_text(&tab, "copyCrawlText").await?;
            ensure!(single.contains("FOR HILLSBOROUGH COUNTY") && !single.contains("COUNTIES"), "{single}");
            build(&tab, WARNING).await?;
            let statewide = copy_text(&tab, "copyCrawlText").await?;
            ensure!(statewide.contains("FOR ALL OF CALIFORNIA"), "{statewide}");
            ensure!(statewide.contains("UNTIL FURTHER NOTICE."), "{statewide}");
            Ok(())
        }),
        case("the_flash_survives_into_an_exported_gif", |tab| async move {
            build(&tab, WARNING).await?;
            tab.exec(
                "const speed = document.getElementById('crawlSpeed');
                 speed.value = '20';
                 speed.dispatchEvent(new Event('change', { bubbles: true }));
                 const reps = document.getElementById('crawlRepetitions');
                 reps.value = '1';
                 reps.dispatchEvent(new Event('change', { bubbles: true }));",
                json!([]),
            )
            .await?;
            let result: Value = tab.js_async_timeout(EXPORT_GIF_JS, json!([]), Duration::from_secs(150)).await?;
            ensure!(result["ok"] == true, "{}", result["error"]);
            let bytes = base64::engine::general_purpose::STANDARD.decode(result["gif"].as_str().unwrap_or_default())?;
            let frames = img::gif_frames(&bytes)?;
            ensure!(frames[0].dimensions() == (640, 480));
            let lit: Vec<bool> = frames.iter().map(|f| !img::color_rows(f, RED, 40).is_empty()).collect();
            ensure!(lit.iter().any(|v| *v), "the exported GIF never shows the event code");
            ensure!(!lit.iter().all(|v| *v), "the exported GIF never blanks the event code");
            let expected = ((result["fps"].as_f64().unwrap_or(50.0) / 2.0).round() as usize).max(1);
            let mut runs: Vec<(bool, usize)> = Vec::new();
            for value in lit {
                match runs.last_mut() {
                    Some((v, n)) if *v == value => *n += 1,
                    _ => runs.push((value, 1)),
                }
            }
            ensure!(runs.len() > 2, "{runs:?}");
            for (_, length) in &runs[1..runs.len() - 1] {
                ensure!(*length == expected, "flash runs {runs:?}, expected {expected} frames each");
            }
            ensure!(frames.len() > expected * 2, "a flashing screen must not shorten the crawl to one cycle");
            Ok(())
        }),
        case("a_2_fps_video_export_keeps_the_half_second_flash", |tab| async move {
            let (duration, frames, _) = export_video_frames(&tab, "2").await?;
            ensure!(frames.len() >= 4, "only {} frames over {duration} s", frames.len());
            for (i, frame) in frames.iter().enumerate() {
                ensure!(approx(frame.d, 0.5, 0.01), "frame {i} lasts {} s", frame.d);
                if i > 0 {
                    ensure!(frame.lit != frames[i - 1].lit, "frames {} and {i} both have lit={}", i - 1, frame.lit);
                }
            }
            Ok(())
        }),
        case("only_when_changed_writes_one_frame_per_flash", |tab| async move {
            let (duration, frames, _) = export_video_frames(&tab, "changed").await?;
            ensure!(duration > 1.0, "the export is only {duration} s long");
            ensure!(frames.len() >= 3, "only {} frames", frames.len());
            ensure!(
                frames.len() as f64 <= duration * 2.0 + 2.0,
                "{} frames over {duration} s; unchanged frames were written",
                frames.len()
            );
            ensure!(approx(frames[0].t, 0.0, 0.001), "the first frame starts at {} s", frames[0].t);
            let changes = &frames[..frames.len() - 1];
            for i in 1..changes.len() {
                ensure!(approx(changes[i].t - changes[i - 1].t, 0.5, 0.02), "frame {i} starts at {} s after {} s", changes[i].t, changes[i - 1].t);
                ensure!(changes[i].lit != changes[i - 1].lit, "frames {} and {i} both have lit={}", i - 1, changes[i].lit);
            }
            let last = frames.last().unwrap();
            ensure!(approx(last.t + last.d, duration, 0.02), "the last frame ends at {} s of {duration} s", last.t + last.d);
            Ok(())
        }),
        case("a_1_fps_export_warns_that_the_flash_cannot_be_timed", |tab| async move {
            let (_, _, status) = export_video_frames(&tab, "1").await?;
            ensure!(status.contains("500 ms page changes can't be timed exactly"), "no timing warning in: {status}");
            Ok(())
        }),
        case("without_a_header_the_dropdowns_pick_the_event_and_originator", |tab| async move {
            open_tool(&tab, "crawl").await?;
            let (result, frames) = build_custom(&tab, "WXR", "TOR").await?;
            ensure!(result["pickersVisible"] == true, "the originator/event dropdowns are hidden for the Atari screen");
            ensure!(result["labels"] == json!(["Originator:", "Event Code:"]), "{}", result["labels"]);
            ensure!(result["rotationDelayMs"] == 500);
            ensure!(!rows(&frames[0], RED).is_empty(), "a Tornado Warning should flash in the warning color");
            ensure!(rows(&frames[1], RED).is_empty(), "the dark frame still shows the event");
            let colors = palette(&frames[0]);
            ensure!(!has(&colors, ORANGE) && !has(&colors, GREEN), "{:?}", &colors[..colors.len().min(6)]);
            let lines = non_empty_lines(&copy_text(&tab, "copyCrawlText").await?);
            let joined = lines.join(" ");
            ensure!(lines[0] == "EMERGENCY ALERT SYSTEM", "{lines:?}");
            ensure!(joined.contains("TORNADO WARNING") && !joined.contains("TESTING THE CRAWL TEXT"), "{lines:?}");
            ensure!(lines.iter().any(|l| l == "FOR YOUR AREA"), "{lines:?}");
            ensure!(lines.last().unwrap() == "NATIONAL WEATHER SERVICE", "{lines:?}");
            Ok(())
        }),
        case("header_mode_still_ignores_the_dropdowns", |tab| async move {
            open_tool(&tab, "crawl").await?;
            tab.wait_until("!!document.querySelector('#easyplusEventCode option[value=\"RWT\"]')", Duration::from_secs(30))
                .await?;
            tab.exec(
                "const set = (id, value) => {
                     const el = document.getElementById(id);
                     el.value = value;
                     el.dispatchEvent(new Event('change', { bubbles: true }));
                 };
                 set('easyplusOriginator', 'CIV');
                 set('easyplusEventCode', 'RWT');",
                json!([]),
            )
            .await?;
            let result: Value = tab.js_async(BUILD_SCREEN_JS, json!([WATCH])).await?;
            ensure!(result["ok"] == true, "{result}");
            let picked: String = tab.eval("document.getElementById('easyplusEventCode').value").await?;
            ensure!(picked == "RWT");
            let colors = palette(&frames_of(&result)?[0]);
            ensure!(has(&colors, ORANGE) && !has(&colors, GREEN), "{:?}", &colors[..colors.len().min(6)]);
            Ok(())
        }),
        case("the_atari_font_is_offered_to_the_crawl_itself", |tab| async move {
            open_tool(&tab, "crawl").await?;
            tab.wait_until(
                "Array.from(document.querySelectorAll('#crawlFontFamily option')).some(o => o.value === 'Atari 800XL')",
                Duration::from_secs(40),
            )
            .await?;
            let ok: bool = tab.eval("document.fonts.check('16px \"Atari 800XL\"')").await?;
            ensure!(ok, "the Atari 800XL font is not loaded");
            Ok(())
        }),
    ];
    for (id, header, expected) in [("warning", WARNING, RED), ("watch", WATCH, ORANGE), ("test", TEST, GREEN)] {
        cases.push(case(format!("the_event_code_is_colored_by_severity[{id}]"), move |tab| async move {
            let (_, frames) = build(&tab, header).await?;
            let colors = palette(&frames[0]);
            ensure!(has(&colors, expected), "{id}: {:?}", &colors[..colors.len().min(6)]);
            for other in [RED, ORANGE, GREEN] {
                if other != expected {
                    ensure!(!has(&colors, other), "{id} also shows {other:?}");
                }
            }
            Ok(())
        }));
    }
    for (event, expected) in [("SVA", ORANGE), ("RWT", GREEN)] {
        cases.push(case(format!("changing_the_event_dropdown_recolors_the_screen[{event}]"), move |tab| async move {
            open_tool(&tab, "crawl").await?;
            build_custom(&tab, "WXR", "TOR").await?;
            let (_, frames) = build_custom(&tab, "CIV", event).await?;
            let colors = palette(&frames[0]);
            ensure!(has(&colors, expected) && !has(&colors, RED), "{event}: {:?}", &colors[..colors.len().min(6)]);
            Ok(())
        }));
    }
    cases
}
