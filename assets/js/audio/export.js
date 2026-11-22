import * as SE from './encode.js';
import { pickChannels } from './decode.js';

export const ORIGINAL_RATE = 0;
export const SAMPLE_RATES = [48000, 44100, 32000, 22050, 16000, 11025, 8000];

export const DEFAULT_EXPORT_PREFS = Object.freeze({ format: 'pcm16', channels: 1, sampleRate: ORIGINAL_RATE, bitrates: {} });

export function rateLabel(rate) {
    return `${Number((rate / 1000).toFixed(3))} kHz`;
}

export function normalizeExportPrefs(raw, defaults = DEFAULT_EXPORT_PREFS) {
    const base = { ...DEFAULT_EXPORT_PREFS, ...defaults };
    const value = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
    const bitrates = value.bitrates && typeof value.bitrates === 'object' && !Array.isArray(value.bitrates) ? value.bitrates : {};
    const rate = Number(value.sampleRate ?? base.sampleRate);
    return {
        ...value,
        format: SE.formatOf(value.format ?? base.format),
        channels: Number(value.channels ?? base.channels) === 2 ? 2 : 1,
        sampleRate: SAMPLE_RATES.includes(rate) ? rate : ORIGINAL_RATE,
        bitrates: Object.fromEntries(Object.entries(bitrates).filter(([format, kbps]) => SE.bitrateOf(format, kbps) === Number(kbps))),
    };
}

export function loadExportPrefs(key, defaults = DEFAULT_EXPORT_PREFS, storage = globalThis.localStorage) {
    let raw = null;
    try {
        raw = JSON.parse(storage.getItem(key) || 'null');
    } catch (_) {
        raw = null;
    }
    return normalizeExportPrefs(raw, defaults);
}

export function saveExportPrefs(key, prefs, storage = globalThis.localStorage) {
    try {
        storage.setItem(key, JSON.stringify(prefs));
        return true;
    } catch (_) {
        return false;
    }
}

export function exportBitrate(prefs) {
    const format = SE.formatOf(prefs.format);
    return SE.bitrateOf(format, prefs.bitrates && prefs.bitrates[format]);
}

export function exportFileName(base, format) {
    return `${base}.${SE.infoOf(format).ext}`;
}

export async function availableFormats() {
    const entries = Object.entries(SE.FORMATS);
    const supported = await Promise.all(entries.map(([key]) => SE.canEncode(key).catch(() => false)));
    return entries
        .filter((_, i) => supported[i])
        .map(([value, info]) => ({
            value,
            label: info.label,
            name: info.name,
            ext: info.ext,
            mime: info.mime,
            lossy: !!info.bitrates,
            bitrates: info.bitrates ? [...info.bitrates] : [],
            bitrate: info.bitrate || 0,
        }));
}

export async function exportChoices({ originalLabel = 'Original' } = {}) {
    return {
        formats: await availableFormats(),
        channels: [{ value: 1, label: 'Mono' }, { value: 2, label: 'Stereo' }],
        sampleRates: [{ value: ORIGINAL_RATE, label: originalLabel }, ...SAMPLE_RATES.map((value) => ({ value, label: rateLabel(value) }))],
    };
}

function layoutChannels(chans, count) {
    const list = chans.length ? chans : [new Float32Array(0)];
    if (count === 2) {
        return list.length >= 2 ? list.slice(0, 2) : [list[0], list[0]];
    }
    return list.length > 1 ? pickChannels(list, 'mix') : [list[0]];
}

function resampleChannels(chans, from, to, resample) {
    if (from === to) {
        return chans;
    }
    if (typeof resample !== 'function') {
        throw new Error(`Cannot convert ${rateLabel(from)} audio to ${rateLabel(to)} here.`);
    }
    const done = new Map();
    return chans.map((channel) => {
        if (!done.has(channel)) {
            done.set(channel, resample(channel, from, to));
        }
        return done.get(channel);
    });
}

export function candidateRates(wanted) {
    const higher = SAMPLE_RATES.filter((rate) => rate > wanted).sort((a, b) => a - b);
    const lower = SAMPLE_RATES.filter((rate) => rate < wanted).sort((a, b) => b - a);
    return [wanted, ...higher, ...lower];
}

