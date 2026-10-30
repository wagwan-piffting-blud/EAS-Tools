# Regression contract

## Definition

A regression is a repeatable behavior introduced by the candidate change, absent from the selected baseline under equivalent conditions, that violates a documented requirement, explicit acceptance criterion, existing test oracle, or user-accepted behavior.

A difference alone is not a regression. A pre-existing defect, intentional behavior change, environmental difference, unverified standards concern, harness artifact, or agent preference must not be reported as one.

## Required evidence

Use **confirmed regression** only when all of these hold:

1. An authoritative baseline exists.
2. The candidate differs under equivalent conditions.
3. The difference is repeatable where nondeterminism is plausible.
4. The difference violates an established expectation.

## Authority order

1. Current user instruction and explicit acceptance criteria.
2. User-approved behavior, screenshot, or interaction.
3. Checked-in tests and exact behavioral contracts.
4. Checked-in project documentation and accessibility promises.
5. A deliberately selected baseline revision.
6. Applicable external platform or accessibility standards.
7. Agent inference.

External standards can establish a conformance issue but do not prove regression causality. Agent inference alone cannot establish a regression.

## Classifications

- **Confirmed regression:** the candidate introduced a repeatable violation of an established expectation.
- **Intentional change:** the difference matches requested or explicitly accepted behavior.
- **Pre-existing defect:** the problem occurs in both baseline and candidate.
- **Candidate defect, baseline unknown:** the candidate is demonstrably broken, but regression causality is unproven.
- **Environment variance:** browser, OS, fonts, native controls, permissions, or cache explain the difference.
- **Harness artifact:** automation or capture behavior explains the difference.
- **Possible standards issue:** potential nonconformance not shown to be candidate-introduced.
- **Subjective difference:** no objective acceptance rule resolves the difference; request Human-in-the-Loop review.
- **Inconclusive:** evidence is insufficient or nondeterministic.
- **No material change:** a difference does not affect an established expectation.

## Domain rules

### Visual

Objective evidence includes clipping, obscured or unreachable controls, harmful overlap, lost visibility, a violated accepted layout boundary, a failed responsive state, or a user-approved pixel requirement. Font rasterization, native control differences, animation, caret blinking, and agent aesthetic preference are not regressions by themselves.

### Accessibility

An introduced loss of an accessible name, keyboard operation, focus behavior, announcement, state communication, or accessibility-tree content can be a regression. If the baseline has the same problem, classify it as pre-existing.

### Performance

Define the metric, repetitions, equivalent conditions, and tolerance before measuring. “Feels slower” is not evidence.

## Language discipline

Do not say “broken” for a mere difference. Do not say “regression” without naming the baseline and violated expectation. Do not say “should” without identifying its authority. Present ambiguous evidence and a precise question for Human-in-the-Loop review.
