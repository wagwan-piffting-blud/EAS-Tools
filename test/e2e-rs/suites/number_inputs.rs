//! The rate/pitch slider + number pairs, and the wheel guard on number inputs.
//!
//! A focused <input type="number"> increments or decrements on a mouse wheel tick in every
//! major browser. On a long panel that is scrolled through while editing, a value silently
//! walks off by one per notch, which reads as the field "snapping" to a different number.

use eas_tools_e2e::*;

use crate::common::{field_value, wait_for_tool};

const CONTROLS: [(&str, &str, &str, &str); 4] = [
    ("encoder", "ttsRate", "ttsRateNumber", "ttsRateReset"),
    ("encoder", "ttsPitch", "ttsPitchNumber", "ttsPitchReset"),
    ("splicer", "ttsRate2", "ttsRate2Number", "ttsRateReset2"),
    ("splicer", "ttsPitch2", "ttsPitch2Number", "ttsPitchReset2"),
];

const WHEEL_CASES: [(&str, &str, &str); 12] = [
    ("crawl", "crawlSpeed", "5"),
    ("crawl", "crawlFontSize", "24"),
    ("crawl", "crawlWidth", "800"),
    ("crawl", "crawlHeight", "200"),
    ("crawl", "crawlInset", "5"),
    ("crawl", "crawlKerning", "5"),
    ("crawl", "crawlTextWidth", "100"),
    ("crawl", "crawlRepetitions", "5"),
    ("crawl", "crawlOutlineWidth", "5"),
    ("crawl", "vdsFrameDelay", "30"),
    ("encoder", "tlen", "10"),
    ("encoder", "silencePreTone", "1000"),
];

async fn open(tab: &Tab, tool: &str) -> Result<()> {
    tab.goto(&format!("index.html?tool={tool}")).await?;
    wait_for_tool(tab, tool).await
}

/// The pair stays hidden for backends that cannot act on it, so an eSpeak voice reveals it.
async fn open_with_rate_pitch_visible(tab: &Tab, tool: &str) -> Result<()> {
    open(tab, tool).await?;
    if tool == "encoder" {
        tab.exec(
            "const type = document.getElementById('announcementType'); type.value = 'tts'; type.dispatchEvent(new Event('change', { bubbles: true }));",
            json!([]),
        )
        .await?;
    }
    let select = if tool == "encoder" { "ttsVoice" } else { "ttsVoice2" };
    tab.exec(
        "const s = document.getElementById(arguments[0]); s.value = 'espeak:en-us'; s.dispatchEvent(new Event('change', { bubbles: true }));",
        json!([select]),
    )
    .await
}

async fn values(tab: &Tab, slider: &str, number: &str) -> Result<(String, String)> {
    tab.js("return [document.getElementById(arguments[0]).value, document.getElementById(arguments[1]).value];", json!([slider, number]))
        .await
}

async fn set_slider(tab: &Tab, slider: &str, value: &str) -> Result<()> {
    tab.exec(
        "const s = document.getElementById(arguments[0]); s.value = arguments[1]; s.dispatchEvent(new Event('input', { bubbles: true }));",
        json!([slider, value]),
    )
    .await
}

async fn type_and_commit(tab: &Tab, number: &str, text: &str) -> Result<()> {
    tab.wait_until(&format!("(() => {{ const n = document.getElementById({}); return !!n && n.offsetParent !== null && !n.disabled; }})()", json!(number)), Duration::from_secs(15))
        .await?;
    tab.replace_text(&format!("#{number}"), text).await?;
    tab.press("Tab", &[]).await
}

fn pair(v: &str) -> (String, String) {
    (v.to_string(), v.to_string())
}

