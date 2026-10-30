//! The announcement level controls: visibility per announcement type, gain reaching the WAV,
//! and persistence.

use eas_tools_e2e::*;

use crate::common::{
    generate, open_tool_tracking_errors, output_peak, set_checkbox, set_field, sine_wav, temp_file, wait_for_saved_encoder_settings,
};

const VALID_HEADER: &str = "ZCZC-WXR-SVR-010001+0030-0010600-KNHC/NWS-";
const CLIPPED_TONE_PEAK: f64 = 0.79 / 2.0;

async fn configure_custom_audio(tab: &Tab, wav: Vec<u8>) -> Result<()> {
    set_field(tab, "#encoderMode", "header").await?;
    tab.wait_until("getComputedStyle(document.getElementById('stringEncoder')).display !== 'none'", Duration::from_secs(30)).await?;
    set_field(tab, "#att", "4").await?;
    set_field(tab, "#cheader", VALID_HEADER).await?;
    set_checkbox(tab, "clip", true).await?;
    set_checkbox(tab, "endecResample", false).await?;
    set_checkbox(tab, "enable-vmify-custom", false).await?;
    set_field(tab, "#announcementType", "custom").await?;
    tab.set_files("#customAudioFile", &[temp_file("tone.wav", &wav)?]).await
}

async fn visible(tab: &Tab, id: &str) -> Result<bool> {
    tab.js("const el = document.getElementById(arguments[0]); return !!el && !el.hidden && el.offsetParent !== null;", json!([id])).await
}

pub fn cases() -> Vec<Case> {
    let mut cases = vec![
        case("level_controls_follow_announcement_type", |tab| async move {
            open_tool_tracking_errors(&tab, "encoder").await?;
            set_field(&tab, "#announcementType", "none").await?;
            ensure!(!visible(&tab, "announcementLevelDiv").await?);
            set_field(&tab, "#announcementType", "tts").await?;
            ensure!(visible(&tab, "announcementLevelDiv").await?);
            ensure!(visible(&tab, "announcementAutoLevelRow").await?, "auto-level applies to TTS");
            set_field(&tab, "#announcementType", "custom").await?;
            ensure!(visible(&tab, "announcementLevelDiv").await?);
            ensure!(!visible(&tab, "announcementAutoLevelRow").await?, "custom audio is never auto-leveled");
            set_field(&tab, "#announcementGainNumber", "7").await?;
            ensure!(tab.eval::<String>("document.getElementById('announcementGain').value").await? == "7");
            tab.click("#announcementGainReset").await?;
            ensure!(tab.eval::<String>("document.getElementById('announcementGainNumber').value").await? == "0");
            Ok(())
        }),
        case("level_settings_persist", |tab| async move {
            open_tool_tracking_errors(&tab, "encoder").await?;
            configure_custom_audio(&tab, sine_wav(0.25, 0.25, 44100)).await?;
            set_field(&tab, "#announcementGain", "5").await?;
            set_checkbox(&tab, "announcementAutoLevel", false).await?;
            generate(&tab, "persist").await?;
            open_tool_tracking_errors(&tab, "encoder").await?;
            wait_for_saved_encoder_settings(&tab).await?;
            let state: Value = tab
                .eval(
                    "[document.getElementById('announcementGain').value,
                      document.getElementById('announcementGainNumber').value,
                      document.getElementById('announcementAutoLevel').checked]",
                )
                .await?;
            ensure!(state == json!(["5", "5", false]), "{state}");
            Ok(())
        }),
    ];
    for (gain_db, expected) in [
        ("0", 0.99 / 2.0),
        ("6", 0.99 * 10f64.powf(6.0 / 20.0) / 2.0),
        ("12", 1.98 / 2.0),
        ("-12", CLIPPED_TONE_PEAK),
    ] {
        cases.push(case(format!("custom_audio_gain_reaches_the_wav[{gain_db}]"), move |tab| async move {
            open_tool_tracking_errors(&tab, "encoder").await?;
            configure_custom_audio(&tab, sine_wav(0.99, 1.0, 44100)).await?;
            set_field(&tab, "#announcementGain", gain_db).await?;
            generate(&tab, gain_db).await?;
            let peak = output_peak(&tab).await?;
            ensure!(peak <= 1.0, "output overflowed: {peak}");
            ensure!((peak - expected).abs() < 0.01, "gain {gain_db} dB: peak {peak:.4}, expected {expected:.4}");
            Ok(())
        }));
    }
    cases
}
