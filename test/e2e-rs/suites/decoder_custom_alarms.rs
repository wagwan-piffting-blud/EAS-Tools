//! Custom decoder alarm sounds land in IndexedDB and come back decoded after a reload. A reload
//! decoding them again is what proves the stored ArrayBuffer was not detached by the first
//! decodeAudioData. Each test starts in a fresh browser context, so storage begins empty.

use std::collections::BTreeMap;

use eas_tools_e2e::*;

use crate::common::{checkbox_state, named_temp_file, open_tool, set_checkbox};

const SETTINGS_KEY: &str = "eas-tools-decoder-settings";
const CUSTOM_TOGGLE: &str = "decoder-alarm-beep-customization";
const FILES_DIV: &str = "decoder-custom-beep-files";
const ADVISORY_INPUT: &str = "#decoder-custom-beep-file1";
const WATCH_INPUT: &str = "#decoder-custom-beep-file2";
const WARNING_INPUT: &str = "#decoder-custom-beep-file3";

const IDB_DUMP_JS: &str = "
const done = arguments[arguments.length - 1];
const request = indexedDB.open('eas-tools-decoder-alarms');
request.onerror = () => done({ ok: false, error: 'open failed' });
request.onsuccess = () => {
    const db = request.result;
    if (!db.objectStoreNames.contains('sounds')) { done({ ok: true, records: [] }); return; }
    const tx = db.transaction('sounds', 'readonly');
    const store = tx.objectStore('sounds');
    const keysRequest = store.getAllKeys();
    const valuesRequest = store.getAll();
    tx.oncomplete = () => {
        const keys = Array.from(keysRequest.result || []);
        const values = Array.from(valuesRequest.result || []);
        done({
            ok: true,
            records: keys.map((key, i) => ({
                key: key,
                name: values[i] ? values[i].name : null,
                bytes: values[i] && values[i].bytes ? values[i].bytes.byteLength : 0,
            })),
        });
    };
    tx.onerror = () => done({ ok: false, error: 'read failed' });
};";

/// A mono 8 kHz square wave; tiny, and every decoder accepts it.
fn square_wav(seconds: f64, frequency: f64) -> Vec<u8> {
    let rate = 8000u32;
    let total = (rate as f64 * seconds) as usize;
    let half = ((rate as f64 / (2.0 * frequency)) as usize).max(1);
    let data_len = (total * 2) as u32;
    let mut out = Vec::with_capacity(44 + data_len as usize);
    out.extend_from_slice(b"RIFF");
    out.extend_from_slice(&(36 + data_len).to_le_bytes());
    out.extend_from_slice(b"WAVEfmt ");
    out.extend_from_slice(&16u32.to_le_bytes());
    out.extend_from_slice(&1u16.to_le_bytes());
    out.extend_from_slice(&1u16.to_le_bytes());
    out.extend_from_slice(&rate.to_le_bytes());
    out.extend_from_slice(&(rate * 2).to_le_bytes());
    out.extend_from_slice(&2u16.to_le_bytes());
    out.extend_from_slice(&16u16.to_le_bytes());
    out.extend_from_slice(b"data");
    out.extend_from_slice(&data_len.to_le_bytes());
    for i in 0..total {
        let value: i16 = if (i / half) % 2 == 0 { 12000 } else { -12000 };
        out.extend_from_slice(&value.to_le_bytes());
    }
    out
}

async fn status(tab: &Tab) -> Result<String> {
    let text: String = tab.eval("document.getElementById('decoder-custom-beep-status').textContent").await?;
    Ok(text.trim().to_string())
}

async fn wait_for_status(tab: &Tab, needle: &str) -> Result<String> {
    tab.wait_until(
        &format!("document.getElementById('decoder-custom-beep-status').textContent.includes({})", json!(needle)),
        Duration::from_secs(20),
    )
    .await
    .with_context(|| format!("status never said {needle:?}"))?;
    status(tab).await
}

async fn idb_records(tab: &Tab) -> Result<BTreeMap<String, Value>> {
    let result: Value = tab.js_async(IDB_DUMP_JS, json!([])).await?;
    ensure!(result["ok"] == true, "{result}");
    Ok(result["records"]
        .as_array()
        .into_iter()
        .flatten()
        .map(|r| (r["key"].as_str().unwrap_or_default().to_string(), r.clone()))
        .collect())
}

async fn files_shown(tab: &Tab) -> Result<bool> {
    tab.js("return document.getElementById(arguments[0]).offsetParent !== null;", json!([FILES_DIV])).await
}

