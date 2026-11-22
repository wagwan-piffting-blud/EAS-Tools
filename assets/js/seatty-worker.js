import { loadSeattyWasm, createSeattySameDemod } from './seatty-same-wasm.js';
import { readWavInfo } from './audio/decode.js';

const WAV_MIN_RATE = 8000;
const WAV_MAX_RATE = 48000;
const READ_SLICE = 16 << 20;
const READ_DEPTH = 4;
const READ_WINDOW = 6;

export const SEATTY_EVENT_TONE = 4;

export async function readWavLayout(blob) {
    const info = await readWavInfo(blob);
    if (!info || info.sampleRate < WAV_MIN_RATE || info.sampleRate > WAV_MAX_RATE) {
        return null;
    }
    return info;
}

function extractChannel0(bytes, frames, layout, out) {
    const stride = layout.channels;
    const align = layout.blockAlign;
    if (layout.float) {
        if (layout.bits === 32) {
            const src = new Float32Array(bytes.buffer, 0, frames * stride);
            for (let i = 0; i < frames; i++) out[i] = src[i * stride];
        } else {
            const src = new Float64Array(bytes.buffer, 0, frames * stride);
            for (let i = 0; i < frames; i++) out[i] = src[i * stride];
        }
        return;
    }
    switch (layout.bits) {
        case 16: {
            const src = new Int16Array(bytes.buffer, 0, frames * stride);
            for (let i = 0; i < frames; i++) out[i] = src[i * stride] / 32768;
            break;
        }
        case 24:
            for (let i = 0, p = 0; i < frames; i++, p += align) {
                out[i] = (((bytes[p] | (bytes[p + 1] << 8) | (bytes[p + 2] << 16)) << 8) >> 8) / 8388608;
            }
            break;
        case 32: {
            const src = new Int32Array(bytes.buffer, 0, frames * stride);
            for (let i = 0; i < frames; i++) out[i] = src[i * stride] / 2147483648;
            break;
        }
        default:
            for (let i = 0, p = 0; i < frames; i++, p += align) {
                out[i] = (bytes[p] - 128) / 128;
            }
    }
}

async function* prefetchSlices(blob, start, end) {
    const queue = [];
    let next = start;
    const issue = () => {
        if (next < end) {
            queue.push(blob.slice(next, Math.min(end, next + READ_SLICE)).arrayBuffer());
            next += READ_SLICE;
        }
    };
    for (let i = 0; i < READ_DEPTH; i++) {
        issue();
    }
    while (queue.length) {
        const buffer = await queue.shift();
        issue();
        yield new Uint8Array(buffer);
    }
}

export function openReader() {
    return new Promise((resolve) => {
        if (typeof Worker !== 'function') {
            resolve(null);
            return;
        }
        let worker;
        try {
            worker = new Worker(new URL('./seatty-reader.js', import.meta.url));
        } catch {
            resolve(null);
            return;
        }
        worker.onmessage = (event) => {
            if (event.data && event.data.type === 'ready') {
                worker.onmessage = null;
                worker.onerror = null;
                resolve(worker);
            }
        };
        worker.onerror = (event) => {
            event.preventDefault();
            worker.terminate();
            resolve(null);
        };
    });
}

export async function* readerSlices(reader, blob, start, end) {
    const chunks = [];
    let finished = false;
    let failure = null;
    let wake = null;
    const release = () => {
        if (wake) {
            const resume = wake;
            wake = null;
            resume();
        }
    };
    reader.onmessage = (event) => {
        const msg = event.data || {};
        if (msg.type === 'chunk') {
            chunks.push(new Uint8Array(msg.buffer));
        } else if (msg.type === 'end') {
            finished = true;
        } else if (msg.type === 'error') {
            failure = new Error(msg.message);
        }
        release();
    };
    reader.onerror = (event) => {
        event.preventDefault();
        failure = new Error(event.message || 'SeaTTY reader failed');
        release();
    };
    reader.postMessage({ type: 'read', file: blob, start, end, slice: READ_SLICE, depth: READ_DEPTH, window: READ_WINDOW });
    try {
        for (;;) {
            if (chunks.length) {
                const chunk = chunks.shift();
                reader.postMessage({ type: 'ack' });
                yield chunk;
            } else if (failure) {
                throw failure;
            } else if (finished) {
                return;
            } else {
                await new Promise((resolve) => {
                    wake = resolve;
                });
            }
        }
    } finally {
        reader.terminate();
    }
}

