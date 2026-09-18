/**
 * SAME (EAS / NOAA Weather Radio) demodulator ported from SeaTTY 2.65 by DXSoft
 * (SEATTY.EXE, 2022-08-01 build). Hex addresses refer to that binary at image base 0x00400000.
 *
 * Input path, as SeaTTY's "Decode From File" (0x004170d4) and sound-card capture (0x0040be9c):
 * int16 samples, decimation by 1/2/4 through a 57-tap and a 45-tap FIR, a linear-interpolating
 * rate converter to 11025 Hz (0x0042f964), then 2048-sample blocks. Each block gets a
 * rectangular-window FFT that drives the squelch and the 1050 Hz detector before its samples go
 * through the demodulator: NCO-driven quadrature mixers at 1562.5 / 2083.3 Hz, a three-stage
 * decimating FIR per mixer output, a |mark| - |space| envelope discriminator, a fractional
 * resampler to exactly 7 samples per bit, and an eye-opening bit synchronizer.
 *
 *   const framer = new SeattySameFramer({ onBurst: (burst) => console.log(burst.text) });
 *   const demod = new SeattySameDemod({
 *       sampleRate: 48000,
 *       detect1050: true,
 *       onBit: (bit, soft, sampleIndex, squelchOpen) =>
 *           framer.pushBit(bit, sampleIndex * 1000 / 48000, squelchOpen),
 *       onTone: (sampleIndex) => framer.toneDetected(sampleIndex * 1000 / 48000)
 *   });
 *   demod.process(float32Samples);
 */

export const SEATTY_RATE = 11025;
export const SAME_BAUD = 520.8333333333334;
export const BLOCK_SIZE = 2048;

// 0x006a5b6c, 57 taps, input decimate-by-2 ahead of STAGE2_TAPS for rates of 33075 Hz and up
const INPUT_DECIM_TAPS = new Float64Array([
    4.14111977596636e-06, -2.61870832682322e-06, -4.24222359314902e-05, -8.96828686036154e-05,
    -4.11452592259031e-05, 0.000189324344988463, 0.000472917615282092, 0.000407346200006554,
    -0.000343358462186381, -0.00145244078501914, -0.00175231948384596, -0.000104080584477712,
    0.00305031613440758, 0.00502685387211064, 0.00262120245414924, -0.00436623270550587,
    -0.0109702745154879, -0.00962678281989074, 0.00285138296480884, 0.0193557082436848,
    0.0245788862404479, 0.00674953939476384, -0.0285293487976056, -0.054812732102064,
    -0.0386723328103142, 0.0357804850452618, 0.149378116118247, 0.252940338260812,
    0.294779738723872, 0.252940338260812, 0.149378116118247, 0.0357804850452618,
    -0.0386723328103142, -0.054812732102064, -0.0285293487976056, 0.00674953939476384,
    0.0245788862404479, 0.0193557082436848, 0.00285138296480884, -0.00962678281989074,
    -0.0109702745154879, -0.00436623270550587, 0.00262120245414924, 0.00502685387211064,
    0.00305031613440758, -0.000104080584477712, -0.00175231948384596, -0.00145244078501914,
    -0.000343358462186381, 0.000407346200006554, 0.000472917615282092, 0.000189324344988463,
    -4.11452592259031e-05, -8.96828686036154e-05, -4.24222359314902e-05, -2.61870832682322e-06,
    4.14111977596636e-06
]);

// 0x006a59e0, 49 taps, 11025 -> 5512.5 Hz
const STAGE1_TAPS = new Float64Array([
    7.48674352277735e-06, 1.26110025586769e-05, -4.91679879659941e-05, -0.000159930868566199,
    -7.18045449539255e-05, 0.000411226640232428, 0.00080084387578807, 5.84425975114978e-05,
    -0.00180223287178221, -0.0024558802241949, 0.000632662017082452, 0.00560092378684221,
    0.00555860163942713, -0.00358060728703632, -0.0139823582018124, -0.0100226119213049,
    0.0121235602706667, 0.0306825940279475, 0.0149657385357904, -0.0347222021640429,
    -0.0676830248574982, -0.0189008680022858, 0.122625376416279, 0.283070523252613,
    0.353735663404381, 0.283070523252613, 0.122625376416279, -0.0189008680022858,
    -0.0676830248574982, -0.0347222021640429, 0.0149657385357904, 0.0306825940279475,
    0.0121235602706667, -0.0100226119213049, -0.0139823582018124, -0.00358060728703632,
    0.00555860163942713, 0.00560092378684221, 0.000632662017082452, -0.0024558802241949,
    -0.00180223287178221, 5.84425975114978e-05, 0.00080084387578807, 0.000411226640232428,
    -7.18045449539255e-05, -0.000159930868566199, -4.91679879659941e-05, 1.26110025586769e-05,
    7.48674352277735e-06
]);