pub fn cases() -> Vec<Case> {
    let mut cases = vec![case("wheel_guard_leaves_other_inputs_alone", |tab| async move {
        open(&tab, "encoder").await?;
        tab.click("#par").await?;
        ensure!(tab.active_id().await? == "par");
        tab.wheel("#par", -120.0).await?;
        let active = tab.active_id().await?;
        ensure!(active == "par", "wheel blurred a non-number field (active is now {active:?})");
        Ok(())
    })];
    for (tool, slider, number, reset) in CONTROLS {
        let id = format!("{tool}-{slider}");
        cases.push(case(format!("number_input_exists_and_is_labelled[{id}]"), move |tab| async move {
            open_with_rate_pitch_visible(&tab, tool).await?;
            let info: Value = tab
                .js(
                    "const number = document.getElementById(arguments[0]);
                     if (!number) return null;
                     const label = document.querySelector(`label[for=\"${arguments[0]}\"]`);
                     return { type: number.type, min: number.min, max: number.max, step: number.step,
                              inputmode: number.getAttribute('inputmode'),
                              labelText: label ? label.textContent.trim() : null,
                              labelHidden: label ? label.classList.contains('visually-hidden') : null };",
                    json!([number]),
                )
                .await?;
            ensure!(!info.is_null(), "{number} is missing");
            ensure!(info["type"] == "number" && info["min"] == "-10" && info["max"] == "10" && info["step"] == "1", "{info}");
            ensure!(info["labelText"].as_str().is_some_and(|t| !t.is_empty()), "{number} has no associated label");
            ensure!(info["labelHidden"] == true, "{info}");
            ensure!(info["inputmode"].is_null(), "inputmode=numeric hides the minus key on iOS");
            Ok(())
        }));
        cases.push(case(format!("slider_and_number_stay_in_sync[{id}]"), move |tab| async move {
            open_with_rate_pitch_visible(&tab, tool).await?;
            ensure!(values(&tab, slider, number).await? == pair("0"));
            set_slider(&tab, slider, "7").await?;
            ensure!(values(&tab, slider, number).await? == pair("7"));
            Ok(())
        }));
        cases.push(case(format!("typing_into_number_drives_the_slider[{id}]"), move |tab| async move {
            open_with_rate_pitch_visible(&tab, tool).await?;
            type_and_commit(&tab, number, "-4").await?;
            ensure!(values(&tab, slider, number).await? == pair("-4"), "{:?}", values(&tab, slider, number).await?);
            type_and_commit(&tab, number, "9").await?;
            ensure!(values(&tab, slider, number).await? == pair("9"), "{:?}", values(&tab, slider, number).await?);
            Ok(())
        }));
        cases.push(case(format!("out_of_range_and_empty_values_are_normalised[{id}]"), move |tab| async move {
            open_with_rate_pitch_visible(&tab, tool).await?;
            type_and_commit(&tab, number, "250").await?;
            ensure!(values(&tab, slider, number).await? == pair("10"), "above-max value was not clamped");
            type_and_commit(&tab, number, "-250").await?;
            ensure!(values(&tab, slider, number).await? == pair("-10"), "below-min value was not clamped");
            type_and_commit(&tab, number, "").await?;
            ensure!(values(&tab, slider, number).await? == pair("0"), "cleared field did not fall back to the default");
            Ok(())
        }));
        cases.push(case(format!("reset_button_clears_both_controls[{id}]"), move |tab| async move {
            open_with_rate_pitch_visible(&tab, tool).await?;
            set_slider(&tab, slider, "-8").await?;
            ensure!(values(&tab, slider, number).await? == pair("-8"));
            tab.click(&format!("#{reset}")).await?;
            ensure!(values(&tab, slider, number).await? == pair("0"));
            Ok(())
        }));
    }
    for (tool, field, value) in WHEEL_CASES {
        cases.push(case(format!("wheel_does_not_change_a_focused_number_input[{tool}-{field}]"), move |tab| async move {
            open(&tab, tool).await?;
            if tool == "encoder" {
                tab.exec(
                    "const type = document.getElementById('announcementType');
                     if (type) { type.value = 'tts'; type.dispatchEvent(new Event('change', { bubbles: true })); }
                     const att = document.getElementById('att');
                     if (att) { att.value = '0'; att.dispatchEvent(new Event('change', { bubbles: true })); }",
                    json!([]),
                )
                .await?;
            }
            let selector = format!("#{field}");
            tab.wait_until(&format!("(() => {{ const e = document.getElementById({}); return !!e && e.offsetParent !== null; }})()", json!(field)), Duration::from_secs(15))
                .await?;
            tab.replace_text(&selector, value).await?;
            ensure!(field_value(&tab, field).await? == value, "typing produced {}", field_value(&tab, field).await?);
            tab.wheel(&selector, -120.0).await?;
            ensure!(field_value(&tab, field).await? == value, "wheel up changed the value");
            tab.click(&selector).await?;
            tab.replace_text(&selector, value).await?;
            tab.wheel(&selector, 120.0).await?;
            ensure!(field_value(&tab, field).await? == value, "wheel down changed the value");
            Ok(())
        }));
    }
    cases
}
