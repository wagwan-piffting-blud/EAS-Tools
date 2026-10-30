//! Pre-header and post-EOM audio slots (#131).
//!
//! The DEFAULT ENDEC profile renders at 44100 Hz with no rate emulation, and the fixtures below
//! are 44100 Hz square waves that never touch zero, so every segment boundary in the exported WAV
//! is sample-exact and can be found by looking for runs of digital silence.

use eas_tools_e2e::browser::repo_root;
use eas_tools_e2e::*;

use crate::common::{generate, open_tool_tracking_errors, sample_count, set_checkbox, set_field, status_text, temp_file};

const VALID_HEADER: &str = "ZCZC-WXR-SVR-010001+0030-0010600-KNHC/NWS-";
const RATE: f64 = 44100.0;
const PRE_SECONDS: f64 = 0.25;
const POST_SECONDS: f64 = 0.4;
const PRE_AMPLITUDE: f64 = 0.3;
const POST_AMPLITUDE: f64 = 0.6;

fn ms(ms: f64) -> i64 {
    (RATE * ms / 1000.0).round() as i64
}

fn frames(seconds: f64) -> i64 {
    (seconds * RATE).round() as i64
}

fn square_wav(amplitude: f64, seconds: f64, channels: u16) -> Vec<u8> {
    let half_period = RATE as usize / 400;
    let level = (amplitude * 32767.0).round() as i16;
    let count = frames(seconds) as usize;
    let data_len = (count * channels as usize * 2) as u32;
    let mut out = Vec::with_capacity(44 + data_len as usize);
    out.extend_from_slice(b"RIFF");
    out.extend_from_slice(&(36 + data_len).to_le_bytes());
    out.extend_from_slice(b"WAVEfmt ");
    out.extend_from_slice(&16u32.to_le_bytes());
    out.extend_from_slice(&1u16.to_le_bytes());
    out.extend_from_slice(&channels.to_le_bytes());
    out.extend_from_slice(&(RATE as u32).to_le_bytes());
    out.extend_from_slice(&(RATE as u32 * channels as u32 * 2).to_le_bytes());
    out.extend_from_slice(&(channels * 2).to_le_bytes());
    out.extend_from_slice(&16u16.to_le_bytes());
    out.extend_from_slice(b"data");
    out.extend_from_slice(&data_len.to_le_bytes());
    for i in 0..count {
        let value = if (i / half_period) % 2 == 0 { level } else { -level };
        for _ in 0..channels {
            out.extend_from_slice(&value.to_le_bytes());
        }
    }
    out
}

/// Seconds of audio in a RIFF WAV, from its fmt block alignment and data chunk size.
fn wav_seconds(bytes: &[u8]) -> Result<f64> {
    let u32_at = |o: usize| u32::from_le_bytes(bytes[o..o + 4].try_into().unwrap());
    let u16_at = |o: usize| u16::from_le_bytes(bytes[o..o + 2].try_into().unwrap());
    let (mut rate, mut align, mut pos) = (0u32, 0u16, 12usize);
    while pos + 8 <= bytes.len() {
        let size = u32_at(pos + 4) as usize;
        match &bytes[pos..pos + 4] {
            b"fmt " => {
                rate = u32_at(pos + 12);
                align = u16_at(pos + 20);
            }
            b"data" => {
                ensure!(rate > 0 && align > 0, "data chunk before fmt");
                return Ok((size / align as usize) as f64 / rate as f64);
            }
            _ => {}
        }
        pos += 8 + size + (size & 1);
    }
    bail!("no data chunk")
}

#[derive(serde::Deserialize, Debug, Clone, Copy)]
struct Run {
    start: i64,
    end: i64,
    peak: f64,
}

#[derive(serde::Deserialize, Debug)]
struct Runs {
    total: i64,
    runs: Vec<Run>,
}

