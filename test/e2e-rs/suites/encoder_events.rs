//! EMNet-only event codes (issue #113) and AWIPS products over SAME's 31-location limit (#108).

use std::collections::BTreeSet;

use eas_tools_e2e::*;

const EMNET_EVENTS: [(&str, &str); 8] = [
    ("ADM", "Daily Check Message"),
    ("HUS", "Hurricane Statement"),
    ("NHW", "National Hazard Warning"),
    ("NPW", "Nuclear Plant Warning"),
    ("SVW", "Severe Thunderstorm Warning"),
    ("SWS", "Special Weather Statement"),
    ("TOM", "911 Telephone Outage Message"),
    ("VAW", "Volcanic Ash Warning"),
];

async fn open_encoder_with_emnet(tab: &Tab) -> Result<()> {
    tab.goto("index.html?tool=encoder").await?;
    tab.wait_until("document.querySelectorAll('optgroup[data-event-group=\"emnet\"] option').length > 0", Duration::from_secs(40)).await
}

fn product(ugc: &str) -> String {
    format!(
        "WFUS53 KLMK 271505\nTORLMK\n{ugc}\n/O.NEW.KLMK.TO.W.0001.260927T1505Z-260927T1545Z/\n\nBULLETIN - EAS ACTIVATION REQUESTED\nTornado Warning\n"
    )
}

async fn resolve(tab: &Tab, text: &str) -> Result<Value> {
    tab.goto("index.html?tool=encoder").await?;
    tab.wait_until("typeof window.resolveHeaderInput === 'function' && Object.keys(window.state || {}).length > 40", Duration::from_secs(40))
        .await?;
    let result: Value = tab.js("return window.resolveHeaderInput(arguments[0]);", json!([text])).await?;
    ensure!(result["ok"] == true, "{result}");
    Ok(result)
}

/// The 6-digit location codes between the event code and the purge time.
fn header_locations(header: &str) -> Vec<String> {
    let body = header.split('+').next().unwrap_or_default();
    let rest = body.splitn(4, '-').nth(3).unwrap_or_default();
    rest.split('-').filter(|p| p.len() == 6 && p.chars().all(|c| c.is_ascii_digit())).map(str::to_string).collect()
}

fn notes(result: &Value) -> Vec<String> {
    result["notes"].as_array().into_iter().flatten().filter_map(|n| n.as_str().map(str::to_string)).collect()
}

pub fn cases() -> Vec<Case> {
    vec![
        case("the_encoder_lists_every_emnet_code_in_its_own_group", |tab| async move {
            open_encoder_with_emnet(&tab).await?;
            let options: Vec<(String, String)> = tab
                .eval("Array.from(document.querySelectorAll('optgroup[data-event-group=\"emnet\"] option')).map(o => [o.value, o.textContent])")
                .await?;
            let codes: BTreeSet<&str> = options.iter().map(|(v, _)| v.as_str()).collect();
            ensure!(codes == EMNET_EVENTS.iter().map(|(c, _)| *c).collect(), "{codes:?}");
            for (value, text) in &options {
                let name = EMNET_EVENTS.iter().find(|(c, _)| c == value).unwrap().1;
                ensure!(*text == format!("{name} ({value})"), "{text}");
            }
            Ok(())
        }),
        case("e2t_decodes_every_emnet_code", |tab| async move {
            open_encoder_with_emnet(&tab).await?;
            let codes: Vec<&str> = EMNET_EVENTS.iter().map(|(c, _)| *c).collect();
            let result: Value = tab
                .js_async(
                    "const done = arguments[arguments.length - 1];
                     (async () => {
                         try {
                             const mod = await import('./assets/E2T/EAS2Text-NG.js');
                             await mod.resourcesReady;
                             const out = {};
                             for (const code of arguments[0]) {
                                 out[code] = mod.E2T(`ZCZC-WXR-${code}-021111+0030-2701505-KLMK/NWS-`, null, false, 'UTC');
                             }
                             done({ ok: true, out });
                         } catch (error) {
                             done({ ok: false, error: String(error) });
                         }
                     })();",
                    json!([codes]),
                )
                .await?;
            ensure!(result["ok"] == true, "{result}");
            for (code, name) in EMNET_EVENTS {
                let text = result["out"][code].as_str().unwrap_or_default();
                ensure!(text.to_uppercase().contains(&name.to_uppercase()), "{code}: {text}");
            }
            Ok(())
        }),
        case("a_product_over_31_counties_is_truncated_to_the_same_limit", |tab| async move {
            let result = resolve(&tab, &product("KYC001>080-271545-")).await?;
            let header = result["header"].as_str().unwrap_or_default();
            let locations = header_locations(header);
            ensure!(locations.len() == 31 && locations[0] == "021001", "{locations:?}");
            ensure!(header.starts_with("ZCZC-WXR-TOR-"), "{header}");
            ensure!(notes(&result).iter().any(|n| n.contains("Dropped 49 FIPS code(s)")), "{:?}", notes(&result));
            Ok(())
        }),
        case("a_product_at_exactly_31_counties_is_left_alone", |tab| async move {
            let result = resolve(&tab, &product("KYC001>031-271545-")).await?;
            ensure!(header_locations(result["header"].as_str().unwrap_or_default()).len() == 31);
            ensure!(!notes(&result).iter().any(|n| n.contains("Dropped")), "{:?}", notes(&result));
            Ok(())
        }),
    ]
}