// 0x0069ed1c, 45 taps. SAME stage 2 (5512.5 -> 2756.25 Hz) and also the input decimate-by-2.
const STAGE2_TAPS = new Float64Array([
    0.00041063658, 0.00040020444, -0.0014690721, -0.0046244896,
    -0.0048873265, 0.00057075169, 0.0064849067, 0.0034999371,
    -0.0072838126, -0.010484073, 0.0032609865, 0.017545124,
    0.0073308048, -0.02042501, -0.024496589, 0.013398095,
    0.045762697, 0.010940839, -0.066633815, -0.069373038,
    0.081944411, 0.30510648, 0.41246774, 0.30510648,
    0.081944411, -0.069373038, -0.066633815, 0.010940839,
    0.045762697, 0.013398095, -0.024496589, -0.02042501,
    0.0073308048, 0.017545124, 0.0032609865, -0.010484073,
    -0.0072838126, 0.0034999371, 0.0064849067, 0.00057075169,
    -0.0048873265, -0.0046244896, -0.0014690721, 0.00040020444,
    0.00041063658
]);

// 0x006a5788, 23 taps @ 2756.25 Hz. Five dominant taps span 0.94 bit: an integrate-and-dump
// whose first null (551 Hz) sits near the 520.8 Hz tone spacing.
const STAGE3_TAPS = new Float64Array([
    -5.4e-05, -0.000424, 0.000969, 0.000223,
    -0.003783, 0.005047, 0.003394, -0.020946,
    0.034421, 0.168898, 0.214743, 0.193821,
    0.214743, 0.168898, 0.034421, -0.020946,
    0.003394, 0.005047, -0.003783, 0.000223,
    0.000969, -0.000424, -5.4e-05
]);

const DECIM2_MIN_RATE = 16537;
const DECIM4_MIN_RATE = 33075;
const US_PER_SECOND = 1000000;
const PCM_MAX = 32767;

const PHASE_MASK = 0x7fff;
const QUARTER_TURN = 0x2000;
const NCO_SPACE_STEP = 4644;
const NCO_MARK_STEP = 6192;
const POWER_FLOOR = 1e-8;
const BITSYNC_STEP = 3.0240193537238635;
const SAMPLES_PER_BIT = 7;
const EYE_SPAN_BITS = 10;
const EYE_SEARCH = 2;
const EDGE_GUARD = 2;
const RING_MASK = 0xff;
const LOCK_MAX = 16000;
const LOCK_CLEAN_EDGE = 2000;
const LOCK_NO_EDGE = -1000;
const LOCK_RAGGED_EDGE = -5333;

const FFT_BITS = 11;
const BIN_FIRST = 55;
const BIN_LAST = 557;
const SPECTRUM_SCALE = 1.1920928955078125e-7;
const SPECTRUM_FLOOR = 1e-12;
const PEAK_DECAY = 0.5;
const SQUELCH_STEP = 0.08058017727639001;
const SQUELCH_CENTER16 = 5418;
const SQUELCH_EDGE16 = 0x390;
const SQUELCH_TOP16 = 0x22b0;
const HZ_TO_UNITS16 = 2.972154195011338;

// floor(f / (11025 / 2048) + 0.5) for 900, 1000, 1100 and 1200 Hz (0x00426b2c)
const TONE_SEARCH_LO = 167;
const TONE_ACCEPT_LO = 186;
const TONE_ACCEPT_HI = 204;
const TONE_SEARCH_HI = 223;
const TONE_DOMINANCE = 1 / 3;
const TONE_FRAMES = 3;
const TONE_COUNT_MAX = 1000;

const SYNC_WORD = 0xabababab;
const MAX_BURST_CHARS = 300;
const MAX_BAD_CHARS = 4;
const BAD_CHAR = 0x5f;
const HEADER_REPEAT_MS = 10000;
const TIMEOUT_POLL_MASK = 0x1ff;

export const SINE = buildSineTable();
export const FFT_TABLES = buildFftTables();

// 0x00403f4a; 2*pi is truncated to 6.28318530716 in the binary
function buildSineTable() {
    const table = new Float64Array(PHASE_MASK + 1);
    for (let i = 0; i <= PHASE_MASK; i++) {
        table[i] = Math.floor(32000 * Math.sin(i * 6.28318530716 * 3.0517578125e-5) + 0.5);
    }
    return table;
}

