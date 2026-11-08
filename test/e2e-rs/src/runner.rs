use std::ffi::{OsStr, OsString};
use std::process::{Command, ExitCode, Stdio};

use anyhow::{bail, Context, Result};

use crate::browser::{native_chrome_available, repo_root};

const DEFAULT_IMAGE: &str = "eas-tools-e2e:local";
const DEFAULT_DOCKERFILE: &str = "test/e2e-rs/Dockerfile";

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum Runner {
    Native,
    Container,
}

pub(crate) struct Invocation {
    pub runner: Runner,
    pub args: Vec<OsString>,
    pub build_container: bool,
}

impl Invocation {
    pub fn from_env() -> Result<Self> {
        let parsed = Self::parse(std::env::args_os())?;
        let (runner, build_container) = match parsed.runner {
            Some(runner) => (runner, true),
            None => auto_runner()?,
        };
        eprintln!("[e2e] selected {runner:?} runner");
        Ok(Self {
            runner,
            args: parsed.args,
            build_container,
        })
    }

    fn parse(args: impl IntoIterator<Item = OsString>) -> Result<ParsedInvocation> {
        let mut input = args.into_iter();
        let executable = input
            .next()
            .unwrap_or_else(|| OsString::from("eas-tools-e2e"));
        let mut forwarded = vec![executable];
        let mut runner = None;
        let mut runner_seen = false;

        while let Some(arg) = input.next() {
            if arg == "--runner" {
                let value = input
                    .next()
                    .context("--runner requires auto, native, or container")?;
                set_runner(&mut runner, &mut runner_seen, &value)?;
            } else if let Some(value) = arg
                .to_str()
                .and_then(|value| value.strip_prefix("--runner="))
            {
                set_runner(&mut runner, &mut runner_seen, OsStr::new(value))?;
            } else {
                forwarded.push(arg);
            }
        }

        Ok(ParsedInvocation {
            runner,
            args: forwarded,
        })
    }
}

struct ParsedInvocation {
    runner: Option<Runner>,
    args: Vec<OsString>,
}

fn set_runner(slot: &mut Option<Runner>, seen: &mut bool, value: &OsStr) -> Result<()> {
    if *seen {
        bail!("--runner may only be specified once");
    }
    *seen = true;
    *slot = match value.to_str() {
        Some("auto") => None,
        Some("native") => Some(Runner::Native),
        Some("container") => Some(Runner::Container),
        _ => bail!("--runner must be auto, native, or container, got {value:?}"),
    };
    Ok(())
}

fn auto_runner() -> Result<(Runner, bool)> {
    if native_chrome_available() {
        return Ok((Runner::Native, false));
    }
    if let Some(build_container) = container_available() {
        return Ok((Runner::Container, build_container));
    }
    bail!("no usable native Chromium or Docker-compatible E2E runner found; set EAS_TOOLS_CHROME, install Docker, or pass --runner explicitly")
}

/// Returns whether a container runner is usable and whether it needs a build.
fn container_available() -> Option<bool> {
    let docker = std::env::var_os("EAS_TOOLS_DOCKER").unwrap_or_else(|| OsString::from("docker"));
    let engine = Command::new(&docker)
        .args(["version", "--format", "{{.Server.Version}}"])
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map(|status| status.success())
        .unwrap_or(false);
    if !engine {
        return None;
    }

    let image = std::env::var("EAS_TOOLS_E2E_IMAGE").unwrap_or_else(|_| DEFAULT_IMAGE.to_string());
    let image_exists = Command::new(&docker)
        .args(["image", "inspect", &image])
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map(|status| status.success())
        .unwrap_or(false);
    if image_exists {
        return Some(false);
    }
    if env_flag("EAS_TOOLS_E2E_SKIP_BUILD") {
        return None;
    }

    let voice = repo_root().join("assets/wasm_tts_voices/espeak/espeak-ng.eas.data");
    std::fs::read_to_string(voice)
        .map(|contents| !contents.starts_with("version https://git-lfs.github.com/spec/"))
        .ok()
        .filter(|materialized| *materialized)
        .map(|_| true)
}

