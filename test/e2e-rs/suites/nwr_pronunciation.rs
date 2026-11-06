//! GH #158: per-office / per-transmitter VT Paul pronunciations, speed and pauses. The TTS
//! server is stubbed: the voice list (fetch) advertises Paul and, per test, the new
//! vtProsody fields; synthesis (XMLHttpRequest) records the posted form and answers with a
//! short WAV, so the tests read exactly what would reach the backend.

use eas_tools_e2e::*;

use crate::common::{generate, open_tool, open_tool_tracking_errors, set_field, shipped_json};

const STUB_TTS_JS: &str = r#"
window.__ttsPosts = [];
window.__pronPosts = [];
const features = window.__stubFeatures === undefined
    ? { vtProsody: { voices: ['paul'], fields: ['vtSpeed', 'vtCommaPauseMs', 'vtPeriodPauseMs'] }, pronunciation: { api: 1, submit: true } }
    : window.__stubFeatures;
const realFetch = window.fetch.bind(window);
window.fetch = (input, opts) => {
    const url = String((input && input.url) || input);
    if (url.includes('voicelist=true')) {
        const body = { voices: { paul: '[VT] Current NWS Paul', james: '[VT] James' } };
        if (features) body.features = features;
        return Promise.resolve(new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } }));
    }
    if (url.includes('pron=submit')) {
        window.__pronPosts.push(JSON.parse(new URLSearchParams(String(opts && opts.body)).get('payload')));
        return Promise.resolve(new Response(JSON.stringify({ ok: true, id: 'sub_test' + window.__pronPosts.length, status: 'pending', token: 'tok' }), { status: 202, headers: { 'Content-Type': 'application/json' } }));
    }
    if (url.includes('pron=')) return Promise.resolve(new Response('{"ok":false,"code":"closed"}', { status: 503 }));
    return realFetch(input, opts);
};
function stubWav() {
    const rate = 22050, frames = 4410;
    const buf = new ArrayBuffer(44 + frames * 2), v = new DataView(buf);
    const a = (o, t) => { for (let i = 0; i < t.length; i++) v.setUint8(o + i, t.charCodeAt(i)); };
    a(0, 'RIFF'); v.setUint32(4, 36 + frames * 2, true); a(8, 'WAVE'); a(12, 'fmt ');
    v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
    v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true);
    v.setUint16(34, 16, true); a(36, 'data'); v.setUint32(40, frames * 2, true);
    for (let i = 0; i < frames; i++) v.setInt16(44 + i * 2, Math.round(8000 * Math.sin(2 * Math.PI * 440 * i / rate)), true);
    return buf;
}
const open = XMLHttpRequest.prototype.open;
const send = XMLHttpRequest.prototype.send;
XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    this.__url = String(url);
    return open.call(this, method, url, ...rest);
};
XMLHttpRequest.prototype.send = function (body) {
    if (!this.__url.includes('eas-tts')) return send.call(this, body);
    window.__ttsPosts.push(Object.fromEntries(new URLSearchParams(String(body))));
    Object.defineProperty(this, 'status', { value: 200 });
    Object.defineProperty(this, 'response', { value: stubWav() });
    this.getResponseHeader = (name) => (/content-type/i.test(name) ? 'audio/wav' : null);
    setTimeout(() => this.onload && this.onload(), 0);
};
"#;

const VALID_HEADER: &str = "ZCZC-WXR-SVR-017031+0030-0010600-KLOT/NWS-";

const FAKE_BRIDGE_JS: &str = "
window.__bridgeHandlers = {};
window.__bridgeSent = [];
window.EASBridge = {
    on(name, fn) { window.__bridgeHandlers[name] = fn; },
    send(name, payload) { window.__bridgeSent.push([name, JSON.parse(JSON.stringify(payload))]); },
};
";

async fn stub(tab: &Tab, features: Option<&str>) -> Result<()> {
    if let Some(features) = features {
        tab.add_init_script(&format!("window.__stubFeatures = {features};"))
            .await?;
    }
    tab.add_init_script(STUB_TTS_JS).await
}

