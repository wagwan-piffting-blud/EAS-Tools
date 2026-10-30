//! A local video file plays behind the crawl in the preview and is decoded frame by frame into exports.
//!
//! The fixture is a 2 s, 320x180 WebM built in the page with the vendored mediabunny: one second of
//! red, then one second of green, so a frame's color says which part of the video it came from.

use eas_tools_e2e::img::{self, Rgb};
use eas_tools_e2e::*;

use crate::common::{open_tool_tracking_errors, set_checkbox, set_field};

const RED: Rgb = (255, 0, 0);
const GREEN: Rgb = (0, 255, 0);
const BLUE: Rgb = (0, 0, 255);

const LOAD_VIDEO_JS: &str = r#"
const done = arguments[arguments.length - 1];
(async () => {
    try {
        const mb = await import(new URL('assets/js/mediabunny/mediabunny.min.js', document.baseURI).href);
        const canvas = document.createElement('canvas');
        canvas.width = 320;
        canvas.height = 180;
        const ctx = canvas.getContext('2d');
        const codec = await mb.getFirstEncodableVideoCodec(['vp8', 'vp9'], { width: 320, height: 180 });
        if (!codec) { done({ ok: false, error: 'no VP8/VP9 encoder' }); return; }
        const output = new mb.Output({ format: new mb.WebMOutputFormat(), target: new mb.BufferTarget() });
        const source = new mb.CanvasSource(canvas, { codec, bitrate: 400000, keyFrameInterval: 1 });
        output.addVideoTrack(source, { frameRate: 10 });
        await output.start();
        for (let i = 0; i < 20; i++) {
            ctx.fillStyle = i < 10 ? '#ff0000' : '#00ff00';
            ctx.fillRect(0, 0, 320, 180);
            await source.add(i / 10, 0.1);
        }
        source.close();
        await output.finalize();

        const file = new File([output.target.buffer], 'background.webm', { type: 'video/webm' });
        const transfer = new DataTransfer();
        transfer.items.add(file);
        const mode = document.getElementById('crawlBackgroundMode');
        mode.value = 'video';
        mode.dispatchEvent(new Event('change', { bubbles: true }));
        const input = document.getElementById('crawlBackgroundVideoFile');
        input.files = transfer.files;
        input.dispatchEvent(new Event('change', { bubbles: true }));

        const deadline = Date.now() + 20000;
        while (Date.now() < deadline) {
            const video = window.crawlGenerator && window.crawlGenerator.bgVideo;
            if (video && video.readyState >= 2) break;
            await new Promise((resolve) => setTimeout(resolve, 25));
        }
        const video = window.crawlGenerator && window.crawlGenerator.bgVideo;
        done(video ? { ok: true, width: video.videoWidth, height: video.videoHeight } : { ok: false, error: 'the video never loaded' });
    } catch (error) {
        done({ ok: false, error: String(error) });
    }
})();
"#;

const PIXEL_JS: &str = r#"
const canvas = window.crawlGenerator.canvas;
const [r, g, b] = canvas.getContext('2d').getImageData(arguments[0], arguments[1], 1, 1).data;
return [r, g, b];
"#;

/// Exports with the given button and decodes frames of the result at `arguments[1]` seconds.
const EXPORT_VIDEO_JS: &str = r#"
const done = arguments[arguments.length - 1];
const times = arguments[0];
const hideDecoder = arguments[1];
(async () => {
    const savedDecoder = window.VideoDecoder;
    try {
        let captured = null;
        const previous = window.EASDownloads;
        window.EASDownloads = { saveBlob: async (blob) => { captured = blob; } };
        if (hideDecoder) window.VideoDecoder = undefined;
        try {
            document.getElementById('exportCrawlVideo').click();
            const deadline = Date.now() + 120000;
            while (Date.now() < deadline && captured === null) {
                await new Promise((resolve) => setTimeout(resolve, 50));
            }
        } finally {
            window.EASDownloads = previous;
            window.VideoDecoder = savedDecoder;
        }
        if (!captured) { done({ ok: false, error: 'the video export produced nothing' }); return; }
        const mb = await import(new URL('assets/js/mediabunny/mediabunny.min.js', document.baseURI).href);
        const input = new mb.Input({ source: new mb.BlobSource(captured), formats: mb.ALL_FORMATS });
        const track = await input.getPrimaryVideoTrack();
        const duration = await track.computeDuration();
        const sink = new mb.CanvasSink(track);
        const pixels = [];
        for (const time of times) {
            const frame = await sink.getCanvas(time);
            if (!frame) { pixels.push(null); continue; }
            const ctx = frame.canvas.getContext('2d');
            pixels.push(Array.from(ctx.getImageData(4, 4, 1, 1).data.slice(0, 3)));
        }
        done({ ok: true, duration, pixels });
    } catch (error) {
        window.VideoDecoder = savedDecoder;
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
        done({ ok: true, gif: btoa(binary) });
    } catch (error) {
        done({ ok: false, error: String(error) });
    }
})();
"#;

