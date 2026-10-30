//! The crawl panel's EAS Screen Builder (issue #123).
//!
//! Custom screens are layouts of text, boxes and images saved as JSON. They are offered under
//! the pre-made backgrounds and rendered through the same pipeline: sizing and locking the
//! crawl geometry, flashing, export, presets. The Atari 800XL template is checked
//! pixel-for-pixel against the built-in Atari screen because that is the claim it makes.

use std::collections::BTreeSet;

use eas_tools_e2e::*;

use crate::common::{capture_download, click_later, copy_text, open_tool, temp_file, wait_for_dialog};

const WARNING_HEADER: &str = "ZCZC-CIV-CAE-006000+0000-2521800-KTLA TV5-";
const WATCH_HEADER: &str = "ZCZC-WXR-SVA-039045-039073-039129+0300-2521800-KEPZ/NWS-";
const MODULE: &str = "./assets/js/crawl-screen-builder.js";
const LOCKABLE: [&str; 5] = ["crawlWidth", "crawlHeight", "crawlInset", "crawlTopLeftPixelX", "crawlTopLeftPixelY"];

const SET_HEADER_JS: &str = "
const header = arguments[0];
const mode = document.getElementById('crawlMode');
mode.value = 'header';
mode.dispatchEvent(new Event('change', { bubbles: true }));
const raw = document.getElementById('crawlRawHeader');
raw.value = header;
raw.dispatchEvent(new Event('input', { bubbles: true }));";

const SAVE_AND_USE_JS: &str = r#"
const done = arguments[arguments.length - 1];
const [module, layout] = [arguments[0], arguments[1]];
(async () => {
    try {
        const m = await import(module);
        const saved = m.saveScreen(layout);
        const mode = document.getElementById('crawlBackgroundMode');
        mode.value = 'premade';
        mode.dispatchEvent(new Event('change', { bubbles: true }));
        const select = document.getElementById('crawlBackgroundPremadeSelect');
        select.querySelectorAll('optgroup[data-custom-screens]').forEach((g) => g.remove());
        const group = document.createElement('optgroup');
        group.dataset.customScreens = '1';
        group.label = 'Custom Screens';
        group.appendChild(new Option('Custom: ' + saved.name, 'screen:' + saved.id));
        select.appendChild(group);
        select.value = 'screen:' + saved.id;
        select.dispatchEvent(new Event('change', { bubbles: true }));
        done({ ok: true, id: saved.id });
    } catch (error) {
        done({ ok: false, error: String(error) });
    }
})();
"#;

const WAIT_FOR_BACKGROUND_JS: &str = r#"
const done = arguments[arguments.length - 1];
const pages = arguments[0];
(async () => {
    const deadline = Date.now() + 25000;
    while (Date.now() < deadline) {
        const bg = window.__dasdecBackground;
        if (bg && !bg.__seenByTest && Array.isArray(bg.pages) && bg.pages.length === pages) {
            bg.__seenByTest = true;
            const srcs = bg.pages.map((p) => p.src);
            done({ ok: true, frames: srcs, rotationDelayMs: bg.rotationDelayMs, width: bg.width, height: bg.height });
            return;
        }
        await new Promise((r) => setTimeout(r, 25));
    }
    done({ ok: false, error: 'no background with ' + pages + ' pages' });
})();
"#;

const WAIT_FOR_STATIC_IMAGE_JS: &str = r#"
const done = arguments[arguments.length - 1];
(async () => {
    const deadline = Date.now() + 25000;
    while (Date.now() < deadline) {
        const g = window.crawlGenerator;
        if (g && g.bgImage && g.bgImage.src && g.bgImage.src.startsWith('data:image/png')
            && document.getElementById('crawlWidth').disabled) {
            done({ ok: true, src: g.bgImage.src });
            return;
        }
        await new Promise((r) => setTimeout(r, 25));
    }
    done({ ok: false });
})();
"#;

const READ_LOCKS_JS: &str = "
const out = { locked: [], values: {} };
for (const id of arguments[0]) {
    const el = document.getElementById(id);
    if (el.disabled) out.locked.push(id);
    out.values[id] = el.value;
}
return out;";

