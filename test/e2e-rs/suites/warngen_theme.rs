//! WarnGen's light and dark palettes: rendered text and declared colour pairings meet WCAG AA,
//! no colour in warngen.css bypasses the variables, and the Leaflet layers follow the theme.

use eas_tools_e2e::*;

/// selector, name, floor. 4.5 is the AA floor for body text; 3.0 covers large text and the
/// visual boundary of a UI component.
const PROBES: [(&str, &str, f64); 26] = [
    ("body", "page body text", 4.5),
    (".status-bar", "status bar", 4.5),
    (".help-bar", "help bar", 4.5),
    (".help-bar strong", "help bar heading", 4.5),
    (".help-bar em", "help bar emphasis", 4.5),
    (".help-bar .redEm", "help bar warning text", 4.5),
    (".meta-bar", "product bar", 4.5),
    (".meta-bar strong", "product bar heading", 4.5),
    (".meta-bar label", "product bar label", 4.5),
    (".meta-note", "product bar note", 4.5),
    (".storm-bar", "storm bar", 4.5),
    (".storm-bar strong", "storm bar heading", 4.5),
    (".storm-bar label", "storm bar label", 4.5),
    (".motion-label", "storm motion badge", 4.5),
    (".impacted-bar", "impacted bar", 4.5),
    (".impacted-label", "impacted label", 4.5),
    (".panel-label", "panel heading", 4.5),
    (".bullet-section", "bullet section heading", 4.5),
    (".bullet-option", "bullet option", 4.5),
    ("#output", "bulletin output", 4.5),
    ("#status", "status message", 4.5),
    ("select", "select control", 4.5),
    ("button", "button", 4.5),
    (".primary-btn", "primary button", 4.5),
    (".secondary-btn", "secondary button", 4.5),
    ("#clear-poly-btn", "clear button", 4.5),
];

/// Panels that only render for product states this test does not drive (the watch panel, the
/// fill-in panel) are checked as declared pairings: foreground, background, name, floor.
const PALETTE_PAIRS: [(&str, &str, &str, f64); 37] = [
    ("--wg-text", "--wg-bg", "body text", 4.5),
    ("--wg-text", "--wg-surface-sunken", "input text", 4.5),
    ("--wg-text", "--wg-control-bg", "control text", 4.5),
    ("--wg-text-output", "--wg-surface-sunken", "bulletin text", 4.5),
    ("--wg-text-bar", "--wg-surface-bar", "bar text", 4.5),
    ("--wg-text-bar", "--wg-surface-raised", "raised bar text", 4.5),
    ("--wg-text-option", "--wg-surface-panel", "bullet option", 4.5),
    ("--wg-text-checkbox", "--wg-bg", "checkbox label", 4.5),
    ("--wg-text-label", "--wg-surface-raised", "field label", 4.5),
    ("--wg-text-dim", "--wg-surface-panel", "empty-state text", 4.5),
    ("--wg-text-dim", "--wg-bg", "phase label", 4.5),
    ("--wg-accent", "--wg-surface-bar", "panel heading", 4.5),
    ("--wg-accent", "--wg-surface-raised", "impacted label", 4.5),
    ("--wg-accent", "--wg-surface-panel", "bullet section heading", 4.5),
    ("--wg-accent", "--wg-control-bg", "map tooltip", 4.5),
    ("--wg-primary-text", "--wg-button-bg", "button label", 4.5),
    ("--wg-primary-text", "--wg-button-hover-bg", "button hover label", 4.5),
    ("--wg-accent-alt", "--wg-accent-bg", "watch button", 4.5),
    ("--wg-accent-alt", "--wg-accent-bg-hover", "watch button hover", 4.5),
    ("--wg-accent-alt", "--wg-accent-surface", "fill-in label", 4.5),
    ("--wg-accent-alt", "--wg-control-bg", "storm motion badge", 4.5),
    ("--wg-accent-dim", "--wg-accent-surface", "watch empty text", 4.5),
    ("--wg-accent-dim", "--wg-accent-bg", "panel hint", 4.5),
    ("--wg-info", "--wg-surface-raised", "storm bar heading", 4.5),
    ("--wg-danger", "--wg-danger-bg", "clear button", 4.5),
    ("--wg-info", "--wg-surface-raised", "product bar heading", 4.5),
    ("--wg-danger-text", "--wg-danger", "danger button", 4.5),
    ("--wg-danger-text", "--wg-danger-hover", "danger button hover", 4.5),
    ("--wg-success", "--wg-surface-bar", "success text", 4.5),
    ("--wg-primary-text", "--wg-primary-bg", "primary button", 4.5),
    ("--wg-primary-text", "--wg-primary-bg-hover", "primary button hover", 4.5),
    ("--wg-text", "--wg-surface-sunken", "modal text", 4.5),
    ("--wg-map-county-stroke", "--wg-map-canvas", "county boundary", 3.0),
    ("--wg-map-draw-stroke", "--wg-map-canvas", "drawn polygon edge", 3.0),
    ("--wg-map-hit-stroke", "--wg-map-canvas", "impacted county edge", 3.0),
    ("--wg-map-marine-stroke", "--wg-map-canvas", "marine zone edge", 3.0),
    ("--wg-map-zone-stroke", "--wg-map-canvas", "forecast zone edge", 3.0),
];

