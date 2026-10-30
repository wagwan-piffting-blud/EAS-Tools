//! The Hazard Simplification (WHAT/WHERE/WHEN) option in the areal flood templates (#114). The
//! layout is the one Hazard Services writes for FA.Y/FA.W (checked against real FLSLSX, FLSTSA,
//! FLWPHI and FLSPHI products). With the option off, the templates render what they did before.

use eas_tools_e2e::*;

/// The mock context's defaults: 617 PM CDT Mon Jun 15 2026, expiring 645 PM, three central
/// Nebraska counties.
const RENDER_JS: &str = r#"
const [name, action, bullets, extra] = arguments;
const ctx = WarngenContext.buildMockContext(Object.assign({
    bullets: bullets, productId: name.indexOf("Warning") !== -1 && name.indexOf("Followup") === -1 ? "FLW" : "FLS",
    action: action, phenomena: "FA"
}, extra || {}));
const raw = WarngenRender.render(name, templates.modern, ctx);
return { raw: raw, wrapped: WarngenRender.wrapBulletin(raw, 69) };
"#;

const ADVISORY: [&str; 5] = ["general", "ER", "doppler", "thunder", "listofcities"];
const WARNING: [&str; 4] = ["er", "doppler", "thunder", "listofcities"];

async fn open(tab: &Tab) -> Result<()> {
    tab.goto("warngen/").await?;
    tab.wait_until(
        "document.readyState === 'complete' && typeof templates !== 'undefined'
         && !!templates.modern['arealFloodAdvisory.vm'] && !!templates.modern['arealFloodWarningFollowup.vm']
         && !!document.querySelector('.bullet-option')",
        Duration::from_secs(40),
    )
    .await
}

#[derive(serde::Deserialize)]
struct Out {
    raw: String,
    wrapped: String,
}

async fn render(tab: &Tab, name: &str, action: &str, bullets: &[&str]) -> Result<Out> {
    tab.js(RENDER_JS, json!([name, action, bullets, null])).await
}

fn with(base: &[&'static str], more: &[&'static str]) -> Vec<&'static str> {
    base.iter().chain(more).copied().collect()
}

fn body(text: &str) -> &str {
    text.splitn(3, "617 PM CDT Mon Jun 15 2026\n\n").last().unwrap_or(text)
}