function buildFftTables() {
    const n = BLOCK_SIZE;
    const rev = new Uint16Array(n);
    for (let i = 0; i < n; i++) {
        let r = 0;
        for (let b = 0; b < FFT_BITS; b++) {
            r = (r << 1) | ((i >> b) & 1);
        }
        rev[i] = r;
    }
    const cos = new Float64Array(n / 2);
    const sin = new Float64Array(n / 2);
    for (let i = 0; i < n / 2; i++) {
        cos[i] = Math.cos(2 * Math.PI * i / n);
        sin[i] = -Math.sin(2 * Math.PI * i / n);
    }
    return { rev, cos, sin };
}

function toInt16(v) {
    return (v << 16) >> 16;
}

// 1/16-bin units, as SeaTTY stores tone frequencies; halving truncates toward zero like its sar/adc
export function squelchBins(shiftHz) {
    const shift16 = Math.floor(shiftHz * HZ_TO_UNITS16 + 0.5);
    const half = Math.trunc(shift16 / 2);
    let center = SQUELCH_CENTER16;
    if (center < half + SQUELCH_EDGE16) {
        center = half + SQUELCH_EDGE16;
    }
    if (center > SQUELCH_TOP16 - half) {
        center = SQUELCH_TOP16 - half;
    }
    return [Math.trunc((center - half + 8) / 16), Math.trunc((center + half + 8) / 16)];
}

export function squelchThreshold(level) {
    return 2 * Math.exp(-(100 - level) * SQUELCH_STEP);
}

// The ring buffer is stored twice over so the dot product runs without wrapping; it visits the same
// samples in the same order as SeaTTY's wrapping loop.
class Fir {
    constructor(taps) {
        this.taps = taps;
        this.n = taps.length;
        this.buf = new Float64Array(2 * taps.length);
        this.idx = 0;
        this.calls = 0;
        this.acc = 0;
    }

    insert(x) {
        const pos = this.idx;
        this.idx = (pos + 1 === this.n) ? 0 : pos + 1;
        this.buf[pos] = x;
        this.buf[pos + this.n] = x;
        return pos;
    }

    dot(pos) {
        const taps = this.taps;
        const buf = this.buf;
        const n = this.n;
        let acc = 0;
        let j = pos + n;
        for (let i = 0; i < n; i++) {
            acc += buf[j--] * taps[i];
        }
        return acc;
    }

    // FIR_Filter @ 0x004201c0
    filter(x) {
        return this.dot(this.insert(x));
    }

    // FIR_Decim2 @ 0x0041ff14 and FIR_Decim2_45tap @ 0x0041fd88: the dot product only runs on
    // odd calls; even calls return the previous result.
    decimate(x) {
        const pos = this.insert(x);
        if (this.calls & 1) {
            this.acc = this.dot(pos);
        }
        this.calls++;
        return this.acc;
    }
}

function saturateInt16(v) {
    return (v > 32767) ? 32767 : ((v < -32768) ? -32768 : v);
}

function quantize(x) {
    return saturateInt16(Math.round(x * 32768));
}

function toPcm(y) {
    const v = Math.floor(y + 0.5);
    return (v > PCM_MAX) ? PCM_MAX : ((v < -PCM_MAX) ? -PCM_MAX : v);
}

function decimationFor(rate) {
    return (rate < DECIM2_MIN_RATE) ? 1 : ((rate < DECIM4_MIN_RATE) ? 2 : 4);
}

// WAV reader @ 0x00424514: decimate by 2 or 4, then round to int16. push() returns true when out
// holds a new sample.
class InputDecimator {
    constructor(decim, narrow) {
        this.decim = decim;
        this.narrow = narrow;
        this.reset();
    }

    reset() {
        this.firA = new Fir(INPUT_DECIM_TAPS);
        this.firB = new Fir(STAGE2_TAPS);
        this.phase = 0;
        this.held0 = 0;
        this.held1 = 0;
        this.out = 0;
    }

    push(x) {
        if (this.decim === 2) {
            if (this.phase === 0) {
                this.held0 = this.narrow(Math.floor(this.firB.decimate(x) + 0.5));
                this.phase = 1;
                return false;
            }
            this.firB.decimate(x);
            this.phase = 0;
            this.out = this.held0;
            return true;
        }
        const y = this.firA.decimate(x);
        const phase = this.phase;
        this.phase = (phase + 1) & 3;
        if (phase === 0) {
            this.held0 = y;
        } else if (phase === 2) {
            this.held1 = y;
        } else if (phase === 3) {
            this.out = this.narrow(Math.floor(this.firB.decimate(this.held0) + 0.5));
            this.firB.decimate(this.held1);
            return true;
        }
        return false;
    }
}

