# eas-tools e2e suite (Rust + CDP)

Run with `make e2e` from the repo root. `make quality` and CI include it. It runs
8 slots by default (`EAS_TOOLS_TABS`). Each slot is its own headless Chrome with
one browser context that its tests take turns in. An in-process static server
serves the repo at `/eas-tools` unless `EAS_TOOLS_BASE_URL` is set. Tests slower
than 2 s print `[slow]` to stderr; `EAS_TOOLS_SLOW_SECS` changes the threshold
(`0` turns it off), and it is off by default when `CI` is set. libtest-mimic takes
ONE name filter (substring), plus `--skip`.

## Native and container runners

The harness consumes `--runner auto|native|container` before passing the remaining
arguments to libtest-mimic. `auto` is the default: it uses a usable native
Chromium first, then a Docker-compatible E2E runner. With Cargo, put harness
arguments after `--`:

```bash
# Automatically choose native Chromium or the container
make e2e
cargo test --manifest-path test/e2e-rs/Cargo.toml --test e2e decoder_same

# Force a specific backend when needed
cargo test --manifest-path test/e2e-rs/Cargo.toml --test e2e -- --runner native decoder_same

# Build and run the primary distroless chromium-headless-shell image
make e2e-container
cargo test --manifest-path test/e2e-rs/Cargo.toml --test e2e -- --runner container decoder_same

# Explicit compatibility alias for the primary image
make e2e-container-headless-shell

# Build and run the secondary full Chromium image
make e2e-container-full-chromium
```

Container mode runs `docker build` against `test/e2e-rs/Dockerfile`, then starts
the image read-only as its distroless non-root user. It drops Linux capabilities,
sets `no-new-privileges`, and gives Chromium only a temporary `/tmp`. The final
image contains the release E2E binary, Chromium and its runtime library closure,
font configuration, and the application/fixture files used by the suite. It does
not contain Cargo, a shell, a package manager, unrelated voice engines, Piper
models, Windows VST DLLs, or the unused FFmpeg.wasm payload.

The eSpeak synthesis cases require the real Git LFS object. Fetch it before the
first container build; the Dockerfile fails explicitly if it sees a pointer:

```bash
git lfs pull --include="assets/wasm_tts_voices/espeak/espeak-ng.eas.data"
```

`EAS_TOOLS_E2E_IMAGE` changes the local image tag (default
`eas-tools-e2e:local`, now the headless-shell image), `EAS_TOOLS_DOCKER` selects a Docker-compatible CLI, and
`EAS_TOOLS_E2E_SKIP_BUILD=1` runs an image that was built separately.
`EAS_TOOLS_E2E_DOCKERFILE` selects the Dockerfile and
`EAS_TOOLS_E2E_BUILD_ARGS` supplies whitespace-separated build arguments.
The default Dockerfile build uses Debian's `chromium-headless-shell` executable
at `/usr/lib/chromium/chromium-headless-shell`. The secondary
`make e2e-container-full-chromium` target builds `eas-tools-e2e:full-chromium`
with the regular `/usr/lib/chromium/chromium` binary for compatibility fallback.
Container mode forwards `EAS_TOOLS_TABS`; native-only browser/server overrides are
not forwarded into the hermetic image.

In native mode Chrome comes from `EAS_TOOLS_CHROME` if set, else
`C:\Program Files\Google\Chrome\Application\chrome.exe` if present, else
one of the usual `google-chrome`, `chromium`, or `chrome` commands on `PATH`.
If no native browser is found, auto mode checks that the configured Docker CLI
can reach a container engine. It reuses the requested image when it already
exists; otherwise it checks that the build inputs are usable before selecting
the container runner. With `EAS_TOOLS_E2E_SKIP_BUILD=1`, the image must exist.
Set `E2E_RUNNER=native|container|auto` for Make-based commands, or pass
`--runner` directly to Cargo.

Native Windows E2E is retained as a compatibility path, but the repository as a
whole still assumes a Unix-like development environment. Its root commands use
GNU Make, Python, and POSIX-shell conventions; Windows contributors should use
WSL, Git Bash, MSYS2, or equivalent Unix-like utilities for the broader workflow.

After adding a suite file, run `node gen_main.mjs`; it regenerates
`suites/main.rs` from `suites/*.rs`. `make e2e-check` verifies that registry,
`rustfmt` formatting, `cargo check --all-targets`, and Clippy with warnings denied.
It also enforces 90% line coverage through `cargo llvm-cov` for the deterministic
support modules (`img.rs`, `runner.rs`, and `server.rs`). The CDP adapters and
top-level browser orchestration are intentionally covered by live browser cases,
not the unit-only coverage boundary. The check fails when the registry is stale,
since an unregistered suite is never compiled. `make e2e`, the pnpm E2E commands,
and CI run this preflight before the browser suite.

For Docker users; ensure that you rebuild the image when necessary to run new
E2E code or run updated test suites.

