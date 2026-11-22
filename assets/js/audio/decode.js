const HEADER_WINDOW = 65536;
const CHUNK_FRAMES = 1 << 20;

export class AudioDecodeError extends Error {
    constructor(message, code = 'undecodable') {
        super(message);
        this.name = 'AudioDecodeError';
        this.code = code;
    }
}

function fourcc(view, at) {
    return String.fromCharCode(view.getUint8(at), view.getUint8(at + 1), view.getUint8(at + 2), view.getUint8(at + 3));
}

function parseFmt(view, size) {
    let format = view.getUint16(0, true);
    const channels = view.getUint16(2, true);
    const sampleRate = view.getUint32(4, true);
    const blockAlign = view.getUint16(12, true);
    const bits = view.getUint16(14, true);
    if (format === 0xfffe && size >= 26 && view.byteLength >= 26) {
        format = view.getUint16(24, true);
    }
    const float = format === 3;
    if (format !== 1 && !float) {
        return null;
    }
    const bitsOk = float ? (bits === 32 || bits === 64) : (bits === 8 || bits === 16 || bits === 24 || bits === 32);
    if (!bitsOk || channels < 1 || sampleRate < 1 || blockAlign !== channels * bits / 8) {
        return null;
    }
    return { sampleRate, channels, bits, float, blockAlign };
}

export async function readWavInfo(blob) {
    if (!blob || typeof blob.slice !== 'function' || blob.size < 12) {
        return null;
    }
    let windowStart = 0;
    let bytes = new Uint8Array(0);
    const at = async (pos, len) => {
        if (pos + len > blob.size) {
            return null;
        }
        if (pos < windowStart || pos + len > windowStart + bytes.length) {
            windowStart = pos;
            bytes = new Uint8Array(await blob.slice(pos, Math.min(blob.size, pos + Math.max(len, HEADER_WINDOW))).arrayBuffer());
        }
        return new DataView(bytes.buffer, bytes.byteOffset + pos - windowStart, len);
    };
    const riff = await at(0, 12);
    const tag = fourcc(riff, 0);
    if ((tag !== 'RIFF' && tag !== 'RF64') || fourcc(riff, 8) !== 'WAVE') {
        return null;
    }
    let fmt = null;
    let rf64Data = -1;
    let pos = 12;
    while (pos + 8 <= blob.size) {
        const head = await at(pos, 8);
        const id = fourcc(head, 0);
        const size = head.getUint32(4, true);
        const body = pos + 8;
        if (id === 'ds64') {
            const view = await at(body, 16);
            if (!view) {
                return null;
            }
            rf64Data = view.getUint32(8, true) + view.getUint32(12, true) * 4294967296;
        } else if (id === 'fmt ') {
            const view = size >= 16 ? await at(body, Math.min(size, 40)) : null;
            if (!view) {
                return null;
            }
            fmt = parseFmt(view, size);
        } else if (id === 'data') {
            if (!fmt) {
                return null;
            }
            let dataBytes = (tag === 'RF64' && size === 0xffffffff && rf64Data >= 0) ? rf64Data : size;
            if (dataBytes === 0 || body + dataBytes > blob.size) {
                dataBytes = blob.size - body;
            }
            const frames = Math.floor(dataBytes / fmt.blockAlign);
            return { ...fmt, dataOffset: body, frames, dataBytes: frames * fmt.blockAlign };
        }
        pos = body + size + (size & 1);
    }
    return null;
}

function sampleReader(info) {
    if (info.float) {
        return info.bits === 32 ? (dv, p) => dv.getFloat32(p, true) : (dv, p) => dv.getFloat64(p, true);
    }
    switch (info.bits) {
        case 16:
            return (dv, p) => dv.getInt16(p, true) / 32768;
        case 24:
            return (dv, p) => (((dv.getUint8(p) | (dv.getUint8(p + 1) << 8) | (dv.getUint8(p + 2) << 16)) << 8) >> 8) / 8388608;
        case 32:
            return (dv, p) => dv.getInt32(p, true) / 2147483648;
        default:
            return (dv, p) => (dv.getUint8(p) - 128) / 128;
    }
}

export function convertWavFrames(bytes, info, frames, outs, at = 0, mode = 0) {
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const read = sampleReader(info);
    const width = info.bits >> 3;
    const align = info.blockAlign;
    const nc = info.channels;
    if (mode === 'all') {
        for (let i = 0, p = 0; i < frames; i++, p += align) {
            for (let c = 0, q = p; c < nc; c++, q += width) {
                outs[c][at + i] = read(dv, q);
            }
        }
        return;
    }
    const out = outs[0];
    if (mode === 'mix' && nc > 1) {
        for (let i = 0, p = 0; i < frames; i++, p += align) {
            let sum = 0;
            for (let c = 0, q = p; c < nc; c++, q += width) {
                sum += read(dv, q);
            }
            out[at + i] = sum / nc;
        }
        return;
    }
    const channel = mode === 'mix' ? 0 : Math.max(0, Math.min(Number(mode) || 0, nc - 1));
    for (let i = 0, p = channel * width; i < frames; i++, p += align) {
        out[at + i] = read(dv, p);
    }
}