// Decimation, then the rate converter @ 0x0042f910 / 0x0042f964. A split input carries a second
// stream (the bandpassed SAME path) through its own decimator; both share the converter's timeline,
// so every emit hands over one sample of each.
class SeattyInput {
    constructor(rate, emit, saturate, split) {
        this.emit = emit;
        this.split = split;
        this.decim = decimationFor(rate);
        this.tin = US_PER_SECOND / (rate / this.decim);
        this.tout = US_PER_SECOND / SEATTY_RATE;
        const narrow = saturate ? saturateInt16 : toInt16;
        this.dec = (this.decim === 1) ? null : new InputDecimator(this.decim, narrow);
        this.decSame = (this.decim === 1 || !split) ? null : new InputDecimator(this.decim, narrow);
        this.reset();
    }

    reset() {
        if (this.dec) {
            this.dec.reset();
        }
        if (this.decSame) {
            this.decSame.reset();
        }
        this.prev = 0;
        this.prevSame = 0;
        this.acc = 0;
    }

    push(x, xs) {
        if (!this.dec) {
            this.convert(x, xs);
            return;
        }
        const ready = this.dec.push(x);
        if (this.decSame) {
            this.decSame.push(xs);
        }
        if (ready) {
            this.convert(this.dec.out, this.decSame ? this.decSame.out : 0);
        }
    }

    // Linear interpolation on a microsecond time base; acc is the time since the last output
    convert(x, xs) {
        if (this.acc + this.tin < this.tout) {
            this.prev = x;
            this.prevSame = xs;
            this.acc += this.tin;
            return;
        }
        const delta = x - this.prev;
        const base = this.prev;
        const deltaSame = xs - this.prevSame;
        const baseSame = this.prevSame;
        this.prev = x;
        this.prevSame = xs;
        let t = 0;
        for (;;) {
            t = (this.tout - this.acc) + t;
            if (t === this.tin) {
                this.acc = 0;
                this.emit(x, xs);
                return;
            }
            if (t > this.tin) {
                this.acc = this.tout - (t - this.tin);
                return;
            }
            this.emit(delta * t / this.tin + base, deltaSame * t / this.tin + baseSame);
            this.acc = 0;
        }
    }
}

export function bandpassCoefficients(sampleRate, freq, q) {
    const w0 = 2 * Math.PI * freq / sampleRate;
    const alpha = Math.sin(w0) / (2 * q);
    const a0 = 1 + alpha;
    return { b0: alpha / a0, a1: -2 * Math.cos(w0) / a0, a2: (1 - alpha) / a0 };
}

// RBJ constant-peak bandpass (the WebAudio BiquadFilterNode "bandpass"), one sample at a time
class Bandpass {
    constructor(sampleRate, freq, q) {
        const { b0, a1, a2 } = bandpassCoefficients(sampleRate, freq, q);
        this.b0 = b0;
        this.a1 = a1;
        this.a2 = a2;
        this.reset();
    }

    reset() {
        this.x1 = 0;
        this.x2 = 0;
        this.y1 = 0;
        this.y2 = 0;
    }

    process(x) {
        const y = this.b0 * (x - this.x2) - this.a1 * this.y1 - this.a2 * this.y2;
        this.x2 = this.x1;
        this.x1 = x;
        this.y2 = this.y1;
        this.y1 = y;
        return y;
    }
}

// Options that depart from SeaTTY, all off by default:
//   saturateInt16      clamp the decimator output instead of wrapping it; SeaTTY wraps, which turns
//                      a full-scale input plus FIR passband ripple into garbage
//   demodulate: false  run only the input path, spectrum, squelch and 1050 Hz detector
//   tonePeakTruncate: false  see detectToneFrame
//   sameBandpass: { hz, q }  bandpass the demodulator's input at the input rate, in f64, ahead of
//                      its own copy of the input chain; the spectrum (squelch, 1050 Hz) still sees
//                      unfiltered audio through the other copy
export class SeattySameDemod {
    constructor(opts = {}) {
        this.onBit = opts.onBit || null;
        this.onTone = opts.onTone || null;
        this.squelchEnabled = !!opts.squelchEnabled;
        this.detect1050 = !!opts.detect1050;
        this.tonePeakTruncate = opts.tonePeakTruncate ?? true;
        this.saturateInt16 = !!opts.saturateInt16;
        this.demodulate = opts.demodulate ?? true;
        this.sameBandpass = (this.demodulate && opts.sameBandpass) || null;
        this.split = !!this.sameBandpass && (this.squelchEnabled || this.detect1050);
        this.setSquelchLevel(opts.squelchLevel ?? 50);
        this.setSquelchShift(opts.squelchShiftHz ?? 450);
        this.setSampleRate(opts.sampleRate || SEATTY_RATE);
    }

