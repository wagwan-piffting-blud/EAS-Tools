//! Splicer macro strength/volume: per-stage chain levels, the single-macro level controls, and
//! the export path that reuses the background waveform render.

use eas_tools_e2e::*;

use crate::common::temp_file;

const CHAIN_STORAGE_KEY: &str = "splicer.macroChain";

fn item(cmd: &str, params: &str, mix: Option<i64>, gain_db: Option<i64>) -> Value {
    let mut item = json!({ "id": format!("CMD:{cmd}"), "label": cmd, "steps": 1, "params": params });
    if let Some(mix) = mix {
        item["mix"] = json!(mix);
    }
    if let Some(gain) = gain_db {
        item["gainDb"] = json!(gain);
    }
    item
}

fn db(gain: f64) -> f64 {
    10f64.powf(gain / 20.0)
}

/// Seeds the chain from a light same-origin page so the Splicer boots once, straight onto it.
async fn open_with_chain(tab: &Tab, chain: Value) -> Result<()> {
    tab.goto("demos.html").await?;
    tab.local_storage_set(CHAIN_STORAGE_KEY, &chain.to_string()).await?;
    tab.goto("index.html?tool=splicer").await?;
    tab.wait_until(
        "!!(window.EASSplicerFX && window.EASSplicerFX.renderMacroToWavFromPcm && window.AudacityMacroEngine)",
        Duration::from_secs(40),
    )
    .await?;
    tab.exec(
        "const el = document.querySelector('[data-splice-loudness]');
         el.value = '0';
         el.dispatchEvent(new Event('input', { bubbles: true }));
         el.dispatchEvent(new Event('change', { bubbles: true }));",
        json!([]),
    )
    .await
}

async fn set_macro_level(tab: &Tab, strength: &str, volume: &str) -> Result<()> {
    tab.exec(
        "for (const [sel, value] of [['[data-splice-macro-strength]', arguments[0]], ['[data-splice-macro-volume]', arguments[1]]]) {
             const el = document.querySelector(sel);
             el.value = value;
             el.dispatchEvent(new Event('change', { bubbles: true }));
         }",
        json!([strength, volume]),
    )
    .await
}

const RENDER_AND_FIT_JS: &str = r#"
const done = arguments[arguments.length - 1];
const macroId = arguments[0];
const referenceId = arguments[1];
(async () => {
    if (window.AudacityMacroEngine.ready) await window.AudacityMacroEngine.ready();
    const sr = 44100;
    const input = new Float32Array(sr);
    for (let i = 0; i < input.length; i++) input[i] = 0.25 * Math.sin(2 * Math.PI * 440 * i / sr);
    const decode = async (blob) => {
        const buf = await blob.arrayBuffer();
        const view = new DataView(buf);
        const out = new Float32Array((buf.byteLength - 44) / 2);
        for (let i = 0; i < out.length; i++) out[i] = view.getInt16(44 + i * 2, true) / 32768;
        return out;
    };
    let reference = input;
    if (referenceId) {
        const strength = document.querySelector('[data-splice-macro-strength]');
        const volume = document.querySelector('[data-splice-macro-volume]');
        const saved = [strength.value, volume.value];
        strength.value = '100';
        volume.value = '0';
        reference = await decode(await window.EASSplicerFX.renderMacroToWavFromPcm(input, sr, referenceId));
        [strength.value, volume.value] = saved;
    }
    const out = await decode(await window.EASSplicerFX.renderMacroToWavFromPcm(input, sr, macroId));
    const n = Math.min(out.length, reference.length);
    let dot = 0, energy = 0, residual = 0;
    for (let i = 0; i < n; i++) { dot += out[i] * reference[i]; energy += reference[i] * reference[i]; }
    const k = dot / energy;
    for (let i = 0; i < n; i++) { const e = out[i] - k * reference[i]; residual += e * e; }
    return { ok: true, k, residual: Math.sqrt(residual / n), frames: out.length };
})().then(done, (e) => done({ ok: false, error: String(e && e.message || e) }));
"#;

#[derive(serde::Deserialize, Debug)]
struct Fit {
    k: f64,
    residual: f64,
    frames: i64,
}

async fn render_fit(tab: &Tab, macro_id: &str, reference_id: Option<&str>) -> Result<Fit> {
    let value: Value = tab.js_async(RENDER_AND_FIT_JS, json!([macro_id, reference_id])).await?;
    ensure!(value["ok"] == true, "{value}");
    Ok(serde_json::from_value(value)?)
}

