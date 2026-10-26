export const MIX_MIN = 0;
export const MIX_MAX = 100;
export const GAIN_MIN_DB = -24;
export const GAIN_MAX_DB = 12;

export function clampNumber(value, min, max, fallback) {
    if (value === null || value === undefined || value === '') return fallback;
    const n = Number(value);
    return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
}

export const itemMix = (it) => clampNumber(it && it.mix, MIX_MIN, MIX_MAX, MIX_MAX);
export const itemGainDb = (it) => clampNumber(it && it.gainDb, GAIN_MIN_DB, GAIN_MAX_DB, 0);
export const itemHasLevel = (it) => itemMix(it) !== MIX_MAX || itemGainDb(it) !== 0;

export function cleanItem(it) {
    const out = {
        id: it.id,
        label: (typeof it.label === 'string' && it.label) ? it.label : it.id,
        steps: Number.isFinite(it.steps) && it.steps > 0 ? it.steps : 1,
        params: typeof it.params === 'string' ? it.params : '',
        mix: itemMix(it),
        gainDb: itemGainDb(it),
    };
    if (it.bypass) out.bypass = true;
    return out;
}

export function createRenderCache(maxBytes) {
    const map = new Map();
    let bytes = 0;
    const drop = (key) => {
        const e = map.get(key);
        if (!e) return;
        bytes -= e.pcm.byteLength;
        map.delete(key);
    };
    return {
        get(key) {
            const e = map.get(key);
            if (!e) return null;
            map.delete(key);
            map.set(key, e);
            return e;
        },
        has: (key) => map.has(key),
        set(key, pcm, meta = {}) {
            drop(key);
            map.set(key, { pcm, ...meta });
            bytes += pcm.byteLength;
            for (const k of map.keys()) {
                if (bytes <= maxBytes || k === key) break;
                drop(k);
            }
        },
        delete: drop,
        clear() { map.clear(); bytes = 0; },
        get bytes() { return bytes; },
    };
}

export function chainSig(items) {
    return (items || []).map((it) => (it.bypass ? '~' : '') + it.id
        + (it.params ? '{' + it.params + '}' : '')
        + (itemHasLevel(it) ? '@' + itemMix(it) + '/' + itemGainDb(it) : '')).join('>');
}

export function applyLevel(dry, drySr, wet, wetSr, item, resample) {
    if (!itemHasLevel(item) || !wet || !wet.length) return wet;
    const mix = itemMix(item) / 100;
    const gain = Math.pow(10, itemGainDb(item) / 20);
    const dryAligned = mix < 1 && dry && dry.length
        ? (drySr === wetSr ? dry : resample(dry, drySr, wetSr))
        : null;
    const dryMix = 1 - mix;
    const dryLen = dryAligned ? dryAligned.length : 0;
    const out = new Float32Array(wet.length);
    for (let i = 0; i < wet.length; i++) {
        let s = wet[i] * mix;
        if (i < dryLen) s += dryAligned[i] * dryMix;
        out[i] = s * gain;
    }
    return out;
}

export async function renderChain(pcm, sampleRate, items, { runItem, resample, onProgress, isCancelled, cancelError }) {
    const active = (items || []).filter((it) => it && !it.bypass);
    if (!active.length) return { pcm, sampleRate };
    let cur = pcm;
    let sr = sampleRate;
    const total = active.length;
    for (let i = 0; i < total; i++) {
        if (isCancelled && isCancelled()) throw cancelError();
        const item = active[i];
        const base = i / total;
        const span = 1 / total;
        const stageLabel = 'Chain ' + (i + 1) + '/' + total + ': ' + item.label;
        const dry = cur;
        const drySr = sr;
        if (onProgress) onProgress({ step: i + 1, total, cmd: stageLabel, fraction: base });
        const stageProgress = (p) => {
            if (onProgress) onProgress({
                step: i + 1,
                total,
                cmd: stageLabel + ' - ' + p.cmd,
                fraction: base + Math.max(0, Math.min(1, p.fraction)) * span,
            });
        };
        const out = await runItem(item, cur, sr, stageProgress);
        cur = applyLevel(dry, drySr, out.pcm, out.sampleRate, item, resample);
        sr = out.sampleRate;
        if (onProgress) onProgress({ step: i + 1, total, cmd: stageLabel, fraction: (i + 1) / total });
    }
    if (isCancelled && isCancelled()) throw cancelError();
    return { pcm: cur, sampleRate: sr };
}
