import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mock = vi.hoisted(() => ({
    canEncode: true,
    samples: [],
    added: [],
    cancelled: 0,
    finalized: 0,
    extensionRegistrations: 0,
}));

vi.mock('../assets/js/mediabunny/mediabunny.min.js', () => {
    class AudioSample {
        constructor(options) { Object.assign(this, options); mock.samples.push(this); }
        close() { this.closed = true; }
    }
    class AudioSampleSource {
        constructor(options) { this.options = options; }
        async add(sample) { mock.added.push(sample); }
        close() { this.closed = true; }
    }
    class BufferTarget { constructor() { this.buffer = new Uint8Array([1, 2, 3]); } }
    class StreamTarget { constructor(sink, options) { this.sink = sink; this.options = options; } }
    class Output {
        constructor(options) { Object.assign(this, options); }
        addAudioTrack(source) { this.source = source; }
        async start() { this.started = true; }
        async finalize() { mock.finalized++; }
        async cancel() { mock.cancelled++; }
    }
    return {
        canEncodeAudio: async (_codec, cfg) => typeof mock.canEncode === 'function' ? mock.canEncode(cfg) : mock.canEncode,
        AudioSample, AudioSampleSource, BufferTarget, StreamTarget, Output,
        Mp3OutputFormat: class {}, FlacOutputFormat: class {}, OggOutputFormat: class {},
    };
});
vi.mock('../assets/js/mediabunny/mp3-encoder.min.js', () => ({
    registerMp3Encoder: () => { mock.extensionRegistrations++; mock.canEncode = true; },
}));
vi.mock('../assets/js/mediabunny/flac-encoder.min.js', () => ({
    registerFlacEncoder: () => { mock.extensionRegistrations++; mock.canEncode = true; },
}));

import {
    bitrateOf, canEncode, createWriter, encodeAll, formatOf, infoOf, isLossy, isWav, wavFormatOf,
} from '../assets/js/splicer/encode.js';