export async function readWavChannels(blob, info, { mode = 0, maxFrames = Infinity, yieldEvery = null } = {}) {
    if (info.frames > maxFrames) {
        throw new AudioDecodeError('This file is too large to load on this device.', 'too-large');
    }
    const outs = Array.from({ length: mode === 'all' ? info.channels : 1 }, () => new Float32Array(info.frames));
    for (let at = 0; at < info.frames; at += CHUNK_FRAMES) {
        const frames = Math.min(CHUNK_FRAMES, info.frames - at);
        const start = info.dataOffset + at * info.blockAlign;
        const bytes = new Uint8Array(await blob.slice(start, start + frames * info.blockAlign).arrayBuffer());
        convertWavFrames(bytes, info, frames, outs, at, mode);
        if (yieldEvery) {
            await yieldEvery();
        }
    }
    return outs;
}

export function pickChannels(list, mode = 0) {
    if (!list.length) {
        return [new Float32Array(0)];
    }
    if (mode === 'all') {
        return list.map((channel) => new Float32Array(channel));
    }
    if (mode === 'mix' && list.length > 1) {
        const out = new Float32Array(list[0].length);
        for (const channel of list) {
            for (let i = 0; i < out.length; i++) {
                out[i] += channel[i] || 0;
            }
        }
        for (let i = 0; i < out.length; i++) {
            out[i] /= list.length;
        }
        return [out];
    }
    const channel = mode === 'mix' ? 0 : Math.max(0, Math.min(Number(mode) || 0, list.length - 1));
    return [new Float32Array(list[channel])];
}

function bufferChannels(audioBuffer, mode) {
    return pickChannels(Array.from({ length: audioBuffer.numberOfChannels }, (_, c) => audioBuffer.getChannelData(c)), mode);
}

let mbLoad = null;
const loadMb = () => mbLoad || (mbLoad = import('../mediabunny/mediabunny.min.js'));

export async function decodeWithMediabunny(blob, mode = 0) {
    const mb = await loadMb();
    const input = new mb.Input({ source: new mb.BlobSource(blob), formats: mb.ALL_FORMATS });
    try {
        const track = await input.getPrimaryAudioTrack();
        if (!track || !(await track.canDecode())) {
            return null;
        }
        const parts = [];
        let frames = 0;
        let sampleRate = 0;
        for await (const sample of new mb.AudioSampleSink(track).samples()) {
            try {
                const planes = [];
                for (let c = 0; c < sample.numberOfChannels; c++) {
                    const plane = new Float32Array(sample.numberOfFrames);
                    sample.copyTo(plane, { planeIndex: c, format: 'f32-planar' });
                    planes.push(plane);
                }
                parts.push(mode === 'all' ? planes : pickChannels(planes, mode));
                frames += sample.numberOfFrames;
                sampleRate = sample.sampleRate;
            } finally {
                sample.close();
            }
        }
        if (!frames) {
            return null;
        }
        const width = Math.max(...parts.map((planes) => planes.length));
        const channels = Array.from({ length: width }, () => new Float32Array(frames));
        let at = 0;
        for (const planes of parts) {
            channels.forEach((channel, c) => channel.set(planes[Math.min(c, planes.length - 1)], at));
            at += planes[0].length;
        }
        return { sampleRate, channels };
    } finally {
        if (typeof input.dispose === 'function') {
            input.dispose();
        }
    }
}

export async function decodeAudioBlob(blob, { context = null, mode = 0, maxWavFrames = Infinity, maxDecodeBytes = Infinity, yieldEvery = null } = {}) {
    const wav = await readWavInfo(blob);
    if (wav) {
        const channels = await readWavChannels(blob, wav, { mode, maxFrames: maxWavFrames, yieldEvery });
        return { sampleRate: wav.sampleRate, channels, source: 'wav' };
    }
    if (blob.size > maxDecodeBytes) {
        throw new AudioDecodeError('This file is too large to decode in memory on this device.', 'too-large');
    }
    if (context) {
        const decoded = await blob.arrayBuffer()
            .then((buffer) => context.decodeAudioData(buffer))
            .catch(() => null);
        if (decoded && decoded.length) {
            return { sampleRate: decoded.sampleRate, channels: bufferChannels(decoded, mode), source: 'browser' };
        }
    }
    const contained = await decodeWithMediabunny(blob, mode).catch(() => null);
    if (contained) {
        return { ...contained, source: 'container' };
    }
    throw new AudioDecodeError('Could not find audio this browser can decode in this file.');
}
