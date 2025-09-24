# Emergency Alert System (EAS) Tools

Web‑based **EAS / SAME Decoder & Encoder** that runs entirely in your browser. Use your microphone to decode Specific Area Message Encoding (SAME) headers from live audio, and generate valid EAS header + attention tone audio as a downloadable WAV file.

> ⚠️ **Legal & ethics notice**
> This project is for **educational, hobbyist, and lab use only**. In many jurisdictions (e.g., U.S. FCC 47 CFR §11.45), transmitting or simulating EAS tones outside of authorized tests is prohibited. **Do not broadcast** generated tones or headers over public channels. The author is NOT responsible for ANY misuse of this software toolkit.

---

## ✨ Features

* **In‑browser SAME decoder** (AFSK 520.833 bps; mark ≈ 2083.3 Hz / space ≈ 1562.5 Hz)
  * Live microphone input with device selection
  * Level meter & real‑time header parsing
  * Displays originator, event, FIPS (region/state/county), issuance time, and raw header text
* **SAME encoder**
  * Build headers via a form or paste an existing header string
  * Generates proper **header bursts**, **attention tones (1050 Hz / 853+960 Hz where applicable)**, and **EOM**
  * Exports a **WAV** you can download
* **Zero backend**: everything runs locally; no audio leaves your machine/browser
* Works as a **static site** (ideal for GitHub Pages / Netlify / local file server)

---

## 🚀 Quick start

### Run locally

1. **Clone** the repo:

   ```bash
   git clone https://github.com/wagwan-piffting-blud/EAS-Tools.git
   cd EAS-Tools
   ```
2. **Serve** it from `localhost` (recommended for microphone access):

   ```bash
   # Python 3
   python -m http.server 8080
   # then open http://localhost:8080 in your browser
   ```

   > Browsers require a **secure context** for microphone (`getUserMedia`). `https://` or `http://localhost` works; opening `index.html` with a `file://` URL usually won’t.

---

## 🧭 Using the app

### Decoder

1. Go to **Decoder** tab
2. Choose your **microphone** (device selector)
3. Grant permission when prompted
4. Play an EAS/SAME tone; watch the meter & parsed headers

What you’ll see:

* **Raw header** (e.g., `ZCZC-...-...-...`)
* Parsed **originator**, **event code**, **FIPS location(s)**, **alert duration**, **issue time (UTC)**, **sender**

### Encoder

1. Switch to **Encoder** tab
2. Fill the form (or toggle **Custom header** and paste a valid SAME header)
3. Click **Generate** to synthesize audio
4. Click **Save as WAV** to download

#### Deep‑linking

You can pre‑open the encoder with a header via a query param:

```
index.html?header=ZCZC-...your SAME header...
```

The app activates the **Encoder** tab and attempts to parse/populate fields.

---

## 🔧 Technical notes

* **AudioWorklet** (`processor.js`) ships samples from the Worklet thread to the decoder
* **Decoder** (`decoder-bundle.js`)
  * Band‑pass filters around SAME mark/space
  * AFSK demodulation, bit/byte framing, header detection (0xAB sync), and header parsing
* **Encoder** (`encoder-bundle.js`)
  * Builds SAME bursts + attention tones, concatenates audio, and writes a **WAV** (via `assets/wavefile.js`)
* **Resampling** via `assets/wave-resampler.js` as needed
* Default tuning targets common sample rates (44.1 kHz / 48 kHz)

> The repository includes **bundled** encoder/decoder files for convenience. There is no build step required to run. If you plan to modify the DSP or UI logic, you can work directly in the bundles or introduce your own build pipeline.

---

## 🧪 Tips & troubleshooting

* **No mic in the list?** Ensure you’re on `https://` (or `http://localhost`) and granted mic permission
* **Levels but no decode?**
  * Check input levels / environmental noise
  * Verify mark/space frequency fidelity; some devices apply AGC/filters
* **Safari issues**: AudioWorklet support and mic policies vary by version; Chrome/Edge are recommended

---

## 📜 Credits & third‑party

* UI fonts: **Hack** (via `assets/fonts` + `assets/hack.css`)
* WAV writer: **wavefile.js** (bundled in `assets/`)
* Resampling: **wave‑resampler.js** (bundled in `assets/`)
* Inspiration / references:
  * [nicksmadscience SAME Encoder, Python](https://github.com/nicksmadscience/eas-same-encoder)
  * [Mab879 C++ SAME Encoder](https://github.com/Mab879/eas_encoder)
  * [Anon64 EAS Header Generator](https://anon64.bitkit.us/eas-gen/)

> See each upstream project for their respective licenses.

---

## 🛡️ License

This project is licensed under **GPL‑3.0** (see [`LICENSE`](./LICENSE)).

---

## 📍 Disclaimers

## This tool decodes and synthesizes EAS/SAME signals for **lab, testing, and educational** purposes only. You are responsible for complying with all laws, regulations, and organizational policies applicable to your use. The author is NOT responsible for ANY misuse of this software toolkit.

## GenAI Disclosure Notice: Portions of this repository have been generated using Generative AI tools (ChatGPT, ChatGPT Codex).
