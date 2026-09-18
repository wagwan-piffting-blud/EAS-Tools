import {
    SEATTY_RATE,
    SINE,
    FFT_TABLES,
    SeattySameDemod,
    bandpassCoefficients,
    squelchBins,
    squelchThreshold
} from './seatty-same.js';

const FLAG_SATURATE = 1;
const FLAG_DEMODULATE = 2;
const FLAG_DETECT_1050 = 4;
const FLAG_SQUELCH = 8;
const FLAG_TONE_PEAK_TRUNCATE = 16;
const FLAG_BANDPASS = 32;

const EVENT_BIT = 1;
const EVENT_SQUELCH_OPEN = 2;
const EVENT_TONE = 4;

const MAX_CHUNK = 65536;

let wasm = null;
let loading = null;

const finalizer = (typeof FinalizationRegistry === 'function')
    ? new FinalizationRegistry((handle) => {
        if (wasm) {
            wasm.seatty_free(handle);
        }
    })
    : null;

async function instantiate(source) {
    if (typeof WebAssembly !== 'object') {
        throw new Error('WebAssembly is unavailable');
    }
    if (source instanceof ArrayBuffer || ArrayBuffer.isView(source)) {
        return (await WebAssembly.instantiate(source, {})).instance;
    }
    const response = await fetch(source);
    if (!response.ok) {
        throw new Error(`seatty-same.wasm: HTTP ${response.status}`);
    }
    const type = response.headers.get('content-type') || '';
    if (typeof WebAssembly.instantiateStreaming === 'function' && type.startsWith('application/wasm')) {
        return (await WebAssembly.instantiateStreaming(response, {})).instance;
    }
    return (await WebAssembly.instantiate(await response.arrayBuffer(), {})).instance;
}

function install(exports) {
    const buffer = exports.memory.buffer;
    new Float64Array(buffer, exports.seatty_sine(), SINE.length).set(SINE);
    new Float64Array(buffer, exports.seatty_fft_cos(), FFT_TABLES.cos.length).set(FFT_TABLES.cos);
    new Float64Array(buffer, exports.seatty_fft_sin(), FFT_TABLES.sin.length).set(FFT_TABLES.sin);
    wasm = exports;
}

export function loadSeattyWasm(source) {
    if (wasm) {
        return Promise.resolve(true);
    }
    if (!loading) {
        loading = instantiate(source ?? new URL('./seatty-same.wasm', import.meta.url))
            .then((instance) => {
                install(instance.exports);
                return true;
            })
            .catch((err) => {
                console.warn('SeaTTY WASM unavailable, using the JavaScript demodulator:', err && err.message ? err.message : err);
                return false;
            });
    }
    return loading;
}

export function seattyWasmReady() {
    return wasm !== null;
}

export function createSeattySameDemod(opts = {}) {
    return wasm ? new SeattySameWasm(opts) : new SeattySameDemod(opts);
}

export class SeattySameWasm {
    constructor(opts = {}) {
        if (!wasm) {
            throw new Error('seatty-same.wasm is not loaded');
        }
        this.onBit = opts.onBit || null;
        this.onTone = opts.onTone || null;
        this.squelchEnabled = !!opts.squelchEnabled;
        this.detect1050 = !!opts.detect1050;
        this.tonePeakTruncate = opts.tonePeakTruncate ?? true;
        this.saturateInt16 = !!opts.saturateInt16;
        this.demodulate = opts.demodulate ?? true;
        this.sameBandpass = (this.demodulate && opts.sameBandpass) || null;
        this.squelchLevel = opts.squelchLevel ?? 50;
        this.squelchShiftHz = opts.squelchShiftHz ?? 450;
        this.handle = 0;
        this.setSampleRate(opts.sampleRate || SEATTY_RATE);
    }

    setSampleRate(rate) {
        this.free();
        this.inputRate = rate;
        let flags = 0;
        if (this.saturateInt16) {
            flags |= FLAG_SATURATE;
        }
        if (this.demodulate) {
            flags |= FLAG_DEMODULATE;
        }
        if (this.detect1050) {
            flags |= FLAG_DETECT_1050;
        }
        if (this.squelchEnabled) {
            flags |= FLAG_SQUELCH;
        }
        if (this.tonePeakTruncate) {
            flags |= FLAG_TONE_PEAK_TRUNCATE;
        }
        let bp = { b0: 0, a1: 0, a2: 0 };
        if (this.sameBandpass) {
            flags |= FLAG_BANDPASS;
            bp = bandpassCoefficients(rate, this.sameBandpass.hz, this.sameBandpass.q);
        }
        this.handle = wasm.seatty_new(rate, flags, bp.b0, bp.a1, bp.a2);
        if (finalizer) {
            finalizer.register(this, this.handle, this);
        }
        this.applySquelch();
    }

    setSquelchLevel(level) {
        this.squelchLevel = level;
        this.applySquelch();
    }

    setSquelchShift(shiftHz) {
        this.squelchShiftHz = shiftHz;
        this.applySquelch();
    }

    applySquelch() {
        this.squelchThreshold = squelchThreshold(this.squelchLevel);
        [this.squelchBinLow, this.squelchBinHigh] = squelchBins(this.squelchShiftHz);
        if (this.handle) {
            wasm.seatty_set_squelch(this.handle, this.squelchThreshold, this.squelchBinLow, this.squelchBinHigh);
        }
    }

    reset() {
        wasm.seatty_reset(this.handle);
    }

    process(samples) {
        if (!ArrayBuffer.isView(samples)) {
            samples = Float32Array.from(samples);
        }
        const h = this.handle;
        for (let off = 0; off < samples.length; off += MAX_CHUNK) {
            const n = Math.min(MAX_CHUNK, samples.length - off);
            const ptr = wasm.seatty_input(h, n);
            new Float32Array(wasm.memory.buffer, ptr, n).set(samples.subarray(off, off + n));
            this.dispatch(wasm.seatty_process(h, n));
        }
    }

    flush() {
        this.dispatch(wasm.seatty_flush(this.handle));
    }

    dispatch(count) {
        if (!count) {
            return;
        }
        const h = this.handle;
        const buffer = wasm.memory.buffer;
        const flags = new Uint8Array(buffer, wasm.seatty_event_flags(h), count).slice();
        const soft = new Float64Array(buffer, wasm.seatty_event_soft(h), count).slice();
        const index = new Float64Array(buffer, wasm.seatty_event_index(h), count).slice();
        const onBit = this.onBit;
        const onTone = this.onTone;
        for (let i = 0; i < count; i++) {
            const f = flags[i];
            if (f & EVENT_TONE) {
                if (onTone) {
                    onTone(index[i]);
                }
            } else if (onBit) {
                onBit(f & EVENT_BIT, soft[i], index[i], (f & EVENT_SQUELCH_OPEN) !== 0);
            }
        }
    }

    get locked() {
        return this.handle ? wasm.seatty_locked(this.handle) !== 0 : false;
    }

    free() {
        if (this.handle) {
            if (finalizer) {
                finalizer.unregister(this);
            }
            wasm.seatty_free(this.handle);
            this.handle = 0;
        }
    }
}
