//! Each configurable silence gap adds exactly its own duration to the rendered audio.
//!
//! The encoder runs at 44100 Hz and the DEFAULT ENDEC profile is also 44100 Hz, so no
//! sample-rate emulation runs and one millisecond is exactly 44.1 samples.

use eas_tools_e2e::*;

use crate::common::{field_value, generate, open_tool_tracking_errors, sample_count, set_checkbox, set_field, status_text, INJECT_CUSTOM_AUDIO_JS};

const VALID_HEADER: &str = "ZCZC-WXR-SVR-010001+0030-0010600-KNHC/NWS-";
const RATE: f64 = 44100.0;
const SILENCE_FIELDS: [&str; 5] = [
    "silencePreTone",
    "silenceHeadersToAttention",
    "silenceAttentionToMessage",
    "silenceMessageToEom",
    "silenceEomToEnd",
];

fn samples(ms: f64) -> i64 {
    (RATE * ms / 1000.0).round() as i64
}

async fn configure(tab: &Tab) -> Result<()> {
    open_tool_tracking_errors(tab, "encoder").await?;
    set_field(tab, "#encoderMode", "header").await?;
    tab.wait_until("getComputedStyle(document.getElementById('stringEncoder')).display !== 'none'", Duration::from_secs(30)).await?;
    set_field(tab, "#cheader", VALID_HEADER).await?;
    set_field(tab, "#overallEndecMode", "DEFAULT").await?;
    set_field(tab, "#att", "3").await?;
    set_field(tab, "#announcementType", "custom").await?;
    set_checkbox(tab, "silenceUniform", false).await?;
    for (field, value) in [
        ("#silencePreTone", "0"),
        ("#silenceHeadersToAttention", "1000"),
        ("#silenceAttentionToMessage", "250"),
        ("#silenceMessageToEom", "1000"),
        ("#silenceEomToEnd", "1000"),
    ] {
        set_field(tab, field, value).await?;
    }
    tab.exec(INJECT_CUSTOM_AUDIO_JS, json!([1.0])).await
}

async fn css(tab: &Tab, selector: &str, property: &str) -> Result<String> {
    tab.js("return getComputedStyle(document.querySelector(arguments[0])).getPropertyValue(arguments[1]);", json!([selector, property]))
        .await
}

async fn label_class(tab: &Tab) -> Result<String> {
    tab.eval("document.querySelector('label[for=\"silenceEomToEnd\"]').className || ''").await
}

// Issue #144: on the iOS app "with pop" sounded identical to plain Trilithic. The pops were decoded
// with Web Audio's decodeAudioData, and a failure there silently dropped them for the session.
const BREAK_DECODE_AUDIO_DATA_JS: &str = "
const POP_FILE_BYTES = [1696, 16088];
for (const C of [window.AudioContext, window.webkitAudioContext, window.OfflineAudioContext]) {
    if (!C) continue;
    const original = C.prototype.decodeAudioData;
    C.prototype.decodeAudioData = function (buffer, ...rest) {
        if (buffer && POP_FILE_BYTES.includes(buffer.byteLength)) {
            return Promise.reject(new Error('decodeAudioData disabled by the test'));
        }
        return original.call(this, buffer, ...rest);
    };
}
";

// Issue #147: Capacitor's iOS asset handler answers media files (.wav, .mp3, .mp4, ...) fetched
// without a Range header with a bare URLResponse, so WebKit's fetch() reports status 0 and
// ok === false even though the body arrives. The relay pops failed with "Failed to fetch relay pop
// file." This replays that response shape for the two pop files.
const IOS_MEDIA_STATUS_ZERO_JS: &str = "
const realFetch = window.fetch.bind(window);
window.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : (input && input.url) || String(input);
    const response = await realFetch(input, init);
    if (!/pop(_start)?\\.wav$/.test(url)) return response;
    const body = await response.arrayBuffer();
    return {
        ok: false, status: 0, statusText: '', type: 'basic', url: response.url, headers: response.headers,
        arrayBuffer: async () => body.slice(0), blob: async () => new Blob([body]), clone() { return this; }
    };
};
";

