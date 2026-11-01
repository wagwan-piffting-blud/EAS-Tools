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
    if let Some(tabs) = std::env::var_os("EAS_TOOLS_TABS") {
        command
            .arg("--env")
            .arg(format!("EAS_TOOLS_TABS={}", tabs.to_string_lossy()));
    }
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

    #[test]
    fn environment_flags_and_external_runner_paths_are_deterministic() {
        let original_docker = std::env::var_os("EAS_TOOLS_DOCKER");
        let original_chrome = std::env::var_os("EAS_TOOLS_CHROME");
        let original_skip = std::env::var_os("EAS_TOOLS_E2E_SKIP_BUILD");
        let original_args = std::env::var_os("EAS_TOOLS_E2E_BUILD_ARGS");

        std::env::set_var("EAS_TOOLS_DOCKER", "/bin/true");
        std::env::set_var("EAS_TOOLS_CHROME", "/does/not/exist");
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
        std::env::set_var("EAS_TOOLS_DOCKER", "/bin/false");
        assert!(container_available().is_none());
        assert!(auto_runner().is_err());
        std::env::set_var("EAS_TOOLS_DOCKER", "/bin/true");

        std::env::set_var("EAS_TOOLS_CHROME", "/bin/true");
        assert_eq!(auto_runner().unwrap(), (Runner::Native, false));
        assert_eq!(
            run_container(&[OsString::from("e2e"), OsString::from("--list")], false).unwrap(),
            ExitCode::SUCCESS
        );
        assert_eq!(
            run_container(&[OsString::from("e2e")], true).unwrap(),
            ExitCode::SUCCESS
        );
        std::env::set_var("EAS_TOOLS_DOCKER", "/does/not/exist");
        assert!(run_container(&[OsString::from("e2e")], false).is_err());

        match original_docker {
            Some(value) => std::env::set_var("EAS_TOOLS_DOCKER", value),
            None => std::env::remove_var("EAS_TOOLS_DOCKER"),
        }
        match original_chrome {
            Some(value) => std::env::set_var("EAS_TOOLS_CHROME", value),
            None => std::env::remove_var("EAS_TOOLS_CHROME"),
        }
        match original_skip {
            Some(value) => std::env::set_var("EAS_TOOLS_E2E_SKIP_BUILD", value),
            None => std::env::remove_var("EAS_TOOLS_E2E_SKIP_BUILD"),
        }
        match original_args {
            Some(value) => std::env::set_var("EAS_TOOLS_E2E_BUILD_ARGS", value),
            None => std::env::remove_var("EAS_TOOLS_E2E_BUILD_ARGS"),
        }
    }
}
