//! SAME audio decodes to headers and the 1050 Hz NWR tone is flagged, end to end through the page.

use std::f64::consts::PI;

use eas_tools_e2e::browser::repo_root;
use eas_tools_e2e::*;

use crate::common::{open_tool, temp_file};

const NWR_HEADER: &str = "ZCZC-WXR-ADR-048000-040000-005000-022000-028000-047000-021000-001000-012000-013000\
                          -045000-037000-051000-054000+0150-1121738-KFWD/NWS-";
const SYNTH_HEADER: &str = "ZCZC-WXR-TOR-029095-029047+0030-2521820-KEAX/NWS-";
const TONE_TEXT: &str = "1050 Hz NWR alert tone detected";
const RATE: u32 = 22050;
const BAUD: f64 = 520.8333333333334;

fn nwr_recording() -> std::path::PathBuf {
    repo_root().join("assets/audacity_noises/ADR_TONES_LONG_NWR_MACRO.wav")
}

async fn open_decoder(tab: &Tab) -> Result<()> {
    open_tool(tab, "decoder").await?;
    tab.exec("document.getElementById('output').innerHTML = '';", json!([])).await
}

async fn output_text(tab: &Tab) -> Result<String> {
    tab.eval("document.getElementById('output').innerText").await
}

async fn wait_output(tab: &Tab, done: impl Fn(&str) -> bool) -> Result<String> {
    let deadline = std::time::Instant::now() + Duration::from_secs(90);
    loop {
        let text = output_text(tab).await?;
        if done(&text) {
            return Ok(text);
        }
        ensure!(std::time::Instant::now() < deadline, "decode never finished; output so far:\n{text}");
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
}

async fn decode_until(tab: &Tab, path: &std::path::Path, done: impl Fn(&str) -> bool) -> Result<String> {
    tab.set_files("#audiofile", &[path.to_path_buf()]).await?;
    wait_output(tab, done).await
}

fn count(text: &str, needle: &str) -> usize {
    text.matches(needle).count()
}

fn byte_bits(bytes: &[u8]) -> Vec<u8> {
    bytes.iter().flat_map(|byte| (0..8).map(move |i| (byte >> i) & 1)).collect()
}

fn afsk_at(text: &str, amplitude: f64, rate: u32) -> Vec<f64> {
    let data: Vec<u8> = std::iter::repeat(0xABu8).take(16).chain(text.bytes()).collect();
    afsk_bits(&byte_bits(&data), amplitude, rate)
}

fn afsk_bits(bits: &[u8], amplitude: f64, rate: u32) -> Vec<f64> {
    let rate = rate as f64;
    let mut phase = 0.0;
    (0..(bits.len() as f64 * rate / BAUD) as usize)
        .map(|n| {
            let bit = bits[((n as f64 * BAUD / rate) as usize).min(bits.len() - 1)];
            phase += 2.0 * PI * if bit == 1 { 2083.3333333333335 } else { 1562.5 } / rate;
            amplitude * phase.sin()
        })
        .collect()
}

fn afsk(text: &str, amplitude: f64) -> Vec<f64> {
    afsk_at(text, amplitude, RATE)
}

fn silence(seconds: usize) -> Vec<f64> {
    vec![0.0; seconds * RATE as usize]
}

fn tone(seconds: usize) -> Vec<f64> {
    (0..seconds * RATE as usize).map(|n| 0.3 * (2.0 * PI * 1050.0 * n as f64 / RATE as f64).sin()).collect()
}

fn riff(format: u16, rate: u32, bits: u16, extra_fmt: &[u8], body: &[u8]) -> Vec<u8> {
    let block = bits / 8;
    let mut fmt = Vec::new();
    fmt.extend_from_slice(&format.to_le_bytes());
    fmt.extend_from_slice(&1u16.to_le_bytes());
    fmt.extend_from_slice(&rate.to_le_bytes());
    fmt.extend_from_slice(&(rate * block as u32).to_le_bytes());
    fmt.extend_from_slice(&block.to_le_bytes());
    fmt.extend_from_slice(&bits.to_le_bytes());
    fmt.extend_from_slice(extra_fmt);
    let mut out = Vec::new();
    out.extend_from_slice(b"RIFF");
    out.extend_from_slice(&((4 + 8 + fmt.len() + 8 + body.len()) as u32).to_le_bytes());
    out.extend_from_slice(b"WAVEfmt ");
    out.extend_from_slice(&(fmt.len() as u32).to_le_bytes());
    out.extend_from_slice(&fmt);
    out.extend_from_slice(b"data");
    out.extend_from_slice(&(body.len() as u32).to_le_bytes());
    out.extend_from_slice(body);
    out
}

fn wav(name: &str, parts: &[&[f64]]) -> Result<std::path::PathBuf> {
    let body: Vec<u8> = parts
        .iter()
        .flat_map(|p| p.iter())
        .flat_map(|s| ((s.clamp(-1.0, 1.0) * 32767.0).round() as i16).to_le_bytes())
        .collect();
    temp_file(name, &riff(1, RATE, 16, &[], &body))
}

fn ulaw_byte(sample: i32) -> u8 {
    let sign = if sample < 0 { 0x80 } else { 0 };
    let magnitude = sample.abs().min(32635) + 0x84;
    let mut exponent = 7;
    let mut mask = 0x4000;
    while exponent > 0 && magnitude & mask == 0 {
        exponent -= 1;
        mask >>= 1;
    }
    let mantissa = (magnitude >> (exponent + 3)) & 0x0F;
    !((sign | (exponent << 4) | mantissa) as u8)
}

const WARN_HOOK: &str = "window.__seattyWarnings = [];\
    const __warn = console.warn.bind(console);\
    console.warn = (...args) => { window.__seattyWarnings.push(args.map(String).join(' ')); __warn(...args); };";

const SOURCE_START_SPY: &str = "window.__sourceStarts = 0;\
    const __start = AudioBufferSourceNode.prototype.start;\
    AudioBufferSourceNode.prototype.start = function (...args) { window.__sourceStarts++; return __start.apply(this, args); };";

fn nwr_done(t: &str) -> bool {
    count(t, NWR_HEADER) >= 3 && count(t, "NNNN") >= 3
}

async fn wait_sync_waiting(tab: &Tab) -> Result<()> {
    tab.wait_until("document.getElementById('sync').innerText.includes('WAITING')", Duration::from_secs(30)).await
}

async fn warnings(tab: &Tab) -> Result<Vec<String>> {
    tab.eval("window.__seattyWarnings || []").await
}

/// How an ENDEC frames its bursts: the sample rate it is recorded at, the silence between bursts,
/// optional relay pops around each burst, and the bytes before the preamble and after the text
/// for burst `i` (0-2 headers, 3-5 EOMs).
struct Framing {
    rate: u32,
    gap_ms: f64,
    noise_floor: f64,
    pops: Option<(Vec<f64>, Vec<f64>)>,
    frame: fn(usize) -> (Vec<u8>, Vec<u8>),
}

/// Three headers then three EOMs. With a noise floor the whole file sits on white noise like a
/// real recording, so a burst without a terminator ends in noise rather than digital silence.
fn endec_product(name: &str, framing: &Framing) -> Result<std::path::PathBuf> {
    let rate = framing.rate;
    let gap = vec![0.0; (framing.gap_ms * rate as f64 / 1000.0).round() as usize];
    let mut parts: Vec<Vec<f64>> = vec![vec![0.0; rate as usize]];
    for (i, text) in [SYNTH_HEADER, SYNTH_HEADER, SYNTH_HEADER, "NNNN", "NNNN", "NNNN"].iter().enumerate() {
        let (lead, tail) = (framing.frame)(i);
        let data: Vec<u8> = lead.into_iter().chain(std::iter::repeat(0xABu8).take(16)).chain(text.bytes()).chain(tail).collect();
        if let Some((start, _)) = &framing.pops {
            parts.push(start.clone());
        }
        parts.push(afsk_bits(&byte_bits(&data), 0.3, rate));
        if let Some((_, end)) = &framing.pops {
            parts.push(end.clone());
        }
        parts.push(if i == 2 { vec![0.0; 3 * rate as usize] } else { gap.clone() });
    }
    let mut seed: u32 = 0x9E37_79B9;
    let body: Vec<u8> = parts
        .iter()
        .flatten()
        .map(|s| {
            seed = seed.wrapping_mul(1_664_525).wrapping_add(1_013_904_223);
            s + framing.noise_floor * ((seed >> 8) as f64 / (1u32 << 24) as f64 * 2.0 - 1.0)
        })
        .flat_map(|s| ((s.clamp(-1.0, 1.0) * 32767.0).round() as i16).to_le_bytes())
        .collect();
    temp_file(name, &riff(1, rate, 16, &[], &body))
}

/// The encoder's relay pops (48 kHz stereo 16-bit), mixed to mono.
fn relay_pop(file: &str) -> Result<Vec<f64>> {
    let bytes = std::fs::read(repo_root().join("assets").join(file))?;
    let data = bytes.windows(4).position(|w| w == b"data").context("no data chunk")? + 8;
    Ok(bytes[data..]
        .chunks_exact(4)
        .map(|f| (i16::from_le_bytes([f[0], f[1]]) as f64 + i16::from_le_bytes([f[2], f[3]]) as f64) / 65536.0)
        .collect())
}

fn plain(rate: u32, gap_ms: f64) -> Framing {
    Framing { rate, gap_ms, noise_floor: 0.0, pops: None, frame: |_| (vec![], vec![]) }
}

/// The decoder's ENDEC verdict for a file, and its rule and measurements for failure messages.
async fn detected_endec(tab: &Tab, path: &std::path::Path) -> Result<(String, String)> {
    open_decoder(tab).await?;
    tab.exec("window.endecDebug = true; window.endecDebugHistory = []; window.lastEndecDebug = null;", json!([])).await?;
    tab.set_files("#audiofile", &[path.to_path_buf()]).await?;
    tab.wait_until("!!(window.lastEndecDebug && window.lastEndecDebug.mode)", Duration::from_secs(90)).await?;
    let record: Value = tab.eval("window.lastEndecDebug").await?;
    let mode = record["mode"].as_str().unwrap_or("?").to_string();
    Ok((mode, format!("rule {} segments {}", record["rule"].as_str().unwrap_or("?"), record["segments"])))
}

/// Each ENDEC profile's framing (assets/js/common-functions.js), recorded at the rate the
/// encoder's ENDEC emulation writes it, must decode as that ENDEC.
fn endec_framings() -> Result<Vec<(&'static str, &'static str, Framing)>> {
    let pops = (relay_pop("pop_start.wav")?, relay_pop("pop.wav")?);
    Ok(vec![
        ("default", "DEFAULT", plain(44100, 1000.0)),
        ("tft", "TFT", plain(8000, 1000.0)),
        ("dasdec", "DASDEC", plain(48000, 1000.0)),
        ("hollyanne", "HOLLYANNE", plain(5000, 1000.0)),
        ("nws", "NWS", Framing { frame: |_| (vec![], vec![0, 0]), ..plain(11025, 1000.0) }),
        ("nws_crs", "NWS CRS", Framing { frame: |i| if i < 3 { (vec![], vec![0, 0, 0]) } else { (vec![0], vec![0]) }, ..plain(11025, 1000.0) }),
        ("nws_bmh", "NWS BMH", Framing { frame: |_| (vec![], vec![0, 0, 0]), ..plain(11025, 1000.0) }),
        ("sage_3644", "SAGE DIGITAL 3644", Framing {
            frame: |i| (match i { 0 | 3 => vec![0x00], 1 | 2 => vec![0xAB], _ => vec![] }, vec![0xFF, 0xFF, 0xFF]),
            ..plain(44100, 1000.0)
        }),
        // Measured on real SAGE 1822 units (#145 videos -xZYY3N1Pw0, zddMfd6n54k, and TPT 2 from
        // 2000): about one byte of mark before the preamble and one after the text.
        ("sage_1822", "SAGE ANALOG 1822", Framing { frame: |_| (vec![0xFF], vec![0xFF]), ..plain(44100, 1000.0) }),
        // The demo recordings only got a clean terminator on some bursts; the rest ended in noise.
        ("sage_1822_noisy_tails", "SAGE ANALOG 1822", Framing {
            noise_floor: 0.02,
            frame: |i| (vec![], if i < 2 { vec![0xFF] } else { vec![] }),
            ..plain(44100, 1000.0)
        }),
        ("trilithic", "TRILITHIC", plain(44100, 868.0)),
        ("trilithic_pop", "TRILITHIC (POP)", Framing { pops: Some(pops), ..plain(48000, 868.0) }),
        ("xfinity", "XFINITY", plain(44100, 1500.0)),
    ])
}

pub fn cases() -> Vec<Case> {
    let mut cases: Vec<Case> = endec_framings()
        .expect("endec framings")
        .into_iter()
        .map(|(name, expected, framing)| {
            let framing = std::sync::Arc::new(framing);
            case(format!("endec_framing_decodes_as_its_endec[{name}]"), move |tab| {
                let framing = framing.clone();
                async move {
                    let path = endec_product(&format!("endec_{name}.wav"), &framing)?;
                    let (mode, detail) = detected_endec(&tab, &path).await?;
                    ensure!(mode == expected, "expected {expected}, got {mode}: {detail}");
                    Ok(())
                }
            })
        })
        .collect();
    cases.extend(vec![
        case("real_nwr_recording_decodes_every_header_and_eom", |tab| async move {
            open_decoder(&tab).await?;
            let text = decode_until(&tab, &nwr_recording(), nwr_done).await?;
            ensure!(count(&text, NWR_HEADER) == 3, "{text}");
            ensure!(!text.contains(TONE_TEXT), "{text}");
            Ok(())
        }),
        case("quiet_synthetic_header_decodes", |tab| async move {
            let (s, burst) = (silence(1), afsk(SYNTH_HEADER, 0.01));
            let path = wav("quiet_header.wav", &[&s, &burst, &s, &burst, &s, &burst, &s])?;
            open_decoder(&tab).await?;
            let text = decode_until(&tab, &path, |t| count(t, SYNTH_HEADER) >= 3).await?;
            ensure!(count(&text, SYNTH_HEADER) == 3, "{text}");
            Ok(())
        }),
        case("view_alert_survives_text_after_the_header", |tab| async move {
            let s = silence(1);
            let path = wav("trailing_text.wav", &[&s, &afsk(&format!("{SYNTH_HEADER}mr"), 0.3), &s])?;
            open_decoder(&tab).await?;
            let text = decode_until(&tab, &path, |t| t.contains(SYNTH_HEADER)).await?;
            ensure!(!text.split_once(SYNTH_HEADER).unwrap().1.contains("mr"), "{text}");
            let buttons: Vec<String> =
                tab.eval("Array.from(document.querySelectorAll('#output .alert button'), (b) => b.innerText)").await?;
            ensure!(buttons == ["View Alert"], "{buttons:?}");
            let shown: bool = tab
                .eval("(() => { window.modalShown = false; document.querySelector('#output .alert button').click(); return window.modalShown; })()")
                .await?;
            ensure!(shown, "View Alert did not open the modal");
            Ok(())
        }),
        case("1050_hz_tone_without_same_is_flagged", |tab| async move {
            let s = silence(1);
            let path = wav("nwr_tone.wav", &[&s, &tone(4), &s])?;
            open_decoder(&tab).await?;
            let text = decode_until(&tab, &path, |t| t.contains(TONE_TEXT)).await?;
            ensure!(count(&text, TONE_TEXT) == 1, "{text}");
            Ok(())
        }),
        case("1050_hz_tone_is_ignored_while_same_is_active", |tab| async move {
            let (s, header, eom, t4) = (silence(1), afsk(SYNTH_HEADER, 0.3), afsk("NNNN", 0.3), tone(4));
            let path = wav(
                "same_then_tones.wav",
                &[&s, &header, &s, &header, &s, &header, &s, &t4, &s, &eom, &s, &eom, &s, &eom, &s, &t4, &s],
            )?;
            open_decoder(&tab).await?;
            let text = decode_until(&tab, &path, |t| count(t, SYNTH_HEADER) >= 3 && t.contains(TONE_TEXT)).await?;
            ensure!(count(&text, TONE_TEXT) == 1, "{text}");
            ensure!(text.find(TONE_TEXT).unwrap() > text.rfind("[EOM]").context("no [EOM]")?, "{text}");
            Ok(())
        }),
        case("file_decode_runs_on_the_wasm_worker", |tab| async move {
            tab.add_init_script(WARN_HOOK).await?;
            open_decoder(&tab).await?;
            let text = decode_until(&tab, &nwr_recording(), nwr_done).await?;
            ensure!(count(&text, NWR_HEADER) == 3, "{text}");
            wait_sync_waiting(&tab).await?;
            let resources: Vec<String> = tab.eval("performance.getEntriesByType('resource').map((e) => e.name)").await?;
            ensure!(resources.iter().any(|r| r.ends_with("/assets/js/seatty-same.wasm")), "the WASM was never fetched");
            ensure!(resources.iter().any(|r| r.ends_with("/assets/js/seatty-worker.js")), "the worker was never fetched");
            let seatty: Vec<String> = warnings(&tab).await?.into_iter().filter(|w| w.contains("SeaTTY")).collect();
            ensure!(seatty.is_empty(), "{seatty:?}");
            Ok(())
        }),
        case("file_decode_without_workers_runs_on_the_main_thread", |tab| async move {
            tab.add_init_script(&format!("{WARN_HOOK}window.Worker = function () {{ throw new Error('workers disabled by test'); }};"))
                .await?;
            open_decoder(&tab).await?;
            let text = decode_until(&tab, &nwr_recording(), nwr_done).await?;
            ensure!(count(&text, NWR_HEADER) == 3, "{text}");
            ensure!(!text.contains(TONE_TEXT), "{text}");
            let warnings = warnings(&tab).await?;
            ensure!(warnings.iter().any(|w| w.contains("SeaTTY worker unavailable")), "{warnings:?}");
            Ok(())
        }),
        case("non_pcm_wav_decodes_through_decode_audio_data", |tab| async move {
            let rate = 8000;
            let s = vec![0.0; rate as usize];
            let burst = afsk_at(SYNTH_HEADER, 0.3, rate);
            let body: Vec<u8> = [&s, &burst, &s, &burst, &s, &burst, &s]
                .iter()
                .flat_map(|p| p.iter())
                .map(|v| ulaw_byte((v * 32767.0).round() as i32))
                .collect();
            let path = temp_file("mulaw.wav", &riff(7, rate, 8, &0u16.to_le_bytes(), &body))?;
            open_decoder(&tab).await?;
            let text = decode_until(&tab, &path, |t| count(t, SYNTH_HEADER) >= 3).await?;
            ensure!(count(&text, SYNTH_HEADER) == 3, "{text}");
            Ok(())
        }),
        case("file_decode_never_sounds_the_alarm", |tab| async move {
            let (s, header, eom) = (silence(1), afsk(SYNTH_HEADER, 0.3), afsk("NNNN", 0.3));
            let path = wav(
                "alarm_file.wav",
                &[&s, &header, &s, &header, &s, &header, &silence(12), &eom, &s, &eom, &s, &eom, &s, &tone(4), &s],
            )?;
            tab.add_init_script(SOURCE_START_SPY).await?;
            open_decoder(&tab).await?;
            tab.exec(
                "const el = document.getElementById('decoder-alarm-beep');
                 el.checked = true; el.dispatchEvent(new Event('change', { bubbles: true }));",
                json!([]),
            )
            .await?;
            tab.wait_until(
                "performance.getEntriesByType('resource').filter((e) => /bc370crs_(warn|watch|adv)\\.wav$/.test(e.name)).length >= 3",
                Duration::from_secs(30),
            )
            .await?;
            tokio::time::sleep(Duration::from_secs(1)).await;
            let text = decode_until(&tab, &path, |t| count(t, SYNTH_HEADER) >= 3 && t.contains(TONE_TEXT)).await?;
            ensure!(count(&text, SYNTH_HEADER) == 3, "{text}");
            wait_sync_waiting(&tab).await?;
            tokio::time::sleep(Duration::from_secs(1)).await;
            let starts: i64 = tab.eval("window.__sourceStarts").await?;
            ensure!(starts == 0, "{starts} audio sources started during a file decode");
            Ok(())
        }),
        case("dropped_file_decodes", |tab| async move {
            use base64::Engine;
            let (s, burst) = (silence(1), afsk(SYNTH_HEADER, 0.3));
            let path = wav("dropped.wav", &[&s, &burst, &s, &burst, &s, &burst, &s])?;
            open_decoder(&tab).await?;
            let payload = base64::engine::general_purpose::STANDARD.encode(std::fs::read(&path)?);
            tab.exec(
                "const bytes = Uint8Array.from(atob(arguments[0]), (c) => c.charCodeAt(0));
                 const transfer = new DataTransfer();
                 transfer.items.add(new File([bytes], 'dropped.wav', { type: 'audio/wav' }));
                 document.getElementById('decoder-panel').dispatchEvent(
                     new DragEvent('drop', { dataTransfer: transfer, bubbles: true, cancelable: true }));",
                json!([payload]),
            )
            .await?;
            let text = wait_output(&tab, |t| count(t, SYNTH_HEADER) >= 3).await?;
            ensure!(count(&text, SYNTH_HEADER) == 3, "{text}");
            Ok(())
        }),
    ]);
    cases
}
