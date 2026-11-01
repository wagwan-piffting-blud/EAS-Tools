# Testing and coverage

The stable test interface is GNU Make, with pnpm managing the JavaScript tools.
Run `make test` for quick iteration and `make quality` before handing off a change.

## Unit coverage gate

Vitest and V8 coverage are configured in `vitest.config.mjs`. The gate requires
at least 90% statements, branches, functions, and lines across the files named in
the configuration.

The measured slice covers first-party modules whose behavior is practical to
exercise deterministically under Node:

- Splicer WAV encoding, peak calculation/drawing, limiting, layout, project model,
  rendering, and ZIP handling under `assets/js/splicer/`
- WarnGen UGC and text utilities, geometric inclusion, and radar color tables
  under `warngen/src/`

`tools/coverage-scope.mjs` is the source of truth for the measured file list.
`make coverage-scope` inventories every tracked or untracked JavaScript file and
fails when one lacks a quality-lane classification. This makes the unmeasured
surface explicit: browser runtimes, maintenance tools, integration targets,
generated output, vendored code, and test infrastructure are counted separately.

The 90% threshold is an enforceable boundary over the measured files, not a
claim that 90% of every shipped bundle or browser entrypoint is line-covered.
Move testable first-party modules into `measuredFiles` as substantive tests are
introduced. Do not inflate coverage with generated bundles, vendored libraries,
inert imports, ignored lines, or assertions that merely execute code without
checking behavior.

The VT Paul pronunciation work (GH #158) adds four Vitest files:

- `test/nwr-pronunciation.test.js`: the engine.
- `test/nwr-pronunciation-store.test.js`: storage, repository and submissions.
- `test/nwr-pronunciation-data.test.js`: every shipped set, plus the sync tool.
- `test/nwr-transmitters.test.js`: the generator.

The two `assets/js/nwr-pronunciation*.js` modules are in the measured slice. The
e2e suite `nwr_pronunciation` stubs the TTS server and checks the exact form
body that would be posted.

## Browser end-to-end suite

`make e2e` (or `pnpm run test:e2e`) runs the Rust + Chrome DevTools Protocol suite
in `test/e2e-rs/`. It drives real headless Chrome against the static site through
an in-process server, so it covers what Node unit tests cannot: tool loading,
audio generation and decoding, crawl/video export, WarnGen rendering, handoffs,
and axe-core accessibility checks.

The harness accepts `--runner auto|native|container`. `make e2e` and
`pnpm run test:e2e` use auto selection by default: they choose a usable native
Chrome/Chromium first, then a Docker-compatible E2E runner. `make e2e-container`
still forces the primary distroless, non-root `chromium-headless-shell` image.
The container is the CI path and avoids depending on a runner-installed browser.
Fetch the required eSpeak LFS object before a container build:

```bash
git lfs pull --include="assets/wasm_tts_voices/espeak/espeak-ng.eas.data"
make e2e-container
```

`make e2e-container-full-chromium` builds and runs the secondary
`eas-tools-e2e:full-chromium` image with the regular Chromium executable. It is
kept as a compatibility fallback; the headless-shell image is now primary.

- In native mode, `EAS_TOOLS_CHROME` points at a specific Chrome binary. Without it, the suite
  uses the standard Windows install, then whatever `google-chrome`/`chromium` is
  on `PATH`.
- `EAS_TOOLS_TABS` sets the number of parallel Chrome instances (default 8).
- In native mode, `EAS_TOOLS_BASE_URL` tests an already running server instead
  of the built-in one.
- `EAS_TOOLS_E2E_IMAGE`, `EAS_TOOLS_DOCKER`, and
  `EAS_TOOLS_E2E_SKIP_BUILD=1` customize container image selection, the
  Docker-compatible CLI, and use of an already-built image respectively.
- `EAS_TOOLS_E2E_DOCKERFILE` and `EAS_TOOLS_E2E_BUILD_ARGS` select the Dockerfile
  and pass whitespace-separated build arguments; the full-Chromium Make target
  sets these automatically.
- `E2E_RUNNER=auto|native|container` controls Make-based selection; direct Cargo
  invocations use `--runner auto|native|container`.

Auto mode reuses the configured image when it already exists. Otherwise it
requires a reachable Docker-compatible engine and usable build inputs before
building; `EAS_TOOLS_E2E_SKIP_BUILD=1` still requires the image to exist. This
avoids starting a build that will fail later on a Git LFS pointer checkout.

`suites/main.rs` is generated. After adding a suite file, run
`node test/e2e-rs/gen_main.mjs`. `make e2e-check` rejects a stale registry,
`rustfmt` drift, Cargo compiler errors, and Clippy warnings before the browser
suite runs. It also runs `cargo llvm-cov` and fails below 90% line coverage for
the deterministic E2E support surface (`img.rs`, `runner.rs`, and `server.rs`).
The live-CDP adapters (`axe.rs`, `browser.rs`, `tab.rs`) and the top-level
browser orchestrator (`lib.rs`) remain covered by the browser suite itself and
are excluded from this unit-only coverage boundary. Install `cargo-llvm-cov`
and Rust's `llvm-tools-preview` component before running it locally:

```bash
rustup component add llvm-tools-preview
cargo install cargo-llvm-cov --locked
```

An unregistered suite is never compiled or run. See
`test/e2e-rs/README.md` for the harness API and isolation model.

## Other validation layers

- `make protocol-test` exercises recorder boundaries and differential SAME audio
  scenarios that ordinary unit tests do not model.
- `make warngen-test` renders the modern and legacy product corpora and reports
  output/reference discrepancies.
- `make docs-check` checks generated HTML-to-Markdown parity, local links, and the
  repository documentation coverage map.
- `make skills-check` validates the metadata and structure of agent skills.

Browser-visible changes also require proportionate manual or automated browser
inspection for loading, navigation, focus, screen-reader semantics, workers,
offline behavior, and responsive layout. A difference is a regression only when
it violates an accepted requirement, preserved behavior, authoritative baseline,
or explicitly intended compatibility—not merely because two captures differ.
