#!/usr/bin/env node
/**
 * A/B harness: the SeaTTY SAME demodulator port (assets/js/seatty-same.js) against the
 * demodulator in assets/js/decoder-bundle.js.
 *
 *   node tools/same-ab.mjs recording.wav [more.wav ...]     decode files with both
 *   node tools/same-ab.mjs --sweep                          synthetic SAME robustness sweep
 *   node tools/same-ab.mjs --tone-sweep                     SeaTTY 1050 Hz detector sweep
 *   node tools/same-ab.mjs --emit test.wav --snr 6          write one synthetic transmission
 *
 * Common options:
 *   --live               model the mic/stream path (1822.9 Hz Q=3 biquad, no file-path gain)
 *   --squelch LEVEL      enable SeaTTY's FFT squelch at slider LEVEL (0..100, SeaTTY default 50)
 *   --detect-1050        enable SeaTTY's 1050 Hz detector in file mode
 *   --no-file-gain       skip the retired quiet-file normalization (RMS <= -21 dBFS -> 0.99 peak) in
 *                        the SeaTTY port and Legacy columns; Integrated never applies it
 *   --workers N          worker threads (default: logical cores - 4)
 * File options:
 *   --context-rate 48000 rate decodeAudioData resamples to; 0 keeps the file's own rate
 * Sweep / emit options:
 *   --trials 40          transmissions per point (SAME: 3 header bursts each)
 *   --snr LIST           comma-separated dB values or "inf" (default 30,20,15,12,10,8,6,4,2,0)
 *   --rate 48000         synthetic sample rate
 *   --level -6           signal peak in dBFS
 *   --freq-offset 0      tone offset in Hz, both SAME tones or the 1050 Hz tone
 *   --clock-ppm 0        transmitter clock error, applied to baud and tones together
 *   --seed 1
 *
 * SNR is referenced to noise in a 3 kHz bandwidth, so for SAME Eb/N0 = SNR + 7.6 dB.
 * "valid-wrong" counts bursts that parse as a well-formed header but differ from what was sent.
 *
 * Three decoders run on the same audio:
 *   SeaTTY port   seatty-same.js with SeaTTY's own byte framing, as the binary behaves
 *   Integrated    what decoder-bundle.js runs now: software bandpass, SeaTTY bits into the
 *                 eas-tools byte logic (handleDemodBit), 1050 Hz detection on unfiltered audio,
 *                 no file gain
 *   Legacy        the retired afskdemod / clockdemod / discriminator, still in decoder-bundle.js as
 *                 commented-out reference code
 * LegacyDecoder mirrors those functions plus finalizeAlert with the ENDEC fingerprinting, DOM and
 * alarm side effects removed; its pushBit is handleDemodBit. Keep it in step with decoder-bundle.js
 * when the byte logic there changes.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { Worker, isMainThread, parentPort } from 'node:worker_threads';
import {
    SAME_BAUD,
    SeattySameDemod,
    SeattySameFramer
} from '../assets/js/seatty-same.js';

const PREAMBLE = '\xAB'.repeat(16);
const FILE_MIN_RMS = 0.08912509381337455;
const LIVE_BANDPASS_HZ = 1822.9;
const LIVE_BANDPASS_Q = 3;
const NOISE_REF_BW = 3000;
const BURSTS_PER_TX = 3;
const TONE_SECONDS = 10;
const PEAK_LIMIT = 0.8912509381337456;
const SAME_TONE_SUPPRESSION_MS = 300000;
const VALID_HEADER = /^ZCZC-[A-Z]{3}-[A-Z0-9]{3}(?:-\d{6}){1,31}\+\d{4}-\d{7}-[\x20-\x2c\x2e-\x5e\x60-\x7e]{8}-/;

const ORIGINATORS = ['WXR', 'EAS', 'CIV', 'PEP'];
const EVENTS = ['TOR', 'SVR', 'FFW', 'FLW', 'SVS', 'SQW', 'WSW', 'BZW', 'EWW', 'SPW', 'CEM', 'EAN', 'RWT', 'RMT', 'DMO'];
const DURATIONS = ['0015', '0030', '0045', '0100', '0130', '0200', '0300', '0600'];

class LegacyDecoder {
    constructor(sampleRate, onBurst, micSource = false, seattyFraming = false) {
        this.onBurst = onBurst;
        this.sampleRate = sampleRate;
        this.micSource = micSource;
        this.seattyFraming = seattyFraming;
        this.preambleShift = 0;
        this.invalidBytes = 0;
        this.phaseMark = 2 * Math.PI * (2083.3 / sampleRate);
        this.phaseSpace = 2 * Math.PI * (1562.5 / sampleRate);
        this.bitPeriod = Math.round(sampleRate / 520.8333333333);
        this.markIwindow = new Float64Array(this.bitPeriod);
        this.markQwindow = new Float64Array(this.bitPeriod);
        this.spaceIwindow = new Float64Array(this.bitPeriod);
        this.spaceQwindow = new Float64Array(this.bitPeriod);
        this.markIInteg = 0;
        this.markQInteg = 0;
        this.spaceIInteg = 0;
        this.spaceQInteg = 0;
        this.clock = 0;
        this.markIndex = 0;
        this.spaceIndex = 0;
        this.thres = 15;
        this.bitState = 0;
        this.bitclock = 0;
        this.prevbit = 0;
        this.currentByte = 0;
        this.bytePos = 0;
        this.syncReg = 0;
        this.decoding = false;
        this.headerTimes = 0;
        this.terminatorRunByte = -1;
        this.terminatorRunCount = 0;
        this.currentMsg = '';
        this.container = false;
        this.eomCount = 0;
        this.demodSampleCounter = 0;
        this.frame = new Float32Array(128);
        this.frameLen = 0;
    }

    process(samples) {
        for (let i = 0; i < samples.length; i++) {
            this.frame[this.frameLen++] = samples[i];
            if (this.frameLen === 128) {
                this.afskdemod(this.frame);
                this.frameLen = 0;
            }
        }
    }

    // The file path hands afskdemod a short final subarray and it reads past the end as undefined.
    flush() {
        if (this.frameLen) {
            this.frame.fill(NaN, this.frameLen);
            this.afskdemod(this.frame);
            this.frameLen = 0;
        }
        this.flushTail();
    }

    // flushPendingDecodeTail
    flushTail() {
        if (this.decoding && this.currentMsg.length) {
            if (this.terminatorRunCount > 0 && (this.terminatorRunByte === 0x00 || this.terminatorRunByte === 0xff)) {
                this.finalize('TERM_BYTE');
            } else {
                this.finalize('PREAMBLE_SPLIT');
            }
        }
    }

    afskdemod(signal) {
        const TWO_PI = 2 * Math.PI;
        for (let i = 0; i < 128; i++) {
            const sig = signal[i];
            const markI = sig * Math.sin(this.markIndex);
            const markQ = sig * Math.cos(this.markIndex);
            const spaceI = sig * Math.sin(this.spaceIndex);
            const spaceQ = sig * Math.cos(this.spaceIndex);
            this.markIndex += this.phaseMark;
            this.spaceIndex += this.phaseSpace;
            if (this.markIndex > TWO_PI) {
                this.markIndex -= TWO_PI;
            }
            if (this.spaceIndex > TWO_PI) {
                this.spaceIndex -= TWO_PI;
            }
            const c = this.clock;
            this.markIInteg += markI - this.markIwindow[c];
            this.markQInteg += markQ - this.markQwindow[c];
            this.spaceIInteg += spaceI - this.spaceIwindow[c];
            this.spaceQInteg += spaceQ - this.spaceQwindow[c];
            this.markIwindow[c] = markI;
            this.markQwindow[c] = markQ;
            this.spaceIwindow[c] = spaceI;
            this.spaceQwindow[c] = spaceQ;
            const s1 = this.markIInteg * this.markIInteg + this.markQInteg * this.markQInteg;
            const s2 = this.spaceIInteg * this.spaceIInteg + this.spaceQInteg * this.spaceQInteg;
            this.clockdemod(s1 - s2);
            this.clock++;
            if (this.clock >= this.bitPeriod) {
                this.clock = 0;
            }
        }
    }

    discriminator(sample) {
        if (sample > this.thres) {
            this.bitState = 1;
        } else if (sample < -this.thres) {
            this.bitState = 0;
        }
        return this.bitState;
    }

    clockdemod(sample) {
        this.demodSampleCounter++;
        const bit = this.discriminator(sample);
        if (bit !== this.prevbit) {
            this.bitclock = 0;
        }
        if (this.bitclock === Math.floor(this.bitPeriod / 2)) {
            this.pushBit(bit);
        }
        if (this.bitclock >= this.bitPeriod) {
            this.bitclock = 0;
        }
        this.bitclock++;
        this.prevbit = bit;
    }

    // handleDemodBit in the integrated decoder-bundle.js when seattyFraming is set
    pushBit(bit) {
        if (this.seattyFraming) {
            this.preambleShift = ((this.preambleShift >>> 1) | (bit << 31)) >>> 0;
            if (this.decoding && this.preambleShift === 0xabababab
                && (this.bytePos !== 7 || (this.micSource && this.currentMsg.length))) {
                if (this.currentMsg.length && this.container) {
                    this.finalize('PREAMBLE_RESYNC');
                }
                this.decoding = false;
                this.bytePos = 0;
                this.currentByte = 0;
                this.headerTimes = 4;
                return;
            }
        }
        this.currentByte |= (bit << this.bytePos);
        this.syncReg = ((this.syncReg << 1) | bit) & 0xff;
        if (this.syncReg === 0xab && !this.decoding) {
            this.bytePos = 0;
            this.headerTimes++;
        }
        this.bytePos++;
        if (this.bytePos === 8) {
            this.completeByte(this.currentByte);
            this.bytePos = 0;
            this.currentByte = 0;
        }
    }

    completeByte(byte) {
        if (byte === 0xab) {
            this.headerTimes++;
            if (this.headerTimes > 4) {
                this.decoding = true;
                this.invalidBytes = 0;
            }
        } else {
            this.headerTimes = 0;
        }
        if (!this.decoding) {
            return;
        }

        if (byte === 0x00 || byte === 0xff) {
            if (this.terminatorRunCount === 0) {
                this.terminatorRunByte = byte;
                this.terminatorRunCount = 1;
            } else if (this.terminatorRunByte === byte) {
                this.terminatorRunCount++;
            } else {
                this.finalize('TERM_BYTE');
            }
            return;
        }
        if (this.terminatorRunCount > 0) {
            this.finalize('TERM_BYTE');
            this.headerTimes = (byte === 0xab) ? 1 : 0;
            return;
        }

        if (!this.micSource && byte === 0xab && this.headerTimes > 4 && this.currentMsg.length && this.container) {
            this.finalize('PREAMBLE_SPLIT');
            this.headerTimes = 1;
        } else if (this.seattyFraming && byte !== 0xab
            && ((byte & 0x80) || (byte < 0x20 && byte !== 0x09 && byte !== 0x0a && byte !== 0x0d))) {
            if (++this.invalidBytes > 4) {
                this.finalize('NOISE');
            }
        } else if (byte !== 0xab) {
            this.container = true;
            const ch = String.fromCharCode(byte);
            if (byte >= 32 && byte <= 126 && /^[A-Za-z0-9\-\+\/\(\)\\ ]$/.test(ch) === false) {
                return;
            }
            this.currentMsg += ch;
            if (this.currentMsg === 'NNNN' && this.eomCount === 2) {
                this.finalize('EOM_PAYLOAD');
            }
        }
    }

    finalize(reason) {
        this.decoding = false;
        this.terminatorRunByte = -1;
        this.terminatorRunCount = 0;
        if (this.container) {
            if (this.currentMsg.startsWith('NNNN')) {
                this.eomCount++;
                if (this.eomCount === 3) {
                    this.eomCount = 0;
                }
            }
            this.onBurst({
                text: this.currentMsg,
                reason,
                timeMs: this.demodSampleCounter * 1000 / this.sampleRate
            });
        }
        this.container = false;
        this.currentMsg = '';
        this.headerTimes = 0;
    }
}

// Stands in for decodeAudioData resampling a file to the AudioContext rate. Kaiser-windowed sinc,
// 80 dB stopband; not part of either decoder.
class BrowserResampler {
    constructor(inRate, outRate) {
        this.ratio = inRate / outRate;
        const minRate = Math.min(inRate, outRate);
        const cutoff = 0.45 * minRate;
        const transition = 0.1 * minRate;
        const attenuation = 80;
        const beta = 0.1102 * (attenuation - 8.7);
        this.half = Math.max(2, Math.ceil((attenuation - 7.95) / (14.36 * transition / inRate) / 2));
        this.taps = 2 * this.half;
        this.phases = 512;
        const fc = cutoff / inRate;
        const i0Beta = besselI0(beta);
        this.table = new Float64Array((this.phases + 1) * this.taps);
        for (let p = 0; p <= this.phases; p++) {
            const row = p * this.taps;
            let sum = 0;
            for (let k = 0; k < this.taps; k++) {
                const d = k - this.half + 1 - p / this.phases;
                const u = d / this.half;
                const w = (Math.abs(u) <= 1) ? besselI0(beta * Math.sqrt(1 - u * u)) / i0Beta : 0;
                const arg = 2 * fc * d;
                const sinc = (arg === 0) ? 1 : Math.sin(Math.PI * arg) / (Math.PI * arg);
                this.table[row + k] = 2 * fc * sinc * w;
                sum += this.table[row + k];
            }
            for (let k = 0; k < this.taps; k++) {
                this.table[row + k] /= sum;
            }
        }
    }

    resample(samples) {
        const padded = new Float64Array(samples.length + 2 * this.taps);
        padded.set(samples, this.half);
        const outLen = Math.floor(samples.length / this.ratio);
        const out = new Float32Array(outLen);
        for (let n = 0; n < outLen; n++) {
            const pos = n * this.ratio;
            const base = Math.floor(pos);
            const phase = (pos - base) * this.phases;
            const p0 = Math.floor(phase);
            const mix = phase - p0;
            const row0 = p0 * this.taps;
            const row1 = row0 + this.taps;
            const first = base + 1;
            let acc0 = 0;
            let acc1 = 0;
            for (let k = 0; k < this.taps; k++) {
                const x = padded[first + k];
                acc0 += x * this.table[row0 + k];
                acc1 += x * this.table[row1 + k];
            }
            out[n] = acc0 + (acc1 - acc0) * mix;
        }
        return out;
    }
}

function besselI0(x) {
    let sum = 1;
    let term = 1;
    const half = x / 2;
    for (let k = 1; k < 64; k++) {
        term *= (half / k) * (half / k);
        sum += term;
        if (term < sum * 1e-17) {
            break;
        }
    }
    return sum;
}

function seattyOptions(opts, rate) {
    return {
        sampleRate: rate,
        squelchEnabled: opts.squelch != null,
        squelchLevel: opts.squelch ?? 50,
        detect1050: !!opts.detect1050,
        tonePeakTruncate: opts.tonePeakTruncate ?? true
    };
}

function runSeatty(samples, rate, opts) {
    const bursts = [];
    const tones = [];
    const framer = new SeattySameFramer({ onBurst: (b) => bursts.push(b) });
    const demod = new SeattySameDemod({
        ...seattyOptions(opts, rate),
        onBit: (bit, soft, sampleIndex, squelchOpen) => framer.pushBit(bit, sampleIndex * 1000 / rate, squelchOpen),
        onTone: (sampleIndex) => {
            tones.push(sampleIndex * 1000 / rate);
            framer.toneDetected(sampleIndex * 1000 / rate);
        }
    });
    for (let i = 0; i < samples.length; i += 2048) {
        demod.process(samples.subarray(i, i + 2048));
    }
    demod.flush();
    framer.flush();
    return { bursts, tones };
}

function runLegacy(samples, rate, micSource) {
    const bursts = [];
    const legacy = new LegacyDecoder(rate, (b) => bursts.push(b), micSource);
    legacy.process(samples);
    legacy.flush();
    return bursts;
}

// decoder-bundle.js as integrated: raw audio into runDecoder, which bandpasses the SAME path in
// software, feeds SeaTTY bits to the unchanged byte logic, and runs the 1050 Hz detector on raw audio.
// Files get no gain any more, like live input.
function runIntegrated(samples, rate, live) {
    const bursts = [];
    const tones = [];
    let sameActiveUntilMs = -1;
    const onBurst = (b) => {
        bursts.push(b);
        if (VALID_HEADER.test(b.text)) {
            sameActiveUntilMs = b.timeMs + SAME_TONE_SUPPRESSION_MS;
        } else if (b.text.startsWith('NNNN')) {
            sameActiveUntilMs = -1;
        }
    };
    const bytes = new LegacyDecoder(rate, onBurst, live, true);
    const demod = new SeattySameDemod({
        sampleRate: rate,
        saturateInt16: true,
        detect1050: true,
        tonePeakTruncate: false,
        sameBandpass: { hz: LIVE_BANDPASS_HZ, q: LIVE_BANDPASS_Q },
        onBit: (bit, soft, sampleIndex) => {
            bytes.demodSampleCounter = sampleIndex;
            bytes.pushBit(bit);
        },
        onTone: (sampleIndex) => {
            const timeMs = sampleIndex * 1000 / rate;
            if (timeMs > sameActiveUntilMs) {
                tones.push(timeMs);
            }
        }
    });
    for (let i = 0; i < samples.length; i += 128) {
        demod.process(samples.subarray(i, i + 128));
    }
    demod.flush();
    bytes.flushTail();
    return { bursts, tones };
}

let fileGainEnabled = true;

// The retired file path's normalization, kept for the SeaTTY port and Legacy columns: boost to
// 0.99 peak when RMS is at or below -21 dBFS. decoder-bundle.js dropped it with the legacy demod.
function applyFileGain(samples) {
    if (!fileGainEnabled) {
        return;
    }
    let peak = 0;
    let sumSquares = 0;
    for (let i = 0; i < samples.length; i++) {
        const abs = Math.abs(samples[i]);
        if (abs > peak) {
            peak = abs;
        }
        sumSquares += samples[i] * samples[i];
    }
    if (peak > 0 && samples.length > 0) {
        const rms = Math.sqrt(sumSquares / samples.length);
        if (rms > 0 && rms <= FILE_MIN_RMS) {
            const gain = 0.99 / peak;
            if (gain > 1) {
                for (let i = 0; i < samples.length; i++) {
                    samples[i] *= gain;
                }
            }
        }
    }
}

// WebAudio BiquadFilterNode "bandpass", as configured in decoder-bundle.js
function applyLiveBandpass(samples, rate) {
    const w0 = 2 * Math.PI * LIVE_BANDPASS_HZ / rate;
    const alpha = Math.sin(w0) / (2 * LIVE_BANDPASS_Q);
    const a0 = 1 + alpha;
    const b0 = alpha / a0;
    const b2 = -alpha / a0;
    const a1 = -2 * Math.cos(w0) / a0;
    const a2 = (1 - alpha) / a0;
    let x1 = 0;
    let x2 = 0;
    let y1 = 0;
    let y2 = 0;
    for (let i = 0; i < samples.length; i++) {
        const x = samples[i];
        const y = b0 * x + b2 * x2 - a1 * y1 - a2 * y2;
        x2 = x1;
        x1 = x;
        y2 = y1;
        y1 = y;
        samples[i] = y;
    }
}

function conditionInput(samples, rate, live) {
    if (live) {
        applyLiveBandpass(samples, rate);
    } else {
        applyFileGain(samples);
    }
}

function mulberry32(seed) {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function gaussian(rng) {
    let u = 0;
    while (u === 0) {
        u = rng();
    }
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rng());
}

// Scales the result down to a -1 dBFS peak when the noise would push it past full scale, as a
// recording made at a sane level would be; SeaTTY's int16 input path wraps rather than clips.
function addNoise(out, amp, snrDb, rate, rng) {
    if (!Number.isFinite(snrDb)) {
        return;
    }
    const noisePower = (amp * amp / 2) / 10 ** (snrDb / 10) * (rate / 2) / NOISE_REF_BW;
    const sigma = Math.sqrt(noisePower);
    let peak = 0;
    for (let i = 0; i < out.length; i++) {
        out[i] += sigma * gaussian(rng);
        peak = Math.max(peak, Math.abs(out[i]));
    }
    if (peak > PEAK_LIMIT) {
        const gain = PEAK_LIMIT / peak;
        for (let i = 0; i < out.length; i++) {
            out[i] *= gain;
        }
    }
}

function randomHeader(rng) {
    const pick = (list) => list[Math.floor(rng() * list.length)];
    const digits = (n) => {
        let s = '';
        for (let i = 0; i < n; i++) {
            s += Math.floor(rng() * 10);
        }
        return s;
    };
    const letters = (n) => {
        let s = '';
        for (let i = 0; i < n; i++) {
            s += String.fromCharCode(65 + Math.floor(rng() * 26));
        }
        return s;
    };
    const pad = (v, n) => String(v).padStart(n, '0');
    const locations = [];
    const count = 1 + Math.floor(rng() * 6);
    for (let i = 0; i < count; i++) {
        locations.push(`${Math.floor(rng() * 10)}${pad(1 + Math.floor(rng() * 56), 2)}${digits(3)}`);
    }
    const issued = `${pad(1 + Math.floor(rng() * 365), 3)}${pad(Math.floor(rng() * 24), 2)}${pad(Math.floor(rng() * 60), 2)}`;
    return `ZCZC-${pick(ORIGINATORS)}-${pick(EVENTS)}-${locations.join('-')}+${pick(DURATIONS)}-${issued}-K${letters(3)}/NWS-`;
}

function synthesizeTransmission(header, opts, rng) {
    const rate = opts.rate;
    const clock = 1 + opts.clockPpm * 1e-6;
    const baud = SAME_BAUD * clock;
    const fMark = (2083.3333333333335 + opts.freqOffset) * clock;
    const fSpace = (1562.5 + opts.freqOffset) * clock;
    const amp = 10 ** (opts.level / 20);
    const bytes = Array.from(PREAMBLE + header, (c) => c.charCodeAt(0));
    const bits = bytes.length * 8;
    const burstLen = Math.ceil(bits * rate / baud);
    const gap = Math.round(rate);
    const total = gap + BURSTS_PER_TX * burstLen + (BURSTS_PER_TX - 1) * gap + gap;
    const out = new Float32Array(total);

    let offset = gap;
    for (let b = 0; b < BURSTS_PER_TX; b++) {
        let phase = rng() * 2 * Math.PI;
        for (let n = 0; n < burstLen; n++) {
            const bitIndex = Math.floor(n * baud / rate);
            if (bitIndex >= bits) {
                break;
            }
            const bit = (bytes[bitIndex >> 3] >> (bitIndex & 7)) & 1;
            phase += 2 * Math.PI * (bit ? fMark : fSpace) / rate;
            out[offset + n] = amp * Math.sin(phase);
        }
        offset += burstLen + gap;
    }
    addNoise(out, amp, opts.snrDb, rate, rng);
    return out;
}

// One second of lead-in and tail around TONE_SECONDS of signal. "tone" is the NWR 1050 Hz alert
// tone, "attention" the EAS 853 + 960 Hz two-tone at the same total power, "noise" is noise only.
function synthesizeTone(opts, rng) {
    const rate = opts.rate;
    const amp = 10 ** (opts.level / 20);
    const lead = Math.round(rate);
    const body = Math.round(rate * TONE_SECONDS);
    const out = new Float32Array(lead + body + lead);
    if (opts.kind === 'tone') {
        const w = 2 * Math.PI * (1050 + opts.freqOffset) / rate;
        const phase = rng() * 2 * Math.PI;
        for (let n = 0; n < body; n++) {
            out[lead + n] = amp * Math.sin(w * n + phase);
        }
    } else if (opts.kind === 'attention') {
        const w1 = 2 * Math.PI * 853 / rate;
        const w2 = 2 * Math.PI * 960 / rate;
        const a = amp / Math.SQRT2;
        for (let n = 0; n < body; n++) {
            out[lead + n] = a * (Math.sin(w1 * n) + Math.sin(w2 * n));
        }
    }
    addNoise(out, amp, opts.snrDb, rate, rng);
    return out;
}

function scoreBursts(bursts, header) {
    let exact = 0;
    let validWrong = 0;
    let garbled = 0;
    for (const b of bursts) {
        if (b.text.startsWith(header)) {
            exact++;
        } else if (b.text.startsWith('ZCZC')) {
            if (VALID_HEADER.test(b.text)) {
                validWrong++;
            } else {
                garbled++;
            }
        }
    }
    return { exact: Math.min(exact, BURSTS_PER_TX), validWrong, garbled };
}

// Ideal non-coherent BFSK: BER = exp(-Eb/2N0) / 2, over the header plus 4 preamble bytes for sync
function idealBurstRate(snrDb, headerLength) {
    if (!Number.isFinite(snrDb)) {
        return 1;
    }
    const ebno = 10 ** (snrDb / 10) * NOISE_REF_BW / SAME_BAUD;
    const ber = 0.5 * Math.exp(-ebno / 2);
    return (1 - ber) ** (8 * (headerLength + 4));
}

function trialSeed(base, pointIndex, trial) {
    return (base * 1000003 + pointIndex * 7919 + trial * 104729) >>> 0;
}

function runSweepJob(job) {
    const rng = mulberry32(job.seed);
    const header = randomHeader(rng);
    const samples = synthesizeTransmission(header, job, rng);
    const raw = Float32Array.from(samples);
    conditionInput(samples, job.rate, job.live);
    return {
        pointIndex: job.pointIndex,
        headerLength: header.length,
        seatty: scoreBursts(runSeatty(samples, job.rate, job).bursts, header),
        integrated: scoreBursts(runIntegrated(raw, job.rate, job.live).bursts, header),
        legacy: scoreBursts(runLegacy(samples, job.rate, job.live), header)
    };
}

function runToneJob(job) {
    const rng = mulberry32(job.seed);
    const samples = synthesizeTone(job, rng);
    const raw = Float32Array.from(samples);
    conditionInput(samples, job.rate, job.live);
    const fired = (tones) => ({ fired: tones.length > 0, latencyMs: tones.length ? tones[0] - 1000 : null });
    return {
        pointIndex: job.pointIndex,
        seatty: fired(runSeatty(samples, job.rate, { ...job, detect1050: true }).tones),
        integrated: fired(runIntegrated(raw, job.rate, job.live).tones)
    };
}

function readWav(file) {
    const buf = fs.readFileSync(file);
    if (buf.length < 12 || buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') {
        throw new Error(`${file}: not a RIFF/WAVE file`);
    }
    let fmt = null;
    let data = null;
    let off = 12;
    while (off + 8 <= buf.length) {
        const id = buf.toString('ascii', off, off + 4);
        let size = buf.readUInt32LE(off + 4);
        const body = off + 8;
        if (size === 0 || body + size > buf.length) {
            size = buf.length - body;
        }
        if (id === 'fmt ') {
            let format = buf.readUInt16LE(body);
            if (format === 0xfffe && size >= 26) {
                format = buf.readUInt16LE(body + 24);
            }
            fmt = {
                format,
                channels: buf.readUInt16LE(body + 2),
                rate: buf.readUInt32LE(body + 4),
                blockAlign: buf.readUInt16LE(body + 12),
                bits: buf.readUInt16LE(body + 14)
            };
        } else if (id === 'data') {
            data = { body, size };
        }
        off = body + size + (size & 1);
    }
    if (!fmt || !data) {
        throw new Error(`${file}: missing fmt or data chunk`);
    }

    const frames = Math.floor(data.size / fmt.blockAlign);
    const samples = new Float32Array(frames);
    const bytesPer = fmt.bits / 8;
    for (let f = 0; f < frames; f++) {
        const pos = data.body + f * fmt.blockAlign;
        if (fmt.format === 3) {
            samples[f] = (bytesPer === 8) ? buf.readDoubleLE(pos) : buf.readFloatLE(pos);
        } else if (fmt.format === 1) {
            if (bytesPer === 1) {
                samples[f] = (buf[pos] - 128) / 128;
            } else if (bytesPer === 2) {
                samples[f] = buf.readInt16LE(pos) / 32768;
            } else if (bytesPer === 3) {
                samples[f] = buf.readIntLE(pos, 3) / 8388608;
            } else {
                samples[f] = buf.readInt32LE(pos) / 2147483648;
            }
        } else {
            throw new Error(`${file}: unsupported WAV format ${fmt.format}`);
        }
    }
    return { samples, ...fmt };
}

function writeWav16(file, samples, rate) {
    const buf = Buffer.alloc(44 + samples.length * 2);
    buf.write('RIFF', 0, 'ascii');
    buf.writeUInt32LE(36 + samples.length * 2, 4);
    buf.write('WAVE', 8, 'ascii');
    buf.write('fmt ', 12, 'ascii');
    buf.writeUInt32LE(16, 16);
    buf.writeUInt16LE(1, 20);
    buf.writeUInt16LE(1, 22);
    buf.writeUInt32LE(rate, 24);
    buf.writeUInt32LE(rate * 2, 28);
    buf.writeUInt16LE(2, 32);
    buf.writeUInt16LE(16, 34);
    buf.write('data', 36, 'ascii');
    buf.writeUInt32LE(samples.length * 2, 40);
    for (let i = 0; i < samples.length; i++) {
        const v = Math.max(-1, Math.min(1, samples[i]));
        buf.writeInt16LE(Math.round(v * 32767), 44 + i * 2);
    }
    fs.writeFileSync(file, buf);
}

function runFileJob(job) {
    const wav = readWav(job.path);
    let samples = wav.samples;
    let rate = wav.rate;
    if (job.contextRate && job.contextRate !== wav.rate) {
        samples = new BrowserResampler(wav.rate, job.contextRate).resample(samples);
        rate = job.contextRate;
    }
    const raw = Float32Array.from(samples);
    conditionInput(samples, rate, job.live);
    const seatty = runSeatty(samples, rate, job);
    const integrated = runIntegrated(raw, rate, job.live);
    return {
        path: job.path,
        fileRate: wav.rate,
        channels: wav.channels,
        bits: wav.bits,
        seconds: wav.samples.length / wav.rate,
        decodeRate: rate,
        seatty: seatty.bursts,
        tones: seatty.tones,
        integrated: integrated.bursts,
        integratedTones: integrated.tones,
        legacy: runLegacy(samples, rate, job.live)
    };
}

function runJob(job) {
    fileGainEnabled = !job.noFileGain;
    if (job.type === 'sweep') {
        return runSweepJob(job);
    }
    if (job.type === 'tone') {
        return runToneJob(job);
    }
    return runFileJob(job);
}

if (!isMainThread) {
    parentPort.on('message', ({ ids, jobs }) => {
        const results = jobs.map((job) => {
            try {
                return runJob(job);
            } catch (err) {
                return { error: String(err && err.message ? err.message : err), path: job.path };
            }
        });
        parentPort.postMessage({ ids, results });
    });
} else {
    main().catch((err) => {
        console.error(err && err.stack ? err.stack : err);
        process.exit(1);
    });
}

function parseArgs(argv) {
    const opts = {
        files: [],
        sweep: false,
        toneSweep: false,
        emit: null,
        live: false,
        squelch: null,
        detect1050: false,
        noFileGain: false,
        workers: Math.max(1, (os.availableParallelism ? os.availableParallelism() : os.cpus().length) - 4),
        contextRate: 48000,
        trials: 40,
        snr: [30, 20, 15, 12, 10, 8, 6, 4, 2, 0],
        snrGiven: false,
        rate: 48000,
        level: -6,
        freqOffset: 0,
        clockPpm: 0,
        seed: 1
    };
    const num = (v, name) => {
        const n = Number(v);
        if (!Number.isFinite(n)) {
            throw new Error(`${name} needs a number, got "${v}"`);
        }
        return n;
    };
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        const next = () => {
            if (i + 1 >= argv.length) {
                throw new Error(`${a} needs a value`);
            }
            return argv[++i];
        };
        switch (a) {
            case '--sweep': opts.sweep = true; break;
            case '--tone-sweep': opts.toneSweep = true; break;
            case '--emit': opts.emit = next(); break;
            case '--live': opts.live = true; break;
            case '--squelch': opts.squelch = num(next(), a); break;
            case '--detect-1050': opts.detect1050 = true; break;
            case '--no-file-gain': opts.noFileGain = true; break;
            case '--workers': opts.workers = Math.max(1, num(next(), a)); break;
            case '--context-rate': opts.contextRate = num(next(), a); break;
            case '--trials': opts.trials = Math.max(1, num(next(), a)); break;
            case '--snr':
                opts.snr = next().split(',').map((s) => (s.trim().toLowerCase() === 'inf') ? Infinity : num(s, a));
                opts.snrGiven = true;
                break;
            case '--rate': opts.rate = num(next(), a); break;
            case '--level': opts.level = num(next(), a); break;
            case '--freq-offset': opts.freqOffset = num(next(), a); break;
            case '--clock-ppm': opts.clockPpm = num(next(), a); break;
            case '--seed': opts.seed = num(next(), a); break;
            case '-h':
            case '--help':
                opts.help = true;
                break;
            default:
                if (a.startsWith('--')) {
                    throw new Error(`unknown option ${a}`);
                }
                opts.files.push(a);
        }
    }
    return opts;
}

function progress(label, done, total, started) {
    if (!process.stderr.isTTY) {
        return;
    }
    const width = 30;
    const filled = Math.round(width * done / total);
    const secs = (performance.now() - started) / 1000;
    process.stderr.write(`\r${label} [${'#'.repeat(filled)}${'.'.repeat(width - filled)}] ${done}/${total}  ${(done / Math.max(secs, 1e-3)).toFixed(1)}/s `);
    if (done === total) {
        process.stderr.write('\n');
    }
}

function runPool(jobs, workerCount, label) {
    const results = new Array(jobs.length);
    const started = performance.now();
    const count = Math.min(workerCount, jobs.length);
    const batch = Math.max(1, Math.min(8, Math.floor(jobs.length / (count * 4))));
    let next = 0;
    let done = 0;
    return new Promise((resolve, reject) => {
        let alive = count;
        for (let w = 0; w < count; w++) {
            const worker = new Worker(new URL(import.meta.url));
            const feed = () => {
                if (next >= jobs.length) {
                    worker.terminate();
                    if (--alive === 0) {
                        const secs = (performance.now() - started) / 1000;
                        resolve({ results, secs });
                    }
                    return;
                }
                const ids = [];
                while (ids.length < batch && next < jobs.length) {
                    ids.push(next++);
                }
                worker.postMessage({ ids, jobs: ids.map((id) => jobs[id]) });
            };
            worker.on('message', ({ ids, results: out }) => {
                ids.forEach((id, k) => {
                    results[id] = out[k];
                });
                done += ids.length;
                progress(label, done, jobs.length, started);
                feed();
            });
            worker.on('error', reject);
            feed();
        }
    });
}

function printable(text) {
    return text.replace(/[\x00-\x1f\x7f-\xff]/g, (c) => `\\x${c.charCodeAt(0).toString(16).padStart(2, '0')}`);
}

function pct(n, d) {
    return `${(100 * n / d).toFixed(1).padStart(5)}%`;
}

function throwOnJobError(results) {
    const failed = results.find((r) => r && r.error);
    if (failed) {
        throw new Error(failed.error);
    }
}

function sharedJobFields(opts) {
    return {
        rate: opts.rate,
        level: opts.level,
        freqOffset: opts.freqOffset,
        clockPpm: opts.clockPpm,
        live: opts.live,
        squelch: opts.squelch,
        detect1050: opts.detect1050,
        noFileGain: opts.noFileGain
    };
}

async function runSweep(opts) {
    const jobs = [];
    opts.snr.forEach((snrDb, pointIndex) => {
        for (let t = 0; t < opts.trials; t++) {
            jobs.push({ type: 'sweep', pointIndex, snrDb, seed: trialSeed(opts.seed, pointIndex, t), ...sharedJobFields(opts) });
        }
    });

    const squelchNote = (opts.squelch === null) ? 'squelch off' : `squelch ${opts.squelch}`;
    console.log(`SeaTTY port vs decoder-bundle.js demod: ${opts.rate} Hz, ${opts.level} dBFS peak, ` +
        `offset ${opts.freqOffset} Hz, clock ${opts.clockPpm} ppm, ${opts.live ? 'live mic/stream' : 'file'} path, ${squelchNote}`);
    console.log(`${opts.trials} transmissions x ${BURSTS_PER_TX} bursts per point, seed ${opts.seed}, workers: ${Math.min(opts.workers, jobs.length)}`);

    const { results, secs } = await runPool(jobs, opts.workers, 'sweep');
    throwOnJobError(results);

    const blank = () => ({ exact: 0, any: 0, validWrong: 0, garbled: 0 });
    const rows = opts.snr.map(() => ({ seatty: blank(), integrated: blank(), legacy: blank(), ideal: 0 }));
    for (const r of results) {
        rows[r.pointIndex].ideal += idealBurstRate(opts.snr[r.pointIndex], r.headerLength) / opts.trials;
        for (const key of ['seatty', 'integrated', 'legacy']) {
            const row = rows[r.pointIndex][key];
            row.exact += r[key].exact;
            row.any += (r[key].exact > 0) ? 1 : 0;
            row.validWrong += r[key].validWrong;
            row.garbled += r[key].garbled;
        }
    }

    const bursts = opts.trials * BURSTS_PER_TX;
    const cols = (s) => `${pct(s.exact, bursts)} ${pct(s.any, opts.trials)} ${String(s.validWrong).padStart(6)} ${String(s.garbled).padStart(8)}`;
    console.log('');
    const group = '| burst    any  valid-wrong garbled ';
    console.log('                        |           SeaTTY port             |      Integrated decoder-bundle    |              Legacy');
    console.log(`   SNR   Eb/N0   ideal ${group}${group}${group}`);
    opts.snr.forEach((snrDb, i) => {
        const snr = Number.isFinite(snrDb) ? snrDb.toFixed(1).padStart(6) : '   inf';
        const ebno = Number.isFinite(snrDb) ? (snrDb + 10 * Math.log10(NOISE_REF_BW / SAME_BAUD)).toFixed(1).padStart(6) : '   inf';
        console.log(`${snr} ${ebno} ${pct(rows[i].ideal, 1)} | ${cols(rows[i].seatty)}     | ${cols(rows[i].integrated)}     | ${cols(rows[i].legacy)}`);
    });
    console.log('');
    console.log(`${jobs.length} transmissions in ${secs.toFixed(2)} s (${(jobs.length / secs).toFixed(1)}/s)`);
}

async function runToneSweep(opts) {
    const snrs = opts.snrGiven ? opts.snr : [Infinity, 20, 10, 6, 3, 0, -3, -6];
    const points = [];
    for (const snrDb of snrs) {
        points.push({ label: '1050 Hz tone', kind: 'tone', snrDb, level: opts.level, freqOffset: opts.freqOffset });
    }
    for (const level of [-3, -9, -12, -13, -15, -20, -30, -40]) {
        points.push({ label: '1050 Hz tone', kind: 'tone', snrDb: 20, level, freqOffset: opts.freqOffset });
    }
    for (const offset of [-60, -45, -30, -15, 15, 30, 45, 60]) {
        points.push({ label: '1050 Hz tone', kind: 'tone', snrDb: 20, level: opts.level, freqOffset: offset });
    }
    for (const snrDb of [Infinity, 20, 10]) {
        points.push({ label: '853+960 attention', kind: 'attention', snrDb, level: opts.level, freqOffset: 0 });
    }
    points.push({ label: 'noise only', kind: 'noise', snrDb: 0, level: opts.level, freqOffset: 0 });

    const jobs = [];
    points.forEach((p, pointIndex) => {
        for (let t = 0; t < opts.trials; t++) {
            jobs.push({
                type: 'tone',
                pointIndex,
                seed: trialSeed(opts.seed, pointIndex, t),
                ...sharedJobFields(opts),
                kind: p.kind,
                snrDb: p.snrDb,
                level: p.level,
                freqOffset: p.freqOffset
            });
        }
    });

    const squelchNote = (opts.squelch === null) ? 'squelch off' : `squelch ${opts.squelch}`;
    console.log(`SeaTTY 1050 Hz detector: ${opts.rate} Hz, ${TONE_SECONDS} s signal, ${opts.live ? 'live mic/stream' : 'file'} path, ${squelchNote}`);
    console.log(`${opts.trials} trials per point, seed ${opts.seed}, workers: ${Math.min(opts.workers, jobs.length)}`);
    const { results, secs } = await runPool(jobs, opts.workers, 'tone');
    throwOnJobError(results);

    const rows = points.map(() => ({ seatty: 0, integrated: 0, latency: [] }));
    for (const r of results) {
        for (const key of ['seatty', 'integrated']) {
            if (r[key].fired) {
                rows[r.pointIndex][key]++;
                if (key === 'integrated') {
                    rows[r.pointIndex].latency.push(r[key].latencyMs);
                }
            }
        }
    }

    console.log('');
    console.log('  signal              level  offset    SNR |  SeaTTY (ftol)  integrated | first fire (integrated)');
    points.forEach((p, i) => {
        const snr = Number.isFinite(p.snrDb) ? `${p.snrDb.toFixed(0)} dB` : 'inf';
        const lat = rows[i].latency.length ? `${(rows[i].latency.reduce((a, b) => a + b, 0) / rows[i].latency.length / 1000).toFixed(2)} s` : '-';
        console.log(`  ${p.label.padEnd(18)} ${String(p.level).padStart(5)}  ${String(p.freqOffset).padStart(5)} ${snr.padStart(7)} | ` +
            `${pct(rows[i].seatty, opts.trials).padStart(13)}  ${pct(rows[i].integrated, opts.trials).padStart(10)} | ${lat}`);
    });
    console.log('');
    console.log(`${jobs.length} runs in ${secs.toFixed(2)} s (${(jobs.length / secs).toFixed(1)}/s)`);
}

async function runFiles(opts) {
    const jobs = opts.files.map((p) => ({
        type: 'file',
        path: path.resolve(p),
        contextRate: opts.contextRate,
        live: opts.live,
        squelch: opts.squelch,
        detect1050: opts.detect1050,
        noFileGain: opts.noFileGain
    }));
    console.log(`decoding ${jobs.length} file(s), workers: ${Math.min(opts.workers, jobs.length)}`);
    const { results, secs } = await runPool(jobs, opts.workers, 'files');
    for (const r of results) {
        console.log('');
        if (r.error) {
            console.log(`${r.path}: ${r.error}`);
            continue;
        }
        const rateNote = (r.decodeRate !== r.fileRate) ? ` -> ${r.decodeRate} Hz` : '';
        console.log(`${r.path}  ${r.channels}ch ${r.bits}-bit ${r.fileRate} Hz${rateNote}  ${r.seconds.toFixed(1)} s`);
        for (const [label, bursts] of [['SeaTTY port', r.seatty], ['Integrated', r.integrated], ['Legacy', r.legacy]]) {
            console.log(`  ${label}: ${bursts.length} burst(s)`);
            for (const b of bursts) {
                console.log(`    ${(b.timeMs / 1000).toFixed(2).padStart(8)} s  ${b.reason.padEnd(14)} ${printable(b.text)}`);
            }
        }
        const toneTimes = (tones) => (tones.length ? tones.map((t) => `${(t / 1000).toFixed(2)} s`).join(', ') : 'none');
        if (opts.detect1050) {
            console.log(`  SeaTTY 1050 Hz: ${toneTimes(r.tones)}`);
        }
        console.log(`  Integrated 1050 Hz: ${toneTimes(r.integratedTones)}`);
    }
    console.log('');
    console.log(`${jobs.length} file(s) in ${secs.toFixed(2)} s`);
}

function runEmit(opts) {
    const snrDb = opts.snr[0];
    const rng = mulberry32(trialSeed(opts.seed, 0, 0));
    const header = randomHeader(rng);
    const samples = synthesizeTransmission(header, {
        rate: opts.rate,
        level: opts.level,
        freqOffset: opts.freqOffset,
        clockPpm: opts.clockPpm,
        snrDb
    }, rng);
    writeWav16(opts.emit, samples, opts.rate);
    console.log(`wrote ${opts.emit}: ${opts.rate} Hz, ${(samples.length / opts.rate).toFixed(2)} s, SNR ${snrDb} dB (3 kHz)`);
    console.log(`header: ${header}`);
}

async function main() {
    const opts = parseArgs(process.argv.slice(2));
    if (opts.help || (!opts.sweep && !opts.toneSweep && !opts.emit && !opts.files.length)) {
        const src = fs.readFileSync(new URL(import.meta.url), 'utf8');
        const doc = /\/\*\*([\s\S]*?)\*\//.exec(src);
        console.log(doc ? doc[1].replace(/^ \* ?/gm, '').trim() : 'see source');
        return;
    }
    if (opts.emit) {
        runEmit(opts);
        return;
    }
    if (opts.sweep) {
        await runSweep(opts);
    }
    if (opts.toneSweep) {
        await runToneSweep(opts);
    }
    if (opts.files.length) {
        await runFiles(opts);
    }
}
