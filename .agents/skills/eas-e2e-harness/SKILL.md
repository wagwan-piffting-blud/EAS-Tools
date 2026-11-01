---
name: eas-e2e-harness
description: Add, run, diagnose, or containerize EAS Tools Rust browser end-to-end tests while preserving suite discovery, CDP isolation, required fixtures, and honest coverage claims. Use for work under test/e2e-rs or its native and distroless runners.
---

# EAS E2E harness

Read `test/e2e-rs/README.md`, then inspect only the harness module and suite files
relevant to the task. The suite drives Chrome/Chromium through CDP; do not treat
it as WebDriver or as a replacement for the protocol, WarnGen reference, or Node
unit-test lanes.

## Choose the runner deliberately

- Use `make e2e` for automatic runner selection: the harness prefers a usable
  developer-installed Chrome/Chromium and falls back to a usable Docker runner.
- Use `make e2e-container` to reproduce the non-root distroless CI runtime.
- Narrow either mode with `E2E_ARGS=<substring>` while iterating.
- Fetch `assets/wasm_tts_voices/espeak/espeak-ng.eas.data` through Git LFS before
  container builds or eSpeak synthesis cases.

Auto mode reuses the configured local E2E image when it exists; it only requires
the eSpeak fixture when it needs to build a missing image. `EAS_TOOLS_E2E_SKIP_BUILD=1`
requires that image to exist.

The harness option is `--runner auto|native|container` and belongs after Cargo's
`--`. `auto` is the default for direct Cargo invocations and Make-based quality
runs; use an explicit runner only when you need to force a backend.
Container mode must remain an outer launcher: the binary inside the image runs
native mode against its bundled Chromium. Preserve the read-only, non-root,
capability-dropped runtime and keep build-only tools out of the final image.

## Preserve discovery and isolation

After adding or removing `suites/*.rs`, run `node test/e2e-rs/gen_main.mjs` and
review the generated registry. Each browser case must receive a fresh page. Do
not weaken the origin-storage wipe or reuse a context after a failed wipe merely
to improve speed; HTTP and V8 caches are the intentional reusable boundary.

Prefer the existing `Tab`, `img`, `axe`, and `suites/common.rs` helpers. Use real
CDP input for browser behavior and page evaluation for state or artifact
inspection. Assertions should establish behavior, not only element presence.

## Validate the harness

Run, in order of scope:

```bash
make e2e-check
cargo test --manifest-path test/e2e-rs/Cargo.toml --lib
cargo test --manifest-path test/e2e-rs/Cargo.toml --test e2e -- --runner auto --list
make e2e-container E2E_ARGS='<narrow filter>'
```

`make e2e-check` verifies suite discovery, rustfmt, `cargo check --all-targets`,
Clippy with warnings denied, and 90% line coverage through `cargo llvm-cov` for
the deterministic support modules. Install `cargo-llvm-cov` and
`llvm-tools-preview` before running it locally. Fix findings instead of adding
lint allowances or further coverage exclusions; the CDP adapter files are
excluded only because they require the live browser runner.

Run `make e2e` or `make e2e-container` without a filter before a final harness
handoff when the required browser/runtime is available. Also run
`make skills-check` for skill edits and the repository-wide quality workflow
required by `AGENTS.md`. Report native and container evidence separately; a
successful image build, test listing, or narrow case is not a full-suite pass.
