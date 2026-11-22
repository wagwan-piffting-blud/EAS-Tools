//! GH #175: the Encoder, Decoder and Splicer save audio through one shared exporter, and load
//! through one shared loader.
//!
//! Every format and bitrate the Encoder offers in this browser is saved, then fed back into the
//! Decoder, which must read the same header out of it. That round trip is what decides the lowest
//! lossy bitrate the pickers list.

use eas_tools_e2e::*;

use crate::common::{generate, open_tool_tracking_errors, set_field};

const HEADER: &str = "ZCZC-WXR-TOR-029095-029047+0030-2521820-KEAX/NWS-";

const SAVE_JS: &str = r#"
const done = arguments[arguments.length - 1];
const settings = arguments[0];
(async () => {
    const set = (id, value) => {
        const el = document.getElementById(id);
        el.value = String(value);
        el.dispatchEvent(new Event('change', { bubbles: true }));
    };
    for (const [id, value] of Object.entries(settings)) set(id, value);
    document.getElementById('status').innerHTML = '';
    let captured = null;
    const previous = window.EASDownloads;
    window.EASDownloads = { saveBlob: async (blob, name, mime) => { captured = { blob, name, mime }; } };
    try {
        document.getElementById('save').click();
        const deadline = Date.now() + 60000;
        while (Date.now() < deadline && !captured) await new Promise((r) => setTimeout(r, 25));
    } finally {
        window.EASDownloads = previous;
    }
    const status = document.getElementById('status').innerText;
    if (!captured) {
        done({ ok: false, status });
        return;
    }
    window.__lastExport = captured;
    const bytes = new Uint8Array(await captured.blob.arrayBuffer());
    const view = new DataView(bytes.buffer);
    const wav = String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF';
    let peak = 0;
    if (wav && view.getUint16(34, true) === 16) {
        for (let i = 44; i + 1 < bytes.length; i += 2) peak = Math.max(peak, Math.abs(view.getInt16(i, true)));
    }
    done({
        ok: true,
        name: captured.name,
        mime: captured.mime,
        size: bytes.length,
        status,
        magic: String.fromCharCode(...bytes.slice(0, 4)),
        wav: wav ? { channels: view.getUint16(22, true), rate: view.getUint32(24, true), bits: view.getUint16(34, true), peak } : null,
    });
})();
"#;

const DECODE_LAST_EXPORT_JS: &str = r#"
const done = arguments[arguments.length - 1];
const header = arguments[0];
(async () => {
    const captured = window.__lastExport;
    const output = document.getElementById('output');
    output.innerHTML = '';
    const input = document.getElementById('audiofile');
    const transfer = new DataTransfer();
    transfer.items.add(new File([captured.blob], captured.name, { type: captured.mime }));
    input.files = transfer.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
    const deadline = Date.now() + 90000;
    while (Date.now() < deadline && !output.innerText.includes(header)) await new Promise((r) => setTimeout(r, 50));
    done({ decoded: output.innerText.includes(header), text: output.innerText.slice(0, 600) });
})();
"#;

const OFFERED_JS: &str = r#"
const done = arguments[arguments.length - 1];
(async () => {
    const select = document.getElementById('encoderExportFormat');
    const deadline = Date.now() + 20000;
    let last = '';
    while (Date.now() < deadline) {
        const now = [...select.options].filter((o) => !o.disabled).map((o) => o.value).join();
        if (now && now === last) break;
        last = now;
        await new Promise((r) => setTimeout(r, 500));
    }
    const { FORMATS } = await import(new URL('assets/js/audio/encode.js', document.baseURI).href);
    done([...select.options].filter((o) => !o.disabled).map((o) => ({ value: o.value, bitrates: FORMATS[o.value].bitrates || [] })));
})();
"#;

