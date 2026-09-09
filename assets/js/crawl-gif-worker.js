import { GIFEncoder, quantize, applyPalette } from './gifenc/gifenc.esm.js';

const MAX_PALETTE_SAMPLE_PIXELS = 1_000_000;

function buildPaletteSample(buffers) {
    const totalPixels = buffers.reduce((sum, buf) => sum + (buf.byteLength >> 2), 0);
    const stride = Math.max(1, Math.ceil(totalPixels / MAX_PALETTE_SAMPLE_PIXELS));
    if (stride === 1 && buffers.length === 1) {
        return new Uint8ClampedArray(buffers[0]);
    }
    const sample = new Uint8ClampedArray((Math.ceil(totalPixels / stride) + buffers.length) * 4);
    let written = 0;
    for (const buf of buffers) {
        const src = new Uint8ClampedArray(buf);
        const pixels = src.length >> 2;
        for (let p = 0; p < pixels; p += stride) {
            const s = p * 4;
            sample[written] = src[s];
            sample[written + 1] = src[s + 1];
            sample[written + 2] = src[s + 2];
            sample[written + 3] = src[s + 3];
            written += 4;
        }
    }
    return sample.subarray(0, written);
}

function handlePalette(msg) {
    const format = msg.transparent ? 'rgba4444' : 'rgb565';
    const sample = buildPaletteSample(msg.buffers);
    const palette = quantize(sample, 256, {
        format,
        oneBitAlpha: msg.transparent ? 127 : false,
        clearAlpha: true
    });
    postMessage({ type: 'palette', palette, format });
}

function handleChunk(msg) {
    const { id, width, height, palette, format, delay, repeat, first, transparent, transparentIndex } = msg;
    const encoder = GIFEncoder({ auto: false });
    if (first) {
        encoder.writeHeader();
    }
    msg.frames.forEach((buffer, i) => {
        const rgba = new Uint8ClampedArray(buffer);
        const index = applyPalette(rgba, palette, format);
        const isFirstFrame = first && i === 0;
        encoder.writeFrame(index, width, height, {
            palette: isFirstFrame ? palette : undefined,
            first: isFirstFrame,
            delay,
            repeat,
            transparent,
            transparentIndex,
            dispose: transparent ? 2 : -1
        });
    });
    const view = encoder.bytesView();
    const out = new Uint8Array(view.length);
    out.set(view);
    postMessage({ type: 'chunk', id, frames: msg.frames.length, buffer: out.buffer }, [out.buffer]);
}

self.onmessage = (event) => {
    const msg = event.data || {};
    try {
        if (msg.type === 'palette') {
            handlePalette(msg);
        } else if (msg.type === 'chunk') {
            handleChunk(msg);
        }
    } catch (error) {
        postMessage({ type: 'fatal', id: msg.id, error: (error && error.message) || String(error) });
    }
};
