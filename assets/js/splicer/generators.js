import { ENDEC_MODE_OPTIONS, getEndecModeProfile, resamplePcm, emulateSampleRate } from '../common-functions.js';

export const GEN_RATE = 44100;
export const LEGACY_DIGITAL_MODE = 'DIGITAL_LEGACY';

const AFSK_TIME = 0.00192;
const SPACE_FREQ = 1562.5;
const MARK_FREQ = 2083.3333333;
const TWO_PI = 2 * Math.PI;
const SAMPLES_PER_BIT = GEN_RATE * AFSK_TIME;
const MARK_INC = TWO_PI * MARK_FREQ / GEN_RATE;
const SPACE_INC = TWO_PI * SPACE_FREQ / GEN_RATE;
const SAME_PREAMBLE = '\xAB'.repeat(16);
const DIGITAL_TAIL = '\xFF\xFF\xFF';
const HEADER_RE = /^ZCZC-([A-Z]{3})-([A-Z]{3})-((?:\d{6}(?:-?)){1,31})\+(\d{4})-(\d{7})-([A-Za-z0-9\/ ]{0,8})-?$/;

export const MODE_OPTIONS = [...ENDEC_MODE_OPTIONS, { value: LEGACY_DIGITAL_MODE, label: 'SAGE 3644/DIGITAL (Legacy)' }];

export const ATTENTION_KINDS = [
    { value: 'wat', label: 'EAS two-tone (853 + 960 Hz)' },
    { value: 'nwr', label: 'NOAA Weather Radio (1050 Hz)' },
    { value: 'nwr-wat', label: '1050 Hz, then two-tone' },
    { value: 'wat-nwr', label: 'Two-tone, then 1050 Hz' },
    { value: 'buzzer', label: 'Buzzer' },
    { value: 'pelmorex', label: 'Pelmorex (Canada)' },
];

export const GEN_LABELS = {
    'same-header': 'SAME header',
    attention: 'Attention tone',
    eom: 'EOM',
    tts: 'Speech',
    'noise-bed': 'Noise bed',
};

export const validHeader = (h) => HEADER_RE.test(String(h || '').trim());

export function defaultHeader(date = new Date()) {
    const pad = (n, w) => String(n).padStart(w, '0');
    const day = Math.floor((date.getTime() - Date.UTC(date.getUTCFullYear(), 0, 0)) / 86400000);
    return `ZCZC-WXR-RWT-000000+0015-${pad(day, 3)}${pad(date.getUTCHours(), 2)}${pad(date.getUTCMinutes(), 2)}-EASTOOLS-`;
}

const isLegacy = (mode) => mode === LEGACY_DIGITAL_MODE;
const profileOf = (mode) => getEndecModeProfile(isLegacy(mode) ? 'DEFAULT' : mode);
const msToSamples = (ms) => Math.round(GEN_RATE * (ms / 1000));

export function partGapsMs(mode) {
    const p = profileOf(mode);
    return {
        preTone: p.preToneGapMs,
        headersToAttention: Number.isFinite(p.afterGapMs) ? p.afterGapMs : 1000,
        attentionToMessage: p.preMessageGapMs,
        messageToEom: p.eomLeadGapMs,
        eomToEnd: p.eomTailGapMs,
    };
}

function clipTo(s, clip) {
    if (!clip) return s;
    if (s > 0.79) return 0.79;
    if (s < -0.79) return -0.79;
    return s;
}

function clampAsset(s, clip) {
    const lim = clip ? 0.79 : 0.99;
    if (s > lim) return lim;
    if (s < -lim) return -lim;
    return s;
}

function afskInto(out, bits, clip) {
    let phase = 0;
    let clock = 0;
    for (let k = 0; k < bits.length; k++) {
        const inc = bits[k] ? MARK_INC : SPACE_INC;
        const bitEnd = (k + 1) * SAMPLES_PER_BIT;
        while (clock < bitEnd) {
            out.push(clipTo(Math.sin(phase), clip));
            phase += inc;
            if (phase >= TWO_PI) phase -= TWO_PI;
            clock++;
        }
    }
}

