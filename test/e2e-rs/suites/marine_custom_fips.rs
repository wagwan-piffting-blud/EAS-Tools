//! NWS marine SAME codes (same-marine.json) reach the Encoder's location table and E2T, and
//! the Encoder accepts well-formed FIPS codes that are in no table as custom codes.

use eas_tools_e2e::*;

use crate::common::open_tool_tracking_errors;

async fn open(tab: &Tab) -> Result<()> {
    open_tool_tracking_errors(tab, "encoder").await?;
    tab.wait_until("!!window.county && !!window.county['75'] && !!window.county['48']", Duration::from_secs(25)).await
}

async fn add_manual(tab: &Tab, codes: &str) -> Result<()> {
    tab.exec("window.confirm = () => true; document.querySelector('[data-encoder-clear-locs]').click();", json!([])).await?;
    tab.click("#fipsinput").await?;
    tab.type_text(codes).await?;
    tab.click("button[data-encoder-add-loc]").await
}

async fn statuses(tab: &Tab) -> Result<String> {
    tab.eval("document.getElementById('status').innerText").await
}

async fn e2t(tab: &Tab, header: &str) -> Result<String> {
    tab.js_async(
        "const done = arguments[arguments.length - 1];
         import('./assets/E2T/EAS2Text-NG.js').then(async (m) => { await m.resourcesReady; done(m.E2T(arguments[0], null, false, 'UTC')); });",
        json!([header]),
    )
    .await
}

pub fn cases() -> Vec<Case> {
    vec![
        case("a_marine_zone_only_nws_lists_resolves_in_the_encoder", |tab| async move {
            open(&tab).await?;
            add_manual(&tab, "075040-077001").await?;
            let locations: Vec<String> = tab.eval("window.locations.slice()").await?;
            ensure!(locations == ["075040", "077001"], "{locations:?}");
            let rows: String = tab.eval("document.getElementById('container').innerText").await?;
            ensure!(rows.contains("Caribbean N of 18N W of 85W including Yucatan Basin, AM"), "{rows}");
            ensure!(rows.contains("Synopsis for the Gulf of America, GM"), "{rows}");
            ensure!(!rows.contains("Custom code"), "{rows}");
            let status = statuses(&tab).await?;
            ensure!(!status.contains("custom FIPS"), "{status}");
            Ok(())
        }),
        case("retired_marine_zones_are_gone_and_land_codes_stay", |tab| async move {
            open(&tab).await?;
            let (retired, travis, palau): (Option<String>, Option<String>, Option<String>) =
                tab.eval("[window.county['58']['041'] ?? null, window.county['48']['453'] ?? null, (window.county['70'] || {})['002'] ?? null]").await?;
            ensure!(retired.is_none(), "58041 is not in the NWS marine list: {retired:?}");
            ensure!(travis.as_deref() == Some("Travis County, TX"), "{travis:?}");
            ensure!(palau.is_some(), "territory field 70 must stay in same-us.json");
            Ok(())
        }),
        case("e2t_names_marine_codes_from_same_marine_json", |tab| async move {
            open(&tab).await?;
            let text = e2t(&tab, "ZCZC-WXR-SMW-073350-057100+0100-2701505-KOKX/NWS-").await?;
            ensure!(text.contains("Moriches Inlet NY to Montauk Point NY out 20 nm"), "{text}");
            ensure!(text.contains("Synopsis for Northern and Central Washington Coast and Inland Waters"), "{text}");
            Ok(())
        }),
        case("a_well_formed_unknown_code_is_added_as_a_custom_code", |tab| async move {
            open(&tab).await?;
            add_manual(&tab, "088888-048453").await?;
            let locations: Vec<String> = tab.eval("window.locations.slice()").await?;
            ensure!(locations == ["088888", "048453"], "{locations:?}");
            let first: String = tab.eval("document.querySelector('#container tr').innerText").await?;
            ensure!(first.contains("Custom code") && first.contains("088888"), "{first}");
            let status = statuses(&tab).await?;
            ensure!(status.contains("custom FIPS code(s) that are not in the location tables: 088888"), "{status}");
            tab.wait_until("document.getElementById('headerPreview').textContent.includes('-088888-048453+')", Duration::from_secs(5)).await?;
            let text = e2t(&tab, "ZCZC-WXR-TOR-088888+0030-2701505-KEAX/NWS-").await?;
            ensure!(text.contains("FIPS Code 088888"), "{text}");
            Ok(())
        }),
        case("malformed_codes_are_still_rejected", |tab| async move {
            open(&tab).await?;
            add_manual(&tab, "1234-048453").await?;
            let locations: Vec<String> = tab.eval("window.locations.slice()").await?;
            ensure!(locations == ["048453"], "{locations:?}");
            let status = statuses(&tab).await?;
            ensure!(status.contains("Skipped malformed FIPS code(s)") && status.contains("1234"), "{status}");
            Ok(())
        }),
    ]
}
