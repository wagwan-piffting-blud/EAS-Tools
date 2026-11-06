//! Bridge channels the native apps' encoders use for the all-locations search, custom event
//! codes and custom FIPS codes, driven through a stand-in EASBridge the way the apps call them.

use eas_tools_e2e::*;

use crate::common::{open_tool_tracking_errors, shipped_json};

const FAKE_BRIDGE_JS: &str = "
window.__bridgeHandlers = {};
window.__bridgeSent = [];
window.EASBridge = {
    on(name, fn) { window.__bridgeHandlers[name] = fn; },
    send(name, payload) { window.__bridgeSent.push([name, JSON.parse(JSON.stringify(payload))]); },
};
";

async fn open(tab: &Tab) -> Result<()> {
    tab.add_init_script(FAKE_BRIDGE_JS).await?;
    open_tool_tracking_errors(tab, "encoder").await?;
    tab.wait_until(
        "!!(window.__bridgeHandlers && window.__bridgeHandlers['encoder:saveCustomEvent'])",
        Duration::from_secs(30),
    )
    .await
}

/// Calls a bridge handler and returns everything the page sent back, in order.
async fn call(tab: &Tab, channel: &str, payload: Value) -> Result<Vec<(String, Value)>> {
    tab.js("window.__bridgeSent.length = 0; window.__bridgeHandlers[arguments[0]](arguments[1]); return window.__bridgeSent.slice();", json!([channel, payload]))
        .await
}

fn last<'a>(sent: &'a [(String, Value)], channel: &str) -> Option<&'a Value> {
    sent.iter()
        .rev()
        .find(|(name, _)| name == channel)
        .map(|(_, payload)| payload)
}

