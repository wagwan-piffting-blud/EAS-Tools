//! #165: the Decoder's "Alert text style" select rewrites each alert's human-readable text in an
//! ENDEC's wording or as a mock NWS/AWIPS headline, and persists like the other options.

use eas_tools_e2e::*;

use crate::common::{open_tool, set_field};

const STORAGE_KEY: &str = "eas-tools-decoder-settings";
const SELECT: &str = "#decoder-text-style";
const TOR_HEADER: &str = "ZCZC-WXR-TOR-017031+0030-1351200-KLOT/NWS-";
const CIV_HEADER: &str = "ZCZC-CIV-CAE-017031+0100-1351200-KLOT/NWS-";

async fn open_decoder(tab: &Tab) -> Result<()> {
    open_tool(tab, "decoder").await?;
    tab.wait_until(
        "!!document.querySelector('#decoder-options #decoder-text-style')",
        Duration::from_secs(25),
    )
    .await
}

async fn show_alert(tab: &Tab, header: &str) -> Result<String> {
    tab.exec(
        "window.__testPromptValue = arguments[0]; window.prompt = () => window.__testPromptValue;",
        json!([header]),
    )
    .await?;
    tab.click("button[data-decoder-load-raw]").await?;
    tab.wait_until(
        "Array.from(document.querySelectorAll('#output button')).some((el) => el.innerText.trim() === 'View Alert')",
        Duration::from_secs(25),
    )
    .await?;
    let found: bool = tab
        .js(
            "const b = Array.from(document.querySelectorAll('#output button')).find((el) => el.innerText.trim() === 'View Alert');
             if (b) b.setAttribute('data-test-view-alert', '');
             return !!b;",
            json!([]),
        )
        .await?;
    ensure!(found, "no View Alert button in the output");
    tab.click("[data-test-view-alert]").await?;
    tab.wait_until(
        "document.querySelector('.modalInfo').innerText.includes('Send alert to')",
        Duration::from_secs(60),
    )
    .await?;
    tab.eval("document.querySelector('.modalInfo').innerText")
        .await
}

async fn styled_text(tab: &Tab) -> Result<String> {
    tab.eval("document.querySelector('[data-decoder-styled-text]')?.textContent ?? ''")
        .await
}

async fn styled_note(tab: &Tab) -> Result<String> {
    tab.eval("document.querySelector('[data-decoder-styled-note]')?.textContent ?? ''")
        .await
}

async fn e2t(tab: &Tab, header: &str, mode: Value) -> Result<String> {
    tab.js_async(
        "const done = arguments[arguments.length - 1];
         import('./assets/E2T/EAS2Text-NG.js').then(async (m) => {
             await m.resourcesReady;
             done(m.E2T(arguments[0], arguments[1], false, Intl.DateTimeFormat().resolvedOptions().timeZone));
         });",
        json!([header, mode]),
    )
    .await
}

async fn saved_style(tab: &Tab) -> Result<Value> {
    tab.js(
        "const raw = localStorage.getItem(arguments[0]); return raw ? (JSON.parse(raw).textStyle ?? null) : null;",
        json!([STORAGE_KEY]),
    )
    .await
}

const FAKE_BRIDGE_JS: &str = "
window.__bridgeHandlers = {};
window.__bridgeSent = [];
window.EASBridge = {
    on(name, fn) { window.__bridgeHandlers[name] = fn; },
    send(name, payload) { window.__bridgeSent.push([name, JSON.parse(JSON.stringify(payload))]); },
};
";

