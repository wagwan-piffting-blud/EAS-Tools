export const FORMATS = {
    pcm16: { bits: 16, tag: 1, label: 'WAV 16-bit' },
    pcm24: { bits: 24, tag: 1, label: 'WAV 24-bit' },
    float32: { bits: 32, tag: 3, label: 'WAV 32-bit float' },
};

export const formatOf = (f) => (FORMATS[f] ? f : 'pcm16');

export function wavHeader(frames, sampleRate, channels = 1, format = 'pcm16') {
    const f = FORMATS[formatOf(format)];
    const bytes = f.bits >> 3;
    const block = bytes * channels;
    const dataBytes = frames * block;
    const isFloat = f.tag === 3;
    const size = isFloat ? 58 : 44;
    const buf = new ArrayBuffer(size);
    const v = new DataView(buf);
    const ws = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
    ws(0, 'RIFF');
    v.setUint32(4, size - 8 + dataBytes, true);
    ws(8, 'WAVE');
    ws(12, 'fmt ');
    v.setUint32(16, isFloat ? 18 : 16, true);
    v.setUint16(20, f.tag, true);
    v.setUint16(22, channels, true);
    v.setUint32(24, sampleRate, true);
    v.setUint32(28, sampleRate * block, true);
    v.setUint16(32, block, true);
    v.setUint16(34, f.bits, true);
    let o = 36;
    if (isFloat) {
        v.setUint16(36, 0, true);
        ws(38, 'fact');
        v.setUint32(42, 4, true);
        v.setUint32(46, frames, true);
        o = 50;
    }
    ws(o, 'data');
    v.setUint32(o + 4, dataBytes, true);
    return new Uint8Array(buf);
}

export function encodeFrames(chans, from, n, format = 'pcm16', gain = 1) {
    const f = FORMATS[formatOf(format)];
    const nc = chans.length;
    const bytes = f.bits >> 3;
    const out = new ArrayBuffer(n * nc * bytes);
    const v = new DataView(out);
    const scaled = gain !== 1;
    let o = 0;
    for (let i = 0; i < n; i++) {
        for (let ch = 0; ch < nc; ch++) {
            let s = chans[ch][from + i];
            if (scaled) s *= gain;
            if (f.tag === 3) {
                v.setFloat32(o, s, true);
                o += 4;
                continue;
            }
            if (s > 1) s = 1;
            else if (s < -1) s = -1;
            if (f.bits === 16) {
                v.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true);
                o += 2;
            } else {
                const x = Math.trunc(s < 0 ? s * 0x800000 : s * 0x7fffff) || 0;
                v.setUint8(o, x & 0xff);
                v.setUint8(o + 1, (x >> 8) & 0xff);
                v.setUint8(o + 2, (x >> 16) & 0xff);
                o += 3;
            }
        }
    }
    return new Uint8Array(out);
}

export function encodeWav(chans, sampleRate, format = 'pcm16', gain = 1) {
    const n = chans.length ? chans[0].length : 0;
    return new Blob([wavHeader(n, sampleRate, chans.length, format), encodeFrames(chans, 0, n, format, gain)], { type: 'audio/wav' });
}
