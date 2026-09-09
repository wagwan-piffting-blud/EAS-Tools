/*
 * espeak-wasm-driver.js — IPA → speech driver for the espeak-ng-wasm artifacts.
 *
 * Implements the contract in INTERFACE.md §3 (v0.1.1). Language-agnostic: no
 * orthography-to-phoneme conversion, no dictionary lookup. Callers own the
 * phonology (IPA in); the driver owns the acoustics (PCM out).
 *
 * v0.1.x loads the engine on the MAIN THREAD (synthesis of a verse takes
 * ~10–50 ms — imperceptible behind a user gesture). Web Worker isolation
 * lands in v0.2 with no API change.
 *
 * Usage:
 *   import { init, synthesize, playIPA, terminate } from "./espeak-wasm-driver.js";
 *   await init({ wasmURL: ".../espeak-ng.wasm", dataURL: ".../espeak-ng.data" });
 *   await playIPA("ˈar.ma wɪr.ˈʊŋ.kʷe ˈka.noː");
 */

const DEFAULTS = { rate: 175, pitch: 50 };   // INTERFACE.md §3
const MAX_INPUT_CHARS = 500;                 // INTERFACE.md §3
const SAMPLE_RATE = 22050;                   // INTERFACE.md §3 (constant in v0.x)

const IS_NODE = typeof process !== 'undefined'
    && !!process.versions && !!process.versions.node;

/* ---------------------------------------------------------------- errors */

export class InitError extends Error {
    constructor(message) { super(message); this.name = 'InitError'; }
}
export class UnmappableSymbolError extends Error {
    constructor(symbol, position) {
        super(`no mapping for symbol ${JSON.stringify(symbol)} at position ${position}`);
        this.name = 'UnmappableSymbolError';
        this.symbol = symbol;
        this.position = position;
    }
}
export class SynthesisError extends Error {
    constructor(message) { super(message); this.name = 'SynthesisError'; }
}
export class DriverStateError extends Error {
    constructor(message) { super(message); this.name = 'DriverStateError'; }
}

/* ----------------------------------------------------------------- state
 *
 * Lifecycle (H-02): init() is a single-flight operation. Concurrent callers
 * share one in-flight promise; mapping rules, module instance, and state are
 * staged in locals and committed atomically only after every step succeeds.
 * terminate() bumps _generation, which invalidates a late-finishing init so
 * it can never commit over a terminated lifecycle; a failed init tears down
 * its half-built module before rejecting.
 */
let _M = null;          // Emscripten module instance
let _rules = null;      // mapping rules, pre-sorted longest-first
let _state = 'new';     // new | ready | terminated
let _initPromise = null; // in-flight init, shared by concurrent callers
let _generation = 0;    // lifecycle token; bumped by terminate()
let _audioCtx = null;   // shared AudioContext (created on first playIPA)

/* ---------------------------------------------------- mapping table load
 *
 * Default: ./la.json alongside this driver — the flat GitHub Release layout
 * (Release assets cannot preserve directories, so the v0.1.0 default of
 * ./mapping/la.json failed for README-style vendoring; H-01).
 * Node.js: read via fs (undici fetch has no file: support); mappingURL then
 * accepts a plain filesystem path, a file: URL, or an http(s) URL — the same
 * convention as wasmURL/dataURL (INTERFACE.md §7).
 */
async function loadMapping(options) {
    if (options.mapping) return options.mapping;
    const src = options.mappingURL ?? new URL('./la.json', import.meta.url);
    const isHttp = typeof src === 'string' && /^https?:\/\//.test(src);
    if (IS_NODE && !isHttp) {
        const { readFileSync } = await import(/* webpackIgnore: true */ 'node:fs');
        // readFileSync accepts plain paths and file: URLs (and URL objects).
        return JSON.parse(readFileSync(src, 'utf8'));
    }
    const res = await fetch(src);
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${src}`);
    return res.json();
}

/* kind is REQUIRED (M-07): stress repositioning attaches pending stress marks
 * to vowel/diphthong mnemonics; a rule without a valid kind would silently
 * drop stress. Violations are InitError, per the hard-error design. */
const KINDS = new Set(['vowel', 'diphthong', 'consonant']);

function compileRules(mapping) {
    if (!mapping || !Array.isArray(mapping.rules)) {
        throw new InitError('mapping table must contain a "rules" array');
    }
    const rules = mapping.rules.map((r, idx) => {
        if (!r || typeof r.ipa !== 'string' || typeof r.mnemonic !== 'string') {
            throw new InitError(`mapping rule #${idx}: "ipa" and "mnemonic" strings are required`);
        }
        if (!KINDS.has(r.kind)) {
            throw new InitError(`mapping rule #${idx} (${JSON.stringify(r.ipa)}): `
                + '"kind" must be one of "vowel" | "diphthong" | "consonant"');
        }
        const cps = [...r.ipa]; // codepoints
        return { ipa: r.ipa, mnemonic: r.mnemonic, kind: r.kind, _cps: cps, _len: cps.length };
    });
    rules.sort((a, b) => b._len - a._len); // longest-match first
    return rules;
}

