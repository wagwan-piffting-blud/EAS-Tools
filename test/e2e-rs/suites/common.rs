use eas_tools_e2e::*;

/// index.html marks the panel active synchronously and then imports the tool's bundle, so
/// neither readyState nor the active class says the tool's listeners exist yet. The encoder
/// publishes noaaProductToFips after wiring its controls, the decoder fills window.events
/// from the SAME tables before its setup, and the crawl's first settings pass creates
/// window.crawlGenerator. The splicer binds its controls after awaiting its macro tables and
/// then fires a voice change, which re-hides the TTS volume row; the override-TZ fields get
/// an inline display from that change handler.
pub const TOOL_READY_JS: &str = r#"
const tool = arguments[0];
const panel = document.getElementById(tool + '-panel');
if (document.readyState !== 'complete' || !panel || !panel.classList.contains('active')) return false;
if (panel.hasAttribute('aria-busy') || panel.querySelector(':scope > .tool-loading')) return false;
if (tool === 'encoder') return typeof window.noaaProductToFips === 'function';
if (tool === 'decoder') return Object.keys(window.events || {}).length > 0;
if (tool === 'crawl') return !!window.crawlGenerator;
if (tool === 'splicer') return document.getElementById('useSplicerOverrideTZ').style.display !== '';
return true;
"#;

pub async fn wait_for_tool(tab: &Tab, tool: &str) -> Result<()> {
    let deadline = std::time::Instant::now() + Duration::from_secs(40);
    loop {
        if tab.js::<bool>(TOOL_READY_JS, json!([tool])).await.unwrap_or(false) {
            return Ok(());
        }
        if std::time::Instant::now() >= deadline {
            bail!("the {tool} tool never finished setting up");
        }
        tokio::time::sleep(Duration::from_millis(25)).await;
    }
}

pub async fn open_tool(tab: &Tab, tool: &str) -> Result<()> {
    tab.goto(&format!("index.html?tool={tool}")).await?;
    wait_for_tool(tab, tool).await
}

/// Clicks a button with the clipboard stubbed and returns what it tried to copy.
pub const COPY_TEXT_JS: &str = r#"
const done = arguments[arguments.length - 1];
const button = arguments[0];
(async () => {
    let copied = null;
    const original = navigator.clipboard.writeText.bind(navigator.clipboard);
    navigator.clipboard.writeText = (text) => { copied = text; return Promise.resolve(); };
    try {
        document.getElementById(button).click();
        const deadline = Date.now() + 15000;
        while (Date.now() < deadline && copied === null) {
            await new Promise((resolve) => setTimeout(resolve, 25));
        }
        done({ ok: copied !== null, text: copied });
    } finally {
        navigator.clipboard.writeText = original;
    }
})();
"#;

pub async fn copy_text(tab: &Tab, button: &str) -> Result<String> {
    let copied: Value = tab.js_async(COPY_TEXT_JS, json!([button])).await?;
    ensure!(copied["ok"] == true, "nothing was copied: {copied}");
    Ok(copied["text"].as_str().unwrap_or_default().to_string())
}

/// Writes `contents` to a uniquely named file under the system temp dir.
pub fn temp_file(name: &str, contents: &[u8]) -> Result<std::path::PathBuf> {
    use std::sync::atomic::{AtomicUsize, Ordering};
    static NEXT: AtomicUsize = AtomicUsize::new(0);
    let dir = std::env::temp_dir().join(format!("eas-tools-e2e-{}", std::process::id()));
    std::fs::create_dir_all(&dir)?;
    let path = dir.join(format!("{}-{name}", NEXT.fetch_add(1, Ordering::Relaxed)));
    std::fs::write(&path, contents)?;
    Ok(path)
}

/// Like temp_file, but in its own directory so the file keeps exactly `name`.
pub fn named_temp_file(name: &str, contents: &[u8]) -> Result<std::path::PathBuf> {
    let unique = temp_file("dir", &[])?;
    std::fs::remove_file(&unique)?;
    std::fs::create_dir_all(&unique)?;
    let path = unique.join(name);
    std::fs::write(&path, contents)?;
    Ok(path)
}

/// Clicks a button with window.EASDownloads stubbed and returns the saved file's name and text.
pub const CAPTURE_DOWNLOAD_JS: &str = r#"
const done = arguments[arguments.length - 1];
const buttonId = arguments[0];
(async () => {
    let captured = null;
    const previous = window.EASDownloads;
    window.EASDownloads = { saveBlob: async (blob, name) => { captured = { blob, name }; } };
    try {
        document.getElementById(buttonId).click();
        const deadline = Date.now() + 15000;
        while (Date.now() < deadline && captured === null) {
            await new Promise((r) => setTimeout(r, 25));
        }
    } finally {
        window.EASDownloads = previous;
    }
    done(captured ? { ok: true, name: captured.name, text: await captured.blob.text() } : { ok: false });
})();
"#;