const OUTPUT_RUNS_JS: &str = r#"
const done = arguments[arguments.length - 1];
const minGap = 50;
fetch(document.getElementById('audioPlayback').src).then((r) => r.arrayBuffer()).then((buf) => {
    const view = new DataView(buf);
    let pos = 12;
    while (pos + 8 <= buf.byteLength) {
        const id = String.fromCharCode(view.getUint8(pos), view.getUint8(pos + 1), view.getUint8(pos + 2), view.getUint8(pos + 3));
        const size = view.getUint32(pos + 4, true);
        if (id === 'data') {
            const total = Math.floor(size / 4);
            const runs = [];
            let start = -1;
            let lastNonZero = -1;
            let peak = 0;
            for (let i = 0; i < total; i++) {
                const v = view.getInt32(pos + 8 + i * 4, true);
                if (v === 0) continue;
                if (start === -1) {
                    start = i;
                } else if (i - lastNonZero > minGap) {
                    runs.push({ start: start, end: lastNonZero + 1, peak: peak / 2147483647 });
                    start = i;
                    peak = 0;
                }
                lastNonZero = i;
                const a = Math.abs(v);
                if (a > peak) peak = a;
            }
            if (start !== -1) runs.push({ start: start, end: lastNonZero + 1, peak: peak / 2147483647 });
            done({ ok: true, total: total, runs: runs });
            return;
        }
        pos += 8 + size + (size & 1);
    }
    done({ ok: false, error: 'no data chunk' });
}).catch((e) => done({ ok: false, error: e.message }));
"#;

async fn output_runs(tab: &Tab) -> Result<Runs> {
    let value: Value = tab.js_async(OUTPUT_RUNS_JS, json!([])).await?;
    ensure!(value["ok"] == true, "{value}");
    Ok(serde_json::from_value(value)?)
}

fn spans(runs: &[Run]) -> Vec<(i64, i64)> {
    runs.iter().map(|r| (r.start, r.end)).collect()
}

async fn configure_base(tab: &Tab) -> Result<()> {
    set_field(tab, "#encoderMode", "header").await?;
    tab.wait_until("getComputedStyle(document.getElementById('stringEncoder')).display !== 'none'", Duration::from_secs(30)).await?;
    set_field(tab, "#cheader", VALID_HEADER).await?;
    set_field(tab, "#overallEndecMode", "DEFAULT").await?;
    set_field(tab, "#att", "4").await?;
    set_field(tab, "#announcementType", "none").await?;
    set_checkbox(tab, "endecResample", false).await?;
    set_checkbox(tab, "silenceUniform", false).await?;
    for (id, value) in [
        ("#silencePreTone", "500"),
        ("#silenceHeadersToAttention", "1000"),
        ("#silenceAttentionToMessage", "1000"),
        ("#silenceMessageToEom", "1000"),
        ("#silenceEomToEnd", "700"),
    ] {
        set_field(tab, id, value).await?;
    }
    Ok(())
}

async fn wait_for_manifest(tab: &Tab) -> Result<()> {
    tab.wait_until(
        "!!document.querySelector('#preHeaderAudio option[value=\"dasdec-rwt-intro\"]')
         && !!document.querySelector('#postEomAudio option[value=\"dasdec-rwt-outro\"]')",
        Duration::from_secs(25),
    )
    .await
}

async fn value_of(tab: &Tab, id: &str) -> Result<String> {
    tab.js("return document.getElementById(arguments[0]).value;", json!([id])).await
}

async fn load_custom(tab: &Tab, slot: &str, wav: &[u8]) -> Result<()> {
    set_field(tab, &format!("#{slot}"), "custom").await?;
    tab.set_files(&format!("#{slot}File"), &[temp_file(&format!("{slot}.wav"), wav)?]).await
}