/* --------------------------------------------------------- IPA → mnemonic
 *
 * Longest-match over the rule list, scanned codepoint-by-codepoint over the
 * whole NFC input (L-01: UnmappableSymbolError.position is the codepoint
 * index in the NFC'd input, whitespace spans included — an astral codepoint
 * counts as one position, not two UTF-16 units).
 *
 * Suprasegmentals are structural, handled here rather than via the table:
 *   ˈ / ˌ  stress — espeak wants the mark BEFORE THE VOWEL of the stressed
 *          syllable (k'ano), IPA places it before the syllable ONSET
 *          ('ka.no:). We hold it pending and emit it just before the next
 *          vowel/diphthong mnemonic.
 *   .      syllable boundary — dropped; espeak syllabifies phoneme strings
 *          itself (accepted but unused in [[...]] input).
 */
function mapToMnemonics(text) {
    const chars = [...text]; // codepoints
    const out = [];
    let i = 0;
    let pendingStress = null;
    let inWord = false;
    while (i < chars.length) {
        const ch = chars[i];
        if (/\s/u.test(ch)) { // whitespace separates words (span preserved in i)
            if (inWord) { out.push(' '); inWord = false; }
            i++;
            continue;
        }
        inWord = true;
        if (ch === 'ˈ') { pendingStress = "'"; i++; continue; }
        if (ch === 'ˌ') { pendingStress = ','; i++; continue; }
        if (ch === '.') { i++; continue; }
        let hit = null;
        for (const r of _rules) {           // pre-sorted longest-first
            if (i + r._len > chars.length) continue;
            let ok = true;
            for (let k = 0; k < r._cps.length; k++) {
                if (chars[i + k] !== r._cps[k]) { ok = false; break; }
            }
            if (ok) { hit = r; break; }
        }
        if (!hit) throw new UnmappableSymbolError(ch, i);
        if (pendingStress && (hit.kind === 'vowel' || hit.kind === 'diphthong')) {
            out.push(pendingStress);
            pendingStress = null;
        }
        out.push(hit.mnemonic);
        i += hit._len;
    }
    // A trailing pending stress (invalid IPA) is dropped silently; valid
    // input always has a vowel after the stress mark.
    return out.join('').trim();
}

/* -------------------------------------------------------------------- API */

/**
 * init(options) → Promise<void>   (INTERFACE.md §3)
 * Idempotent and single-flight: concurrent calls share one promise; a second
 * call after success is a no-op. options:
 *   wasmURL, dataURL   required — artifact URLs (Node: plain filesystem paths)
 *   loaderURL          default: espeak-ng.js alongside this driver
 *   mappingURL         default: la.json alongside this driver (flat Release
 *                      layout; Node reads it via fs, browsers via fetch)
 *   mapping            inline parsed mapping object (alternative to mappingURL
 *                      — for tests, bundlers, non-fetch environments)
 *   voice              default "la" — engine voice for phoneme realization
 */
export async function init(options) {
    if (_state === 'ready') return;
    if (_initPromise) return _initPromise; // H-02: concurrent init shares the flight
    _initPromise = doInit(options).finally(() => { _initPromise = null; });
    return _initPromise;
}

