//! GFE zone warnings (WSW/NPW) built by the zone-product engine in warngen/src/engine/watches.js.
//! Wording follows the GFE/Hazard Services defaults in real WSW and NPW products: warnings say
//! "expected" where the matching watch says "possible".

use eas_tools_e2e::*;

/// (id, pil, name, MND header, SAME code, WHAT line)
const WARNINGS: [(&str, &str, &str, &str, Option<&str>, &str); 5] = [
    ("WS.W", "WSW", "Winter Storm Warning", "URGENT - WINTER WEATHER MESSAGE", Some("WSW"),
     "* WHAT...Heavy snow expected. Total snow accumulations between 8 and"),
    ("BZ.W", "WSW", "Blizzard Warning", "URGENT - WINTER WEATHER MESSAGE", Some("BZW"),
     "* WHAT...Blizzard conditions expected. Total snow accumulations"),
    ("IS.W", "WSW", "Ice Storm Warning", "URGENT - WINTER WEATHER MESSAGE", Some("WSW"),
     "* WHAT...Significant icing expected. Total ice accumulations of one"),
    ("EC.W", "NPW", "Extreme Cold Warning", "URGENT - WEATHER MESSAGE", None,
     "* WHAT...Dangerously cold wind chills as low as 40 below expected."),
    ("HW.W", "NPW", "High Wind Warning", "URGENT - WEATHER MESSAGE", Some("HWW"),
     "* WHAT...Southwest winds 30 to 40 mph with gusts up to 65 mph"),
];

fn warning(id: &str) -> (&'static str, &'static str, &'static str, &'static str, Option<&'static str>, &'static str) {
    *WARNINGS.iter().find(|w| w.0 == id).unwrap()
}

/// A fixed product: Wed Jan 14 2026 312 PM CST, Omaha.
const BUILD_JS: &str = r#"
const [id, action, extra] = arguments;
const p = WarngenWatches.PRODUCT_BY_ID[id];
const issued = new Date(Date.UTC(2026, 0, 14, 21, 12));
const o = Object.assign({
    phen: p.phen, sig: p.sig, wfo: "OAX", wmo: "WWUS43", pil: p.pil, city: "Omaha/Valley NE",
    office: "Omaha/Valley NE", issued: issued,
    start: new Date(Date.UTC(2026, 0, 15, 12)), end: new Date(Date.UTC(2026, 0, 16, 12)),
    tz: "CST", dstLess: false, productClass: "O", etn: 1, action: action,
    zones: [{ state: "NE", fips: "052", name: "Douglas", partOfParentRegion: ["EC"], cities: ["Omaha"] },
            { state: "IA", fips: "079", name: "Pottawattamie", partOfParentRegion: ["SW"], cities: [] }],
    stateNames: { NE: "Nebraska", IA: "Iowa" }, includeCities: true,
    fields: { snowLo: "8", snowHi: "12", ice: "", gust: "65", windChill: "40", dir: "southwest",
              windLo: "30", windHi: "40" },
    text: {}
}, extra || {});
return WarngenWatches.buildZoneWatch(o).text;
"#;

const RING: &str = "[[-96.25,41.10],[-95.70,41.10],[-95.70,41.40],[-96.25,41.40],[-96.25,41.10]]";

async fn open(tab: &Tab) -> Result<()> {
    tab.goto("warngen/").await?;
    tab.wait_until(
        "document.readyState === 'complete' && typeof WarngenWatches !== 'undefined' && !!document.querySelector('.bullet-option')",
        Duration::from_secs(40),
    )
    .await
}

async fn build(tab: &Tab, id: &str, action: &str, extra: Value) -> Result<String> {
    tab.js(BUILD_JS, json!([id, action, extra])).await
}

#[derive(serde::Deserialize)]
struct Rendered {
    raw: String,
    status: String,
    action: String,
    actions: Vec<String>,
}

async fn render_state(tab: &Tab, template: &str, action: &str, iw: Value) -> Result<Rendered> {
    let mut form = json!({
        "snowLo": "8", "snowHi": "12", "gust": "65", "windChill": "40", "dir": "southwest",
        "windLo": "30", "windHi": "40", "start": "2026-01-15T06:00", "end": "2026-01-16T06:00", "cities": false,
    });
    if let Value::Object(extra) = iw {
        form.as_object_mut().unwrap().extend(extra);
    }
    let state = json!({
        "polygon": serde_json::from_str::<Value>(RING)?, "selectionMode": "polygon", "bullets": [], "iw": form,
        "form": { "template": template, "era": "modern", "office": "OAX", "mode": "O", "etn": "1",
                  "action": action, "issued": "2026-01-14T15:12", "allcaps": false, "wrap": true },
    });
    tab.local_storage_set("warngen-state-v1", &state.to_string()).await?;
    tab.goto("warngen/").await?;
    tab.wait_until(
        "typeof lastRawOutput !== 'undefined' && /^WWUS\\d\\d /.test(lastRawOutput || '')
         && /^Rendered /.test(document.getElementById('status').textContent)",
        Duration::from_secs(60),
    )
    .await?;
    tab.eval(
        "(() => { const sel = document.getElementById('action-select');
           return { raw: lastRawOutput, status: document.getElementById('status').textContent,
                    action: sel.value, actions: Array.from(sel.options).map(o => o.value + '=' + o.textContent) }; })()",
    )
    .await
}

