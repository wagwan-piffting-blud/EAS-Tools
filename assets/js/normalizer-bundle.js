import { CODEMIRROR_DARK_THEME_NAME, CODEMIRROR_LIGHT_THEME_NAME, USES_DARK_THEME } from './common-functions.js';
// normalizeNwsBulletin / runNwsNormalizer live in normalizer-core.js (the single source; WarnGen loads it as a classic
// script), which puts them on window
import './normalizer-core.js';

(async function () {
    let normalizerTextEditor = null;

    function initNormalizerTextEditor() {
        if (normalizerTextEditor || !window.CodeMirror) return normalizerTextEditor;

        const normalizerTextArea = document.getElementById('productToNormalize');
        if (!normalizerTextArea) return null;

        const normalizerEditor = CodeMirror.fromTextArea(normalizerTextArea, {
            lineNumbers: true,
            mode: 'text/xml',
            matchBrackets: true,
            theme: USES_DARK_THEME ? CODEMIRROR_DARK_THEME_NAME : CODEMIRROR_LIGHT_THEME_NAME,
            lineWrapping: true,
        });

        normalizerEditor.getInputField().setAttribute('aria-label', 'Raw VTEC or AWIPS product text to normalize');
        normalizerEditor.setSize('27vw', '15rem');

        const normalizerWrapper = normalizerEditor.getWrapperElement();
        normalizerWrapper.classList.add('ttsText', 'ttsText--editor', 'normalizerCM');

        normalizerEditor.on('change', () => {
            normalizerEditor.save();
            window.ttsText = normalizerEditor.getValue().trim();
        });

        normalizerTextEditor = normalizerEditor;
        return normalizerEditor;
    }

    window.normalizerEditor = initNormalizerTextEditor();
    window.normalizerEditor.refresh();
})();

(function () {
    "use strict";

    const normalizeNwsBulletin = window.normalizeNwsBulletin;
    const run = window.runNwsNormalizer;

    if (window.EASBridge) {
        window.EASBridge.on("normalizer:run", (params) => {
            try {
                const text = (params && params.text) || "";
                const result = normalizeNwsBulletin(text, { repeat: !!(params && params.repeat), labels: params && params.labels });
                window.EASBridge.send("normalizer:result", { result: result || "" });
            } catch (err) {
                window.EASBridge.send("normalizer:result", { result: "[ERROR] " + ((err && err.message) || String(err)) });
            }
        });
        console.log("[EASBridge] Normalizer bridge handler registered");
    }

    document.getElementById("normalizeButton").addEventListener("click", run);
    document.getElementById("normalizeCopyToClipboard").addEventListener("click", () => {
        const output = document.getElementById("normalizedProduct");
        if (!output) return;
        const text = output.value || output.textContent || "";
        navigator.clipboard.writeText(text);
        alert("Normalized product copied to clipboard!");
    });
    document.getElementById("normalizeClear").addEventListener("click", () => {
        const input = document.getElementById("productToNormalize");
        const output = document.getElementById("normalizedProduct");
        if (input) input.value = "";
        if (output) {
            if ("value" in output) {
                output.value = "";
            } else {
                output.textContent = "";
            }
        }
    });
})();
