const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        t[n] = c >>> 0;
    }
    return t;
})();

export function crc32Update(crc, bytes) {
    let c = ~crc >>> 0;
    for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
    return ~c >>> 0;
}

const CHUNK = 8 * 1024 * 1024;

export async function crc32Blob(blob, onProgress) {
    let crc = 0;
    for (let pos = 0; pos < blob.size; pos += CHUNK) {
        crc = crc32Update(crc, new Uint8Array(await blob.slice(pos, pos + CHUNK).arrayBuffer()));
        if (onProgress) onProgress(Math.min(blob.size, pos + CHUNK), blob.size);
    }
    return crc;
}

const LIMIT = 0xffffffff;

const dosStamp = (d) => ({
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
    date: ((Math.max(1980, d.getFullYear()) - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
});

export class ZipTooLargeError extends Error {
    constructor() {
        super('The project is larger than 4 GB, which this zip format cannot hold.');
        this.name = 'ZipTooLargeError';
    }
}

export async function buildZip(entries, { onProgress, date = new Date() } = {}) {
    const enc = new TextEncoder();
    const { time, date: day } = dosStamp(date);
    const parts = [];
    const central = [];
    let offset = 0;
    const total = entries.reduce((n, e) => n + e.blob.size, 0);
    let done = 0;
    if (entries.length > 0xffff) throw new ZipTooLargeError();
    for (const e of entries) {
        const name = enc.encode(e.name);
        const crc = await crc32Blob(e.blob, (n) => onProgress && onProgress(done + n, total));
        done += e.blob.size;
        const size = e.blob.size;
        if (size > LIMIT || offset > LIMIT) throw new ZipTooLargeError();
        const local = new DataView(new ArrayBuffer(30));
        local.setUint32(0, 0x04034b50, true);
        local.setUint16(4, 20, true);
        local.setUint16(6, 0x0800, true);
        local.setUint16(8, 0, true);
        local.setUint16(10, time, true);
        local.setUint16(12, day, true);
        local.setUint32(14, crc, true);
        local.setUint32(18, size, true);
        local.setUint32(22, size, true);
        local.setUint16(26, name.length, true);
        local.setUint16(28, 0, true);
        const cen = new DataView(new ArrayBuffer(46));
        cen.setUint32(0, 0x02014b50, true);
        cen.setUint16(4, 20, true);
        cen.setUint16(6, 20, true);
        cen.setUint16(8, 0x0800, true);
        cen.setUint16(10, 0, true);
        cen.setUint16(12, time, true);
        cen.setUint16(14, day, true);
        cen.setUint32(16, crc, true);
        cen.setUint32(20, size, true);
        cen.setUint32(24, size, true);
        cen.setUint16(28, name.length, true);
        cen.setUint32(42, offset, true);
        parts.push(new Uint8Array(local.buffer), name, e.blob);
        central.push(new Uint8Array(cen.buffer), name);
        offset += 30 + name.length + size;
    }
    const cdSize = central.reduce((n, b) => n + b.byteLength, 0);
    if (offset > LIMIT || offset + cdSize > LIMIT) throw new ZipTooLargeError();
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true);
    end.setUint16(8, entries.length, true);
    end.setUint16(10, entries.length, true);
    end.setUint32(12, cdSize, true);
    end.setUint32(16, offset, true);
    return new Blob([...parts, ...central, new Uint8Array(end.buffer)], { type: 'application/zip' });
}

export async function readZip(blob) {
    const tailLen = Math.min(blob.size, 22 + 0xffff);
    const tail = new Uint8Array(await blob.slice(blob.size - tailLen).arrayBuffer());
    const tv = new DataView(tail.buffer);
    let eocd = -1;
    for (let i = tail.length - 22; i >= 0; i--) {
        if (tv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error('This file is not a zip archive.');
    const count = tv.getUint16(eocd + 10, true);
    const cdSize = tv.getUint32(eocd + 12, true);
    const cdOffset = tv.getUint32(eocd + 16, true);
    if (cdOffset + cdSize > blob.size) throw new Error('The zip archive is truncated.');
    const cd = new DataView(await blob.slice(cdOffset, cdOffset + cdSize).arrayBuffer());
    const dec = new TextDecoder();
    const files = new Map();
    let p = 0;
    for (let i = 0; i < count; i++) {
        if (cd.getUint32(p, true) !== 0x02014b50) throw new Error('The zip directory is damaged.');
        const method = cd.getUint16(p + 10, true);
        const crc = cd.getUint32(p + 16, true);
        const csize = cd.getUint32(p + 20, true);
        const size = cd.getUint32(p + 24, true);
        const nlen = cd.getUint16(p + 28, true);
        const xlen = cd.getUint16(p + 30, true);
        const clen = cd.getUint16(p + 32, true);
        const local = cd.getUint32(p + 42, true);
        const name = dec.decode(new Uint8Array(cd.buffer, cd.byteOffset + p + 46, nlen));
        p += 46 + nlen + xlen + clen;
        const lh = new DataView(await blob.slice(local, local + 30).arrayBuffer());
        if (lh.getUint32(0, true) !== 0x04034b50) throw new Error('The zip archive is damaged.');
        const start = local + 30 + lh.getUint16(26, true) + lh.getUint16(28, true);
        files.set(name, { name, method, crc, size, raw: blob.slice(start, start + csize) });
    }
    return files;
}

export async function entryBlob(entry) {
    if (entry.method === 0) return entry.raw;
    if (entry.method === 8 && typeof DecompressionStream === 'function') {
        return new Response(entry.raw.stream().pipeThrough(new DecompressionStream('deflate-raw'))).blob();
    }
    throw new Error(`"${entry.name}" uses a zip compression method this browser cannot read.`);
}
