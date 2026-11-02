pub mod axe;
pub mod browser;
pub mod img;
mod runner;
pub mod server;
pub mod tab;

use std::future::Future;
use std::pin::Pin;
use std::sync::Arc;

pub use anyhow::{anyhow, bail, ensure, Context, Result};
pub use serde_json::{json, Value};
pub use std::time::Duration;
pub use tab::Tab;

type BoxFuture = Pin<Box<dyn Future<Output = Result<()>> + Send + 'static>>;

enum Body {
    Browser(Arc<dyn Fn(Tab) -> BoxFuture + Send + Sync>),
    Plain(Arc<dyn Fn() -> Result<()> + Send + Sync>),
}

pub struct Case {
    name: String,
    body: Body,
}

/// A test that gets its own isolated browser tab.
pub fn case<F, Fut>(name: impl Into<String>, f: F) -> Case
where
    F: Fn(Tab) -> Fut + Send + Sync + 'static,
    Fut: Future<Output = Result<()>> + Send + 'static,
{
    Case {
        name: name.into(),
        body: Body::Browser(Arc::new(move |tab| Box::pin(f(tab)))),
    }
}

/// A test that never touches the browser.
pub fn plain<F>(name: impl Into<String>, f: F) -> Case
where
    F: Fn() -> Result<()> + Send + Sync + 'static,
{
    Case {
        name: name.into(),
        body: Body::Plain(Arc::new(f)),
    }
}

fn run_case(body: &Body) -> Result<()> {
    match body {
        Body::Plain(f) => f(),
        Body::Browser(f) => {
            let f = Arc::clone(f);
            browser::runtime().block_on(async move {
                let tab = browser::open_tab().await?;
                let outcome = tokio::spawn(f(tab.clone())).await;
                tab.close().await;
                match outcome {
                    Ok(result) => result,
                    Err(join) => Err(anyhow!("test panicked: {join}")),
                }
            })
        }
    }
}

pub fn run(groups: Vec<(&'static str, Vec<Case>)>) -> std::process::ExitCode {
    let invocation = match runner::Invocation::from_env() {
        Ok(invocation) => invocation,
        Err(error) => {
            eprintln!("e2e runner arguments: {error:#}");
            return std::process::ExitCode::from(2);
        }
    };
    if invocation.runner == runner::Runner::Container {
        return match runner::run_container(&invocation.args, invocation.build_container) {
            Ok(code) => code,
            Err(error) => {
                eprintln!("container e2e runner failed: {error:#}");
                std::process::ExitCode::FAILURE
            }
        };
    }

    let mut args = libtest_mimic::Arguments::from_iter(invocation.args);
    if args.test_threads.is_none() {
        args.test_threads = Some(
            std::env::var("EAS_TOOLS_TABS")
                .ok()
                .and_then(|v| v.parse().ok())
                .unwrap_or(browser::DEFAULT_TABS),
        );
    }
    let slow_after = slow_threshold();
    let trials = groups
        .into_iter()
        .flat_map(|(module, cases)| {
            cases.into_iter().map(move |c| {
                let body = c.body;
                let name = format!("{module}::{}", c.name);
                libtest_mimic::Trial::test(name.clone(), move || {
                    let started = std::time::Instant::now();
                    let outcome = run_case(&body).map_err(|e| format!("{e:#}").into());
                    let elapsed = started.elapsed();
                    if slow_after.is_some_and(|limit| elapsed > limit) {
                        eprintln!("[slow] {name} {:.1}s", elapsed.as_secs_f64());
                    }
                    outcome
                })
            })
        })
        .collect();
    let conclusion = libtest_mimic::run(&args, trials);
    browser::runtime().block_on(browser::shutdown());
    conclusion.exit_code()
}

/// `[slow]` reporting: EAS_TOOLS_SLOW_SECS sets the threshold and 0 turns it off. Unset, it is 2 s
/// locally and off under CI, where shared runners make every test slow and the notes are noise.
fn slow_threshold() -> Option<Duration> {
    match std::env::var("EAS_TOOLS_SLOW_SECS")
        .ok()
        .and_then(|v| v.trim().parse::<f64>().ok())
    {
        Some(secs) if secs > 0.0 => Some(Duration::from_secs_f64(secs)),
        Some(_) => None,
        None if std::env::var_os("CI").is_some() => None,
        None => Some(Duration::from_secs(2)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn case_and_plain_constructors_preserve_names_and_bodies() {
        let browser_case = case("browser", |_tab| async { Ok(()) });
        assert_eq!(browser_case.name, "browser");
        assert!(matches!(browser_case.body, Body::Browser(_)));

        let plain_case = plain("plain", || Ok(()));
        assert_eq!(plain_case.name, "plain");
        assert!(matches!(plain_case.body, Body::Plain(_)));
        assert!(run_case(&plain_case.body).is_ok());

        let failed_case = plain("failed", || bail!("expected failure"));
        assert!(run_case(&failed_case.body).is_err());
    }

    #[test]
    fn slow_threshold_parses_positive_zero_invalid_and_ci_defaults() {
        let original_slow = std::env::var_os("EAS_TOOLS_SLOW_SECS");
        let original_ci = std::env::var_os("CI");

        std::env::set_var("EAS_TOOLS_SLOW_SECS", "1.25");
        assert_eq!(slow_threshold(), Some(Duration::from_secs_f64(1.25)));
        std::env::set_var("EAS_TOOLS_SLOW_SECS", "0");
        assert_eq!(slow_threshold(), None);
        std::env::set_var("EAS_TOOLS_SLOW_SECS", "not-a-number");
        std::env::remove_var("CI");
        assert_eq!(slow_threshold(), Some(Duration::from_secs(2)));
        std::env::remove_var("EAS_TOOLS_SLOW_SECS");
        std::env::set_var("CI", "1");
        assert_eq!(slow_threshold(), None);

        match original_slow {
            Some(value) => std::env::set_var("EAS_TOOLS_SLOW_SECS", value),
            None => std::env::remove_var("EAS_TOOLS_SLOW_SECS"),
        }
        match original_ci {
            Some(value) => std::env::set_var("CI", value),
            None => std::env::remove_var("CI"),
        }
    }
}