/// Muxes the last saved WAV into a video file (VP8 picture, PCM or Opus sound) and decodes it.
const VIDEO_FILE_JS: &str = r#"
const done = arguments[arguments.length - 1];
const [container, header] = [arguments[0], arguments[1]];
(async () => {
    try {
        const mb = await import(new URL('assets/js/mediabunny/mediabunny.min.js', document.baseURI).href);
        const { decodeAudioBlob } = await import(new URL('assets/js/audio/decode.js', document.baseURI).href);
        const decoded = await decodeAudioBlob(window.__lastExport.blob);
        const pcm = decoded.channels[0];
        const rate = decoded.sampleRate;
        const audioCodec = container === 'webm' ? 'opus' : 'pcm-s16';
        if (!(await mb.canEncodeAudio(audioCodec, { numberOfChannels: 1, sampleRate: rate }))) {
            done({ skipped: `no ${audioCodec} encoder` });
            return;
        }
        const canvas = document.createElement('canvas');
        canvas.width = 160;
        canvas.height = 90;
        const ctx = canvas.getContext('2d');
        const format = container === 'webm' ? new mb.WebMOutputFormat() : new mb.MkvOutputFormat();
        const output = new mb.Output({ format, target: new mb.BufferTarget() });
        const video = new mb.CanvasSource(canvas, { codec: 'vp8', bitrate: 200000 });
        const audio = new mb.AudioSampleSource({ codec: audioCodec, bitrate: 96000 });
        output.addVideoTrack(video, { frameRate: 2 });
        output.addAudioTrack(audio);
        await output.start();
        const seconds = pcm.length / rate;
        for (let t = 0; t < seconds; t += 0.5) {
            ctx.fillStyle = t % 1 ? '#202020' : '#ff7800';
            ctx.fillRect(0, 0, 160, 90);
            await video.add(t, 0.5);
        }
        const block = 4096;
        for (let at = 0; at < pcm.length; at += block) {
            const data = pcm.slice(at, Math.min(pcm.length, at + block));
            const sample = new mb.AudioSample({ data, format: 'f32-planar', numberOfChannels: 1, sampleRate: rate, timestamp: at / rate });
            await audio.add(sample);
            sample.close();
        }
        video.close();
        audio.close();
        await output.finalize();
        const file = new File([output.target.buffer], `alert.${container}`, { type: `video/${container === 'webm' ? 'webm' : 'x-matroska'}` });
        const out = document.getElementById('output');
        out.innerHTML = '';
        const input = document.getElementById('audiofile');
        const transfer = new DataTransfer();
        transfer.items.add(file);
        input.files = transfer.files;
        input.dispatchEvent(new Event('change', { bubbles: true }));
        const deadline = Date.now() + 90000;
        while (Date.now() < deadline && !out.innerText.includes(header)) await new Promise((r) => setTimeout(r, 50));
        done({ decoded: out.innerText.includes(header), size: file.size, text: out.innerText.slice(0, 400) });
    } catch (error) {
        done({ error: String(error && error.stack || error) });
    }
})();
"#;

const RECORD_JS: &str = r#"
const done = arguments[arguments.length - 1];
const format = arguments[0];
(async () => {
    const select = document.getElementById('decoderRecordingFormat');
    select.value = format;
    select.dispatchEvent(new Event('change', { bubbles: true }));
    const context = new AudioContext();
    const tone = context.createOscillator();
    const sink = context.createMediaStreamDestination();
    tone.connect(sink);
    tone.start();
    navigator.mediaDevices.getUserMedia = async () => sink.stream;
    navigator.mediaDevices.enumerateDevices = async () => [{ kind: 'audioinput', deviceId: 'fake', label: 'Fake tone', groupId: 'g' }];
    let captured = null;
    window.EASDownloads = { saveBlob: async (blob, name, mime) => { captured = { blob, name, mime }; } };
    const wait = async (test, ms) => {
        const deadline = Date.now() + ms;
        while (Date.now() < deadline && !test()) await new Promise((r) => setTimeout(r, 50));
        return test();
    };
    document.querySelector('[data-decoder-toggle]').click();
    const record = document.querySelector('[data-decoder-record-toggle]');
    if (!(await wait(() => !record.disabled, 20000))) {
        done({ ok: false, error: 'recording never became available' });
        return;
    }
    record.click();
    await new Promise((r) => setTimeout(r, 1500));
    record.click();
    await wait(() => captured, 30000);
    document.querySelector('[data-decoder-toggle]').click();
    tone.stop();
    done(captured ? { ok: true, name: captured.name, mime: captured.mime, size: captured.blob.size, prefs: localStorage.getItem('eas-decoder-recording-export') } : { ok: false, error: 'nothing saved' });
})();
"#;