async function doInit(options) {
    if (!options || !options.wasmURL || !options.dataURL) {
        throw new InitError('init: wasmURL and dataURL are required');
    }
    const gen = _generation;
    let M = null; // staged locally; committed to _M only on full success
    try {
        const mapping = await loadMapping(options);
        const rules = compileRules(mapping); // InitError on a malformed table

        const loaderURL = options.loaderURL
            ?? new URL('./espeak-ng.js', import.meta.url);
        const { default: createModule } = await import(/* webpackIgnore: true */ loaderURL);
        M = await createModule({
            locateFile: (file) =>
                file.endsWith('.wasm') ? options.wasmURL :
                file.endsWith('.data') ? options.dataURL : file,
            // The engine tries to load <voice>_dict as a SetVoice side effect;
            // the trimmed data package deliberately ships no dictionaries
            // (phoneme mode never consults them), so that one warning is
            // benign and filtered. Everything else reaches stderr as usual.
            printErr: (m) => {
                if (!/Can't read dictionary file/.test(m)) console.error(m);
            },
        });
        const sr = M.ccall('espeakng_init', 'number', ['string'], ['/']);
        if (sr !== SAMPLE_RATE) {
            throw new Error(`engine init returned sample rate ${sr}, expected ${SAMPLE_RATE}`);
        }
        const voice = options.voice ?? 'la';
        if (M.ccall('espeakng_set_voice', 'number', ['string'], [voice]) !== 0) {
            throw new Error(`voice "${voice}" not present in data package`);
        }
        // Generation guard: terminate() ran while this init was in flight —
        // refuse to commit state over the terminated lifecycle. The staged
        // module is torn down in the catch below.
        if (gen !== _generation) {
            throw new Error('init superseded by terminate()');
        }
        // Atomic commit: all-or-nothing.
        _M = M;
        _rules = rules;
        _state = 'ready';
    } catch (e) {
        if (M) {
            try { M.ccall('espeakng_terminate', null, [], []); } catch { /* best effort */ }
        }
        throw e instanceof InitError ? e : new InitError(`init failed: ${e.message ?? e}`);
    }
}

/**
 * synthesize(ipa, options?) → Promise<{pcm: Int16Array, sampleRate: 22050, durationMs}>
 * Whole-utterance: resolves after the full PCM buffer is ready.
 * options: { rate?: 80–450 (default 175), pitch?: 0–99 (default 50) }
 */
export async function synthesize(ipa, options = {}) {
    if (_state !== 'ready') throw new DriverStateError('synthesize: call init() first');
    if (typeof ipa !== 'string') throw new TypeError('synthesize: ipa must be a string');
    const text = ipa.normalize('NFC');
    if ([...text].length > MAX_INPUT_CHARS) {
        throw new SynthesisError(`input exceeds ${MAX_INPUT_CHARS} characters`);
    }
    const mnemonics = `[[${mapToMnemonics(text)}]]`;
    // Contract semantics: rate/pitch fall back to defaults per call, so a
    // caller's previous custom values never leak into a later default call.
    _M.ccall('espeakng_set_rate', 'number', ['number'], [options.rate ?? DEFAULTS.rate]);
    _M.ccall('espeakng_set_pitch', 'number', ['number'], [options.pitch ?? DEFAULTS.pitch]);
    const n = _M.ccall('espeakng_synthesize', 'number', ['string'], [mnemonics]);
    if (n === -3) throw new SynthesisError('PCM buffer allocation failed');
    if (n === -2) throw new SynthesisError(`engine rejected: ${mnemonics}`);
    if (n === -1) throw new SynthesisError('PCM buffer overflow (utterance exceeds hard cap)');
    if (n <= 0) throw new SynthesisError(`engine returned ${n} samples`);
    const ptr = _M.ccall('espeakng_pcm', 'number', [], []);
    const pcm = _M.HEAP16.slice(ptr >> 1, (ptr >> 1) + n);
    return { pcm, sampleRate: SAMPLE_RATE, durationMs: (n / SAMPLE_RATE) * 1000 };
}

/**
 * playIPA(ipa, options?) → Promise<void> — resolves when playback ends.
 * First call must be triggered from a user gesture (browser autoplay policy).
 */
export async function playIPA(ipa, options = {}) {
    const { pcm, sampleRate } = await synthesize(ipa, options);
    const Ctor = globalThis.AudioContext ?? globalThis.webkitAudioContext;
    if (!Ctor) throw new DriverStateError('playIPA: no AudioContext in this environment');
    _audioCtx ??= new Ctor();
    if (_audioCtx.state === 'suspended') await _audioCtx.resume();
    const buf = _audioCtx.createBuffer(1, pcm.length, sampleRate);
    const channel = buf.getChannelData(0);
    for (let i = 0; i < pcm.length; i++) channel[i] = pcm[i] / 32768;
    const src = _audioCtx.createBufferSource();
    src.buffer = buf;
    src.connect(_audioCtx.destination);
    return new Promise((resolve) => {
        src.onended = () => resolve();
        src.start();
    });
}

/** terminate() — frees engine resources; the driver is re-initializable. */
export function terminate() {
    _generation++; // H-02: invalidate any in-flight init
    if (_state === 'ready') _M.ccall('espeakng_terminate', null, [], []);
    _M = null;
    _rules = null;
    _state = 'terminated';
}