pub fn cases() -> Vec<Case> {
    vec![
        case("the_engine_suggests_each_endecs_voice", |tab| async move {
            open(&tab).await?;
            for (mode, originator, voice) in [
                ("DEFAULT", "WXR", "nanotts"),
                ("NWS_BMH", "CIV", "paul"),
                ("NWS_CRS", "WXR", "Speechify Tom"),
                ("DASDEC", "WXR", "FestvoxKal"),
                ("SAGE_DIGITAL_3644", "CIV", "Loquendo Dave"),
                ("TFT", "WXR", "paul"),
                ("TFT", "CIV", "FestvoxKal"),
            ] {
                let sent = call(
                    &tab,
                    "encoder:suggestVoice",
                    json!({ "endecMode": mode, "originator": originator }),
                )
                .await?;
                let got = last(&sent, "encoder:suggestedVoice")
                    .cloned()
                    .unwrap_or_default();
                ensure!(got["voice"] == voice, "{mode}/{originator}: {got}");
            }
            Ok(())
        }),
        case("alert_text_is_worded_like_the_endec", |tab| async move {
            open(&tab).await?;
            tab.exec(
                "window.__bridgeSent.length = 0; window.__bridgeHandlers['encoder:requestAlertText'](arguments[0]);",
                json!([{ "header": "ZCZC-WXR-TOR-017031+0030-1352200-KLOT/NWS-", "endecMode": "DASDEC", "fipsMode": "us" }]),
            )
            .await?;
            tab.wait_until(
                "window.__bridgeSent.some(([name]) => name === 'encoder:alertText')",
                Duration::from_secs(15),
            )
            .await?;
            let sent: Vec<(String, Value)> = tab.eval("window.__bridgeSent.slice()").await?;
            let reply = last(&sent, "encoder:alertText")
                .cloned()
                .unwrap_or_default();
            ensure!(
                reply["ok"] == true
                    && reply["style"] == "DAS2PLUS"
                    && reply["text"]
                        .as_str()
                        .unwrap_or("")
                        .contains("for the following counties or areas"),
                "{reply}"
            );
            let empty = call(&tab, "encoder:requestAlertText", json!({ "header": "" })).await?;
            ensure!(
                last(&empty, "encoder:alertText").map(|r| r["ok"] == false) == Some(true),
                "{empty:?}"
            );
            Ok(())
        }),
        case(
            "a_saved_custom_location_resolves_by_name",
            |tab| async move {
                open(&tab).await?;
                let saved = call(
                    &tab,
                    "encoder:saveCustomLocation",
                    json!({ "code": "08888", "name": "Test Ranch, CO" }),
                )
                .await?;
                let result = last(&saved, "encoder:customLocationResult")
                    .cloned()
                    .unwrap_or_default();
                ensure!(
                    result["ok"] == true && result["code"] == "08888",
                    "{result}"
                );
                let data = last(&saved, "encoder:customLocationsData")
                    .cloned()
                    .unwrap_or_default();
                ensure!(data["locations"]["08888"] == "Test Ranch, CO", "{data}");
                let resolved =
                    call(&tab, "encoder:resolveFips", json!({ "codes": ["508888"] })).await?;
                let results = last(&resolved, "encoder:fipsResolved").unwrap()["results"].clone();
                ensure!(results[0]["county"] == "Test Ranch, CO", "{results}");
                let reserved = call(
                    &tab,
                    "encoder:saveCustomLocation",
                    json!({ "code": "48453", "name": "Not Travis" }),
                )
                .await?;
                let refused = last(&reserved, "encoder:customLocationResult")
                    .cloned()
                    .unwrap_or_default();
                ensure!(refused["ok"] == false, "{refused}");
                let removed = call(
                    &tab,
                    "encoder:removeCustomLocation",
                    json!({ "code": "08888" }),
                )
                .await?;
                ensure!(
                    last(&removed, "encoder:customLocationResult")
                        .map(|r| r["action"] == "removed" && r["ok"] == true)
                        == Some(true),
                    "{removed:?}"
                );
                Ok(())
            },
        ),
        case(
            "the_location_index_matches_the_web_search_for_both_modes",
            |tab| async move {
                open(&tab).await?;
                let sent = call(
                    &tab,
                    "encoder:requestLocationIndex",
                    json!({ "mode": "us" }),
                )
                .await?;
                let index = last(&sent, "encoder:locationIndex")
                    .ok_or_else(|| anyhow!("no index sent: {sent:?}"))?;
                ensure!(index["mode"] == "us");
                let entries = index["entries"].as_array().cloned().unwrap_or_default();
                ensure!(entries.len() > 3500, "{} US entries", entries.len());
                let find = |code: &str| entries.iter().find(|e| e["code"] == code).cloned();
                let travis = find("48453").ok_or_else(|| anyhow!("no Travis County"))?;
                ensure!(
                    travis["label"] == "Travis County, TX"
                        && travis["hay"].as_str().unwrap_or("").contains("texas"),
                    "{travis}"
                );
                let marine = shipped_json("assets/E2T/include/same-marine.json")?;
                let (zone, zone_name) = marine["SAME"]
                    .as_object()
                    .and_then(|same| same.iter().find(|(code, _)| !code.ends_with("000")))
                    .map(|(code, name)| {
                        (code.clone(), name.as_str().unwrap_or_default().to_string())
                    })
                    .ok_or_else(|| anyhow!("same-marine.json has no zones"))?;
                let entry = find(&zone)
                    .ok_or_else(|| anyhow!("marine zone {zone} missing from the index"))?;
                ensure!(
                    entry["label"] == zone_name.as_str(),
                    "expected {zone_name}: {entry}"
                );

                let sent = call(
                    &tab,
                    "encoder:requestLocationIndex",
                    json!({ "mode": "ca" }),
                )
                .await?;
                let index =
                    last(&sent, "encoder:locationIndex").ok_or_else(|| anyhow!("no CA index"))?;
                ensure!(
                    index["mode"] == "ca"
                        && index["entries"].as_array().map_or(0, |a| a.len()) > 100,
                    "{}",
                    index["mode"]
                );
                let mode: String = tab
                    .eval("document.getElementById('fipsMode').value")
                    .await?;
                ensure!(
                    mode == "us",
                    "asking for the CA index must not switch the page's mode: {mode}"
                );
                Ok(())
            },
        ),
        case(
            "custom_event_codes_round_trip_over_the_bridge",
            |tab| async move {
                open(&tab).await?;
                let sent = call(
                    &tab,
                    "encoder:saveCustomEvent",
                    json!({ "code": "wcn", "name": "Weather Watch" }),
                )
                .await?;
                let order: Vec<&str> = sent.iter().map(|(name, _)| name.as_str()).collect();
                let result_at = order
                    .iter()
                    .position(|n| *n == "encoder:customEventResult")
                    .ok_or_else(|| anyhow!("{order:?}"))?;
                let events_at = order
                    .iter()
                    .position(|n| *n == "encoder:eventsData")
                    .ok_or_else(|| anyhow!("{order:?}"))?;
                ensure!(
                    events_at < result_at,
                    "the refreshed event list must arrive before the result: {order:?}"
                );
                let result = last(&sent, "encoder:customEventResult").unwrap();
                ensure!(
                    *result
                        == json!({ "ok": true, "action": "saved", "code": "WCN", "name": "Weather Watch" }),
                    "{result}"
                );
                let events = last(&sent, "encoder:eventsData").unwrap()["events"]
                    .as_array()
                    .cloned()
                    .unwrap_or_default();
                ensure!(
                    events.iter().any(|e| e["code"] == "WCN"
                        && e["group"] == "custom"
                        && e["label"] == "Weather Watch"),
                    "WCN missing from eventsData"
                );
                let groups = last(&sent, "encoder:eventGroupsData").unwrap()["groups"].clone();
                ensure!(
                    groups
                        .as_array()
                        .unwrap()
                        .iter()
                        .any(|g| g["key"] == "custom" && g["label"] == "Custom Codes"),
                    "{groups}"
                );
                ensure!(
                    last(&sent, "encoder:customEventsData").unwrap()["events"]
                        == json!({ "WCN": "Weather Watch" })
                );

                let sent = call(
                    &tab,
                    "encoder:saveCustomEvent",
                    json!({ "code": "TOR", "name": "Twister" }),
                )
                .await?;
                let refused = last(&sent, "encoder:customEventResult").unwrap();
                ensure!(
                    refused["ok"] == false
                        && refused["error"]
                            .as_str()
                            .unwrap_or("")
                            .contains("standard event code"),
                    "{refused}"
                );

                let sent =
                    call(&tab, "encoder:removeCustomEvent", json!({ "code": "WCN" })).await?;
                ensure!(
                    *last(&sent, "encoder:customEventResult").unwrap()
                        == json!({ "ok": true, "action": "removed", "code": "WCN" })
                );
                let groups = last(&sent, "encoder:eventGroupsData").unwrap()["groups"].clone();
                ensure!(
                    !groups
                        .as_array()
                        .unwrap()
                        .iter()
                        .any(|g| g["key"] == "custom"),
                    "an empty Custom Codes group was sent: {groups}"
                );
                let sent = call(&tab, "encoder:requestCustomEvents", json!({})).await?;
                ensure!(last(&sent, "encoder:customEventsData").unwrap()["events"] == json!({}));
                Ok(())
            },
        ),
        case(
            "the_emnet_timezone_override_is_offered_and_applied",
            |tab| async move {
                open(&tab).await?;
                let sent = call(&tab, "encoder:requestData", json!({})).await?;
                let options = last(&sent, "encoder:overrideTimezonesData")
                    .ok_or_else(|| anyhow!("no timezone list"))?["options"]
                    .clone();
                ensure!(
                    options
                        .as_array()
                        .is_some_and(|items| items.iter().any(|item| item["value"] == "EST")),
                    "{options}"
                );
                call(
                &tab,
                "encoder:generate",
                json!({ "originator": "WXR", "event": "RWT", "hours": 0, "minutes": 15, "sender": "KDMX/NWS", "locations": ["019153"],
                        "announcementType": "none", "overrideTZ": "EST" }),
            )
            .await?;
                tab.wait_until(
                    "document.getElementById('useOverrideTZ').value === 'EST'",
                    Duration::from_secs(10),
                )
                .await
            },
        ),
        case("a_custom_fips_code_resolves_as_custom", |tab| async move {
            open(&tab).await?;
            let sent = call(
                &tab,
                "encoder:resolveFips",
                json!({ "codes": ["088888", "048453"] }),
            )
            .await?;
            let results = last(&sent, "encoder:fipsResolved").unwrap()["results"].clone();
            ensure!(
                results[0]["county"] == "Custom code"
                    && results[1]["county"] == "Travis County, TX",
                "{results}"
            );
            Ok(())
        }),
    ]
}