async fn generated_alert(tab: &Tab) -> Result<()> {
    open_tool_tracking_errors(tab, "encoder").await?;
    set_field(tab, "#encoderMode", "header").await?;
    tab.wait_until(
        "getComputedStyle(document.getElementById('stringEncoder')).display !== 'none'",
        Duration::from_secs(30),
    )
    .await?;
    set_field(tab, "#announcementType", "none").await?;
    set_field(tab, "#att", "3").await?;
    set_field(tab, "#cheader", HEADER).await?;
    generate(tab, "export fixture").await
}

async fn save(tab: &Tab, settings: Value) -> Result<Value> {
    let result: Value = tab.js_async(SAVE_JS, json!([settings])).await?;
    ensure!(
        result["ok"] == true,
        "nothing was saved for {settings}: {result}"
    );
    Ok(result)
}

async fn round_trip(tab: &Tab, format: &str, bitrate: u64) -> Result<Value> {
    let mut settings = json!({ "encoderExportFormat": format });
    if bitrate > 0 {
        settings["encoderExportBitrate"] = json!(bitrate);
    }
    let saved = save(tab, settings).await?;
    let decoded: Value = tab.js_async(DECODE_LAST_EXPORT_JS, json!([HEADER])).await?;
    ensure!(
        decoded["decoded"] == true,
        "{format} at {bitrate} kbps did not decode back to the header: {saved} {decoded}"
    );
    Ok(saved)
}

async fn offered(tab: &Tab) -> Result<Vec<(String, Vec<u64>)>> {
    let list: Value = tab.js_async(OFFERED_JS, json!([])).await?;
    Ok(list
        .as_array()
        .cloned()
        .unwrap_or_default()
        .into_iter()
        .map(|f| {
            (
                f["value"].as_str().unwrap_or_default().to_string(),
                f["bitrates"]
                    .as_array()
                    .map(|b| b.iter().filter_map(Value::as_u64).collect())
                    .unwrap_or_default(),
            )
        })
        .collect())
}