    setSampleRate(rate) {
        this.inputRate = rate;
        this.input = new SeattyInput(rate, (y, ys) => this.pushConverted(y, ys), this.saturateInt16,
            this.split);
        this.bandpass = this.sameBandpass ? new Bandpass(rate, this.sameBandpass.hz, this.sameBandpass.q) : null;
        this.reset();
    }

    // Squelch slider 0..100, 50 by default (0x00416614)
    setSquelchLevel(level) {
        this.squelchLevel = level;
        this.squelchThreshold = squelchThreshold(level);
    }

    // SAME mode inherits the RTTY shift setting for its squelch bins (0x00416f75), 450 Hz by default,
    // which puts them at 1598.8 / 2045.7 Hz rather than on the SAME tones.
    setSquelchShift(shiftHz) {
        this.squelchShiftHz = shiftHz;
        [this.squelchBinLow, this.squelchBinHigh] = squelchBins(shiftHz);
    }

    // SAME_Reset @ 0x00426cc4 plus the block and spectrum state from Audio_ProcessBlock @ 0x0040c26c
    reset() {
        this.phaseSpace = 0;
        this.phaseMark = 0;
        this.stage1 = [0, 1, 2, 3].map(() => new Fir(STAGE1_TAPS));
        this.stage2 = [0, 1, 2, 3].map(() => new Fir(STAGE2_TAPS));
        this.stage3 = [0, 1, 2, 3].map(() => new Fir(STAGE3_TAPS));
        this.decim1 = 0;
        this.decim2 = 0;
        this.soft = 0;
        this.resampleAcc = 0;
        this.ring = new Float32Array(RING_MASK + 1);
        this.ringIdx = 0;
        this.bitPhase = 0;
        this.lockAcc = 0;
        this.locked = false;
        this.nativeCount = 0;
        this.block = new Int16Array(BLOCK_SIZE);
        this.sameBlock = this.split ? new Int16Array(BLOCK_SIZE) : this.block;
        this.blockLen = 0;
        this.fftRe = new Float64Array(BLOCK_SIZE);
        this.fftIm = new Float64Array(BLOCK_SIZE);
        this.smooth = new Float64Array(BIN_LAST + 1);
        this.peak = new Float64Array(BIN_LAST + 1);
        this.squelchOpen = true;
        this.toneCount = 0;
        this.input.reset();
        if (this.bandpass) {
            this.bandpass.reset();
        }
    }

    process(samples) {
        const input = this.input;
        const bandpass = this.bandpass;
        if (!bandpass) {
            for (let i = 0; i < samples.length; i++) {
                input.push(quantize(samples[i]), 0);
            }
        } else if (!this.split) {
            for (let i = 0; i < samples.length; i++) {
                input.push(quantize(bandpass.process(samples[i])), 0);
            }
        } else {
            for (let i = 0; i < samples.length; i++) {
                const x = samples[i];
                input.push(quantize(x), quantize(bandpass.process(x)));
            }
        }
    }

    // After end of file SeaTTY pushes 2048 zeros into the rate converter (0x00417338) and drops any
    // partial block left over; this also pads and processes that block.
    flush() {
        for (let i = 0; i < BLOCK_SIZE; i++) {
            this.input.convert(0, 0);
        }
        while (this.blockLen !== 0) {
            this.pushConverted(0, 0);
        }
    }

    // Rate converter callback @ 0x0040c1ec
    pushConverted(y, ys) {
        if (this.split) {
            this.sameBlock[this.blockLen] = toPcm(ys);
        }
        this.block[this.blockLen++] = toPcm(y);
        if (this.blockLen === BLOCK_SIZE) {
            this.blockLen = 0;
            this.processBlock(this.block);
        }
    }

    // Audio_ProcessBlock @ 0x0040c26c, SAME mode. The spectrum is skipped when nothing reads it,
    // and the demodulator reads the bandpassed copy when there is one.
    processBlock(block) {
        if (this.squelchEnabled || this.detect1050) {
            this.updateSpectrum(block);
            const peak = this.peak;
            const thr = this.squelchThreshold;
            this.squelchOpen = !this.squelchEnabled
                || thr < peak[this.squelchBinLow]
                || thr < peak[this.squelchBinHigh];
        }
        if (this.detect1050) {
            this.debounceTone();
        }
        if (!this.demodulate) {
            this.nativeCount += block.length;
            return;
        }
        const same = this.sameBlock;
        for (let i = 0; i < same.length; i++) {
            this.pushNative(same[i]);
        }
    }

