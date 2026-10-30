# Development workflow

## Prerequisites

- Node.js 26 or newer
- pnpm 12.16.1 (the version is pinned in `package.json`)
- GNU Make
- Python 3 for serving the static application and selected repository tools

Install development dependencies with:

```bash
pnpm install --frozen-lockfile
```

Use `python3 -m http.server 8080` for manual browser testing. A localhost HTTP
origin is important for microphone, worker, and other secure-context behavior.

## Working on a change

1. Read `AGENTS.md`, inspect the working tree, and preserve unrelated work.
2. Locate the shell, bundle/module, worker, iframe, WASM, generated, and data
   boundaries affected by the change.
3. Run the narrowest applicable test while iterating.
4. Update behavior tests and documentation together with the implementation.
5. Run `make quality` before handoff and inspect the final diff.

The repository-local skills document repeatable investigation and comparison
workflows. In particular, use cross-surface mapping when a change spans runtime
boundaries, artifact lineage before touching generated or derived files, and the
protocol or WarnGen comparison skills for behavior where valid-but-wrong output
is more dangerous than an obvious failure.

## Documentation

New contributor documentation is authored directly in Markdown under `docs/`.
Existing public HTML documentation remains authoritative and is mirrored for
agents and repository readers:

```bash
make docs       # regenerate docs/generated/
make docs-check # fail if mirrors, links, or the code map are stale
```

Do not hand-edit `docs/generated/`. Add a documentation HTML page to
`docs/html-sources.json` or explicitly classify it as an application-shell
exception. Update `docs/code-map.json` when a new first-party runtime area is
introduced.

The Markdown generator also applies static-mirror cleanup in
`tools/generate-markdown-docs.mjs`:

- trailing spaces and tabs are removed from generated lines;
- browser-populated `voice-count` is omitted, and the dynamic TTS request limit
  is rendered as “the configured number of”;
- browser-only `copy-text` controls are omitted from documentation prose.
- placeholder `href="#"` links are converted to stable Markdown heading
  fragments based on their visible labels.
- browser-only “Back to EAS Tools” buttons are omitted;
- TTS demo audio files are emitted as Markdown links, and JavaScript-injected
  TTS usage examples are emitted as language-tagged fenced code blocks;
- repeated blank lines are collapsed outside fenced code blocks.

The generator does not execute page JavaScript, so dynamically inserted voice
lists and CodeMirror examples are not mirrored unless the HTML source provides
static fallback content. These rules preserve the live HTML behavior while
keeping the checked-in Markdown mirrors deterministic and readable.

## Common targets

| Target | Purpose |
| --- | --- |
| `make test` | Run the Vitest suite once |
| `make coverage` | Run tests and enforce the coverage gate |
| `make lint` | Run ESLint over maintainable JavaScript/TypeScript surfaces |
| `make anti-suppressions` | Reject lint and coverage suppression directives across source languages |
| `make protocol-test` | Run recorder-boundary and SAME A/B harnesses |
| `make warngen-test` | Render modern and legacy WarnGen corpora |
| `make skills-check` | Validate every repository-local skill package |
| `make e2e` | Run the Rust + Chrome browser suite in `test/e2e-rs/` |
| `make quality` | Run all repository quality gates |

Human review remains required. Automated checks provide evidence, not acceptance.
