---
name: eas-browser-state-comparison
description: Compare baseline and candidate EAS Tools browser behavior across loading, navigation, focus, accessibility, workers, offline state, and responsive layout. Use for UI or browser-runtime changes where an observed difference must be classified without assuming that difference is a regression.
---

# EAS browser state comparison

Compare behavior neutrally. Never begin from the premise that the candidate is wrong.

Before testing, read [references/regression-contract.md](references/regression-contract.md). Use [references/scenario-template.md](references/scenario-template.md) to declare the scenario, baseline, environment, expected behavior, and tolerances before interpreting results.

## Workflow

1. Select an authoritative baseline using the regression contract. Preserve dirty work; use a separate temporary checkout or exported baseline when comparison with `HEAD` is necessary.
2. Hold browser engine and version, viewport, zoom, preferences, permissions, cache state, inputs, and interaction sequence constant.
3. Capture raw baseline and candidate observations before classifying them. Re-run timing-, focus-, audio-, animation-, worker-, or cache-sensitive observations.
4. Exercise only relevant states: direct navigation, lazy loading, switching away and back, error recovery, keyboard access, focus, live regions, responsive layout, worker lifecycle, offline reload, or native bridge behavior.
5. Apply the contract vocabulary exactly. A difference is not automatically a regression.
6. Ask for Human-in-the-Loop inspection when visual intent, interaction preference, product intent, or an ambiguous accessibility tradeoff cannot be established from an authoritative source.

## Handoff

Report the declared scenario, baseline authority, equivalent-environment evidence, raw differences, classification, confidence, and the exact Human-in-the-Loop question where needed. Do not turn possible improvements or pre-existing defects into candidate blame.