async function pickRate(format, wanted, channels, bitrate) {
    if (SE.isWav(format)) {
        return wanted;
    }
    for (const rate of candidateRates(wanted)) {
        if (await SE.canEncodeConfig(format, { sampleRate: rate, channels, bitrate }).catch(() => false)) {
            return rate;
        }
    }
    throw new Error(`This browser cannot save ${SE.infoOf(format).name} audio.`);
}

export async function renderExport(chans, sampleRate, prefs, { resample = null, gain = 1, targetRate = 0 } = {}) {
    const settings = normalizeExportPrefs(prefs);
    const format = settings.format;
    const info = SE.infoOf(format);
    const laid = layoutChannels(chans, settings.channels);
    const wanted = targetRate || settings.sampleRate || sampleRate;
    const bitrate = exportBitrate(settings);
    const rate = await pickRate(format, wanted, laid.length, bitrate);
    const data = resampleChannels(laid, sampleRate, rate, resample);
    const blob = await SE.encodeAll(data, rate, format, { gain, bitrate });
    return { blob, format, ext: info.ext, mime: info.mime, sampleRate: rate, requestedRate: wanted, channels: data.length };
}

export function describeExport(result) {
    const info = SE.infoOf(result.format);
    const parts = [info.label, result.channels === 2 ? 'stereo' : 'mono', rateLabel(result.sampleRate)];
    const note = result.sampleRate !== result.requestedRate
        ? ` ${info.name} could not be saved at ${rateLabel(result.requestedRate)} here, so it was saved at ${rateLabel(result.sampleRate)}.`
        : '';
    return `${parts.join(', ')}.${note}`;
}

const defaultOption = (label, value) => new Option(label, value);

export function bindExportControls(controls, prefs, { onChange = () => {}, originalLabel = 'Original', makeOption = defaultOption, canEncode = SE.canEncode } = {}) {
    const { format, bitrate, bitrateRow, channels, sampleRate } = controls;
    const fallback = DEFAULT_EXPORT_PREFS.format;
    const changed = () => onChange(prefs);
    const syncRates = () => {
        if (!bitrate) {
            return;
        }
        const info = SE.infoOf(prefs.format);
        if (bitrateRow) {
            bitrateRow.hidden = !info.bitrates;
        }
        bitrate.replaceChildren(...(info.bitrates || []).map((kbps) => makeOption(`${kbps} kbps${kbps === info.bitrate ? ' (default)' : ''}`, String(kbps))));
        if (info.bitrates) {
            bitrate.value = String(exportBitrate(prefs));
        }
    };
    format.replaceChildren(...Object.entries(SE.FORMATS).map(([key, info]) => makeOption(info.label, key)));
    format.value = SE.formatOf(prefs.format);
    if (channels) {
        channels.value = String(prefs.channels === 2 ? 2 : 1);
    }
    if (sampleRate) {
        sampleRate.replaceChildren(
            makeOption(originalLabel, String(ORIGINAL_RATE)),
            ...SAMPLE_RATES.map((rate) => makeOption(rateLabel(rate), String(rate))),
        );
        sampleRate.value = String(prefs.sampleRate || ORIGINAL_RATE);
    }
    syncRates();
    const ready = Promise.all([...format.options].map((option) => Promise.resolve(canEncode(option.value)).catch(() => false).then((ok) => {
        if (ok) {
            return;
        }
        option.disabled = true;
        option.hidden = true;
        if (format.value === option.value) {
            format.value = fallback;
            prefs.format = fallback;
            syncRates();
            changed();
        }
    })));
    format.addEventListener('change', () => {
        prefs.format = SE.formatOf(format.value);
        syncRates();
        changed();
    });
    if (bitrate) {
        bitrate.addEventListener('change', () => {
            prefs.bitrates = { ...prefs.bitrates, [SE.formatOf(prefs.format)]: Number(bitrate.value) };
            changed();
        });
    }
    if (channels) {
        channels.addEventListener('change', () => {
            prefs.channels = channels.value === '2' ? 2 : 1;
            changed();
        });
    }
    if (sampleRate) {
        sampleRate.addEventListener('change', () => {
            const rate = Number(sampleRate.value);
            prefs.sampleRate = SAMPLE_RATES.includes(rate) ? rate : ORIGINAL_RATE;
            changed();
        });
    }
    return { ready, sync: syncRates };
}