pub fn cases() -> Vec<Case> {
    vec![
        case(
            "native_apps_set_the_style_and_get_styled_headers",
            |tab| async move {
                tab.add_init_script(FAKE_BRIDGE_JS).await?;
                open_decoder(&tab).await?;
                tab.wait_until(
                    "!!window.__bridgeHandlers['decoder:setTextStyle']",
                    Duration::from_secs(25),
                )
                .await?;
                let styles: Value = tab
                    .js(
                        "window.__bridgeSent.length = 0;
                         window.__bridgeHandlers['decoder:setTextStyle']({ style: 'DAS2PLUS' });
                         return window.__bridgeSent.filter(([n]) => n === 'decoder:textStyles').pop()[1];",
                        json!([]),
                    )
                    .await?;
                ensure!(styles["selected"] == "DAS2PLUS", "{styles}");
                ensure!(
                    styles["styles"]
                        .as_array()
                        .map(|s| s.iter().any(|o| o["value"] == "NWS"))
                        == Some(true),
                    "{styles}"
                );
                ensure!(
                    tab.eval::<String>("document.getElementById('decoder-text-style').value")
                        .await?
                        == "DAS2PLUS"
                );
                tab.exec(
                    "window.__bridgeHandlers['decoder:loadRawHeader']({ header: arguments[0] });",
                    json!([TOR_HEADER]),
                )
                .await?;
                tab.wait_until(
                    "window.__bridgeSent.some(([n]) => n === 'decoder:headerStyled')",
                    Duration::from_secs(25),
                )
                .await?;
                let styled: Value = tab
                    .eval("window.__bridgeSent.filter(([n]) => n === 'decoder:headerStyled').pop()[1]")
                    .await?;
                ensure!(
                    styled["style"] == "DAS2PLUS"
                        && styled["raw"].as_str().unwrap_or("").contains("-TOR-")
                        && styled["text"]
                            .as_str()
                            .unwrap_or("")
                            .contains("for the following counties or areas"),
                    "{styled}"
                );
                Ok(())
            },
        ),
        case(
            "text_style_select_is_labelled_and_defaults_to_plain",
            |tab| async move {
                open_decoder(&tab).await?;
                let state: Value = tab
                    .js(
                        "const select = document.querySelector(arguments[0]);
                         const label = document.querySelector('label[for=\"decoder-text-style\"]');
                         const note = document.getElementById(select.getAttribute('aria-describedby'));
                         return {
                             value: select.value,
                             label: label ? label.textContent : null,
                             note: note ? note.textContent : null,
                             values: Array.from(select.options).map((o) => o.value),
                         };",
                        json!([SELECT]),
                    )
                    .await?;
                ensure!(state["value"] == "", "{state}");
                ensure!(state["label"] == "Alert text style:", "{state}");
                ensure!(
                    state["note"]
                        .as_str()
                        .is_some_and(|n| n.contains("not an official")),
                    "{state}"
                );
                let values: Vec<String> = state["values"]
                    .as_array()
                    .map(|list| {
                        list.iter()
                            .filter_map(|v| v.as_str().map(str::to_owned))
                            .collect()
                    })
                    .unwrap_or_default();
                ensure!(values.first().map(String::as_str) == Some(""), "{values:?}");
                ensure!(
                    values.last().map(String::as_str) == Some("NWS"),
                    "{values:?}"
                );
                for mode in ["DAS1", "DAS2PLUS", "TRILITHIC8PLUS", "SAGE", "TFT"] {
                    ensure!(
                        values.iter().any(|v| v == mode),
                        "{mode} missing: {values:?}"
                    );
                }
                ensure!(!values.iter().any(|v| v == "JSON"), "{values:?}");
                let modal = show_alert(&tab, TOR_HEADER).await?;
                ensure!(modal.contains("Human-Readable Alert Text: \""), "{modal}");
                ensure!(styled_text(&tab).await?.is_empty());
                Ok(())
            },
        ),
        case("keyboard_choice_is_saved_and_restored", |tab| async move {
            open_decoder(&tab).await?;
            tab.focus(SELECT).await?;
            tab.press("ArrowDown", &[]).await?;
            let chosen: String = tab
                .js(
                    "return document.querySelector(arguments[0]).value;",
                    json!([SELECT]),
                )
                .await?;
            ensure!(!chosen.is_empty(), "ArrowDown left the default selected");
            ensure!(saved_style(&tab).await? == json!(chosen), "not saved");
            open_decoder(&tab).await?;
            let restored: String = tab
                .js(
                    "return document.querySelector(arguments[0]).value;",
                    json!([SELECT]),
                )
                .await?;
            ensure!(restored == chosen, "{restored} != {chosen}");
            Ok(())
        }),
        case("endec_style_rewrites_the_alert_details", |tab| async move {
            open_decoder(&tab).await?;
            set_field(&tab, SELECT, "DAS2PLUS").await?;
            let modal = show_alert(&tab, TOR_HEADER).await?;
            ensure!(
                modal.contains("Human-Readable Alert Text (DASDEC II (v2 firmware and newer)):"),
                "{modal}"
            );
            ensure!(modal.contains("Severity: Warning"), "{modal}");
            let expected = e2t(&tab, TOR_HEADER, json!("DAS2PLUS")).await?;
            ensure!(expected.contains("TORNADO WARNING"), "{expected}");
            let shown = styled_text(&tab).await?;
            ensure!(shown == format!("\"{expected}\""), "{shown}");
            Ok(())
        }),
        case(
            "nws_style_builds_a_mock_warngen_headline",
            |tab| async move {
                open_decoder(&tab).await?;
                set_field(&tab, SELECT, "NWS").await?;
                let modal = show_alert(&tab, TOR_HEADER).await?;
                ensure!(modal.contains("Severity: Warning"), "{modal}");
                let shown = styled_text(&tab).await?;
                let prefix = "The National Weather Service in Chicago has issued a\n\n* Tornado Warning for...\n  Cook County in northeastern Illinois...\n\n* Until ";
                ensure!(shown.starts_with(prefix), "{shown}");
                let until = &shown[prefix.len()..];
                ensure!(
                    until.ends_with('.')
                        && (2..=3).contains(&until.split(' ').count())
                        && !until.contains('\n'),
                    "{shown}"
                );
                ensure!(
                    styled_note(&tab).await?.contains("not an official"),
                    "missing mock note"
                );
                Ok(())
            },
        ),
        case(
            "nws_style_keeps_plain_wording_for_other_originators",
            |tab| async move {
                open_decoder(&tab).await?;
                set_field(&tab, SELECT, "NWS").await?;
                show_alert(&tab, CIV_HEADER).await?;
                let plain = e2t(&tab, CIV_HEADER, Value::Null).await?;
                ensure!(styled_text(&tab).await? == format!("\"{plain}\""));
                ensure!(
                    styled_note(&tab).await?.contains("(WXR)"),
                    "missing originator note"
                );
                Ok(())
            },
        ),
    ]
}