const HIDE_PRESET_RECORDINGS_JS: &str = r#"
(() => {
    const realFetch = window.fetch.bind(window);
    window.fetch = (input, init) => {
        const url = typeof input === 'string' ? input : (input && input.url) || String(input);
        if (/\/preheader\/dasdec-rwt-(intro|outro)\.wav/.test(url)) {
            return Promise.resolve(new Response('', { status: 404, statusText: 'Not Found' }));
        }
        return realFetch(input, init);
    };
})();
"#;

const STUB_PRESET_RECORDINGS_JS: &str = r#"
(() => {
    const makeWav = (rate, channels, seconds, level) => {
        const frames = Math.round(rate * seconds);
        const bytes = frames * channels * 2;
        const buffer = new ArrayBuffer(44 + bytes);
        const view = new DataView(buffer);
        const ascii = (o, t) => { for (let i = 0; i < t.length; i++) view.setUint8(o + i, t.charCodeAt(i)); };
        ascii(0, 'RIFF'); view.setUint32(4, 36 + bytes, true); ascii(8, 'WAVE'); ascii(12, 'fmt ');
        view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, channels, true);
        view.setUint32(24, rate, true); view.setUint32(28, rate * channels * 2, true);
        view.setUint16(32, channels * 2, true); view.setUint16(34, 16, true);
        ascii(36, 'data'); view.setUint32(40, bytes, true);
        for (let i = 0; i < frames; i++) {
            const v = Math.round((level + 0.05 * Math.sin(2 * Math.PI * 300 * i / rate)) * 32767);
            for (let c = 0; c < channels; c++) view.setInt16(44 + (i * channels + c) * 2, v, true);
        }
        return buffer;
    };
    window.__presetFetches = [];
    const stubs = {
        'dasdec-rwt-intro': () => makeWav(32000, 1, 1.5, 0.3),
        'dasdec-rwt-outro': () => makeWav(32000, 2, 2.0, 0.5),
    };
    const realFetch = window.fetch.bind(window);
    window.fetch = (input, init) => {
        const url = typeof input === 'string' ? input : (input && input.url) || String(input);
        const m = /\/preheader\/(dasdec-rwt-(?:intro|outro))\.wav/.exec(url);
        if (m) {
            window.__presetFetches.push([m[1], (init && init.method) || 'GET']);
            return Promise.resolve(new Response(stubs[m[1]](), { status: 200, headers: { 'Content-Type': 'audio/wav' } }));
        }
        return realFetch(input, init);
    };
})();
"#;

const FAKE_BRIDGE_JS: &str = "
window.__bridgeHandlers = {};
window.__bridgeSent = [];
window.EASBridge = {
    on(name, fn) { window.__bridgeHandlers[name] = fn; },
    send(name, payload) { window.__bridgeSent.push([name, payload]); },
};
";

async fn check_missing_presets(tab: &Tab) -> Result<()> {
    configure_base(tab).await?;
    wait_for_manifest(tab).await?;
    let state: (bool, String, bool, String) = tab
        .eval(
            "(() => {
                const pre = document.querySelector('#preHeaderAudio option[value=\"dasdec-rwt-intro\"]');
                const post = document.querySelector('#postEomAudio option[value=\"dasdec-rwt-outro\"]');
                return [pre.disabled, pre.textContent, post.disabled, post.textContent];
            })()",
        )
        .await?;
    ensure!(state.0 && state.1.contains("(recording not installed)"), "{state:?}");
    ensure!(state.2 && state.3.contains("(recording not installed)"), "{state:?}");
    ensure!(state.1.contains("DASDEC RWT intro"), "{state:?}");

    generate(tab, "baseline").await?;
    let baseline = sample_count(tab).await?;
    set_field(tab, "#preHeaderAudio", "dasdec-rwt-intro").await?;
    ensure!(value_of(tab, "postEomAudio").await? == "none", "a partner that is not installed must not be auto-selected");
    set_field(tab, "#postEomAudio", "dasdec-rwt-outro").await?;
    generate(tab, "missing presets").await?;
    let status = status_text(tab).await?;
    ensure!(status.contains("Pre-alert audio") && status.contains("not installed"), "{status}");
    ensure!(status.contains("Post-alert audio"), "{status}");
    ensure!(sample_count(tab).await? == baseline);
    Ok(())
}