    // Unnormalized 2048-point DFT with no window (0x00402d44), then peak decay and smoothing
    updateSpectrum(block) {
        const n = BLOCK_SIZE;
        const re = this.fftRe;
        const im = this.fftIm;
        const { rev, cos, sin } = FFT_TABLES;
        for (let i = 0; i < n; i++) {
            re[rev[i]] = block[i];
            im[i] = 0;
        }
        for (let size = 2; size <= n; size <<= 1) {
            const half = size >> 1;
            const step = n / size;
            for (let start = 0; start < n; start += size) {
                for (let k = 0; k < half; k++) {
                    const wr = cos[k * step];
                    const wi = sin[k * step];
                    const a = start + k;
                    const b = a + half;
                    const tr = re[b] * wr - im[b] * wi;
                    const ti = re[b] * wi + im[b] * wr;
                    re[b] = re[a] - tr;
                    im[b] = im[a] - ti;
                    re[a] += tr;
                    im[a] += ti;
                }
            }
        }

        const smooth = this.smooth;
        const peak = this.peak;
        for (let bin = BIN_FIRST; bin <= BIN_LAST; bin++) {
            peak[bin] *= PEAK_DECAY;
            const r = re[bin] * SPECTRUM_SCALE;
            const q = im[bin] * SPECTRUM_SCALE;
            const power = r * r + q * q;
            const mag = (power > SPECTRUM_FLOOR) ? Math.sqrt(power) : 0;
            smooth[bin] = (mag * 2 + smooth[bin]) * (1 / 3);
            if (peak[bin] < smooth[bin]) {
                peak[bin] = smooth[bin];
            }
        }
    }

    // SAME_1050Debounce @ 0x00426e60
    debounceTone() {
        if (!this.detectToneFrame()) {
            this.toneCount = 0;
            return;
        }
        if (this.toneCount < TONE_COUNT_MAX) {
            this.toneCount++;
        }
        if (this.toneCount === TONE_FRAMES && this.onTone) {
            this.onTone(this.inputSampleIndex());
        }
    }

    // SAME_Detect1050Frame @ 0x00426eac. The running peak is truncated to an integer (ftol with
    // RC=truncate), and a full-scale tone only reaches ~4.0, so below about -12 dBFS the peak is 0
    // and any other nonzero bin rejects the frame. tonePeakTruncate: false keeps the exact value.
    detectToneFrame() {
        const smooth = this.smooth;
        let peakValue = -1;
        let peakBin = 0;
        for (let bin = TONE_SEARCH_LO; bin <= TONE_SEARCH_HI; bin++) {
            if (peakValue < smooth[bin]) {
                peakValue = this.tonePeakTruncate ? Math.trunc(smooth[bin]) : smooth[bin];
                peakBin = bin;
            }
        }
        if (this.squelchEnabled && !(peakValue >= this.squelchThreshold)) {
            return false;
        }
        if (peakBin < TONE_ACCEPT_LO || peakBin > TONE_ACCEPT_HI) {
            return false;
        }
        const limit = peakValue * TONE_DOMINANCE;
        for (let bin = BIN_FIRST; bin < TONE_SEARCH_LO; bin++) {
            if (smooth[bin] > limit) {
                return false;
            }
        }
        for (let bin = TONE_SEARCH_HI + 1; bin <= BIN_LAST; bin++) {
            if (smooth[bin] > limit) {
                return false;
            }
        }
        return true;
    }

    // SAME_ProcessSample @ 0x00426fe8 with FSK_Downconvert_Dec4 @ 0x004209fc inlined
    pushNative(x) {
        this.nativeCount++;
        const ps = this.phaseSpace = (this.phaseSpace + NCO_SPACE_STEP) & PHASE_MASK;
        const pm = this.phaseMark = (this.phaseMark + NCO_MARK_STEP) & PHASE_MASK;
        const s1 = this.stage1;
        const sinSpace = s1[0].decimate(x * SINE[ps]);
        const sinMark = s1[1].decimate(x * SINE[pm]);
        const cosSpace = s1[2].decimate(x * SINE[(ps + QUARTER_TURN) & PHASE_MASK]);
        const cosMark = s1[3].decimate(x * SINE[(pm + QUARTER_TURN) & PHASE_MASK]);

        if (++this.decim1 & 1) {
            const s2 = this.stage2;
            const a = s2[0].decimate(sinSpace);
            const b = s2[1].decimate(sinMark);
            const c = s2[2].decimate(cosSpace);
            const d = s2[3].decimate(cosMark);
            if (++this.decim2 & 1) {
                const s3 = this.stage3;
                const iSpace = s3[0].filter(a);
                const iMark = s3[1].filter(b);
                const qSpace = s3[2].filter(c);
                const qMark = s3[3].filter(d);
                const markPow = qMark * qMark + iMark * iMark;
                const spacePow = qSpace * qSpace + iSpace * iSpace;
                const mark = (markPow > POWER_FLOOR) ? Math.sqrt(markPow) : 0;
                const space = (spacePow > POWER_FLOOR) ? Math.sqrt(spacePow) : 0;
                this.soft = mark - space;
            }
        }

        this.resampleAcc += 1;
        while (this.resampleAcc >= BITSYNC_STEP) {
            this.resampleAcc -= BITSYNC_STEP;
            this.bitSync(this.soft);
        }
    }

