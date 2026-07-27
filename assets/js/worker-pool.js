(function (root) {
    const isNode = typeof process !== 'undefined' && process.versions && process.versions.node && typeof window === 'undefined';
    function cpuCount() {
        try {
            if (isNode) return require('os').cpus().length;
            if (typeof navigator !== 'undefined' && navigator.hardwareConcurrency) return navigator.hardwareConcurrency;
        } catch (e) { }
        return 4;
    }
    function makeWorker(src) {
        if (isNode) {
            const p = require('path');
            let s = src;
            if (!p.isAbsolute(s) && !s.startsWith('./') && !s.startsWith('../')) s = './' + s;
            return new (require('worker_threads').Worker)(s);
        }
        return new Worker(src);
    }
    function EmuWorkerPool(workerSrc, n) {
        this.src = workerSrc;
        this.size = Math.max(1, Math.min(n || (cpuCount() - 1), 16));
        this.workers = null;
    }
    EmuWorkerPool.prototype._ensure = function () {
        if (this.workers && this.workers.length) return;
        const ws = [];
        try { for (let i = 0; i < this.size; i++) ws.push(makeWorker(this.src)); }
        catch (e) { for (const w of ws) { try { w.terminate(); } catch (_) { } } this.workers = null; throw e; }
        this.workers = ws;
    };
    EmuWorkerPool.prototype._job = function (w, msg) {
        return new Promise((resolve, reject) => {
            if (isNode) {
                const onMsg = (d) => { try { w.off('error', onErr); } catch (e) { } resolve(d); };
                const onErr = (e) => { try { w.off('message', onMsg); } catch (e2) { } reject(e); };
                w.once('message', onMsg); w.once('error', onErr);
            } else {
                w.onmessage = (e) => resolve(e.data);
                w.onerror = (e) => reject(e);
            }
            w.postMessage(msg);
        });
    };
    EmuWorkerPool.prototype.resample = function (xBuf, xlen, outBuf, outLen, fromSr, toSr) {
        this._ensure();
        const n = this.workers.length, jobs = [];
        for (let k = 0; k < n; k++) {
            const lo = Math.floor(outLen * k / n), hi = Math.floor(outLen * (k + 1) / n);
            if (hi <= lo) continue;
            jobs.push(this._job(this.workers[k], { id: k, xBuf, xlen, outBuf, lo, hi, fromSr, toSr }));
        }
        return Promise.all(jobs);
    };
    EmuWorkerPool.prototype._jobT = function (w, msg, transfer) {
        return new Promise((resolve, reject) => {
            if (isNode) {
                const onMsg = (d) => { try { w.off('error', onErr); } catch (e) { } resolve(d); };
                const onErr = (e) => { try { w.off('message', onMsg); } catch (e2) { } reject(e); };
                w.once('message', onMsg); w.once('error', onErr);
            } else {
                w.onmessage = (e) => resolve(e.data);
                w.onerror = (e) => reject(e);
            }
            w.postMessage(msg, transfer || []);
        });
    };
    EmuWorkerPool.prototype.resampleTransfer = function (x, outLen, invStep, half, fromSr, toSr, out) {
        this._ensure();
        const n = this.workers.length, xlen = x.length, jobs = [];
        for (let k = 0; k < n; k++) {
            const lo = Math.floor(outLen * k / n), hi = Math.floor(outLen * (k + 1) / n);
            if (hi <= lo) continue;
            let s0 = Math.floor(lo * invStep) - half + 1; if (s0 < 0) s0 = 0;
            let s1 = Math.floor((hi - 1) * invStep) + half; if (s1 > xlen - 1) s1 = xlen - 1;
            const sliceBuf = new ArrayBuffer((s1 - s0 + 1) * 4);
            new Float32Array(sliceBuf).set(x.subarray(s0, s1 + 1));
            const at = lo;
            jobs.push(this._jobT(this.workers[k], { id: k, sliceBuf, sliceStart: s0, xlen, lo, hi, fromSr, toSr }, [sliceBuf])
                .then((r) => { out.set(new Float32Array(r.outBuf), at); }));
        }
        return Promise.all(jobs);
    };
    EmuWorkerPool.prototype.terminate = function () {
        if (!this.workers) return;
        for (const w of this.workers) { try { w.terminate(); } catch (e) { } }
        this.workers = null;
    };
    const api = { EmuWorkerPool, cpuCount, isNode };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    root.EmuWorkerPool = EmuWorkerPool;
    root.EmuWorkers = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