/// Loads the fixture video with the crawl bar hidden, so background pixels show the video itself.
async fn setup(tab: &Tab, width: u32, height: u32) -> Result<()> {
    setup_with_bar(tab, width, height, "0").await
}

async fn setup_with_bar(tab: &Tab, width: u32, height: u32, bar_opacity: &str) -> Result<()> {
    open_tool_tracking_errors(tab, "crawl").await?;
    set_field(tab, "#crawlMode", "custom").await?;
    tab.wait_until("!!window.crawlEditor", Duration::from_secs(20)).await?;
    tab.exec("window.crawlEditor.setValue('TEST');", json!([])).await?;
    set_field(tab, "#crawlSpeed", "2").await?;
    set_field(tab, "#crawlRestartDelay", "500").await?;
    set_field(tab, "#crawlExportVideoFps", "30").await?;
    set_field(tab, "#crawlExportVideoFormat", "webm").await?;
    set_field(tab, "#crawlVideoBarOpacity", bar_opacity).await?;
    let loaded: Value = tab.js_async(LOAD_VIDEO_JS, json!([])).await?;
    ensure!(loaded["ok"] == true, "{loaded}");
    tab.wait_until("window.crawlGenerator.canvas.width === 320 && window.crawlGenerator.canvas.height === 180", Duration::from_secs(10))
        .await
        .context("choosing the video did not size the crawl to it")?;
    if (width, height) != (320, 180) {
        set_field(tab, "#crawlWidth", &width.to_string()).await?;
        set_field(tab, "#crawlHeight", &height.to_string()).await?;
    }
    tab.wait_until(
        &format!("window.crawlGenerator.canvas.width === {width} && window.crawlGenerator.canvas.height === {height}"),
        Duration::from_secs(10),
    )
    .await
}

/// Rows of the live canvas holding white text pixels, once the running crawl has text on screen.
const TEXT_ROWS_JS: &str = r#"
const done = arguments[arguments.length - 1];
(async () => {
    const canvas = window.crawlGenerator.canvas;
    const ctx = canvas.getContext('2d');
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
        const { data, width, height } = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const rows = [];
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const i = (y * width + x) * 4;
                if (data[i] > 200 && data[i + 1] > 200 && data[i + 2] > 200) { rows.push(y); break; }
            }
        }
        if (rows.length) { done({ ok: true, top: rows[0], bottom: rows[rows.length - 1] }); return; }
        await new Promise((resolve) => setTimeout(resolve, 50));
    }
    done({ ok: false, error: 'no crawl text ever appeared' });
})();
"#;

async fn text_rows(tab: &Tab) -> Result<(i64, i64)> {
    let result: Value = tab.js_async(TEXT_ROWS_JS, json!([])).await?;
    ensure!(result["ok"] == true, "{result}");
    Ok((result["top"].as_i64().unwrap_or(-1), result["bottom"].as_i64().unwrap_or(-1)))
}

async fn pixel(tab: &Tab, x: u32, y: u32) -> Result<Rgb> {
    let rgb: Vec<u8> = tab.js(PIXEL_JS, json!([x, y])).await?;
    Ok((rgb[0], rgb[1], rgb[2]))
}

