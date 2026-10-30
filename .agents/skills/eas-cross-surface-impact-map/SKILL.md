---
name: eas-cross-surface-impact-map
description: Map an EAS Tools change across the shell, tool bundles, iframes, workers, WASM, native bridges, shared helpers, and generated assets before editing or reviewing it. Use when a task may cross runtime boundaries or when the correct source-of-truth file and downstream consumers are unclear.
---

# EAS cross-surface impact map

Establish the active runtime path and change boundary before proposing edits. This skill is for dependency discovery, not a generic architecture tour.

## Start with evidence

1. Obtain the changed-file list with the available Git tool, then pass those repository-relative paths to `node .agents/skills/eas-cross-surface-impact-map/scripts/impact-map.mjs <paths...>`. Pass proposed paths before files exist when planning new work.
2. Inspect every reported primary surface and reference. Treat the script as a search aid, not proof that a dependency is active.
3. Trace the user action from its entry point to the observable result. Include lazy loading, iframe or worker messages, shared state, cleanup, and native-app branches when present.
4. Identify which files are hand-authored source, generated output, vendored code, or patched upstream artifacts. Use `eas-artifact-lineage` when that boundary is unclear.

## Required output

Before editing, report:

- the entry point and active call/message path;
- the source-of-truth file or files;
- all confirmed consumers and state owners;
- runtime boundaries crossed;
- likely regression surfaces and focused validation;
- unresolved edges that require inspection or Human-in-the-Loop confirmation.

Do not infer a dependency solely from a filename match. Do not edit every reported reference automatically. Narrow the final edit set to the active path and the requested behavior.