async fn register_invert_macro(tab: &Tab) -> Result<String> {
    let id: String = tab.eval("window.AudacityMacroEngine.registerCustomMacro('Level Test Invert', 'Invert:\\n')").await?;
    Ok(format!("AUD:{id}"))
}

async fn wait_for_am_radio(tab: &Tab) -> Result<()> {
    tab.wait_until("!!document.querySelector('#spliceMacros option[value=\"AM_RADIO\"]')", Duration::from_secs(20)).await
}

const EXPORT_CAPTURE_JS: &str = r#"
const done = arguments[arguments.length - 1];
window.__exports = window.__exports || [];
const before = window.__exports.length;
window.EASDownloads = {
    saveBlob: async (blob) => {
        const buf = await blob.arrayBuffer();
        const view = new DataView(buf);
        const out = [];
        for (let o = 44; o + 2 <= buf.byteLength; o += 2) out.push(view.getInt16(o, true) / 32768);
        window.__exports.push(out);
    },
};
document.querySelector('[data-splice-export-macro]').click();
const started = Date.now();
(function poll() {
    if (window.__exports.length > before) return done(window.__exports[window.__exports.length - 1]);
    if (Date.now() - started > 30000) return done('timeout');
    setTimeout(poll, 50);
})();
"#;

async fn export_samples(tab: &Tab) -> Result<Vec<f64>> {
    let value: Value = tab.js_async(EXPORT_CAPTURE_JS, json!([])).await?;
    ensure!(value.is_array(), "export failed: {value}");
    Ok(serde_json::from_value(value)?)
}

fn fit(out: &[f64], reference: &[f64]) -> (f64, f64) {
    let n = out.len().min(reference.len());
    let dot: f64 = (0..n).map(|i| out[i] * reference[i]).sum();
    let energy: f64 = (0..n).map(|i| reference[i] * reference[i]).sum();
    let k = dot / energy;
    let residual = ((0..n).map(|i| (out[i] - k * reference[i]).powi(2)).sum::<f64>() / n as f64).sqrt();
    (k, residual)
}

/// Lets the background waveform render a level change kicks off finish, so the export after it
/// takes the path that reuses that render (the one the level bug lived in). The render starts
/// 200 ms after the change and holds the macro select disabled; 600 ms with no render at all
/// means nothing was scheduled.
const WAIT_FOR_MACRO_WAVEFORM_JS: &str = r#"
const done = arguments[arguments.length - 1];
const select = document.getElementById('spliceMacros');
const started = Date.now();
let sawBusy = select.disabled;
const observer = new MutationObserver(() => { if (select.disabled) sawBusy = true; });
observer.observe(select, { attributes: true, attributeFilter: ['disabled'] });
(function poll() {
    const idleLongEnough = Date.now() - started > 600;
    if (!select.disabled && (sawBusy || idleLongEnough)) {
        observer.disconnect();
        return done(sawBusy);
    }
    if (Date.now() - started > 30000) {
        observer.disconnect();
        return done('timeout');
    }
    setTimeout(poll, 25);
})();
"#;

async fn wait_for_macro_waveform(tab: &Tab) -> Result<()> {
    let value: Value = tab.js_async(WAIT_FOR_MACRO_WAVEFORM_JS, json!([])).await?;
    ensure!(value != "timeout", "the macro waveform render never finished");
    Ok(())
}

fn tone_wav() -> (Vec<u8>, Vec<f64>) {
    let samples: Vec<i16> = (0..22050)
        .map(|i| (0.25 * 32767.0 * (2.0 * std::f64::consts::PI * 440.0 * i as f64 / 44100.0).sin()).round() as i16)
        .collect();
    let data_len = (samples.len() * 2) as u32;
    let mut wav = Vec::with_capacity(44 + data_len as usize);
    wav.extend_from_slice(b"RIFF");
    wav.extend_from_slice(&(36 + data_len).to_le_bytes());
    wav.extend_from_slice(b"WAVEfmt ");
    wav.extend_from_slice(&16u32.to_le_bytes());
    wav.extend_from_slice(&1u16.to_le_bytes());
    wav.extend_from_slice(&1u16.to_le_bytes());
    wav.extend_from_slice(&44100u32.to_le_bytes());
    wav.extend_from_slice(&88200u32.to_le_bytes());
    wav.extend_from_slice(&2u16.to_le_bytes());
    wav.extend_from_slice(&16u16.to_le_bytes());
    wav.extend_from_slice(b"data");
    wav.extend_from_slice(&data_len.to_le_bytes());
    for s in &samples {
        wav.extend_from_slice(&s.to_le_bytes());
    }
    (wav, samples.iter().map(|&s| s as f64 / 32768.0).collect())
}

