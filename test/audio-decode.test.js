import { beforeEach, describe, expect, it, vi } from 'vitest';

const mb = vi.hoisted(() => ({ track: null, canDecode: true, samples: [], disposed: 0, fail: false }));

vi.mock('../assets/js/mediabunny/mediabunny.min.js', () => {
    class Input {
        constructor(options) {
            this.options = options;
        }
        async getPrimaryAudioTrack() {
            if (mb.fail) throw new Error('unreadable container');
            return mb.track;
        }
        dispose() {
            mb.disposed++;
        }
    }
    class BlobSource {
        constructor(blob) {
            this.blob = blob;
        }
    }
    class AudioSampleSink {
        constructor(track) {
            this.track = track;
        }
        async *samples() {
            for (const sample of mb.samples) yield sample;
        }
    }
    return { Input, BlobSource, AudioSampleSink, ALL_FORMATS: ['all'] };
});

import {
    AudioDecodeError, convertWavFrames, decodeAudioBlob, decodeWithMediabunny, pickChannels, readWavChannels, readWavInfo,
} from '../assets/js/audio/decode.js';
import { encodeFrames, wavHeader } from '../assets/js/audio/wav.js';

const ascii = (s) => [...s].map((c) => c.charCodeAt(0));

function chunk(id, body) {
    const out = new Uint8Array(8 + body.length + (body.length & 1));
    out.set(ascii(id), 0);
    new DataView(out.buffer).setUint32(4, body.length, true);
    out.set(body, 8);
    return out;
}

function fmtBody({ format = 1, channels = 1, rate = 8000, bits = 16, block = channels * bits / 8, extensible = 0 }) {
    const body = new Uint8Array(extensible ? 40 : 16);
    const v = new DataView(body.buffer);
    v.setUint16(0, extensible ? 0xfffe : format, true);
    v.setUint16(2, channels, true);
    v.setUint32(4, rate, true);
    v.setUint32(8, rate * block, true);
    v.setUint16(12, block, true);
    v.setUint16(14, bits, true);
    if (extensible) {
        v.setUint16(16, 22, true);
        v.setUint16(24, format, true);
    }
    return body;
}

function riff(parts, tag = 'RIFF') {
    const size = parts.reduce((n, p) => n + p.length, 4);
    const out = new Uint8Array(8 + size);
    out.set(ascii(tag), 0);
    new DataView(out.buffer).setUint32(4, size, true);
    out.set(ascii('WAVE'), 8);
    let at = 12;
    for (const part of parts) {
        out.set(part, at);
        at += part.length;
    }
    return new Blob([out]);
}

function wavBlob(chans, rate, format) {
    return new Blob([wavHeader(chans[0].length, rate, chans.length, format), encodeFrames(chans, 0, chans[0].length, format)]);
}

function fakeBuffer(channels, sampleRate = 48000) {
    return {
        sampleRate,
        numberOfChannels: channels.length,
        length: channels[0].length,
        getChannelData: (c) => channels[c],
    };
}

function sample(planes, sampleRate = 48000) {
    return {
        numberOfChannels: planes.length,
        numberOfFrames: planes[0].length,
        sampleRate,
        copyTo(dest, { planeIndex }) {
            dest.set(planes[planeIndex]);
        },
        close() {
            this.closed = true;
        },
    };
}

