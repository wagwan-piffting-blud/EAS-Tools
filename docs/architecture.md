# Architecture and code map

EAS Tools is a static, browser-first application. `index.html` owns the main
shell, navigation, and tool containers. Most tool implementations are bundled or
loaded from `assets/js/`; WarnGen and the muxer run as separate iframe
applications. Server processing is not part of the application except for
explicitly selected Web TTS requests.

## Runtime surfaces

| Surface | Primary locations | Responsibility |
| --- | --- | --- |
| Shared shell | `index.html`, `assets/css/`, shared helpers in `assets/js/` | Navigation, dialogs, accessibility, tool lifecycle, common UI |
| Decoder | `decoder-bundle.js`, `seatty-*`, `processor.js` | Audio capture, SAME detection, parsing, and alert presentation |
| Encoder and E2T | `encoder-bundle.js`, `assets/E2T/` | Header/audio generation and human-readable alert wording |
| Crawl | `crawl-bundle.js`, `crawl-*` workers | Crawl composition, preview, GIF, and video export |
| Splicer | `splicer-bundle.js`, `assets/js/splicer/` | Timeline model, rendering, effects, recording, and WAV export |
| TTS and phonemes | voice workers and glue in `assets/js/`, `assets/wasm_tts_voices/` | Local WASM synthesis, remote Web TTS integration, phoneme conversion |
| WarnGen | `warngen/index.html`, `warngen/src/`, `warngen/templates/` | Product context, rendering, geography, radar, and UI |
| Muxer | `muxer.html`, `assets/muxer/` | FFmpeg.wasm video/audio combination |

## Boundaries that matter

- Workers exchange structured messages with their parent UI. A worker change must
  be checked with its caller and error/transfer handling.
- WASM glue, `.wasm`, `.data`, voice models, and manifests are coupled artifacts;
  use the artifact-lineage workflow before editing them.
- `index.html` contains substantial application composition. A selector, event,
  or lifecycle change can affect multiple tools even when the visible edit is small.
- WarnGen has its own shell and divides code into config, engine, geo, radar, and
  UI modules. Templates and reference data are part of product behavior.
- Large minified or vendored files are dependencies, not the preferred source for
  first-party changes. Identify their upstream or generator before editing.

## Generated and derived content

Generators live in `tools/` and WarnGen-specific utilities live in
`warngen/tools/`. Generated Markdown under `docs/generated/` comes from the HTML
sources listed in `docs/html-sources.json`. Run `make docs` to regenerate it and
`make docs-check` to detect drift or unmapped documentation.

## VT Paul pronunciations (GH #158)

When the remote voice is VT Paul (`paul`), `fetchRemoteTtsAudio` in
`assets/js/common-functions.js` runs `planTtsPronunciation` first. It merges the
national, office (`wfo/XXX`) and transmitter (`tx/CALL`) sets plus the user's
own entries, rewrites matching words as VTML, and adds the office speed and
pauses as the `vtSpeed` / `vtCommaPauseMs` / `vtPeriodPauseMs` form fields when
the voice list advertises them. Every Encoder and Splicer request, the iOS
Splicer webview, and the native encoders (through the engine) share that one
chokepoint.

- `assets/js/nwr-pronunciation.js`: pure engine and validation (no DOM).
- `assets/js/nwr-pronunciation-store.js`: selection, personal entries,
  submission history, and the repository that picks the newer of the bundled
  snapshot and the backend copy of each set.
- `assets/js/nwr-pronunciation-ui.js` / `nwr-pronunciation-editor.js`: the
  picker under the voice controls and the "My pronunciations" dialog.
- `assets/nwr-pronunciation/`: the bundled snapshot. After launch the TTS
  backend's moderation queue is the source of truth; see
  [development.md](development.md#nwr-pronunciation-data).

For impact analysis, repository agents should use the routing in
[`AGENTS.md`](../AGENTS.md) and the repository-local skills under
`.agents/skills/`.
