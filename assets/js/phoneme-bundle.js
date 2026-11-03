import { CODEMIRROR_DARK_THEME_NAME, CODEMIRROR_LIGHT_THEME_NAME, USES_DARK_THEME } from './common-functions.js';
import { createSendMenu } from './handoff.js';
import { lexiconFromSet } from './nwr-pronunciation.js';

const { Backend, wordToBackend, convertPhonemes, crossPhonemes } = window.PhonemeTools;

(async function () {
    let phonemeTextEditor = null;

    function initPhonemeTextEditor() {
        if (phonemeTextEditor || !window.CodeMirror) return phonemeTextEditor;

        const phonemeTextArea = document.getElementById('phonemeText');
        if (!phonemeTextArea) return null;

        const phonemeEditor = CodeMirror.fromTextArea(phonemeTextArea, {
            lineNumbers: true,
            mode: 'text/xml',
            matchBrackets: true,
            theme: USES_DARK_THEME ? CODEMIRROR_DARK_THEME_NAME : CODEMIRROR_LIGHT_THEME_NAME,
            lineWrapping: true,
        });

        phonemeEditor.getInputField().setAttribute('aria-label', 'Text or phoneme string to convert');
        phonemeEditor.setSize('27vw', '15rem');

        const phonemeWrapper = phonemeEditor.getWrapperElement();
        phonemeWrapper.classList.add('ttsText', 'ttsText--editor', 'phonemeCM');

        phonemeEditor.on('change', () => {
            phonemeEditor.save();
        });

        phonemeTextEditor = phonemeEditor;
        return phonemeEditor;
    }

    window.phonemeEditor = initPhonemeTextEditor();
    window.phonemeEditor.refresh();
})();

