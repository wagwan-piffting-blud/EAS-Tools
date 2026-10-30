//! The bundled eSpeak NG voices: listed in both TTS pickers and rendered by the worker.

use eas_tools_e2e::*;

use crate::common::open_tool;

const EXPECTED_VOICE_VALUES: [&str; 9] = [
    "espeak:en-us",
    "espeak:en-us+m3",
    "espeak:en-us+f2",
    "espeak:en-us+whisper",
    "espeak:en-us+croak",
    "espeak:en-us+klatt",
    "espeak:en",
    "espeak:es-419",
    "espeak:fr",
];

const ANNOUNCEMENT: &str = "The National Weather Service in Louisville has issued a Tornado Warning \
                            for Jefferson County until nine fifteen PM Eastern Daylight Time.";

const SYNTH_JS: &str = r#"
const done = arguments[arguments.length - 1];
const jobs = arguments[0];
const text = arguments[1];

const worker = new Worker('assets/js/espeak-worker.js');
const results = [];
const log = [];
let index = 0;
let settled = false;

const finish = (payload) => {
    if (settled) return;
    settled = true;
    worker.terminate();
    done(payload);
};

const next = () => {
    if (index >= jobs.length) {
        finish({ ok: true, results, log });
        return;
    }
    const job = jobs[index++];
    worker.postMessage({ type: 'synth', text, voice: job.voice, rate: job.rate, pitch: job.pitch });
};

worker.onmessage = (event) => {
    const data = event.data || {};
    if (data.type === 'ready') { next(); return; }
    if (data.type === 'progress' && data.data) { log.push(data.data); return; }
    if (data.type === 'audio') {
        const pcm = new Float32Array(data.pcm);
        let peak = 0;
        let loud = 0;
        for (let i = 0; i < pcm.length; i++) {
            const a = Math.abs(pcm[i]);
            if (a > peak) peak = a;
            if (a > 0.002) loud++;
        }
        results.push({ samples: pcm.length, sampleRate: data.sampleRate, peak, loudFraction: pcm.length ? loud / pcm.length : 0 });
        next();
        return;
    }
    if (data.type === 'synth-error' || data.type === 'fatal') {
        finish({ ok: false, error: data.error, stage: data.type, log });
    }
};

worker.onerror = (event) => finish({ ok: false, error: event.message || 'worker error', stage: 'onerror', log });

setTimeout(() => finish({ ok: false, error: 'timed out', stage: 'timeout', log, results }), 90000);
"#;

async fn synth(tab: &Tab, jobs: Value) -> Result<Value> {
    tab.js_async_timeout(SYNTH_JS, json!([jobs, ANNOUNCEMENT]), Duration::from_secs(120)).await
}

pub fn cases() -> Vec<Case> {
    let mut cases = Vec::new();
    for (select, tool) in [("ttsVoice", "encoder"), ("ttsVoice2", "splicer")] {
        cases.push(case(format!("espeak_options_present[{select}]"), move |tab| async move {
            open_tool(&tab, tool).await?;
            let values: Vec<String> =
                tab.js("return Array.from(document.getElementById(arguments[0]).options).map(o => o.value);", json!([select])).await?;
            let missing: Vec<&str> = EXPECTED_VOICE_VALUES.iter().copied().filter(|v| !values.iter().any(|x| x == v)).collect();
            ensure!(missing.is_empty(), "{select} is missing eSpeak voices: {missing:?}");
            Ok(())
        }));
    }
    cases.push(case("espeak_worker_renders_speech", |tab| async move {
        open_tool(&tab, "encoder").await?;
        let jobs = json!([
            { "voice": "en-us", "rate": 175, "pitch": 50 },
            { "voice": "en-us+whisper", "rate": 175, "pitch": 50 },
            { "voice": "es-419", "rate": 175, "pitch": 50 },
            { "voice": "en-us", "rate": 300, "pitch": 50 },
        ]);
        let outcome = synth(&tab, jobs.clone()).await?;
        ensure!(outcome["ok"] == true, "eSpeak worker failed ({}): {}", outcome["stage"], outcome["error"]);
        let results = outcome["results"].as_array().context("no results")?;
        ensure!(results.len() == 4, "{outcome}");
        for (job, result) in jobs.as_array().unwrap().iter().zip(results) {
            let voice = &job["voice"];
            ensure!(result["sampleRate"] == 22050, "{voice}: {result}");
            ensure!(result["samples"].as_f64().unwrap_or(0.0) > 22050.0, "{voice} produced under a second of audio");
            ensure!(result["peak"].as_f64().unwrap_or(0.0) > 0.05, "{voice} produced near-silent audio");
            ensure!(result["loudFraction"].as_f64().unwrap_or(0.0) > 0.3, "{voice} is mostly silence");
        }
        let (fast, normal) = (results[3]["samples"].as_f64().unwrap(), results[0]["samples"].as_f64().unwrap());
        ensure!(fast < normal * 0.85, "rate 300 should be shorter than 175: {fast} vs {normal}");
        Ok(())
    }));
    cases.push(case("espeak_rejects_unknown_voice", |tab| async move {
        open_tool(&tab, "encoder").await?;
        let outcome = synth(&tab, json!([{ "voice": "ja", "rate": 175, "pitch": 50 }])).await?;
        ensure!(outcome["ok"] == false && outcome["stage"] == "synth-error", "{outcome}");
        ensure!(outcome["error"].as_str().unwrap_or_default().contains("not in the data package"), "{outcome}");
        Ok(())
    }));
    cases
}
