# Comparison scenario template

Declare this before running the comparison.

```yaml
scenario: <user-visible operation>
baseline:
  source: <user-approved behavior, test, documentation, or revision>
  authority: <why this baseline governs>
candidate: <working tree or revision>
environment:
  browser: <engine and version>
  viewport: <width x height>
  zoom: <value>
  preferences: <relevant settings>
  permissions: <relevant grants or denials>
  cache: <cold, warm, or offline-ready>
inputs: {}
interaction_sequence: []
expected: []
tolerances: {}
human_review:
  required_for: []
```

Capture baseline and candidate observations separately. Add classification only after both captures exist.
