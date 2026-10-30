//! Decoder options persist to localStorage the way every other tool's do.

use eas_tools_e2e::*;

use crate::common::{checkbox_state, open_tool, set_checkbox};

const STORAGE_KEY: &str = "eas-tools-decoder-settings";
const TOGGLES: [&str; 4] = ["decoder-loopback", "decoder-auto-record", "decoder-alarm-beep", "decoder-alarm-beep-customization"];
const CLEAR_BUTTON: &str = "[data-decoder-clear-stream-url]";

async fn open_decoder(tab: &Tab) -> Result<()> {
    open_tool(tab, "decoder").await
}

async fn saved(tab: &Tab) -> Result<Value> {
    tab.js("const raw = localStorage.getItem(arguments[0]); return raw ? JSON.parse(raw) : null;", json!([STORAGE_KEY])).await
}

async fn clear_saved(tab: &Tab) -> Result<()> {
    tab.exec("localStorage.removeItem(arguments[0]);", json!([STORAGE_KEY])).await
}

async fn toggles(tab: &Tab, ids: &[&str]) -> Result<Vec<bool>> {
    let mut out = Vec::new();
    for id in ids {
        out.push(checkbox_state(tab, id).await?);
    }
    Ok(out)
}

async fn stream_url(tab: &Tab) -> Result<Option<String>> {
    tab.eval("window.streamUrl ?? null").await
}

async fn clear_button_shown(tab: &Tab) -> Result<bool> {
    tab.js("const el = document.querySelector(arguments[0]); return !!el && el.offsetParent !== null;", json!([CLEAR_BUTTON])).await
}

async fn seed_stream_url(tab: &Tab, url: &str) -> Result<()> {
    open_decoder(tab).await?;
    tab.exec("localStorage.setItem(arguments[0], JSON.stringify({ streamUrl: arguments[1] }));", json!([STORAGE_KEY, url])).await?;
    open_decoder(tab).await
}

async fn drop_live_url(tab: &Tab) -> Result<()> {
    tab.exec("window.streamUrl = null;", json!([])).await
}

pub fn cases() -> Vec<Case> {
    vec![
        case("defaults_before_anything_is_saved", |tab| async move {
            open_decoder(&tab).await?;
            clear_saved(&tab).await?;
            open_decoder(&tab).await?;
            let state = toggles(&tab, &TOGGLES).await?;
            ensure!(state == [false, true, false, false], "{state:?}");
            Ok(())
        }),
        case("each_toggle_is_written_on_change_and_restored_on_reload", |tab| async move {
            open_decoder(&tab).await?;
            clear_saved(&tab).await?;
            set_checkbox(&tab, "decoder-loopback", true).await?;
            set_checkbox(&tab, "decoder-auto-record", false).await?;
            set_checkbox(&tab, "decoder-alarm-beep", true).await?;
            let saved = saved(&tab).await?;
            ensure!(
                saved["decoder-loopback"] == true && saved["decoder-auto-record"] == false && saved["decoder-alarm-beep"] == true,
                "{saved}"
            );
            open_decoder(&tab).await?;
            let state = toggles(&tab, &TOGGLES[..3]).await?;
            ensure!(state == [true, false, true], "{state:?}");
            // Restoring the alarm option has to re-run its side effect, not just tick the box.
            tab.wait_until(
                "performance.getEntriesByType('resource').some((e) => e.name.indexOf('bc370crs') !== -1)",
                Duration::from_secs(20),
            )
            .await
        }),
        case("restored_toggles_survive_a_second_round_trip", |tab| async move {
            open_decoder(&tab).await?;
            clear_saved(&tab).await?;
            for toggle in TOGGLES {
                set_checkbox(&tab, toggle, true).await?;
            }
            open_decoder(&tab).await?;
            set_checkbox(&tab, "decoder-alarm-beep", false).await?;
            open_decoder(&tab).await?;
            let state = toggles(&tab, &TOGGLES[..3]).await?;
            ensure!(state == [true, true, false], "{state:?}");
            Ok(())
        }),
        case("stream_url_round_trips_and_the_clear_button_wipes_it", |tab| async move {
            seed_stream_url(&tab, "https://example.invalid/live.mp3").await?;
            ensure!(stream_url(&tab).await?.as_deref() == Some("https://example.invalid/live.mp3"));
            ensure!(clear_button_shown(&tab).await?, "the clear button is hidden");
            tab.click(CLEAR_BUTTON).await?;
            ensure!(stream_url(&tab).await?.is_none());
            ensure!(saved(&tab).await?["streamUrl"].is_null());
            open_decoder(&tab).await?;
            ensure!(stream_url(&tab).await?.is_none());
            ensure!(!clear_button_shown(&tab).await?, "the clear button still shows");
            Ok(())
        }),
        // window.streamUrl is live state that every stop and failure path nulls; the stored copy
        // must not follow it down.
        case("saving_another_setting_does_not_wipe_the_stream_url", |tab| async move {
            let url = "https://example.invalid/live.mp3";
            seed_stream_url(&tab, url).await?;
            drop_live_url(&tab).await?;
            set_checkbox(&tab, "decoder-loopback", true).await?;
            ensure!(saved(&tab).await?["streamUrl"] == url, "toggling an option erased the stream URL");
            open_decoder(&tab).await?;
            ensure!(stream_url(&tab).await?.as_deref() == Some(url));
            ensure!(clear_button_shown(&tab).await?);
            Ok(())
        }),
        case("every_toggle_and_the_device_select_preserve_the_stream_url", |tab| async move {
            let url = "https://example.invalid/second.aac";
            seed_stream_url(&tab, url).await?;
            for toggle in TOGGLES {
                for checked in [true, false] {
                    drop_live_url(&tab).await?;
                    set_checkbox(&tab, toggle, checked).await?;
                    ensure!(saved(&tab).await?["streamUrl"] == url, "{toggle} erased the stream URL");
                }
            }
            tab.exec("document.getElementById('device').dispatchEvent(new Event('change', { bubbles: true }));", json!([])).await?;
            ensure!(saved(&tab).await?["streamUrl"] == url, "the device select erased the stream URL");
            Ok(())
        }),
        case("only_the_clear_button_removes_the_stored_stream_url", |tab| async move {
            seed_stream_url(&tab, "https://example.invalid/live.mp3").await?;
            tab.click(CLEAR_BUTTON).await?;
            ensure!(saved(&tab).await?["streamUrl"].is_null());
            set_checkbox(&tab, "decoder-alarm-beep", true).await?;
            ensure!(saved(&tab).await?["streamUrl"].is_null(), "a cleared URL came back");
            Ok(())
        }),
        case("corrupt_saved_settings_do_not_break_the_decoder", |tab| async move {
            open_decoder(&tab).await?;
            tab.exec("localStorage.setItem(arguments[0], '{not json');", json!([STORAGE_KEY])).await?;
            open_decoder(&tab).await?;
            ensure!(checkbox_state(&tab, "decoder-auto-record").await?);
            let shown: bool = tab.eval("document.getElementById('sync').offsetParent !== null").await?;
            ensure!(shown, "#sync is hidden");
            Ok(())
        }),
    ]
}
