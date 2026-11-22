import { describe, expect, it } from 'vitest';
import { GIFEncoder } from '../assets/js/gifenc/gifenc.esm.js';
import { GifError, frameDelay, gifDuration, gifFrames, interlacedRows, lzwDecode, parseGif } from '../assets/js/gif-decode.js';

const PALETTE = [[0, 0, 0], [255, 0, 0], [0, 255, 0], [0, 0, 255]];

function encode(frames, { width = 3, height = 2 } = {}) {
    const gif = GIFEncoder();
    frames.forEach((frame) => gif.writeFrame(Uint8Array.from(frame.indices), width, height, { palette: PALETTE, ...frame.options }));
    gif.finish();
    return gif.bytes();
}

const rgbaAt = (frame, x, y) => [...frame.rgba.slice((y * frame.width + x) * 4, (y * frame.width + x) * 4 + 4)];

const snapshot = (gif) => {
    const out = [];
    for (const frame of gifFrames(gif)) {
        out.push({ ...frame, rgba: frame.rgba.slice() });
    }
    return out;
};

describe('GIF decoding', () => {
    it('decodes frames, delays and transparency the way browsers show them', () => {
        const bytes = encode([
            { indices: [1, 2, 3, 0, 1, 2], options: { delay: 50 } },
            { indices: [0, 3, 0, 0, 0, 0], options: { delay: 0, transparent: true, transparentIndex: 0 } },
        ]);
        const gif = parseGif(bytes);
        expect(gif).toMatchObject({ width: 3, height: 2 });
        expect(gif.frames).toHaveLength(2);
        const frames = snapshot(gif);
        expect(rgbaAt(frames[0], 0, 0)).toEqual([255, 0, 0, 255]);
        expect(rgbaAt(frames[0], 2, 0)).toEqual([0, 0, 255, 255]);
        expect(rgbaAt(frames[1], 0, 0)).toEqual([255, 0, 0, 255]);
        expect(rgbaAt(frames[1], 1, 0)).toEqual([0, 0, 255, 255]);
        expect(frames.map((f) => f.delay)).toEqual([50, 100]);
        expect(gifDuration(gif)).toBe(150);
        expect(parseGif(bytes.buffer).frames).toHaveLength(2);
    });

    it('clears a disposed frame and restores the previous one', () => {
        const restore = parseGif(encode([
            { indices: [1, 1, 1, 1, 1, 1], options: { delay: 30 } },
            { indices: [2, 2, 2, 2, 2, 2], options: { delay: 30, dispose: 3 } },
            { indices: [0, 0, 0, 0, 0, 0], options: { delay: 30, transparent: true, transparentIndex: 0 } },
        ]));
        expect(rgbaAt(snapshot(restore)[2], 1, 1)).toEqual([255, 0, 0, 255]);

        const clear = parseGif(encode([
            { indices: [1, 1, 1, 1, 1, 1], options: { delay: 30, dispose: 2 } },
            { indices: [0, 0, 0, 0, 0, 0], options: { delay: 30, transparent: true, transparentIndex: 0 } },
        ]));
        expect(rgbaAt(snapshot(clear)[1], 1, 1)).toEqual([0, 0, 0, 0]);
    });

    it('places interlaced rows where they belong', () => {
        expect(interlacedRows(8)).toEqual([0, 4, 2, 6, 1, 3, 5, 7]);
        const bytes = encode([{ indices: [0, 1, 2, 3, 0, 1, 2, 3] }], { width: 1, height: 8 });
        const gif = parseGif(bytes);
        const descriptor = gif.frames[0].dataStart - 1 - 9 + 8;
        const flagged = Uint8Array.from(bytes);
        flagged[descriptor] |= 0x40;
        const [frame] = snapshot(parseGif(flagged));
        expect(rgbaAt(frame, 0, 4)).toEqual([255, 0, 0, 255]);
        expect(rgbaAt(frame, 0, 1)).toEqual([0, 0, 0, 255]);
        expect(rgbaAt(frame, 0, 3)).toEqual([255, 0, 0, 255]);
        expect(rgbaAt(frame, 0, 6)).toEqual([0, 0, 255, 255]);
    });

    it('uses a local palette and skips pixels outside the screen', () => {
        const bytes = Uint8Array.from([
            ...[...'GIF87a'].map((c) => c.charCodeAt(0)),
            2, 0, 1, 0, 0x00, 0, 0,
            0x2c, 1, 0, 0, 0, 2, 0, 1, 0, 0x80,
            9, 8, 7, 1, 2, 3,
            2, 2, 0x44, 0x0a, 0,
            0x21, 0x01, 0,
            0x3b,
        ]);
        const gif = parseGif(bytes);
        expect(gif.frames[0].palette).toEqual(Uint8Array.from([9, 8, 7, 1, 2, 3]));
        const [frame] = snapshot(gif);
        expect(rgbaAt(frame, 1, 0)).toEqual([9, 8, 7, 255]);
        expect(rgbaAt(frame, 0, 0)).toEqual([0, 0, 0, 0]);
    });

    it('rejects files that are not GIFs or have no pictures', () => {
        expect(() => parseGif(new Uint8Array([1, 2, 3]))).toThrow(GifError);
        expect(() => parseGif(Uint8Array.from([...'GIF89a'].map((c) => c.charCodeAt(0))))).toThrow('cut short');
        const empty = Uint8Array.from([...[...'GIF89a'].map((c) => c.charCodeAt(0)), 1, 0, 1, 0, 0, 0, 0, 0x3b]);
        expect(() => parseGif(empty)).toThrow('no frames');
        const junk = Uint8Array.from([...[...'GIF89a'].map((c) => c.charCodeAt(0)), 1, 0, 1, 0, 0, 0, 0, 0x99]);
        expect(() => parseGif(junk)).toThrow('no frames');
    });

    it('survives broken LZW data', () => {
        expect([...lzwDecode(new Uint8Array(4), 0, 4, 0, 3)]).toEqual([0, 0, 0]);
        expect([...lzwDecode(new Uint8Array([1, 0xff]), 0, 2, 2, 4)]).toEqual([0, 0, 0, 0]);
        expect([...lzwDecode(new Uint8Array([0]), 0, 1, 2, 2)]).toEqual([0, 0]);
        expect([...lzwDecode(new Uint8Array(0), 0, 0, 2, 2)]).toEqual([0, 0]);
        expect(frameDelay(10)).toBe(100);
        expect(frameDelay(40)).toBe(40);
    });
});
