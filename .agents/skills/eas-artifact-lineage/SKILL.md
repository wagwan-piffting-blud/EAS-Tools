---
name: eas-artifact-lineage
description: Determine whether an EAS Tools file is hand-authored, generated, derived, vendored, or patched upstream and identify its generator, inputs, coupled outputs, and safe verification path. Use before modifying manifests, lookup data, bundles, WASM loaders, voice assets, geographic data, or other reproducible artifacts.
---

# EAS artifact lineage

Avoid unreproducible edits and changes that the next generator run will overwrite.

1. Obtain the changed-file list with the available Git tool, then pass relevant repository-relative paths to `node .agents/skills/eas-artifact-lineage/scripts/lineage.mjs [paths...]`. With no paths it lists the registered lineage entries.
2. Read [references/lineage-policy.md](references/lineage-policy.md).
3. Inspect the reported generator and inputs before editing. Confirm the mapping against current code; the registry is a maintained aid, not authority over the repository.
4. Prefer changing the authoritative input or generator. If the workflow requires checked-in output, regenerate it through the documented path.
5. Verify coupled files, pinned versions or hashes, deterministic output, and whether regeneration requires external tools or data.

Do not run a generator that overwrites material files merely to discover what it does. Use a temporary copy or output directory when available. Ask for Human-in-the-Loop direction when provenance is ambiguous, an upstream patch must be maintained, or regeneration would introduce a broad unexplained diff.