/// `always` is how many of `family` every supported browser must offer: WAV, FLAC and MP3 are
/// written in JS or WebAssembly, while Opus and AAC depend on the browser's own encoders.
fn round_trip_case(name: &'static str, family: &'static [&'static str], always: usize) -> Case {
    case(name, move |tab| async move {
        generated_alert(&tab).await?;
        let formats = offered(&tab).await?;
        let mut tested = Vec::new();
        for (format, bitrates) in formats.iter().filter(|(f, _)| family.contains(&f.as_str())) {
            if bitrates.is_empty() {
                round_trip(&tab, format, 0).await?;
            }
            for &kbps in bitrates {
                round_trip(&tab, format, kbps).await?;
            }
            tested.push(format.clone());
        }
        ensure!(
            tested.len() >= always,
            "expected at least {always} of {family:?} to be offered, tested {tested:?} out of {formats:?}"
        );
        Ok(())
    })
}

pub fn cases() -> Vec<Case> {
    vec![
        case(
            "encoder_saves_16_bit_mono_wav_by_default",
            |tab| async move {
                tab.goto("demos.html").await?;
                tab.local_storage_set("eas-encoder-export", "null").await?;
                generated_alert(&tab).await?;
                let saved = save(&tab, json!({})).await?;
                ensure!(
                    saved["name"].as_str().unwrap_or_default().ends_with(".wav"),
                    "{saved}"
                );
                ensure!(saved["mime"] == "audio/wav", "{saved}");
                ensure!(
                    saved["wav"]["channels"] == 1
                        && saved["wav"]["bits"] == 16
                        && saved["wav"]["rate"] == 44100,
                    "{saved}"
                );
                let peak = saved["wav"]["peak"].as_u64().unwrap_or_default();
                ensure!(
                    (10_000..=16_384).contains(&peak),
                    "the 32-bit file's level should carry over, peak {peak}"
                );
                ensure!(
                    saved["status"]
                        .as_str()
                        .unwrap_or_default()
                        .contains("WAV 16-bit, mono, 44.1 kHz"),
                    "{saved}"
                );
                Ok(())
            },
        ),
        round_trip_case(
            "every_offered_wav_and_flac_format_decodes_back",
            &["pcm16", "pcm24", "float32", "flac16", "flac24"],
            5,
        ),
        round_trip_case("every_offered_mp3_bitrate_decodes_back", &["mp3"], 1),
        round_trip_case("every_offered_opus_bitrate_decodes_back", &["opus"], 0),
        round_trip_case("every_offered_aac_bitrate_decodes_back", &["aac"], 0),
        case(
            "encoder_doubles_channels_resamples_and_reports_a_moved_rate",
            |tab| async move {
                generated_alert(&tab).await?;
                let stereo = save(&tab, json!({ "encoderExportFormat": "pcm16", "encoderExportChannels": "2", "encoderExportSampleRate": "8000" })).await?;
                ensure!(
                    stereo["wav"]["channels"] == 2 && stereo["wav"]["rate"] == 8000,
                    "{stereo}"
                );
                let remembered: String = tab
                    .eval("localStorage.getItem('eas-encoder-export')")
                    .await?;
                ensure!(
                    remembered.contains("\"channels\":2")
                        && remembered.contains("\"sampleRate\":8000"),
                    "{remembered}"
                );

                set_field(&tab, "#overallEndecMode", "HOLLYANNE").await?;
                let endec = save(&tab, json!({ "encoderExportFormat": "pcm16", "encoderExportChannels": "1", "encoderExportSampleRate": "0" })).await?;
                ensure!(
                    endec["wav"]["rate"] == 5000,
                    "Original follows the ENDEC rate: {endec}"
                );
                let mp3 = save(&tab, json!({ "encoderExportFormat": "mp3" })).await?;
                ensure!(
                    mp3["name"].as_str().unwrap_or_default().ends_with(".mp3")
                        && mp3["mime"] == "audio/mpeg",
                    "{mp3}"
                );
                ensure!(
                    mp3["status"]
                        .as_str()
                        .unwrap_or_default()
                        .contains("could not be saved at 5 kHz here, so it was saved at 8 kHz"),
                    "{mp3}"
                );
                Ok(())
            },
        ),
        case("decoder_reads_the_sound_of_video_files", |tab| async move {
            generated_alert(&tab).await?;
            save(&tab, json!({ "encoderExportFormat": "pcm16" })).await?;
            let mut decoded = 0;
            for container in ["mkv", "webm"] {
                let result: Value = tab
                    .js_async(VIDEO_FILE_JS, json!([container, HEADER]))
                    .await?;
                if result.get("skipped").is_some() {
                    continue;
                }
                ensure!(result["decoded"] == true, "{container}: {result}");
                decoded += 1;
            }
            ensure!(
                decoded > 0,
                "no video container could be built in this browser"
            );
            Ok(())
        }),
        case(
            "decoder_recordings_use_the_recording_format",
            |tab| async move {
                open_tool_tracking_errors(&tab, "decoder").await?;
                let result: Value = tab.js_async(RECORD_JS, json!(["flac16"])).await?;
                ensure!(result["ok"] == true, "{result}");
                let name = result["name"].as_str().unwrap_or_default();
                ensure!(
                    name.starts_with("eas-recording-") && name.ends_with(".flac"),
                    "{result}"
                );
                ensure!(result["mime"] == "audio/flac", "{result}");
                ensure!(
                    result["prefs"]
                        .as_str()
                        .unwrap_or_default()
                        .contains("flac16"),
                    "{result}"
                );
                Ok(())
            },
        ),
    ]
}
