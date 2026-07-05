import * as bundledTranslit from "./phoneme-translit.js";
import { toARPABET } from "phonemize";
export * from "./phoneme-translit.js";

let activeTranslit = bundledTranslit;
let canonicalLoadState = "bundled";
let canonicalLoadUrl = null;
let canonicalLoadError = null;

function isValidTranslitModule(mod) {
    return Boolean(
        mod &&
        typeof mod.setPhonemize === "function" &&
        typeof mod.wordToBackend === "function" &&
        typeof mod.convertPhonemes === "function"
    );
}

function normalizeTranslitModule(mod) {
    if (isValidTranslitModule(mod)) return mod;
    if (isValidTranslitModule(mod?.default)) return mod.default;
    if (isValidTranslitModule(mod?.PhonemeTranslit)) return mod.PhonemeTranslit;
    return null;
}

function applyCanonicalTranslit(mod, sourceLabel = "runtime") {
    const canonical = normalizeTranslitModule(mod);
    if (!canonical) return false;
    canonical.setPhonemize(toARPABET);
    activeTranslit = canonical;
    canonicalLoadState = sourceLabel;
    canonicalLoadError = null;
    return true;
}

function resolveTranslitUrl() {
    if (typeof window === "undefined") return null;

    const explicit = window.PHONEME_TRANSLIT_URL;
    if (typeof explicit === "string" && explicit.trim()) {
        return explicit.trim();
    }

    if (typeof document === "undefined") return null;

    const scripts = document.getElementsByTagName("script");
    for (let i = scripts.length - 1; i >= 0; i -= 1) {
        const script = scripts[i];
        const src = script?.src;
        if (!src) continue;
        const dataUrl = script?.dataset?.phonemeTranslit;
        if (typeof dataUrl === "string" && dataUrl.trim()) {
            return dataUrl.trim();
        }
        if (/phoneme-webpack\.js(?:$|\?)/i.test(src)) {
            return src.replace(/phoneme-webpack\.js(?:\?.*)?$/i, "phoneme-translit.js");
        }
    }

    return "assets/js/phoneme-translit.js";
}

function buildCacheBustedUrl(url) {
    if (typeof window === "undefined") return url;
    if (window.PHONEME_TRANSLIT_CACHE_BUST === false) return url;
    const sep = url.includes("?") ? "&" : "?";
    return `${url}${sep}v=${Date.now()}`;
}

async function loadCanonicalTranslit() {
    if (typeof window === "undefined") return;

    const url = resolveTranslitUrl();
    if (!url) return;
    canonicalLoadUrl = url;

    try {
        const mod = await import(buildCacheBustedUrl(url));
        if (applyCanonicalTranslit(mod, "runtime-import")) {
            return;
        }
        console.warn("[PhonemeTools] Loaded canonical translit module, but exports were invalid:", url);
    } catch (err) {
        canonicalLoadError = err;
        console.warn("[PhonemeTools] Falling back to bundled translit module:", url, err);
    }
}

bundledTranslit.setPhonemize(toARPABET);
if (typeof window !== "undefined") {
    window.__phonemeTranslitState = () => canonicalLoadState;
    window.__phonemeTranslitDebug = () => ({
        state: canonicalLoadState,
        url: canonicalLoadUrl,
        error: canonicalLoadError ? String(canonicalLoadError) : null,
    });
}
const canonicalReadyPromise = loadCanonicalTranslit();
if (typeof window !== "undefined") {
    window.__phonemeTranslitReady = canonicalReadyPromise;
}
export const whenCanonicalTranslitReady = canonicalReadyPromise;

export const Backend = bundledTranslit.Backend;

export function wordToBackend(...args) {
    return activeTranslit.wordToBackend(...args);
}

export function convertPhonemes(...args) {
    return activeTranslit.convertPhonemes(...args);
}

export const PhonemeTools = new Proxy({}, {
    get(_target, prop) {
        if (prop === Symbol.toStringTag) return "PhonemeTools";
        const value = activeTranslit[prop];
        if (typeof value === "function") {
            return (...args) => activeTranslit[prop](...args);
        }
        if (value !== undefined) return value;
        if (typeof prop === "string") {
            return (...args) => {
                const fn = activeTranslit[prop];
                if (typeof fn !== "function") {
                    throw new TypeError(`${prop} is not a function`);
                }
                return fn(...args);
            };
        }
        return undefined;
    },
    has(_target, prop) {
        return prop in activeTranslit;
    },
    ownKeys() {
        return Reflect.ownKeys(activeTranslit);
    },
    getOwnPropertyDescriptor(_target, prop) {
        if (!(prop in activeTranslit)) return undefined;
        return { configurable: true, enumerable: true };
    },
});

if (typeof window !== "undefined") {
    window.PhonemeTools = PhonemeTools;
}
