import { describe, expect, it, vi } from 'vitest';
import { buildPanel } from '../assets/js/splicer/layout.js';
import * as render from '../assets/js/splicer/render.js';
import * as zip from '../assets/js/splicer/zip.js';

describe('splicer render pipeline', () => {
    it('normalizes item controls and signatures', () => {
        expect(render.clampNumber('', 0, 10, 5)).toBe(5);
        expect(render.clampNumber('nope', 0, 10, 5)).toBe(5);
        expect(render.clampNumber(20, 0, 10, 5)).toBe(10);
        expect(render.itemMix(null)).toBe(100);
        expect(render.itemGainDb({ gainDb: -50 })).toBe(-24);
        expect(render.itemHasLevel({ mix: 50 })).toBe(true);
        expect(render.cleanItem({ id: 'fx', label: '', steps: 0, params: 3, bypass: true })).toEqual({
            id: 'fx', label: 'fx', steps: 1, params: '', mix: 100, gainDb: 0, bypass: true,
        });
        expect(render.chainSig([{ id: 'a', params: 'x', mix: 50 }, { id: 'b', bypass: true }])).toBe('a{x}@50/0>~b');
        expect(render.chainSig()).toBe('');
    });

    it('maintains an LRU render cache', () => {
        const cache = render.createRenderCache(12);
        const a = new Float32Array(2);
        const b = new Float32Array(2);
        cache.set('a', a, { sampleRate: 1 });
        expect(cache.get('missing')).toBeNull();
        expect(cache.get('a')).toMatchObject({ pcm: a, sampleRate: 1 });
        cache.set('b', b);
        expect(cache.has('a')).toBe(false);
        expect(cache.bytes).toBe(8);
        cache.set('b', new Float32Array(1));
        expect(cache.bytes).toBe(4);
        cache.delete('missing');
        cache.clear();
        expect(cache.bytes).toBe(0);
    });

    it('mixes wet and dry levels with optional resampling', () => {
        const wet = new Float32Array([1, -1]);
        expect(render.applyLevel(wet, 1, wet, 1, {}, vi.fn())).toBe(wet);
        expect(render.applyLevel(wet, 1, null, 1, { mix: 50 }, vi.fn())).toBeNull();
        expect([...render.applyLevel(new Float32Array([1, 1]), 1, wet, 1, { mix: 50 })]).toEqual([1, 0]);
        const resample = vi.fn(() => new Float32Array([0.5, 0.5]));
        const mixed = render.applyLevel(new Float32Array([1]), 1, wet, 2, { mix: 50, gainDb: 6 }, resample);
        expect(resample).toHaveBeenCalled();
        expect(mixed[0]).toBeCloseTo(1.496, 2);
    });

    it('runs active chain stages, reports progress, and supports cancellation', async () => {
        const progress = [];
        const items = [{ id: 'skip', bypass: true }, { id: 'one', label: 'One' }, { id: 'two', label: 'Two', mix: 50 }];
        const runItem = vi.fn(async (item, pcm, sampleRate, onProgress) => {
            onProgress({ cmd: 'work', fraction: 2 });
            return { pcm: new Float32Array([...pcm].map((x) => x + 1)), sampleRate: sampleRate + 1 };
        });
        const result = await render.renderChain(new Float32Array([1]), 10, items, {
            runItem, resample: (pcm) => pcm, onProgress: (p) => progress.push(p),
        });
        expect(result.sampleRate).toBe(12);
        expect(runItem).toHaveBeenCalledTimes(2);
        expect(progress.at(-1).fraction).toBe(1);
        expect(await render.renderChain(new Float32Array([1]), 10, [], { runItem })).toMatchObject({ sampleRate: 10 });
        const error = new Error('cancelled');
        await expect(render.renderChain(new Float32Array([1]), 10, [items[1]], {
            runItem, resample: (pcm) => pcm, isCancelled: () => true, cancelError: () => error,
        })).rejects.toBe(error);
        let checks = 0;
        await expect(render.renderChain(new Float32Array([1]), 10, [items[1]], {
            runItem, resample: (pcm) => pcm, isCancelled: () => ++checks > 1, cancelError: () => error,
        })).rejects.toBe(error);
    });
});

describe('splicer zip format', () => {
    it('matches the standard CRC32 vector and reports blob progress', async () => {
        const bytes = new TextEncoder().encode('123456789');
        expect(zip.crc32Update(0, bytes)).toBe(0xcbf43926);
        const progress = [];
        expect(await zip.crc32Blob(new Blob([bytes]), (...p) => progress.push(p))).toBe(0xcbf43926);
        expect(progress).toEqual([[9, 9]]);
    });

    it('builds and reads stored zip entries', async () => {
        const archive = await zip.buildZip([
            { name: 'hello.txt', blob: new Blob(['hello']) },
            { name: 'empty.bin', blob: new Blob([]) },
        ], { date: new Date(0) });
        expect(archive.type).toBe('application/zip');
        const files = await zip.readZip(archive);
        expect([...files.keys()]).toEqual(['hello.txt', 'empty.bin']);
        expect(await (await zip.entryBlob(files.get('hello.txt'))).text()).toBe('hello');
        expect((await zip.entryBlob(files.get('empty.bin'))).size).toBe(0);
    });

    it('rejects invalid archives, unsupported methods, and too many entries', async () => {
        await expect(zip.readZip(new Blob(['not zip']))).rejects.toThrow('not a zip');
        await expect(zip.entryBlob({ name: 'x', method: 99, raw: new Blob([]) })).rejects.toThrow('compression method');
        const entries = Array.from({ length: 0x10000 }, () => ({ name: 'x', blob: new Blob([]) }));
        await expect(zip.buildZip(entries)).rejects.toBeInstanceOf(zip.ZipTooLargeError);
    });

    it('reads deflate-raw entries when the platform supports them', async () => {
        if (typeof CompressionStream !== 'function' || typeof DecompressionStream !== 'function') return;
        const raw = new Blob(['compressed']);
        const compressed = await new Response(raw.stream().pipeThrough(new CompressionStream('deflate-raw'))).blob();
        expect(await (await zip.entryBlob({ name: 'x', method: 8, raw: compressed })).text()).toBe('compressed');
    });
});

describe('splicer panel layout', () => {
    it('builds the panel once while preserving its heading', () => {
        const heading = { id: 'heading' };
        const appended = [];
        const panel = {
            built: false,
            querySelector(selector) { return selector === '.section-heading' ? heading : (this.built ? {} : null); },
            replaceChildren: vi.fn(),
            append(value) { appended.push(value); if (value === 'fragment') this.built = true; },
            classList: { add: vi.fn() },
        };
        const oldDocument = globalThis.document;
        globalThis.document = { createElement: () => ({ innerHTML: '', content: 'fragment' }) };
        try {
            buildPanel(null);
            buildPanel(panel);
            buildPanel(panel);
        } finally {
            globalThis.document = oldDocument;
        }
        expect(panel.replaceChildren).toHaveBeenCalledOnce();
        expect(appended).toEqual([heading, 'fragment']);
        expect(panel.classList.add).toHaveBeenCalledWith('splice-panel');
    });
});
