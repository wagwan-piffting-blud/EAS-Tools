---
name: eas-alert-differential-lab
description: Differentially test EAS Tools SAME encoding, audio decoding, E2T wording, ENDEC profiles, timing, and alert-location behavior against independent or retained paths. Use for protocol-sensitive changes where clean rejection must be distinguished from valid-but-wrong output.
---

# EAS alert differential lab

Use independent paths and exact fixtures to detect protocol errors that remain syntactically valid.

## Select the oracle

Choose the strongest available comparison: an exact checked-in contract, a retained implementation, encode-then-decode round trip, an authoritative sample, or baseline behavior. State the oracle and its limits. Agreement between implementations that share the same logic is not independent confirmation.

## Run focused experiments

- Use `node tools/recorder-boundary-check.mjs` for automatic-recording boundary changes.
- Use `node tools/same-ab.mjs --sweep --trials 2 --snr inf,8 --workers 1` for a small deterministic SAME robustness comparison.
- Run `node tools/same-ab.mjs` directly for targeted recordings or larger SNR, clock, frequency, reverb, and sample-rate sweeps.
- For E2T changes, apply `assets/E2T/include/test-contract.json` and its exact shared vectors. Do not replace exact wording comparisons with semantic similarity.

Escalate from the smallest relevant experiment. Preserve the seed and minimal failing input.

## Classify results

Distinguish correct output, clean rejection, valid-but-wrong output, wording-only mismatch, timing mismatch, location mismatch, ENDEC-profile mismatch, and inconclusive evidence. A pre-existing mismatch is not a candidate regression. Use the browser comparison regression contract when attributing causality.

Ask for Human-in-the-Loop judgment when the authoritative behavior, acceptable wording, real-world equipment behavior, or intended compatibility boundary is not established. Never convert uncertain domain interpretation into a failing oracle.
