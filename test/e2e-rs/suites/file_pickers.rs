//! Every file picker on the site comes from one component and one set of file-type lists
//! (`assets/js/file-picker.js`, `assets/js/file-types.js`): the same button, file name and drop
//! target everywhere, and the same accepted types for the same kind of file.

use eas_tools_e2e::*;

use crate::common::{named_temp_file, open_tool};

const AUDIT_JS: &str = r#"
const done = arguments[arguments.length - 1];
(async () => {
    const { acceptFor } = await import(new URL(`${arguments[0]}assets/js/file-types.js`, document.baseURI).href);
    const deadline = Date.now() + 20000;
    const pending = () => [...document.querySelectorAll('input[type="file"]')].some((input) => input.dataset.filePicker === undefined);
    while (Date.now() < deadline && pending()) await new Promise((r) => setTimeout(r, 50));
    done([...document.querySelectorAll('input[type="file"]')].map((input) => {
        const kind = input.dataset.filePicker || null;
        const wrapper = input.closest('.file-picker');
        return {
            id: input.id || input.name || input.outerHTML.slice(0, 80),
            kind,
            acceptOk: kind === 'any' ? !input.accept : input.accept === acceptFor(kind),
            wrapped: !!wrapper,
            hasButton: !!(wrapper && wrapper.querySelector('.file-picker-button')),
            trigger: Number(input.dataset.filePickerButtons) > 0 ? (input.dataset.filePickerTrigger || 'code') : null,
            triggerStyled: input.dataset.filePickerTrigger
                ? [...document.querySelectorAll(input.dataset.filePickerTrigger)].every((b) => b.classList.contains('file-picker-button'))
                : Number(input.dataset.filePickerButtons) > 0,
        };
    }));
})();
"#;

const DROP_JS: &str = r#"
const done = arguments[arguments.length - 1];
const [selector, name, type, bytes] = [arguments[0], arguments[1], arguments[2], arguments[3]];
(async () => {
    const target = document.querySelector(selector);
    let rejected = null;
    document.addEventListener('file-picker:rejected', (event) => { rejected = event.detail; }, { once: true });
    const transfer = new DataTransfer();
    transfer.items.add(new File([new Uint8Array(bytes)], name, { type }));
    target.dispatchEvent(new DragEvent('dragover', { dataTransfer: transfer, bubbles: true, cancelable: true }));
    const highlighted = target.classList.contains('file-picker-drop');
    target.dispatchEvent(new DragEvent('drop', { dataTransfer: transfer, bubbles: true, cancelable: true }));
    done({ highlighted, rejected, cleared: !target.classList.contains('file-picker-drop') });
})();
"#;

fn audit_page(audit: &Value, page: &str) -> Result<usize> {
    let inputs = audit.as_array().cloned().unwrap_or_default();
    for input in &inputs {
        ensure!(
            input["kind"].is_string(),
            "{page}: {} has no picker kind: {input}",
            input["id"]
        );
        ensure!(
            input["acceptOk"] == true,
            "{page}: {} does not use the shared {} list: {input}",
            input["id"],
            input["kind"]
        );
        if input["trigger"].is_null() {
            ensure!(
                input["wrapped"] == true && input["hasButton"] == true,
                "{page}: {} is not a shared picker: {input}",
                input["id"]
            );
        } else {
            ensure!(
                input["triggerStyled"] == true,
                "{page}: {}'s button is not a picker button: {input}",
                input["id"]
            );
        }
    }
    Ok(inputs.len())
}

