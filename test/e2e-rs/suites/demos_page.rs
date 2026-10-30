//! demos.html: the voice list, its labels, and every demo file resolving and decoding.

use eas_tools_e2e::*;

const ESPEAK_LABELS: [&str; 9] = [
    "[eSpeak] eSpeak NG (local) - English (US)",
    "[eSpeak] eSpeak NG (local) - English (US), Male 3",
    "[eSpeak] eSpeak NG (local) - English (US), Female 2",
    "[eSpeak] eSpeak NG (local) - English (US), Whisper",
    "[eSpeak] eSpeak NG (local) - English (US), Croak",
    "[eSpeak] eSpeak NG (local) - English (US), Klatt formant",
    "[eSpeak] eSpeak NG (local) - English (UK)",
    "[eSpeak] eSpeak NG (local) - Spanish (Latin America)",
    "[eSpeak] eSpeak NG (local) - French",
];

async fn open_demos(tab: &Tab) -> Result<()> {
    tab.goto("demos.html").await?;
    tab.wait_until("document.querySelectorAll('#voice-list li').length > 0", Duration::from_secs(25)).await
}

pub fn cases() -> Vec<Case> {
    vec![
        case("espeak_rows_present", |tab| async move {
            open_demos(&tab).await?;
            let labels: Vec<String> =
                tab.eval("Array.from(document.querySelectorAll('#voice-list li span')).map(s => s.textContent)").await?;
            let missing: Vec<&str> = ESPEAK_LABELS.iter().copied().filter(|l| !labels.iter().any(|x| x == l)).collect();
            ensure!(missing.is_empty(), "demos.html is missing eSpeak rows: {missing:?}");
            Ok(())
        }),
        case("voice_count_matches_rendered_rows", |tab| async move {
            open_demos(&tab).await?;
            let (rendered, reported): (i64, String) = tab
                .eval("[document.querySelectorAll('#voice-list li').length, document.getElementById('voice-count').innerText.trim()]")
                .await?;
            ensure!(reported == rendered.to_string(), "voice-count says {reported}, page rendered {rendered} rows");
            Ok(())
        }),
        case("every_row_has_an_accessible_name", |tab| async move {
            open_demos(&tab).await?;
            let rows: Vec<Value> = tab
                .eval(
                    "Array.from(document.querySelectorAll('#voice-list li')).map((li) => ({
                        label: li.querySelector('span').textContent,
                        text: li.querySelector('button').textContent,
                        aria: li.querySelector('button').getAttribute('aria-label'),
                    }))",
                )
                .await?;
            ensure!(!rows.is_empty());
            for row in rows {
                ensure!(row["text"] == "Play Demo", "{row}");
                ensure!(row["aria"] == format!("Play demo for {}", row["label"].as_str().unwrap_or_default()), "{row}");
            }
            Ok(())
        }),
        // The offline fallback voice list and assets/demo_files must agree; they drifted once
        // when the fallback still named Speechify AI Mara v1/v2 after those demos were replaced.
        case("every_demo_audio_file_resolves", |tab| async move {
            open_demos(&tab).await?;
            let broken: Vec<Value> = tab
                .js_async(
                    "const done = arguments[arguments.length - 1];
                     const rows = Array.from(document.querySelectorAll('#voice-list li'));
                     Promise.all(rows.map(async (row) => {
                         const label = row.querySelector('span').textContent;
                         const src = row.querySelector('button').getAttribute('data-demo-src');
                         const response = await fetch(src, { method: 'GET' });
                         return { label, src, status: response.status };
                     })).then((results) => done(results.filter((r) => r.status !== 200)));",
                    json!([]),
                )
                .await?;
            ensure!(broken.is_empty(), "demo audio missing for: {broken:?}");
            Ok(())
        }),
        // A 200 is not enough: the first eSpeak demos had a zero data-chunk size that Chrome
        // played and Firefox rejected.
        case("every_demo_audio_file_actually_decodes", |tab| async move {
            open_demos(&tab).await?;
            let results: Value = tab
                .js_async_timeout(
                    "const done = arguments[arguments.length - 1];
                     const rows = Array.from(document.querySelectorAll('#voice-list li'));
                     const ctx = new (window.AudioContext || window.webkitAudioContext)();
                     const failures = [];
                     (async () => {
                         for (const row of rows) {
                             const label = row.querySelector('span').textContent;
                             const src = row.querySelector('button').getAttribute('data-demo-src');
                             try {
                                 const bytes = await (await fetch(src)).arrayBuffer();
                                 const buffer = await ctx.decodeAudioData(bytes);
                                 if (!buffer.duration || buffer.length === 0) failures.push({ label, src, reason: 'decoded to an empty buffer' });
                             } catch (err) {
                                 failures.push({ label, src, reason: String(err && err.message || err) });
                             }
                         }
                         done({ checked: rows.length, failures });
                     })();",
                    json!([]),
                    Duration::from_secs(180),
                )
                .await?;
            ensure!(results["checked"].as_i64().unwrap_or(0) > 0, "no demo rows rendered");
            ensure!(results["failures"].as_array().map_or(true, |f| f.is_empty()), "undecodable demo audio: {}", results["failures"]);
            Ok(())
        }),
    ]
}
