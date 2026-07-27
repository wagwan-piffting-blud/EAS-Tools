(function () {
    const RS_A = 40, RS_OVER = 2048, RS_BETA = 12.0, RS_KF = 0.90;
    let LUT = null;
    function besselI0(x) { let s = 1, t = 1; for (let k = 1; k < 60; k++) { t *= (x / (2 * k)) * (x / (2 * k)); s += t; if (t < 1e-14 * s) break; } return s; }
    function buildLut() {
        const lutN = RS_A * RS_OVER, lut = new Float32Array(lutN + 2), den = besselI0(RS_BETA);
        for (let m = 0; m <= lutN; m++) {
            const t = m / RS_OVER;
            if (t >= RS_A) { lut[m] = 0; continue; }
            const xn = t / RS_A, win = besselI0(RS_BETA * Math.sqrt(Math.max(0, 1 - xn * xn))) / den;
            const pt = Math.PI * t;
            lut[m] = (t === 0 ? 1 : Math.sin(pt) / pt) * win;
        }
        return { lut, lutN };
    }
    function resampleRange(x, xlen, out, lo, hi, fromSr, toSr) {
        if (!LUT) LUT = buildLut();
        const lut = LUT.lut, lutN = LUT.lutN;
        const ratio = toSr / fromSr;
        const fc = RS_KF * Math.min(1, ratio);
        const invStep = fromSr / toSr, half = Math.ceil(RS_A / fc);
        for (let i = lo; i < hi; i++) {
            const center = i * invStep, i0 = Math.floor(center);
            const jlo = (i0 - half + 1) > 0 ? (i0 - half + 1) : 0;
            const jhi = (i0 + half) < xlen ? (i0 + half) : (xlen - 1);
            let sum = 0;
            for (let j = jlo; j <= jhi; j++) {
                const d = Math.abs(center - j) * fc * RS_OVER, m = d | 0;
                if (m >= lutN) continue;
                const w = (lut[m] + (lut[m + 1] - lut[m]) * (d - m)) * fc;
                sum += x[j] * w;
            }
            out[i] = sum;
        }
    }
    function resampleSlice(slice, s0, xlen, lo, hi, fromSr, toSr) {
        if (!LUT) LUT = buildLut();
        const lut = LUT.lut, lutN = LUT.lutN;
        const ratio = toSr / fromSr;
        const fc = RS_KF * Math.min(1, ratio);
        const invStep = fromSr / toSr, half = Math.ceil(RS_A / fc);
        const out = new Float32Array(hi - lo);
        for (let i = lo; i < hi; i++) {
            const center = i * invStep, i0 = Math.floor(center);
            const jlo = (i0 - half + 1) > 0 ? (i0 - half + 1) : 0;
            const jhi = (i0 + half) < xlen ? (i0 + half) : (xlen - 1);
            let sum = 0;
            for (let j = jlo; j <= jhi; j++) {
                const d = Math.abs(center - j) * fc * RS_OVER, m = d | 0;
                if (m >= lutN) continue;
                const w = (lut[m] + (lut[m + 1] - lut[m]) * (d - m)) * fc;
                sum += slice[j - s0] * w;
            }
            out[i - lo] = sum;
        }
        return out;
    }
    function handle(msg) {
        if (msg.sliceBuf) {
            const slice = new Float32Array(msg.sliceBuf);
            const out = resampleSlice(slice, msg.sliceStart, msg.xlen, msg.lo, msg.hi, msg.fromSr, msg.toSr);
            return { id: msg.id, outBuf: out.buffer, __transfer: [out.buffer] };
        }
        const x = new Float32Array(msg.xBuf), out = new Float32Array(msg.outBuf);
        resampleRange(x, msg.xlen, out, msg.lo, msg.hi, msg.fromSr, msg.toSr);
        return { id: msg.id, done: true };
    }
    function reply(msg) {
        const r = handle(msg);
        const t = r.__transfer; if (t) delete r.__transfer;
        return { r, t };
    }
    if (typeof self !== 'undefined' && typeof self.postMessage === 'function' && typeof self.importScripts === 'function') {
        self.onmessage = (e) => { const o = reply(e.data); if (o.t) self.postMessage(o.r, o.t); else self.postMessage(o.r); };
    } else {
        const { parentPort } = require('worker_threads');
        parentPort.on('message', (msg) => { const o = reply(msg); if (o.t) parentPort.postMessage(o.r, o.t); else parentPort.postMessage(o.r); });
    }
})();
