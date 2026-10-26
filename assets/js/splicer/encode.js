import * as SW from './wav.js';

export const FORMATS = {
    pcm16: { kind: 'wav', name: 'WAV', label: 'WAV 16-bit', ext: 'wav', mime: 'audio/wav' },
    pcm24: { kind: 'wav', name: 'WAV', label: 'WAV 24-bit', ext: 'wav', mime: 'audio/wav' },
    float32: { kind: 'wav', name: 'WAV', label: 'WAV 32-bit float', ext: 'wav', mime: 'audio/wav' },
    flac16: { kind: 'mb', codec: 'flac', bits: 16, name: 'FLAC', label: 'FLAC 16-bit', ext: 'flac', mime: 'audio/flac' },
    flac24: { kind: 'mb', codec: 'flac', bits: 24, name: 'FLAC', label: 'FLAC 24-bit', ext: 'flac', mime: 'audio/flac' },
    mp3: { kind: 'mb', codec: 'mp3', name: 'MP3', label: 'MP3', ext: 'mp3', mime: 'audio/mpeg', bitrates: [96, 128, 160, 192, 256, 320], bitrate: 192 },
    opus: { kind: 'mb', codec: 'opus', name: 'Opus', label: 'Opus', ext: 'opus', mime: 'audio/ogg', bitrates: [64, 96, 128, 160, 192, 256], bitrate: 128 },
};

export const formatOf = (f) => (FORMATS[f] ? f : 'pcm16');
export const infoOf = (f) => FORMATS[formatOf(f)];
export const isWav = (f) => infoOf(f).kind === 'wav';
export const isLossy = (f) => !!infoOf(f).bitrates;
export const wavFormatOf = (f) => (isWav(f) ? formatOf(f) : (formatOf(f) === 'flac24' ? 'pcm24' : 'pcm16'));

export const bitrateOf = (f, kbps) => {
    const info = infoOf(f);
    if (!info.bitrates) return 0;
    const k = Number(kbps);
    return info.bitrates.includes(k) ? k : info.bitrate;
};

let mbLoad = null;
const loadMb = () => mbLoad || (mbLoad = import('../mediabunny/mediabunny.min.js'));
const EXTENSIONS = {
    mp3: ['../mediabunny/mp3-encoder.min.js', 'registerMp3Encoder'],
    flac: ['../mediabunny/flac-encoder.min.js', 'registerFlacEncoder'],
};
const registered = new Set();

async function ensureCodec(mb, codec, cfg) {
    if (await mb.canEncodeAudio(codec, cfg)) return true;
    const ext = EXTENSIONS[codec];
    if (!ext || registered.has(codec)) return false;
    registered.add(codec);
    const mod = await import(ext[0]);
    mod[ext[1]]();
    return mb.canEncodeAudio(codec, cfg);
}

export async function canEncode(f) {
    const info = infoOf(f);
    if (info.kind === 'wav') return true;
    if (EXTENSIONS[info.codec]) return typeof WebAssembly === 'object' && typeof Worker === 'function';
    if (typeof AudioEncoder !== 'function') return false;
    try {
        const r = await AudioEncoder.isConfigSupported({ codec: info.codec, sampleRate: 48000, numberOfChannels: 2, bitrate: info.bitrate * 1000 });
        return !!r.supported;
    } catch (_) {
        return false;
    }
}

