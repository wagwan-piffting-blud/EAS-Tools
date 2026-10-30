export function createLimiter({ sampleRate = 44100, lookaheadMs = 5, releaseMs = 150, ceiling = 1 } = {}) {
    const L = Math.max(1, Math.round((sampleRate * lookaheadMs) / 1000));
    const attack = 1 / L;
    const release = 1 / Math.max(1, Math.round((sampleRate * releaseMs) / 1000));
    let gPrev = 1;
    let over = 1;
    return {
        lookahead: 2 * L,
        get over() { return over; },
        process(chans, from, n, gain = 1) {
            if (chans.length === 0) return [];
            const len = chans[0].length;
            const m = Math.max(0, Math.min(len - from, n + 2 * L));
            const t = new Float32Array(m);
            let any = false;
            for (let i = 0; i < m; i++) {
                let peak = 0;
                for (let c = 0; c < chans.length; c++) {
                    const v = Math.abs((chans[c][from + i] || 0) * gain);
                    if (v > peak) peak = v;
                }
                if (peak > ceiling) {
                    t[i] = ceiling / peak;
                    any = true;
                    if (peak / ceiling > over) over = peak / ceiling;
                } else {
                    t[i] = 1;
                }
            }
            const g = new Float32Array(m + 1).fill(1);
            if (any) {
                const dq = new Int32Array(m);
                let head = 0, tail = 0;
                for (let i = m - 1; i >= 0; i--) {
                    while (tail > head && t[dq[tail - 1]] >= t[i]) tail--;
                    dq[tail++] = i;
                    while (dq[head] > i + L) head++;
                    const hold = t[dq[head]];
                    const ramp = g[i + 1] + attack;
                    g[i] = hold < ramp ? hold : (ramp < 1 ? ramp : 1);
                }
            }
            const outLen = Math.min(n, m);
            const out = chans.map(() => new Float32Array(outLen));
            if (!any && gPrev === 1) {
                for (let c = 0; c < chans.length; c++) {
                    const src = chans[c], dst = out[c];
                    if (gain === 1) {
                        for (let i = 0; i < outLen; i++) dst[i] = src[from + i] || 0;
                    } else {
                        for (let i = 0; i < outLen; i++) dst[i] = (src[from + i] || 0) * gain;
                    }
                }
                return out;
            }
            for (let i = 0; i < outLen; i++) {
                const up = gPrev + release;
                const gi = g[i] < up ? g[i] : (up < 1 ? up : 1);
                gPrev = gi;
                for (let c = 0; c < chans.length; c++) {
                    let v = (chans[c][from + i] || 0) * gain;
                    if (gi !== 1) v *= gi;
                    out[c][i] = v > ceiling ? ceiling : (v < -ceiling ? -ceiling : v);
                }
            }
            return out;
        },
    };
}

export function limitAll(chans, sampleRate, gain = 1) {
    const lim = createLimiter({ sampleRate });
    const n = chans.length ? chans[0].length : 0;
    const out = lim.process(chans, 0, n, gain);
    return { chans: out, over: lim.over };
}

export function peakRatio(chans, gain = 1, ceiling = 1) {
    let p = 0;
    for (const c of chans) {
        for (let i = 0; i < c.length; i++) {
            const v = Math.abs(c[i] * gain);
            if (v > p) p = v;
        }
    }
    return Math.max(1, p / ceiling);
}

export const overDb = (ratio) => 20 * Math.log10(Math.max(1, ratio));