describe('splicer format encoding', () => {
    beforeEach(() => {
        mock.canEncode = true;
        mock.samples.length = 0;
        mock.added.length = 0;
        mock.cancelled = 0;
        mock.finalized = 0;
        mock.extensionRegistrations = 0;
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('normalizes formats, output types, and bitrates', () => {
        expect(formatOf('mp3')).toBe('mp3');
        expect(formatOf('missing')).toBe('pcm16');
        expect(infoOf('missing').ext).toBe('wav');
        expect(isWav('pcm24')).toBe(true);
        expect(isWav('opus')).toBe(false);
        expect(isLossy('mp3')).toBe(true);
        expect(isLossy('flac16')).toBe(false);
        expect(wavFormatOf('pcm24')).toBe('pcm24');
        expect(wavFormatOf('flac24')).toBe('pcm24');
        expect(wavFormatOf('mp3')).toBe('pcm16');
        expect(bitrateOf('pcm16', 128)).toBe(0);
        expect(bitrateOf('mp3', '128')).toBe(128);
        expect(bitrateOf('mp3', 123)).toBe(192);
    });

    it('reports codec availability for WAV, extensions, WebCodecs, and failures', async () => {
        expect(await canEncode('pcm16')).toBe(true);
        vi.stubGlobal('WebAssembly', {});
        vi.stubGlobal('Worker', class {});
        expect(await canEncode('flac16')).toBe(true);
        vi.stubGlobal('Worker', undefined);
        expect(await canEncode('mp3')).toBe(false);

        class SupportedAudioEncoder { static async isConfigSupported() { return { supported: true }; } }
        vi.stubGlobal('AudioEncoder', SupportedAudioEncoder);
        expect(await canEncode('opus')).toBe(true);
        class ThrowingAudioEncoder { static async isConfigSupported() { throw new Error('unsupported'); } }
        vi.stubGlobal('AudioEncoder', ThrowingAudioEncoder);
        expect(await canEncode('opus')).toBe(false);
        vi.stubGlobal('AudioEncoder', undefined);
        expect(await canEncode('opus')).toBe(false);
    });

    it('streams or returns WAV output', async () => {
        const channels = [new Float32Array([0, 0.5, -0.5])];
        const writer = await createWriter('pcm16', { sampleRate: 8000, channels: 1, frames: 3 });
        await writer.write(channels, 0, 3, 0.5);
        const blob = await writer.finish();
        expect(blob).toBeInstanceOf(Blob);
        expect(blob.type).toBe('audio/wav');
        expect(blob.size).toBe(50);
        await writer.cancel();

        const sink = { chunks: [], write(chunk) { this.chunks.push(chunk); }, async close() { this.closed = true; } };
        const streamed = await createWriter('float32', { sampleRate: 8000, channels: 1, frames: 0, sink });
        expect(await streamed.finish()).toBeNull();
        expect(sink.closed).toBe(true);
        expect(sink.chunks).toHaveLength(1);
    });

    it('encodes lossy planar samples and finalizes buffer and stream targets', async () => {
        const writer = await createWriter('opus', { sampleRate: 48000, channels: 2, frames: 2, bitrate: 96 });
        await writer.write([new Float32Array([2, 0.5]), new Float32Array([-2, -0.5])], 0, 2, 0.5);
        await writer.write([], 0, 0);
        const blob = await writer.finish();
        expect(blob.type).toBe('audio/ogg');
        expect([...mock.samples[0].data]).toEqual([1, 0.25, -1, -0.25]);
        expect(mock.samples[0].closed).toBe(true);
        expect(mock.finalized).toBe(1);

        const sink = {};
        const streamed = await createWriter('opus', { sampleRate: 48000, channels: 1, frames: 1, sink });
        expect(await streamed.finish()).toBeNull();
    });

    it('registers extension codecs and builds clipped 16- and 24-bit FLAC samples', async () => {
        mock.canEncode = false;
        const writer16 = await createWriter('flac16', { sampleRate: 48000, channels: 1, frames: 3 });
        await writer16.write([new Float32Array([-2, 0, 2])], 0, 3);
        expect([...mock.samples.at(-1).data]).toEqual([-32768, 0, 32767]);
        expect(mock.samples.at(-1).format).toBe('s16');
        expect(mock.extensionRegistrations).toBe(1);

        const writer24 = await createWriter('flac24', { sampleRate: 48000, channels: 1, frames: 3 });
        await writer24.write([new Float32Array([-1, 0, 1])], 0, 3, 0.5);
        expect([...mock.samples.at(-1).data]).toEqual([-1073741824, 0, 1073741568]);
        expect(mock.samples.at(-1).format).toBe('s32');
    });

    it('rejects unavailable codecs and supports cancellation', async () => {
        mock.canEncode = false;
        await expect(createWriter('opus', { sampleRate: 48000, channels: 1, frames: 0 }))
            .rejects.toThrow('cannot encode Opus');

        mock.canEncode = true;
        const writer = await createWriter('opus', { sampleRate: 48000, channels: 1, frames: 0 });
        await writer.cancel();
        expect(mock.cancelled).toBe(1);
    });

    it('encodes complete WAV input and empty compressed input', async () => {
        const wav = await encodeAll([new Float32Array([0, 1])], 8000, 'pcm16', { gain: 0.5 });
        expect(wav).toBeInstanceOf(Blob);
        expect(wav.size).toBe(48);

        const compressed = await encodeAll([], 48000, 'opus');
        expect(compressed).toBeInstanceOf(Blob);
    });

    it('retries compressed encoding at 44.1 kHz and cancels failed writes', async () => {
        mock.canEncode = (cfg) => cfg.sampleRate === 44100;
        const resample = vi.fn((channel) => new Float32Array(channel.length));
        const blob = await encodeAll([new Float32Array([0.1]), new Float32Array([0.2])], 48000, 'opus', { resample, block: 1 });
        expect(blob).toBeInstanceOf(Blob);
        expect(resample).toHaveBeenCalledTimes(2);

        mock.canEncode = true;
        const add = mock.added.push;
        mock.added.push = () => { throw new Error('write failed'); };
        await expect(encodeAll([new Float32Array([0.1])], 48000, 'opus')).rejects.toThrow('write failed');
        expect(mock.cancelled).toBe(1);
        mock.added.push = add;
    });
});