pub async fn capture_download(tab: &Tab, button: &str) -> Result<(String, String)> {
    let result: Value = tab.js_async(CAPTURE_DOWNLOAD_JS, json!([button])).await?;
    ensure!(result["ok"] == true, "{button} saved nothing");
    Ok((result["name"].as_str().unwrap_or_default().to_string(), result["text"].as_str().unwrap_or_default().to_string()))
}

/// Waits for the next alert/confirm after `before` already-seen dialogs.
pub async fn wait_for_dialog(tab: &Tab, before: usize) -> Result<String> {
    let deadline = std::time::Instant::now() + Duration::from_secs(15);
    loop {
        let seen = tab.dialogs();
        if seen.len() > before {
            return Ok(seen[before].clone());
        }
        ensure!(std::time::Instant::now() < deadline, "no dialog appeared");
        tokio::time::sleep(Duration::from_millis(25)).await;
    }
}

/// Clicks via a zero-delay timer so a dialog raised by the click cannot hold up this call.
pub async fn click_later(tab: &Tab, id: &str) -> Result<()> {
    tab.exec("setTimeout(() => document.getElementById(arguments[0]).click(), 0);", json!([id])).await
}

pub async fn open_tool_tracking_errors(tab: &Tab, tool: &str) -> Result<()> {
    open_tool(tab, tool).await?;
    tab.exec(
        "window.__testErrors = [];
         window.addEventListener('error', (e) => window.__testErrors.push(String(e.message)));
         window.addEventListener('unhandledrejection', (e) => window.__testErrors.push(String(e.reason)));",
        json!([]),
    )
    .await
}

pub async fn set_field(tab: &Tab, selector: &str, value: &str) -> Result<()> {
    let changed: bool = tab
        .js(
            "const el = document.querySelector(arguments[0]);
             if (!el) return false;
             el.value = arguments[1];
             el.dispatchEvent(new Event('input', { bubbles: true }));
             el.dispatchEvent(new Event('change', { bubbles: true }));
             return true;",
            json!([selector, value]),
        )
        .await?;
    ensure!(changed, "missing field {selector}");
    Ok(())
}

pub async fn set_checkbox(tab: &Tab, id: &str, checked: bool) -> Result<()> {
    let changed: bool = tab
        .js(
            "const el = document.getElementById(arguments[0]);
             if (!el) return false;
             el.checked = arguments[1];
             el.dispatchEvent(new Event('change', { bubbles: true }));
             return true;",
            json!([id, checked]),
        )
        .await?;
    ensure!(changed, "missing checkbox {id}");
    Ok(())
}

pub async fn field_value(tab: &Tab, id: &str) -> Result<String> {
    tab.js("return document.getElementById(arguments[0]).value;", json!([id])).await
}

pub async fn status_text(tab: &Tab) -> Result<String> {
    tab.eval("document.getElementById('status').innerText").await
}

/// A 440 Hz tone of `seconds`, handed to the encoder as if the native app had loaded it.
pub const INJECT_CUSTOM_AUDIO_JS: &str = "
const seconds = arguments[0];
const rate = 44100;
const frames = Math.floor(rate * seconds);
const buffer = new ArrayBuffer(44 + frames * 2);
const view = new DataView(buffer);
const ascii = (offset, text) => { for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i)); };
ascii(0, 'RIFF'); view.setUint32(4, 36 + frames * 2, true); ascii(8, 'WAVE'); ascii(12, 'fmt ');
view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
view.setUint32(24, rate, true); view.setUint32(28, rate * 2, true); view.setUint16(32, 2, true);
view.setUint16(34, 16, true); ascii(36, 'data'); view.setUint32(40, frames * 2, true);
for (let i = 0; i < frames; i++) view.setInt16(44 + i * 2, Math.round(Math.sin(2 * Math.PI * 440 * i / rate) * 8000), true);
window._nativeCustomAudioBuffer = buffer;
return true;";

/// Clicks Generate and waits for "EAS Generated!", failing on an alert, a reported error or
/// any page error collected since open_tool_tracking_errors.
pub async fn generate(tab: &Tab, label: &str) -> Result<()> {
    tab.exec("document.getElementById('status').innerHTML = '';", json!([])).await?;
    let dialogs = tab.dialogs().len();
    tab.wait_until(
        "(() => { const b = document.querySelector('button[data-encoder-generate]'); return !!b && !b.disabled; })()",
        Duration::from_secs(120),
    )
    .await?;
    tab.click("button[data-encoder-generate]").await?;
    let deadline = std::time::Instant::now() + Duration::from_secs(120);
    loop {
        if let Some(text) = tab.dialogs().get(dialogs) {
            bail!("{label}: unexpected encoder alert: {text}");
        }
        let status = status_text(tab).await?;
        ensure!(!status.contains("Error generating alert:"), "{label}: encoder reported an error: {status}");
        if status.contains("EAS Generated!") {
            break;
        }
        ensure!(std::time::Instant::now() < deadline, "{label}: generation never finished: {status}");
        tokio::time::sleep(Duration::from_millis(25)).await;
    }
    let errors: Vec<String> = tab.eval("window.__testErrors || []").await?;
    ensure!(errors.is_empty(), "{label}: console errors {errors:?}");
    Ok(())
}

