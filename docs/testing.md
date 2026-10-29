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