export async function* wavChannelChunks(blob, layout, slices) {
    const align = layout.blockAlign;
    let work = new Uint8Array(READ_SLICE + align);
    let carry = 0;
    let out = new Float32Array(0);
    const source = slices || prefetchSlices(blob, layout.dataOffset, layout.dataOffset + layout.dataBytes);
    for await (const value of source) {
        const total = carry + value.length;
        if (work.length < total) {
            const grown = new Uint8Array(total);
            grown.set(work.subarray(0, carry));
            work = grown;
        }
        work.set(value, carry);
        const frames = Math.floor(total / align);
        if (out.length < frames) {
            out = new Float32Array(frames);
        }
        const samples = out.subarray(0, frames);
        extractChannel0(work, frames, layout, samples);
        carry = total - frames * align;
        work.copyWithin(0, frames * align, total);
        if (frames) {
            yield samples;
        }
    }
}

export async function* decodeBatches(chunks, sampleRate, options, batchSamples) {
    let kinds = [];
    let index = [];
    let softs = [];
    const demod = createSeattySameDemod({
        ...options,
        sampleRate,
        onBit: (bit, soft, sampleIndex) => {
            kinds.push(bit);
            index.push(sampleIndex);
            softs.push(soft);
        },
        onTone: (sampleIndex) => {
            kinds.push(SEATTY_EVENT_TONE);
            index.push(sampleIndex);
            softs.push(0);
        }
    });
    const take = (done) => {
        const batch = { kinds: Uint8Array.from(kinds), index: Float64Array.from(index), soft: Float32Array.from(softs), done };
        kinds = [];
        index = [];
        softs = [];
        return batch;
    };
    const step = Math.max(1, Math.floor(batchSamples) || sampleRate);
    let pending = 0;
    try {
        for await (const samples of chunks) {
            for (let off = 0; off < samples.length; off += step) {
                const end = Math.min(off + step, samples.length);
                demod.process(samples.subarray(off, end));
                pending += end - off;
                if (pending >= step) {
                    pending = 0;
                    yield take(false);
                }
            }
        }
        demod.flush();
        yield take(true);
    } finally {
        if (typeof demod.free === 'function') {
            demod.free();
        }
    }
}

if (typeof WorkerGlobalScope !== 'undefined' && self instanceof WorkerGlobalScope) {
    const ready = loadSeattyWasm();
    ready.then((wasm) => self.postMessage({ type: 'ready', wasm }));
    const post = (id, batch) => {
        self.postMessage({ type: 'batch', id, ...batch }, [batch.kinds.buffer, batch.index.buffer, batch.soft.buffer]);
    };
    self.onmessage = async (event) => {
        const msg = event.data || {};
        try {
            await ready;
            if (msg.type === 'decode') {
                const samples = new Float32Array(msg.buffer, msg.byteOffset, msg.length);
                for await (const batch of decodeBatches([samples], msg.sampleRate, msg.options, msg.batchSamples)) {
                    post(msg.id, batch);
                }
            } else if (msg.type === 'decodeWav') {
                const layout = await readWavLayout(msg.file);
                if (!layout) {
                    self.postMessage({ type: 'unsupported', id: msg.id });
                    return;
                }
                self.postMessage({ type: 'format', id: msg.id, sampleRate: layout.sampleRate });
                const reader = await openReader();
                const end = layout.dataOffset + layout.dataBytes;
                const slices = reader ? readerSlices(reader, msg.file, layout.dataOffset, end) : null;
                const chunks = wavChannelChunks(msg.file, layout, slices);
                for await (const batch of decodeBatches(chunks, layout.sampleRate, msg.options, layout.sampleRate * 10)) {
                    post(msg.id, batch);
                }
            }
        } catch (err) {
            self.postMessage({ type: 'error', id: msg.id, message: String(err && err.message ? err.message : err) });
        }
    };
}
