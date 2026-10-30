use std::sync::OnceLock;

use anyhow::{bail, Result};
use serde_json::{json, Value};

use crate::browser::repo_root;
use crate::tab::Tab;

const FAILING_IMPACTS: [&str; 2] = ["critical", "serious"];

fn source() -> &'static str {
    static SRC: OnceLock<String> = OnceLock::new();
    SRC.get_or_init(|| {
        std::fs::read_to_string(repo_root().join("test/e2e-rs/vendor/axe.min.js")).expect("vendored axe.min.js")
    })
}

/// Runs axe-core and returns the violations whose impact fails the build, minus `allowed` rule ids.
pub async fn failing(tab: &Tab, context: Value, allowed: &[&str]) -> Result<Vec<Value>> {
    failing_with(tab, context, json!({ "resultTypes": ["violations"] }), allowed).await
}

/// Like `failing`, with explicit axe.run options (e.g. `runOnly`).
pub async fn failing_with(tab: &Tab, context: Value, options: Value, allowed: &[&str]) -> Result<Vec<Value>> {
    let present: bool = tab.eval("typeof window.axe !== 'undefined'").await?;
    if !present {
        tab.exec(source(), json!([])).await?;
    }
    let result: Value = tab
        .js_async(
            "const done = arguments[arguments.length - 1];
             window.axe.run(arguments[0] || document, arguments[1])
                 .then(done).catch((err) => done({ error: String(err) }));",
            json!([context, options]),
        )
        .await?;
    if let Some(error) = result.get("error") {
        bail!("axe.run failed: {error}");
    }
    Ok(result["violations"]
        .as_array()
        .cloned()
        .unwrap_or_default()
        .into_iter()
        .filter(|v| {
            let impact = v["impact"].as_str().unwrap_or("minor");
            let id = v["id"].as_str().unwrap_or("");
            FAILING_IMPACTS.contains(&impact) && !allowed.contains(&id)
        })
        .collect())
}

pub fn describe(violations: &[Value], label: &str) -> String {
    let mut out = format!("{label}: {} failing axe violation(s)", violations.len());
    for v in violations {
        out.push_str(&format!("\n  [{}] {}: {}", v["impact"], v["id"], v["help"]));
        for node in v["nodes"].as_array().into_iter().flatten().take(5) {
            out.push_str(&format!("\n    {}", node["target"]));
        }
    }
    out
}

pub async fn assert_clean(tab: &Tab, context: Value, allowed: &[&str], label: &str) -> Result<()> {
    let violations = failing(tab, context, allowed).await?;
    if !violations.is_empty() {
        bail!(describe(&violations, label));
    }
    Ok(())
}