pub fn cases() -> Vec<Case> {
    let mut cases = Vec::new();
    let chains: Vec<(&str, Value, f64)> = vec![
        ("full invert", json!([item("Invert", "", None, None)]), -1.0),
        ("half-strength invert cancels", json!([item("Invert", "", Some(50), None)]), 0.0),
        ("zero strength is dry", json!([item("Invert", "", Some(0), None)]), 1.0),
        ("volume -6 dB", json!([item("Amplify", "Ratio=\"1\"", None, Some(-6))]), db(-6.0)),
        (
            "strength then volume across stages",
            json!([item("Amplify", "Ratio=\"2\"", Some(50), None), item("Invert", "", None, Some(-6))]),
            -1.5 * db(-6.0),
        ),
    ];
    for (label, chain, expected) in chains {
        cases.push(case(format!("chain_strength_and_volume_shape_the_render[{label}]"), move |tab| {
            let chain = chain.clone();
            async move {
                open_with_chain(&tab, chain).await?;
                let result = render_fit(&tab, "CHAIN", None).await?;
                ensure!(result.frames == 44100, "{label}: {result:?}");
                ensure!((result.k - expected).abs() < 0.002, "{label}: k={:.4}, expected {expected:.4}", result.k);
                ensure!(result.residual < 0.001, "{label}: output is not a scaled copy of the input ({result:?})");
                Ok(())
            }
        }));
    }
    for (strength, volume, expected) in [
        ("100", "0", -1.0),
        ("50", "0", 0.0),
        ("0", "0", 1.0),
        ("100", "-6", -db(-6.0)),
        ("75", "6", -0.5 * db(6.0)),
    ] {
        cases.push(case(format!("single_audacity_macro_level[{strength}-{volume}]"), move |tab| async move {
            open_with_chain(&tab, json!([])).await?;
            let macro_id = register_invert_macro(&tab).await?;
            set_macro_level(&tab, strength, volume).await?;
            let result = render_fit(&tab, &macro_id, None).await?;
            ensure!((result.k - expected).abs() < 0.002, "{strength}% / {volume} dB: {result:?}");
            ensure!(result.residual < 0.001, "{result:?}");
            Ok(())
        }));
    }
    cases.push(case("single_sox_macro_strength_zero_is_dry", |tab| async move {
        open_with_chain(&tab, json!([])).await?;
        set_macro_level(&tab, "0", "0").await?;
        let result = render_fit(&tab, "AM_RADIO", None).await?;
        ensure!((result.k - 1.0).abs() < 0.002 && result.residual < 0.001, "{result:?}");
        Ok(())
    }));
    cases.push(case("single_sox_macro_volume_scales_its_output", |tab| async move {
        open_with_chain(&tab, json!([])).await?;
        set_macro_level(&tab, "100", "-6").await?;
        let result = render_fit(&tab, "AM_RADIO", Some("AM_RADIO")).await?;
        ensure!((result.k - db(-6.0)).abs() < 0.003, "{result:?}");
        ensure!(result.residual < 0.001, "{result:?}");
        Ok(())
    }));
    cases.push(case("macro_level_applies_on_top_of_a_chain", |tab| async move {
        open_with_chain(&tab, json!([item("Invert", "", None, Some(-6))])).await?;
        set_macro_level(&tab, "100", "6").await?;
        let result = render_fit(&tab, "CHAIN", None).await?;
        ensure!((result.k + db(-6.0) * db(6.0)).abs() < 0.002, "{result:?}");
        set_macro_level(&tab, "50", "0").await?;
        let result = render_fit(&tab, "CHAIN", None).await?;
        ensure!((result.k - 0.5 * (1.0 - db(-6.0))).abs() < 0.002, "{result:?}");
        Ok(())
    }));
    cases.push(case("macro_level_controls_hide_for_no_macro", |tab| async move {
        open_with_chain(&tab, json!([])).await?;
        wait_for_am_radio(&tab).await?;
        let select = |value: &'static str| {
            let tab = tab.clone();
            async move {
                tab.js::<bool>(
                    "const s = document.getElementById('spliceMacros');
                     s.value = arguments[0];
                     s.dispatchEvent(new Event('change', { bubbles: true }));
                     return document.querySelector('[data-splice-macro-level]').hidden;",
                    json!([value]),
                )
                .await
            }
        };
        ensure!(select("FLAT").await?, "the level controls show for FLAT");
        ensure!(!select("AM_RADIO").await?, "the level controls are hidden for AM_RADIO");
        let labels: Vec<String> = tab
            .eval(
                "['spliceMacroStrength', 'spliceMacroVolume'].map((id) =>
                    document.querySelector('label[for=\"' + id + '\"]').textContent.trim())",
            )
            .await?;
        ensure!(labels[0].starts_with("Macro Strength") && labels[1].starts_with("Macro Volume"), "{labels:?}");
        set_macro_level(&tab, "250", "-99").await?;
        let values: Vec<String> = tab
            .eval("[document.getElementById('spliceMacroStrength').value, document.getElementById('spliceMacroVolume').value]")
            .await?;
        ensure!(values == ["100", "-24"], "{values:?}");
        Ok(())
    }));
    cases.push(case("export_with_single_macro_uses_level", |tab| async move {
        let (wav, dry) = tone_wav();
        open_with_chain(&tab, json!([])).await?;
        tab.exec(
            "window.__testErrors = [];
             window.addEventListener('error', (e) => window.__testErrors.push(String(e.message)));
             window.addEventListener('unhandledrejection', (e) => window.__testErrors.push(String(e.reason)));",
            json!([]),
        )
        .await?;
        tab.set_files("#spliceFile", &[temp_file("tone.wav", &wav)?]).await?;
        tab.wait_until("!document.querySelector('[data-splice-export-macro]').disabled", Duration::from_secs(30)).await?;
        wait_for_am_radio(&tab).await?;
        tab.exec(
            "const s = document.getElementById('spliceMacros');
             s.value = 'AM_RADIO';
             s.dispatchEvent(new Event('change', { bubbles: true }));",
            json!([]),
        )
        .await?;
        set_macro_level(&tab, "0", "0").await?;
        wait_for_macro_waveform(&tab).await?;
        let (k, residual) = fit(&export_samples(&tab).await?, &dry);
        ensure!((k - 1.0).abs() < 0.002 && residual < 0.001, "dry export: k={k}, residual={residual}");

        set_macro_level(&tab, "100", "0").await?;
        wait_for_macro_waveform(&tab).await?;
        let full = export_samples(&tab).await?;
        set_macro_level(&tab, "100", "-6").await?;
        wait_for_macro_waveform(&tab).await?;
        let quieter = export_samples(&tab).await?;
        let (k, residual) = fit(&quieter, &full);
        ensure!((k - db(-6.0)).abs() < 0.003 && residual < 0.001, "-6 dB export: k={k}, residual={residual}");
        let (_, residual_vs_dry) = fit(&full, &dry);
        ensure!(residual_vs_dry > 0.005, "AM_RADIO should reshape the audio at full strength ({residual_vs_dry})");

        let errors: Vec<String> = tab.eval("window.__testErrors || []").await?;
        ensure!(errors.is_empty(), "{errors:?}");
        Ok(())
    }));
    cases.push(case("panned_mix_and_render_keeps_the_audacity_level", |tab| async move {
        // Audacity 2.4.2 mixes a mono track into stereo at full gain; verified against it (input and
        // output both -17.76 dB RMS). The engine used to halve each mono track here, 6 dB down.
        open_with_chain(&tab, json!([])).await?;
        let text = "Duplicate:\nSelectTracks:Mode=\"Set\" Track=\"0\"\nPanLeft:\nSelectTracks:Mode=\"Set\" Track=\"1\"\nPanRight:\nSelectAll:\nMixAndRender:\nStereoToMono:\n";
        let id: String = tab
            .js("return window.AudacityMacroEngine.registerCustomMacro('Level Test Pan Mix', arguments[0]);", json!([text]))
            .await?;
        let result = render_fit(&tab, &format!("AUD:{id}"), None).await?;
        ensure!((result.k - 1.0).abs() < 0.002, "panned mix changed the level: {result:?}");
        ensure!(result.residual < 0.001, "{result:?}");
        Ok(())
    }));
    cases.push(case("copy_paste_delete_follow_the_time_selection", |tab| async move {
        // The NWR macros' pad-then-trim header, as Audacity 2.4.2 runs it: paste 1 s at the start and
        // silence it, then delete 0.8 s from the end. A 1 s tone comes out 1.2 s long, silent first.
        open_with_chain(&tab, json!([])).await?;
        let text = "SelectTime:End=\"1\" RelativeTo=\"ProjectStart\" Start=\"0\"\nCopy:\nSelectTime:End=\"0\" RelativeTo=\"ProjectStart\" Start=\"0\"\nPaste:\nSilence:\nSelectTime:End=\"0.8\" RelativeTo=\"ProjectEnd\" Start=\"0\"\nDelete:\n";
        let result: Value = tab
            .js_async(
                "const done = arguments[arguments.length - 1];
                 (async () => {
                     const sr = 44100, x = new Float32Array(sr);
                     for (let i = 0; i < sr; i++) x[i] = 0.25 * Math.sin(2 * Math.PI * 440 * i / sr);
                     const r = await window.AudacityMacroEngine.applyMacroText(x, sr, arguments[0]);
                     let pad = 0, rest = 0;
                     for (let i = 0; i < sr; i++) pad = Math.max(pad, Math.abs(r.pcm[i]));
                     for (let i = sr; i < r.pcm.length; i++) rest = Math.max(rest, Math.abs(r.pcm[i]));
                     return { frames: r.pcm.length, pad, rest };
                 })().then(done, (e) => done({ error: String(e) }));",
                json!([text]),
            )
            .await?;
        ensure!(result.get("error").is_none(), "{result}");
        ensure!(result["frames"].as_i64() == Some(52920), "expected 1.2 s (52920 frames): {result}");
        ensure!(result["pad"].as_f64().unwrap_or(1.0) == 0.0 && result["rest"].as_f64().unwrap_or(0.0) > 0.2, "{result}");
        Ok(())
    }));
    cases.push(case("effects_apply_only_to_the_time_selection", |tab| async move {
        // Verified in Audacity 2.4.2: Invert over 0-0.5 s flips only that half, and ChangeSpeed +100%
        // over 0-0.5 s shortens the track by 0.25 s while leaving the rest in place.
        open_with_chain(&tab, json!([])).await?;
        let result: Value = tab
            .js_async(
                "const done = arguments[arguments.length - 1];
                 (async () => {
                     const sr = 44100, x = new Float32Array(sr);
                     for (let i = 0; i < sr; i++) x[i] = 0.25 * Math.sin(2 * Math.PI * 440 * i / sr);
                     const sel = 'SelectTime:End=\"0.5\" RelativeTo=\"ProjectStart\" Start=\"0\"\\n';
                     const inv = await window.AudacityMacroEngine.applyMacroText(x, sr, sel + 'Invert:\\n');
                     let firstFlipped = true, restSame = true;
                     for (let i = 0; i < sr; i++) {
                         if (i < sr / 2 && inv.pcm[i] !== -x[i]) firstFlipped = false;
                         if (i >= sr / 2 && inv.pcm[i] !== x[i]) restSame = false;
                     }
                     const fast = await window.AudacityMacroEngine.applyMacroText(x, sr, sel + 'ChangeSpeed:Percentage=\"100\"\\n');
                     let tailSame = true;
                     for (let i = sr / 2; i < sr; i++) if (fast.pcm[i - sr / 4] !== x[i]) tailSame = false;
                     return { firstFlipped, restSame, fastFrames: fast.pcm.length, tailSame };
                 })().then(done, (e) => done({ error: String(e) }));",
                json!([]),
            )
            .await?;
        ensure!(result["firstFlipped"] == true && result["restSame"] == true, "{result}");
        ensure!(result["fastFrames"].as_i64() == Some(33075) && result["tailSame"] == true, "{result}");
        Ok(())
    }));
    cases.push(case("undo_follows_the_audacity_history", |tab| async move {
        // Audacity 2.4.2 ground truth (L+R gain vs the input): effects push no undo state, pans and
        // Paste do, SelectAll rewrites the current state, and Paste fills extra selected tracks with
        // the last clipboard track.
        open_with_chain(&tab, json!([])).await?;
        let head = "SelectAll:\nCopy:\nNewMonoTrack:\nPaste:\nAmplify:Ratio=\"0.5\"\n";
        let pans = "SelectTracks:Mode=\"Set\" Track=\"0\"\nPanLeft:\nSelectTracks:Mode=\"Set\" Track=\"1\"\nPanRight:\n";
        let macros = json!([
            [format!("{head}NewMonoTrack:\nUndo:\nInvert:\n{pans}"), 0.0],
            [format!("{head}SelectAll:\nNewMonoTrack:\nUndo:\nInvert:\n{pans}"), -1.5],
            [format!("{head}SelectAll:\nPanLeft:\nSelect:Mode=\"Set\" Track=\"0\"\nPanRight:\nUndo:\nSelectAll:\nMixAndRender:\n"), 1.5],
            [format!("{head}Invert:\nNewMonoTrack:\nNewMonoTrack:\nSelectTracks:Mode=\"Set\" Track=\"0\" TrackCount=\"2\"\nCopy:\nSelectAll:\nPaste:\nSelectTracks:Mode=\"Set\" Track=\"2\"\nPanLeft:\nSelectTracks:Mode=\"Set\" Track=\"3\"\nPanRight:\nSelectTracks:Mode=\"Set\" Track=\"0\" TrackCount=\"2\"\nRemoveTracks:\n"), -1.0],
        ]);
        let gains: Value = tab
            .js_async(
                "const done = arguments[arguments.length - 1];
                 (async () => {
                     const sr = 44100, x = new Float32Array(sr);
                     for (let i = 0; i < sr; i++) x[i] = 0.25 * Math.sin(2 * Math.PI * 440 * i / sr);
                     let xx = 0;
                     for (let i = 0; i < sr; i++) xx += x[i] * x[i];
                     const out = [];
                     for (const [text] of arguments[0]) {
                         const r = await window.AudacityMacroEngine.applyMacroText(x, sr, text);
                         let xy = 0;
                         for (let i = 0; i < sr; i++) xy += x[i] * r.pcm[i];
                         out.push(xy / xx);
                     }
                     return out;
                 })().then(done, (e) => done({ error: String(e) }));",
                json!([macros]),
            )
            .await?;
        ensure!(gains.get("error").is_none(), "{gains}");
        for (i, expected) in macros.as_array().unwrap().iter().map(|c| c[1].as_f64().unwrap()).enumerate() {
            let got = gains[i].as_f64().unwrap_or(f64::NAN);
            ensure!((got - expected).abs() < 0.002, "case {i}: expected {expected}, got {got} ({gains})");
        }
        Ok(())
    }));
    cases.push(case("old_saved_chains_default_to_full_strength", |tab| async move {
        open_with_chain(&tab, json!([{ "id": "CMD:Invert", "label": "Invert", "steps": 1, "params": "" }])).await?;
        let result = render_fit(&tab, "CHAIN", None).await?;
        ensure!((result.k + 1.0).abs() < 0.002, "{result:?}");
        Ok(())
    }));
    cases.push(case("chain_editor_level_inputs_are_labelled_and_persist", |tab| async move {
        open_with_chain(&tab, json!([item("Invert", "", None, None)])).await?;
        tab.click("[data-splice-chain-editor-btn]").await?;
        tab.wait_until("!document.querySelector('.splice-chain-backdrop').hidden", Duration::from_secs(10)).await?;
        let labels: Value = tab
            .eval(
                "Array.from(document.querySelectorAll('.splice-chain-list [data-chain-level]'),
                    (el) => [el.dataset.chainLevel, el.getAttribute('aria-label'), el.value, el.closest('label') !== null])",
            )
            .await?;
        ensure!(
            labels
                == json!([
                    ["mix", "Strength in percent for \"Invert\"", "100", true],
                    ["gainDb", "Volume in decibels for \"Invert\"", "0", true],
                ]),
            "{labels}"
        );
        const STRENGTH: &str = ".splice-chain-list [data-chain-level=\"mix\"]";
        const VOLUME: &str = ".splice-chain-list [data-chain-level=\"gainDb\"]";
        tab.replace_text(STRENGTH, "150").await?;
        tab.press("Tab", &[]).await?;
        tab.replace_text(VOLUME, "-9").await?;
        tab.press("Tab", &[]).await?;
        let values: Vec<String> = tab
            .js(
                "return [document.querySelector(arguments[0]).value, document.querySelector(arguments[1]).value];",
                json!([STRENGTH, VOLUME]),
            )
            .await?;
        ensure!(values[0] == "100", "strength clamps to 100%: {values:?}");
        ensure!(values[1] == "-9", "{values:?}");
        let status: String = tab.eval("document.querySelector('.splice-chain-status').innerText").await?;
        ensure!(status == "Set \"Invert\" volume to -9 dB.", "{status}");
        let saved: Value =
            tab.js("return JSON.parse(localStorage.getItem(arguments[0]));", json!([CHAIN_STORAGE_KEY])).await?;
        ensure!(saved[0]["mix"] == 100 && saved[0]["gainDb"] == -9, "{saved}");
        Ok(())
    }));
    cases
}
