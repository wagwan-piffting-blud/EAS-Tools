import { describe, expect, it } from 'vitest';
import { createLimiter, limitAll, overDb, peakRatio } from '../assets/js/splicer/limiter.js';
import { columnRange, drawPeaks, getPeaks } from '../assets/js/splicer/peaks.js';
import { encodeFrames, encodeWav, formatOf, FORMATS, wavHeader } from '../assets/js/splicer/wav.js';

const ascii = (bytes, start, length) => String.fromCharCode(...bytes.slice(start, start + length));

describe('WAV encoding', () => {
    it('normalizes formats and describes supported encodings', () => {
        expect(formatOf('pcm24')).toBe('pcm24');
        expect(formatOf('unknown')).toBe('pcm16');
        expect(FORMATS.float32).toMatchObject({ bits: 32, tag: 3 });
    });

    it('writes PCM and float headers with correct sizes', () => {
        const pcm = wavHeader(10, 48000, 2, 'pcm16');
        const pcmView = new DataView(pcm.buffer);
        expect(ascii(pcm, 0, 4)).toBe('RIFF');
        expect(ascii(pcm, 8, 4)).toBe('WAVE');
        expect(ascii(pcm, 36, 4)).toBe('data');
        expect(pcmView.getUint16(20, true)).toBe(1);
        expect(pcmView.getUint16(22, true)).toBe(2);
        expect(pcmView.getUint32(40, true)).toBe(40);

        const float = wavHeader(3, 44100, 1, 'float32');
        const floatView = new DataView(float.buffer);
        expect(float).toHaveLength(58);
        expect(floatView.getUint16(20, true)).toBe(3);
        expect(ascii(float, 38, 4)).toBe('fact');
        expect(floatView.getUint32(46, true)).toBe(3);
        expect(ascii(float, 50, 4)).toBe('data');
    });

    it('encodes and clamps interleaved PCM samples', () => {
        const channels = [new Float32Array([-2, -0.5, 0, 0.5, 2]), new Float32Array([1, 0, -1, 0.25, -0.25])];
        const pcm16 = encodeFrames(channels, 0, 5, 'pcm16');
        const v16 = new DataView(pcm16.buffer);
        expect(v16.getInt16(0, true)).toBe(-32768);
        expect(v16.getInt16(2, true)).toBe(32767);
        expect(v16.getInt16(16, true)).toBe(32767);

        const pcm24 = encodeFrames([new Float32Array([-1, 0, 1])], 0, 3, 'pcm24', 2);
        expect([...pcm24.slice(0, 3)]).toEqual([0, 0, 128]);
        expect([...pcm24.slice(3, 6)]).toEqual([0, 0, 0]);
        expect([...pcm24.slice(6, 9)]).toEqual([255, 255, 127]);

        const float = encodeFrames([new Float32Array([0.25])], 0, 1, 'float32', 2);
        expect(new DataView(float.buffer).getFloat32(0, true)).toBeCloseTo(0.5);
    });

    it('builds a complete Blob, including an empty WAV', async () => {
        const wav = encodeWav([new Float32Array([0, 0.5])], 8000);
        expect(wav.type).toBe('audio/wav');
        expect(wav.size).toBe(48);
        expect(ascii(new Uint8Array(await wav.arrayBuffer()), 0, 4)).toBe('RIFF');
        expect(encodeWav([], 8000).size).toBe(44);
    });
});