pub fn cases() -> Vec<Case> {
    let mut cases = vec![
        case("trilithic_pop_loads_when_ios_reports_media_status_0", |tab| async move {
            tab.add_init_script(IOS_MEDIA_STATUS_ZERO_JS).await?;
            configure(&tab).await?;
            set_field(&tab, "#overallEndecMode", "TRILITHIC").await?;
            generate(&tab, "plain Trilithic").await?;
            let plain = sample_count(&tab).await?;
            set_field(&tab, "#overallEndecMode", "TRILITHIC_POP").await?;
            generate(&tab, "Trilithic with pop").await?;
            let popped = sample_count(&tab).await?;
            let status = status_text(&tab).await?;
            ensure!(!status.contains("Relay pop audio"), "{status}");
            ensure!(popped - plain == 24384, "with pop added {} samples, expected 24384", popped - plain);
            Ok(())
        }),
        case("trilithic_pop_adds_its_pops_even_when_web_audio_cannot_decode", |tab| async move {
            tab.add_init_script(BREAK_DECODE_AUDIO_DATA_JS).await?;
            configure(&tab).await?;
            set_field(&tab, "#overallEndecMode", "TRILITHIC").await?;
            generate(&tab, "plain Trilithic").await?;
            let plain = sample_count(&tab).await?;
            set_field(&tab, "#overallEndecMode", "TRILITHIC_POP").await?;
            generate(&tab, "Trilithic with pop").await?;
            let popped = sample_count(&tab).await?;
            // 6 bursts x (413 + 4011 frames at 48 kHz) resampled to 44.1 kHz.
            ensure!(popped - plain == 24384, "with pop added {} samples, expected 24384", popped - plain);
            Ok(())
        }),
        case("uniform_checkbox_disables_the_other_fields_and_drives_every_gap", |tab| async move {
            configure(&tab).await?;
            generate(&tab, "uniform baseline").await?;
            let baseline = sample_count(&tab).await?;
            set_checkbox(&tab, "silenceUniform", true).await?;
            for field in &SILENCE_FIELDS[1..] {
                let disabled: bool = tab.js("return document.getElementById(arguments[0]).disabled;", json!([field])).await?;
                ensure!(disabled, "{field} stays editable under uniform silence");
            }
            ensure!(!tab.eval::<bool>("document.getElementById('silencePreTone').disabled").await?);
            set_field(&tab, "#silencePreTone", "600").await?;
            generate(&tab, "uniform=600ms").await?;
            let uniform = sample_count(&tab).await?;
            let expected = samples(600.0) * 5 - samples(3250.0);
            ensure!(uniform - baseline == expected, "diff {} expected {expected}", uniform - baseline);
            Ok(())
        }),
        case("silence_fields_clamp_and_persist", |tab| async move {
            configure(&tab).await?;
            for (raw, expected) in [("-5", "0"), ("45000", "30000"), ("", "0")] {
                set_field(&tab, "#silencePreTone", raw).await?;
                let value = field_value(&tab, "silencePreTone").await?;
                ensure!(value == expected, "{raw:?} became {value:?}");
            }
            set_field(&tab, "#silencePreTone", "750").await?;
            set_field(&tab, "#silenceEomToEnd", "1750").await?;
            generate(&tab, "persist").await?;
            let saved: Value = tab.eval("JSON.parse(localStorage.getItem('eas-tools-encoder-settings'))").await?;
            ensure!(saved["silencePreTone"] == "750" && saved["silenceEomToEnd"] == "1750", "{saved}");
            open_tool_tracking_errors(&tab, "encoder").await?;
            let deadline = std::time::Instant::now() + Duration::from_secs(60);
            while !status_text(&tab).await?.contains("Loaded saved encoder settings!") {
                ensure!(std::time::Instant::now() < deadline, "saved settings were never loaded");
                tokio::time::sleep(Duration::from_millis(25)).await;
            }
            ensure!(field_value(&tab, "silencePreTone").await? == "750");
            ensure!(field_value(&tab, "silenceEomToEnd").await? == "1750");
            Ok(())
        }),
        case("disabled_silence_fields_render_as_disabled", |tab| async move {
            configure(&tab).await?;
            let enabled_bg = css(&tab, "#silenceEomToEnd", "background-color").await?;
            let enabled_color = css(&tab, "#silenceEomToEnd", "color").await?;
            set_checkbox(&tab, "silenceUniform", true).await?;
            let disabled_bg = css(&tab, "#silenceEomToEnd", "background-color").await?;
            let disabled_color = css(&tab, "#silenceEomToEnd", "color").await?;
            ensure!(disabled_bg != enabled_bg && disabled_color != enabled_color, "{enabled_bg}/{enabled_color} vs {disabled_bg}/{disabled_color}");
            ensure!(css(&tab, "#silenceEomToEnd", "cursor").await? == "not-allowed");
            ensure!(label_class(&tab).await?.contains("disabled"));
            let opacity: f64 = css(&tab, "label[for=\"silenceEomToEnd\"]", "opacity").await?.parse()?;
            ensure!(opacity < 1.0, "label opacity {opacity}");
            set_checkbox(&tab, "silenceUniform", false).await?;
            ensure!(css(&tab, "#silenceEomToEnd", "background-color").await? == enabled_bg);
            ensure!(!label_class(&tab).await?.contains("disabled"));
            Ok(())
        }),
        case("endec_mode_change_loads_that_profiles_silence_defaults", |tab| async move {
            configure(&tab).await?;
            set_field(&tab, "#overallEndecMode", "NWS_CRS").await?;
            for (id, want) in [("silencePreTone", "1000"), ("silenceHeadersToAttention", "4000"), ("silenceAttentionToMessage", "1500"), ("silenceMessageToEom", "2000")] {
                ensure!(field_value(&tab, id).await? == want, "NWS_CRS {id}");
            }
            set_field(&tab, "#overallEndecMode", "DEFAULT").await?;
            for (id, want) in [("silencePreTone", "1000"), ("silenceHeadersToAttention", "1000"), ("silenceAttentionToMessage", "1000"), ("silenceMessageToEom", "1000")] {
                ensure!(field_value(&tab, id).await? == want, "DEFAULT {id}");
            }
            Ok(())
        }),
    ];
    for (field, base_ms, new_ms) in [
        ("silencePreTone", 0.0, 2000.0),
        ("silenceHeadersToAttention", 1000.0, 3000.0),
        ("silenceAttentionToMessage", 250.0, 1250.0),
        ("silenceMessageToEom", 1000.0, 2500.0),
        ("silenceEomToEnd", 1000.0, 2000.0),
    ] {
        cases.push(case(format!("each_silence_field_changes_the_audio_by_its_own_delta[{field}-{base_ms}-{new_ms}]"), move |tab| async move {
            configure(&tab).await?;
            generate(&tab, &format!("{field} baseline")).await?;
            let baseline = sample_count(&tab).await?;
            set_field(&tab, &format!("#{field}"), &new_ms.to_string()).await?;
            generate(&tab, &format!("{field}={new_ms}ms")).await?;
            let changed = sample_count(&tab).await?;
            let expected = samples(new_ms) - samples(base_ms);
            ensure!(changed - baseline == expected, "diff {} expected {expected}", changed - baseline);
            Ok(())
        }));
    }
    for mode in ["DEFAULT", "TFT", "DASDEC", "NWS", "NWS_CRS", "NWS_BMH", "SAGE_DIGITAL_3644", "SAGE_ANALOG_1822", "TRILITHIC", "TRILITHIC_POP", "HOLLYANNE"] {
        cases.push(case(format!("pre_tone_default_is_never_below_one_second[{mode}]"), move |tab| async move {
            configure(&tab).await?;
            set_field(&tab, "#overallEndecMode", mode).await?;
            let value: i64 = field_value(&tab, "silencePreTone").await?.parse()?;
            ensure!(value >= 1000, "{mode}: silencePreTone={value}");
            Ok(())
        }));
    }
    cases
}