pub(crate) fn run_container(test_args: &[OsString], build_container: bool) -> Result<ExitCode> {
    let docker = std::env::var_os("EAS_TOOLS_DOCKER").unwrap_or_else(|| OsString::from("docker"));
    let image = std::env::var("EAS_TOOLS_E2E_IMAGE").unwrap_or_else(|_| DEFAULT_IMAGE.to_string());
    let dockerfile = std::env::var_os("EAS_TOOLS_E2E_DOCKERFILE")
        .unwrap_or_else(|| OsString::from(DEFAULT_DOCKERFILE));
    let root = repo_root();

    if build_container && !env_flag("EAS_TOOLS_E2E_SKIP_BUILD") {
        eprintln!("[e2e] building container image {image}");
        let status = Command::new(&docker)
            .current_dir(&root)
            .args([
                "build",
                "--file",
                dockerfile.to_string_lossy().as_ref(),
                "--tag",
                &image,
            ])
            .args(build_args())
            .arg(".")
            .status()
            .with_context(|| format!("start {:?} build", docker))?;
        if !status.success() {
            bail!("container image build exited with {status}");
        }
    }

    eprintln!("[e2e] running {image}");
    let mut command = Command::new(&docker);
    command.args([
        "run",
        "--rm",
        "--init",
        "--read-only",
        "--cap-drop=ALL",
        "--security-opt=no-new-privileges",
        "--shm-size=1g",
        "--tmpfs",
        "/tmp:rw,nosuid,nodev,size=2g",
    ]);
    command.args(forwarded_env_args(|name| std::env::var_os(name)));
    command.arg(&image).args(test_args.iter().skip(1));
    let status = command
        .status()
        .with_context(|| format!("start {:?} run", docker))?;
    Ok(match status.code() {
        Some(0) => ExitCode::SUCCESS,
        Some(code) => ExitCode::from(code.clamp(1, 255) as u8),
        None => ExitCode::FAILURE,
    })
}

fn build_args() -> Vec<OsString> {
    std::env::var_os("EAS_TOOLS_E2E_BUILD_ARGS")
        .map(|value| {
            value
                .to_string_lossy()
                .split_whitespace()
                .map(OsString::from)
                .collect()
        })
        .unwrap_or_default()
}

/// Host settings the suite reads, passed into the container so it behaves like a native run;
/// `CI` keeps the `[slow]` notes off under CI.
const FORWARDED_ENV: [&str; 3] = ["EAS_TOOLS_TABS", "EAS_TOOLS_SLOW_SECS", "CI"];

fn forwarded_env_args(lookup: impl Fn(&str) -> Option<OsString>) -> Vec<OsString> {
    FORWARDED_ENV
        .iter()
        .filter_map(|name| {
            lookup(name).map(|value| OsString::from(format!("{name}={}", value.to_string_lossy())))
        })
        .flat_map(|pair| [OsString::from("--env"), pair])
        .collect()
}

