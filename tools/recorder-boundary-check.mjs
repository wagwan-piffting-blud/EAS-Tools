#!/usr/bin/env node
/**
 * Boundary check for the decoder's auto-recording patch (assets/js/decoder-bundle.js).
 *
 *   node tools/recorder-boundary-check.mjs
 *
 * Auto-recording starts on the first preamble the demodulator locks onto, which is already a
 * few bytes into header burst 1, and stops after the third EOM. patchAutoRecordingPcmBoundaries
 * rebuilds only the lead-in that was lost before the recorder came up and trims the tail to the
 * last bit of the last NNNN, so all six bursts in the file are the ones that were on the air.
 *
 * This synthesizes a transmission, cuts it the way the recorder would, runs the real patch
 * functions on the result and decodes what comes back with seatty-same.js:
 *   - the file spans exactly burst-1 start to last-NNNN bit
 *   - nothing follows the last NNNN bit
 *   - the rebuilt lead-in matches the captured burst's level and the original preamble's samples
 *   - three headers decode byte-identical and three EOMs decode
 *   - burst 1's preamble run fingerprints the same as the untouched bursts
 * plus a noisy input and a run where EOM 2 and 3 never arrive.
 *
 * The functions under test are sliced out of decoder-bundle.js by name and evaluated against
 * stubs for the DOM, the ENDEC profile and the decoder's live state, so this exercises the
 * shipping source rather than a copy of it. Renaming any entry in NAMES breaks the slice
 * loudly rather than silently testing nothing.
 */
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { SeattySameDemod, SeattySameFramer, SAME_BAUD } from '../assets/js/seatty-same.js';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BUNDLE = path.join(REPO_ROOT, 'assets', 'js', 'decoder-bundle.js');
const src = fs.readFileSync(BUNDLE, 'utf8');

// Every function in NAMES is declared at one indent level inside the decoder IIFE, so its body
// ends at the first "\n    }\n" after its header.
function sliceFunction(name) {
    const head = src.indexOf(`\n    function ${name}(`);
    if (head < 0) throw new Error(`function ${name} not found in ${BUNDLE}`);
    const end = src.indexOf('\n    }\n', head);
    if (end < 0) throw new Error(`end of ${name} not found in ${BUNDLE}`);
    return src.slice(head + 1, end + 6);
}

const NAMES = [
    'samplesFromMsAtRate', 'bitsFromStringLSB', 'stripLeadingPreamble16',
    'buildTxStringsFromBursts', 'buildHeaderTxStrings', 'buildEomTxStrings',
    'hasCompleteSameHeaderTail', 'samplesPerSameBit', 'renderSameAfsk',
    'synthesizeSameBurst', 'synthesizeSameBurstLeadIn', 'peakBetween',
    'refineBurstSegment', 'findBurstSegments', 'concatPcmParts',
    'getAutoRecordingHeaderForPatch', 'patchAutoRecordingPcmBoundaries'
];

const RATE = 48000;
const PROFILE = {
    betweenGapMs: 1000,
    afterGapMs: 1000,
    headerBursts: [{ prefix: '', suffix: '' }, { prefix: '', suffix: '' }, { prefix: '', suffix: '' }],
    eomBursts: [{ prefix: '', suffix: '' }, { prefix: '', suffix: '' }, { prefix: '', suffix: '' }]
};

const prelude = `
const SAME_BIT_SECONDS = 0.00192;
const SAME_MARK_FREQ = 2083.3333333;
const SAME_SPACE_FREQ = 1562.5;
const SAME_TX_AMPLITUDE = 0.79;
const SAME_TWO_PI = Math.PI * 2;
const SAME_PREAMBLE = "\\xAB".repeat(16);
const sampleRate = ${RATE};
const PROFILE = ${JSON.stringify(PROFILE)};
function getEndecModeProfile() { return PROFILE; }
function getOverallEndecMode() { return "DEFAULT"; }
let activeSameProduct = null;
let currentMsg = "";
let autoRecordingEomBursts = 0;
`;

const exported = `
return {
    patchAutoRecordingPcmBoundaries,
    setContext(headerKey, eomBursts) {
        activeSameProduct = { headerKey };
        autoRecordingEomBursts = eomBursts;
    }
};
`;

const api = new Function(prelude + NAMES.map(sliceFunction).join('\n') + exported)();

const HEADER = 'ZCZC-EAS-RWT-048113+0015-2621234-WAGS/TV -';
const PREAMBLE = '\xAB'.repeat(16);

function txBits(text) {
    const bits = [];
    for (let i = 0; i < text.length; i++) {
        const c = text.charCodeAt(i) & 0xFF;
        for (let b = 0; b < 8; b++) bits.push((c >> b) & 1);
    }
    return bits;
}

