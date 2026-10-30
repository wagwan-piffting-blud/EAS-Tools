# EAS Tools documentation

This is the starting point for users, contributors, and coding agents. Documents
under `docs/generated/` are generated from the deployed HTML pages and must not
be edited directly; update the named HTML source and run `make docs`.

## Use the application

- [Using EAS Tools](./usage.md)
- [FAQ and detailed feature documentation](./generated/faq.md)
- [TTS documentation](./generated/tts.md)
- [TTS voice list](./generated/tts-voices.md)
- [TTS voice demos](./generated/tts-demos.md)
- Phoneme references: [Balabolka](./generated/phonemes/balabolka.md),
  [DECTalk](./generated/phonemes/dectalk.md), and
  [VTML](./generated/phonemes/vtml.md)

## Understand and contribute

- [Architecture and code map](./architecture.md)
- [Development workflow](./development.md)
- [Testing and coverage](./testing.md)
- [Changelog](../CHANGES.md)
- [Agent instructions](../AGENTS.md)

## Project information

- [Credits and third-party acknowledgements](./generated/credits.md)
- [Donations](./generated/donations.md)
- [Privacy policy](./generated/privacy.md)
- [Terms of Service](./generated/terms.md)

The public HTML pages remain authoritative because they are shipped with the
application. `docs/html-sources.json` records every generated mirror and the few
HTML application shells that are intentionally excluded.