(function () {
    function getPhonemeToolsRoot() {
        const root = window.PhonemeTools;
        if (root && typeof root === "object" && root.PhonemeTools) {
            return root.PhonemeTools;
        }
        return root;
    }

    function phonemeTool(name) {
        return (...args) => {
            const fn = getPhonemeToolsRoot()?.[name];
            if (typeof fn !== "function") {
                throw new TypeError(`${name} is not a function`);
            }
            return fn(...args);
        };
    }

    const Backend = getPhonemeToolsRoot()?.Backend ?? window.PhonemeTools?.Backend;
    const wordToBackend = phonemeTool("wordToBackend");
    const convertPhonemes = phonemeTool("convertPhonemes");
    const crossPhonemes = phonemeTool("crossPhonemes");

    const inp = document.getElementById("phonemeText");
    const mode = document.getElementById("phonemeMode");
    const outBackend = document.getElementById("phonemeOutBackend");
    const out = document.getElementById("phonemeOutput");

    const overrides = {
        "impact": "IH0 M P AE1 K T",
        "impacts": "IH0 M P AE1 K T Z",
        "tornadic": "T AO R N AE1 D IH K",
        "frequent": "F R IY2 K W EH1 N T",
        "wichita": "W IH0 CH AX0 T AA",
        "sawdust": "S AO1 D AH0 S T",
        "speechify": "S P IY0 CH AH0 F AY0",
        "monday": "M AH1 N D EY2",
        "tuesday": "T UW1 Z D EY2",
        "wednesday": "W EH1 N Z D EY2",
        "saturday": "S AE1 T ER0 D EY2",
        "leisure": "L IY1 ZH ER0",
    };
    const localOverrides = { ...overrides };

    let activeWordOverrides = overrides;

    async function loadNationalLexicon() {
        try {
            const resp = await fetch(new URL("../nwr-pronunciation/national.json", import.meta.url).href);
            if (!resp.ok && resp.status !== 0) throw new Error("HTTP " + resp.status);
            Object.assign(overrides, lexiconFromSet(await resp.json()), localOverrides);
        } catch (err) {
            console.warn("[PhonemeTools] Paul national dictionary unavailable:", err);
        }
    }

    function parseCmudict(text) {
        const map = Object.create(null);
        const lines = text.split("\n");
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();
            if (!line || line.startsWith(";;;")) continue;
            const sp = line.indexOf(" ");
            if (sp < 0) continue;
            const word = line.slice(0, sp);
            if (word.indexOf("(") !== -1) continue;
            const phones = line.slice(sp).trim();
            if (!phones) continue;
            map[word.toLowerCase()] = phones;
        }
        return map;
    }

    async function loadCmudict() {
        try {
            const url = new URL("../cmudict-0.7b", import.meta.url).href;
            const resp = await fetch(url);
            if (!resp.ok) throw new Error("HTTP " + resp.status);
            const dict = parseCmudict(await resp.text());
            Object.assign(dict, overrides);
            activeWordOverrides = dict;
        } catch (err) {
            console.warn("[PhonemeTools] CMUdict fallback unavailable; using G2P only:", err);
        }
    }

    const lexiconReady = loadNationalLexicon().then(loadCmudict);

    mode.addEventListener("change", () => {
        const isWordMode = mode.value == "word";
        const isCrossMode = mode.value == "cross";
        document.querySelectorAll(".phonemeOutBackend").forEach(el => {
            el.style.display = isWordMode ? "inline-block" : "none";
        });
        document.querySelectorAll(".phonemeCrossMode").forEach(el => {
            el.style.display = isCrossMode ? "inline-block" : "none";
        });
    });

    mode.dispatchEvent(new Event("change"));

    function switchcase(value, text, outBackend) {
        switch(value) {
            case "word":
                return wordToBackend(text, outBackend, { overrides: activeWordOverrides });
            case "phoneme":
                return convertPhonemes(text, { lexicon: overrides });
            case "cross":
                return crossPhonemes(
                    text,
                    document.getElementById("phonemeCrossModeFrom")?.value,
                    document.getElementById("phonemeCrossModeTo")?.value,
                    { lexicon: overrides }
                );
            default:
                throw new Error(`Unknown mode: ${value}`);
        }
    }

    document.getElementById("phonemeConvert").onclick = async () => {
        const text = inp.value.trim();
        if (!text) return (out.textContent = "");
        const ob = outBackend.value;
        await lexiconReady;

        try {
            out.textContent = switchcase(mode.value, text, ob);
        } catch (err) {
            out.textContent = `[ERROR] ${err?.message ?? String(err)}`;
        }
    };

    document.getElementById("phonemeClear").onclick = () => {
        inp.value = "";
        if (window.phonemeEditor) {
            window.phonemeEditor.setValue("");
        }
        out.textContent = "";
    };

    document.getElementById("phonemeCopyToClipboard").onclick = async () => {
        const text = out.textContent.trim();
        if (!text) return;
        try {
            await navigator.clipboard.writeText(text);
            alert("Output copied to clipboard.");
        } catch (err) {
            alert("Failed to copy to clipboard: " + err);
        }
    };

    const noOutput = () => out.textContent.trim() ? "" : "convert something first";
    const phonemeSendMenu = createSendMenu({
        label: "Send to…",
        title: "Use the converted output as TTS text in another tool",
        items: [
            { tool: "encoder", label: "SAME Encoder (as TTS text)", what: "Phoneme output", unavailable: noOutput, payload: () => ({ text: out.textContent.trim() }) },
            { tool: "splicer", label: "Audio Splicer (as TTS text)", what: "Phoneme output", unavailable: noOutput, payload: () => ({ text: out.textContent.trim() }) },
        ],
    });
    document.getElementById("phonemeCopyToClipboard").insertAdjacentElement("afterend", phonemeSendMenu.element);

    if (window.EASBridge) {
        window.EASBridge.on('phoneme:convert', async (params) => {
            const text = params?.text;
            if (!text) {
                window.EASBridge.send('phoneme:result', { text: '' });
                return;
            }
            await lexiconReady;
            try {
                let modeVal = params.mode || 'word';
                let result;
                if (modeVal === 'cross') {
                    result = crossPhonemes(text, params.crossFrom || 'vtml', params.crossTo || 'bal', { lexicon: overrides });
                } else if (modeVal === 'phoneme') {
                    result = convertPhonemes(text, { lexicon: overrides });
                } else {
                    result = wordToBackend(text, params.outBackend || 'all', { overrides: activeWordOverrides });
                }
                window.EASBridge.send('phoneme:result', { text: result || '' });
            } catch (err) {
                window.EASBridge.send('phoneme:result', { text: '[ERROR] ' + (err?.message || String(err)) });
            }
        });
        window.EASBridge.on('phoneme:requestOptions', () => {
            const serialize = (id) => {
                const el = document.getElementById(id);
                const out = [];
                if (el) {
                    for (const opt of el.options) {
                        out.push({ value: opt.value, label: opt.textContent });
                    }
                }
                return out;
            };
            window.EASBridge.send('phoneme:options', {
                modes: serialize('phonemeMode'),
                backends: serialize('phonemeOutBackend'),
                singleBackends: serialize('phonemeCrossModeFrom'),
            });
        });
        console.log('[EASBridge] Phoneme bridge handlers registered');
    }
})();