async fn open_crawl(tab: &Tab) -> Result<()> {
    open_tool(tab, "crawl").await?;
    tab.wait_for_selector("#crawlOpenScreenBuilder", Duration::from_secs(40)).await
}

async fn template(tab: &Tab, kind: &str) -> Result<Value> {
    tab.js_async(
        "const done = arguments[arguments.length - 1];
         import(arguments[0]).then((m) => m.createScreenTemplate(arguments[1])).then(done)
             .catch((e) => done({ error: String(e) }));",
        json!([MODULE, kind]),
    )
    .await
}

async fn save_and_use(tab: &Tab, layout: &Value) -> Result<String> {
    let used: Value = tab.js_async(SAVE_AND_USE_JS, json!([MODULE, layout])).await?;
    ensure!(used["ok"] == true, "{used}");
    Ok(used["id"].as_str().unwrap_or_default().to_string())
}

async fn wait_background(tab: &Tab, pages: usize) -> Result<Value> {
    let result: Value = tab.js_async(WAIT_FOR_BACKGROUND_JS, json!([pages])).await?;
    ensure!(result["ok"] == true, "{result}");
    Ok(result)
}

async fn static_image(tab: &Tab) -> Result<image::RgbImage> {
    let result: Value = tab.js_async(WAIT_FOR_STATIC_IMAGE_JS, json!([])).await?;
    ensure!(result["ok"] == true, "the custom screen never became the crawl background");
    img::decode_data_url(result["src"].as_str().unwrap_or_default())
}

async fn open_builder(tab: &Tab) -> Result<()> {
    tab.click("#crawlOpenScreenBuilder").await?;
    tab.wait_until("(() => { const b = document.querySelector('.sb-backdrop'); return !!b && !b.hidden; })()", Duration::from_secs(20))
        .await
}

async fn start_template(tab: &Tab, kind: &str, expected_name: &str) -> Result<()> {
    tab.exec(
        "document.getElementById('sb-start').value = arguments[0];
         window.__sbErrors = [];
         window.addEventListener('error', (e) => window.__sbErrors.push(String(e.message)));
         window.addEventListener('unhandledrejection', (e) => window.__sbErrors.push(String(e.reason && (e.reason.stack || e.reason))));",
        json!([kind]),
    )
    .await?;
    tab.click("#sb-start-btn").await?;
    if tab.wait_until(&format!("document.getElementById('sb-name').value === {}", json!(expected_name)), Duration::from_secs(15)).await.is_err() {
        let state: Value = tab
            .eval("({ name: document.getElementById('sb-name').value, status: document.getElementById('sb-status').textContent, errors: window.__sbErrors })")
            .await?;
        bail!("starting {kind} never set the name to {expected_name:?}: {state}");
    }
    Ok(())
}

async fn layout_element(tab: &Tab) -> Result<Value> {
    tab.js_async(
        "const d = arguments[arguments.length - 1];
         import(arguments[0]).then((m) => d(m.getScreenBuilder().getLayout().elements[0]));",
        json!([MODULE]),
    )
    .await
}

/// The first element once fonts have loaded and two reads 100 ms apart agree; right after the
/// builder opens, the element can still be at a fractional y from before its text was measured.
async fn settled_layout_element(tab: &Tab) -> Result<Value> {
    let _: Value = tab.eval("document.fonts.ready.then(() => true)").await?;
    let mut last = layout_element(tab).await?;
    for _ in 0..50 {
        tokio::time::sleep(Duration::from_millis(100)).await;
        let now = layout_element(tab).await?;
        if now == last {
            return Ok(now);
        }
        last = now;
    }
    bail!("the builder's layout never settled: {last}")
}

fn locked(state: &Value) -> BTreeSet<String> {
    state["locked"].as_array().into_iter().flatten().filter_map(|v| v.as_str().map(str::to_string)).collect()
}

fn set_of(ids: &[&str]) -> BTreeSet<String> {
    ids.iter().map(|s| s.to_string()).collect()
}

