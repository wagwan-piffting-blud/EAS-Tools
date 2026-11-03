//! NWS marine SAME codes (same-marine.json) reach the Encoder's location table and E2T, and
//! the Encoder accepts well-formed FIPS codes that are in no table as custom codes.

use eas_tools_e2e::*;

use crate::common::{open_tool_tracking_errors, shipped_json};

/// Two marine zones (not area-wide `..000` codes) from different marine areas, with their
/// names, picked from the shipped same-marine.json so an NWS list update cannot break the test.
fn two_marine_zones() -> Result<[(String, String); 2]> {
    let marine = shipped_json("assets/E2T/include/same-marine.json")?;
    let same = marine["SAME"]
        .as_object()
        .context("same-marine.json has no SAME")?;
    let mut zones = same
        .iter()
        .filter(|(code, _)| code.len() == 5 && !code.ends_with("000"))
        .map(|(code, name)| (code.clone(), name.as_str().unwrap_or_default().to_string()));
    let first = zones.next().context("no marine zones")?;
    let second = zones
        .find(|(code, _)| code[..2] != first.0[..2])
        .context("marine zones from only one area")?;
    Ok([first, second])
}

/// The name E2T prints: the table name without its trailing UGC prefix (", AM").
fn spoken_name(name: &str) -> &str {
    match name.rsplit_once(", ") {
        Some((head, tail)) if tail.len() == 2 && tail.chars().all(|c| c.is_ascii_uppercase()) => {
            head
        }
        _ => name,
    }
}

/// The Encoder's marine fields must equal same-marine.json exactly (so retired zones are
/// gone), and every land code it holds must carry its same-us.json name. same-us.json also
/// lists Canadian codes that collide with US ones; the US table leaves those out on purpose.
const TABLE_DIFF_JS: &str = "
const done = arguments[arguments.length - 1];
Promise.all(['same-us.json', 'same-marine.json'].map((f) => fetch('assets/E2T/include/' + f).then((r) => r.json()))).then(([us, marine]) => {
    const bad = [];
    const at = (code) => (window.county[code.slice(0, 2)] || {})[code.slice(2)];
    let land = 0;
    for (const [code, name] of Object.entries(us.SAME)) {
        if (at(code) === undefined) continue;
        land++;
        if (at(code) !== name) bad.push('us ' + code + ': ' + at(code));
    }
    if (!land) bad.push('no same-us.json code reached the Encoder');
    for (const [code, name] of Object.entries(marine.SAME)) if (at(code) !== name) bad.push('marine ' + code + ': ' + at(code));
    for (const field of Object.keys(marine.AREAS)) {
        for (const rest of Object.keys(window.county[field] || {})) {
            if (!((field + rest) in marine.SAME)) bad.push('not in the NWS marine list: ' + field + rest);
        }
    }
    done({ checked: Object.keys(us.SAME).length + Object.keys(marine.SAME).length, bad: bad.slice(0, 20) });
});";

async fn open(tab: &Tab) -> Result<()> {
    open_tool_tracking_errors(tab, "encoder").await?;
    tab.wait_until(
        "!!window.county && !!window.county['75'] && !!window.county['48']",
        Duration::from_secs(25),
    )
    .await
}

async fn add_manual(tab: &Tab, codes: &str) -> Result<()> {
    tab.exec(
        "window.confirm = () => true; document.querySelector('[data-encoder-clear-locs]').click();",
        json!([]),
    )
    .await?;
    tab.click("#fipsinput").await?;
    tab.type_text(codes).await?;
    tab.click("button[data-encoder-add-loc]").await
}

async fn statuses(tab: &Tab) -> Result<String> {
    tab.eval("document.getElementById('status').innerText")
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

pub fn cases() -> Vec<Case> {
    vec![
        case(
            "a_marine_zone_only_nws_lists_resolves_in_the_encoder",
            |tab| async move {
                let [(a, a_name), (b, b_name)] = two_marine_zones()?;
                open(&tab).await?;
                add_manual(&tab, &format!("0{a}-0{b}")).await?;
                let locations: Vec<String> = tab.eval("window.locations.slice()").await?;
                ensure!(
                    locations == [format!("0{a}"), format!("0{b}")],
                    "{locations:?}"
                );
                let rows: String = tab
                    .eval("document.getElementById('container').innerText")
                    .await?;
                ensure!(rows.contains(&a_name), "expected {a_name}: {rows}");
                ensure!(rows.contains(&b_name), "expected {b_name}: {rows}");
                ensure!(!rows.contains("Custom code"), "{rows}");
                let status = statuses(&tab).await?;
                ensure!(!status.contains("custom FIPS"), "{status}");
                Ok(())
            },
        ),
        case(
            "retired_marine_zones_are_gone_and_land_codes_stay",
            |tab| async move {
                open(&tab).await?;
                let diff: Value = tab.js_async(TABLE_DIFF_JS, json!([])).await?;
                ensure!(diff["checked"].as_u64().unwrap_or(0) > 0, "{diff}");
                ensure!(
                    diff["bad"].as_array().is_some_and(|b| b.is_empty()),
                    "the Encoder's location tables differ from same-us.json + same-marine.json: {diff}"
                );
                Ok(())
            },
        ),
        case(
            "e2t_names_marine_codes_from_same_marine_json",
            |tab| async move {
                let [(a, a_name), (b, b_name)] = two_marine_zones()?;
                open(&tab).await?;
                let text = e2t(
                    &tab,
                    &format!("ZCZC-WXR-SMW-0{a}-0{b}+0100-2701505-KOKX/NWS-"),
                )
                .await?;
                for name in [spoken_name(&a_name), spoken_name(&b_name)] {
                    ensure!(text.contains(name), "expected {name}: {text}");
                }
                Ok(())
            },
        ),
        case(
            "a_well_formed_unknown_code_is_added_as_a_custom_code",
            |tab| async move {
                open(&tab).await?;
                add_manual(&tab, "088888-048453").await?;
                let locations: Vec<String> = tab.eval("window.locations.slice()").await?;
                ensure!(locations == ["088888", "048453"], "{locations:?}");
                let first: String = tab
                    .eval("document.querySelector('#container tr').innerText")
                    .await?;
                ensure!(
                    first.contains("Custom code") && first.contains("088888"),
                    "{first}"
                );
                let status = statuses(&tab).await?;
                ensure!(
                    status.contains(
                        "custom FIPS code(s) that are not in the location tables: 088888"
                    ),
                    "{status}"
                );
                tab.wait_until("document.getElementById('headerPreview').textContent.includes('-088888-048453+')", Duration::from_secs(5)).await?;
                let text = e2t(&tab, "ZCZC-WXR-TOR-088888+0030-2701505-KEAX/NWS-").await?;
                ensure!(text.contains("FIPS Code 088888"), "{text}");
                Ok(())
            },
        ),
        case("malformed_codes_are_still_rejected", |tab| async move {
            open(&tab).await?;
            add_manual(&tab, "1234-048453").await?;
            let locations: Vec<String> = tab.eval("window.locations.slice()").await?;
            ensure!(locations == ["048453"], "{locations:?}");
            let status = statuses(&tab).await?;
            ensure!(
                status.contains("Skipped malformed FIPS code(s)") && status.contains("1234"),
                "{status}"
            );
            Ok(())
        }),
    ]
}