pub async fn sample_count(tab: &Tab) -> Result<i64> {
    let text = status_text(tab).await?;
    let marker = "EAS Generated! Samples: ";
    let start = text.find(marker).context("no sample count in the status")? + marker.len();
    let digits: String = text[start..].chars().take_while(|c| c.is_ascii_digit() || *c == ',').filter(|c| *c != ',').collect();
    Ok(digits.parse()?)
}

pub async fn wait_for_saved_encoder_settings(tab: &Tab) -> Result<()> {
    tab.wait_until("document.getElementById('status').innerText.includes('Loaded saved encoder settings!')", Duration::from_secs(60))
        .await
}

pub async fn checkbox_state(tab: &Tab, id: &str) -> Result<bool> {
    let state: Option<bool> =
        tab.js("const el = document.getElementById(arguments[0]); return el ? el.checked : null;", json!([id])).await?;
    state.with_context(|| format!("missing checkbox #{id}"))
}

/// Duration of the generated audio once the player has loaded its metadata.
pub async fn audio_duration(tab: &Tab) -> Result<f64> {
    tab.wait_until(
        "(() => { const el = document.getElementById('audioPlayback');
           return el.src.startsWith('blob:') && el.readyState >= 1 && isFinite(el.duration) && el.duration > 0; })()",
        Duration::from_secs(120),
    )
    .await?;
    tab.eval("document.getElementById('audioPlayback').duration").await
}

/// SHA-256 of the generated WAV blob, so two runs can be compared exactly.
pub async fn audio_digest(tab: &Tab) -> Result<String> {
    tab.wait_until("document.getElementById('audioPlayback').src.startsWith('blob:')", Duration::from_secs(120)).await?;
    tab.eval(
        "(async () => {
            const buf = await (await fetch(document.getElementById('audioPlayback').src)).arrayBuffer();
            const hash = await crypto.subtle.digest('SHA-256', buf);
            return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
        })()",
    )
    .await
}

/// A mono 16-bit 440 Hz sine WAV.
pub fn sine_wav(amplitude: f64, seconds: f64, rate: u32) -> Vec<u8> {
    let frames = (seconds * rate as f64) as usize;
    let mut out = Vec::with_capacity(44 + frames * 2);
    let data_len = (frames * 2) as u32;
    out.extend_from_slice(b"RIFF");
    out.extend_from_slice(&(36 + data_len).to_le_bytes());
    out.extend_from_slice(b"WAVEfmt ");
    out.extend_from_slice(&16u32.to_le_bytes());
    out.extend_from_slice(&1u16.to_le_bytes());
    out.extend_from_slice(&1u16.to_le_bytes());
    out.extend_from_slice(&rate.to_le_bytes());
    out.extend_from_slice(&(rate * 2).to_le_bytes());
    out.extend_from_slice(&2u16.to_le_bytes());
    out.extend_from_slice(&16u16.to_le_bytes());
    out.extend_from_slice(b"data");
    out.extend_from_slice(&data_len.to_le_bytes());
    for i in 0..frames {
        let v = (amplitude * 32767.0 * (2.0 * std::f64::consts::PI * 440.0 * i as f64 / rate as f64).sin()).round() as i16;
        out.extend_from_slice(&v.to_le_bytes());
    }
    out
}

/// Peak of the generated 32-bit WAV's data chunk, as a fraction of full scale.
pub async fn output_peak(tab: &Tab) -> Result<f64> {
    tab.eval(
        "fetch(document.getElementById('audioPlayback').src).then((r) => r.arrayBuffer()).then((buf) => {
            const view = new DataView(buf);
            let pos = 12;
            while (pos + 8 <= buf.byteLength) {
                const id = String.fromCharCode(view.getUint8(pos), view.getUint8(pos + 1), view.getUint8(pos + 2), view.getUint8(pos + 3));
                const size = view.getUint32(pos + 4, true);
                if (id === 'data') {
                    let peak = 0;
                    for (let o = pos + 8; o + 4 <= pos + 8 + size; o += 4) {
                        const v = Math.abs(view.getInt32(o, true));
                        if (v > peak) peak = v;
                    }
                    return peak / 2147483647;
                }
                pos += 8 + size + (size & 1);
            }
            return -1;
        })",
    )
    .await
}

pub fn approx(actual: f64, expected: f64, tolerance: f64) -> bool {
    (actual - expected).abs() <= tolerance
}
