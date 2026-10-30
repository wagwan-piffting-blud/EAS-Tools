# EAS-Tools

> [!NOTE]
> Want to support Wags work? Consider donating via [GitHub Sponsors](https://github.com/sponsors/wagwan-piffting-blud), [PayPal](https://paypal.me/wagspuzzlespace), or [Ko-fi](https://ko-fi.com/wagspuzzlespace). Any amount of support is greatly appreciated and helps Wags continue to maintain and improve EAS Tools. Thank you for your generosity!

> [!NOTE]
> You can access EAS Tools by using either the hosted application at [eas.tools](https://eas.tools), or by installing the mobile app from either of the two major app stores:
>
> [Google Play Store](https://play.google.com/store/apps/details?id=com.wagspuzzle.eastools) | [Apple App Store](https://apps.apple.com/us/app/eas-tools/id6759717275)

[![EAS Logo](./assets/eas-tools-logo.png)](./assets/eas-tools-logo.png)

## What is it?

EAS Tools is **a browser-based toolkit for the United States EAS, SAME, and Canadian Alert Ready workflows.** It includes a decoder,
encoder, text-crawl generator, audio splicer, phoneme tools, a WarnGen replica, and a video/audio muxer.

## Features?

- Decode live, uploaded, or raw SAME alerts and inspect parsed alert details.
- Generate SAME headers, attention signals, speech, and downloadable WAV files.
- Build and export text crawls, including EAS2Text-generated messages.
- Arrange, trim, process, and export multi-clip audio projects.
- Generate phonemes and synthesize speech with local WASM or server-backed voices.
- Compose modern and legacy AWIPS-style products in WarnGen, including map and
  radar workflows.
- Combine video and audio in the browser with FFmpeg.wasm.

> [!CAUTION]
> **Legal & ethics notice**
>
> This project is for **lab, testing, hobbyist, and educational use only**. In many jurisdictions (e.g., U.S. FCC 47 CFR §11.45), transmitting or simulating EAS tones outside of authorized tests is prohibited. **Do not broadcast** generated tones or headers over public channels. **The authors are not responsible for any misuse of this software toolkit.**
>
> You must also adhere to the EAS Tools [Terms of Service](https://eas.tools/terms.html) at all times when using the app.

> [!IMPORTANT]
> See [Using EAS Tools](./docs/usage.md) for task-by-task instructions and the
[documentation index](./docs/index.md) for architecture, development, testing,
> FAQ, TTS, policy, credits, and generated HTML-document mirrors.

---

## Repository map

```text
.
├── .agents/
│   └── skills/                Repository-specific coding-agent workflows
├── .github/
│   └── workflows/             GitHub automation for generated manifests
├── .well-known/               Mobile/web association metadata
├── assets/
│   ├── E2T/                   SAME-to-readable-text data and runtime
│   ├── audacity_macros/       Audacity macro definitions and manifest
│   ├── audacity_noises/       Noise samples used by audio macros
│   ├── audacity_plugins/      Audio plugin definitions and manifest
│   ├── css/                   Shared application styles
│   ├── demo_files/            Example alert and media inputs
│   ├── demo_screenshots/      UI screenshots used by documentation
│   ├── fonts/                 Bundled application fonts
│   ├── js/                    Tool bundles, modules, workers, and WASM glue
│   ├── muxer/                 Packaged FFmpeg.wasm muxer application
│   ├── nanotts/               NanoTTS language and runtime data
│   ├── piper-tts/             Piper TTS and ONNX browser runtime
│   ├── preheader/             Pre-header audio assets
│   ├── screens/               Screen and display assets
│   ├── tts_backend_codes/     TTS phoneme references
│   └── wasm_tts_voices/       Local voice engines, models, and manifests
├── docs/
│   └── generated/             Markdown mirrors generated from HTML docs
├── test/                      Unit and regression tests
├── tools/                     Repository generators and validation harnesses
├── warngen/
│   ├── data/                  Geographic and product-support data
│   ├── src/                   Config, product engine, geo, radar, and UI modules
│   ├── templates/             Modern and legacy product templates
│   ├── tools/                 Render checks and corpus/build utilities
│   └── vendor/                Bundled third-party WarnGen runtime dependencies
├── index.html                 Main shell and tool navigation
├── muxer.html                 Video/audio muxer iframe shell
├── Makefile                   Stable developer and CI entry points
├── package.json               JavaScript tooling and dependency manifest
├── README.md                  Repository landing for humans
└── AGENTS.md                  Repository instructions for coding agents
```

## Running locally

EAS Tools is a static application. Serve the repository rather than opening it
through a `file://` URL so browser security features such as microphone access
work correctly:

```bash
python3 -m http.server 8080
```

Then open [`localhost:8000`](http://localhost:8000). Development checks use Node.js 26+, pnpm, and
GNU Make:

```bash
pnpm install --frozen-lockfile
make quality
```

## Documentation and policies

- [Documentation index](./docs/index.md)
- [Architecture and code map](./docs/architecture.md)
- [Development workflow](./docs/development.md)
- [Testing and coverage](./docs/testing.md)
- [Changelog](./CHANGES.md)
- [Credits and third-party acknowledgements](./docs/generated/credits.md)
- [Privacy policy](./docs/generated/privacy.md)
- [Terms of Service](./docs/generated/terms.md)

## License

This project is licensed under the **GNU GPLv3** license. See [`LICENSE`](./LICENSE).

## Disclaimers

### GenAI Disclosure Notice

 Portions of this repository have been generated using Generative AI tools (ChatGPT, ChatGPT Codex, GitHub Copilot, Claude, Claude Code)