/// Each element's colour plus the first opaque background painted behind it.
const RESOLVE_JS: &str = r#"
const out = {};
for (const selector of arguments[0]) {
    const el = document.querySelector(selector);
    if (!el) { out[selector] = null; continue; }
    const style = getComputedStyle(el);
    let node = el;
    let background = null;
    while (node) {
        const bg = getComputedStyle(node).backgroundColor;
        const m = bg.match(/rgba?\(([^)]+)\)/);
        if (m) {
            const parts = m[1].split(',').map((v) => parseFloat(v.trim()));
            if (parts.length < 4 || parts[3] > 0.99) { background = bg; break; }
        }
        node = node.parentElement;
    }
    out[selector] = { color: style.color, background: background || getComputedStyle(document.body).backgroundColor };
}
return out;
"#;

const LITERAL_SCAN_JS: &str = r#"
const sheet = Array.from(document.styleSheets).find((s) => (s.href || '').endsWith('warngen.css'));
if (!sheet) return ['warngen.css stylesheet not found'];
const found = [];
const walk = (rules) => {
    for (const rule of rules) {
        if (rule.cssRules) { walk(rule.cssRules); continue; }
        if (!rule.style) continue;
        for (const prop of rule.style) {
            if (prop.startsWith('--')) continue;
            const value = rule.style.getPropertyValue(prop);
            if (/#[0-9a-fA-F]{3,8}\b|rgba?\(/.test(value)) found.push(rule.selectorText + ' { ' + prop + ': ' + value + ' }');
        }
    }
};
walk(sheet.cssRules);
return found;
"#;

/// rgb()/rgba() or #rgb/#rrggbb/#rrggbbaa; the alpha byte only appears on map fills, which
/// these pairs never use, so it is dropped.
fn parse_color(value: &str) -> Result<(f64, f64, f64)> {
    let value = value.trim();
    if let Some(hex) = value.strip_prefix('#') {
        let digits: String = if hex.len() == 3 { hex.chars().flat_map(|c| [c, c]).collect() } else { hex.to_string() };
        let channel = |i: usize| u8::from_str_radix(&digits[i..i + 2], 16).map(f64::from);
        return Ok((channel(0)?, channel(2)?, channel(4)?));
    }
    let inner = value.split_once('(').and_then(|(_, r)| r.rsplit_once(')')).map(|(i, _)| i).context(format!("bad colour {value}"))?;
    let parts: Vec<f64> = inner.split(',').map(|p| p.trim().parse()).collect::<Result<_, _>>()?;
    Ok((parts[0], parts[1], parts[2]))
}

fn luminance((r, g, b): (f64, f64, f64)) -> f64 {
    let channel = |c: f64| {
        let c = c / 255.0;
        if c <= 0.03928 { c / 12.92 } else { ((c + 0.055) / 1.055).powf(2.4) }
    };
    0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
}

fn contrast(fg: &str, bg: &str) -> Result<f64> {
    let (a, b) = (luminance(parse_color(fg)?), luminance(parse_color(bg)?));
    Ok((a.max(b) + 0.05) / (a.min(b) + 0.05))
}

async fn open(tab: &Tab, scheme: &str) -> Result<()> {
    tab.emulate_media(&[("prefers-color-scheme", scheme)]).await?;
    tab.goto("warngen/").await?;
    tab.wait_until("!!document.querySelector('.bullet-option')", Duration::from_secs(40)).await
}

const MAP_COLORS_JS: &str = "[mapColor('--wg-map-county-stroke'), mapColor('--wg-map-county-fill'), mapColor('--wg-map-draw-stroke'), countyStyle().fillColor]";

pub fn cases() -> Vec<Case> {
    let mut cases = Vec::new();
    for scheme in ["light", "dark"] {
        cases.push(case(format!("warngen_text_meets_wcag_aa[{scheme}]"), move |tab| async move {
            open(&tab, scheme).await?;
            let selectors: Vec<&str> = PROBES.iter().map(|p| p.0).collect();
            let resolved: Value = tab.js(RESOLVE_JS, json!([selectors])).await?;
            let mut missing = Vec::new();
            let mut failures = Vec::new();
            for (selector, name, floor) in PROBES {
                let info = &resolved[selector];
                if info.is_null() {
                    missing.push(format!("{name} ({selector})"));
                    continue;
                }
                let (fg, bg) = (info["color"].as_str().unwrap_or(""), info["background"].as_str().unwrap_or(""));
                let ratio = contrast(fg, bg)?;
                if ratio < floor {
                    failures.push(format!("{name} ({selector}): {ratio:.2}:1, need {floor}:1 [{fg} on {bg}]"));
                }
            }
            ensure!(missing.is_empty(), "{scheme}: selectors not present: {missing:?}");
            ensure!(failures.is_empty(), "{scheme} mode contrast failures:\n  {}", failures.join("\n  "));
            Ok(())
        }));
        cases.push(case(format!("warngen_palette_pairings_meet_wcag_aa[{scheme}]"), move |tab| async move {
            open(&tab, scheme).await?;
            let mut names: Vec<&str> = PALETTE_PAIRS.iter().flat_map(|p| [p.0, p.1]).collect();
            names.sort();
            names.dedup();
            let values: std::collections::HashMap<String, String> = tab
                .js(
                    "const style = getComputedStyle(document.documentElement); const out = {};
                     for (const name of arguments[0]) out[name] = style.getPropertyValue(name).trim();
                     return out;",
                    json!([names]),
                )
                .await?;
            let unresolved: Vec<&&str> = names.iter().filter(|n| values.get(**n).map_or(true, |v| v.is_empty())).collect();
            ensure!(unresolved.is_empty(), "{scheme}: variables not declared: {unresolved:?}");
            let mut failures = Vec::new();
            for (fg, bg, name, floor) in PALETTE_PAIRS {
                let ratio = contrast(&values[fg], &values[bg])?;
                if ratio < floor {
                    failures.push(format!("{name}: {ratio:.2}:1, need {floor}:1 [{fg} {} on {bg} {}]", values[fg], values[bg]));
                }
            }
            ensure!(failures.is_empty(), "{scheme} palette contrast failures:\n  {}", failures.join("\n  "));
            Ok(())
        }));
        // Both palettes live in warngen.css; a colour painted from a literal would ignore the theme.
        cases.push(case(format!("every_warngen_colour_comes_from_a_variable[{scheme}]"), move |tab| async move {
            open(&tab, scheme).await?;
            let literals: Vec<String> = tab.js(LITERAL_SCAN_JS, json!([])).await?;
            ensure!(literals.is_empty(), "hardcoded colours in warngen.css:\n  {}", literals.join("\n  "));
            Ok(())
        }));
    }
    // The mobile apps OTA warngen.css but keep their bundled warngen/index.html, which may not link
    // the site's style.css, so every var(--color-*) the palette borrows needs its own fallback.
    cases.push(case("warngen_renders_without_the_site_stylesheet[dark]", |tab| async move {
        open(&tab, "dark").await?;
        let result: Value = tab
            .js(
                "for (const sheet of document.styleSheets) {
                     if (/\\/assets\\/css\\/(style|hack)\\.css$/.test(sheet.href || '')) sheet.disabled = true;
                 }
                 const root = getComputedStyle(document.documentElement);
                 const body = getComputedStyle(document.body);
                 const button = getComputedStyle(document.getElementById('start-draw-btn'));
                 return { bg: root.getPropertyValue('--wg-bg').trim(), text: root.getPropertyValue('--wg-text').trim(),
                          bodyBg: body.backgroundColor, bodyColor: body.color, buttonBg: button.backgroundColor, buttonColor: button.color };",
                json!([]),
            )
            .await?;
        let transparent = |v: &Value| v.as_str().map_or(true, |s| s.is_empty() || s == "rgba(0, 0, 0, 0)" || s == "transparent");
        ensure!(!transparent(&result["bg"]) && !transparent(&result["text"]), "palette unresolved without style.css: {result}");
        ensure!(!transparent(&result["bodyBg"]) && !transparent(&result["buttonBg"]), "surfaces went transparent without style.css: {result}");
        let ratio = contrast(result["buttonColor"].as_str().unwrap_or(""), result["buttonBg"].as_str().unwrap_or(""))?;
        ensure!(ratio >= 4.5, "button text {ratio:.2}:1 without style.css: {result}");
        Ok(())
    }));
    // Leaflet layer styling lives in JS, so it reads the CSS variables.
    cases.push(case("map_layer_colours_track_the_theme", |tab| async move {
        open(&tab, "light").await?;
        let light: Vec<String> = tab.eval(MAP_COLORS_JS).await?;
        open(&tab, "dark").await?;
        let dark: Vec<String> = tab.eval(MAP_COLORS_JS).await?;
        ensure!(light.iter().all(|v| !v.is_empty()), "light map colours unresolved: {light:?}");
        ensure!(dark.iter().all(|v| !v.is_empty()), "dark map colours unresolved: {dark:?}");
        ensure!(light != dark, "map layer colours are identical in both schemes");
        ensure!(light[3] == light[1] && dark[3] == dark[1], "countyStyle ignores its variable: {light:?} {dark:?}");
        Ok(())
    }));
    cases
}
