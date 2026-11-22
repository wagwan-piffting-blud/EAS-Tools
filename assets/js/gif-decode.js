export class GifError extends Error {
    constructor(message) {
        super(message);
        this.name = 'GifError';
    }
}

const MIN_DELAY_MS = 20;
const DEFAULT_DELAY_MS = 100;

function skipSubBlocks(data, p) {
    while (p < data.length) {
        const size = data[p++];
        if (!size) {
            break;
        }
        p += size;
    }
    return p;
}

function u16(data, p) {
    return data[p] | (data[p + 1] << 8);
}

export function parseGif(bytes) {
    const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    const signature = String.fromCharCode(...data.subarray(0, 6));
    if (signature !== 'GIF87a' && signature !== 'GIF89a') {
        throw new GifError('This is not a GIF file.');
    }
    if (data.length < 13) {
        throw new GifError('This GIF file is cut short.');
    }
    const width = u16(data, 6);
    const height = u16(data, 8);
    const packed = data[10];
    let p = 13;
    let globalPalette = null;
    if (packed & 0x80) {
        const size = 3 * (1 << ((packed & 7) + 1));
        globalPalette = data.subarray(p, p + size);
        p += size;
    }
    const frames = [];
    let control = null;
    while (p < data.length) {
        const block = data[p++];
        if (block === 0x3b) {
            break;
        }
        if (block === 0x21) {
            const label = data[p++];
            if (label === 0xf9 && data[p] >= 4) {
                const flags = data[p + 1];
                control = {
                    disposal: (flags >> 2) & 7,
                    transparent: flags & 1 ? data[p + 4] : -1,
                    delay: u16(data, p + 2) * 10,
                };
            }
            p = skipSubBlocks(data, p);
            continue;
        }
        if (block !== 0x2c || p + 9 > data.length) {
            break;
        }
        const flags = data[p + 8];
        const frame = {
            left: u16(data, p),
            top: u16(data, p + 2),
            width: u16(data, p + 4),
            height: u16(data, p + 6),
            interlaced: !!(flags & 0x40),
            palette: globalPalette,
            disposal: control ? control.disposal : 0,
            transparent: control ? control.transparent : -1,
            delay: control ? control.delay : 0,
        };
        p += 9;
        if (flags & 0x80) {
            const size = 3 * (1 << ((flags & 7) + 1));
            frame.palette = data.subarray(p, p + size);
            p += size;
        }
        frame.minCodeSize = data[p++];
        frame.dataStart = p;
        p = skipSubBlocks(data, p);
        frame.dataEnd = p;
        frames.push(frame);
        control = null;
    }
    if (!frames.length || !width || !height) {
        throw new GifError('This GIF has no frames.');
    }
    return { width, height, frames, data };
}

export function lzwDecode(data, start, end, minCodeSize, pixelCount) {
    const out = new Uint8Array(pixelCount);
    if (minCodeSize < 1 || minCodeSize > 11) {
        return out;
    }
    const clear = 1 << minCodeSize;
    const eoi = clear + 1;
    const prefix = new Uint16Array(4096);
    const suffix = new Uint8Array(4096);
    const stack = new Uint8Array(4097);
    for (let i = 0; i < clear; i++) {
        suffix[i] = i;
    }
    let codeSize = minCodeSize + 1;
    let next = eoi + 1;
    let old = -1;
    let first = 0;
    let datum = 0;
    let bits = 0;
    let outPos = 0;
    let p = start;
    let left = 0;
    while (outPos < pixelCount) {
        while (bits < codeSize) {
            if (!left) {
                if (p >= end) {
                    return out;
                }
                left = data[p++];
                if (!left) {
                    return out;
                }
            }
            datum |= data[p++] << bits;
            bits += 8;
            left--;
        }
        let code = datum & ((1 << codeSize) - 1);
        datum >>>= codeSize;
        bits -= codeSize;
        if (code === clear) {
            codeSize = minCodeSize + 1;
            next = eoi + 1;
            old = -1;
            continue;
        }
        if (code === eoi) {
            break;
        }
        if (old === -1) {
            if (code >= clear) {
                break;
            }
            out[outPos++] = code;
            old = code;
            first = code;
            continue;
        }
        const incoming = code;
        let sp = 0;
        if (code >= next) {
            stack[sp++] = first;
            code = old;
        }
        while (code >= clear) {
            stack[sp++] = suffix[code];
            code = prefix[code];
        }
        first = suffix[code];
        stack[sp++] = first;
        while (sp && outPos < pixelCount) {
            out[outPos++] = stack[--sp];
        }
        if (next < 4096) {
            prefix[next] = old;
            suffix[next] = first;
            next++;
            if (next === (1 << codeSize) && codeSize < 12) {
                codeSize++;
            }
        }
        old = incoming;
    }
    return out;
}

export function interlacedRows(height) {
    const rows = [];
    for (const [startRow, step] of [[0, 8], [4, 8], [2, 4], [1, 2]]) {
        for (let y = startRow; y < height; y += step) {
            rows.push(y);
        }
    }
    return rows;
}

export function frameDelay(delay) {
    return delay >= MIN_DELAY_MS ? delay : DEFAULT_DELAY_MS;
}

export function gifDuration(gif) {
    return gif.frames.reduce((total, frame) => total + frameDelay(frame.delay), 0);
}

export function* gifFrames(gif) {
    const { width, height } = gif;
    const canvas = new Uint8ClampedArray(width * height * 4);
    for (const frame of gif.frames) {
        const saved = frame.disposal === 3 ? canvas.slice() : null;
        const indices = lzwDecode(gif.data, frame.dataStart, frame.dataEnd, frame.minCodeSize, frame.width * frame.height);
        const rows = frame.interlaced ? interlacedRows(frame.height) : null;
        const palette = frame.palette;
        for (let y = 0; y < frame.height; y++) {
            const dy = frame.top + (rows ? rows[y] : y);
            if (dy >= height) {
                continue;
            }
            for (let x = 0; x < frame.width; x++) {
                const dx = frame.left + x;
                const index = indices[y * frame.width + x];
                if (dx >= width || index === frame.transparent || !palette || index * 3 + 2 >= palette.length) {
                    continue;
                }
                const o = (dy * width + dx) * 4;
                canvas[o] = palette[index * 3];
                canvas[o + 1] = palette[index * 3 + 1];
                canvas[o + 2] = palette[index * 3 + 2];
                canvas[o + 3] = 255;
            }
        }
        yield { rgba: canvas, width, height, delay: frameDelay(frame.delay) };
        if (frame.disposal === 2) {
            for (let y = frame.top; y < Math.min(height, frame.top + frame.height); y++) {
                const from = (y * width + frame.left) * 4;
                canvas.fill(0, from, from + Math.max(0, Math.min(frame.width, width - frame.left)) * 4);
            }
        } else if (saved) {
            canvas.set(saved);
        }
    }
}
