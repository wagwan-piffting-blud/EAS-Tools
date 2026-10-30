---
name: eas-quality-workflow
description: Run and extend the EAS Tools test, coverage, documentation, protocol, WarnGen, and skill-validation workflow without overstating coverage or weakening gates. Use when adding tests, changing coverage scope, updating generated documentation, or preparing a repository-wide quality handoff.
---

# EAS quality workflow

Use GNU Make as the stable entry point and pnpm as the JavaScript tool runner.

## Select the narrow check

- Run `make test` while changing modules covered by Vitest.
- Run `make coverage-scope` after adding, moving, generating, or vendoring
  JavaScript. Every `.js` and `.mjs` file must have exactly one quality lane.
- Run `make docs` after changing an HTML documentation source, then run
  `make docs-check`. Never hand-edit `docs/generated/`.
- Run `make protocol-test` for SAME receive, recorder-boundary, timing, or alert
  audio changes. Use `eas-alert-differential-lab` for deeper comparisons.
- Run `make warngen-test` for WarnGen engine, template, geography, or product
  changes. Use `warngen-reference-parity` when output meaning is disputed.
- Run `make e2e` for browser-visible behavior: tool loading, audio, crawl/video
  export, WarnGen rendering, handoffs, and accessibility. Narrow it while
  iterating with `cargo test --manifest-path test/e2e-rs/Cargo.toml --test e2e -- <name>`.
  After adding a suite file, run `node test/e2e-rs/gen_main.mjs`.
- Run `make skills-check` after changing repository-local skills.
- Run `make lint` and `make anti-suppressions` after changing JavaScript,
  TypeScript, quality configuration, or lint-sensitive tooling. Do not add inline
  lint, type-check, or coverage suppression directives to make the gate pass.

## Treat coverage as a named boundary

Read `tools/coverage-scope.mjs` and `vitest.config.mjs` before making a coverage
claim. The scope file is the source of truth for both the instrumented files and
the classification of every other JavaScript file. The 90% thresholds apply only
to `measuredFiles`; they do not establish 90% line coverage over generated,
vendored, browser-runtime, maintenance-tool, integration, or test-harness lanes.
Extend `measuredFiles` only with meaningful behavioral tests for first-party code.
Do not misclassify difficult code, add generated bundles or vendored code to the
numeric gate, exclude difficult branches, add ignore directives, or lower
thresholds to make the gate pass. If a file has no honest lane, stop and resolve
its ownership or provenance before weakening the audit.

When a test reveals a defect, preserve the minimal failing case and classify it
before changing production code. A regression is a causal violation of an
accepted requirement, previously passing behavior, authoritative baseline, or
explicit compatibility contract. A difference alone is not a regression.

## Complete the handoff

Run `make quality`, review every warning and failure, then inspect the final diff.
Report the exact coverage percentages, measured file count, full scope-inventory
counts, protocol and WarnGen results, documentation mirror count, skill
validation, and any check that could not run. Automated success is evidence for
Human-in-the-Loop review, not human acceptance.
