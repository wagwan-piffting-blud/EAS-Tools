(function () {
    const isNode = typeof self === 'undefined' || typeof self.importScripts !== 'function';
    let M = null, ready = null, post;
    function loadEmu(cfg) {
        if (cfg.moduleBudget) globalThis.EAS_JIT_MODULE_BUDGET = cfg.moduleBudget;
        if (cfg.regionMax) globalThis.EAS_JIT_REGION_MAX = cfg.regionMax;
        if (cfg.moduleCacheMax) globalThis.EAS_JIT_MODULE_CACHE_MAX = cfg.moduleCacheMax;
        if (isNode) {
            const VstEmuModule = require(cfg.vstemu);
            let E = null, C = null;
            try { E = require(cfg.encoder); C = require(cfg.compiler); } catch (e) { }
            return VstEmuModule({}).then(m => { M = m; try { if (C && E && !cfg.noJit) { C.installJitCompiler(M, E); M._jit_set_enabled(1); } } catch (e) { } });
        }
        self.importScripts(cfg.vstemu, cfg.encoder, cfg.compiler);
        return self.VstEmuModule({ locateFile: (p) => (p.endsWith('.wasm') ? cfg.wasmDir + p : p) }).then(m => {
            M = m; try { if (!cfg.noJit && self.EmuJitCompiler && self.EmuJitWasm) { self.EmuJitCompiler.installJitCompiler(M, self.EmuJitWasm); M._jit_set_enabled(1); } } catch (e) { }
        });
    }
    function processChunk(msg) {
        const dll = new Uint8Array(msg.dll), input = new Float32Array(msg.input), sr = msg.sr, bs = msg.bs, isLadspa = msg.ladspa;
        const dp = M._malloc(dll.length); M.HEAPU8.set(dll, dp);
        const rc = isLadspa ? M._ladspa_w_load(dp, dll.length, sr) : M._vst_w_load(dp, dll.length);
        M._free(dp);
        if (rc !== 0) return new Float32Array(msg.end - msg.start);
        if (isLadspa) M._ladspa_w_prepare(bs); else { M._vst_w_samplerate(sr); M._vst_w_blocksize(bs); }
        if (msg.paramStr) {
            const len = (M.lengthBytesUTF8 ? M.lengthBytesUTF8(msg.paramStr) : msg.paramStr.length) + 1;
            const mp = M._malloc(len); M.stringToUTF8(msg.paramStr, mp, len);
            if (isLadspa) M._ladspa_w_apply_macro(mp); else M._vst_w_apply_macro(mp);
            M._free(mp);
        }
        if (!isLadspa) M._vst_w_resume();
        const N = input.length, out = new Float32Array(N);
        const inL = M._malloc(bs * 4), inR = M._malloc(bs * 4), outL = M._malloc(bs * 4), outR = M._malloc(bs * 4);
        const fi = inL >> 2, fr = inR >> 2, fol = outL >> 2;
        for (let pos = 0; pos < N; pos += bs) {
            const n = Math.min(bs, N - pos), H = M.HEAPF32;
            for (let i = 0; i < n; i++) { H[fi + i] = input[pos + i]; if (!isLadspa) H[fr + i] = 0; }
            if (isLadspa) M._ladspa_w_process(inL, outL, n); else M._vst_w_process(inL, inR, outL, outR, n);
            if (isLadspa ? M._ladspa_w_faulted() : M._vst_w_faulted()) break;
            const H2 = M.HEAPF32; for (let i = 0; i < n; i++) out[pos + i] = H2[fol + i];
        }
        M._free(inL); M._free(inR); M._free(outL); M._free(outR);
        const warm = msg.start - msg.inStart;
        return out.slice(warm, warm + (msg.end - msg.start));
    }
    function handle(msg) {
        if (msg.type === 'init') { ready = loadEmu(msg.cfg).then(() => post({ type: 'ready' })); return; }
        if (msg.type === 'process') ready.then(() => { const valid = processChunk(msg); post({ type: 'done', id: msg.id, start: msg.start, valid: valid.buffer }, [valid.buffer]); });
    }
    if (isNode) { const { parentPort } = require('worker_threads'); post = (m, t) => parentPort.postMessage(m, t); parentPort.on('message', handle); }
    else { post = (m, t) => self.postMessage(m, t); self.onmessage = (e) => handle(e.data); }
})();