## Status: this is the only browser suite
It replaced the Selenium/pytest suite on 2026-10-15. Each Python file became a suite of the same name (minus `test_`). `encoder_events` holds both EMNet and the AWIPS location limit; `number_inputs` holds both slider and wheel tests. axe-core 4.11.4 (MPL-2.0) is vendored at `vendor/axe.min.js`.

## How the harness keeps tests isolated
- A slot is checked out per test (semaphore + free list). The page is new for every test, so init scripts, viewport/media emulation, dialogs and sessionStorage never carry over.
- On close, `Storage.clearDataForOrigin` wipes cookies, localStorage, IndexedDB, file systems, WebSQL, service workers and Cache Storage for the origin. The context then goes back to the slot. If the wipe fails, the context is disposed instead.
- A pooled context is scrubbed again when the next test takes it. The scrub loads `fixtures/blank.html` and runs `localStorage.clear()` from that page. It exists because a write sent just before the page left can reach storage after the wipe; crawl settings and WarnGen state have both done this. Keys cleared this way are printed as `[e2e] slot N: cleared localStorage keys that outlived the wipe`.
- The HTTP cache and V8 code cache deliberately survive, so later tests skip refetching and recompiling the bundles.
- `EAS_TOOLS_TABS=1` runs everything through one reused context in sequence. That is the leak check (about 3.5 min).

## Harness API (src/)
- Tab: `goto`, `js`/`js_async` (Selenium arguments[] / done() conventions), `eval`, `exec`, `wait_until`, `wait_for`, `click` (real mouse), `press(key, mods)`, `type_text`, `replace_text`, `focus`, `wheel`, `set_files`, `set_viewport`, `emulate_media`, `add_init_script` (Page.addScriptToEvaluateOnNewDocument), `dialogs()` (auto-dismissed), `active_id`, `local_storage_set`.
- img: data-URL/GIF decode, `bright_bounds`/`bright_rows`, `color_rows`, `palette`, `difference_ratio`.
- axe: `assert_clean(tab, context, allowed, label)`, `failing_with(tab, context, options, allowed)` for runOnly.
- suites/common.rs:
  - Page helpers: `open_tool`, `wait_for_tool`, `open_tool_tracking_errors`, `copy_text`, `capture_download`, `temp_file`, `named_temp_file` (keeps the exact file name), `wait_for_dialog`, `click_later`.
  - Encoder helpers: `set_field`, `set_checkbox`, `generate`, `sample_count`, `audio_duration`, `audio_digest`, `output_peak`, `sine_wav`, `INJECT_CUSTOM_AUDIO_JS`, `wait_for_saved_encoder_settings`.
- suites/warngen_radar.rs exports `open_warngen` and `wait_for_map_to_settle` for the other radar suites.

## Speed findings
- One Chrome with 8 tabs topped out at 116-125 s. Every tab shares that Chrome's single browser process (navigation, IPC, CDP, in-process network service). It used about 6 cores of time while the renderers idled at 0.2-0.4 each.
  - Moving to one Chrome per slot brought the full run to about 62 s.
- Ruled out along the way, none of which helped:
  - The static server (Laragon Apache was no faster).
  - Renderer OS priority (forcing Normal changed nothing).
  - Per-page windows.
  - Background-throttling flags.
- The browser mutex used to be held across `new_page`, which serialized tab opens; it is now a read/write lock.
- The desktop's own load is the remaining ceiling: about 4 cores for vmmemWSL, 2 for WmiPrvSE, plus Backblaze, SearchParty, Adobe sync and Podman.

## Static server (src/server.rs)
- It is a plain `std::net` server with one thread per connection. It replaced tiny_http 0.12 on 2026-10-17.
- tiny_http's `TaskPool` can lose a wakeup. When a second connection arrives after a waiting worker was notified but before that worker woke, `spawn()` still sees `waiting_tasks == 1`, so it queues the connection and calls `notify_one()`, which wakes nobody. The connection then sits unread until some other keep-alive connection closes.
- In the suite that showed up as a navigation hanging for exactly 30 s ("navigate … Request timed out"), in roughly 1 run in 4. Chrome's net log showed the request fully sent on a fresh socket and stuck in READ_HEADERS, while the server logged nothing.
- After the switch: 12 back-to-back `splice` runs at 7.6–9.2 s, and the full suite at 512/512 in 62.7 s.
- **Diagnostics (both opt-in):**
  - `EAS_TOOLS_SERVER_LOG=1` writes one line per request to `%TEMP%\eas-tools-e2e-server.log`.
  - `EAS_TOOLS_NETLOG=1` makes each Chrome slot write its net log to `%TEMP%\eas-tools-netlog-<slot>.json`.

## Readiness gotcha
- The splicer finishes booting after its panel looks ready. `bindEvents()` runs after `await loadSoxMacroDefs()` and dispatches a voice `change` that re-hides the TTS volume row.
  - `wait_for_tool('splicer')` waits for the `splicerOverrideTZ` fields to get an inline display, which that handler sets.