// Independent of renderSameAfsk on purpose: SAME_BAUD comes from seatty-same.js, so a bit period
// that drifts off 520.833 in the bundle shows up here as a decode failure instead of cancelling out.
function modulate(out, offset, text, amp, phaseRef) {
    const bits = txBits(text);
    const spb = RATE / SAME_BAUD;
    const total = Math.ceil(bits.length * spb);
    let phase = phaseRef.phase;
    let clock = 0;
    for (let k = 0; k < bits.length; k++) {
        const inc = 2 * Math.PI * (bits[k] ? 2083.3333333 : 1562.5) / RATE;
        const bitEnd = (k + 1) * spb;
        while (clock < bitEnd) {
            out[offset + clock] = amp * Math.sin(phase);
            phase += inc;
            clock++;
        }
    }
    phaseRef.phase = phase;
    return total;
}

function buildTransmission(amp) {
    const gap = RATE;
    const spb = RATE / SAME_BAUD;
    const headerLen = Math.ceil((PREAMBLE + HEADER).length * 8 * spb);
    const eomLen = Math.ceil((PREAMBLE + 'NNNN').length * 8 * spb);
    const tone = Math.round(RATE * 8);
    const voice = Math.round(RATE * 2);
    const total = gap + 3 * headerLen + 3 * gap + tone + gap + voice + gap
        + 3 * eomLen + 2 * gap + Math.round(RATE * 0.4);
    const out = new Float32Array(total);
    const marks = {};
    const phaseRef = { phase: 0.7 };
    let o = gap;
    marks.headerStart = o;
    for (let i = 0; i < 3; i++) {
        modulate(out, o, PREAMBLE + HEADER, amp, phaseRef);
        o += headerLen;
        if (i === 0) marks.firstHeaderEnd = o;
        o += gap;
    }
    for (let n = 0; n < tone; n++) {
        out[o + n] = (amp / Math.SQRT2)
            * (Math.sin(2 * Math.PI * 853 * n / RATE) + Math.sin(2 * Math.PI * 960 * n / RATE));
    }
    o += tone + gap;
    for (let n = 0; n < voice; n++) {
        out[o + n] = amp * 0.5 * Math.sin(2 * Math.PI * (300 + 200 * Math.sin(n / 4000)) * n / RATE);
    }
    o += voice + gap;
    for (let i = 0; i < 3; i++) {
        modulate(out, o, PREAMBLE + 'NNNN', amp, phaseRef);
        o += eomLen;
        marks.lastEomEnd = o;
        if (i < 2) o += gap;
    }
    marks.headerLen = headerLen;
    marks.eomLen = eomLen;
    marks.total = total;
    return { pcm: out, marks };
}

// SeattySameFramer gives the burst text; the inline byte assembler mirrors decoder-bundle.js's
// preamble lock closely enough to count the 0xAB run the ENDEC fingerprinter would see.
function decode(pcm) {
    const bursts = [];
    const preambleRuns = [];
    let run = 0;
    let syncReg = 0;
    let bytePos = 0;
    let currentByte = 0;
    let decoding = false;
    let headerTimes = 0;
    let sawPayload = false;
    const framer = new SeattySameFramer({
        onBurst: (b) => { if (b && b.text) bursts.push(b.text); },
        ignoreEom: true
    });
    const demod = new SeattySameDemod({
        sampleRate: RATE,
        saturateInt16: true,
        sameBandpass: { hz: 1822.9, q: 3 },
        onBit: (bit, soft, sampleIndex) => {
            framer.pushBit(bit, sampleIndex * 1000 / RATE, true);
            currentByte |= (bit << bytePos);
            syncReg = ((syncReg << 1) | bit) & 0xFF;
            if (syncReg === 0xAB && !decoding) { bytePos = 0; headerTimes++; }
            bytePos++;
            if (bytePos === 8) {
                if (currentByte === 0xAB) {
                    if (sawPayload) { preambleRuns.push(run); run = 0; sawPayload = false; }
                    run++;
                    headerTimes++;
                    if (headerTimes > 4) decoding = true;
                } else {
                    if (run > 0) sawPayload = true;
                    headerTimes = 0;
                    decoding = false;
                }
                bytePos = 0;
                currentByte = 0;
            }
        }
    });
    for (let i = 0; i < pcm.length; i += 128) demod.process(pcm.subarray(i, i + 128));
    demod.flush();
    if (run > 0) preambleRuns.push(run);
    return { bursts, preambleRuns };
}

function lastNonZero(pcm, threshold) {
    for (let i = pcm.length - 1; i >= 0; i--) {
        if (Math.abs(pcm[i]) > threshold) return i;
    }
    return -1;
}

let failures = 0;