describe('WAV header reading', () => {
    it('reads PCM, float and extensible layouts and rejects anything else', async () => {
        const info = await readWavInfo(wavBlob([new Float32Array([0, 0.5]), new Float32Array([0, -0.5])], 22050, 'pcm16'));
        expect(info).toMatchObject({ sampleRate: 22050, channels: 2, bits: 16, float: false, blockAlign: 4, dataOffset: 44, frames: 2, dataBytes: 8 });

        const float = await readWavInfo(wavBlob([new Float32Array([0.25])], 5000, 'float32'));
        expect(float).toMatchObject({ sampleRate: 5000, float: true, bits: 32, frames: 1 });

        const ext = await readWavInfo(riff([chunk('fmt ', fmtBody({ format: 1, bits: 24, channels: 2, extensible: 1 })), chunk('data', new Uint8Array(12))]));
        expect(ext).toMatchObject({ bits: 24, channels: 2, frames: 2 });

        expect(await readWavInfo(null)).toBeNull();
        expect(await readWavInfo(new Blob([new Uint8Array(4)]))).toBeNull();
        expect(await readWavInfo(new Blob([new Uint8Array(ascii('RIFF____AVI LIST'))]))).toBeNull();
        expect(await readWavInfo(riff([chunk('fmt ', fmtBody({ format: 2 })), chunk('data', new Uint8Array(4))]))).toBeNull();
        expect(await readWavInfo(riff([chunk('fmt ', fmtBody({ bits: 12, block: 2 })), chunk('data', new Uint8Array(4))]))).toBeNull();
        expect(await readWavInfo(riff([chunk('fmt ', fmtBody({ format: 3, bits: 16 })), chunk('data', new Uint8Array(4))]))).toBeNull();
        expect(await readWavInfo(riff([chunk('data', new Uint8Array(4))]))).toBeNull();
        expect(await readWavInfo(riff([chunk('fmt ', new Uint8Array(8))]))).toBeNull();
        expect(await readWavInfo(riff([chunk('LIST', new Uint8Array(3))]))).toBeNull();
    });

    it('follows RF64 sizes, skips odd chunks, and trusts the file over a bad data size', async () => {
        const ds64 = new Uint8Array(28);
        new DataView(ds64.buffer).setUint32(8, 6, true);
        const data = new Uint8Array(8 + 6);
        data.set(ascii('data'), 0);
        new DataView(data.buffer).setUint32(4, 0xffffffff, true);
        const rf64 = await readWavInfo(riff([chunk('ds64', ds64), chunk('fmt ', fmtBody({})), data], 'RF64'));
        expect(rf64).toMatchObject({ frames: 3, dataBytes: 6 });

        const zero = new Uint8Array(8 + 4);
        zero.set(ascii('data'), 0);
        const open = await readWavInfo(riff([chunk('junk', new Uint8Array(3)), chunk('fmt ', fmtBody({})), zero]));
        expect(open.frames).toBe(2);

        const truncatedDs64 = riff([chunk('fmt ', fmtBody({}))]);
        const bytes = new Uint8Array(await truncatedDs64.arrayBuffer());
        const broken = new Uint8Array(bytes.length + 8);
        broken.set(bytes);
        broken.set(ascii('ds64'), bytes.length);
        new DataView(broken.buffer).setUint32(bytes.length + 4, 28, true);
        expect(await readWavInfo(new Blob([broken]))).toBeNull();
    });
});

describe('WAV sample conversion', () => {
    const decode = (bits, float, bytes, channels, mode) => {
        const info = { bits, float, channels, blockAlign: channels * bits / 8 };
        const frames = bytes.length / info.blockAlign;
        const outs = Array.from({ length: mode === 'all' ? channels : 1 }, () => new Float32Array(frames));
        convertWavFrames(new Uint8Array(bytes), info, frames, outs, 0, mode);
        return outs.map((o) => [...o]);
    };

    it('reads every supported sample width', () => {
        expect(decode(8, false, [0, 128, 255], 1, 0)[0].map((v) => Math.round(v * 128))).toEqual([-128, 0, 127]);
        expect(decode(16, false, [0x00, 0x80, 0xff, 0x7f], 1, 0)[0]).toEqual([-1, 32767 / 32768]);
        expect(decode(24, false, [0x00, 0x00, 0x80, 0x00, 0x00, 0x40], 1, 0)[0]).toEqual([-1, 0.5]);
        expect(decode(32, false, [0, 0, 0, 0x80, 0, 0, 0, 0x40], 1, 0)[0]).toEqual([-1, 0.5]);
        const f32 = new Uint8Array(new Float32Array([0.25]).buffer);
        expect(decode(32, true, [...f32], 1, 0)[0]).toEqual([0.25]);
        const f64 = new Uint8Array(new Float64Array([-0.125]).buffer);
        expect(decode(64, true, [...f64], 1, 0)[0]).toEqual([-0.125]);
    });

    it('takes one channel, mixes or keeps all channels', () => {
        const stereo = [0x00, 0x40, 0x00, 0xc0, 0x00, 0x20, 0x00, 0x20];
        expect(decode(16, false, stereo, 2, 0)[0]).toEqual([0.5, 0.25]);
        expect(decode(16, false, stereo, 2, 1)[0]).toEqual([-0.5, 0.25]);
        expect(decode(16, false, stereo, 2, 9)[0]).toEqual([-0.5, 0.25]);
        expect(decode(16, false, stereo, 2, 'mix')[0]).toEqual([0, 0.25]);
        expect(decode(16, false, stereo, 2, 'all')).toEqual([[0.5, 0.25], [-0.5, 0.25]]);
        expect(decode(16, false, [0x00, 0x40], 1, 'mix')[0]).toEqual([0.5]);
    });

    it('streams channels in chunks, yields between them, and refuses oversized files', async () => {
        const blob = wavBlob([new Float32Array([0.5, -0.5, 0.25])], 8000, 'pcm16');
        const info = await readWavInfo(blob);
        const yieldEvery = vi.fn(async () => {});
        const [mono] = await readWavChannels(blob, info, { yieldEvery });
        expect(mono[0]).toBeCloseTo(0.5, 4);
        expect(mono.length).toBe(3);
        expect(yieldEvery).toHaveBeenCalledTimes(1);
        await expect(readWavChannels(blob, info, { maxFrames: 2 })).rejects.toMatchObject({ code: 'too-large', name: 'AudioDecodeError' });
        const empty = await readWavChannels(blob, { ...info, frames: 0 });
        expect(empty[0].length).toBe(0);
    });
});

