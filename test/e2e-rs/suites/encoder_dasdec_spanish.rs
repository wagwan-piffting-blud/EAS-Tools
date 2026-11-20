//! DASDEC alert language: in DASDEC mode the Encoder can read the alert in Spanish after the English
//! message (or instead of it), worded by the eas-translate port of the DASDEC translator.

use eas_tools_e2e::*;

use crate::common::{generate, open_tool_tracking_errors, sample_count, set_field};

const HEADER: &str = "ZCZC-WXR-TOR-148113-048439+0045-3212315-KFWD/NWS-";

const STUB_TTS_JS: &str = r#"
window.__ttsPosts = [];
const realFetch = window.fetch.bind(window);
window.fetch = (input, opts) => {
    const url = String((input && input.url) || input);
    if (url.includes('voicelist=true')) {
        const body = { voices: { paul: '[VT] Current NWS Paul', 'VW Violeta': '[VT] NWS Violeta (Spanish)' } };
        return Promise.resolve(new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } }));
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

async fn open_encoder(tab: &Tab) -> Result<()> {
    tab.add_init_script(STUB_TTS_JS).await?;
    open_tool_tracking_errors(tab, "encoder").await?;
    tab.wait_until(
        "!!document.querySelector('#ttsVoice option[value=\"VW Violeta\"]') && !!document.getElementById('dasdecLanguageContainer')",
        Duration::from_secs(30),
    )
    .await
}

async fn prepare_alert(tab: &Tab, mode: &str, language: &str) -> Result<()> {
    set_field(tab, "#encoderMode", "header").await?;
    tab.wait_until(
        "getComputedStyle(document.getElementById('stringEncoder')).display !== 'none'",
        Duration::from_secs(30),
    )
    .await?;
    set_field(tab, "#att", "4").await?;
    set_field(tab, "#cheader", HEADER).await?;
    set_field(tab, "#overallEndecMode", mode).await?;
    set_field(tab, "#announcementType", "tts").await?;
    set_field(tab, "#ttsVoice", "paul").await?;
    tab.exec(
        "window.encoderEditor.setValue('English message.'); window.ttsText = 'English message.';",
        json!([]),
    )
    .await?;
    set_field(tab, "#dasdecLanguage", language).await?;
    set_field(tab, "#dasdecSpanishVoice", "VW Violeta").await
}

async fn spanish_text(tab: &Tab) -> Result<String> {
    let text: String = tab
        .js_async(
            "const done = arguments[arguments.length - 1];
             import('./assets/js/dasdec-translate.js').then((m) => done(m.translate(arguments[0], { lang: 'es', context: 'originated' }).text), (e) => done('ERROR ' + e));",
            json!([HEADER]),
        )
        .await?;
    ensure!(text.starts_with("El Servicio Meteorol"), "{text}");
    Ok(text)
}

async fn posts(tab: &Tab) -> Result<Vec<Value>> {
    tab.eval("window.__ttsPosts").await
}

pub fn cases() -> Vec<Case> {
    vec![
        case("language_select_follows_the_endec_mode", |tab| async move {
            open_encoder(&tab).await?;
            let hidden = |tab: Tab, id: &'static str| async move {
                tab.eval::<bool>(&format!("document.getElementById('{id}').hidden"))
                    .await
            };
            set_field(&tab, "#overallEndecMode", "DEFAULT").await?;
            ensure!(
                hidden(tab.clone(), "dasdecLanguageContainer").await?,
                "shown for DEFAULT"
            );
            set_field(&tab, "#overallEndecMode", "DASDEC").await?;
            ensure!(
                !hidden(tab.clone(), "dasdecLanguageContainer").await?,
                "hidden for DASDEC"
            );
            ensure!(
                hidden(tab.clone(), "dasdecSpanishVoiceRow").await?,
                "voice row shown for English"
            );
            set_field(&tab, "#dasdecLanguage", "en-es").await?;
            ensure!(
                !hidden(tab.clone(), "dasdecSpanishVoiceRow").await?,
                "voice row hidden for English, then Spanish"
            );
            let voices: Vec<String> = tab
                .eval("Array.from(document.getElementById('dasdecSpanishVoice').options).map((o) => o.value)")
                .await?;
            ensure!(
                voices.contains(&"espeak:es-419".to_string())
                    && voices.contains(&"VW Violeta".to_string())
                    && !voices.contains(&"paul".to_string()),
                "{voices:?}"
            );
            let picked: String = tab
                .eval("document.getElementById('dasdecSpanishVoice').value")
                .await?;
            ensure!(picked == "espeak:es-419", "default Spanish voice {picked}");
            Ok(())
        }),
        case(
            "english_then_spanish_reads_the_dasdec_wording",
            |tab| async move {
                open_encoder(&tab).await?;
                prepare_alert(&tab, "DASDEC", "en-es").await?;
                let expected = spanish_text(&tab).await?;
                generate(&tab, "DASDEC English then Spanish").await?;
                let posts = posts(&tab).await?;
                ensure!(posts.len() == 2, "{posts:?}");
                ensure!(
                    posts[0]["voice"] == "paul" && posts[0]["text"] == "English message.",
                    "{posts:?}"
                );
                ensure!(
                    posts[1]["voice"] == "VW Violeta" && posts[1]["text"] == expected.as_str(),
                    "expected {expected:?}: {posts:?}"
                );
                let status: String = tab
                    .eval("document.getElementById('status').innerText")
                    .await?;
                ensure!(
                    status.contains("Added the DASDEC Spanish part."),
                    "{status}"
                );
                Ok(())
            },
        ),
        case("spanish_only_skips_the_english_message", |tab| async move {
            open_encoder(&tab).await?;
            prepare_alert(&tab, "DASDEC", "es").await?;
            let expected = spanish_text(&tab).await?;
            generate(&tab, "DASDEC Spanish only").await?;
            let posts = posts(&tab).await?;
            ensure!(
                posts.len() == 1
                    && posts[0]["voice"] == "VW Violeta"
                    && posts[0]["text"] == expected.as_str(),
                "{posts:?}"
            );
            Ok(())
        }),
        case("other_endecs_ignore_the_language", |tab| async move {
            open_encoder(&tab).await?;
            prepare_alert(&tab, "DASDEC", "en-es").await?;
            set_field(&tab, "#overallEndecMode", "DEFAULT").await?;
            generate(&tab, "DEFAULT with a saved Spanish choice").await?;
            let posts = posts(&tab).await?;
            ensure!(posts.len() == 1 && posts[0]["voice"] == "paul", "{posts:?}");
            Ok(())
        }),
        case("espeak_spanish_voice_adds_audio", |tab| async move {
            open_encoder(&tab).await?;
            prepare_alert(&tab, "DASDEC", "en").await?;
            generate(&tab, "DASDEC English only").await?;
            let english = sample_count(&tab).await?;
            set_field(&tab, "#dasdecLanguage", "en-es").await?;
            set_field(&tab, "#dasdecSpanishVoice", "espeak:es-419").await?;
            generate(&tab, "DASDEC English then eSpeak Spanish").await?;
            let both = sample_count(&tab).await?;
            let status: String = tab
                .eval("document.getElementById('status').innerText")
                .await?;
            ensure!(
                status.contains("Added the DASDEC Spanish part."),
                "{status}"
            );
            ensure!(
                both > english + 48_000 * 3,
                "Spanish part too short: {english} -> {both} samples"
            );
            Ok(())
        }),
    ]
}
