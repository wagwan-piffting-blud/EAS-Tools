//! Every ENDEC mode plays back at real time, and the "emulate the ENDEC sample rate" toggle
//! changes only the band-limiting, never the duration.

use eas_tools_e2e::*;

use crate::common::{
    audio_digest, audio_duration, checkbox_state, generate, open_tool_tracking_errors, set_checkbox, set_field, status_text,
    wait_for_saved_encoder_settings,
};

const VALID_HEADER: &str = "ZCZC-WXR-SVR-010001+0030-0010600-KNHC/NWS-";

async fn configure(tab: &Tab, endec_mode: &str) -> Result<()> {
    open_tool_tracking_errors(tab, "encoder").await?;
    set_field(tab, "#encoderMode", "header").await?;
    tab.wait_until("getComputedStyle(document.getElementById('stringEncoder')).display !== 'none'", Duration::from_secs(30)).await?;
    set_field(tab, "#announcementType", "none").await?;
    set_field(tab, "#att", "3").await?;
    set_field(tab, "#cheader", VALID_HEADER).await?;
    set_field(tab, "#overallEndecMode", endec_mode).await
}

pub fn cases() -> Vec<Case> {
    let mut cases = vec![
        case("endec_resample_toggle_defaults_on", |tab| async move {
            configure(&tab, "HOLLYANNE").await?;
            ensure!(checkbox_state(&tab, "endecResample").await?);
            generate(&tab, "default-on").await?;
            let status = status_text(&tab).await?;
            ensure!(status.contains("Emulated 5000 Hz ENDEC sample rate."), "{status}");
            Ok(())
        }),
        case("endec_resample_toggle_off_skips_emulation", |tab| async move {
            configure(&tab, "DEFAULT").await?;
            generate(&tab, "DEFAULT baseline").await?;
            let baseline = audio_digest(&tab).await?;
            set_field(&tab, "#overallEndecMode", "HOLLYANNE").await?;
            set_checkbox(&tab, "endecResample", false).await?;
            generate(&tab, "HOLLYANNE emulation off").await?;
            let off_digest = audio_digest(&tab).await?;
            let off_status = status_text(&tab).await?;
            let off_duration = audio_duration(&tab).await?;
            set_checkbox(&tab, "endecResample", true).await?;
            generate(&tab, "HOLLYANNE emulation on").await?;
            let on_digest = audio_digest(&tab).await?;
            let on_duration = audio_duration(&tab).await?;
            ensure!(off_status.contains("emulation is off"), "{off_status}");
            ensure!(off_digest == baseline, "toggle off should leave the audio untouched");
            ensure!(on_digest != baseline, "toggle on should band-limit the audio");
            ensure!((on_duration - off_duration).abs() < 0.05, "the toggle changed playback duration: {off_duration} vs {on_duration}");
            Ok(())
        }),
        case("endec_resample_defaults_on_for_legacy_saved_settings", |tab| async move {
            configure(&tab, "HOLLYANNE").await?;
            set_checkbox(&tab, "endecResample", false).await?;
            generate(&tab, "seed settings").await?;
            tab.exec(
                "const key = 'eas-tools-encoder-settings';
                 const saved = JSON.parse(localStorage.getItem(key));
                 delete saved.endecResample;
                 localStorage.setItem(key, JSON.stringify(saved));",
                json!([]),
            )
            .await?;
            open_tool_tracking_errors(&tab, "encoder").await?;
            wait_for_saved_encoder_settings(&tab).await?;
            ensure!(checkbox_state(&tab, "endecResample").await?, "a legacy blob restored the toggle as off");
            Ok(())
        }),
    ];
    for mode in ["DEFAULT", "HOLLYANNE", "TFT", "NWS", "DASDEC"] {
        cases.push(case(format!("endec_mode_keeps_realtime_duration[{mode}]"), move |tab| async move {
            configure(&tab, mode).await?;
            generate(&tab, &format!("{mode} run 1")).await?;
            let first = audio_duration(&tab).await?;
            generate(&tab, &format!("{mode} run 2")).await?;
            let second = audio_duration(&tab).await?;
            ensure!(first > 6.0, "{mode} run 1 duration {first:.3}s is too short (playback too fast)");
            ensure!((first - second).abs() < 0.05, "{mode} durations differ between runs: {first} vs {second}");
            Ok(())
        }));
    }
    for checked in [false, true] {
        cases.push(case(format!("endec_resample_toggle_persists_across_reload[{checked}]"), move |tab| async move {
            configure(&tab, "HOLLYANNE").await?;
            set_checkbox(&tab, "endecResample", checked).await?;
            generate(&tab, &format!("persist checked={checked}")).await?;
            let saved: Value = tab.eval("JSON.parse(localStorage.getItem('eas-tools-encoder-settings')).endecResample").await?;
            ensure!(saved == json!(checked), "localStorage stored {saved}, expected {checked}");
            open_tool_tracking_errors(&tab, "encoder").await?;
            wait_for_saved_encoder_settings(&tab).await?;
            ensure!(checkbox_state(&tab, "endecResample").await? == checked);
            Ok(())
        }));
    }
    cases
}