    // SAME_BitSync @ 0x00427174
    bitSync(soft) {
        const ring = this.ring;
        this.ringIdx = (this.ringIdx + 1) & RING_MASK;
        ring[this.ringIdx] = soft;
        if (++this.bitPhase < SAMPLES_PER_BIT) {
            return;
        }
        this.bitPhase = 0;

        if (!this.squelchOpen) {
            this.lockAcc = 0;
            this.locked = false;
        } else {
            const c = (this.ringIdx - SAMPLES_PER_BIT) & RING_MASK;
            let best = 0;
            let bestOffset = 0;
            for (let k = -EYE_SEARCH; k <= EYE_SEARCH; k++) {
                const e = this.eyeOpening((c + k) & RING_MASK);
                if (e > best) {
                    best = e;
                    bestOffset = k;
                }
            }
            if (bestOffset > 0) {
                this.bitPhase--;
            } else if (bestOffset < 0) {
                this.bitPhase++;
            }

            const cur = ring[c] > 0;
            if ((ring[(c - SAMPLES_PER_BIT) & RING_MASK] > 0) === cur) {
                this.addLock(LOCK_NO_EDGE);
            } else if ((ring[(c - EDGE_GUARD) & RING_MASK] > 0) === cur
                && (ring[(c + EDGE_GUARD) & RING_MASK] > 0) === cur) {
                this.addLock(LOCK_CLEAN_EDGE);
            } else {
                this.addLock(LOCK_RAGGED_EDGE);
            }
        }

        if (this.onBit) {
            this.onBit(soft > 0 ? 1 : 0, soft, this.inputSampleIndex(), this.squelchOpen);
        }
    }

    // SAME_EyeMetric10Bits @ 0x00427330
    eyeOpening(pos) {
        const ring = this.ring;
        let sum = 0;
        for (let j = 0; j < EYE_SPAN_BITS; j++) {
            sum += Math.abs(ring[pos]);
            pos = (pos - SAMPLES_PER_BIT) & RING_MASK;
        }
        return sum;
    }

    // SAME_LockIntegrator @ 0x00427390
    addLock(delta) {
        this.lockAcc += delta;
        if (this.lockAcc >= LOCK_MAX) {
            this.locked = true;
            this.lockAcc = LOCK_MAX;
        }
        if (this.lockAcc < 1) {
            this.locked = false;
            this.lockAcc = 0;
        }
    }

    inputSampleIndex() {
        return Math.round(this.nativeCount * this.inputRate / SEATTY_RATE);
    }
}

// The 4th character is compared against 'Z' in the binary (0x00427d17), so a clean "ZCZC" scores 3
// and any error in the first three characters rejects the burst. Kept as-is.
function zczcScore(t) {
    return (t[0] === "Z") + (t[1] === "C") + (t[2] === "Z") + (t[3] === "Z");
}

function nnnnScore(t) {
    return (t[0] === "N") + (t[1] === "N") + (t[2] === "N") + (t[3] === "N");
}

export class SeattySameFramer {
    constructor(opts = {}) {
        this.onChar = opts.onChar || null;
        this.onBurst = opts.onBurst || null;
        this.onMessage = opts.onMessage || null;
        this.timeoutMinutes = opts.timeoutMinutes ?? 5;
        this.ignoreEom = !!opts.ignoreEom;
        this.reset();
    }

    reset() {
        this.shiftReg = 0;
        this.bitCount = 0;
        this.collecting = false;
        this.chars = [];
        this.badChars = 0;
        this.active = false;
        this.text = "";
        this.startMs = 0;
        this.lastHeaderMs = 0;
        this.nowMs = 0;
    }

