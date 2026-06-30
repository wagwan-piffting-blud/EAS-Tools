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