async fn encoder_with_paul(tab: &Tab, text: &str) -> Result<()> {
    open_tool_tracking_errors(tab, "encoder").await?;
    tab.wait_until(
        "!!document.querySelector('#ttsVoice option[value=\"paul\"]')",
        Duration::from_secs(30),
    )
    .await?;
    set_field(tab, "#encoderMode", "header").await?;
    tab.wait_until(
        "getComputedStyle(document.getElementById('stringEncoder')).display !== 'none'",
        Duration::from_secs(30),
    )
    .await?;
    set_field(tab, "#att", "4").await?;
    set_field(tab, "#cheader", VALID_HEADER).await?;
    set_field(tab, "#announcementType", "tts").await?;
    set_field(tab, "#ttsVoice", "paul").await?;
    tab.exec(
        "window.encoderEditor.setValue(arguments[0]); window.ttsText = arguments[0];",
        json!([text]),
    )
    .await?;
    tab.wait_until("!document.getElementById('nwrPron').hidden && !!document.querySelector('#nwrPronSource option[value=\"wfo:LOT\"]')", Duration::from_secs(30)).await
}

/// A set from the bundled snapshot. Expected values come from the data, not literals, so a
/// pronunciation import that changes an office's numbers does not break these tests.
fn shipped_set(id: &str) -> Result<Value> {
    shipped_json(&format!("assets/nwr-pronunciation/{id}.json"))
}

/// Calls a native-bridge handler and waits for what the engine sends back: the
/// `encoder:nwrEditorResult` (null for a plain request) and the newest `encoder:nwrEditor`
/// snapshot sent after the call.
const EDITOR_CALL_JS: &str = "
const done = arguments[arguments.length - 1];
const [name, params] = arguments;
const before = window.__bridgeSent.length;
const after = (channel) => window.__bridgeSent.slice(before).filter(([n]) => n === channel).map(([, p]) => p);
const wantsResult = name !== 'encoder:requestNwrEditor';
const alwaysResends = !['encoder:nwrEditorSave', 'encoder:nwrEditorTest', 'encoder:nwrEditorSubmit'].includes(name);
const deadline = Date.now() + 20000;
window.__bridgeHandlers[name](params);
(async () => {
    while (Date.now() < deadline) {
        const result = after('encoder:nwrEditorResult')[0] || null;
        const snapshots = after('encoder:nwrEditor');
        const resultIn = !wantsResult || result;
        const snapshotIn = name === 'encoder:nwrEditorTest' || snapshots.length > 0 || (result && !result.ok && !alwaysResends);
        if (resultIn && snapshotIn) return done([result, snapshots.at(-1) || null]);
        await new Promise((resolve) => setTimeout(resolve, 25));
    }
    done([after('encoder:nwrEditorResult')[0] || null, after('encoder:nwrEditor').at(-1) || null]);
})();";

async fn editor_call(tab: &Tab, name: &str, params: Value) -> Result<(Value, Value)> {
    let out: (Value, Value) = tab.js_async(EDITOR_CALL_JS, json!([name, params])).await?;
    ensure!(
        name == "encoder:requestNwrEditor" || !out.0.is_null(),
        "{name}: no result"
    );
    Ok(out)
}

/// A form field of the stubbed synthesis POST read as an integer.
fn posted_int(post: &Value, field: &str) -> Option<i64> {
    post[field].as_str()?.parse().ok()
}

/// The prosody value the most specific set defines, as `resolveProsody` picks it.
fn shipped_prosody(sets: &[&Value], field: &str) -> Option<i64> {
    sets.iter()
        .rev()
        .find_map(|set| set["prosody"][field]["value"].as_i64())
}

/// What the most specific set turns `word` into: the respelled text, or the phoneme string.
fn shipped_replacement(sets: &[&Value], word: &str) -> Result<String> {
    for set in sets.iter().rev() {
        let entries = set["entries"].as_array().into_iter().flatten();
        for entry in entries {
            if !entry["match"]
                .as_str()
                .is_some_and(|m| m.eq_ignore_ascii_case(word))
            {
                continue;
            }
            let replace = &entry["replace"];
            return match replace["kind"].as_str() {
                Some("respell") => Ok(replace["text"].as_str().unwrap_or_default().to_string()),
                Some("phoneme") => Ok(format!(
                    "ph=\"{}\"",
                    replace["ph"].as_str().unwrap_or_default()
                )),
                other => bail!("{word}: replacement kind {other:?} is not checked here"),
            };
        }
    }
    bail!("no shipped set has an entry for {word}")
}