describe('channel selection', () => {
    it('handles empty, single, mixed and full channel lists', () => {
        expect(pickChannels([])[0].length).toBe(0);
        const a = new Float32Array([1, 0]);
        const b = new Float32Array([0, 1]);
        expect([...pickChannels([a, b], 'mix')[0]]).toEqual([0.5, 0.5]);
        expect([...pickChannels([a, b], 1)[0]]).toEqual([0, 1]);
        expect([...pickChannels([a, b], 'nope')[0]]).toEqual([1, 0]);
        expect([...pickChannels([a], 'mix')[0]]).toEqual([1, 0]);
        const all = pickChannels([a, b], 'all');
        expect(all).toHaveLength(2);
        expect(all[0]).not.toBe(a);
        expect([...pickChannels([a, new Float32Array([1])], 'mix')[0]]).toEqual([1, 0]);
    });
});

describe('decoding any file', () => {
    beforeEach(() => {
        mb.track = { canDecode: async () => mb.canDecode };
        mb.canDecode = true;
        mb.samples = [];
        mb.disposed = 0;
        mb.fail = false;
    });

    it('reads WAV files itself at any sample rate', async () => {
        const context = { decodeAudioData: vi.fn() };
        const decoded = await decodeAudioBlob(wavBlob([new Float32Array([0.5])], 5000, 'pcm16'), { context });
        expect(decoded.source).toBe('wav');
        expect(decoded.sampleRate).toBe(5000);
        expect(context.decodeAudioData).not.toHaveBeenCalled();
    });

    it('uses the browser decoder, then the container reader, before giving up', async () => {
        const blob = new Blob([new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])]);
        const context = { decodeAudioData: vi.fn(async () => fakeBuffer([new Float32Array([0.1, 0.2]), new Float32Array([0.3, 0.4])], 44100)) };
        const browser = await decodeAudioBlob(blob, { context, mode: 'mix' });
        expect(browser.source).toBe('browser');
        expect(browser.channels[0][0]).toBeCloseTo(0.2, 6);

        context.decodeAudioData = vi.fn(async () => { throw new Error('no'); });
        mb.samples = [sample([new Float32Array([0.5, 0.25])], 48000), sample([new Float32Array([0.125])], 48000)];
        const contained = await decodeAudioBlob(blob, { context });
        expect(contained.source).toBe('container');
        expect([...contained.channels[0]]).toEqual([0.5, 0.25, 0.125]);
        expect(mb.samples.every((s) => s.closed)).toBe(true);
        expect(mb.disposed).toBe(1);

        context.decodeAudioData = vi.fn(async () => fakeBuffer([new Float32Array(0)]));
        mb.samples = [];
        await expect(decodeAudioBlob(blob, { context })).rejects.toBeInstanceOf(AudioDecodeError);

        mb.fail = true;
        await expect(decodeAudioBlob(blob)).rejects.toThrow('Could not find audio');
        await expect(decodeAudioBlob(blob, { maxDecodeBytes: 4 })).rejects.toMatchObject({ code: 'too-large' });
    });

    it('reads every channel from a container, or nothing when the track cannot be decoded', async () => {
        const blob = new Blob([new Uint8Array(16)]);
        mb.samples = [sample([new Float32Array([0.1]), new Float32Array([0.2])]), sample([new Float32Array([0.3])])];
        const all = await decodeWithMediabunny(blob, 'all');
        expect(all.channels).toHaveLength(2);
        expect([...all.channels[1]].map((v) => +v.toFixed(2))).toEqual([0.2, 0.3]);

        mb.canDecode = false;
        expect(await decodeWithMediabunny(blob)).toBeNull();
        mb.track = null;
        expect(await decodeWithMediabunny(blob)).toBeNull();
    });
});
