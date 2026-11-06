//! Encoder alert options: the message time limit (#159), custom location codes, and the TTS
//! voice match and "Use the alert's text" button (#165).

use eas_tools_e2e::*;

use crate::common::{
    generate, open_tool_tracking_errors, sample_count, set_checkbox, set_field, sine_wav,
    status_text, temp_file,
};

const TOR_HEADER: &str = "ZCZC-WXR-TOR-017031+0030-1352200-KLOT/NWS-";
const RATE: i64 = 44100;

async fn configure_custom_audio(tab: &Tab, seconds: f64) -> Result<()> {
    set_field(tab, "#encoderMode", "header").await?;
    tab.wait_until(
        "getComputedStyle(document.getElementById('stringEncoder')).display !== 'none'",
        Duration::from_secs(30),
    )
    .await?;
    set_field(tab, "#overallEndecMode", "DEFAULT").await?;
    set_field(tab, "#att", "4").await?;
    set_field(tab, "#cheader", TOR_HEADER).await?;
    set_checkbox(tab, "silenceUniform", false).await?;
    set_field(tab, "#silenceAttentionToMessage", "1000").await?;
    set_checkbox(tab, "endecResample", false).await?;
    set_checkbox(tab, "enable-vmify-custom", false).await?;
    set_field(tab, "#announcementType", "custom").await?;
    tab.set_files(
        "#customAudioFile",
        &[temp_file("voice.wav", &sine_wav(0.25, seconds, 44100))?],
    )
    .await
}

async fn open_encoder(tab: &Tab) -> Result<()> {
    open_tool_tracking_errors(tab, "encoder").await?;
    tab.wait_until(
        "!!document.getElementById('customLocationsEditor') && !!window.county && !!window.county['17']",
        Duration::from_secs(25),
    )
    .await
}

async fn save_location(tab: &Tab, code: &str, name: &str) -> Result<String> {
    tab.exec(
        "document.getElementById('customLocationsEditor').open = true;",
        json!([]),
    )
    .await?;
    tab.replace_text("#customLocationCode", code).await?;
    tab.replace_text("#customLocationName", name).await?;
    tab.click("#customLocationSave").await?;
    tab.eval("document.getElementById('customLocationMessage').textContent")
        .await
}

async fn e2t(tab: &Tab, header: &str) -> Result<String> {
    tab.js_async(
        "const done = arguments[arguments.length - 1];
         import('./assets/E2T/EAS2Text-NG.js').then(async (m) => { await m.resourcesReady; done(m.E2T(arguments[0], null, false, 'UTC')); });",
        json!([header]),
    )
    .await
}

const ADD_VOICES_JS: &str = "
const select = document.getElementById('ttsVoice');
for (const [value, label] of [['paul', '[VT] Current NWS Paul'], ['FestvoxKal', '[FEST] Festvox Kal'], ['Speechify Tom', '[BAL] Speechify Tom'], ['Loquendo Dave', '[LTTS] Loquendo Dave']]) {
    if (!Array.from(select.options).some((o) => o.value === value)) select.add(new Option(label, value));
}
select.value = 'wasm';
return true;";

async fn tts_text(tab: &Tab) -> Result<String> {
    tab.eval("window.ttsText || ''").await
}