function toneInto(out, freq, length, clip) {
    for (let i = 0; i < length; i++) out.push(clipTo(Math.sin((i / GEN_RATE) * 2 * Math.PI * freq), clip));
}

function dualToneInto(out, f1, f2, length, clip) {
    for (let i = 0; i < length; i++) {
        out.push(clipTo(0.5 * (Math.sin((i * 2 * Math.PI * f1) / GEN_RATE) + Math.sin((i * 2 * Math.PI * f2) / GEN_RATE)), clip));
    }
}

function silenceInto(out, length) {
    for (let i = 0; i < length; i++) out.push(0);
}

function bitsLSB(str) {
    const bits = [];
    for (let i = 0; i < str.length; i++) {
        const c = str.charCodeAt(i) & 0xFF;
        for (let b = 0; b < 8; b++) bits.push((c >> b) & 1);
    }
    return bits;
}

function burstStrings(core, bursts) {
    return bursts.map((b) => b.prefix + core + b.suffix);
}

function headerStrings(header, mode) {
    const msg = header.startsWith(SAME_PREAMBLE) ? header.slice(16) : header;
    const data = SAME_PREAMBLE + msg;
    if (isLegacy(mode)) {
        const std = '\xAB' + data + DIGITAL_TAIL;
        return ['\x00' + data + DIGITAL_TAIL, std, std];
    }
    return burstStrings(data, getEndecModeProfile(mode).headerBursts);
}

function eomStrings(mode) {
    const core = SAME_PREAMBLE + 'NNNN';
    if (isLegacy(mode)) {
        const rest = core + DIGITAL_TAIL;
        return ['\x00' + core + DIGITAL_TAIL, rest, rest];
    }
    return burstStrings(core, getEndecModeProfile(mode).eomBursts);
}

const assetCache = new Map();

export function loadAsset(url) {
    if (assetCache.has(url)) return assetCache.get(url);
    const job = (async () => {
        try {
            const resp = await fetch(url);
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
            const data = await resp.arrayBuffer();
            const ctx = new (window.AudioContext || window.webkitAudioContext)();
            const buf = await ctx.decodeAudioData(data.slice(0));
            if (typeof ctx.close === 'function') ctx.close().catch(() => { });
            const channels = Math.max(1, buf.numberOfChannels);
            const merged = new Float32Array(buf.length);
            const inv = 1 / channels;
            for (let ch = 0; ch < channels; ch++) {
                const d = buf.getChannelData(ch);
                for (let i = 0; i < buf.length; i++) merged[i] += d[i] * inv;
            }
            return buf.sampleRate === GEN_RATE ? merged : resamplePcm(merged, buf.sampleRate, GEN_RATE);
        } catch (e) {
            assetCache.delete(url);
            throw new Error(`could not load ${url}: ${e.message || e}`);
        }
    })();
    assetCache.set(url, job);
    return job;
}

async function emitBursts(out, strings, between, mode, clip) {
    const pop = mode === 'TRILITHIC_POP' ? getEndecModeProfile(mode).relayPop : null;
    const usePop = pop && pop.enabled !== false && pop.fileStart && pop.fileEnd;
    const popStart = usePop ? await loadAsset(pop.fileStart) : null;
    const popEnd = usePop ? await loadAsset(pop.fileEnd) : null;
    const cache = new Map();
    strings.forEach((s, i) => {
        let bits = cache.get(s);
        if (!bits) {
            bits = bitsLSB(s);
            cache.set(s, bits);
        }
        if (popStart) for (const v of popStart) out.push(clampAsset(v, clip));
        afskInto(out, bits, clip);
        if (popEnd) for (const v of popEnd) out.push(clampAsset(v, clip));
        if (i < strings.length - 1) silenceInto(out, between);
    });
}

const betweenSamples = (mode) => msToSamples(isLegacy(mode) ? 1000 : getEndecModeProfile(mode).betweenGapMs);

