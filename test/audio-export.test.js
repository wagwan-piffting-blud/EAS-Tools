import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mock = vi.hoisted(() => ({ encodable: () => true, written: [] }));

vi.mock('../assets/js/mediabunny/mediabunny.min.js', () => {
    class AudioSample {
        constructor(options) { Object.assign(this, options); }
        close() {}
    }
    class AudioSampleSource {
        constructor(options) { this.options = options; }
        async add(sample) { mock.written.push(sample); }
        close() {}
    }
    class BufferTarget { constructor() { this.buffer = new Uint8Array([9]); } }
    class Output {
        constructor(options) { Object.assign(this, options); }
        addAudioTrack() {}
        async start() {}
        async finalize() {}
        async cancel() {}
    }
    return {
        canEncodeAudio: async (codec, cfg) => mock.encodable(codec, cfg),
        AudioSample, AudioSampleSource, BufferTarget, Output, StreamTarget: class {},
        Mp3OutputFormat: class {}, FlacOutputFormat: class {}, OggOutputFormat: class {}, Mp4OutputFormat: class {},
    };
});
vi.mock('../assets/js/mediabunny/mp3-encoder.min.js', () => ({ registerMp3Encoder: () => {} }));
vi.mock('../assets/js/mediabunny/flac-encoder.min.js', () => ({ registerFlacEncoder: () => {} }));

import {
    DEFAULT_EXPORT_PREFS, ORIGINAL_RATE, SAMPLE_RATES, availableFormats, bindExportControls, candidateRates, describeExport,
    exportBitrate, exportChoices, exportFileName, loadExportPrefs, normalizeExportPrefs, rateLabel, renderExport, saveExportPrefs,
} from '../assets/js/audio/export.js';

function memoryStorage() {
    const data = new Map();
    return { getItem: (k) => (data.has(k) ? data.get(k) : null), setItem: (k, v) => data.set(k, v), data };
}

class FakeSelect {
    constructor() {
        this.options = [];
        this.value = '';
        this.hidden = false;
        this.listeners = {};
    }
    replaceChildren(...options) { this.options = options; }
    addEventListener(type, fn) { this.listeners[type] = fn; }
    fire(value) {
        this.value = value;
        this.listeners.change();
    }
}

const makeOption = (label, value) => ({ label, value, disabled: false, hidden: false });

describe('export preferences', () => {
    it('normalizes formats, channels, rates and bitrates, keeping extra keys', () => {
        expect(normalizeExportPrefs(null)).toEqual({ ...DEFAULT_EXPORT_PREFS, bitrates: {} });
        const prefs = normalizeExportPrefs({ format: 'mp3', channels: '2', sampleRate: '22050', bitrates: { mp3: 128, opus: 7, aac: 'x' }, limit: false });
        expect(prefs).toEqual({ format: 'mp3', channels: 2, sampleRate: 22050, bitrates: { mp3: 128 }, limit: false });
        expect(normalizeExportPrefs({ format: 'bogus', sampleRate: 12345, bitrates: [] })).toMatchObject({ format: 'pcm16', sampleRate: ORIGINAL_RATE, bitrates: {} });
        expect(normalizeExportPrefs([], { format: 'flac16', channels: 2 })).toMatchObject({ format: 'flac16', channels: 2 });
        expect(exportBitrate({ format: 'mp3', bitrates: { mp3: 320 } })).toBe(320);
        expect(exportBitrate({ format: 'mp3' })).toBe(192);
        expect(exportBitrate({ format: 'pcm16' })).toBe(0);
    });

    it('loads and saves through storage, surviving broken storage', () => {
        const storage = memoryStorage();
        expect(saveExportPrefs('k', { format: 'opus' }, storage)).toBe(true);
        expect(loadExportPrefs('k', DEFAULT_EXPORT_PREFS, storage).format).toBe('opus');
        storage.setItem('bad', '{');
        expect(loadExportPrefs('bad', { format: 'pcm24' }, storage).format).toBe('pcm24');
        const broken = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('full'); } };
        expect(loadExportPrefs('k', DEFAULT_EXPORT_PREFS, broken).format).toBe('pcm16');
        expect(saveExportPrefs('k', {}, broken)).toBe(false);
    });

    it('names files and rates', () => {
        expect(exportFileName('eas', 'aac')).toBe('eas.m4a');
        expect(exportFileName('eas', 'opus')).toBe('eas.opus');
        expect(rateLabel(44100)).toBe('44.1 kHz');
        expect(rateLabel(11025)).toBe('11.025 kHz');
        expect(candidateRates(5000)).toEqual([5000, 8000, 11025, 16000, 22050, 32000, 44100, 48000]);
        expect(candidateRates(44100)).toEqual([44100, 48000, 32000, 22050, 16000, 11025, 8000]);
    });
});

describe('format discovery', () => {
    afterEach(() => vi.unstubAllGlobals());

    it('lists only the formats this browser can encode, for the page and the apps', async () => {
        vi.stubGlobal('AudioEncoder', undefined);
        vi.stubGlobal('Worker', class {});
        const formats = await availableFormats();
        const values = formats.map((f) => f.value);
        expect(values).toEqual(['pcm16', 'pcm24', 'float32', 'flac16', 'flac24', 'mp3']);
        expect(formats.find((f) => f.value === 'mp3')).toMatchObject({ lossy: true, ext: 'mp3', bitrate: 192 });
        const choices = await exportChoices({ originalLabel: 'Keep' });
        expect(choices.sampleRates[0]).toEqual({ value: ORIGINAL_RATE, label: 'Keep' });
        expect(choices.sampleRates).toHaveLength(SAMPLE_RATES.length + 1);
        expect(choices.channels.map((c) => c.value)).toEqual([1, 2]);
    });
});