fn env_flag(name: &str) -> bool {
    std::env::var(name)
        .map(|value| {
            matches!(
                value.trim().to_ascii_lowercase().as_str(),
                "1" | "true" | "yes"
            )
        })
        .unwrap_or(false)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn native_is_the_default_and_libtest_arguments_are_preserved() {
        let invocation =
            Invocation::parse(["e2e", "decoder_same", "--skip", "quiet"].map(OsString::from))
                .unwrap();
        assert_eq!(invocation.runner, None);
        assert_eq!(
            invocation
                .args
                .iter()
                .map(|value| value.to_string_lossy().into_owned())
                .collect::<Vec<_>>(),
            ["e2e", "decoder_same", "--skip", "quiet"]
        );
    }

    #[test]
    fn container_receives_the_suite_settings_that_are_set() {
        let args = forwarded_env_args(|name| match name {
            "EAS_TOOLS_TABS" => Some(OsString::from("4")),
            "CI" => Some(OsString::from("true")),
            _ => None,
        });
        assert_eq!(
            args,
            ["--env", "EAS_TOOLS_TABS=4", "--env", "CI=true"].map(OsString::from)
        );
        assert!(forwarded_env_args(|_| None).is_empty());
    }

    #[test]
    fn runner_is_removed_before_libtest_parses_the_arguments() {
        let invocation =
            Invocation::parse(["e2e", "--runner", "container", "--list"].map(OsString::from))
                .unwrap();
        assert_eq!(invocation.runner, Some(Runner::Container));
        assert_eq!(invocation.args, ["e2e", "--list"].map(OsString::from));

        let invocation =
            Invocation::parse(["e2e", "--runner=native", "site_tools"].map(OsString::from))
                .unwrap();
        assert_eq!(invocation.runner, Some(Runner::Native));
        assert_eq!(invocation.args, ["e2e", "site_tools"].map(OsString::from));

        let invocation =
            Invocation::parse(["e2e", "--runner", "auto", "--list"].map(OsString::from)).unwrap();
        assert_eq!(invocation.runner, None);
        assert_eq!(invocation.args, ["e2e", "--list"].map(OsString::from));
    }

    #[test]
    fn invalid_and_duplicate_runners_are_rejected() {
        assert!(Invocation::parse(["e2e", "--runner", "podman"].map(OsString::from)).is_err());
        assert!(Invocation::parse(
            ["e2e", "--runner=native", "--runner=container"].map(OsString::from)
        )
        .is_err());
    }

    #[test]
    fn missing_runner_value_and_forwarded_arguments_are_rejected_or_preserved() {
        assert!(Invocation::parse(["e2e", "--runner"].map(OsString::from)).is_err());
        let parsed = Invocation::parse(
            ["e2e", "--list", "--exact", "a test", "--nocapture"].map(OsString::from),
        )
        .unwrap();
        assert_eq!(parsed.runner, None);
        assert_eq!(parsed.args.len(), 5);
    }

    fn process_fixture(name: &str, exit_code: i32) -> std::path::PathBuf {
        let extension = if cfg!(windows) { "bat" } else { "sh" };
        let path = std::env::temp_dir().join(format!(
            "eas-tools-runner-test-{}-{name}.{extension}",
            std::process::id()
        ));
        let contents = if cfg!(windows) {
            format!("@exit /b {exit_code}\r\n")
        } else {
            format!("#!/bin/sh\nexit {exit_code}\n")
        };
        std::fs::write(&path, contents).expect("write process fixture");
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mut permissions = std::fs::metadata(&path)
                .expect("process fixture metadata")
                .permissions();
            permissions.set_mode(0o755);
            std::fs::set_permissions(&path, permissions).expect("make process fixture executable");
        }
        path
    }

    fn restore_env(name: &str, value: Option<OsString>) {
        match value {
            Some(value) => std::env::set_var(name, value),
            None => std::env::remove_var(name),
        }
    }

    #[test]
    fn environment_flags_and_external_runner_paths_are_deterministic() {
        let original_docker = std::env::var_os("EAS_TOOLS_DOCKER");
        let original_chrome = std::env::var_os("EAS_TOOLS_CHROME");
        let original_skip = std::env::var_os("EAS_TOOLS_E2E_SKIP_BUILD");
        let original_args = std::env::var_os("EAS_TOOLS_E2E_BUILD_ARGS");
        let passing_process = process_fixture("pass", 0);
        let failing_process = process_fixture("fail", 1);
        let missing_process = std::env::temp_dir().join(format!(
            "eas-tools-runner-test-{}-missing",
            std::process::id()
        ));

        std::env::set_var("EAS_TOOLS_DOCKER", &passing_process);
        std::env::set_var("EAS_TOOLS_CHROME", &missing_process);
        std::env::remove_var("EAS_TOOLS_E2E_SKIP_BUILD");
        std::env::remove_var("EAS_TOOLS_E2E_BUILD_ARGS");
        assert!(build_args().is_empty());
        std::env::set_var("EAS_TOOLS_E2E_BUILD_ARGS", "--foo bar");
        assert_eq!(
            build_args(),
            vec![OsString::from("--foo"), OsString::from("bar")]
        );
        assert!(!env_flag("EAS_TOOLS_E2E_SKIP_BUILD"));
        std::env::set_var("EAS_TOOLS_E2E_SKIP_BUILD", "YeS");
        assert!(env_flag("EAS_TOOLS_E2E_SKIP_BUILD"));
        std::env::set_var("EAS_TOOLS_E2E_SKIP_BUILD", "0");
        assert!(!env_flag("EAS_TOOLS_E2E_SKIP_BUILD"));
        assert_eq!(container_available(), Some(false));
        assert_eq!(auto_runner().unwrap(), (Runner::Container, false));
        std::env::set_var("EAS_TOOLS_DOCKER", &failing_process);
        assert!(container_available().is_none());
        assert!(auto_runner().is_err());
        std::env::set_var("EAS_TOOLS_DOCKER", &passing_process);
        std::env::set_var("EAS_TOOLS_CHROME", &passing_process);
        assert_eq!(auto_runner().unwrap(), (Runner::Native, false));
        assert_eq!(
            run_container(&[OsString::from("e2e"), OsString::from("--list")], false).unwrap(),
            ExitCode::SUCCESS
        );
        assert_eq!(
            run_container(&[OsString::from("e2e")], true).unwrap(),
            ExitCode::SUCCESS
        );
        std::env::set_var("EAS_TOOLS_DOCKER", &missing_process);
        assert!(run_container(&[OsString::from("e2e")], false).is_err());

        restore_env("EAS_TOOLS_DOCKER", original_docker);
        restore_env("EAS_TOOLS_CHROME", original_chrome);
        restore_env("EAS_TOOLS_E2E_SKIP_BUILD", original_skip);
        restore_env("EAS_TOOLS_E2E_BUILD_ARGS", original_args);
        let _ = std::fs::remove_file(passing_process);
        let _ = std::fs::remove_file(failing_process);
    }
}