async fn open_with_custom(tab: &Tab) -> Result<()> {
    open_tool(tab, "decoder").await?;
    set_checkbox(tab, CUSTOM_TOGGLE, true).await
}

pub fn cases() -> Vec<Case> {
    vec![
        case("picker_is_hidden_until_the_option_is_ticked", |tab| async move {
            open_tool(&tab, "decoder").await?;
            ensure!(!files_shown(&tab).await?, "the picker shows before the option is ticked");
            set_checkbox(&tab, CUSTOM_TOGGLE, true).await?;
            ensure!(files_shown(&tab).await?, "ticking the option did not show the picker");
            set_checkbox(&tab, CUSTOM_TOGGLE, false).await?;
            ensure!(!files_shown(&tab).await?, "unticking the option did not hide the picker");
            Ok(())
        }),
        case("the_option_persists_with_the_other_decoder_toggles", |tab| async move {
            open_with_custom(&tab).await?;
            let saved: Value =
                tab.js("const raw = localStorage.getItem(arguments[0]); return raw ? JSON.parse(raw) : null;", json!([SETTINGS_KEY])).await?;
            ensure!(saved[CUSTOM_TOGGLE] == true, "{saved}");
            open_tool(&tab, "decoder").await?;
            ensure!(checkbox_state(&tab, CUSTOM_TOGGLE).await?);
            ensure!(files_shown(&tab).await?);
            Ok(())
        }),
        case("saved_sounds_survive_a_reload_and_are_decodable_again", |tab| async move {
            let warning = named_temp_file("my_warning.wav", &square_wav(0.4, 880.0))?;
            let watch = named_temp_file("my_watch.wav", &square_wav(0.25, 440.0))?;
            open_with_custom(&tab).await?;
            tab.set_files(WARNING_INPUT, &[warning.clone()]).await?;
            tab.set_files(WATCH_INPUT, &[watch.clone()]).await?;
            tab.click("#decoder-custom-beep-save").await?;
            wait_for_status(&tab, "Saved.").await?;

            let stored = idb_records(&tab).await?;
            ensure!(stored.keys().map(String::as_str).collect::<Vec<_>>() == ["warning", "watch"], "{stored:?}");
            ensure!(stored["warning"]["name"] == "my_warning.wav" && stored["watch"]["name"] == "my_watch.wav", "{stored:?}");
            ensure!(stored["warning"]["bytes"] == std::fs::metadata(&warning)?.len(), "{stored:?}");
            ensure!(stored["watch"]["bytes"] == std::fs::metadata(&watch)?.len(), "{stored:?}");

            open_tool(&tab, "decoder").await?;
            let restored = wait_for_status(&tab, "In use").await?;
            ensure!(restored.contains("warnings: my_warning.wav"), "{restored}");
            ensure!(restored.contains("watches: my_watch.wav"), "{restored}");
            ensure!(restored.contains("advisories/tests: built-in"), "{restored}");
            ensure!(idb_records(&tab).await?.len() == 2);
            Ok(())
        }),
        case("clear_empties_the_store_and_the_inputs", |tab| async move {
            let advisory = named_temp_file("my_advisory.wav", &square_wav(0.2, 660.0))?;
            open_with_custom(&tab).await?;
            tab.set_files(ADVISORY_INPUT, &[advisory]).await?;
            tab.click("#decoder-custom-beep-save").await?;
            wait_for_status(&tab, "Saved.").await?;
            ensure!(idb_records(&tab).await?.keys().collect::<Vec<_>>() == ["advisory"]);

            tab.click("#decoder-custom-beep-clear").await?;
            wait_for_status(&tab, "Cleared.").await?;
            ensure!(idb_records(&tab).await?.is_empty());
            let value: String = tab.js("return document.querySelector(arguments[0]).value;", json!([ADVISORY_INPUT])).await?;
            ensure!(value.is_empty(), "{value}");
            open_tool(&tab, "decoder").await?;
            wait_for_status(&tab, "No custom sounds saved").await?;
            Ok(())
        }),
        case("a_file_that_is_not_audio_is_reported_and_not_stored", |tab| async move {
            let junk = named_temp_file("not_audio.wav", &b"this is definitely not a wav file".repeat(8))?;
            open_with_custom(&tab).await?;
            tab.set_files(WARNING_INPUT, &[junk]).await?;
            tab.click("#decoder-custom-beep-save").await?;
            let status = wait_for_status(&tab, "skipped").await?;
            ensure!(status.contains("warnings"), "{status}");
            ensure!(idb_records(&tab).await?.is_empty());
            Ok(())
        }),
    ]
}