describe('rendering an export', () => {
    beforeEach(() => {
        mock.encodable = () => true;
        mock.written = [];
    });

    it('writes WAV at the requested rate and channel layout', async () => {
        const resample = vi.fn((pcm, from, to) => new Float32Array(Math.round(pcm.length * to / from)));
        const mono = new Float32Array(4410).fill(0.5);
        const result = await renderExport([mono], 44100, { format: 'pcm16', channels: 2, sampleRate: 22050 }, { resample, gain: 0.5 });
        expect(resample).toHaveBeenCalledTimes(1);
        expect(result).toMatchObject({ format: 'pcm16', ext: 'wav', sampleRate: 22050, requestedRate: 22050, channels: 2 });
        expect(result.blob.size).toBe(44 + 2205 * 4);
        expect(describeExport(result)).toBe('WAV 16-bit, stereo, 22.05 kHz.');

        const target = await renderExport([mono], 44100, { format: 'pcm16', sampleRate: 0 }, { resample, targetRate: 5000 });
        expect(target.sampleRate).toBe(5000);

        const mixed = await renderExport([new Float32Array([1, 1]), new Float32Array([0, 0])], 8000, { format: 'float32' });
        expect(mixed.channels).toBe(1);
        expect(new Float32Array(await mixed.blob.slice(58).arrayBuffer())[0]).toBe(0.5);

        const kept = await renderExport([new Float32Array([1]), new Float32Array([0]), new Float32Array([0])], 8000, { format: 'pcm16', channels: 2 });
        expect(kept.channels).toBe(2);
        const empty = await renderExport([], 8000, { format: 'pcm16' });
        expect(empty.blob.size).toBe(44);
        await expect(renderExport([mono], 44100, { format: 'pcm16', sampleRate: 8000 })).rejects.toThrow('Cannot convert');
    });

    it('moves lossy formats to the nearest rate the codec accepts', async () => {
        mock.encodable = (codec, cfg) => cfg.sampleRate >= 8000;
        const resample = vi.fn((pcm) => new Float32Array(pcm.length));
        const result = await renderExport([new Float32Array(10)], 44100, { format: 'mp3', bitrates: { mp3: 128 } }, { resample, targetRate: 5000 });
        expect(result).toMatchObject({ format: 'mp3', sampleRate: 8000, requestedRate: 5000, mime: 'audio/mpeg' });
        expect(describeExport(result)).toContain('could not be saved at 5 kHz here, so it was saved at 8 kHz');

        mock.encodable = () => false;
        await expect(renderExport([new Float32Array(1)], 48000, { format: 'opus' })).rejects.toThrow('cannot save Opus');
    });
});

describe('export controls', () => {
    it('fills the pickers, hides formats this browser lacks, and tracks every change', async () => {
        const controls = { format: new FakeSelect(), bitrate: new FakeSelect(), bitrateRow: { hidden: false }, channels: new FakeSelect(), sampleRate: new FakeSelect() };
        const prefs = normalizeExportPrefs({ format: 'opus', channels: 2, sampleRate: 16000 });
        const onChange = vi.fn();
        const canEncode = (f) => (f === 'aac' ? Promise.reject(new Error('x')) : f !== 'opus');
        const { ready } = bindExportControls(controls, prefs, { onChange, makeOption, canEncode, originalLabel: 'Same' });
        expect(controls.format.options.map((o) => o.value)).toContain('aac');
        expect(controls.channels.value).toBe('2');
        expect(controls.sampleRate.options[0]).toMatchObject({ label: 'Same', value: '0' });
        expect(controls.sampleRate.value).toBe('16000');
        expect(controls.bitrateRow.hidden).toBe(false);
        expect(controls.bitrate.value).toBe('128');
        await ready;
        expect(controls.format.options.find((o) => o.value === 'opus').hidden).toBe(true);
        expect(controls.format.options.find((o) => o.value === 'aac').disabled).toBe(true);
        expect(prefs.format).toBe('pcm16');
        expect(controls.bitrateRow.hidden).toBe(true);
        expect(onChange).toHaveBeenCalledTimes(1);

        controls.format.fire('mp3');
        expect(prefs.format).toBe('mp3');
        controls.bitrate.fire('256');
        expect(prefs.bitrates.mp3).toBe(256);
        controls.channels.fire('1');
        expect(prefs.channels).toBe(1);
        controls.sampleRate.fire('8000');
        expect(prefs.sampleRate).toBe(8000);
        controls.sampleRate.fire('12');
        expect(prefs.sampleRate).toBe(ORIGINAL_RATE);
        expect(onChange).toHaveBeenCalledTimes(6);
    });

    it('works with only a format picker', async () => {
        const controls = { format: new FakeSelect() };
        const prefs = normalizeExportPrefs({ format: 'flac16' });
        const { ready } = bindExportControls(controls, prefs, { makeOption, canEncode: () => true });
        await ready;
        controls.format.fire('pcm24');
        expect(prefs.format).toBe('pcm24');
    });
});
