import { CODEMIRROR_DARK_THEME_NAME, CODEMIRROR_LIGHT_THEME_NAME, USES_DARK_THEME } from './common-functions.js';

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
            window.ttsText = phonemeEditor.getValue().trim();
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
        //BEGIN PAUL NATIONAL DICTIONARY OVERRIDES
        "10s": "T IY2 N Z",
        "20s": "T W UH2 N T T IY0 Z",
        "albemarle": "AE0 L B AH0 M AA0 R L",
        "antilles": "AE0 N T IH1 L IY0 S",
        "arpt": "EH1 R P OW0 R T",
        "asos": "EY1 S AH0 AA0 S",
        "atlantic": "AE0 T L AE0 N T IH2 K",
        "atmospheric": "AE2 T M AH0 S F EH1 R IH0 K",
        "au": "AO0",
        "azores": "EY1 Z OW0 R Z",
        "bimini": "B IH1 M IH0 N IY0",
        "cabo san lucas": "K AA1 B OW0 S AA0 N L UW1 K AH0 Z",
        "caribbean": "K AE2 R EH0 B IY1 AH0 N",
        "ciego de avila": "S IY0 EY0 G OW0 D EY0",
        "cloudiness": "K L AW1 D IY0 N EH2 S",
        "croix": "K R AH0 OY0",
        "dawn": "D AA1 AO1 N",
        "delmarva": "D EH0 L M AA1 R V AH0",
        "enrique": "AA0 N R IY1 K EY0",
        "felicia": "F AH0 L IY1 SH AH0",
        "fenwick": "F EH1 N W IH0 K K",
        "frederica": "F R EH2 D EH0 R IY1 K AH0",
        "friday": "F R AY1 D EY2",
        "hail": "HH EY1 L",
        "henlopen": "HH EH0 N L OW2 P EH0 N",
        "henri": "AA0 N R IY1",
        "hgts": "HH AY1 T S",
        "highs": "HH AY1 Z",
        "ignacio": "IY0 G N AA1 S IY0 OW0",
        "illinois": "IH1 L IH0 N OY1",
        "isidore": "IH1 Z AH0 D OW0 R",
        "jimena": "HH AH0 M EY1 N AH0",
        "johnsonville": "JH AA0 N S AH0 N V IH0 L",
        "jr": "JH UW1 N Y ER0",
        "kissimmee": "K IH1 Z EH0 M IY2",
        "lead": "L IY1 D",
        "mc": "M IH1 K",
        "mineral": "M IH1 N ER0 AH0 L",
        "moderate": "M AA1 D AH0 R IH0 T",
        "movement toward": "M UW1 V M EH0 N",
        "mt": "M AW1 N T",
        "near zero": "N IY0 R Z IY0 R OW0",
        "near-zero": "N IY0 R Z IY0 R OW0",
        "newfoundland": "N UW0 F AH0 N D L AH2 N D",
        "nexrad": "N EH1 K S R AE2 D",
        "odette": "OW0 D EH1 T",
        "okeechobee": "OW0 K IY0 CH OW1 B IY2",
        "olaf": "OW1 L AA2 F",
        "pahokee": "P AA0 HH OW1 K IY0",
        "reservoir": "R EH1 Z ER0 V OW0 R",
        "route": "R AW1 T",
        "santa fe": "S AE1 N T AH0 F EY1",
        "santa fe river": "S AE1 N T AH0 F EY1",
        "spgs": "S P R IH1 NG Z",
        "tehuantepec": "T AH0 W AA1 N AH0 P EH0 K",
        "thundershower": "TH AH1 N D ER0 SH AW0 ER0",
        "thundershowers": "TH AH1 N D ER0 SH AW0 ER0 Z",
        "thunderstorm": "TH AH1 N D ER0 S T OW0 R M",
        "thunderstorms": "TH AH1 N D ER0 S T OW0 R M Z",
        "uno": "UW0 UW1 N OW0",
        "wind": "W IH1 N D",
        "wind down": "W AY2 N D",
        "wind down to": "W IH1 N D",
        "wind up": "W AY2 N D",
        "wind up to": "W IH1 N D",
        "winds": "W IH1 N D S",
        "winds down": "W AY2 N D S",
        "winds down to": "W IH1 N D S",
        "winds up": "W AY2 N D S",
        "winds up to": "W IH1 N D S",
        "xrds": "K R AO1 S R OW0 D Z",
        //END PAUL NATIONAL DICTIONARY OVERRIDES
        "tekamah": "T AH K EY0 M AH",
        "saunders": "S AA1 N D ER0 Z",
        "impact": "IH0 M P AE1 K T",
        "impacts": "IH0 M P AE1 K T Z",
        "tornadic": "T AO R N AE1 D IH K",
        "frequent": "F R IY2 K W EH1 N T",
        "saline": "S AH L IY N",
        "pottawattamie": "P AA1 T AX W AA T UW M IY",
        "wichita": "W IH0 CH AX0 T AA",
        "sawdust": "S AO1 D AH0 S T",
        "beatrice": "B IY0 AE1 T R IH0 S",
        "pickrell": "P IH0 K ER0 L",
        "speechify": "S P IY0 CH AH0 F AY0",
        "louisville": "L UW1 AH V IH L",
        "monday": "M AH1 N D EY2",
        "tuesday": "T UW1 Z D EY2",
        "wednesday": "W EH1 N Z D EY2",
        "saturday": "S AE1 T ER0 D EY2",
        "leisure": "L IY1 ZH ER0",
    };

    let activeWordOverrides = overrides;

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

    loadCmudict();

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

    document.getElementById("phonemeConvert").onclick = () => {
        const text = inp.value.trim();
        if (!text) return (out.textContent = "");
        const ob = outBackend.value;

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

    if (window.EASBridge) {
        window.EASBridge.on('phoneme:convert', (params) => {
            const text = params?.text;
            if (!text) {
                window.EASBridge.send('phoneme:result', { text: '' });
                return;
            }
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