describe('limiter', () => {
    it('passes safe audio through with and without gain', () => {
        const limiter = createLimiter({ sampleRate: 1000, lookaheadMs: 1 });
        expect(limiter.lookahead).toBe(2);
        expect([...limiter.process([new Float32Array([0.1, -0.2])], 0, 2)[0]]).toEqual(expect.arrayContaining([expect.closeTo(0.1), expect.closeTo(-0.2)]));
        expect([...limiter.process([new Float32Array([0.1])], 0, 1, 2)[0]][0]).toBeCloseTo(0.2);
    });

    it('limits peaks, tracks overshoot, and releases gain', () => {
        const limiter = createLimiter({ sampleRate: 1000, lookaheadMs: 1, releaseMs: 2, ceiling: 0.5 });
        const out = limiter.process([new Float32Array([0, 2, 0.25, -2, 0])], 0, 5);
        expect(Math.max(...out[0].map(Math.abs))).toBeLessThanOrEqual(0.5);
        expect(limiter.over).toBe(4);
        const tail = limiter.process([new Float32Array([0.25, 0.25])], 0, 2);
        expect(tail[0][1]).toBeGreaterThanOrEqual(tail[0][0]);
    });

    it('handles multiple channels, offsets, empty input, and helper calculations', () => {
        const result = limitAll([new Float32Array([0.2, 2]), new Float32Array([-0.1, -2])], 1000);
        expect(result.chans).toHaveLength(2);
        expect(result.over).toBe(2);
        expect(limitAll([], 44100).chans).toEqual([]);
        expect(peakRatio([new Float32Array([0.25, -2])], 2, 0.5)).toBe(8);
        expect(peakRatio([], 2)).toBe(1);
        expect(overDb(1)).toBe(0);
        expect(overDb(10)).toBeCloseTo(20);
    });

    it('pads missing samples and handles zero-length processing windows', () => {
        const limiter = createLimiter({ sampleRate: 1000, lookaheadMs: 1 });
        expect(limiter.process([], 0, 0)).toEqual([]);
        expect([...limiter.process([new Float32Array([0.5])], 1, 3)[0]]).toEqual([]);
        expect([...limiter.process([new Float32Array([0.5])], 0, 2)[0]]).toEqual([0.5]);
        expect([...limiter.process([new Float32Array([0.5])], 0, 2, 2)[0]]).toEqual([1]);
        expect([...limiter.process([new Float32Array([0])], 0, 1)[0]]).toEqual([0]);
        expect([...limiter.process([new Float32Array([0])], 0, 1, 2)[0]]).toEqual([0]);
        expect(peakRatio([new Float32Array([0, 0])])).toBe(1);
    });
});

describe('waveform peaks', () => {
    it('calculates, caches, and queries short and bucketed ranges', () => {
        const pcm = new Float32Array(1300);
        pcm[0] = -0.5;
        pcm[1] = 0.75;
        pcm[1200] = -1;
        const first = getPeaks(pcm);
        expect(getPeaks(pcm)).toBe(first);
        expect([...columnRange(pcm, 0, 2)]).toEqual([-0.5, 0.75]);
        expect(columnRange(pcm, 0, 1300)).toEqual([-1, 0.75]);
        expect(columnRange(pcm, 3, 3)).toBeNull();
        expect(columnRange(pcm, -10, 1)).toEqual([-0.5, -0.5]);
        expect(columnRange(new Float32Array(), 0, 2048)).toBeNull();
        expect(columnRange(new Float32Array(1300), 0, 1300)).toEqual([0, 0]);
    });

    it('draws PCM and precomputed peaks and skips empty columns', () => {
        const calls = [];
        const ctx = { fillStyle: '', fillRect: (...args) => calls.push(args) };
        drawPeaks(ctx, new Float32Array([-2, 0.5, 2]), {
            x0: 0, x1: 3, srcStart: 0, samplesPerPx: 1, top: 0, height: 10, gain: 2, color: 'orange',
        });
        expect(ctx.fillStyle).toBe('orange');
        expect(calls).toHaveLength(3);

        drawPeaks(ctx, { peaks: new Float32Array([-0.5, 0.5, -1, 1]), bucket: 2, length: 4 }, {
            x0: 0, x1: 2, srcStart: 0, samplesPerPx: 2, top: 0, height: 8, color: 'black',
        });
        expect(calls).toHaveLength(5);
        drawPeaks(ctx, new Float32Array(), {
            x0: 0, x1: 1, srcStart: 0, samplesPerPx: 1, top: 0, height: 8, color: 'black',
        });
        expect(calls).toHaveLength(5);
        drawPeaks(ctx, { peaks: new Float32Array([0, 0, 0, 0]), bucket: 2, length: 4 }, {
            x0: 0, x1: 2, srcStart: 0, samplesPerPx: 2, top: 0, height: 8, color: 'black',
        });
        expect(calls).toHaveLength(7);
        drawPeaks(ctx, { peaks: new Float32Array(), bucket: 2, length: 0 }, {
            x0: 0, x1: 1, srcStart: 0, samplesPerPx: 2, top: 0, height: 8, color: 'black',
        });
        expect(calls).toHaveLength(7);
    });
});
