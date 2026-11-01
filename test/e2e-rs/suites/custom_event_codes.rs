//! #157: unknown event codes read as "Unrecognized ..." instead of the bare code, and custom
//! codes saved in the Encoder are named by the Encoder, Decoder, E2T and the crawl.

use eas_tools_e2e::*;

use crate::common::open_tool_tracking_errors;

const WCN_HEADER: &str = "ZCZC-WXR-WCN-004013+0100-2951711-KPSR/NWS-";

async fn open_encoder(tab: &Tab) -> Result<()> {
    open_tool_tracking_errors(tab, "encoder").await?;
    tab.wait_until("!!document.getElementById('customEventsEditor') && !!document.querySelector('#events option[value=\"TOR\"]')", Duration::from_secs(25))
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

async fn save_custom(tab: &Tab, code: &str, name: &str) -> Result<String> {
    tab.exec("document.getElementById('customEventsEditor').open = true;", json!([])).await?;
    tab.replace_text("#customEventCode", code).await?;
    tab.replace_text("#customEventName", name).await?;
    tab.click("#customEventSave").await?;
    tab.eval("document.getElementById('customEventMessage').textContent").await
}

pub fn cases() -> Vec<Case> {
    vec![
        case("unknown_codes_read_as_unrecognized_by_their_last_letter", |tab| async move {
            open_encoder(&tab).await?;
            let warning = e2t(&tab, "ZCZC-WXR-XYW-004013+0100-2951711-KPSR/NWS-").await?;
            ensure!(warning.contains("an Unrecognized Warning"), "{warning}");
            let other = e2t(&tab, WCN_HEADER).await?;
            ensure!(other.contains("an Unrecognized Message") && !other.contains(" WCN "), "{other}");
            Ok(())
        }),
        case("a_saved_custom_code_is_selectable_and_named_everywhere", |tab| async move {
            open_encoder(&tab).await?;
            let message = save_custom(&tab, "wcn", "Weather Watch").await?;
            ensure!(message.contains("Saved WCN (Weather Watch)"), "{message}");
            let (selected, group, hidden): (String, String, bool) = tab
                .eval("(() => { const s = document.getElementById('events'); const o = s.selectedOptions[0]; return [s.value, o.parentElement.label, o.parentElement.hidden]; })()")
                .await?;
            ensure!(selected == "WCN" && group == "Custom Codes" && !hidden, "{selected} {group} {hidden}");
            tab.wait_until("document.getElementById('headerPreview').textContent.includes('-WCN-')", Duration::from_secs(5)).await?;
            let listed: String = tab.eval("document.getElementById('customEventList').innerText").await?;
            ensure!(listed.contains("WCN") && listed.contains("Weather Watch"), "{listed}");

            let text = e2t(&tab, WCN_HEADER).await?;
            ensure!(text.contains("a Weather Watch"), "{text}");
            let (decoder_name, easyplus): (Option<String>, bool) = tab
                .eval("[window.events.WCN ?? null, !!document.querySelector('#easyplusEventCode option[value=\"WCN\"]')]")
                .await?;
            ensure!(decoder_name.as_deref() == Some("Weather Watch"), "{decoder_name:?}");
            ensure!(easyplus, "the EasyPlus event list is missing WCN");

            tab.goto("index.html?tool=encoder").await?;
            open_encoder(&tab).await?;
            let kept: bool = tab.eval("!!document.querySelector('#events optgroup[data-event-group=\"custom\"] option[value=\"WCN\"]')").await?;
            ensure!(kept, "the custom code did not survive a reload");

            tab.exec("document.getElementById('customEventsEditor').open = true;", json!([])).await?;
            tab.click("#customEventList .custom-events__remove").await?;
            let (gone, decoder_gone): (bool, bool) = tab
                .eval("[!document.querySelector('#events option[value=\"WCN\"]'), !('WCN' in window.events)]")
                .await?;
            ensure!(gone && decoder_gone, "removing WCN left it behind: {gone} {decoder_gone}");
            let text = e2t(&tab, WCN_HEADER).await?;
            ensure!(text.contains("an Unrecognized Message"), "{text}");
            Ok(())
        }),
        case("standard_and_malformed_codes_are_refused", |tab| async move {
            open_encoder(&tab).await?;
            let taken = save_custom(&tab, "TOR", "Twister").await?;
            ensure!(taken.contains("TOR is already a standard event code"), "{taken}");
            let short = save_custom(&tab, "WC", "Weather Watch").await?;
            ensure!(short.contains("exactly three letters"), "{short}");
            let stored: Option<String> = tab.eval("localStorage.getItem('eas-tools-custom-events')").await?;
            ensure!(stored.is_none(), "{stored:?}");
            Ok(())
        }),
    ]
}