pub fn cases() -> Vec<Case> {
    vec![
        case("message_limit_cuts_the_voice_message", |tab| async move {
            open_tool_tracking_errors(&tab, "encoder").await?;
            configure_custom_audio(&tab, 6.0).await?;
            set_checkbox(&tab, "messageLimitEnabled", false).await?;
            generate(&tab, "no limit").await?;
            let full = sample_count(&tab).await?;

            set_checkbox(&tab, "messageLimitEnabled", true).await?;
            set_field(&tab, "#messageLimitSeconds", "2").await?;
            generate(&tab, "2 s limit").await?;
            let cut = sample_count(&tab).await?;
            let status = status_text(&tab).await?;
            ensure!(status.contains("Voice message cut off at 0:02"), "{status}");
            ensure!(
                (full - cut - 5 * RATE).abs() <= 2,
                "1 s gap + 6 s voice cut at 2 s should drop 5 s: {full} -> {cut}"
            );

            set_field(&tab, "#messageLimitSeconds", "120").await?;
            generate(&tab, "long limit").await?;
            ensure!(
                sample_count(&tab).await? == full,
                "a limit past the message must not cut"
            );
            Ok(())
        }),
        case(
            "a_saved_custom_location_is_named_by_the_encoder_and_e2t",
            |tab| async move {
                open_encoder(&tab).await?;
                let reserved = save_location(&tab, "17031", "Not Cook").await?;
                ensure!(
                    reserved.contains("17031 is already a standard location code."),
                    "{reserved}"
                );
                let message = save_location(&tab, "017999", "Springfield Township, IL").await?;
                ensure!(
                    message.contains("Saved 17999 (Springfield Township, IL)"),
                    "{message}"
                );
                tab.click("#customLocationList li button").await?;
                let locations: Vec<String> = tab.eval("window.locations.slice()").await?;
                ensure!(
                    locations.iter().any(|c| c.ends_with("17999")),
                    "{locations:?}"
                );
                let row: String = tab
                    .eval("Array.from(document.querySelectorAll('#container tr')).map((r) => r.innerText).join('|')")
                    .await?;
                ensure!(row.contains("Springfield Township, IL"), "{row}");
                let text = e2t(&tab, "ZCZC-WXR-TOR-317999+0030-1352200-KLOT/NWS-").await?;
                ensure!(
                    text.contains("Northeast Springfield Township, Illinois")
                        && !text.contains("FIPS Code"),
                    "{text}"
                );
                tab.exec(
                    "const s = document.getElementById('locSearch'); s.value = 'springfield town'; s.dispatchEvent(new Event('input', { bubbles: true }));",
                    json!([]),
                )
                .await?;
                tab.wait_until(
                    "Array.from(document.querySelectorAll('#locSearchList li')).some((li) => li.textContent.includes('Springfield Township, IL (custom)'))",
                    Duration::from_secs(5),
                )
                .await?;
                tab.exec(
                    "document.querySelector('#customLocationList .custom-events__remove').click();",
                    json!([]),
                )
                .await?;
                let after = e2t(&tab, "ZCZC-WXR-TOR-317999+0030-1352200-KLOT/NWS-").await?;
                ensure!(after.contains("FIPS Code 317999"), "{after}");
                Ok(())
            },
        ),
        case("matching_voice_follows_the_endec", |tab| async move {
            open_tool_tracking_errors(&tab, "encoder").await?;
            set_field(&tab, "#announcementType", "tts").await?;
            tab.exec(ADD_VOICES_JS, json!([])).await?;
            set_checkbox(&tab, "ttsMatchEndec", false).await?;
            set_field(&tab, "#overallEndecMode", "DASDEC").await?;
            ensure!(
                tab.eval::<String>("document.getElementById('ttsVoice').value")
                    .await?
                    == "wasm",
                "the option is off, so the voice must stay"
            );
            set_checkbox(&tab, "ttsMatchEndec", true).await?;
            let voice = || tab.eval::<String>("document.getElementById('ttsVoice').value");
            ensure!(voice().await? == "FestvoxKal", "DASDEC -> Kal");
            set_field(&tab, "#overallEndecMode", "NWS_BMH").await?;
            ensure!(voice().await? == "paul", "BMH -> Paul");
            set_field(&tab, "#overallEndecMode", "NWS_CRS").await?;
            ensure!(voice().await? == "Speechify Tom", "CRS -> Speechify Tom");
            set_field(&tab, "#overallEndecMode", "SAGE_DIGITAL_3644").await?;
            ensure!(
                voice().await? == "Loquendo Dave",
                "SAGE 3644 -> Loquendo Dave"
            );
            set_field(&tab, "#overallEndecMode", "DEFAULT").await?;
            ensure!(voice().await? == "nanotts", "EASyCAP -> NanoTTS");
            set_field(&tab, "#overallEndecMode", "TFT").await?;
            set_field(&tab, "#originators", "WXR").await?;
            ensure!(
                voice().await? == "paul",
                "weather alert on another ENDEC -> Paul"
            );
            set_field(&tab, "#originators", "CIV").await?;
            ensure!(
                voice().await? == "FestvoxKal",
                "civil alert on another ENDEC -> Kal"
            );
            set_checkbox(&tab, "ttsMatchEndec", false).await?;
            Ok(())
        }),
        case(
            "use_the_alerts_text_follows_the_endec_wording",
            |tab| async move {
                open_tool_tracking_errors(&tab, "encoder").await?;
                set_field(&tab, "#encoderMode", "header").await?;
                set_field(&tab, "#cheader", TOR_HEADER).await?;
                set_field(&tab, "#announcementType", "tts").await?;
                set_field(&tab, "#overallEndecMode", "DEFAULT").await?;
                tab.click("#ttsFillFromAlert").await?;
                tab.wait_until(
                    "(window.ttsText || '').includes('Tornado Warning')",
                    Duration::from_secs(15),
                )
                .await?;
                let plain = tts_text(&tab).await?;
                ensure!(
                    plain.contains("Cook, Illinois") && plain.contains("KLOT/NWS"),
                    "{plain}"
                );
                set_field(&tab, "#overallEndecMode", "DASDEC").await?;
                tab.click("#ttsFillFromAlert").await?;
                tab.wait_until(
                    "(window.ttsText || '').includes('for the following counties or areas')",
                    Duration::from_secs(15),
                )
                .await?;
                let editor: String = tab
                .eval("window.encoderEditor ? window.encoderEditor.getValue() : document.getElementById('ttsText').value")
                .await?;
                ensure!(
                    editor.trim() == tts_text(&tab).await?,
                    "the editor shows the new text"
                );
                let status = status_text(&tab).await?;
                ensure!(status.contains("in DAS2PLUS wording"), "{status}");
                Ok(())
            },
        ),
    ]
}