export async function renderHeader({ header, mode = 'DEFAULT', clip = false }) {
    const h = String(header || '').trim();
    if (!validHeader(h)) throw new Error('the SAME header is not valid (expected ZCZC-ORG-EEE-PSSCCC+TTTT-JJJHHMM-LLLLLLLL-)');
    const out = [];
    await emitBursts(out, headerStrings(h, mode), betweenSamples(mode), mode, clip);
    return Float32Array.from(out);
}

export async function renderEom({ mode = 'DEFAULT', clip = false }) {
    const out = [];
    await emitBursts(out, eomStrings(mode), betweenSamples(mode), mode, clip);
    return Float32Array.from(out);
}

export async function renderAttention({ tone = 'wat', seconds = 8, mode = 'DEFAULT', clip = false }) {
    const out = [];
    const length = GEN_RATE * Math.max(0, Number(seconds) || 0);
    const gap = msToSamples(partGapsMs(mode).headersToAttention);
    switch (tone) {
    case 'nwr':
        toneInto(out, 1050, length, clip);
        break;
    case 'nwr-wat':
        toneInto(out, 1050, length, clip);
        silenceInto(out, gap);
        dualToneInto(out, 853, 960, length, clip);
        break;
    case 'wat-nwr':
        dualToneInto(out, 853, 960, length, clip);
        silenceInto(out, gap);
        toneInto(out, 1050, length, clip);
        break;
    case 'buzzer':
    case 'pelmorex':
        for (const v of await loadAsset(tone === 'buzzer' ? 'assets/buzzer.wav' : 'assets/pelmorex.wav')) out.push(clampAsset(v, false));
        break;
    default:
        dualToneInto(out, 853, 960, length, clip);
    }
    return Float32Array.from(out);
}

export function renderNoiseBed({ seconds = 10, levelDb = -40, seed = 1 }) {
    const n = Math.max(1, Math.round(GEN_RATE * Math.max(0, Number(seconds) || 0)));
    const out = new Float32Array(n);
    const amp = Math.pow(10, (Number(levelDb) || -40) / 20) * Math.sqrt(3);
    let a = (seed >>> 0) || 1;
    for (let i = 0; i < n; i++) {
        a = (a + 0x6D2B79F5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        out[i] = amp * ((((t ^ (t >>> 14)) >>> 0) / 4294967296) * 2 - 1);
    }
    return out;
}

export function emulateEndecRate(pcm, mode) {
    const rate = profileOf(mode).sampleRate;
    return rate && rate < GEN_RATE ? emulateSampleRate(pcm, GEN_RATE, rate) : pcm;
}

export async function renderGenerator(gen) {
    let pcm;
    switch (gen.kind) {
    case 'same-header': pcm = await renderHeader(gen); break;
    case 'eom': pcm = await renderEom(gen); break;
    case 'attention': pcm = await renderAttention(gen); break;
    case 'noise-bed': return renderNoiseBed(gen);
    default: throw new Error(`no generator for ${gen.kind}`);
    }
    return gen.emulate ? emulateEndecRate(pcm, gen.mode) : pcm;
}

export function describeGenerator(gen) {
    if (!gen) return '';
    const mode = MODE_OPTIONS.find((m) => m.value === gen.mode);
    switch (gen.kind) {
    case 'same-header': return `SAME header ${gen.header || ''}${mode ? ` (${mode.label})` : ''}`;
    case 'eom': return `EOM${mode ? ` (${mode.label})` : ''}`;
    case 'attention': {
        const k = ATTENTION_KINDS.find((x) => x.value === gen.tone);
        const timed = gen.tone !== 'buzzer' && gen.tone !== 'pelmorex';
        return `${k ? k.label : 'Attention tone'}${timed ? `, ${gen.seconds} s` : ''}`;
    }
    case 'noise-bed': return `Noise bed, ${gen.seconds} s at ${gen.levelDb} dB`;
    case 'tts': return `Speech: “${String(gen.text || '').slice(0, 60)}”`;
    default: return GEN_LABELS[gen.kind] || 'Generated';
    }
}
