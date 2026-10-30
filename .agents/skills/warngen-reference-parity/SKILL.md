---
name: warngen-reference-parity
description: Reconstruct and compare EAS Tools WarnGen output with an authoritative NWS or AWIPS product across template era, XML configuration, context, VTEC, UGC, headings, bullets, geography, and phrasing. Use for WarnGen product discrepancies, template changes, or parity investigations.
---

# WarnGen reference parity

Determine which layer owns a product mismatch instead of editing templates by trial and error.

Read [references/comparison-fields.md](references/comparison-fields.md) before comparing a product.

## Workflow

1. Record the reference product source, timestamp, office, product type, action, and why it is authoritative. User-provided or checked-in fixtures do not require network retrieval.
2. Select the matching legacy or modern product configuration. Trace XML selection, context construction, Velocity template and fragments, render helpers, QC, and geographical data.
3. Reproduce the scenario with the smallest faithful context. Do not normalize away the field being investigated.
4. Run the focused render first:
   `node warngen/tools/render_check.mjs --era <era> --only <template.vm>`
5. Run `--all-actions` when action or follow-up behavior is relevant. Run the full era only after the focused case passes.
6. Compare structural fields before prose. Attribute every mismatch to context, XML defaults, template logic, render/QC code, or data only when evidence supports it.
7. Preserve a compact fixture when the reference may recur.

Use the shared regression contract from `eas-browser-state-comparison` when blaming a candidate change. An upstream product difference may be office-specific, historical, or intentional rather than a repository defect. Request Human-in-the-Loop review when product authority, era selection, acceptable office variance, or desired parity is unclear.