    // SAME_ByteAssembler @ 0x004273d4
    pushBit(bit, timeMs, squelchOpen = true) {
        this.nowMs = timeMs;
        this.shiftReg = ((this.shiftReg >>> 1) | (bit ? 0x80000000 : 0)) >>> 0;
        this.bitCount++;
        if (!squelchOpen) {
            this.shiftReg = 0xffffffff;
        }

        if (this.shiftReg === SYNC_WORD) {
            this.endBurst("PREAMBLE");
            this.bitCount = 0;
            this.chars.length = 0;
            this.badChars = 0;
            if (this.active) {
                this.collecting = false;
                this.checkTimeout();
            }
            this.collecting = true;
            return;
        }

        if (!this.collecting) {
            if (this.active && (this.bitCount & TIMEOUT_POLL_MASK) === 0) {
                this.checkTimeout();
            }
            return;
        }
        if (this.bitCount <= 7) {
            return;
        }
        this.bitCount = 0;

        let ch = this.shiftReg >>> 24;
        if (this.chars.length === 0 && this.onChar) {
            this.onChar("\r\n");
        }
        if (this.chars.length > MAX_BURST_CHARS || !squelchOpen) {
            this.endBurst(squelchOpen ? "LENGTH" : "SQUELCH");
            this.collecting = false;
            return;
        }
        if ((ch & 0x80) || (ch < 0x20 && ch !== 0x0d && ch !== 0x0a && ch !== 0x09)) {
            ch = BAD_CHAR;
            if (++this.badChars > MAX_BAD_CHARS) {
                this.endBurst("ERRORS");
                this.collecting = false;
                return;
            }
        }
        this.chars.push(ch);
        if (this.onChar) {
            this.onChar(String.fromCharCode(ch));
        }
    }

    // SAME_MessageFramer @ 0x004275a4, event 0 (burst ended)
    endBurst(reason) {
        if (this.chars.length < 4) {
            this.chars.length = 0;
            return;
        }
        const text = String.fromCharCode(...this.chars);
        this.chars.length = 0;
        const looksEom = nnnnScore(text) > 2;
        const isEom = looksEom && !this.ignoreEom;
        const isHeader = zczcScore(text) > 2;
        if (this.onBurst) {
            this.onBurst({
                text,
                badChars: this.badChars,
                reason,
                timeMs: this.nowMs,
                kind: isHeader ? "ZCZC" : (looksEom ? "NNNN" : "OTHER")
            });
        }

        if (!this.active) {
            if (isHeader) {
                this.startMs = this.nowMs;
                this.lastHeaderMs = this.nowMs;
                this.text = text + "\r\n";
                this.active = true;
            }
            return;
        }

        if (isEom) {
            this.lastHeaderMs = this.nowMs;
            this.text += text.slice(0, 4) + "\r\n";
            this.finishMessage("EOM");
            return;
        }
        if (isHeader) {
            const gap = this.nowMs - this.lastHeaderMs;
            this.lastHeaderMs = this.nowMs;
            if (gap > HEADER_REPEAT_MS) {
                this.text += "\r\n";
                this.finishMessage("NEW_HEADER");
                this.startMs = this.nowMs;
                this.text = "";
            }
        }
        this.text += text + "\r\n";
        this.active = true;
    }

    // SAME_MessageFramer event 3: 1050 Hz tone
    toneDetected(timeMs) {
        this.nowMs = timeMs;
        if (!this.active) {
            this.startMs = timeMs;
            this.lastHeaderMs = timeMs;
            this.text = "*** Started by 1050 Hz tone ***\r\n";
            this.active = true;
            return;
        }
        const gap = timeMs - this.lastHeaderMs;
        this.lastHeaderMs = timeMs;
        if (gap > HEADER_REPEAT_MS) {
            this.text += "\r\n*** 1050 Hz tone detected ***\r\n";
            this.finishMessage("TONE");
            this.startMs = timeMs;
            this.text = "*** Started by 1050 Hz tone ***\r\n";
            this.active = true;
        }
    }

    // SAME_MessageFramer event 2
    checkTimeout() {
        if (!this.active || this.chars.length >= 4 || this.collecting) {
            return;
        }
        if (this.nowMs - this.lastHeaderMs > this.timeoutMinutes * 60000) {
            this.text += "\r\n*** Stopped by time-out ***\r\n";
            this.finishMessage("TIMEOUT");
        }
    }

    finishMessage(reason) {
        this.active = false;
        if (this.onMessage) {
            this.onMessage({
                text: this.text,
                startMs: this.startMs,
                endMs: this.nowMs,
                reason
            });
        }
    }

    // Not in SeaTTY, which leaves a message open until EOM or timeout; used at end of file.
    flush() {
        if (this.collecting) {
            this.endBurst("FLUSH");
            this.collecting = false;
        }
        if (this.active) {
            this.finishMessage("FLUSH");
        }
    }
}
