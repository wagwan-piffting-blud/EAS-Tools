//! TTS prosody markup, volume scales and the rate/pitch/volume controls.
//!
//! Balabolka speaks SAPI: absspeed/absmiddle take the slider value directly and <volume level>
//! runs 1-100 where 100 is normal, so it can only attenuate. VoiceText speaks VTML: speed and
//! pitch are 0-200 around 100, and volume is 1-500 around 100, so it can boost as well.

use eas_tools_e2e::*;

use crate::common::wait_for_tool;

const MARKUP_CASES: [(&str, i64, i64, i64, &str); 19] = [
    ("BAL", 0, 0, 0, "TEXT"),
    ("BAL", -3, 0, 0, r#"<rate absspeed="-3">TEXT</rate>"#),
    ("BAL", 0, 5, 0, r#"<pitch absmiddle="5">TEXT</pitch>"#),
    ("BAL", 0, 0, -5, r#"<volume level="51">TEXT</volume>"#),
    ("BAL", -3, 5, 0, r#"<pitch absmiddle="5"><rate absspeed="-3">TEXT</rate></pitch>"#),
    ("BAL", -3, 0, -5, r#"<volume level="51"><rate absspeed="-3">TEXT</rate></volume>"#),
    ("BAL", 0, 5, -5, r#"<volume level="51"><pitch absmiddle="5">TEXT</pitch></volume>"#),
    ("BAL", -3, 5, -5, r#"<volume level="51"><pitch absmiddle="5"><rate absspeed="-3">TEXT</rate></pitch></volume>"#),
    ("BAL", 10, -10, -10, r#"<volume level="1"><pitch absmiddle="-10"><rate absspeed="10">TEXT</rate></pitch></volume>"#),
    ("VT", 0, 0, 0, "TEXT"),
    ("VT", -3, 0, 0, r#"<vtml_speed value="70">TEXT</vtml_speed>"#),
    ("VT", 0, 5, 0, r#"<vtml_pitch value="150">TEXT</vtml_pitch>"#),
    ("VT", 0, 0, -5, r#"<vtml_volume value="51">TEXT</vtml_volume>"#),
    ("VT", 0, 0, 10, r#"<vtml_volume value="500">TEXT</vtml_volume>"#),
    ("VT", -3, 5, 0, r#"<vtml_pitch value="150"><vtml_speed value="70">TEXT</vtml_speed></vtml_pitch>"#),
    ("VT", -3, 0, 4, r#"<vtml_volume value="260"><vtml_speed value="70">TEXT</vtml_speed></vtml_volume>"#),
    ("VT", 0, 5, 4, r#"<vtml_volume value="260"><vtml_pitch value="150">TEXT</vtml_pitch></vtml_volume>"#),
    ("VT", -3, 5, 4, r#"<vtml_volume value="260"><vtml_pitch value="150"><vtml_speed value="70">TEXT</vtml_speed></vtml_pitch></vtml_volume>"#),
    ("VT", 10, -10, -10, r#"<vtml_volume value="1"><vtml_pitch value="0"><vtml_speed value="200">TEXT</vtml_speed></vtml_pitch></vtml_volume>"#),
];

const PASSTHROUGH_BACKENDS: [&str; 6] = ["DT", "CEP6", "FEST", "EMNet", "Unknown", ""];

const SLIDER_TO_SCALE: [(i64, i64, i64, i64, i64); 7] = [
    (-10, 1, 1, 0, -10),
    (-5, 51, 51, 50, -5),
    (-1, 90, 90, 90, -1),
    (0, 100, 100, 100, 0),
    (1, 140, 100, 110, 1),
    (5, 300, 100, 150, 5),
    (10, 500, 100, 200, 10),
];

const CAPABILITIES: [(&str, bool, bool); 7] = [
    ("BAL", true, false),
    ("BAL/SPFY", true, false),
    ("VT", true, true),
    ("DT", false, false),
    ("CEP6", false, false),
    ("EMNet", false, false),
    ("Unknown", false, false),
];

/// The Encoder peak-normalises TTS audio to a fixed target, which used to erase the volume
/// setting entirely; the target is now scaled by this ratio instead.
const VOLUME_GAINS: [(&str, i64, f64); 16] = [
    ("BAL", 0, 1.0),
    ("BAL", -1, 0.90),
    ("BAL", -5, 0.51),
    ("BAL", -10, 0.01),
    ("BAL", 5, 1.0),
    ("BAL", 10, 1.0),
    ("BAL/SPFY", -5, 0.51),
    ("VT", 0, 1.0),
    ("VT", -5, 0.51),
    ("VT", -10, 0.01),
    ("VT", 1, 1.40),
    ("VT", 5, 3.0),
    ("VT", 10, 5.0),
    ("DT", -5, 1.0),
    ("CEP6", 5, 1.0),
    ("Unknown", -5, 1.0),
];

// tool, slider, number, reset, row
const VOLUME_CONTROLS: [(&str, &str, &str, &str, &str); 2] = [
    ("encoder", "ttsVolume", "ttsVolumeNumber", "ttsVolumeReset", "ttsVolumeRow"),
    ("splicer", "ttsVolume2", "ttsVolume2Number", "ttsVolume2Reset", "ttsVolume2Row"),
];

/// common-functions.js has no imports and these tests only call its pure helpers, so a light
/// same-origin page hosts it as well as the full encoder would.
async fn tts_module(tab: &Tab) -> Result<()> {
    tab.goto("demos.html").await?;
    let error: Option<String> = tab
        .js_async(
            "const done = arguments[arguments.length - 1];
             import('./assets/js/common-functions.js')
                 .then((m) => { window.__tts = m; done(null); })
                 .catch((e) => done(String(e)));",
            json!([]),
        )
        .await?;
    ensure!(error.is_none(), "could not import common-functions.js: {error:?}");
    Ok(())
}

async fn markup(tab: &Tab, backend: &str, rate: i64, pitch: i64, volume: i64) -> Result<String> {
    tab.js(
        "return window.__tts.applyTtsProsodyMarkup('TEXT', arguments[0], { rate: arguments[1], pitch: arguments[2], volume: arguments[3] });",
        json!([backend, rate, pitch, volume]),
    )
    .await
}

async fn gain(tab: &Tab, backend: &str, slider: i64) -> Result<f64> {
    tab.js("return window.__tts.ttsVolumeGain(arguments[0], arguments[1]);", json!([backend, slider])).await
}

async fn open_with_espeak(tab: &Tab, tool: &str) -> Result<()> {
    tab.goto(&format!("index.html?tool={tool}")).await?;
    wait_for_tool(tab, tool).await?;
    if tool == "encoder" {
        tab.exec(
            "const t = document.getElementById('announcementType'); t.value = 'tts'; t.dispatchEvent(new Event('change', { bubbles: true }));",
            json!([]),
        )
        .await?;
    }
    let select = if tool == "encoder" { "ttsVoice" } else { "ttsVoice2" };
    tab.exec(
        "const s = document.getElementById(arguments[0]); s.value = 'espeak:en-us'; s.dispatchEvent(new Event('change', { bubbles: true }));",
        json!([select]),
    )
    .await
}

pub fn cases() -> Vec<Case> {
    let mut cases = vec![
        case("balabolka_cannot_be_boosted_above_normal", |tab| async move {
            tts_module(&tab).await?;
            for slider in [1, 5, 10] {
                let actual = markup(&tab, "BAL", 0, 0, slider).await?;
                ensure!(actual == "TEXT", "slider {slider} emitted markup: {actual}");
            }
            Ok(())
        }),
        case("resolve_voice_backend", |tab| async move {
            tts_module(&tab).await?;
            let actual: Vec<String> = tab
                .eval(
                    "(() => { const map = { BAL: ['tom', 'jill'], VT: ['paul'] }; const r = window.__tts.resolveVoiceBackend;
                       return [r(map, 'tom'), r(map, 'paul'), r(map, 'nope'), r(map, ''), r(null, 'tom')]; })()",
                )
                .await?;
            ensure!(actual == ["BAL", "VT", "Unknown", "Unknown", "Unknown"], "{actual:?}");
            Ok(())
        }),
        case("neutral_volume_leaves_normalisation_untouched", |tab| async move {
            tts_module(&tab).await?;
            for backend in ["BAL", "VT", "BAL/SPFY", "DT", "Unknown"] {
                let g = gain(&tab, backend, 0).await?;
                ensure!(g == 1.0, "{backend} at volume 0 changed the normalisation target ({g})");
            }
            Ok(())
        }),
        case("normalisation_target_tracks_the_requested_volume", |tab| async move {
            tts_module(&tab).await?;
            let target_db = 3.0;
            for (backend, slider, expected) in [("VT", -5, 0.51), ("VT", 10, 5.0), ("BAL", -10, 0.01)] {
                let g = gain(&tab, backend, slider).await?;
                ensure!((g - expected).abs() <= 0.005, "{backend} {slider}: {g}");
                let adjusted = target_db + 20.0 * g.log10();
                ensure!(if expected < 1.0 { adjusted < target_db } else { adjusted > target_db }, "{backend} {slider}: {adjusted} dB");
            }
            Ok(())
        }),
    ];
    for (backend, rate, pitch, volume, expected) in MARKUP_CASES {
        cases.push(case(format!("prosody_markup[{backend}-r{rate}-p{pitch}-v{volume}]"), move |tab| async move {
            tts_module(&tab).await?;
            let actual = markup(&tab, backend, rate, pitch, volume).await?;
            ensure!(actual == expected, "{actual}");
            Ok(())
        }));
    }
    for backend in PASSTHROUGH_BACKENDS {
        let id = if backend.is_empty() { "empty" } else { backend };
        cases.push(case(format!("backends_without_prosody_markup_are_untouched[{id}]"), move |tab| async move {
            tts_module(&tab).await?;
            let actual = markup(&tab, backend, -7, 7, -7).await?;
            ensure!(actual == "TEXT", "{actual}");
            Ok(())
        }));
    }
    for (slider, vt_vol, bal_vol, vt_speed, sapi) in SLIDER_TO_SCALE {
        cases.push(case(format!("scale_endpoints[{slider}]"), move |tab| async move {
            tts_module(&tab).await?;
            let scales: Vec<i64> = tab
                .js(
                    "const s = window.__tts.TTS_PROSODY_SCALES;
                     return [s.vtVolume(arguments[0]), s.balVolume(arguments[0]), s.vtSpeedPitch(arguments[0]), s.sapi(arguments[0])];",
                    json!([slider]),
                )
                .await?;
            ensure!(scales == [vt_vol, bal_vol, vt_speed, sapi], "{scales:?}");
            Ok(())
        }));
    }
    for (backend, prosody, boost) in CAPABILITIES {
        cases.push(case(format!("backend_capability_helpers[{backend}]"), move |tab| async move {
            tts_module(&tab).await?;
            let actual: (bool, bool) = tab
                .js(
                    "return [window.__tts.backendSupportsProsody(arguments[0]), window.__tts.backendSupportsVolumeBoost(arguments[0])];",
                    json!([backend]),
                )
                .await?;
            ensure!(actual == (prosody, boost), "{actual:?}");
            Ok(())
        }));
    }
    for (backend, slider, expected) in VOLUME_GAINS {
        cases.push(case(format!("volume_gain_ratio[{backend}-{slider}]"), move |tab| async move {
            tts_module(&tab).await?;
            let g = gain(&tab, backend, slider).await?;
            ensure!((g - expected).abs() <= 0.005, "{g}");
            Ok(())
        }));
    }
    for (tool, slider, number, reset, row) in VOLUME_CONTROLS {
        cases.push(case(format!("volume_control_exists_with_the_same_shape_as_rate_and_pitch[{tool}]"), move |tab| async move {
            open_with_espeak(&tab, tool).await?;
            let info: Value = tab
                .js(
                    "const slider = document.getElementById(arguments[0]);
                     const number = document.getElementById(arguments[1]);
                     const reset = document.getElementById(arguments[2]);
                     if (!slider || !number || !reset) return null;
                     const label = document.querySelector(`label[for=\"${arguments[1]}\"]`);
                     return {
                         sliderRange: [slider.min, slider.max, slider.step, slider.value],
                         numberRange: [number.min, number.max, number.step, number.value],
                         numberIsNumber: number.type === 'number',
                         labelHidden: label ? label.classList.contains('visually-hidden') : null,
                         resetText: reset.textContent.trim(),
                     };",
                    json!([slider, number, reset]),
                )
                .await?;
            ensure!(!info.is_null(), "{tool} is missing the volume control");
            ensure!(info["sliderRange"] == json!(["-10", "10", "1", "0"]) && info["numberRange"] == json!(["-10", "10", "1", "0"]), "{info}");
            ensure!(info["numberIsNumber"] == true && info["labelHidden"] == true && info["resetText"] == "Reset", "{info}");
            Ok(())
        }));
        cases.push(case(format!("volume_row_is_hidden_for_voices_that_cannot_use_it[{tool}]"), move |tab| async move {
            open_with_espeak(&tab, tool).await?;
            let container = if tool == "encoder" { "ttsRatePitchControls" } else { "ttsRatePitchControls2" };
            let state: Value = tab
                .js(
                    "const container = document.getElementById(arguments[0]);
                     const row = document.getElementById(arguments[1]);
                     return { containerShown: getComputedStyle(container).display !== 'none',
                              rowHidden: row.hidden, rowShown: getComputedStyle(row).display !== 'none' };",
                    json!([container, row]),
                )
                .await?;
            ensure!(state["containerShown"] == true, "rate and pitch should still show for eSpeak");
            ensure!(state["rowHidden"] == true && state["rowShown"] == false, "the volume row should be hidden for eSpeak: {state}");
            Ok(())
        }));
        cases.push(case(format!("volume_slider_and_number_stay_in_sync[{tool}]"), move |tab| async move {
            open_with_espeak(&tab, tool).await?;
            tab.exec("document.getElementById(arguments[0]).hidden = false;", json!([row])).await?;
            tab.wait_for_selector(&format!("#{number}"), Duration::from_secs(15)).await?;
            tab.exec(
                "const s = document.getElementById(arguments[0]); s.value = '-6'; s.dispatchEvent(new Event('input', { bubbles: true }));",
                json!([slider]),
            )
            .await?;
            let n: String = tab.js("return document.getElementById(arguments[0]).value;", json!([number])).await?;
            ensure!(n == "-6", "number shows {n}");
            tab.exec(
                "const n = document.getElementById(arguments[0]); n.scrollIntoView({ block: 'center' }); n.focus(); n.select();",
                json!([number]),
            )
            .await?;
            tab.type_text("8").await?;
            tab.press("Tab", &[]).await?;
            if tab.wait_until(&format!("document.getElementById({}).value === '8'", json!(slider)), Duration::from_secs(5)).await.is_err() {
                let state: Value = tab
                    .js(
                        "return { slider: document.getElementById(arguments[0]).value, number: document.getElementById(arguments[1]).value,
                                  active: document.activeElement && (document.activeElement.id || document.activeElement.tagName),
                                  rowHidden: document.getElementById(arguments[2]).hidden,
                                  voice: document.getElementById(arguments[3]).value };",
                        json!([slider, number, row, if tool == "encoder" { "ttsVoice" } else { "ttsVoice2" }]),
                    )
                    .await?;
                bail!("{slider} never followed the number field: {state}");
            }
            tab.click(&format!("#{reset}")).await?;
            let values: Vec<String> = tab
                .js("return [document.getElementById(arguments[0]).value, document.getElementById(arguments[1]).value];", json!([slider, number]))
                .await?;
            ensure!(values == ["0", "0"], "{values:?}");
            Ok(())
        }));
    }
    cases
}