function report(label, ok, detail) {
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? '  ' + detail : ''}`);
    if (!ok) failures++;
}

const AMP = 0.6;
const built = buildTransmission(AMP);

for (const ms of [40, 110, 180, 260]) {
    const lost = Math.round(RATE * ms / 1000);
    const start = built.marks.headerStart + lost;
    const end = Math.min(built.pcm.length, built.marks.lastEomEnd + Math.round(RATE * 0.3));

    api.setContext(HEADER, 3);
    const patched = api.patchAutoRecordingPcmBoundaries(built.pcm.slice(start, end), RATE);

    const expected = built.marks.lastEomEnd - built.marks.headerStart;
    const lengthErrMs = (patched.length - expected) * 1000 / RATE;
    report(`lost ${ms}ms: length within 6 ms of burst1-start..last-NNNN`,
        Math.abs(lengthErrMs) < 6, `(${lengthErrMs.toFixed(2)} ms, ${patched.length} samples)`);

    const tailIdx = lastNonZero(patched, AMP * 0.16);
    report(`lost ${ms}ms: file ends on the last NNNN bit`,
        tailIdx >= 0 && (patched.length - 1 - tailIdx) < Math.round(RATE * 0.002),
        `(${((patched.length - 1 - tailIdx) * 1000 / RATE).toFixed(2)} ms of tail)`);

    const headPeak = Math.max(...Array.from(patched.slice(0, 2000), Math.abs));
    report(`lost ${ms}ms: rebuilt preamble matches captured level`,
        Math.abs(headPeak - AMP) < 0.05, `(${headPeak.toFixed(3)} vs ${AMP})`);

    const { bursts, preambleRuns } = decode(patched);
    const headers = bursts.filter((b) => b.startsWith('ZCZC'));
    const eoms = bursts.filter((b) => b.startsWith('NNNN'));
    report(`lost ${ms}ms: 3 header bursts decode exactly`,
        headers.length === 3 && headers.every((h) => h.startsWith(HEADER)),
        `(${headers.length} headers)`);
    report(`lost ${ms}ms: 3 EOM bursts decode`, eoms.length === 3, `(${eoms.length})`);

    const untouched = Math.max(preambleRuns[1] ?? 0, preambleRuns[2] ?? 0);
    report(`lost ${ms}ms: burst 1 preamble run matches untouched bursts`,
        Math.abs((preambleRuns[0] ?? 0) - untouched) <= 1, `(runs: ${preambleRuns.join(',')})`);

    let sumSq = 0;
    for (let i = 0; i < lost; i++) {
        const d = patched[i] - built.pcm[built.marks.headerStart + i];
        sumSq += d * d;
    }
    const errDb = 20 * Math.log10(Math.sqrt(sumSq / lost) / (AMP / Math.SQRT2));
    report(`lost ${ms}ms: rebuilt lead-in tracks the real preamble`,
        errDb < -20, `(${errDb.toFixed(1)} dB error vs original)`);
}

{
    const rng = (() => {
        let s = 12345;
        return () => {
            s = (s * 1103515245 + 12345) & 0x7fffffff;
            return s / 0x7fffffff - 0.5;
        };
    })();
    const noisy = built.pcm.slice();
    for (let i = 0; i < noisy.length; i++) noisy[i] += rng() * AMP * 0.06;
    const start = built.marks.headerStart + Math.round(RATE * 0.11);
    const end = Math.min(noisy.length, built.marks.lastEomEnd + Math.round(RATE * 0.3));

    api.setContext(HEADER, 3);
    const patched = api.patchAutoRecordingPcmBoundaries(noisy.slice(start, end), RATE);

    const lengthErrMs = (patched.length - (built.marks.lastEomEnd - built.marks.headerStart)) * 1000 / RATE;
    report('noisy input: length within 6 ms of burst1-start..last-NNNN',
        Math.abs(lengthErrMs) < 6, `(${lengthErrMs.toFixed(2)} ms)`);

    const { bursts } = decode(patched);
    const headers = bursts.filter((b) => b.startsWith('ZCZC')).length;
    const eoms = bursts.filter((b) => b.startsWith('NNNN')).length;
    report('noisy input: 3 headers + 3 EOMs decode', headers === 3 && eoms === 3,
        `(${headers} headers, ${eoms} EOMs)`);
}

{
    // Stop 6 s after EOM 1 with EOM 2 and 3 never received: the tail is synthesized back to three.
    const start = built.marks.headerStart + Math.round(RATE * 0.11);
    const end = built.marks.lastEomEnd - 2 * RATE - 2 * built.marks.eomLen + Math.round(RATE * 0.3);

    api.setContext(HEADER, 1);
    const patched = api.patchAutoRecordingPcmBoundaries(built.pcm.slice(start, end), RATE);

    const eoms = decode(patched).bursts.filter((b) => b.startsWith('NNNN')).length;
    report('EOM 2/3 missed: synthesized tail still yields 3 EOM bursts', eoms === 3, `(${eoms})`);

    const tailIdx = lastNonZero(patched, AMP * 0.16);
    report('EOM 2/3 missed: file still ends on the last NNNN bit',
        tailIdx >= 0 && (patched.length - 1 - tailIdx) < Math.round(RATE * 0.002),
        `(${((patched.length - 1 - tailIdx) * 1000 / RATE).toFixed(2)} ms of tail)`);
}

console.log(failures ? `\n${failures} failing check(s)` : '\nall checks passed');
process.exit(failures ? 1 : 0);