pub fn cases() -> Vec<Case> {
    vec![
        case(
            "every_file_input_on_the_main_page_is_a_shared_picker",
            |tab| async move {
                open_tool(&tab, "crawl").await?;
                let audit: Value = tab.js_async(AUDIT_JS, json!([""])).await?;
                let count = audit_page(&audit, "index.html")?;
                ensure!(
                    count >= 11,
                    "expected every tool's file inputs, found {count}: {audit}"
                );
                for id in [
                    "audiofile",
                    "customAudioFile",
                    "crawlBackgroundVideoFile",
                    "crawlCustomFontFile",
                    "importUserPresetFile",
                ] {
                    ensure!(
                        audit.as_array().unwrap().iter().any(|i| i["id"] == id),
                        "{id} missing from {audit}"
                    );
                }
                open_tool(&tab, "splicer").await?;
                tab.wait_for_selector("#spliceFile", Duration::from_secs(40))
                    .await?;
                let audit: Value = tab.js_async(AUDIT_JS, json!([""])).await?;
                audit_page(&audit, "splicer")?;
                let kinds: Vec<String> = audit
                    .as_array()
                    .unwrap()
                    .iter()
                    .filter_map(|i| i["kind"].as_str().map(String::from))
                    .collect();
                ensure!(
                    ["zip", "macro"]
                        .iter()
                        .all(|k| kinds.contains(&k.to_string())),
                    "{kinds:?}"
                );
                Ok(())
            },
        ),
        case(
            "warngen_and_muxer_pickers_use_the_same_lists",
            |tab| async move {
                tab.goto("warngen/index.html").await?;
                let audit: Value = tab.js_async(AUDIT_JS, json!(["../"])).await?;
                ensure!(audit_page(&audit, "warngen")? == 3, "{audit}");
                tab.goto("muxer.html").await?;
                tab.wait_until(
                    "document.querySelectorAll('#app input[type=\"file\"]').length >= 2",
                    Duration::from_secs(20),
                )
                .await?;
                let audit: Value = tab.js_async(AUDIT_JS, json!([""])).await?;
                ensure!(audit_page(&audit, "muxer")? >= 2, "{audit}");
                let kinds: Vec<String> = audit
                    .as_array()
                    .unwrap()
                    .iter()
                    .filter_map(|i| i["kind"].as_str().map(String::from))
                    .collect();
                ensure!(
                    kinds.contains(&"video".to_string()) && kinds.contains(&"audio".to_string()),
                    "{kinds:?}"
                );
                Ok(())
            },
        ),
        case(
            "a_picker_shows_the_chosen_file_and_clears_with_its_tool",
            |tab| async move {
                open_tool(&tab, "decoder").await?;
                tab.exec(
                    "document.getElementById('decoder-alarm-beep-customization').click();",
                    json!([]),
                )
                .await?;
                let path = named_temp_file("alarm.wav", &crate::common::sine_wav(0.3, 0.2, 8000))?;
                tab.set_files("#decoder-custom-beep-file1", &[path]).await?;
                tab.wait_until(
                "document.getElementById('decoder-custom-beep-file1').closest('.file-picker').querySelector('.file-picker-name').textContent === 'alarm.wav'",
                Duration::from_secs(10),
            )
            .await?;
                tab.click("#decoder-custom-beep-clear").await?;
                tab.wait_until(
                "document.getElementById('decoder-custom-beep-file1').closest('.file-picker').querySelector('.file-picker-name').textContent === 'No file chosen'",
                Duration::from_secs(10),
            )
            .await?;
                Ok(())
            },
        ),
        case(
            "dropping_a_file_on_a_picker_loads_it_and_wrong_types_are_refused",
            |tab| async move {
                open_tool(&tab, "decoder").await?;
                tab.exec(
                    "document.getElementById('output').innerHTML = '';",
                    json!([]),
                )
                .await?;
                let wav = crate::common::sine_wav(0.3, 0.5, 8000);
                let refused: Value = tab
                    .js_async(
                        DROP_JS,
                        json!(["[data-decoder-load]", "notes.txt", "text/plain", [104, 105]]),
                    )
                    .await?;
                ensure!(
                    refused["rejected"]["kind"] == "audio"
                        && refused["highlighted"] == true
                        && refused["cleared"] == true,
                    "{refused}"
                );
                let files: u64 = tab
                    .eval("document.getElementById('audiofile').files.length")
                    .await?;
                ensure!(files == 0, "a text file reached the Decoder");
                let accepted: Value = tab
                    .js_async(
                        DROP_JS,
                        json!(["[data-decoder-load]", "tone.wav", "audio/wav", wav]),
                    )
                    .await?;
                ensure!(accepted["rejected"].is_null(), "{accepted}");
                tab.wait_until(
                    "document.getElementById('audiofile').files.length === 1",
                    Duration::from_secs(10),
                )
                .await?;

                open_tool(&tab, "encoder").await?;
                let custom: Value = tab
                    .js_async(
                        DROP_JS,
                        json!([
                            "#customAudioFile",
                            "tone.wav",
                            "audio/wav",
                            [82, 73, 70, 70]
                        ]),
                    )
                    .await?;
                ensure!(custom["rejected"].is_null(), "{custom}");
                let name: String = tab
                .eval("document.getElementById('customAudioFile').closest('.file-picker').querySelector('.file-picker-name').textContent")
                .await?;
                ensure!(name == "tone.wav", "{name}");
                Ok(())
            },
        ),
    ]
}
