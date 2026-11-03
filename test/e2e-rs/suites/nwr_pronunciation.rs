//! GH #158: per-office / per-transmitter VT Paul pronunciations, speed and pauses. The TTS
//! server is stubbed: the voice list (fetch) advertises Paul and, per test, the new
//! vtProsody fields; synthesis (XMLHttpRequest) records the posted form and answers with a
//! short WAV, so the tests read exactly what would reach the backend.

use eas_tools_e2e::*;

use crate::common::{generate, open_tool, open_tool_tracking_errors, set_field};

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
                stub(&tab, None).await?;
                encoder_with_paul(&tab, "Severe storms over Illinois.").await?;
                set_field(&tab, "#nwrPronSource", "wfo:LOT").await?;
                tab.wait_until(
                    "document.getElementById('nwrPronSummary').textContent.includes('speed 113')",
                    Duration::from_secs(15),
                )
                .await?;
                generate(&tab, "Paul with LOT").await?;
                let post = last_post(&tab).await?;
                ensure!(post["voice"] == "paul", "{post}");
                let text = post["text"].as_str().unwrap_or_default();
                ensure!(text.contains("Illynois"), "LOT respelling missing: {text}");
                ensure!(
                    !text.contains("vtml_speed"),
                    "speed went into markup although the server takes vtSpeed: {text}"
                );
                ensure!(
                    post["vtSpeed"] == "113"
                        && post["vtCommaPauseMs"] == "200"
                        && post["vtPeriodPauseMs"] == "900",
                    "{post}"
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
                stub(&tab, None).await?;
                encoder_with_paul(&tab, "Thunderstorms likely.").await?;
                generate(&tab, "Paul national").await?;
                let post = last_post(&tab).await?;
                let text = post["text"].as_str().unwrap_or_default();
                ensure!(
                    text.contains(
                        "ph=\"TH AH1 N D ER0 S T OW0 R M Z\">Thunderstorms</vtml_phoneme>"
                    ),
                    "{text}"
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
                    preview.contains(
                        "<vtml_phoneme alphabet=\"x-cmu\" ph=\"W IH1 N D S\">winds</vtml_phoneme>"
                    ),
                    "{preview}"
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
                ensure!(
                    sources["offices"].as_array().map_or(0, |a| a.len()) == 123,
                    "offices: {}",
                    sources["offices"]
                );
                ensure!(
                    sources["transmitters"].as_array().map_or(0, |a| a.len()) > 1000,
                    "too few transmitters"
                );
                tab.exec(
                "window.__bridgeHandlers['encoder:generate']({ originator: 'WXR', event: 'SVR', hours: 1, minutes: 0, sender: 'KLMK/NWS', attentionTone: 4,
                    announcementType: 'tts', ttsVoice: 'paul', ttsText: 'Severe weather', nwrPronunciation: { enabled: true, source: 'tx:WNG570' } });",
                json!([]),
            )
            .await?;
                let post = last_post(&tab).await?;
                ensure!(post["vtSpeed"] == "93", "{post}");
                ensure!(
                    post["text"] == "Severe weather",
                    "LMK has no Severe entry, so the word stays plain: {post}"
                );
                Ok(())
            },
        ),
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
                text.contains("an hour") && text.contains("ph=\"W AO1 K AH SH AO2\""),
                "{text}"
            );
            ensure!(post["vtSpeed"] == "114", "{post}");
            Ok(())
        }),
    ]
}
