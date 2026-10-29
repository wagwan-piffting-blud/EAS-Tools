# Artifact lineage policy

Classify each relevant file as one of:

- **Hand-authored source:** edit directly and test downstream consumers.
- **Generated output:** edit its inputs or generator, then regenerate.
- **Derived checked-in data:** preserve the derivation and validate source assumptions.
- **Vendored artifact:** avoid local edits unless the repository intentionally carries a patch.
- **Patched upstream artifact:** identify the upstream base, patch procedure, and coupled files.
- **Opaque binary:** require a documented source, version, or reproduction procedure before replacement.
- **Unknown:** stop direct editing and request provenance or Human-in-the-Loop direction.

Regeneration is evidence only when inputs and tool versions are controlled. A changed output is not automatically correct because a generator produced it. Review semantic changes and unexpected collateral diffs.