pub fn cases() -> Vec<Case> {
    let mut cases = vec![
        case("custom_pre_and_post_audio_land_at_the_configured_gaps", |tab| async move {
            open_tool_tracking_errors(&tab, "encoder").await?;
            configure_base(&tab).await?;
            set_field(&tab, "#preHeaderAudio", "custom").await?;
            let shown: bool = tab.eval("document.getElementById('preHeaderAudioFile').offsetParent !== null").await?;
            ensure!(shown, "the pre-alert file picker is hidden");
            load_custom(&tab, "preHeaderAudio", &square_wav(PRE_AMPLITUDE, PRE_SECONDS, 1)).await?;
            set_field(&tab, "#silencePreHeaderToHeaders", "300").await?;
            load_custom(&tab, "postEomAudio", &square_wav(POST_AMPLITUDE, POST_SECONDS, 2)).await?;
            set_field(&tab, "#silenceEomToPostEom", "400").await?;
            generate(&tab, "custom").await?;

            let result = output_runs(&tab).await?;
            let runs = &result.runs;
            ensure!(runs.len() == 8, "pre audio, three header bursts, three EOM bursts, post audio: {:?}", spans(runs));
            let (pre, first_header) = (runs[0], runs[1]);
            let (last_eom, post) = (runs[6], runs[7]);
            ensure!(pre.start == ms(500.0), "{pre:?}");
            ensure!(pre.end - pre.start == frames(PRE_SECONDS), "{pre:?}");
            ensure!((pre.peak - PRE_AMPLITUDE / 2.0).abs() < 0.002, "{pre:?}");
            ensure!(((first_header.start - pre.end) - ms(300.0)).abs() <= 1, "{first_header:?}");
            ensure!(post.start - last_eom.end == ms(400.0), "{post:?}");
            ensure!(post.end - post.start == frames(POST_SECONDS), "{post:?}");
            ensure!((post.peak - POST_AMPLITUDE / 2.0).abs() < 0.002, "{post:?}");
            ensure!(result.total - post.end == ms(700.0), "eomToEnd stays the final segment");
            Ok(())
        }),
        case("pre_post_audio_adds_exactly_its_own_length", |tab| async move {
            open_tool_tracking_errors(&tab, "encoder").await?;
            configure_base(&tab).await?;
            set_field(&tab, "#att", "0").await?;
            generate(&tab, "baseline").await?;
            let baseline = sample_count(&tab).await?;

            load_custom(&tab, "preHeaderAudio", &square_wav(PRE_AMPLITUDE, PRE_SECONDS, 1)).await?;
            set_field(&tab, "#silencePreHeaderToHeaders", "1000").await?;
            load_custom(&tab, "postEomAudio", &square_wav(POST_AMPLITUDE, POST_SECONDS, 1)).await?;
            set_field(&tab, "#silenceEomToPostEom", "250").await?;
            generate(&tab, "with audio").await?;
            let with_audio = sample_count(&tab).await?;
            let expected = frames(PRE_SECONDS) + ms(1000.0) + frames(POST_SECONDS) + ms(250.0);
            ensure!(with_audio - baseline == expected, "{} extra samples, expected {expected}", with_audio - baseline);
            Ok(())
        }),
        case("pre_header_audio_precedes_the_pelmorex_tone", |tab| async move {
            open_tool_tracking_errors(&tab, "encoder").await?;
            configure_base(&tab).await?;
            set_field(&tab, "#att", "2").await?;
            load_custom(&tab, "preHeaderAudio", &square_wav(PRE_AMPLITUDE, PRE_SECONDS, 1)).await?;
            set_field(&tab, "#silencePreHeaderToHeaders", "600").await?;
            generate(&tab, "pelmorex").await?;
            let runs = output_runs(&tab).await?.runs;
            ensure!(runs[0].start == ms(500.0), "{:?}", spans(&runs));
            ensure!(runs[0].end - runs[0].start == frames(PRE_SECONDS), "{:?}", spans(&runs));
            ensure!(runs[1].start - runs[0].end >= ms(600.0), "{:?}", spans(&runs));
            Ok(())
        }),
        case("builtin_presets_decode_downmix_and_resample", |tab| async move {
            tab.add_init_script(STUB_PRESET_RECORDINGS_JS).await?;
            open_tool_tracking_errors(&tab, "encoder").await?;
            configure_base(&tab).await?;
            tab.wait_until(
                "(() => { const o = document.querySelector('#preHeaderAudio option[value=\"dasdec-rwt-intro\"]'); return !!o && !o.disabled; })()",
                Duration::from_secs(25),
            )
            .await?;
            set_field(&tab, "#postEomAudio", "none").await?;
            set_field(&tab, "#preHeaderAudio", "dasdec-rwt-intro").await?;
            ensure!(value_of(&tab, "postEomAudio").await? == "dasdec-rwt-outro");
            set_field(&tab, "#silencePreHeaderToHeaders", "750").await?;
            set_field(&tab, "#silenceEomToPostEom", "500").await?;
            generate(&tab, "presets").await?;

            let runs = output_runs(&tab).await?.runs;
            ensure!(runs.len() == 8, "{:?}", spans(&runs));
            let (intro, outro) = (runs[0], runs[7]);
            ensure!((intro.start - ms(500.0)).abs() <= 2, "{intro:?}");
            ensure!(((intro.end - intro.start) - frames(1.5)).abs() <= 4, "{intro:?}");
            ensure!(((runs[1].start - intro.end) - ms(750.0)).abs() <= 4, "{:?}", spans(&runs));
            ensure!(((outro.start - runs[6].end) - ms(500.0)).abs() <= 4, "{:?}", spans(&runs));
            ensure!(((outro.end - outro.start) - frames(2.0)).abs() <= 4, "{outro:?}");
            ensure!((outro.peak - 0.55 / 2.0).abs() < 0.02, "stereo is averaged, not summed: {outro:?}");

            generate(&tab, "cached").await?;
            let gets: i64 = tab.eval("window.__presetFetches.filter((f) => f[1] === 'GET').length").await?;
            ensure!(gets == 2, "decoded built-ins are cached across generations; {gets} fetches");
            Ok(())
        }),
        case("missing_builtin_recording_is_listed_disabled_and_skipped", |tab| async move {
            tab.add_init_script(HIDE_PRESET_RECORDINGS_JS).await?;
            open_tool_tracking_errors(&tab, "encoder").await?;
            check_missing_presets(&tab).await
        }),
        case("paired_preset_fills_post_only_when_it_is_none", |tab| async move {
            open_tool_tracking_errors(&tab, "encoder").await?;
            wait_for_manifest(&tab).await?;
            tab.exec(
                "document.querySelectorAll('#preHeaderAudio option, #postEomAudio option').forEach((o) => { o.disabled = false; });",
                json!([]),
            )
            .await?;
            set_field(&tab, "#postEomAudio", "none").await?;
            set_field(&tab, "#preHeaderAudio", "dasdec-rwt-intro").await?;
            ensure!(value_of(&tab, "postEomAudio").await? == "dasdec-rwt-outro");
            tab.wait_until(
                "document.getElementById('encoderAnnouncer').textContent.includes('Post-alert audio set to')",
                Duration::from_secs(5),
            )
            .await?;
            set_field(&tab, "#preHeaderAudio", "none").await?;
            set_field(&tab, "#postEomAudio", "custom").await?;
            set_field(&tab, "#preHeaderAudio", "dasdec-rwt-intro").await?;
            ensure!(value_of(&tab, "postEomAudio").await? == "custom");
            Ok(())
        }),
        case("pre_post_settings_persist", |tab| async move {
            open_tool_tracking_errors(&tab, "encoder").await?;
            configure_base(&tab).await?;
            set_field(&tab, "#preHeaderAudio", "custom").await?;
            set_field(&tab, "#silencePreHeaderToHeaders", "45000").await?;
            ensure!(value_of(&tab, "silencePreHeaderToHeaders").await? == "30000");
            set_field(&tab, "#silencePreHeaderToHeaders", "1250").await?;
            set_field(&tab, "#silenceEomToPostEom", "-3").await?;
            ensure!(value_of(&tab, "silenceEomToPostEom").await? == "0");
            set_field(&tab, "#silenceEomToPostEom", "800").await?;
            generate(&tab, "persist").await?;
            let status = status_text(&tab).await?;
            ensure!(status.contains("no custom audio file"), "{status}");

            let saved: Value = tab.eval("JSON.parse(localStorage.getItem('eas-tools-encoder-settings'))").await?;
            ensure!(saved["preHeaderAudio"] == "custom", "{saved}");
            ensure!(saved["postEomAudio"] == "none", "{saved}");
            ensure!(saved["silencePreHeaderToHeaders"] == "1250", "{saved}");
            ensure!(saved["silenceEomToPostEom"] == "800", "{saved}");

            open_tool_tracking_errors(&tab, "encoder").await?;
            tab.wait_until("document.getElementById('status').innerText.includes('Loaded saved encoder settings!')", Duration::from_secs(60))
                .await?;
            let state: Value = tab
                .eval(
                    "[document.getElementById('preHeaderAudio').value,
                      document.getElementById('silencePreHeaderToHeaders').value,
                      document.getElementById('silenceEomToPostEom').value,
                      document.getElementById('preHeaderAudioFileRow').hidden,
                      document.getElementById('postEomAudioFileRow').hidden]",
                )
                .await?;
            ensure!(state == json!(["custom", "1250", "800", false, true]), "{state}");
            Ok(())
        }),
        case("bridge_loads_pre_and_post_audio", |tab| async move {
            use base64::Engine;
            tab.add_init_script(FAKE_BRIDGE_JS).await?;
            open_tool_tracking_errors(&tab, "encoder").await?;
            tab.wait_until("!!(window.__bridgeHandlers && window.__bridgeHandlers['encoder:loadPostEomAudio'])", Duration::from_secs(30))
                .await?;
            for (event, wav) in [
                ("encoder:loadPreHeaderAudio", square_wav(PRE_AMPLITUDE, PRE_SECONDS, 1)),
                ("encoder:loadPostEomAudio", square_wav(POST_AMPLITUDE, POST_SECONDS, 1)),
            ] {
                let payload = base64::engine::general_purpose::STANDARD.encode(wav);
                tab.exec("return window.__bridgeHandlers[arguments[0]]({ base64: arguments[1] });", json!([event, payload])).await?;
            }
            let outcome: Value = tab
                .js_async(
                    "const done = arguments[arguments.length - 1];
                     window.__bridgeHandlers['encoder:generate']({
                         originator: 'WXR', event: 'SVR', hours: 0, minutes: 30, sender: 'KNHC/NWS',
                         attentionTone: 4, endecMode: 'DEFAULT', endecResample: false, announcementType: 'none',
                         locations: ['010001'], silenceUniform: false,
                         silencePreTone: 500, silenceHeadersToAttention: 1000, silenceAttentionToMessage: 1000,
                         silenceMessageToEom: 1000, silenceEomToEnd: 700,
                         preHeaderAudio: 'custom', postEomAudio: 'custom',
                         silencePreHeaderToHeaders: 300, silenceEomToPostEom: 400,
                     }).then(() => done(true), (e) => done(String(e)));",
                    json!([]),
                )
                .await?;
            ensure!(outcome == true, "{outcome}");
            let sent: Vec<Value> = tab.eval("window.__bridgeSent.filter((m) => m[0] === 'encoder:generateState')").await?;
            let last = sent.last().map(|m| &m[1]).context("no generateState")?;
            ensure!(last["active"] == false && last["success"] == true, "{sent:?}");
            ensure!(last["header"].as_str().is_some_and(|h| h.starts_with("ZCZC-WXR-SVR-010001+0030-")), "{sent:?}");

            let presets: Value = tab
                .eval("(() => { const m = window.__bridgeSent.filter((x) => x[0] === 'encoder:prePostAudioData'); return m.length ? m[m.length - 1][1] : null; })()")
                .await?;
            let installed = repo_root().join("assets/preheader/dasdec-rwt-intro.wav").is_file();
            let listed = presets["presets"]
                .as_array()
                .into_iter()
                .flatten()
                .any(|p| p["id"] == "dasdec-rwt-intro" && p["available"] == installed);
            ensure!(listed, "{presets}");

            let runs = output_runs(&tab).await?.runs;
            ensure!(runs.len() == 8, "{:?}", spans(&runs));
            ensure!(runs[0].start == ms(500.0), "{:?}", spans(&runs));
            ensure!(runs[0].end - runs[0].start == frames(PRE_SECONDS), "{:?}", spans(&runs));
            ensure!(runs[7].start - runs[6].end == ms(400.0), "{:?}", spans(&runs));
            ensure!(runs[7].end - runs[7].start == frames(POST_SECONDS), "{:?}", spans(&runs));
            Ok(())
        }),
    ];
    for preset in ["dasdec-rwt-intro", "dasdec-rwt-new-intro"] {
        cases.push(case(format!("installed_intro_preset_plays_before_the_first_burst[{preset}]"), move |tab| async move {
            let path = repo_root().join("assets/preheader").join(format!("{preset}.wav"));
            ensure!(path.is_file(), "{} is not installed", path.display());
            let intro_seconds = wav_seconds(&std::fs::read(&path)?)?;

            open_tool_tracking_errors(&tab, "encoder").await?;
            configure_base(&tab).await?;
            wait_for_manifest(&tab).await?;
            let disabled: bool = tab
                .js("return document.querySelector(`#preHeaderAudio option[value=\"${arguments[0]}\"]`).disabled;", json!([preset]))
                .await?;
            ensure!(!disabled, "{preset} is listed as not installed");
            set_field(&tab, "#postEomAudio", "none").await?;
            set_field(&tab, "#preHeaderAudio", preset).await?;
            set_field(&tab, "#postEomAudio", "none").await?;
            set_field(&tab, "#silencePreHeaderToHeaders", "1000").await?;
            generate(&tab, preset).await?;

            let runs = output_runs(&tab).await?.runs;
            let intro_end = ms(500.0) + (intro_seconds * RATE).round() as i64;
            let speech: Vec<Run> = runs.iter().copied().filter(|r| r.end <= intro_end + 4).collect();
            let bursts: Vec<Run> = runs.iter().copied().filter(|r| r.start > intro_end + 4).collect();
            ensure!(!speech.is_empty() && speech[0].start >= ms(500.0), "{:?}", spans(&runs));
            ensure!(speech.iter().map(|r| r.peak).fold(0.0, f64::max) > 0.05, "the intro recording is audible");
            ensure!(bursts.len() == 6, "three header and three EOM bursts follow the intro: {:?}", spans(&runs));
            ensure!(((bursts[0].start - intro_end) - (ms(1000.0) + 1)).abs() <= 4, "first burst at {}, intro ends {intro_end}", bursts[0].start);
            Ok(())
        }));
    }
    cases
}
