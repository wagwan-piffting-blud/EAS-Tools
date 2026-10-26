const BUCKET = 256;
const cache = new WeakMap();

export function getPeaks(pcm) {
    let pk = cache.get(pcm);
    if (pk) return pk;
    const n = Math.ceil(pcm.length / BUCKET);
    const min = new Float32Array(n), max = new Float32Array(n);
    for (let b = 0; b < n; b++) {
        let lo = 1e9, hi = -1e9;
        const e = Math.min(pcm.length, (b + 1) * BUCKET);
        for (let i = b * BUCKET; i < e; i++) {
            const v = pcm[i];
            if (v < lo) lo = v;
            if (v > hi) hi = v;
        }
        min[b] = lo;
        max[b] = hi;
    }
    pk = { min, max };
    cache.set(pcm, pk);
    return pk;
}

export function columnRange(pcm, s0, s1) {
    s0 = Math.max(0, Math.floor(s0));
    s1 = Math.min(pcm.length, Math.ceil(s1));
    if (s1 <= s0) return null;
    let lo = 1e9, hi = -1e9;
    if (s1 - s0 < BUCKET * 4) {
        for (let i = s0; i < s1; i++) {
            const v = pcm[i];
            if (v < lo) lo = v;
            if (v > hi) hi = v;
        }
    } else {
        const pk = getPeaks(pcm);
        const b0 = Math.floor(s0 / BUCKET), b1 = Math.ceil(s1 / BUCKET);
        for (let b = b0; b < b1; b++) {
            if (pk.min[b] < lo) lo = pk.min[b];
            if (pk.max[b] > hi) hi = pk.max[b];
        }
    }
    return lo > hi ? null : [lo, hi];
}

function bucketRange(src, s0, s1) {
    const pk = src.peaks, bucket = src.bucket;
    const n = pk.length >> 1;
    const b0 = Math.max(0, Math.floor(s0 / bucket));
    const b1 = Math.min(n, Math.ceil(Math.min(s1, src.length) / bucket));
    if (b1 <= b0) return null;
    let lo = 1e9, hi = -1e9;
    for (let b = b0; b < b1; b++) {
        if (pk[b * 2] < lo) lo = pk[b * 2];
        if (pk[b * 2 + 1] > hi) hi = pk[b * 2 + 1];
    }
    return lo > hi ? null : [lo, hi];
}

export function drawPeaks(ctx, pcm, opts) {
    const { x0, x1, srcStart, samplesPerPx, top, height, gain = 1, color } = opts;
    const mid = top + height / 2;
    const half = height / 2 - 1;
    const range = pcm && pcm.peaks ? bucketRange : columnRange;
    ctx.fillStyle = color;
    for (let x = Math.floor(x0); x < Math.ceil(x1); x++) {
        const s0 = srcStart + (x - x0) * samplesPerPx;
        const r = range(pcm, s0, s0 + Math.max(1, samplesPerPx));
        if (!r) continue;
        let lo = Math.max(-1, r[0] * gain), hi = Math.min(1, r[1] * gain);
        const y1 = mid - hi * half, y2 = mid - lo * half;
        ctx.fillRect(x, y1, 1, Math.max(1, y2 - y1));
    }
}