async fn wait_pixel(tab: &Tab, x: u32, y: u32, target: Rgb) -> Result<()> {
    let deadline = std::time::Instant::now() + Duration::from_secs(10);
    loop {
        let seen = pixel(tab, x, y).await?;
        if img::near(seen, target, 40) {
            return Ok(());
        }
        ensure!(std::time::Instant::now() < deadline, "pixel ({x}, {y}) is {seen:?}, expected {target:?}");
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
}

fn rgb_of(value: &Value) -> Option<Rgb> {
    let parts = value.as_array()?;
    Some((parts[0].as_u64()? as u8, parts[1].as_u64()? as u8, parts[2].as_u64()? as u8))
}

async fn check_video_export(tab: &Tab, hide_decoder: bool) -> Result<()> {
    setup(tab, 320, 180).await?;
    let result: Value = tab.js_async(EXPORT_VIDEO_JS, json!([[0.3, 1.3, 2.3], hide_decoder])).await?;
    ensure!(result["ok"] == true, "{result}");
    let duration = result["duration"].as_f64().unwrap_or_default();
    ensure!(duration > 2.4, "the export is only {duration} s long");
    let pixels: Vec<Option<Rgb>> = result["pixels"].as_array().context("pixels")?.iter().map(rgb_of).collect();
    let expected = [RED, GREEN, RED];
    for (index, (seen, target)) in pixels.iter().zip(expected).enumerate() {
        let seen = seen.with_context(|| format!("no frame {index}"))?;
        ensure!(img::near(seen, target, 60), "frame {index} is {seen:?}, expected {target:?}: {pixels:?}");
    }
    let errors: Vec<String> = tab.eval("window.__testErrors || []").await?;
    ensure!(errors.is_empty(), "console errors {errors:?}");
    Ok(())
}

pub fn cases() -> Vec<Case> {
    vec![
        case("preview_draws_the_video_and_follows_play_and_pause", |tab| async move {
            setup(&tab, 320, 180).await?;
            wait_pixel(&tab, 4, 4, RED).await?;
            let mounted: Value = tab
                .eval(
                    "(() => { const v = window.crawlGenerator.bgVideo; const r = v.getBoundingClientRect();
                     return { inPanel: !!v.closest('#crawl-panel'), loose: document.querySelectorAll('body > video').length, w: r.width, h: r.height,
                              hidden: v.parentElement.getAttribute('aria-hidden'), pip: v.disablePictureInPicture }; })()",
                )
                .await?;
            ensure!(mounted["inPanel"] == true && mounted["loose"] == 0, "the video is not held in the crawl panel: {mounted}");
            ensure!(mounted["w"].as_f64() <= Some(1.0) && mounted["hidden"] == "true" && mounted["pip"] == true, "{mounted}");
            tab.exec("document.getElementById('pauseCrawl').click();", json!([])).await?;
            tab.wait_until("!window.crawlGenerator.bgVideo.paused", Duration::from_secs(5)).await?;
            tab.wait_until("window.crawlGenerator.bgVideo.currentTime > 1.1", Duration::from_secs(10)).await?;
            wait_pixel(&tab, 4, 4, GREEN).await?;
            tab.exec("document.getElementById('pauseCrawl').click();", json!([])).await?;
            tab.wait_until("window.crawlGenerator.bgVideo.paused", Duration::from_secs(5)).await?;
            Ok(())
        }),
        case("fit_inside_letterboxes_with_the_background_color", |tab| async move {
            setup(&tab, 320, 320).await?;
            set_field(&tab, "#crawlBgColor", "#0000ff").await?;
            set_field(&tab, "#crawlBackgroundVideoFit", "contain").await?;
            wait_pixel(&tab, 4, 4, BLUE).await?;
            wait_pixel(&tab, 4, 160, RED).await?;
            set_field(&tab, "#crawlBackgroundVideoFit", "cover").await?;
            wait_pixel(&tab, 4, 4, RED).await?;
            Ok(())
        }),
        case("video_export_decodes_the_background_frame_by_frame", |tab| async move { check_video_export(&tab, false).await }),
        case("video_export_falls_back_to_seeking_without_webcodecs_decode", |tab| async move { check_video_export(&tab, true).await }),
        case("gif_export_carries_the_video", |tab| async move {
            setup(&tab, 160, 90).await?;
            set_field(&tab, "#crawlExportGifFps", "20").await?;
            let result: Value = tab.js_async(EXPORT_GIF_JS, json!([])).await?;
            ensure!(result["ok"] == true, "{result}");
            use base64::Engine;
            let bytes = base64::engine::general_purpose::STANDARD.decode(result["gif"].as_str().unwrap_or_default())?;
            let frames = img::gif_frames(&bytes)?;
            ensure!(frames.len() > 30, "only {} GIF frames", frames.len());
            ensure!(img::near(img::px(&frames[6], 2, 2), RED, 60), "frame 6 is {:?}", img::px(&frames[6], 2, 2));
            ensure!(img::near(img::px(&frames[26], 2, 2), GREEN, 60), "frame 26 is {:?}", img::px(&frames[26], 2, 2));
            Ok(())
        }),
        case("the_crawl_runs_in_a_bar_over_the_video", |tab| async move {
            setup_with_bar(&tab, 320, 180, "100").await?;
            set_field(&tab, "#crawlBgColor", "#0000ff").await?;
            set_field(&tab, "#crawlVideoBarHeight", "40").await?;
            wait_pixel(&tab, 4, 4, BLUE).await?;
            wait_pixel(&tab, 4, 120, RED).await?;
            tab.exec("document.getElementById('pauseCrawl').click();", json!([])).await?;
            let (top, bottom) = text_rows(&tab).await?;
            ensure!(top >= 0 && bottom < 40, "the text left the top bar: rows {top}..{bottom}");
            set_field(&tab, "#crawlVideoBarPosition", "bottom").await?;
            wait_pixel(&tab, 4, 4, RED).await?;
            wait_pixel(&tab, 4, 176, BLUE).await?;
            let (top, bottom) = text_rows(&tab).await?;
            ensure!(top >= 140 && bottom < 180, "the text left the bottom bar: rows {top}..{bottom}");
            let disabled: bool = tab.eval("document.getElementById('crawlVideoBarY').disabled").await?;
            ensure!(disabled, "the custom distance is editable outside Custom");
            set_field(&tab, "#crawlVideoBarPosition", "custom").await?;
            set_field(&tab, "#crawlVideoBarY", "70").await?;
            wait_pixel(&tab, 4, 90, BLUE).await?;
            wait_pixel(&tab, 4, 4, RED).await?;
            Ok(())
        }),
        case("video_export_keeps_the_crawl_bar", |tab| async move {
            setup_with_bar(&tab, 320, 180, "100").await?;
            set_field(&tab, "#crawlBgColor", "#0000ff").await?;
            set_field(&tab, "#crawlVideoBarHeight", "40").await?;
            set_field(&tab, "#crawlVideoBarPosition", "bottom").await?;
            let result: Value = tab
                .js_async(
                    &EXPORT_VIDEO_JS.replace("getImageData(4, 4, 1, 1)", "getImageData(4, 176, 1, 1)"),
                    json!([[0.3, 1.3], false]),
                )
                .await?;
            ensure!(result["ok"] == true, "{result}");
            for value in result["pixels"].as_array().context("pixels")? {
                let seen = rgb_of(value).context("missing frame")?;
                ensure!(img::near(seen, BLUE, 60), "the exported bar is {seen:?}: {result}");
            }
            let top: Value = tab.js_async(EXPORT_VIDEO_JS, json!([[0.3, 1.3], false])).await?;
            let colors: Vec<Option<Rgb>> = top["pixels"].as_array().context("pixels")?.iter().map(rgb_of).collect();
            ensure!(colors.len() == 2, "{top}");
            ensure!(img::near(colors[0].context("frame 0")?, RED, 60) && img::near(colors[1].context("frame 1")?, GREEN, 60), "{colors:?}");
            Ok(())
        }),
        case("a_large_crawl_is_scaled_to_fit_the_page_on_desktop", |tab| async move {
            tab.set_viewport(1600, 900).await?;
            setup(&tab, 3840, 2160).await?;
            let size: Value = tab
                .eval(
                    "(() => { const c = window.crawlGenerator.canvas; const r = c.getBoundingClientRect();
                     return { w: r.width, h: r.height, box: c.parentElement.clientWidth, vh: window.innerHeight, pw: c.width, ph: c.height }; })()",
                )
                .await?;
            let (w, h) = (size["w"].as_f64().unwrap_or(0.0), size["h"].as_f64().unwrap_or(0.0));
            ensure!(size["pw"] == 3840 && size["ph"] == 2160, "the canvas resolution changed: {size}");
            ensure!(w > 0.0 && w <= size["box"].as_f64().unwrap_or(0.0) + 0.5, "wider than its container: {size}");
            ensure!(h <= size["vh"].as_f64().unwrap_or(0.0) * 0.7 + 0.5, "taller than 70% of the viewport: {size}");
            ensure!(((w / h) - 16.0 / 9.0).abs() < 0.02, "the aspect ratio changed: {size}");
            set_field(&tab, "#crawlWidth", "320").await?;
            set_field(&tab, "#crawlHeight", "180").await?;
            tab.wait_until("window.crawlGenerator.canvas.getBoundingClientRect().width === 320", Duration::from_secs(10)).await?;
            Ok(())
        }),
        case("a_video_range_limits_the_preview_and_loops_in_the_export", |tab| async move {
            setup(&tab, 320, 180).await?;
            set_field(&tab, "#crawlVideoStart", "1").await?;
            wait_pixel(&tab, 4, 4, GREEN).await?;
            tab.exec("document.getElementById('pauseCrawl').click();", json!([])).await?;
            tab.wait_until("!window.crawlGenerator.bgVideo.paused", Duration::from_secs(5)).await?;
            for _ in 0..12 {
                tokio::time::sleep(Duration::from_millis(250)).await;
                let time: f64 = tab.eval("window.crawlGenerator.bgVideo.currentTime").await?;
                ensure!(time >= 0.9, "the preview played {time} s, before the 1 s start");
                let seen = pixel(&tab, 4, 4).await?;
                ensure!(img::near(seen, GREEN, 60), "the preview drew {seen:?} at {time} s");
            }
            tab.exec("document.getElementById('pauseCrawl').click();", json!([])).await?;
            let result: Value = tab.js_async(EXPORT_VIDEO_JS, json!([[0.3, 1.3, 2.3], false])).await?;
            ensure!(result["ok"] == true, "{result}");
            let duration = result["duration"].as_f64().unwrap_or_default();
            ensure!(duration > 2.4, "without Stop at end the crawl sets the length, got {duration} s");
            for value in result["pixels"].as_array().context("pixels")? {
                let seen = rgb_of(value).context("missing frame")?;
                ensure!(img::near(seen, GREEN, 60), "the export left the 1-2 s range: {result}");
            }
            Ok(())
        }),
        case("stop_at_end_cuts_the_export_to_the_clip", |tab| async move {
            setup(&tab, 320, 180).await?;
            set_field(&tab, "#crawlVideoEnd", "1").await?;
            set_checkbox(&tab, "crawlVideoStopAtEnd", true).await?;
            tab.wait_until("window.crawlGenerator.bgVideoRange && window.crawlGenerator.bgVideoRange.stopAtEnd", Duration::from_secs(10))
                .await?;
            let result: Value = tab.js_async(EXPORT_VIDEO_JS, json!([[0.2, 0.8], true])).await?;
            ensure!(result["ok"] == true, "{result}");
            let duration = result["duration"].as_f64().unwrap_or_default();
            ensure!((0.9..1.1).contains(&duration), "the export is {duration} s, expected the 1 s clip");
            for value in result["pixels"].as_array().context("pixels")? {
                let seen = rgb_of(value).context("missing frame")?;
                ensure!(img::near(seen, RED, 60), "the export left the 0-1 s range: {result}");
            }
            Ok(())
        }),
        case("leaving_video_mode_releases_the_video", |tab| async move {
            setup(&tab, 320, 180).await?;
            tab.exec("window.__bgVideo = window.crawlGenerator.bgVideo;", json!([])).await?;
            set_field(&tab, "#crawlBackgroundMode", "solid").await?;
            tab.wait_until("window.crawlGenerator.bgVideo === null && !window.__bgVideo.getAttribute('src')", Duration::from_secs(10)).await?;
            Ok(())
        }),
    ]
}