pub fn cases() -> Vec<Case> {
    let mut cases = Vec::new();
    for (name, action, bullets) in [
        ("arealFloodAdvisory.vm", "NEW", &ADVISORY[..]),
        ("arealFloodWarning.vm", "NEW", &WARNING[..]),
        ("arealFloodAdvisoryFollowup.vm", "CON", &ADVISORY[..]),
        ("arealFloodWarningFollowup.vm", "CON", &WARNING[..]),
    ] {
        cases.push(case(format!("option_off_keeps_the_classic_layout[{name}]"), move |tab| async move {
            open(&tab).await?;
            let text = render(&tab, name, action, bullets).await?.raw;
            ensure!(!text.contains("* WHAT..."), "{text}");
            ensure!(!text.contains("http://www.weather.gov/safety/flood"), "{text}");
            if action == "NEW" {
                ensure!(text.contains("The National Weather Service in {OFFICE_LOCATION} has issued a"), "{text}");
            }
            Ok(())
        }));
    }
    cases.push(case("advisory_new_matches_the_hazard_services_layout", |tab| async move {
        open(&tab).await?;
        let bullets = ["uss", "ER", "doppler", "thunder", "rain2", "listofcities", "addRainfall", "TADD_CTA", "hazSimp"];
        let text = render(&tab, "arealFloodAdvisory.vm", "NEW", &bullets).await?.wrapped;
        ensure!(!text.contains("The National Weather Service in"), "{}", body(&text));
        let expected = r"...FLOOD ADVISORY IN EFFECT UNTIL 645 PM CDT THIS EVENING...

* WHAT...Urban and small stream flooding caused by excessive rainfall
  is expected.

* WHERE...A portion of central Nebraska, including the following
  counties, Douglas, Sarpy and Washington.

* WHEN...Until 645 PM CDT.

* IMPACTS...Minor flooding in low-lying and poor drainage areas.

* ADDITIONAL DETAILS...
  - At 617 PM CDT, Doppler radar indicated heavy rain due to
    thunderstorms. This will cause urban and small stream
    flooding in the advisory area. Up to two inches of rain have
    already fallen.
  - Additional rainfall amounts of !** EDIT AMOUNT **! inches are
    expected over the area. This additional rain will result in
    minor flooding.
  - Some locations that will experience flooding include...
    {POLYGON_INTERIOR_CITIES}.
  - http://www.weather.gov/safety/flood

PRECAUTIONARY/PREPAREDNESS ACTIONS...

Turn around, don't drown when encountering flooded roads. Most flood
deaths occur in vehicles.

&&
";
        ensure!(text.contains(expected), "{}", body(&text));
        ensure!(text.contains("/O.NEW.KOAX.FA.Y.0042.260615T2317Z-260615T2345Z/"), "{text}");
        for line in text.split('\n') {
            if line.starts_with("  - ") || line.starts_with("    ") {
                ensure!(line.len() <= 65, "{line}");
            }
        }
        Ok(())
    }));
    cases.push(case("warning_new_and_ext", |tab| async move {
        open(&tab).await?;
        let new = render(&tab, "arealFloodWarning.vm", "NEW", &with(&WARNING, &["hazSimp", "sm"])).await?.wrapped;
        for needle in [
            "BULLETIN - IMMEDIATE BROADCAST REQUESTED\nFlood Warning\n",
            "...FLOOD WARNING IN EFFECT UNTIL 645 PM CDT THIS EVENING...",
            "* WHAT...Flooding caused by snowmelt is expected.",
            "* IMPACTS...Flooding of rivers, creeks, streams, and other low-lying\n  and flood-prone locations is imminent or occurring.",
            "  - At 617 PM CDT, Doppler radar indicated thunderstorms\n    producing heavy rain which will cause flooding.\n",
        ] {
            ensure!(new.contains(needle), "missing {needle:?} in\n{}", body(&new));
        }
        let ext = render(&tab, "arealFloodWarning.vm", "EXT", &with(&WARNING, &["hazSimp"])).await?.wrapped;
        ensure!(ext.contains("...FLOOD WARNING NOW IN EFFECT UNTIL 645 PM CDT THIS EVENING..."), "{}", body(&ext));
        ensure!(ext.contains("* WHAT...Flooding caused by excessive rainfall continues."), "{}", body(&ext));
        Ok(())
    }));
    cases.push(case("followups", |tab| async move {
        open(&tab).await?;
        let con = render(&tab, "arealFloodAdvisoryFollowup.vm", "CON", &with(&ADVISORY, &["hazSimp"])).await?.wrapped;
        ensure!(con.contains("...FLOOD ADVISORY REMAINS IN EFFECT UNTIL 645 PM CDT THIS EVENING..."), "{con}");
        ensure!(con.contains("* WHAT...Flooding caused by excessive rainfall continues."), "{con}");
        ensure!(con.contains("/O.CON.KOAX.FA.Y.0042.000000T0000Z-260615T2345Z/"), "{con}");

        let can = render(&tab, "arealFloodAdvisoryFollowup.vm", "CAN", &["general", "ER", "recedingWater", "hazSimp"]).await?.wrapped;
        ensure!(
            can.contains(
                "...FLOOD ADVISORY IS CANCELLED...\n\n\
                 The Flood Advisory is cancelled for a portion of central Nebraska,\n\
                 including the following areas, Douglas, Sarpy and Washington.\n\n\
                 Flood waters have receded"
            ),
            "{can}"
        );
        ensure!(can.contains("\n&&\n\nLAT...LON"), "{can}");

        let exp = render(&tab, "arealFloodWarningFollowup.vm", "EXP", &["er", "rainEnded", "hazSimp"]).await?.wrapped;
        ensure!(exp.contains("...FLOOD WARNING WILL EXPIRE AT 645 PM CDT THIS EVENING..."), "{exp}");
        ensure!(exp.contains("The Flood Warning will expire at 645 PM CDT this evening for a"), "{exp}");

        let wcon = render(&tab, "arealFloodWarningFollowup.vm", "CON", &with(&WARNING, &["hazSimp"])).await?.wrapped;
        ensure!(wcon.contains("...FLOOD WARNING REMAINS IN EFFECT UNTIL 645 PM CDT THIS EVENING..."), "{wcon}");
        ensure!(wcon.contains("* WHAT...Flooding caused by excessive rainfall continues."), "{wcon}");
        Ok(())
    }));
    cases.push(case("where_and_headline_time_follow_hazard_services", |tab| async move {
        open(&tab).await?;
        let areas = json!([
            { "name": "Muskogee", "fips": "40101", "state": "OK", "stateabbr": "OK", "parentRegion": "Oklahoma",
              "partOfParentRegion": ["EAST", "CENTRAL"], "partOfArea": [] },
            { "name": "Le Flore", "fips": "40079", "state": "OK", "stateabbr": "OK", "parentRegion": "Oklahoma",
              "partOfParentRegion": ["SOUTH", "EAST"], "partOfArea": ["NORTH"] },
            { "name": "Sebastian", "fips": "05131", "state": "AR", "stateabbr": "AR", "parentRegion": "Arkansas",
              "partOfParentRegion": ["WEST", "CENTRAL"], "partOfArea": [] },
        ]);
        let where_: String = tab.js("return WarngenContext.buildMockContext({}).hazSimp.where(arguments[0]);", json!([areas])).await?;
        ensure!(
            where_
                == "Portions of east central and southeast Oklahoma and west central Arkansas, including \
                    the following counties, in east central Oklahoma, Muskogee. In southeast Oklahoma, \
                    northern Le Flore. In west central Arkansas, Sebastian.",
            "{where_}"
        );
        let times: Vec<String> = tab
            .eval(
                "(() => { const c = WarngenContext.buildMockContext({localtimezone: 'EST'});
                   const now = new Date(Date.UTC(2025, 7, 18, 3, 55));
                   return [c.hazSimp.until(new Date(Date.UTC(2025, 7, 18, 8, 0)), now, 'EST'),
                           c.hazSimp.until(new Date(Date.UTC(2025, 7, 18, 4, 0)), now, 'EST'),
                           c.hazSimp.until(new Date(Date.UTC(2025, 7, 18, 16, 0)), now, 'EST')]; })()",
            )
            .await?;
        ensure!(times == ["4 AM EDT Monday", "midnight EDT tonight", "noon EDT Monday"], "{times:?}");
        Ok(())
    }));
    cases.push(case("bullet_panel_toggle", |tab| async move {
        open(&tab).await?;
        let state = json!({
            "polygon": [[-96.25, 41.10], [-95.70, 41.10], [-95.70, 41.40], [-96.25, 41.40], [-96.25, 41.10]],
            "selectionMode": "polygon",
            "form": { "template": "arealFloodAdvisory.vm", "era": "modern", "office": "OAX", "mode": "O",
                      "etn": "5", "action": "NEW", "issued": "2026-06-15T18:17", "allcaps": false, "wrap": true },
        });
        tab.local_storage_set("warngen-state-v1", &state.to_string()).await?;
        tab.goto("warngen/").await?;
        tab.wait_until("document.getElementById('output').textContent.includes('FLSOAX')", Duration::from_secs(60)).await?;
        let (label, kind, checked): (String, String, bool) = tab
            .eval("(() => { const b = document.querySelector(\"input[value='hazSimp']\"); return [b.parentElement.innerText.trim(), b.type, b.checked]; })()")
            .await?;
        ensure!(label == "Hazard Simplification format (WHAT/WHERE/WHEN)", "{label}");
        ensure!(kind == "checkbox" && !checked, "{kind} {checked}");
        let output = || async { tab.eval::<String>("document.getElementById('output').textContent").await };
        let before = output().await?;
        ensure!(before.contains("has issued a"), "{before}");

        tab.exec("document.querySelector(\"input[value='hazSimp']\").click();", json!([])).await?;
        tab.wait_until("document.getElementById('output').textContent.includes('* WHAT...')", Duration::from_secs(10)).await?;
        let on = output().await?;
        ensure!(on.contains("...FLOOD ADVISORY IN EFFECT UNTIL"), "{on}");
        ensure!(on.contains("* WHERE...Portions of "), "{on}");
        ensure!(on.split("* WHERE...").nth(1).unwrap_or("").split("* WHEN").next().unwrap_or("").contains("Nebraska"), "{on}");
        ensure!(on.contains("  - http://www.weather.gov/safety/flood"), "{on}");

        tab.exec("document.querySelector(\"input[value='hazSimp']\").click();", json!([])).await?;
        tab.wait_until("!document.getElementById('output').textContent.includes('* WHAT...')", Duration::from_secs(10)).await?;
        ensure!(output().await? == before, "turning the option off did not restore the classic text");
        Ok(())
    }));
    cases
}