pub fn cases() -> Vec<Case> {
    vec![
        case("builder_is_a_keyboard_operable_modal_dialog", |tab| async move {
            open_crawl(&tab).await?;
            open_builder(&tab).await?;
            let dialog: Value = tab
                .eval(
                    "(() => { const d = document.querySelector('.sb-modal');
                       return { role: d.getAttribute('role'), modal: d.getAttribute('aria-modal'),
                                title: document.getElementById(d.getAttribute('aria-labelledby')).textContent.trim() }; })()",
                )
                .await?;
            ensure!(dialog == json!({ "role": "dialog", "modal": "true", "title": "EAS Screen Builder" }), "{dialog}");
            ensure!(tab.active_id().await? == "sb-name");

            let mut seen = Vec::new();
            let mut wrapped = false;
            for _ in 0..400 {
                tab.press("Tab", &[]).await?;
                let inside: bool = tab.eval("document.querySelector('.sb-modal').contains(document.activeElement)").await?;
                ensure!(inside, "Tab left the dialog");
                let current = tab.active_id().await?;
                if current == "sb-name" {
                    wrapped = true;
                    break;
                }
                seen.push(current);
            }
            ensure!(wrapped, "Tab never wrapped back to the first field: {:?}", &seen[..seen.len().min(60)]);
            for id in ["sb-canvas", "sb-element-list", "sb-use", "sb-close"] {
                ensure!(seen.iter().any(|s| s == id), "{id} unreachable by Tab: {seen:?}");
            }
            ensure!(seen.last().map(String::as_str) == Some("sb-close"), "{seen:?}");

            tab.press("Tab", &["Shift"]).await?;
            ensure!(tab.active_id().await? == "sb-close");
            tab.press("Tab", &[]).await?;
            ensure!(tab.active_id().await? == "sb-name");
            tab.press("Escape", &[]).await?;
            tab.wait_until("document.querySelector('.sb-backdrop').hidden", Duration::from_secs(5)).await?;
            ensure!(tab.active_id().await? == "crawlOpenScreenBuilder", "focus did not return to the opener");
            Ok(())
        }),
        case("the_open_dialog_has_no_serious_axe_violations", |tab| async move {
            open_crawl(&tab).await?;
            open_builder(&tab).await?;
            axe::assert_clean(&tab, json!(".sb-modal"), &[], "screen builder, text selected").await?;
            start_template(&tab, "template:dasdec", "My DASDEC Screen").await?;
            let spacing: String = tab.eval("document.getElementById('sb-prop-letter-spacing').value").await?;
            ensure!(spacing == "0", "letter spacing {spacing}");
            axe::assert_clean(&tab, json!(".sb-modal"), &[], "screen builder, DASDEC text selected").await?;
            tab.click("#sb-add-box").await?;
            tab.wait_for_selector("#sb-prop-stroke-width", Duration::from_secs(10)).await?;
            axe::assert_clean(&tab, json!(".sb-modal"), &[], "screen builder, box selected").await
        }),
        case("arrow_keys_on_the_preview_move_the_selected_element", |tab| async move {
            open_crawl(&tab).await?;
            open_builder(&tab).await?;
            let before = settled_layout_element(&tab).await?;
            tab.focus("#sb-canvas").await?;
            tab.press("ArrowRight", &[]).await?;
            tab.press("ArrowDown", &["Shift"]).await?;
            let after = layout_element(&tab).await?;
            let (bx, by) = (before["x"].as_f64().unwrap(), before["y"].as_f64().unwrap());
            let (ax, ay) = (after["x"].as_f64().unwrap(), after["y"].as_f64().unwrap());
            ensure!(ax == bx + 1.0 && ay == by + 10.0, "moved from ({bx},{by}) to ({ax},{ay})");
            let field: String = tab.eval("document.getElementById('sb-prop-x').value").await?;
            ensure!(field == (ax.round() as i64).to_string(), "x field shows {field}");
            let note: String = tab.eval("document.getElementById('sb-selection-note').textContent").await?;
            ensure!(note.contains(&format!("X {}", ax.round() as i64)) && note.contains(&format!("Y {}", ay.round() as i64)), "{note}");
            Ok(())
        }),
        case("atari_template_exports_and_imports_unchanged", |tab| async move {
            open_crawl(&tab).await?;
            open_builder(&tab).await?;
            start_template(&tab, "template:atari_800xl", "My Atari 800XL Screen").await?;
            let (name, text) = capture_download(&tab, "sb-export").await?;
            ensure!(name.starts_with("eas-screen-my-atari-800xl-screen"), "{name}");
            let layout: Value = serde_json::from_str(&text)?;
            ensure!(layout["format"] == "eas-tools-screen" && layout["version"] == 1, "{layout}");
            ensure!(layout["crawl"]["enabled"] == false);
            let texts: Vec<&str> = layout["elements"].as_array().unwrap().iter().filter_map(|e| e["text"].as_str()).collect();
            ensure!(
                texts == ["EMERGENCY ALERT SYSTEM", "{EVENT}", "FOR {LOCATIONS}\nUNTIL {COLOR:#A57E42}{UNTIL}.", "{SENDER}"],
                "{texts:?}"
            );
            let flashes: Vec<bool> = layout["elements"].as_array().unwrap().iter().map(|e| e["flash"] == true).collect();
            ensure!(flashes == [false, true, false, false], "{flashes:?}");

            let path = temp_file("atari-screen.json", text.as_bytes())?;
            start_template(&tab, "template:blank", "My Screen").await.ok();
            tab.set_files("#sb-import-file", &[path]).await?;
            tab.wait_until("document.getElementById('sb-status').textContent.startsWith('Imported')", Duration::from_secs(15)).await?;
            let reimported: String = tab
                .js_async(
                    "const d = arguments[arguments.length - 1];
                     import(arguments[0]).then((m) => d(m.getScreenBuilder().exportJson()));",
                    json!([MODULE]),
                )
                .await?;
            ensure!(serde_json::from_str::<Value>(&reimported)? == layout, "the re-imported layout differs");
            Ok(())
        }),
        case("atari_template_draws_the_same_screen_as_the_built_in_one", |tab| async move {
            open_crawl(&tab).await?;
            tab.exec(SET_HEADER_JS, json!([WARNING_HEADER])).await?;
            tab.exec(
                "const mode = document.getElementById('crawlBackgroundMode');
                 mode.value = 'premade';
                 mode.dispatchEvent(new Event('change', { bubbles: true }));
                 const s = document.getElementById('crawlBackgroundPremadeSelect');
                 s.value = 'atari:atari_800xl';
                 s.dispatchEvent(new Event('change', { bubbles: true }));",
                json!([]),
            )
            .await?;
            let builtin = wait_background(&tab, 2).await?;
            let layout = template(&tab, "atari_800xl").await?;
            save_and_use(&tab, &layout).await?;
            let custom = wait_background(&tab, 2).await?;
            ensure!(custom["rotationDelayMs"] == 500 && builtin["rotationDelayMs"] == 500);
            ensure!(custom["width"] == 640 && custom["height"] == 480);
            for (index, name) in ["lit", "dark"].iter().enumerate() {
                let ours = img::decode_data_url(custom["frames"][index].as_str().unwrap_or_default())?;
                let theirs = img::decode_data_url(builtin["frames"][index].as_str().unwrap_or_default())?;
                ensure!(ours.dimensions() == theirs.dimensions());
                let ratio = img::difference_ratio(&ours, &theirs, 48);
                ensure!(ratio < 0.002, "{name} frames differ on {:.3}% of pixels", ratio * 100.0);
            }
            Ok(())
        }),
        case("a_screen_without_a_crawl_locks_the_crawl_off_screen", |tab| async move {
            open_crawl(&tab).await?;
            let mut layout = template(&tab, "blank").await?;
            layout["crawl"]["enabled"] = json!(false);
            layout["width"] = json!(720);
            layout["height"] = json!(480);
            save_and_use(&tab, &layout).await?;
            tab.wait_until("document.getElementById('crawlTopLeftPixelY').value === '9999'", Duration::from_secs(20)).await?;
            let state: Value = tab.js(READ_LOCKS_JS, json!([LOCKABLE])).await?;
            ensure!(locked(&state) == set_of(&["crawlWidth", "crawlHeight", "crawlTopLeftPixelX", "crawlTopLeftPixelY"]), "{state}");
            ensure!(state["values"]["crawlWidth"] == "720" && state["values"]["crawlHeight"] == "480", "{state}");
            ensure!(state["values"]["crawlTopLeftPixelX"] == "9999", "{state}");
            static_image(&tab).await?;
            Ok(())
        }),
        case("a_screen_with_a_crawl_places_it_from_its_region", |tab| async move {
            open_crawl(&tab).await?;
            let mut layout = template(&tab, "blank").await?;
            layout["width"] = json!(1280);
            layout["height"] = json!(720);
            layout["crawl"] = json!({ "enabled": true, "y": 600, "inset": 40 });
            save_and_use(&tab, &layout).await?;
            tab.wait_until("document.getElementById('crawlTopLeftPixelY').value === '600'", Duration::from_secs(20)).await?;
            let state: Value = tab.js(READ_LOCKS_JS, json!([LOCKABLE])).await?;
            ensure!(locked(&state) == set_of(&LOCKABLE), "{state}");
            ensure!(
                state["values"]
                    == json!({ "crawlWidth": "1280", "crawlHeight": "720", "crawlInset": "40",
                               "crawlTopLeftPixelX": "0", "crawlTopLeftPixelY": "600" }),
                "{state}"
            );
            tab.wait_until(
                "(() => { const g = window.crawlGenerator; return g.canvas.width === 1280 && g.canvas.height === 720; })()",
                Duration::from_secs(20),
            )
            .await
        }),
        case("tokens_are_filled_from_the_header", |tab| async move {
            open_crawl(&tab).await?;
            tab.exec(SET_HEADER_JS, json!([WATCH_HEADER])).await?;
            let mut layout = template(&tab, "blank").await?;
            layout["elements"] = json!([
                { "type": "text", "x": 0, "y": 40, "width": 640, "wrap": "none", "size": 14,
                  "text": "{EVENT_CODE}|{ORIGINATOR_CODE}|{SENDER}|{ARTICLE} {EVENT}" },
                { "type": "text", "x": 0, "y": 80, "width": 640, "wrap": "none", "size": 14, "uppercase": true,
                  "text": "FOR {LOCATIONS}" },
                { "type": "text", "x": 0, "y": 120, "width": 640, "wrap": "none", "size": 14,
                  "text": "{HEADLINE} until {UNTIL}" }
            ]);
            save_and_use(&tab, &layout).await?;
            static_image(&tab).await?;
            let text = copy_text(&tab, "copyCrawlText").await?;
            let lines: Vec<&str> = text.split('\n').collect();
            ensure!(lines[0] == "SVA|WXR|KEPZ/NWS|a Severe Thunderstorm Watch", "{lines:?}");
            ensure!(lines[1] == "FOR FAIRFIELD, HOCKING AND PICKAWAY COUNTIES", "{lines:?}");
            ensure!(lines[2].starts_with("EMERGENCY ALERT SYSTEM until ") && !lines[2].contains("Further Notice"), "{lines:?}");
            Ok(())
        }),
        case("without_a_header_tokens_come_from_the_alert_dropdowns", |tab| async move {
            open_crawl(&tab).await?;
            tab.wait_until("!!document.querySelector('#easyplusEventCode option[value=\"SVA\"]')", Duration::from_secs(30)).await?;
            tab.exec(
                "const set = (id, value, type) => {
                     const el = document.getElementById(id);
                     el.value = value;
                     el.dispatchEvent(new Event(type || 'change', { bubbles: true }));
                 };
                 set('crawlMode', 'custom');
                 set('crawlText', 'free text crawl', 'input');
                 set('easyplusOriginator', 'CIV');
                 set('easyplusEventCode', 'SVA');",
                json!([]),
            )
            .await?;
            let mut layout = template(&tab, "blank").await?;
            layout["severityColors"] = json!({ "warning": "#FF0000", "watch": "#00FF00", "advisory": "#0000FF" });
            layout["elements"] = json!([
                { "type": "rect", "x": 0, "y": 0, "width": 640, "height": 480, "fill": "{SEVERITY_COLOR}" },
                { "type": "text", "x": 0, "y": 40, "width": 640, "wrap": "none", "size": 14,
                  "text": "{EVENT_CODE}|{ORIGINATOR_CODE}|{ARTICLE} {EVENT}|{ORIGINATOR}|{TEXT}" }
            ]);
            save_and_use(&tab, &layout).await?;
            let shown: String = tab.eval("getComputedStyle(document.getElementById('easyplusSettings')).display").await?;
            ensure!(shown != "none", "a custom screen needs the originator and event dropdowns");
            let image = static_image(&tab).await?;
            ensure!(img::px(&image, 320, 400) == (0, 255, 0), "{:?}", img::px(&image, 320, 400));
            let text = copy_text(&tab, "copyCrawlText").await?;
            ensure!(text == "SVA|CIV|a Severe Thunderstorm Watch|Civil Authorities|free text crawl", "{text}");
            Ok(())
        }),
        case("severity_color_follows_the_event", |tab| async move {
            open_crawl(&tab).await?;
            tab.exec(SET_HEADER_JS, json!([WATCH_HEADER])).await?;
            let mut layout = template(&tab, "blank").await?;
            layout["severityColors"] = json!({ "warning": "#FF0000", "watch": "#00FF00", "advisory": "#0000FF" });
            layout["elements"] = json!([{ "type": "rect", "x": 0, "y": 0, "width": 640, "height": 480, "fill": "{SEVERITY_COLOR}" }]);
            save_and_use(&tab, &layout).await?;
            let image = static_image(&tab).await?;
            ensure!(img::px(&image, 320, 240) == (0, 255, 0), "{:?}", img::px(&image, 320, 240));
            Ok(())
        }),
        case("presets_carry_the_custom_screen", |tab| async move {
            open_crawl(&tab).await?;
            let mut layout = template(&tab, "atari_800xl").await?;
            layout["name"] = json!("Preset Carried Screen");
            let id = save_and_use(&tab, &layout).await?;
            let screen_value = format!("screen:{id}");

            let before = tab.dialogs().len();
            click_later(&tab, "saveUserPreset").await?;
            wait_for_dialog(&tab, before).await?;
            tab.exec(
                "const s = document.getElementById('crawlBackgroundPremadeSelect');
                 s.value = 'dasdec:dasdec';
                 s.dispatchEvent(new Event('change', { bubbles: true }));",
                json!([]),
            )
            .await?;
            click_later(&tab, "loadUserPreset").await?;
            wait_for_dialog(&tab, before + 1).await?;
            let selected: String = tab.eval("document.getElementById('crawlBackgroundPremadeSelect').value").await?;
            ensure!(selected == screen_value, "{selected}");

            let (_, text) = capture_download(&tab, "exportUserPreset").await?;
            let settings = serde_json::from_str::<Value>(&text)?["settings"].clone();
            let embedded: Value = serde_json::from_str(settings["crawlCustomScreenData"].as_str().unwrap_or("{}"))?;
            ensure!(embedded["id"] == json!(id) && embedded["name"] == "Preset Carried Screen", "{embedded}");

            let path = temp_file("preset.json", text.as_bytes())?;
            tab.exec("localStorage.clear();", json!([])).await?;
            open_crawl(&tab).await?;
            let listed: bool = tab
                .js(
                    "return Array.from(document.querySelectorAll('#crawlBackgroundPremadeSelect option')).some((o) => o.value === arguments[0]);",
                    json!([screen_value]),
                )
                .await?;
            ensure!(!listed, "the screen survived clearing storage");
            let before = tab.dialogs().len();
            tab.set_files("#importUserPresetFile", &[path]).await?;
            wait_for_dialog(&tab, before).await?;
            tab.wait_until(
                &format!("document.getElementById('crawlBackgroundPremadeSelect').value === {}", json!(screen_value)),
                Duration::from_secs(10),
            )
            .await?;
            let label: String = tab
                .eval("(() => { const s = document.getElementById('crawlBackgroundPremadeSelect'); return s.options[s.selectedIndex].text; })()")
                .await?;
            ensure!(label == "Custom: Preset Carried Screen", "{label}");
            wait_background(&tab, 2).await?;
            Ok(())
        }),
        case("use_this_screen_applies_it_and_returns_focus", |tab| async move {
            open_crawl(&tab).await?;
            open_builder(&tab).await?;
            start_template(&tab, "template:easyplus", "My EASyPLUS Screen").await?;
            tab.exec("const n = document.getElementById('sb-name'); n.focus(); n.select();", json!([])).await?;
            tab.press("Backspace", &[]).await?;
            tab.type_text("Station Screen").await?;
            tab.click("#sb-use").await?;
            tab.wait_until("document.querySelector('.sb-backdrop').hidden", Duration::from_secs(10)).await?;
            ensure!(tab.active_id().await? == "crawlOpenScreenBuilder", "focus did not return to the opener");
            tab.wait_until(
                "(() => { const s = document.getElementById('crawlBackgroundPremadeSelect');
                   return document.getElementById('crawlBackgroundMode').value === 'premade'
                       && s.options[s.selectedIndex].text === 'Custom: Station Screen'
                       && document.getElementById('crawlTopLeftPixelY').value === '175'
                       && document.getElementById('crawlWidth').value === '1920'; })()",
                Duration::from_secs(20),
            )
            .await
        }),
        case("saving_under_a_new_name_keeps_the_original_screen", |tab| async move {
            open_crawl(&tab).await?;
            open_builder(&tab).await?;
            let rename_and_save = |name: &'static str| {
                let tab = tab.clone();
                async move {
                    tab.exec("const n = document.getElementById('sb-name'); n.focus(); n.select();", json!([])).await?;
                    tab.press("Backspace", &[]).await?;
                    tab.type_text(name).await?;
                    tab.click("#sb-save").await?;
                    tab.wait_until(
                        &format!("document.getElementById('sb-status').textContent.includes({})", json!(format!("\"{name}\""))),
                        Duration::from_secs(10),
                    )
                    .await?;
                    let names: Vec<String> = tab
                        .js_async(
                            "const d = arguments[arguments.length - 1];
                             import(arguments[0]).then((m) => d(m.listScreens().map((s) => s.name).sort()));",
                            json!([MODULE]),
                        )
                        .await?;
                    let status: String = tab.eval("document.getElementById('sb-status').textContent").await?;
                    Ok::<_, anyhow::Error>((names, status))
                }
            };
            let (names, _) = rename_and_save("Screen A").await?;
            ensure!(names == ["Screen A"], "{names:?}");
            tab.click("#sb-add-box").await?;
            let (names, status) = rename_and_save("Screen B").await?;
            ensure!(names == ["Screen A", "Screen B"], "renaming overwrote the original: {names:?}");
            ensure!(status.contains("as a new screen") && status.contains("\"Screen A\" was left unchanged"), "{status}");
            let (names, status) = rename_and_save("Screen B").await?;
            ensure!(names == ["Screen A", "Screen B"], "saving again under the same name made a copy: {names:?}");
            ensure!(!status.contains("as a new screen"), "{status}");
            Ok(())
        }),
        case("pages_can_be_added_filled_and_deleted", |tab| async move {
            open_crawl(&tab).await?;
            open_builder(&tab).await?;
            start_template(&tab, "template:dasdec_black", "My DASDEC (Black) Screen").await?;
            let state = |tab: Tab| async move {
                tab.js_async::<Value>(
                    "const d = arguments[arguments.length - 1];
                     import(arguments[0]).then((m) => {
                         const layout = m.getScreenBuilder().getLayout();
                         d({
                             pageCount: layout.pageCount,
                             pages: layout.elements.map((e) => e.page),
                             options: document.getElementById('sb-page').options.length,
                             page: document.getElementById('sb-page').value,
                             listed: document.getElementById('sb-element-list').options.length,
                             deleteText: document.getElementById('sb-delete-page').textContent,
                             deleteDisabled: document.getElementById('sb-delete-page').disabled
                         });
                     });",
                    json!([MODULE]),
                )
                .await
            };
            let first = state(tab.clone()).await?;
            ensure!(first["pageCount"] == 1 && first["options"] == 1 && first["listed"] == 3 && first["deleteDisabled"] == true, "{first}");
            tab.click("#sb-add-page").await?;
            let added = state(tab.clone()).await?;
            ensure!(added["pageCount"] == 2 && added["page"] == "1" && added["listed"] == 2, "only every-page elements belong on a new page: {added}");
            tab.click("#sb-add-text").await?;
            let filled = state(tab.clone()).await?;
            ensure!(filled["listed"] == 3 && filled["pages"].as_array().unwrap().iter().filter(|p| **p == 1).count() == 1, "{filled}");
            tab.wait_until("document.getElementById('sb-page-note').textContent.includes('2 pages')", Duration::from_secs(10)).await?;
            tab.click("#sb-delete-page").await?;
            let armed = state(tab.clone()).await?;
            ensure!(armed["pageCount"] == 2 && armed["deleteText"] == "Press Again to Delete Page", "{armed}");
            tab.click("#sb-delete-page").await?;
            let deleted = state(tab.clone()).await?;
            ensure!(deleted["pageCount"] == 1 && deleted["pages"].as_array().unwrap().len() == 3 && deleted["page"] == "0", "{deleted}");
            Ok(())
        }),
        case("a_multi_page_screen_rotates_its_pages_behind_the_crawl", |tab| async move {
            open_crawl(&tab).await?;
            tab.exec("document.getElementById('crawlMode').value = 'custom'; document.getElementById('crawlMode').dispatchEvent(new Event('change', { bubbles: true }));", json!([])).await?;
            tab.wait_until("!!window.crawlEditor", Duration::from_secs(20)).await?;
            let text: String = (1..=15).map(|n| format!("LINE {n}")).collect::<Vec<_>>().join("\n");
            tab.exec("window.crawlEditor.setValue(arguments[0]);", json!([text])).await?;
            let layout = template(&tab, "dasdec_black").await?;
            save_and_use(&tab, &layout).await?;
            let background = wait_background(&tab, 2).await?;
            ensure!(background["rotationDelayMs"] == 4000 && background["width"] == 640, "{background}");
            let copied = copy_text(&tab, "copyCrawlText").await?;
            ensure!(copied.contains("LINE 11\n1/2") && copied.contains("LINE 12") && copied.trim_end().ends_with("2/2"), "{copied}");
            Ok(())
        }),
        case("built_in_style_presets_apply_only_what_they_cover", |tab| async move {
            open_crawl(&tab).await?;
            tab.exec(
                "const s = document.getElementById('crawlSpeed'); s.value = '7'; s.dispatchEvent(new Event('input', { bubbles: true }));
                 document.getElementById('crawlStylePreset').value = 'easyplus_gray';",
                json!([]),
            )
            .await?;
            tab.click("#applyCrawlStylePreset").await?;
            tab.wait_until(
                "(() => { const v = (id) => document.getElementById(id).value;
                   return v('crawlBackgroundMode') === 'premade' && v('crawlBackgroundPremadeSelect') === 'easyplus:easyplus_gray'
                       && v('crawlFontFamily') === 'VCREAS_4.5' && v('crawlFontSize') === '84' && v('crawlOutlineWidth') === '5'
                       && v('crawlOutlineJoin') === 'miter' && v('crawlTextColor').toUpperCase() === '#FFFFFF'
                       && document.getElementById('easyplusSettings').style.display === 'block'; })()",
                Duration::from_secs(20),
            )
            .await?;
            let speed: String = tab.eval("document.getElementById('crawlSpeed').value").await?;
            ensure!(speed == "7", "the style changed the crawl speed to {speed}");
            tab.exec("document.getElementById('crawlStylePreset').value = 'vds';", json!([])).await?;
            tab.click("#applyCrawlStylePreset").await?;
            tab.wait_until(
                "document.getElementById('crawlFontFamily').value === 'VDSwiss V1' && document.getElementById('crawlUseVDSMode').checked",
                Duration::from_secs(20),
            )
            .await?;
            let premade: String = tab.eval("document.getElementById('crawlBackgroundPremadeSelect').value").await?;
            ensure!(premade == "easyplus:easyplus_gray", "a font-only style changed the background to {premade}");
            tab.wait_until(
                "(() => { try { const s = JSON.parse(localStorage.getItem('eas-tools-crawl-settings')); return !!s && (s.fontFamily === 'VDSwiss V1' || s.crawlFontFamily === 'VDSwiss V1'); } catch (e) { return false; } })()",
                Duration::from_secs(10),
            )
            .await?;
            let persisted: bool = tab.eval("'crawlStylePreset' in JSON.parse(localStorage.getItem('eas-tools-crawl-settings'))").await?;
            ensure!(!persisted, "the style picker leaked into the saved settings");
            Ok(())
        }),
    ]
}