pub fn cases() -> Vec<Case> {
    let mut cases = vec![case("warnings_have_their_own_group_and_watches_keep_theirs", |tab| async move {
        open(&tab).await?;
        let groups: std::collections::HashMap<String, Vec<String>> = tab
            .eval(
                "(() => { const out = {};
                   document.querySelectorAll('#template-select optgroup').forEach(g => {
                     out[g.label] = Array.from(g.querySelectorAll('option')).map(o => o.value + '|' + o.textContent); });
                   return out; })()",
            )
            .await?;
        let warnings = groups.get("Warnings (office)").context("no Warnings (office) group")?;
        ensure!(
            warnings
                == &[
                    "watch:WS.W|Winter Storm Warning (WSW)",
                    "watch:BZ.W|Blizzard Warning (WSW)",
                    "watch:IS.W|Ice Storm Warning (WSW)",
                    "watch:EC.W|Extreme Cold Warning (NPW)",
                    "watch:HW.W|High Wind Warning (NPW)",
                ],
            "{warnings:?}"
        );
        let watches = groups.get("Watches (office)").context("no Watches (office) group")?;
        for value in ["watch:WCN", "watch:WS", "watch:EC", "watch:HW", "watch:FA", "watch:FW", "watch:CF"] {
            ensure!(watches.iter().any(|o| o.starts_with(&format!("{value}|"))), "{value} missing from {watches:?}");
        }
        Ok(())
    })];
    for (id, pil, name, header, _, what) in WARNINGS {
        cases.push(case(format!("each_warning_renders_gfe_layout[{id}]"), move |tab| async move {
            open(&tab).await?;
            let extra = if id == "IS.W" { json!({ "fields": { "ice": "one quarter of an inch", "gust": "40" } }) } else { Value::Null };
            let text = build(&tab, id, "NEW", extra).await?;
            let lines: Vec<&str> = text.split('\n').collect();
            let (phen, sig) = id.split_once('.').unwrap();
            ensure!(lines[0] == "WWUS43 KOAX 142112", "{text}");
            ensure!(lines[1] == format!("{pil}OAX"), "{text}");
            ensure!(lines[3] == header, "{text}");
            ensure!(lines.contains(&format!("/O.NEW.KOAX.{phen}.{sig}.0001.260115T1200Z-260116T1200Z/").as_str()), "{text}");
            ensure!(text.contains(&format!("...{} IN EFFECT FROM 6 AM THURSDAY TO 6 AM CST", name.to_uppercase())), "{text}");
            ensure!(text.contains("* WHEN...From 6 AM Thursday to 6 AM CST Friday."), "{text}");
            ensure!(text.contains(what), "{text}");
            let what_block = text.split("* WHERE").next().unwrap().split("* WHAT").nth(1).unwrap_or_default();
            ensure!(!what_block.contains(" possible"), "{what_block}");
            ensure!(text.contains("PRECAUTIONARY/PREPAREDNESS ACTIONS..."), "{text}");
            ensure!(text.trim_end().ends_with("&&\n\n$$"), "{text}");
            Ok(())
        }));
    }
    cases.push(case("warning_cta_and_impacts_follow_the_hazard", |tab| async move {
        open(&tab).await?;
        let ws = build(&tab, "WS.W", "NEW", Value::Null).await?;
        ensure!(ws.contains("* IMPACTS...Travel could be very difficult."), "{ws}");
        ensure!(ws.contains("If you must travel, keep an extra flashlight, food, and water in"), "{ws}");
        let mixed = build(&tab, "WS.W", "NEW", json!({ "fields": { "snowLo": "2", "snowHi": "4", "ice": "one tenth of an inch" } })).await?;
        ensure!(mixed.contains("* WHAT...Heavy mixed precipitation expected. Total snow and sleet"), "{mixed}");
        ensure!(mixed.contains("Power outages and tree damage are likely due to the ice."), "{mixed}");
        let ec = build(&tab, "EC.W", "NEW", Value::Null).await?;
        ensure!(ec.contains("The dangerously cold wind chills as low as 40 below zero"), "{ec}");
        ensure!(ec.contains("Dress in layers including a hat, face mask, and gloves if you must"), "{ec}");
        let hw = build(&tab, "HW.W", "NEW", Value::Null).await?;
        ensure!(hw.contains("* IMPACTS...Damaging winds will blow down trees and power lines."), "{hw}");
        ensure!(hw.contains("A High Wind Warning means a hazardous high wind event is expected or"), "{hw}");
        let bz = build(&tab, "BZ.W", "NEW", Value::Null).await?;
        ensure!(bz.contains("Travel should be restricted to emergencies only."), "{bz}");
        let ice = build(&tab, "IS.W", "NEW", Value::Null).await?;
        ensure!(ice.contains("Prepare for") && ice.contains("extended power outages."), "{ice}");
        Ok(())
    }));
    cases.push(case("upgrade_puts_the_watch_upg_line_over_the_warning", |tab| async move {
        open(&tab).await?;
        let text = build(&tab, "IS.W", "UPG", json!({ "upgrade": { "etn": 3, "start": null, "end": null } })).await?;
        let lines: Vec<&str> = text.split('\n').collect();
        let upg = lines.iter().position(|l| *l == "/O.UPG.KOAX.WS.A.0003.260115T1200Z-260116T1200Z/").context("no UPG line")?;
        ensure!(lines[upg + 1] == "/O.NEW.KOAX.IS.W.0001.260115T1200Z-260116T1200Z/", "{text}");
        ensure!(text.contains("...ICE STORM WARNING IN EFFECT FROM 6 AM THURSDAY"), "{text}");
        ensure!(!text.contains("NO LONGER IN EFFECT"), "{text}");
        let ec = build(&tab, "EC.W", "UPG", Value::Null).await?;
        ensure!(ec.contains("/O.UPG.KOAX.EC.A.0001."), "{ec}");
        Ok(())
    }));
    cases.push(case("followup_actions_use_the_warning_wording", |tab| async move {
        open(&tab).await?;
        let con = build(&tab, "HW.W", "CON", Value::Null).await?;
        ensure!(con.contains("/O.CON.KOAX.HW.W.0001.") && con.contains("...HIGH WIND WARNING REMAINS IN EFFECT FROM"), "{con}");
        let can = build(&tab, "BZ.W", "CAN", Value::Null).await?;
        ensure!(can.contains("...BLIZZARD WARNING IS CANCELLED...") && can.contains("has cancelled the\nBlizzard Warning."), "{can}");
        Ok(())
    }));
    cases.push(case("watch_wording_is_untouched", |tab| async move {
        open(&tab).await?;
        let text = build(&tab, "WS", "NEW", json!({ "sig": null })).await?;
        for needle in [
            "/O.NEW.KOAX.WS.A.0001.260115T1200Z-260116T1200Z/",
            "...WINTER STORM WATCH IN EFFECT FROM THURSDAY MORNING THROUGH",
            "* WHAT...Heavy snow possible. Total snow accumulations between 8 and",
            "A Winter Storm Watch means there is a potential for significant",
        ] {
            ensure!(text.contains(needle), "missing {needle:?} in\n{text}");
        }
        Ok(())
    }));
    for id in ["WS.W", "IS.W", "EC.W"] {
        cases.push(case(format!("panel_renders_warning_with_its_same_code[{id}]"), move |tab| async move {
            let (_, _, name, _, same, _) = warning(id);
            open(&tab).await?;
            let result = render_state(&tab, &format!("watch:{id}"), "NEW", Value::Null).await?;
            let (phen, sig) = id.split_once('.').unwrap();
            ensure!(result.raw.contains(&format!("/O.NEW.KOAX.{phen}.{sig}.0001.")), "{}", result.raw);
            ensure!(result.status.starts_with(&format!("Rendered {name}")), "{}", result.status);
            match same {
                Some(code) => ensure!(result.status.contains(&format!("SAME {code}]")), "{}", result.status),
                None => ensure!(!result.status.contains("SAME"), "{}", result.status),
            }
            ensure!(result.actions.iter().any(|a| a == "NEW=NEW -- new warning"), "{:?}", result.actions);
            ensure!(result.actions.iter().any(|a| a == "UPG=UPG -- upgrade watch to warning"), "{:?}", result.actions);
            Ok(())
        }));
    }
    cases.push(case("panel_upgrade_shows_the_watch_fields", |tab| async move {
        open(&tab).await?;
        let result = render_state(&tab, "watch:WS.W", "UPG", json!({ "upgEtn": "7" })).await?;
        ensure!(result.action == "UPG", "{}", result.action);
        ensure!(result.raw.contains("/O.UPG.KOAX.WS.A.0007."), "{}", result.raw);
        let hidden: Vec<bool> = tab
            .eval("['upgEtn', 'upgStart', 'upgEnd', 'snowLo', 'windChill'].map(id => document.getElementById('iw-' + id).closest('.civil-row').hidden)")
            .await?;
        ensure!(hidden == [false, false, false, false, true], "{hidden:?}");
        Ok(())
    }));
    cases.push(case("saved_watch_values_still_render_watches", |tab| async move {
        open(&tab).await?;
        let result = render_state(&tab, "watch:WS", "NEW", Value::Null).await?;
        ensure!(result.raw.contains("/O.NEW.KOAX.WS.A.0001."), "{}", result.raw);
        ensure!(result.status.starts_with("Rendered Winter Storm Watch") && result.status.contains("SAME WSA]"), "{}", result.status);
        ensure!(result.actions.iter().any(|a| a == "NEW=NEW -- new watch"), "{:?}", result.actions);
        ensure!(!result.actions.iter().any(|a| a.starts_with("UPG=")), "{:?}", result.actions);
        Ok(())
    }));
    cases
}