function toSample(mb, info, chans, from, n, gain, sampleRate, at) {
    const nc = chans.length;
    const scaled = gain !== 1;
    if (info.codec === 'flac') {
        const wide = info.bits === 24;
        const data = wide ? new Int32Array(n * nc) : new Int16Array(n * nc);
        let o = 0;
        for (let i = 0; i < n; i++) {
            for (let ch = 0; ch < nc; ch++) {
                let s = chans[ch][from + i];
                if (scaled) s *= gain;
                if (s > 1) s = 1;
                else if (s < -1) s = -1;
                if (wide) data[o++] = (Math.trunc(s < 0 ? s * 0x800000 : s * 0x7fffff) || 0) * 256;
                else data[o++] = s < 0 ? s * 0x8000 : s * 0x7fff;
            }
        }
        return new mb.AudioSample({ data, format: wide ? 's32' : 's16', numberOfChannels: nc, sampleRate, timestamp: at / sampleRate });
    }
    const data = new Float32Array(n * nc);
    for (let ch = 0; ch < nc; ch++) {
        const src = chans[ch];
        const base = ch * n;
        for (let i = 0; i < n; i++) {
            let s = src[from + i];
            if (scaled) s *= gain;
            data[base + i] = s > 1 ? 1 : (s < -1 ? -1 : s);
        }
    }
    return new mb.AudioSample({ data, format: 'f32-planar', numberOfChannels: nc, sampleRate, timestamp: at / sampleRate });
}

export async function createWriter(f, { sampleRate, channels, frames, bitrate, sink = null }) {
    const key = formatOf(f);
    const info = FORMATS[key];
    if (info.kind === 'wav') {
        const parts = [];
        const put = sink ? (b) => sink.write(b) : async (b) => { parts.push(b); };
        await put(SW.wavHeader(frames, sampleRate, channels, key));
        return {
            write: (chans, from, n, gain = 1) => put(SW.encodeFrames(chans, from, n, key, gain)),
            finish: async () => {
                if (sink) {
                    await sink.close();
                    return null;
                }
                return new Blob(parts, { type: info.mime });
            },
            cancel: async () => {},
        };
    }
    const mb = await loadMb();
    const kbps = bitrateOf(key, bitrate);
    const cfg = { numberOfChannels: channels, sampleRate, ...(kbps ? { bitrate: kbps * 1000 } : {}) };
    if (!(await ensureCodec(mb, info.codec, cfg))) {
        throw new Error(`This browser cannot encode ${info.name} (${channels === 2 ? 'stereo' : 'mono'}, ${sampleRate} Hz).`);
    }
    const target = sink ? new mb.StreamTarget(sink, { chunked: true }) : new mb.BufferTarget();
    const format = info.codec === 'mp3' ? new mb.Mp3OutputFormat() : (info.codec === 'flac' ? new mb.FlacOutputFormat() : new mb.OggOutputFormat());
    const output = new mb.Output({ format, target });
    const src = new mb.AudioSampleSource({ codec: info.codec, ...(kbps ? { bitrate: kbps * 1000 } : {}) });
    output.addAudioTrack(src);
    await output.start();
    let at = 0;
    return {
        write: async (chans, from, n, gain = 1) => {
            if (!n) return;
            const sample = toSample(mb, info, chans, from, n, gain, sampleRate, at);
            at += n;
            try {
                await src.add(sample);
            } finally {
                sample.close();
            }
        },
        finish: async () => {
            src.close();
            await output.finalize();
            return sink ? null : new Blob([target.buffer], { type: info.mime });
        },
        cancel: async () => {
            try { await output.cancel(); } catch (_) {}
        },
    };
}

export async function encodeAll(chans, sampleRate, f, { gain = 1, bitrate = 0, block = 1 << 16, resample = null } = {}) {
    const key = formatOf(f);
    if (isWav(key)) return SW.encodeWav(chans, sampleRate, key, gain);
    let w;
    try {
        w = await createWriter(key, { sampleRate, channels: chans.length, frames: chans.length ? chans[0].length : 0, bitrate });
    } catch (e) {
        if (!resample || sampleRate === 44100) throw e;
        const first = resample(chans[0], sampleRate, 44100);
        chans = chans.map((c, i) => (i === 0 || c === chans[0] ? first : resample(c, sampleRate, 44100)));
        sampleRate = 44100;
        w = await createWriter(key, { sampleRate, channels: chans.length, frames: chans[0].length, bitrate });
    }
    const n = chans.length ? chans[0].length : 0;
    try {
        for (let i = 0; i < n; i += block) await w.write(chans, i, Math.min(block, n - i), gain);
        return await w.finish();
    } catch (e) {
        await w.cancel();
        throw e;
    }
}
