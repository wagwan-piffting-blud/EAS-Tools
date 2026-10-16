(function (global) {
    'use strict';

    const f = Math.fround;
    const U32MAX = 4294967295;
    const f32buf = new Float32Array(1);
    const u32buf = new Uint32Array(f32buf.buffer);

    function floatBits(x) {
        f32buf[0] = x;
        return u32buf[0];
    }

    function frexpfExp(x) {
        const b = floatBits(x);
        const e = (b >>> 23) & 0xff;
        if (e === 0) {
            const m = b & 0x7fffff;
            if (m === 0) return 0;
            return -125 - Math.clz32(m) + 8;
        }
        if (e === 0xff) return 0;
        return e - 126;
    }

    function crtRand() {
        let hold = 1;
        return () => {
            hold = (Math.imul(hold, 214013) + 2531011) | 0;
            return (hold >>> 16) & 0x7fff;
        };
    }

    function awSeed(rand) {
        let v = 1;
        while (v < 16386) v = Math.imul(rand(), U32MAX) >>> 0;
        return v;
    }

    function xorshift(x) {
        x ^= x << 13; x >>>= 0;
        x ^= x >>> 17;
        x ^= x << 5; x >>>= 0;
        return x;
    }

    function awDither(sample, fpd) {
        const expon = frexpfExp(f(sample));
        return sample + ((fpd - 2147483647) * 5.5e-36 * Math.pow(2, expon + 62));
    }

    function mdaFilterFreqDbg(hz, sr) {
        const r = f(0.999);
        const j = f(r * r - 1);
        const t2 = 2 * r * r;
        const u = f(f(0.647) * hz);
        const k = f(2.0 - Math.cos(u / sr) * t2);
        return f((Math.sqrt(k * k - 4 * j * j) - k) / (2 * j));
    }

    function mdaFilterFreqOpt(hz, sr) {
        const u = f(hz * f(0.647));
        const k = f(2.0 - Math.cos(u / sr) * 1.9960020780563354);
        return f((Math.sqrt(k * k - f(1.5983379853423685e-05)) - k) / -0.003997921943664551);
    }

    function mdaCombo(sr) {
        const p = [0, 0.5, 0.5, 0.5, 0.4].map(f);
        let trim = f(0.5), lpf = 0, hpf = 0, mix1 = 0, mix2 = 0, del1 = 0, del2 = 0;
        let ster = 0, mode = 0, drive = 1, clip = 0, bias = 0;
        const buffer = new Float32Array(1024), buffe2 = new Float32Array(1024);
        let bufpos = 0;
        let ff1 = 0, ff2 = 0, ff3 = 0, ff4 = 0, ff5 = 0, ff6 = 0, ff7 = 0, ff8 = 0, ff9 = 0, ff10 = 0;
        let rate = 44100;
        const MODELS = [
            [0.5, 0, 0, 0, 0, 0],
            [0.53, 2700, 0, 0, 0, 0],
            [1.10, 1685, -1.70, 0.82, 6546, 4315],
            [0.98, 1385, -0.53, 0.21, 7345, 1193],
            [0.96, 1685, -0.85, 0.41, 6546, 3315],
            [0.59, 2795, -0.29, 0.38, 982, 2402],
            [0.30, 1744, -0.96, 1.6, 356, 1263],
        ];
        function calc() {
            ster = p[4] > 0.5 ? 1 : 0;
            hpf = mdaFilterFreqDbg(25, rate);
            const m = MODELS[Math.trunc(p[0] * 6.9)];
            if (m) {
                trim = f(m[0]);
                lpf = m[1] ? mdaFilterFreqDbg(m[1], rate) : 0;
                mix1 = f(m[2]); mix2 = f(m[3]);
                del1 = m[4] ? Math.trunc(rate / f(m[4])) : 0;
                del2 = m[5] ? Math.trunc(rate / f(m[5])) : 0;
            }
            mode = p[1] < 0.5 ? 1 : 0;
            if (!mode) {
                drive = 1;
                clip = f(f(11.7) - f(16) * p[1]);
                if (p[1] > 0.7) {
                    drive = f(Math.pow(10, f(7) * p[1] - f(4.9)));
                    clip = 0.5;
                }
            } else {
                drive = f(Math.pow(10, f(2) - f(6) * p[1]));
                const t = f(Math.pow(p[1], 4));
                trim = f((t * 150 + f(0.55)) * trim);
            }
            bias = f(f(1.2) * p[2] - f(0.6));
            if (p[1] > 0.5) bias = f(bias / ((p[1] - 0.5) * 3 + 1));
            else bias = f(bias / ((0.5 - p[1]) * 3 + 1));
            const g = f(Math.pow(10, 2 * p[3] - 1));
            trim = f(g * trim);
            if (ster) trim = f(trim * 2);
        }
        calc();
        return {
            names: ['Model', 'Drive', 'Bias', 'Output', 'Process'],
            setRate(r) { rate = f(r); },
            set(i, v) { if (i >= 0 && i < 5) { p[i] = f(v); calc(); } },
            process(inp, out, n) {
                const m1 = mix1, m2 = mix2, clp = clip, o = lpf, o2 = hpf, bi = bias, drv = drive;
                const i = f(1 - lpf), i2 = f(1 - hpf);
                const trm = f(trim * i * i * i * i);
                const d1 = del1, d2 = del2;
                let f1 = ff1, f2 = ff2, f3 = ff3, f4 = ff4, f5 = ff5;
                let f6 = ff6, f7 = ff7, f8 = ff8, f9 = ff9, f10 = ff10;
                let bp = bufpos;
                if (ster) {
                    for (let s = 0; s < n; s++) {
                        let l = f((inp[s] + bi) * drv), r = f((0 + bi) * drv);
                        if (!mode) {
                            let t = l > clp ? clp : l; l = -clp <= l ? t : f(-clp);
                            t = r > clp ? clp : r; r = -clp <= r ? t : f(-clp);
                        } else {
                            l = f(l / (Math.abs(l) + 1));
                            r = f(r / (Math.abs(r) + 1));
                        }
                        buffer[bp] = l; buffe2[bp] = r;
                        l = f((m1 * buffer[(bp + d1) % 1000] + m2 * buffer[(bp + d2) % 1000]) + l);
                        r = f((m1 * buffe2[(bp + d1) % 1000] + m2 * buffe2[(bp + d2) % 1000]) + r);
                        f1 = f(o * f1 + trm * l); f6 = f(o * f6 + trm * r);
                        f2 = f(o * f2 + f1); f7 = f(o * f7 + f6);
                        f3 = f(o * f3 + f2); f8 = f(o * f8 + f7);
                        f4 = f(o * f4 + f3); f9 = f(o * f9 + f8);
                        f5 = f(o2 * f5 + i2 * f4); f10 = f(o2 * f10 + i2 * f9);
                        out[s] = f(f4 - f5);
                    }
                } else {
                    for (let s = 0; s < n; s++) {
                        const a = f((inp[s] + 0 + bi) * drv);
                        let b;
                        if (!mode) {
                            const t = a > clp ? clp : a;
                            b = -clp <= a ? t : f(-clp);
                        } else {
                            b = f(a / (1 + Math.abs(a)));
                        }
                        buffer[bp] = b;
                        b = f((m1 * buffer[(bp + d1) % 1000] + m2 * buffer[(bp + d2) % 1000]) + b);
                        f1 = f(o * f1 + trm * b);
                        f2 = f(o * f2 + f1);
                        f3 = f(o * f3 + f2);
                        f4 = f(o * f4 + f3);
                        f5 = f(o2 * f5 + i2 * f4);
                        out[s] = f(f4 - f5);
                        bp = bp === 0 ? 999 : bp - 1;
                    }
                }
                bufpos = bp;
                if (Math.abs(f1) >= 1.0e-10) { ff1 = f1; ff2 = f2; ff3 = f3; ff4 = f4; ff5 = f5; } else { ff1 = ff2 = ff3 = ff4 = ff5 = 0; }
                if (Math.abs(f6) >= 1.0e-10) { ff6 = f6; ff7 = f7; ff8 = f8; ff9 = f9; ff10 = f10; } else { ff6 = ff7 = ff8 = ff9 = ff10 = 0; }
            },
        };
    }

    function mdaDegrade(sr) {
        const p = [0.8, 0.5, 0.65, 0.9, 0.58, 0.5].map(f);
        let rate = 44100;
        let tn = 1, tcount = 1, mode = 0, clp = 0, fo2 = 0, fi2 = 0, g1 = 0, g2 = 0, g3 = 0, lin = 0, lin2 = 0;
        let buf0 = 0, buf1 = 0, buf2 = 0, buf3 = 0, buf4 = 0, buf5 = 0, buf6 = 0, buf7 = 0, buf8 = 0, buf9 = 0;
        function calc() {
            if (p[2] > 0.5) { tn = Math.trunc(p[2] * 18.0 - 8.0); mode = 1; } else { tn = Math.trunc(10.0 - p[2] * 18.0); mode = 0; }
            tcount = 1;
            clp = f(Math.pow(10, -1.5 - p[0] * -1.5));
            const hz = f(Math.pow(10, f(2.30103993) - p[3] * f(-2)));
            fo2 = mdaFilterFreqOpt(hz, rate);
            const t = f(1 - fo2), t2 = f(t * t);
            fi2 = f(t2 * t2);
            const q = Math.trunc(p[1] * -12.0);
            const g1r = f(Math.pow(2, 2.0 - q));
            g2 = f(1.0 / (g1r + g1r));
            g1 = p[2] > 0.5 ? f(-(g1r / f(tn))) : f(-g1r);
            g3 = f(Math.pow(10, (p[5] + p[5]) - 1.0));
            if (p[4] > 0.5) { lin = f(Math.pow(10, (0.5 - p[4]) * 0.3)); lin2 = lin; } else { lin = f(Math.pow(10, (p[4] - 0.5) * 0.3)); lin2 = 1; }
        }
        calc();
        return {
            names: ['Headroom', 'Quant', 'Rate', 'PostFilt', 'Non-Lin', 'Output'],
            setRate(r) { rate = f(r); },
            set(i, v) { if (i >= 0 && i < 6) { p[i] = f(v); calc(); } },
            process(inp, out, n) {
                let b0 = buf0, b1 = buf1, b2 = buf2, b3 = buf3, b4 = buf4, b5 = buf5, b6 = buf6, b7 = buf7, b8 = buf8, b9 = buf9;
                const l = lin, l2 = lin2, cl = clp, i2 = fi2, o2 = fo2, gi = g1, go = g2, ga = g3, m = mode, nn = tn;
                let t = tcount;
                for (let s = 0; s < n; s++) {
                    b0 = f((inp[s] + 0) + m * b0);
                    if (t === nn) {
                        t = 0;
                        const v = f(f(Math.trunc(gi * b0)) * go);
                        if (v > 0) {
                            b5 = f(Math.pow(v, l2));
                            if (b5 > cl) b5 = cl;
                        } else {
                            const pw = f(Math.pow(-v, l));
                            b5 = f(-pw);
                            if (-pw < -cl) b5 = f(-cl);
                        }
                        b0 = 0;
                    }
                    t = t + 1;
                    b1 = f(ga * b5 * i2 + o2 * b1);
                    b2 = f(o2 * b2 + b1);
                    b3 = f(o2 * b3 + b2);
                    b4 = f(o2 * b4 + b3);
                    b6 = f(b4 * i2 + o2 * b6);
                    b7 = f(o2 * b7 + b6);
                    b8 = f(o2 * b8 + b7);
                    b9 = f(o2 * b9 + b8);
                    out[s] = b9;
                }
                if (Math.abs(b1) < 1.0e-10) {
                    buf0 = buf1 = buf2 = buf3 = buf4 = buf5 = buf6 = buf7 = buf8 = buf9 = 0;
                } else {
                    buf0 = b0; buf1 = b1; buf2 = b2; buf3 = b3; buf4 = b4; buf5 = b5; buf6 = b6; buf7 = b7; buf8 = b8; buf9 = b9; tcount = t;
                }
            },
        };
    }

    function mdaOverdrive(sr) {
        const p = [0, 0, 0.5].map(f);
        let filt = 0, gain = 0, filt1 = 0;
        function calc() {
            filt = f(Math.pow(10, -1.6 * p[1]));
            gain = f(Math.pow(10, f(f(2 * p[2]) - 1)));
        }
        calc();
        return {
            names: ['Drive', 'Muffle', 'Output'],
            setRate() { },
            set(i, v) { if (i >= 0 && i < 3) { p[i] = f(v); calc(); } },
            process(inp, out, n) {
                const i = p[0], g = gain, fl = filt;
                let fa = filt1;
                for (let s = 0; s < n; s++) {
                    const a = inp[s];
                    const aa = a > 0 ? f(Math.sqrt(a)) : -f(Math.sqrt(-a));
                    const fd = (((aa - a) * i + a) - fa) * fl + fa;
                    fa = f(fd);
                    out[s] = f(fd * g);
                }
                filt1 = Math.abs(fa) > 1.0e-10 ? fa : 0;
            },
        };
    }

    function mdaDeEss(sr) {
        const p = [0.5, 0.4, 0.5].map(f);
        let fbuf1 = 0, fbuf2 = 0, gai = 0, thr = 0, att = 0, rel = 0, fil = 0, env = 0;
        function calc() {
            thr = f(Math.pow(10, p[0] * f(3) - f(3)));
            att = 0.5;
            rel = f(0.997);
            fil = f(f(0.19) - p[1] * p[1] * f(-0.8));
            gai = f(Math.pow(10, (p[2] + p[2]) - f(1)));
        }
        calc();
        return {
            names: ['Thresh', 'Freq', 'HF Drive'],
            setRate() { },
            set(i, v) { if (i >= 0 && i < 3) { p[i] = f(v); calc(); } },
            process(inp, out, n) {
                let f1 = fbuf1, f2 = fbuf2, en = env;
                const fi = fil, fo = f(1.0 - fil), at = att, re = rel, th = thr, gg = gai;
                for (let s = 0; s < n; s++) {
                    let tmp = f((inp[s] + 0) * 0.5);
                    f1 = f(fi * tmp + fo * f1);
                    tmp = f(tmp - f1);
                    f2 = f(fi * tmp + fo * f2);
                    tmp = f((tmp - f2) * gg);
                    if (tmp <= en) en = f(en * re); else en = f((tmp - en) * at + en);
                    const g = th < en ? (th / en) * tmp : tmp;
                    out[s] = f(g + f2 + f1);
                }
                if (Math.abs(f1) >= 1.0e-10) { fbuf1 = f1; fbuf2 = f2; } else { fbuf1 = 0; fbuf2 = 0; }
                env = Math.abs(en) >= 1.0e-10 ? en : 0;
            },
        };
    }

    function mdaTalkBox(sr) {
        const BUF_MAX = 1600, ORD_MAX = 50, TWO_PI = f(6.28318530717958647692528676655901);
        const p = [0.5, 0, 0, 1].map(f);
        const buf0 = new Float32Array(BUF_MAX), buf1 = new Float32Array(BUF_MAX), win = new Float32Array(BUF_MAX);
        const car0 = new Float32Array(BUF_MAX), car1 = new Float32Array(BUF_MAX);
        let N = 1, K = 0, O = 0, swap = 0, wet = 0, dry = 0, pos = 0, emphasis = 0, FX = 0;
        let d0 = 0, d1 = 0, d2 = 0, d3 = 0, d4 = 0, u0 = 0, u1 = 0, u2 = 0, u3 = 0, u4 = 0;
        let rate = 44100;
        function resume() {
            let fs = rate;
            if (fs < 8000) fs = 8000;
            if (fs > 96000) fs = 96000;
            swap = p[2] > 0.5 ? 1 : 0;
            let n = Math.trunc(f(f(0.01633) * fs));
            if (n > BUF_MAX) n = BUF_MAX;
            O = Math.trunc(f(f(f(0.0001) + f(f(0.0004) * p[3])) * fs));
            if (n !== N) {
                N = n;
                const dp = f(TWO_PI / f(N));
                let ph = 0;
                for (n = 0; n < N; n++) {
                    win[n] = f(f(0.5) - f(f(0.5) * f(Math.cos(ph))));
                    ph = f(ph + dp);
                }
            }
            wet = f(f(f(0.5) * p[0]) * p[0]);
            dry = f(f(2 * p[1]) * p[1]);
        }
        function suspend() {
            pos = K = 0;
            emphasis = 0;
            FX = 0;
            u0 = u1 = u2 = u3 = u4 = 0;
            d0 = d1 = d2 = d3 = d4 = 0;
            buf0.fill(0); buf1.fill(0); car0.fill(0); car1.fill(0);
        }
        const zr = new Float32Array(ORD_MAX), rr = new Float32Array(ORD_MAX), kk = new Float32Array(ORD_MAX);
        const aa = new Float32Array(ORD_MAX), at = new Float32Array(ORD_MAX);
        function durbin(o) {
            let e = rr[0];
            for (let i = 0; i <= o; i++) aa[i] = at[i] = kk[i] = 0;
            for (let i = 1; i <= o; i++) {
                kk[i] = -rr[i];
                for (let j = 1; j < i; j++) {
                    at[j] = aa[j];
                    kk[i] = f(kk[i] - f(aa[j] * rr[i - j]));
                }
                if (Math.abs(e) < f(1.0e-20)) { e = 0; break; }
                kk[i] = f(kk[i] / e);
                aa[i] = kk[i];
                for (let j = 1; j < i; j++) aa[j] = f(at[j] + f(kk[i] * at[i - j]));
                e = f(e * f(1 - f(kk[i] * kk[i])));
            }
            if (e < f(1.0e-20)) e = 0;
            return f(Math.sqrt(e));
        }
        function lpc(buf, car, n, o) {
            let nn = n;
            rr[0] = 0;
            for (let j = 0; j <= o; j++, nn--) {
                zr[j] = rr[j] = 0;
                let acc = 0;
                for (let i = 0; i < nn; i++) acc = f(acc + f(buf[i] * buf[i + j]));
                rr[j] = acc;
            }
            rr[0] = f(rr[0] * f(1.001));
            if (rr[0] < f(0.00001)) { for (let i = 0; i < n; i++) buf[i] = 0; return; }
            const G = durbin(o);
            for (let i = 0; i <= o; i++) {
                if (kk[i] > f(0.995)) kk[i] = f(0.995); else if (kk[i] < f(-0.995)) kk[i] = f(-0.995);
            }
            for (let i = 0; i < n; i++) {
                let x = f(G * car[i]);
                for (let j = o; j > 0; j--) {
                    x = f(x - f(kk[j] * zr[j - 1]));
                    zr[j] = f(zr[j - 1] + f(kk[j] * x));
                }
                buf[i] = zr[0] = x;
            }
        }
        resume();
        suspend();
        return {
            names: ['Wet', 'Dry', 'Carrier', 'Quality'],
            setRate(r) { rate = f(r); },
            set(i, v) { if (i >= 0 && i < 4) { p[i] = f(v); resume(); } },
            resume,
            process(inp, out, n) {
                let p0 = pos, p1 = (pos + (N >> 1)) % N;
                let e = emphasis, fx = FX;
                const h0 = f(0.3), h1 = f(0.77);
                for (let s = 0; s < n; s++) {
                    let o = swap ? 0 : inp[s];
                    let x = swap ? inp[s] : 0;
                    const dr = o;
                    let pp = f(d0 + f(h0 * x)); d0 = d1; d1 = f(x - f(h0 * pp));
                    let q = f(d2 + f(h1 * d4)); d2 = d3; d3 = f(d4 - f(h1 * q));
                    d4 = x;
                    x = f(pp + q);
                    if (K++) {
                        K = 0;
                        car0[p0] = car1[p1] = x;
                        x = f(o - e); e = o;
                        let w = win[p0]; fx = f(buf0[p0] * w); buf0[p0] = f(x * w);
                        if (++p0 >= N) { lpc(buf0, car0, N, O); p0 = 0; }
                        w = f(1 - w); fx = f(fx + f(buf1[p1] * w)); buf1[p1] = f(x * w);
                        if (++p1 >= N) { lpc(buf1, car1, N, O); p1 = 0; }
                    }
                    pp = f(u0 + f(h0 * fx)); u0 = u1; u1 = f(fx - f(h0 * pp));
                    q = f(u2 + f(h1 * u4)); u2 = u3; u3 = f(u4 - f(h1 * q));
                    u4 = fx;
                    x = f(pp + q);
                    o = f(f(wet * x) + f(dry * dr));
                    out[s] = o;
                }
                emphasis = e;
                pos = p0;
                FX = fx;
                const den = f(1.0e-10);
                if (Math.abs(d0) < den) d0 = 0;
                if (Math.abs(d1) < den) d1 = 0;
                if (Math.abs(d2) < den) d2 = 0;
                if (Math.abs(d3) < den) d3 = 0;
                if (Math.abs(u0) < den) u0 = 0;
                if (Math.abs(u1) < den) u1 = 0;
                if (Math.abs(u2) < den) u2 = 0;
                if (Math.abs(u3) < den) u3 = 0;
            },
        };
    }

    function awSilhouette(sr) {
        const rand = crtRand();
        let A = 0;
        let lastSample = 0, outSample = 0;
        let fpd = awSeed(rand);
        awSeed(rand);
        return {
            names: ['Dry/Wet'],
            setRate() { },
            set(i, v) { if (i === 0) A = f(v); },
            process(inp, out, n) {
                const wet = f(Math.pow(A, 5));
                for (let s = 0; s < n; s++) {
                    let x = inp[s];
                    if (Math.abs(x) < 1.18e-23) x = fpd * 1.18e-17;
                    const dry = x;
                    let br = Math.abs(x) * 1.57079633;
                    if (br > 1.57079633) br = 1.57079633;
                    br = 1.0 - Math.cos(br);
                    x = x > 0 ? br : -br;
                    let sil = fpd / U32MAX;
                    sil -= 0.5;
                    sil *= 2.0;
                    sil *= Math.abs(x);
                    fpd = xorshift(fpd);
                    let sm = fpd / U32MAX;
                    sm -= 0.5;
                    sm *= 2.0;
                    sm *= Math.abs(lastSample);
                    lastSample = x;
                    sil += sm;
                    br = Math.abs(sil) * 1.57079633;
                    if (br > 1.57079633) br = 1.57079633;
                    br = Math.sin(br);
                    sil = sil > 0 ? br : -br;
                    x = (sil + outSample) / 2.0;
                    outSample = sil;
                    if (wet !== 1.0) x = (x * wet) + (dry * (1.0 - wet));
                    fpd = xorshift(fpd);
                    out[s] = awDither(x, fpd);
                }
            },
        };
    }

    function awDustBunny(sr) {
        let A = 0;
        let l3 = 0, l2 = 0, l1 = 0, half = 0, halfDry = 0, halfDiff = 0, la = 0, lb = 0, lc = 0, dry = 0, diff = 0, prevDiff = 0;
        let flip = false;
        const decay = f(0.915965594177219015), tweak = f(0.0414213562373095048801688);
        return {
            names: ['Bunny'],
            setRate() { },
            set(i, v) { if (i === 0) A = f(v); },
            process(inp, out, n) {
                let bunny = Math.trunc(Math.pow(1.255 - A, 5) * 1000) >>> 0;
                bunny = Math.imul(bunny, bunny) >>> 0;
                for (let s = 0; s < n; s++) {
                    let x = inp[s];
                    if (Math.abs(x) < 1.18e-23) x = 0;
                    dry = x;
                    half = halfDry = f(f(f(x + l1) + f(f(-l2 + l3) * tweak)) / 2);
                    l3 = l2; l2 = l1; l1 = x;
                    if (((floatBits(half) & bunny) >>> 0) === 0) half = 0;
                    lc = f(half - halfDry);
                    if (flip) { la = f(la * decay); lb = f(lb * decay); la = f(la + lc); lb = f(lb - lc); lc = la; } else { lb = f(lb * decay); la = f(la * decay); lb = f(lb + lc); la = f(la - lc); lc = lb; }
                    halfDiff = f(lc * decay); flip = !flip;
                    if (((floatBits(x) & bunny) >>> 0) === 0) x = 0;
                    lc = f(x - dry);
                    if (flip) { la = f(la * decay); lb = f(lb * decay); la = f(la + lc); lb = f(lb - lc); lc = la; } else { lb = f(lb * decay); la = f(la * decay); lb = f(lb + lc); la = f(la - lc); lc = lb; }
                    diff = f(lc * decay); flip = !flip;
                    x = dry;
                    x = f(x + f(f(diff + halfDiff) + prevDiff) / 2.5);
                    prevDiff = f(diff / 2);
                    out[s] = x;
                }
            },
        };
    }

    function awDeRez(sr) {
        const rand = crtRand();
        let A = 1, B = 1;
        let lastSample = 0, heldSample = 0, position = 0, incA = 0, incB = 0;
        let fpd = awSeed(rand);
        awSeed(rand);
        let rate = 44100;
        return {
            names: ['Rate', 'Rez'],
            setRate(r) { rate = f(r); },
            set(i, v) { if (i === 0) A = f(v); else if (i === 1) B = f(v); },
            process(inp, out, n) {
                let overall = 1.0;
                overall /= 44100.0;
                overall *= rate;
                let targetA = f(Math.pow(A, 3)) + 0.0005;
                if (targetA > 1.0) targetA = 1.0;
                const soften = (1.0 + targetA) / 2;
                const targetB = Math.pow(1.0 - B, 3) / 3;
                targetA /= overall;
                for (let s = 0; s < n; s++) {
                    let x = inp[s];
                    if (Math.abs(x) < 1.18e-23 && targetB === 0) x = fpd * 1.18e-17;
                    const dry = x;
                    incA = ((incA * 999.0) + targetA) / 1000.0;
                    incB = ((incB * 999.0) + targetB) / 1000.0;
                    position += incA;
                    let o = heldSample;
                    if (position > 1.0) {
                        position -= 1.0;
                        heldSample = (lastSample * position) + (x * (1.0 - position));
                        o = (o * (1.0 - soften)) + (heldSample * soften);
                    }
                    x = o;
                    if (incB > 0.0005) {
                        if (x > 0) {
                            let off = x;
                            while (off > 0) off -= incB;
                            x -= off;
                        }
                        if (x < 0) {
                            let off = x;
                            while (off < 0) off += incB;
                            x -= off;
                        }
                        x *= (1.0 - incB);
                    }
                    lastSample = dry;
                    fpd = xorshift(fpd);
                    out[s] = awDither(x, fpd);
                }
            },
        };
    }

    function awULawEncode(sr) {
        const rand = crtRand();
        let A = 1, B = 1;
        let fpd = awSeed(rand);
        awSeed(rand);
        let noise = 0;
        return {
            names: ['Gain', 'Dry/Wet'],
            setRate() { },
            set(i, v) { if (i === 0) A = f(v); else if (i === 1) B = f(v); },
            process(inp, out, n) {
                const gain = A, wet = B, l256 = Math.log(256);
                for (let s = 0; s < n; s++) {
                    let x = inp[s];
                    noise = noise % 1700021; noise++;
                    let r = Math.imul(noise, noise);
                    r = r % 170003; r = Math.imul(r, r);
                    r = r % 17011; r = Math.imul(r, r);
                    r = r % 1709; r = Math.imul(r, r);
                    r = r % 173; r = Math.imul(r, r);
                    r = r % 17;
                    let ar = r;
                    ar *= 0.00000001;
                    ar *= 0.00000001;
                    x += ar;
                    if (x < 1.2e-38 && -x < 1.2e-38) x -= ar;
                    const dry = x;
                    if (gain !== 1.0) x *= gain;
                    if (x > 1.0) x = 1.0;
                    if (x < -1.0) x = -1.0;
                    if (x > 0) x = Math.log(1.0 + (255 * Math.abs(x))) / l256;
                    if (x < 0) x = -Math.log(1.0 + (255 * Math.abs(x))) / l256;
                    if (wet !== 1.0) x = (x * wet) + (dry * (1.0 - wet));
                    fpd = xorshift(fpd);
                    out[s] = awDither(x, fpd);
                }
            },
        };
    }

    function awULawDecode(sr) {
        const rand = crtRand();
        let A = 1, B = 1;
        let fpd = awSeed(rand);
        awSeed(rand);
        return {
            names: ['Gain', 'Dry/Wet'],
            setRate() { },
            set(i, v) { if (i === 0) A = f(v); else if (i === 1) B = f(v); },
            process(inp, out, n) {
                const gain = A, wet = B;
                for (let s = 0; s < n; s++) {
                    let x = inp[s];
                    if (Math.abs(x) < 1.18e-23) x = fpd * 1.18e-17;
                    const dry = x;
                    if (gain !== 1.0) x *= gain;
                    if (x > 1.0) x = 1.0;
                    if (x < -1.0) x = -1.0;
                    if (x > 0) x = (Math.pow(256, Math.abs(x)) - 1.0) / 255;
                    if (x < 0) x = -(Math.pow(256, Math.abs(x)) - 1.0) / 255;
                    if (wet !== 1.0) x = (x * wet) + (dry * (1.0 - wet));
                    fpd = xorshift(fpd);
                    out[s] = awDither(x, fpd);
                }
            },
        };
    }

    function chebpc(c, d, dd) {
        const H = 11;
        for (let j = 0; j < H; j++) d[j] = dd[j] = 0;
        d[0] = c[H - 1];
        for (let j = H - 2; j >= 1; j--) {
            for (let k = H - j; k >= 1; k--) {
                const sv = d[k];
                d[k] = f(f(2 * d[k - 1]) - dd[k]);
                dd[k] = sv;
            }
            const sv = d[0];
            d[0] = f(-dd[0] + c[j]);
            dd[0] = sv;
        }
        for (let j = H - 1; j >= 1; j--) d[j] = f(d[j - 1] - dd[j]);
        d[0] = f(-dd[0] + f(0.5 * c[0]));
    }

    function swhChebstortion(sr) {
        const H = 11;
        const lut0 = new Float32Array(H), lut1 = new Float32Array(H);
        lut0[1] = 1; lut1[1] = 1;
        for (let i = 2; i < H; i++) lut1[i] = f(1 / i);
        let dist = 0, itm1 = 0, otm1 = 0, env = 0, count = 0;
        const pp = new Float32Array(H), interp = new Float32Array(H), dd = new Float32Array(H);
        return {
            names: ['Distortion'],
            setRate() { },
            set(i, v) { if (i === 0) dist = f(v); },
            process(inp, out, n) {
                for (let s = 0; s < n; s++) {
                    const x = inp[s], a = Math.abs(x);
                    if (a <= env) env = f(env * f(0.97) + a * f(0.03));
                    else env = f(env * f(0.9) + a * f(0.1));
                    if (count-- === 0) {
                        const w = 1 - dist * env;
                        for (let i = 0; i < H; i++) interp[i] = f(lut1[i] * env * dist + lut0[i] * w);
                        chebpc(interp, pp, dd);
                        count = 4;
                    }
                    let y = pp[10];
                    for (let i = 9; i >= 0; i--) y = y * x + pp[i];
                    y = f(y);
                    otm1 = f((otm1 * f(0.999) + y) - itm1);
                    itm1 = y;
                    out[s] = otm1;
                }
            },
        };
    }

    const REGISTRY = {
        'mda Combo.dll': { make: mdaCombo, kind: 'vst' },
        'mda Degrade.dll': { make: mdaDegrade, kind: 'vst' },
        'mdaOverdrive.dll': { make: mdaOverdrive, kind: 'vst' },
        'mda De-ess.dll': { make: mdaDeEss, kind: 'vst' },
        'mdaTalkBox.dll': { make: mdaTalkBox, kind: 'vst' },
        'Silhouette32.dll': { make: awSilhouette, kind: 'vst' },
        'DustBunny32.dll': { make: awDustBunny, kind: 'vst' },
        'DeRez32.dll': { make: awDeRez, kind: 'vst' },
        'uLawEncode32.dll': { make: awULawEncode, kind: 'vst' },
        'uLawDecode32.dll': { make: awULawDecode, kind: 'vst' },
        'chebstortion_1430.dll': { make: swhChebstortion, kind: 'ladspa' },
    };

    function alnum(s) {
        return String(s).toLowerCase().replace(/[^a-z0-9]/g, '');
    }

    function parseParams(s) {
        const out = [];
        let i = 0;
        s = String(s || '');
        while (i < s.length) {
            while (i < s.length && (s[i] === ' ' || s[i] === ',' || s[i] === '\t')) i++;
            if (i >= s.length) break;
            let key = '';
            while (i < s.length && s[i] !== '=' && key.length < 79) key += s[i++];
            key = key.replace(/ +$/, '');
            if (s[i] !== '=') break;
            i++;
            if (s[i] === '"') i++;
            let val = '';
            while (i < s.length && s[i] !== '"' && s[i] !== ' ' && s[i] !== ',' && val.length < 47) val += s[i++];
            if (s[i] === '"') i++;
            if (key.length) out.push([key, f(parseFloat(val) || 0)]);
        }
        return out;
    }

    function create(norm, sr, paramStr) {
        const def = REGISTRY[norm];
        if (!def) return null;
        const inst = def.make(sr);
        inst.setRate(sr);
        const names = inst.names.map(alnum);
        for (const [key, v] of parseParams(paramStr)) {
            if (def.kind === 'vst' && /^[0-9]/.test(key)) { inst.set(parseInt(key, 10), v); continue; }
            const idx = names.indexOf(alnum(key));
            if (idx >= 0) inst.set(idx, v);
        }
        if (inst.resume) inst.resume();
        return inst;
    }

    function has(norm) {
        return Object.prototype.hasOwnProperty.call(REGISTRY, norm);
    }

    function run(norm, pcm, sr, paramStr, block) {
        const inst = create(norm, sr, paramStr);
        if (!inst) return null;
        const BS = block || 512, N = pcm.length;
        const out = new Float32Array(N);
        for (let pos = 0; pos < N; pos += BS) {
            const n = Math.min(BS, N - pos);
            inst.process(pcm.subarray(pos, pos + n), out.subarray(pos, pos + n), n);
        }
        return out;
    }

    const api = { has, run, create, list: () => Object.keys(REGISTRY) };
    global.EASNativePlugins = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : (typeof self !== 'undefined' ? self : this));