async fn last_post(tab: &Tab) -> Result<Value> {
    tab.wait_until("window.__ttsPosts.length > 0", Duration::from_secs(30))
        .await?;
    tab.js(
        "return window.__ttsPosts[window.__ttsPosts.length - 1];",
        json!([]),
    )
    .await
}

pub fn cases() -> Vec<Case> {
    vec![
        case(
            "paul_gets_office_pronunciations_speed_and_pauses",
            |tab| async move {
                let (national, lot) = (shipped_set("national")?, shipped_set("wfo/LOT")?);
                let sets = [&national, &lot];
                let speed = shipped_prosody(&sets, "speed").context("LOT has no speed")?;
                let comma = shipped_prosody(&sets, "commaPauseMs").context("no comma pause")?;
                let period = shipped_prosody(&sets, "periodPauseMs").context("no period pause")?;
                let illinois = shipped_replacement(&sets, "Illinois")?;
                stub(&tab, None).await?;
                encoder_with_paul(&tab, "Severe storms over Illinois.").await?;
                set_field(&tab, "#nwrPronSource", "wfo:LOT").await?;
                tab.wait_until(
                    &format!(
                        "document.getElementById('nwrPronSummary').textContent.includes('speed {speed}')"
                    ),
                    Duration::from_secs(15),
                )
                .await?;
                generate(&tab, "Paul with LOT").await?;
                let post = last_post(&tab).await?;
                ensure!(post["voice"] == "paul", "{post}");
                let text = post["text"].as_str().unwrap_or_default();
                ensure!(
                    text.contains(&illinois),
                    "LOT pronunciation of Illinois ({illinois}) missing: {text}"
                );
                ensure!(
                    !text.contains("vtml_speed"),
                    "speed went into markup although the server takes vtSpeed: {text}"
                );
                ensure!(
                    posted_int(&post, "vtSpeed") == Some(speed)
                        && posted_int(&post, "vtCommaPauseMs") == Some(comma)
                        && posted_int(&post, "vtPeriodPauseMs") == Some(period),
                    "expected speed {speed}, comma {comma}, period {period}: {post}"
                );
                let status: String = tab
                    .eval("document.getElementById('status').innerText")
                    .await?;
                ensure!(status.contains("NWR pronunciations: LOT"), "{status}");
                Ok(())
            },
        ),
        case(
            "national_only_is_on_by_default_and_sends_no_pauses",
            |tab| async move {
                let national = shipped_set("national")?;
                let thunderstorms = shipped_replacement(&[&national], "Thunderstorms")?;
                stub(&tab, None).await?;
                encoder_with_paul(&tab, "Thunderstorms likely.").await?;
                generate(&tab, "Paul national").await?;
                let post = last_post(&tab).await?;
                let text = post["text"].as_str().unwrap_or_default();
                ensure!(
                    text.contains(&format!("{thunderstorms}>Thunderstorms</vtml_phoneme>")),
                    "expected {thunderstorms}: {text}"
                );
                ensure!(
                    post.get("vtSpeed").is_none() && post.get("vtCommaPauseMs").is_none(),
                    "{post}"
                );
                Ok(())
            },
        ),
        case(
            "turning_overrides_off_sends_the_text_as_written",
            |tab| async move {
                stub(&tab, None).await?;
                encoder_with_paul(&tab, "Severe storms over Illinois.").await?;
                set_field(&tab, "#nwrPronSource", "wfo:LOT").await?;
                tab.exec("const c = document.getElementById('nwrPronEnabled'); c.checked = false; c.dispatchEvent(new Event('change'));", json!([])).await?;
                tab.wait_until(
                    "document.getElementById('nwrPronSummary').textContent.startsWith('Off')",
                    Duration::from_secs(15),
                )
                .await?;
                generate(&tab, "Paul off").await?;
                let post = last_post(&tab).await?;
                ensure!(post["text"] == "Severe storms over Illinois.", "{post}");
                ensure!(post.get("vtSpeed").is_none(), "{post}");
                Ok(())
            },
        ),
        case(
            "an_older_server_gets_speed_markup_and_no_new_fields",
            |tab| async move {
                stub(&tab, Some("null")).await?;
                encoder_with_paul(&tab, "Illinois").await?;
                set_field(&tab, "#nwrPronSource", "wfo:LOT").await?;
                tab.wait_until("document.getElementById('nwrPronSummary').textContent.includes('cannot set office speed or pauses')", Duration::from_secs(15)).await?;
                generate(&tab, "old server").await?;
                let post = last_post(&tab).await?;
                ensure!(
                    post["text"] == "<vtml_speed value=\"113\">Illynois</vtml_speed>",
                    "{post}"
                );
                ensure!(
                    post.get("vtSpeed").is_none() && post.get("vtPeriodPauseMs").is_none(),
                    "{post}"
                );
                Ok(())
            },
        ),
        case(
            "other_voices_hide_the_picker_and_are_untouched",
            |tab| async move {
                stub(&tab, None).await?;
                encoder_with_paul(&tab, "Thunderstorms over Illinois.").await?;
                set_field(&tab, "#nwrPronSource", "wfo:LOT").await?;
                set_field(&tab, "#ttsVoice", "james").await?;
                tab.wait_until(
                    "document.getElementById('nwrPron').hidden",
                    Duration::from_secs(15),
                )
                .await?;
                generate(&tab, "James").await?;
                let post = last_post(&tab).await?;
                ensure!(
                    post["voice"] == "james" && post["text"] == "Thunderstorms over Illinois.",
                    "{post}"
                );
                ensure!(post.get("vtSpeed").is_none(), "{post}");
                Ok(())
            },
        ),
        case(
            "preview_and_personal_pronunciations_win",
            |tab| async move {
                let (national, lot) = (shipped_set("national")?, shipped_set("wfo/LOT")?);
                let winds = shipped_replacement(&[&national, &lot], "winds")?;
                stub(&tab, None).await?;
                encoder_with_paul(&tab, "Calm winds near Waukesha.").await?;
                set_field(&tab, "#nwrPronSource", "tx:KEC76").await?;
                tab.wait_until(
                    "document.getElementById('nwrPronSummary').textContent.startsWith('KEC76')",
                    Duration::from_secs(15),
                )
                .await?;
                tab.exec("document.getElementById('nwrPronEdit').click();", json!([]))
                    .await?;
                tab.wait_until(
                    "!!document.querySelector('dialog.nwr-pron-editor[open]')",
                    Duration::from_secs(15),
                )
                .await?;
                axe::assert_clean(
                    &tab,
                    json!("dialog.nwr-pron-editor"),
                    &[],
                    "pronunciation editor",
                )
                .await?;
                set_field(&tab, "#nwrPronMatch", "Calm").await?;
                set_field(&tab, "#nwrPronKind", "respell").await?;
                set_field(&tab, "#nwrPronValue", "Kahm").await?;
                tab.exec("[...document.querySelectorAll('dialog.nwr-pron-editor button')].find((b) => b.textContent === 'Save pronunciation').click();", json!([])).await?;
                tab.wait_until("document.querySelector('.nwr-pron-editor__status').textContent.includes('Saved \"Calm\"')", Duration::from_secs(15)).await?;
                set_field(&tab, "#nwrPronMatch", "QQ").await?;
                set_field(&tab, "#nwrPronKind", "phoneme").await?;
                set_field(&tab, "#nwrPronValue", "AR2").await?;
                tab.exec("[...document.querySelectorAll('dialog.nwr-pron-editor button')].find((b) => b.textContent === 'Save pronunciation').click();", json!([])).await?;
                let error: String = tab
                    .eval("document.querySelector('.nwr-pron-editor [role=alert]').textContent")
                    .await?;
                ensure!(error == "unknown phone AR2", "{error}");
                tab.exec("[...document.querySelectorAll('dialog.nwr-pron-editor button')].find((b) => b.textContent === 'Close').click();", json!([])).await?;
                tab.exec(
                    "document.getElementById('nwrPronPreview').click();",
                    json!([]),
                )
                .await?;
                tab.wait_until(
                    "!document.getElementById('nwrPronPreviewOut').hidden",
                    Duration::from_secs(15),
                )
                .await?;
                let preview: String = tab
                    .eval("document.getElementById('nwrPronPreviewOut').textContent")
                    .await?;
                ensure!(preview.starts_with("Kahm "), "{preview}");
                ensure!(
                    preview.contains(&format!(
                        "<vtml_phoneme alphabet=\"x-cmu\" {winds}>winds</vtml_phoneme>"
                    )),
                    "expected {winds}: {preview}"
                );
                axe::assert_clean(&tab, json!("#nwrPron"), &[], "pronunciation picker").await?;
                Ok(())
            },
        ),
        case("editor_closes_on_a_click_outside_only", |tab| async move {
            stub(&tab, None).await?;
            encoder_with_paul(&tab, "Calm winds.").await?;
            tab.exec("document.getElementById('nwrPronEdit').click();", json!([]))
                .await?;
            tab.wait_until(
                "!!document.querySelector('dialog.nwr-pron-editor[open]')",
                Duration::from_secs(15),
            )
            .await?;
            tab.click("#nwrPronEditorTitle").await?;
            tab.click("#nwrPronMatch").await?;
            ensure!(
                tab.eval::<bool>("!!document.querySelector('dialog.nwr-pron-editor[open]')")
                    .await?,
                "a click inside the editor closed it"
            );
            let y: f64 = tab.eval("window.innerHeight / 2").await?;
            tab.click_at(3.0, y).await?;
            tab.wait_until(
                "!document.querySelector('dialog.nwr-pron-editor')",
                Duration::from_secs(5),
            )
            .await?;
            let focused: String = tab
                .eval("document.activeElement ? document.activeElement.id : ''")
                .await?;
            ensure!(
                focused == "nwrPronEdit",
                "focus did not return to the button: {focused}"
            );
            Ok(())
        }),
        case(
            "submissions_are_anonymous_and_grouped_by_action",
            |tab| async move {
                stub(&tab, None).await?;
                encoder_with_paul(&tab, "Calm").await?;
                set_field(&tab, "#nwrPronSource", "wfo:FFC").await?;
                tab.wait_until(
                    "document.getElementById('nwrPronSummary').textContent.startsWith('FFC')",
                    Duration::from_secs(15),
                )
                .await?;
                tab.exec("document.getElementById('nwrPronEdit').click();", json!([]))
                    .await?;
                tab.wait_until(
                    "!!document.querySelector('dialog.nwr-pron-editor[open]')",
                    Duration::from_secs(15),
                )
                .await?;
                for (word, value) in [("Calm", "Kahm"), ("Peachtree", "Peech tree")] {
                    set_field(&tab, "#nwrPronMatch", word).await?;
                    set_field(&tab, "#nwrPronKind", "respell").await?;
                    set_field(&tab, "#nwrPronValue", value).await?;
                    tab.exec("[...document.querySelectorAll('dialog.nwr-pron-editor button')].find((b) => b.textContent === 'Save pronunciation').click();", json!([])).await?;
                }
                tab.exec(
                "document.querySelectorAll('.nwr-pron-editor__choices input[type=checkbox]').forEach((b) => { b.checked = true; });
                 document.getElementById('nwrPronSpeed').value = '104';
                 document.getElementById('nwrPronSubmitNotes').value = 'Heard on WXK56';
                 [...document.querySelectorAll('dialog.nwr-pron-editor button')].find((b) => b.textContent === 'Send for review').click();",
                json!([]),
            )
            .await?;
                tab.wait_until("window.__pronPosts.length === 3", Duration::from_secs(15))
                    .await?;
                let posts: Value = tab.eval("window.__pronPosts").await?;
                let actions: Vec<&str> = posts
                    .as_array()
                    .unwrap()
                    .iter()
                    .map(|p| p["action"].as_str().unwrap_or(""))
                    .collect();
                ensure!(actions == ["add", "change", "prosody"], "{posts}");
                for post in posts.as_array().unwrap() {
                    ensure!(
                        post["target"] == "wfo/FFC" && post.get("contributor").is_none(),
                        "{post}"
                    );
                }
                ensure!(
                    posts[1]["entries"][0]["id"] == "calm"
                        && posts[2]["prosody"]["speed"]["value"] == 104,
                    "{posts}"
                );
                let stored: i64 = tab
                    .eval(
                        "JSON.parse(localStorage.getItem('eas-tools-nwr-pron-submissions')).length",
                    )
                    .await?;
                ensure!(stored == 3, "{stored}");
                Ok(())
            },
        ),
        case(
            "native_bridge_selection_and_source_list",
            |tab| async move {
                tab.add_init_script(FAKE_BRIDGE_JS).await?;
                stub(&tab, None).await?;
                open_tool(&tab, "encoder").await?;
                tab.wait_until("!!(window.__bridgeHandlers['encoder:requestNwrSources'] && document.querySelector('#ttsVoice option[value=\"paul\"]'))", Duration::from_secs(30)).await?;
                tab.exec(
                    "window.__bridgeHandlers['encoder:requestNwrSources']();",
                    json!([]),
                )
                .await?;
                tab.wait_until(
                    "window.__bridgeSent.some(([n]) => n === 'encoder:nwrSources')",
                    Duration::from_secs(15),
                )
                .await?;
                let sources: Value = tab
                    .js(
                        "return window.__bridgeSent.find(([n]) => n === 'encoder:nwrSources')[1];",
                        json!([]),
                    )
                    .await?;
                let registry = shipped_json("assets/nwr-pronunciation/transmitters.json")?;
                let count = |v: &Value| v.as_object().map_or(0, |o| o.len());
                ensure!(
                    sources["offices"].as_array().map_or(0, |a| a.len())
                        == count(&registry["offices"]),
                    "offices: {}",
                    sources["offices"]
                );
                ensure!(
                    sources["transmitters"].as_array().map_or(0, |a| a.len())
                        == count(&registry["transmitters"]),
                    "transmitters differ from transmitters.json"
                );
                let (national, lmk, wng570) = (
                    shipped_set("national")?,
                    shipped_set("wfo/LMK")?,
                    shipped_set("tx/WNG570")?,
                );
                let speed = shipped_prosody(&[&national, &lmk, &wng570], "speed")
                    .context("WNG570 and LMK have no speed")?;
                tab.exec(
                "window.__bridgeHandlers['encoder:generate']({ originator: 'WXR', event: 'SVR', hours: 1, minutes: 0, sender: 'KLMK/NWS', attentionTone: 4,
                    announcementType: 'tts', ttsVoice: 'paul', ttsText: 'Severe weather', nwrPronunciation: { enabled: true, source: 'tx:WNG570' } });",
                json!([]),
            )
            .await?;
                let post = last_post(&tab).await?;
                ensure!(
                    posted_int(&post, "vtSpeed") == Some(speed),
                    "expected WNG570's speed {speed}: {post}"
                );
                Ok(())
            },
        ),
        case("native_bridge_editor_saves_and_submits", |tab| async move {
            tab.add_init_script(FAKE_BRIDGE_JS).await?;
            stub(&tab, None).await?;
            open_tool(&tab, "encoder").await?;
            tab.wait_until("!!(window.__bridgeHandlers['encoder:requestNwrEditor'] && document.querySelector('#ttsVoice option[value=\"paul\"]'))", Duration::from_secs(30)).await?;
            tab.exec(
                "window.__bridgeHandlers['encoder:setNwrPronunciation']({ enabled: true, source: 'tx:WNG570' });",
                json!([]),
            )
            .await?;

            let snapshot = editor_call(&tab, "encoder:requestNwrEditor", json!({ "query": "" }))
                .await?
                .1;
            let ids = |key: &str| -> Vec<String> {
                snapshot[key]
                    .as_array()
                    .into_iter()
                    .flatten()
                    .filter_map(|o| o["id"].as_str().map(String::from))
                    .collect()
            };
            ensure!(
                ids("scopes") == ["all", "wfo:LMK", "tx:WNG570"],
                "{snapshot}"
            );
            ensure!(
                ids("targets") == ["national", "wfo/LMK", "tx/WNG570"],
                "{snapshot}"
            );
            ensure!(snapshot["canSubmit"] == true, "{snapshot}");
            let first_shared = snapshot["shared"][0]["key"]
                .as_str()
                .unwrap_or_default()
                .to_string();
            ensure!(!first_shared.is_empty(), "no shared entries: {snapshot}");

            let (bad, _) = editor_call(
                &tab,
                "encoder:nwrEditorSave",
                json!({ "match": "QQ", "kind": "phoneme", "value": "AR2", "scope": "all" }),
            )
            .await?;
            ensure!(
                bad["ok"] == false && bad["error"] == "unknown phone AR2",
                "{bad}"
            );

            let (saved, snapshot) = editor_call(&tab, "encoder:nwrEditorSave", json!({ "match": "Calm", "kind": "respell", "value": "Kahm", "scope": "tx:WNG570" })).await?;
            ensure!(
                saved["ok"] == true && saved["message"] == "Saved \"Calm\" for WNG570 transmitter.",
                "{saved}"
            );
            ensure!(
                snapshot["personal"].as_array().is_some_and(|p| p
                    .iter()
                    .any(|e| e["match"] == "Calm" && e["text"] == "Kahm")),
                "{snapshot}"
            );

            let (off, _) = editor_call(
                &tab,
                "encoder:nwrEditorTurnOff",
                json!({ "key": first_shared, "scope": "tx:WNG570" }),
            )
            .await?;
            ensure!(
                off["ok"] == true
                    && off["message"]
                        .as_str()
                        .is_some_and(|m| m.starts_with("Turned off ")),
                "{off}"
            );

            let (sent, snapshot) = editor_call(&tab, "encoder:nwrEditorSubmit", json!({
                "target": "tx/WNG570", "entries": [{ "id": "calm", "scope": "tx:WNG570" }], "speed": "95", "comma": "", "period": "", "notes": "Heard it on WNG570", "links": "",
            })).await?;
            ensure!(
                sent["ok"] == true
                    && sent["message"] == "Sent 2 submissions for review. Thank you.",
                "{sent}"
            );
            let posts: Value = tab.eval("window.__pronPosts").await?;
            let actions: Vec<&str> = posts
                .as_array()
                .into_iter()
                .flatten()
                .filter_map(|p| p["action"].as_str())
                .collect();
            ensure!(actions == ["add", "prosody"], "{posts}");
            ensure!(
                posts[0]["client"]["app"] != "web" && posts[0]["target"] == "tx/WNG570",
                "{posts}"
            );
            ensure!(
                snapshot["submissions"].as_array().map_or(0, |s| s.len()) == 2,
                "{snapshot}"
            );

            let (none, _) = editor_call(
                &tab,
                "encoder:nwrEditorSubmit",
                json!({ "target": "tx/WNG570", "entries": [] }),
            )
            .await?;
            ensure!(
                none["ok"] == false
                    && none["error"]
                        == "Choose at least one pronunciation, or fill in speed or pauses.",
                "{none}"
            );

            let posts_before: usize = tab.eval("window.__ttsPosts.length").await?;
            let (tested, _) = editor_call(
                &tab,
                "encoder:nwrEditorTest",
                json!({ "match": "Calm", "kind": "respell", "value": "Kahm" }),
            )
            .await?;
            ensure!(tested["ok"] == true, "{tested}");
            let test_post = last_post(&tab).await?;
            let posts_after: usize = tab.eval("window.__ttsPosts.length").await?;
            ensure!(
                posts_after == posts_before + 1
                    && test_post["pronTest"] == "1"
                    && test_post["text"] == "Kahm",
                "a pronunciation test must carry pronTest=1 so the server does not count it: {test_post}"
            );

            tab.exec(
                "window.__bridgeHandlers['encoder:nwrEditorExport']();",
                json!([]),
            )
            .await?;
            tab.wait_until(
                "window.__bridgeSent.some(([n]) => n === 'encoder:nwrEditorExportData')",
                Duration::from_secs(15),
            )
            .await?;
            let exported: Value = tab
                .js(
                    "return window.__bridgeSent.filter(([n]) => n === 'encoder:nwrEditorExportData').at(-1)[1];",
                    json!([]),
                )
                .await?;
            ensure!(
                exported["fileName"] == "eas-tools-pronunciations.json" && exported["count"] == 2,
                "{exported}"
            );
            let exported_text = exported["text"].as_str().unwrap_or_default().to_string();

            let (removed, snapshot) = editor_call(
                &tab,
                "encoder:nwrEditorRemove",
                json!({ "id": "calm", "scope": "tx:WNG570" }),
            )
            .await?;
            ensure!(
                removed["ok"] == true && removed["message"] == "Removed \"Calm\".",
                "{removed}"
            );
            ensure!(
                !snapshot["personal"]
                    .as_array()
                    .is_some_and(|p| p.iter().any(|e| e["match"] == "Calm")),
                "{snapshot}"
            );

            let (imported, snapshot) = editor_call(
                &tab,
                "encoder:nwrEditorImport",
                json!({ "text": exported_text }),
            )
            .await?;
            ensure!(
                imported["ok"] == true && imported["message"] == "Imported 2 pronunciations.",
                "{imported}"
            );
            ensure!(
                snapshot["personal"]
                    .as_array()
                    .is_some_and(|p| p.iter().any(|e| e["match"] == "Calm")),
                "{snapshot}"
            );
            let (broken, _) = editor_call(
                &tab,
                "encoder:nwrEditorImport",
                json!({ "text": "{not json" }),
            )
            .await?;
            ensure!(
                broken["ok"] == false && broken["error"] == "That file is not valid JSON.",
                "{broken}"
            );
            Ok(())
        }),
        case(
            "handoffs_from_an_office_switch_the_picker",
            |tab| async move {
                stub(&tab, None).await?;
                encoder_with_paul(&tab, "x").await?;
                tab.exec("import('./assets/js/handoff.js').then((h) => h.handIn('encoder', { text: 'Illinois', office: 'IND' }));", json!([])).await?;
                tab.wait_until("JSON.parse(localStorage.getItem('eas-tools-nwr-pron-selection') || '{}').source === 'wfo:IND'", Duration::from_secs(15)).await?;
                tab.wait_until("document.getElementById('nwrPronSummary').textContent.includes('Switched to IND')", Duration::from_secs(15)).await?;
                Ok(())
            },
        ),
        case("splicer_generate_uses_the_selection", |tab| async move {
            let (national, mkx) = (shipped_set("national")?, shipped_set("wfo/MKX")?);
            let sets = [&national, &mkx];
            let speed = shipped_prosody(&sets, "speed").context("MKX has no speed")?;
            let waukesha = shipped_replacement(&sets, "Waukesha")?;
            stub(&tab, None).await?;
            open_tool_tracking_errors(&tab, "splicer").await?;
            tab.wait_until(
                "!!document.querySelector('#ttsVoice2 option[value=\"paul\"]')",
                Duration::from_secs(30),
            )
            .await?;
            set_field(&tab, "#ttsVoice2", "paul").await?;
            tab.wait_until("!document.getElementById('nwrPron2').hidden && !!document.querySelector('#nwrPronSource2 option[value=\"wfo:MKX\"]')", Duration::from_secs(30)).await?;
            set_field(&tab, "#nwrPronSource2", "wfo:MKX").await?;
            tab.exec("if (window.splicerEditor) window.splicerEditor.setValue('Winds 20 miles per hour near Waukesha'); else document.getElementById('ttsText2').value = 'Winds 20 miles per hour near Waukesha';", json!([])).await?;
            tab.click("button[data-splice-tts-generate]").await?;
            let post = last_post(&tab).await?;
            let text = post["text"].as_str().unwrap_or_default();
            ensure!(
                text.contains("an hour") && text.contains(&waukesha),
                "expected {waukesha} for Waukesha: {text}"
            );
            ensure!(
                posted_int(&post, "vtSpeed") == Some(speed),
                "expected speed {speed}: {post}"
            );
            Ok(())
        }),
    ]
}
