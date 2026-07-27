(function (global) {
    'use strict';

    const cfg = {
        pluginDir: 'assets/audacity_plugins/',
        macroDir:  'assets/audacity_macros/',
        noiseDir:  'assets/audacity_noises/',
        githubRepo: 'wagwan-piffting-blud/EAS-Tools',
        githubBranch: 'main',
        discoverTimeoutMs: 6000,
        block: 512,
        workerJit: true,
        workerModuleBudget: 512,
        workerModuleCacheMax: 768,
        workerRegionMax: 0,
        log: (...a) => console.log('[AME]', ...a),
    };

    let M = null;
    let modPromise = null;
    let pluginManifest = null;
    let macroManifest = null;
    let macroListPromise = null;
    const dllCache = new Map();
    const macroTextCache = new Map();

    function norm(s) { return String(s).toLowerCase().replace(/[^a-z0-9]/g, ''); }

    function isLocalHost() {
        const h = (global.location && global.location.hostname) || '';
        return !h || h === 'localhost' || h === '127.0.0.1' || h === '::1' ||
               h.endsWith('.local') || h.endsWith('.test') || h.endsWith('.localhost');
    }

    async function discoverMacrosFromGitHub() {
        if (!cfg.githubRepo || typeof fetch !== 'function') return null;
        const path = cfg.macroDir.replace(/^\/+|\/+$/g, '');
        const url = `https://api.github.com/repos/${cfg.githubRepo}/contents/${path}?ref=${encodeURIComponent(cfg.githubBranch)}`;
        let ctl = null, timer = null;
        try {
            if (typeof AbortController === 'function') {
                ctl = new AbortController();
                timer = setTimeout(() => ctl.abort(), cfg.discoverTimeoutMs);
            }
            const res = await fetch(url, {
                headers: { 'Accept': 'application/vnd.github+json' },
                signal: ctl ? ctl.signal : undefined,
            });
            if (!res.ok) { cfg.log(`discover: GitHub API ${res.status}; using manifest`); return null; }
            const data = await res.json();
            if (!Array.isArray(data)) return null;
            return data
                .filter((e) => e && e.type === 'file' && /\.txt$/i.test(e.name))
                .map((e) => e.name);
        } catch (e) {
            cfg.log(`discover: GitHub API failed (${(e && e.name) || e}); using manifest`);
            return null;
        } finally {
            if (timer) clearTimeout(timer);
        }
    }

    function mergeMacroLists(manifestList, discovered) {
        const base = Array.isArray(manifestList) ? manifestList.slice() : [];
        if (!Array.isArray(discovered) || !discovered.length) return base;
        const seen = new Set(base);
        const extra = discovered.filter((f) => !seen.has(f)).sort((a, b) => a.localeCompare(b));
        return base.concat(extra);
    }

    async function discoverMacros(manifestList) {
        if (isLocalHost()) return manifestList || [];
        const discovered = await discoverMacrosFromGitHub();
        if (!discovered) return manifestList || [];
        const merged = mergeMacroLists(manifestList, discovered);
        cfg.log(`discover: ${discovered.length} via GitHub, ${merged.length} total after merge`);
        return merged;
    }

    async function ready() {
        if (M) return M;
        if (!modPromise) {
            if (typeof global.VstEmuModule !== 'function')
                throw new Error('VstEmuModule not loaded (include vstemu.js before this script)');
            modPromise = global.VstEmuModule({
                locateFile: (p) => (p.endsWith('.wasm') ? cfg.pluginDir.replace(/audacity_plugins\/$/, 'js/') + p : p),
            }).then(async (mod) => {
                M = mod;
                try {
                    if (!global.EAS_JIT_DISABLE && global.EmuJitCompiler && global.EmuJitWasm && typeof M._jit_set_enabled === 'function') {
                        global.EmuJitCompiler.installJitCompiler(M, global.EmuJitWasm);
                        M._jit_set_enabled(1);
                        cfg.log('JIT enabled (x86->WASM)');
                    }
                } catch (e) {
                    try { if (M._jit_set_enabled) M._jit_set_enabled(0); } catch (_) { }
                    cfg.log('JIT disabled (install failed): ' + (e && e.message));
                }
                const [pm, mm] = await Promise.all([
                    fetch(cfg.pluginDir + 'manifest.json').then(r => r.json()).catch(() => []),
                    fetch(cfg.macroDir + 'manifest.json').then(r => r.json()).catch(() => []),
                ]);
                pluginManifest = pm;
                macroManifest = await discoverMacros(mm);
                cfg.log(`ready: ${pm.length} plugins, ${macroManifest.length} macros`);
                return M;
            });
        }
        return modPromise;
    }

    async function loadMacroList() {
        if (macroManifest) return macroManifest;
        if (!macroListPromise) {
            macroListPromise = (async () => {
                let mm = [];
                try { mm = await fetch(cfg.macroDir + 'manifest.json').then((r) => r.json()); } catch (e) { mm = []; }
                if (!macroManifest) macroManifest = Array.isArray(mm) ? mm : [];
                return macroManifest;
            })();
        }
        return macroListPromise;
    }

    function listMacros() {
        return (macroManifest || []).map((file) => ({
            id: 'AUD:' + file,
            file,
            name: file.replace(/\.txt$/i, ''),
        }));
    }

    const NATIVE_NORMS = new Set([
        'amplify','normalize','invert','reverse','highpassfilter','lowpassfilter','bassandtreble',
        'distortion','noisething','compressor','compressdynamics','tremolo','changespeed','limiter',
        'hardlimiter','noisegate','filtercurve','graphiceq','multibandeq','harmonicenhancer',
        'setproject','mixandrender','mixandrendertonewtrack','copy','cut','paste','undo','redo',
        'panleft','panright','pancenter','stereotomono','newmonotrack','newstereotrack','selectall',
        'selalltracks','selecttracks','select','selecttime','seltrackstarttoend','duplicate',
        'removetracks','removeaudiotracks','tone','chirp','noise','silence','import2','delete',
        'reverb','echo','vibrato','chorus','phaser','wahwah','eq','equalization','paulstretch',
        'changepitch','changetempo','clickremoval','noisereduction','repeat','truncatesilence',
        'fadein','fadeout','autoduck','flutter','loudnessnormalization','dtmftones',
        'parametriceq','notchfilter','chebyshevtypeifilter','combfilter','clipper',
        'tapesaturationlimiter','popmute','randomamplitudemodulation','randompitchmodulation',
        'studiofadeout','delay','flangerlinear',
    ]);
    function resolvePluginEntry(cmd) {
        if (!pluginManifest) return null;
        const n = norm(cmd);
        const exact = pluginManifest.find(p => p.norm === n);
        if (exact) return exact;
        if (NATIVE_NORMS.has(n)) return null;
        return pluginManifest.find(p => p.norm.replace(/(?:32|64)$/, '') === n) || null;
    }
    function resolvePlugin(cmd) {
        const e = resolvePluginEntry(cmd);
        return e ? e.file : null;
    }

    async function fetchPlugin(file) {
        if (dllCache.has(file)) return dllCache.get(file);
        const buf = new Uint8Array(await fetch(cfg.pluginDir + file).then(r => r.arrayBuffer()));
        dllCache.set(file, buf);
        return buf;
    }
    const noiseCache = new Map();
    async function fetchNoise(file) {
        if (noiseCache.has(file)) return noiseCache.get(file);
        const buf = new Uint8Array(await fetch(cfg.noiseDir + file).then(r => r.arrayBuffer()));
        noiseCache.set(file, buf);
        return buf;
    }
    function decodeWavBytes(b) {
        const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
        let pos = 12, fmt = 1, ch = 1, sr = 44100, bits = 16, doff = 0, dlen = 0;
        while (pos + 8 <= b.length) {
            const id = String.fromCharCode(b[pos], b[pos+1], b[pos+2], b[pos+3]);
            const sz = dv.getUint32(pos+4, true);
            if (id === 'fmt ') { fmt = dv.getUint16(pos+8,true); ch = dv.getUint16(pos+10,true); sr = dv.getUint32(pos+12,true); bits = dv.getUint16(pos+22,true); }
            else if (id === 'data') { doff = pos+8; dlen = sz; }
            pos += 8 + sz + (sz & 1);
        }
        const bytes = bits>>3, frames = bytes ? Math.floor(dlen/(ch*bytes)) : 0, out = new Float32Array(frames);
        for (let i=0;i<frames;i++){ let acc=0;
            for (let c=0;c<ch;c++){ const o = doff + (i*ch+c)*bytes; let v=0;
                if (bits===16) v = dv.getInt16(o,true)/32768;
                else if (bits===24){ const x = b[o]|(b[o+1]<<8)|(b[o+2]<<16); v = ((x<<8)>>8)/8388608; }
                else if (bits===32 && fmt===3) v = dv.getFloat32(o,true);
                else if (bits===32) v = dv.getInt32(o,true)/2147483648;
                else if (bits===8) v = (b[o]-128)/128;
                acc += v; }
            out[i] = acc/ch; }
        return { pcm: out, sr };
    }
    async function fetchMacroText(file) {
        if (macroTextCache.has(file)) return macroTextCache.get(file);
        const t = await fetch(cfg.macroDir + file).then(r => r.text());
        macroTextCache.set(file, t);
        return t;
    }

    const yieldToUI = () => new Promise((r) => setTimeout(r, 0));

    async function runPlugin(dllBytes, paramStr, pcm, sr, onBlock) {
        const dp = M._malloc(dllBytes.length);
        M.HEAPU8.set(dllBytes, dp);
        const rc = M._vst_w_load(dp, dllBytes.length);
        M._free(dp);
        if (rc !== 0) { cfg.log(`  plugin load rc=${rc}; skipping step`); return pcm; }

        M._vst_w_samplerate(sr);
        M._vst_w_blocksize(cfg.block);
        if (paramStr) {
            const len = (M.lengthBytesUTF8 ? M.lengthBytesUTF8(paramStr) : paramStr.length) + 1;
            const mp = M._malloc(len); M.stringToUTF8(paramStr, mp, len);
            const applied = M._vst_w_apply_macro(mp); M._free(mp);
            cfg.log(`  applied ${applied} params by name`);
        }
        M._vst_w_resume();

        const N = pcm.length, BS = cfg.block;
        const out = new Float32Array(N);
        const inL = M._malloc(BS*4), inR = M._malloc(BS*4), outL = M._malloc(BS*4), outR = M._malloc(BS*4);
        const fi = inL >> 2, fr = inR >> 2, fol = outL >> 2;
        let lastYield = Date.now();
        for (let pos = 0; pos < N; pos += BS) {
            const n = Math.min(BS, N - pos);
            const H = M.HEAPF32;
            for (let i = 0; i < n; i++) { H[fi+i] = pcm[pos+i]; H[fr+i] = 0; }
            M._vst_w_process(inL, inR, outL, outR, n);
            if (M._vst_w_faulted()) { cfg.log(`  ** faulted at pos=${pos}; stopping effect`); break; }
            const H2 = M.HEAPF32;
            for (let i = 0; i < n; i++) out[pos+i] = H2[fol+i];
            if (onBlock) onBlock((pos + n) / N);
            if (Date.now() - lastYield > 30) { await yieldToUI(); lastYield = Date.now(); }
        }
        M._free(inL); M._free(inR); M._free(outL); M._free(outR);
        return out;
    }

    async function runLadspaPlugin(dllBytes, paramStr, pcm, sr, onBlock) {
        const dp = M._malloc(dllBytes.length);
        M.HEAPU8.set(dllBytes, dp);
        const rc = M._ladspa_w_load(dp, dllBytes.length, sr);
        M._free(dp);
        if (rc !== 0) { cfg.log(`  ladspa load rc=${rc}; skipping step`); return pcm; }

        const BS = cfg.block;
        M._ladspa_w_prepare(BS);
        if (paramStr) {
            const len = (M.lengthBytesUTF8 ? M.lengthBytesUTF8(paramStr) : paramStr.length) + 1;
            const mp = M._malloc(len); M.stringToUTF8(paramStr, mp, len);
            const applied = M._ladspa_w_apply_macro(mp); M._free(mp);
            cfg.log(`  applied ${applied} LADSPA params by name`);
        }

        const N = pcm.length;
        const out = new Float32Array(N);
        const inP = M._malloc(BS*4), outP = M._malloc(BS*4);
        const fi = inP >> 2, fo = outP >> 2;
        let lastYield = Date.now();
        for (let pos = 0; pos < N; pos += BS) {
            const n = Math.min(BS, N - pos);
            const H = M.HEAPF32;
            for (let i = 0; i < n; i++) H[fi+i] = pcm[pos+i];
            M._ladspa_w_process(inP, outP, n);
            if (M._ladspa_w_faulted()) { cfg.log(`  ** ladspa faulted at pos=${pos}; stopping effect`); break; }
            const H2 = M.HEAPF32;
            for (let i = 0; i < n; i++) out[pos+i] = H2[fo+i];
            if (onBlock) onBlock((pos + n) / N);
            if (Date.now() - lastYield > 30) { await yieldToUI(); lastYield = Date.now(); }
        }
        M._free(inP); M._free(outP);
        return out;
    }

    const PB_WARMUP = { mdacombo: 131072, roughrider2: 131072, dbluecrusher: 131072, sc4: 262144 };
    let pbPool = null;
    function pbIsNode() { return typeof process !== 'undefined' && process.versions && process.versions.node && typeof window === 'undefined'; }
    function getPbPool() {
        if (pbPool !== null) return pbPool || null;
        pbPool = false;
        try {
            if (cfg.disableParallel || cfg.disablePluginParallel) return null;
            const isNode = pbIsNode();
            if (!isNode && typeof Worker === 'undefined') return null;
            const jsdir = cfg.pluginDir.replace(/audacity_plugins\/$/, 'js/');
            let initCfg, mkWorker;
            if (isNode) {
                const p = require('path'), WT = require('worker_threads');
                initCfg = { vstemu: p.resolve(jsdir, 'vstemu.js'), encoder: p.resolve(jsdir, 'jit-wasm-encoder.js'), compiler: p.resolve(jsdir, 'jit-compiler.js'), noJit: cfg.workerJit !== true, moduleBudget: (cfg.workerModuleBudget || 512), regionMax: (cfg.workerRegionMax || 0), moduleCacheMax: (cfg.workerModuleCacheMax || 768) };
                mkWorker = () => new WT.Worker(p.resolve(jsdir, 'plugin-worker.js'));
            } else {
                const base = (typeof document !== 'undefined' && document.baseURI) || (typeof location !== 'undefined' ? location.href : '');
                const abs = (rel) => { try { return new URL(rel, base).href; } catch (e) { return rel; } };
                const jsAbs = abs(jsdir);
                initCfg = { vstemu: jsAbs + 'vstemu.js', encoder: jsAbs + 'jit-wasm-encoder.js', compiler: jsAbs + 'jit-compiler.js', wasmDir: jsAbs, noJit: cfg.workerJit !== true, moduleBudget: (cfg.workerModuleBudget || 512), regionMax: (cfg.workerRegionMax || 0), moduleCacheMax: (cfg.workerModuleCacheMax || 768) };
                mkWorker = () => new Worker(jsAbs + 'plugin-worker.js');
            }
            const n = Math.max(2, Math.min(((global.EmuWorkers ? global.EmuWorkers.cpuCount() : 4)) - 1, 8));
            const workers = [];
            for (let i = 0; i < n; i++) {
                const w = mkWorker();
                const onMsg = (fn) => { if (isNode) w.on('message', fn); else { fn.__w = (e) => fn(e.data); w.addEventListener('message', fn.__w); } };
                const offMsg = (fn) => { if (isNode) w.off('message', fn); else if (fn.__w) w.removeEventListener('message', fn.__w); };
                const ready = new Promise((res) => { const h = (m) => { if (m && m.type === 'ready') { offMsg(h); res(); } }; onMsg(h); });
                w.postMessage({ type: 'init', cfg: initCfg });
                workers.push({ w, ready, onMsg, offMsg, isNode });
            }
            pbPool = { workers, size: n };
        } catch (e) { cfg.log('plugin pool init failed: ' + (e && e.message)); pbPool = false; }
        return pbPool || null;
    }
    function resetPluginPool() {
        if (pbPool && pbPool.workers) { for (const x of pbPool.workers) { try { x.w.terminate(); } catch (e) { } } }
        pbPool = null;
        try { if (global.EmuJitCompiler && global.EmuJitCompiler.clearModuleCache) global.EmuJitCompiler.clearModuleCache(); } catch (e) { }
        cfg.log('plugin pool reset (next run rebuilds with current workerJit/budget)');
    }
    function pbJob(x, msg, transfer) {
        return new Promise((res) => {
            const h = (m) => { if (m && m.type === 'done' && m.id === msg.id) { x.offMsg(h); res(m); } };
            x.onMsg(h);
            x.w.postMessage(msg, transfer);
        });
    }
    async function runPluginChunked(dllBytes, paramStr, pcm, sr, cmd, ladspa) {
        if (cfg.disableParallel || cfg.disablePluginParallel) return null;
        const W = PB_WARMUP[norm(cmd)];
        if (W === undefined) return null;
        const pool = getPbPool();
        if (!pool) return null;
        const minChunk = Math.max(W * 4, 200000);
        const nChunks = Math.max(1, Math.min(pool.size, Math.floor(pcm.length / minChunk)));
        if (nChunks < 2) return null;
        try {
            await Promise.all(pool.workers.map(x => x.ready));
            const jobs = [];
            for (let k = 0; k < nChunks; k++) {
                const start = Math.floor(pcm.length * k / nChunks), end = Math.floor(pcm.length * (k + 1) / nChunks);
                let inStart = Math.max(0, start - W);
                inStart -= inStart % cfg.block;
                const input = pcm.slice(inStart, end).buffer;
                const dll = dllBytes.slice().buffer;
                jobs.push(pbJob(pool.workers[k], { type: 'process', id: k, dll, input, paramStr, sr, bs: cfg.block, start, end, inStart, ladspa }, [dll, input]));
            }
            const dones = await Promise.all(jobs);
            const recon = new Float32Array(pcm.length);
            for (const d of dones) { const v = new Float32Array(d.valid); for (let i = 0; i < v.length; i++) recon[d.start + i] = v[i]; }
            cfg.log(`  [parallel] ${cmd} split ${nChunks} chunks x${pool.size}w (warmup ${W})`);
            return recon;
        } catch (e) { cfg.log('plugin parallel failed, serial fallback: ' + (e && e.message)); return null; }
    }

    function biquadRun(c, x) {
        let z1 = 0, z2 = 0; const out = new Float32Array(x.length);
        for (let i = 0; i < x.length; i++) {
            const xi = x[i], y = c.b0*xi + z1;
            z1 = c.b1*xi - c.a1*y + z2; z2 = c.b2*xi - c.a2*y;
            out[i] = y;
        }
        return out;
    }
    function lphCoef(hp, f, sr, Q) {
        const w = 2*Math.PI*f/sr, cs = Math.cos(w), sn = Math.sin(w), al = sn/(2*Q);
        const a0 = 1+al, a1 = -2*cs, a2 = 1-al;
        let b0, b1, b2;
        if (hp) { b0 = (1+cs)/2; b1 = -(1+cs); b2 = (1+cs)/2; }
        else    { b0 = (1-cs)/2; b1 = 1-cs;    b2 = (1-cs)/2; }
        return { b0: b0/a0, b1: b1/a0, b2: b2/a0, a1: a1/a0, a2: a2/a0 };
    }
    function btCoef(treble, hz, gainDb, sr) {
        const w = 2*Math.PI*hz/sr, cs = Math.cos(w), sn = Math.sin(w);
        const a = Math.pow(10, gainDb/40);
        const b = Math.sqrt((a*a+1)/0.4 - (a-1)*(a-1));
        let b0,b1,b2,a0,a1,a2;
        if (!treble) {
            b0 = a*((a+1) - (a-1)*cs + b*sn); b1 = 2*a*((a-1) - (a+1)*cs); b2 = a*((a+1) - (a-1)*cs - b*sn);
            a0 = (a+1) + (a-1)*cs + b*sn;     a1 = -2*((a-1) + (a+1)*cs);  a2 = (a+1) + (a-1)*cs - b*sn;
        } else {
            b0 = a*((a+1) + (a-1)*cs + b*sn); b1 = -2*a*((a-1) + (a+1)*cs); b2 = a*((a+1) + (a-1)*cs - b*sn);
            a0 = (a+1) - (a-1)*cs + b*sn;     a1 = 2*((a-1) - (a+1)*cs);    a2 = (a+1) - (a-1)*cs - b*sn;
        }
        return { b0:b0/a0, b1:b1/a0, b2:b2/a0, a1:a1/a0, a2:a2/a0 };
    }
    function butterQ(order) {
        const qs = [];
        for (let k=1;k<=order/2;k++) qs.push(1/(2*Math.cos(Math.PI*(2*k-1)/(2*order))));
        return qs;
    }
    function ebuHSF(fs) {
        const db=3.999843853973347, f0=1681.974450955533, Q=0.7071752369554196, K=Math.tan(Math.PI*f0/fs);
        const Vh=Math.pow(10,db/20), Vb=Math.pow(Vh,0.4996667741545416), a0=1+K/Q+K*K;
        return { b0:(Vh+Vb*K/Q+K*K)/a0, b1:2*(K*K-Vh)/a0, b2:(Vh-Vb*K/Q+K*K)/a0, a1:2*(K*K-1)/a0, a2:(1-K/Q+K*K)/a0 };
    }
    function ebuHPF(fs) {
        const f0=38.13547087602444, Q=0.5003270373238773, K=Math.tan(Math.PI*f0/fs), d=1+K/Q+K*K;
        return { b0:1, b1:-2, b2:1, a1:2*(K*K-1)/d, a2:(1-K/Q+K*K)/d };
    }
    function dtmfFreqs(ch) {
        let f1=0, f2=0;
        if ('123Aabcdef'.includes(ch)) f1=697;
        else if ('456Bghijklmno'.includes(ch)) f1=770;
        else if ('789Cpqrstuvwxyz'.includes(ch)) f1=852;
        else if ('*0#D'.includes(ch)) f1=941;
        if ('147*ghipqrs'.includes(ch)) f2=1209;
        else if ('2580abcjkltuv'.includes(ch)) f2=1336;
        else if ('369#defmnowxyz'.includes(ch)) f2=1477;
        else if ('ABCD'.includes(ch)) f2=1633;
        return [f1, f2];
    }
    function onePoleRun(hp, f, sr, x) {
        const K = Math.tan(Math.PI*f/sr), norm = 1/(K+1);
        const b0 = hp ? norm : K*norm, b1 = hp ? -norm : K*norm, a1 = (K-1)*norm;
        const out = new Float32Array(x.length); let x1=0, y1=0;
        for (let i=0;i<x.length;i++){ const xi=x[i], y=b0*xi + b1*x1 - a1*y1; x1=xi; y1=y; out[i]=y; }
        return out;
    }
    function nyqLP(x, cutoff, sr) {
        const w = 2*Math.PI*cutoff/sr, c = 2.0 - Math.cos(w);
        const pole = c - Math.sqrt(c*c - 1.0), gain = 1.0 - pole;
        const out = new Float64Array(x.length); let y = 0;
        for (let i=0;i<x.length;i++){ y = gain*x[i] + pole*y; out[i] = y; }
        return out;
    }
    function eqBandCoef(f, gainDb, widthOct, sr) {
        const w0 = 2*Math.PI*f/sr, cs = Math.cos(w0), sn = Math.sin(w0);
        const A = Math.pow(10, gainDb/40);
        const alpha = sn * Math.sinh(Math.LN2/2 * widthOct * w0/sn);
        const b0 = 1 + alpha*A, b1 = -2*cs, b2 = 1 - alpha*A;
        const a0 = 1 + alpha/A, a1 = -2*cs, a2 = 1 - alpha/A;
        return { b0:b0/a0, b1:b1/a0, b2:b2/a0, a1:a1/a0, a2:a2/a0 };
    }
    function eqShelfCoef(high, f, gainDb, S, sr) {
        const A = Math.pow(10, gainDb/40), w0 = 2*Math.PI*f/sr, cs = Math.cos(w0), sn = Math.sin(w0);
        const alpha = sn/2 * Math.sqrt((A+1/A)*(1/S - 1) + 2), tsa = 2*Math.sqrt(A)*alpha;
        let b0,b1,b2,a0,a1,a2;
        if (high) {
            b0 = A*((A+1) + (A-1)*cs + tsa); b1 = -2*A*((A-1) + (A+1)*cs); b2 = A*((A+1) + (A-1)*cs - tsa);
            a0 = (A+1) - (A-1)*cs + tsa;     a1 = 2*((A-1) - (A+1)*cs);    a2 = (A+1) - (A-1)*cs - tsa;
        } else {
            b0 = A*((A+1) - (A-1)*cs + tsa); b1 = 2*A*((A-1) - (A+1)*cs); b2 = A*((A+1) - (A-1)*cs - tsa);
            a0 = (A+1) + (A-1)*cs + tsa;     a1 = -2*((A-1) + (A+1)*cs);  a2 = (A+1) + (A-1)*cs - tsa;
        }
        return { b0:b0/a0, b1:b1/a0, b2:b2/a0, a1:a1/a0, a2:a2/a0 };
    }
    function chebyPoles(n, r, p, warp) {
        let ReP = -Math.cos(Math.PI/(n*2.0) + (p-1.0)*(Math.PI/n));
        let ImP =  Math.sin(Math.PI/(n*2.0) + (p-1.0)*(Math.PI/n));
        if (warp) {
            const es = Math.sqrt(Math.pow(1.0/(1.0-r),2.0) - 1.0);
            const vx = Math.log(1.0/es + Math.sqrt(Math.pow(1.0/es,2.0)+1.0))/n;
            let kx = Math.log(1.0/es + Math.sqrt(Math.pow(1.0/es,2.0)-1.0))/n;
            kx = (Math.exp(kx)+Math.exp(-kx))/2.0;
            ReP = ReP*(Math.exp(vx)-Math.exp(-vx))/(2.0*kx);
            ImP = ImP*(Math.exp(vx)+Math.exp(-vx))/(2.0*kx);
        }
        return [ReP, ImP];
    }
    function cheby1Coeffs(fType, n, ffc, rippleDb, p) {
        const r = 1.0 - Math.pow(10.0, -rippleDb/20.0);
        const [ReP, ImP] = chebyPoles(n, r, p, rippleDb > 0.0);
        const t = 2.0*Math.tan(0.5), t2 = t*t, wfc = 2.0*Math.PI*ffc;
        const m2 = ReP*ReP + ImP*ImP;
        let d = 4.0 - 4.0*ReP*t + m2*t2;
        const x0 = t2/d, x1 = 2.0*t2/d, x2 = t2/d;
        const y1 = (8.0 - 2.0*m2*t2)/d, y2 = (-4.0 - 4.0*ReP*t - m2*t2)/d;
        const k = (fType===1)
            ? (-Math.cos(0.5 + wfc/2.0))/Math.cos(wfc/2.0 - 0.5)
            : (Math.sin(0.5 - wfc/2.0))/Math.sin(wfc/2.0 + 0.5);
        const k2 = k*k;
        d = 1.0 + y1*k - y2*k2;
        let a1 = (2.0*k + y1 + y1*k2 - 2.0*y2*k)/d;
        let a2 = (-k2 - y1*k + y2)/d;
        let b0 = (x0 - x1*k + x2*k2)/d;
        let b1 = (-2.0*x0*k + x1 + x1*k2 - 2.0*x2*k)/d;
        let b2 = (x0*k2 - x1*k + x2)/d;
        const g = (1.0 - a1 - a2)/(b0 + b1 + b2);
        if (fType===1) { a1 = -a1; b1 = -b1; }
        return { b0: b0*g, b1: b1*g, b2: b2*g, a1: -a1, a2: -a2 };
    }
    function cheby1Filter(x, n, fType, fc, rippleDb, sr) {
        const ffc = fc/sr;
        let s = x;
        for (let p = 1; p <= n/2; p++) s = biquadRun(cheby1Coeffs(fType, n, ffc, rippleDb, p), s);
        return s;
    }
    function gateEnvelope(control, sr, lookSec, riseSec, fallSec, floor, threshold) {
        const n = control.length, look = Math.max(1, Math.round(lookSec*sr));
        const rect = new Float64Array(n); for (let i=0;i<n;i++) rect[i] = Math.abs(control[i]);
        const wmax = new Float64Array(n), dq = new Int32Array(n+1); let head=0, tail=0, na=0;
        for (let i=0;i<n;i++){ const r = Math.min(n-1, i+look-1);
            while (na<=r){ while (tail>head && rect[dq[tail-1]]<=rect[na]) tail--; dq[tail++]=na; na++; }
            while (dq[head]<i) head++; wmax[i]=rect[dq[head]]; }
        const fl = Math.max(floor, 1e-7);
        const riseInc = Math.exp(-Math.log(fl)/Math.max(1,riseSec*sr)), fallDec = Math.exp(Math.log(fl)/Math.max(1,fallSec*sr));
        const env = new Float64Array(n); let g = fl;
        for (let i=0;i<n;i++){ const target = wmax[i] > threshold ? 1 : fl;
            if (g<target) g=Math.min(target, g*riseInc); else if (g>target) g=Math.max(target, g*fallDec); env[i]=g; }
        return env;
    }
    function mget(params, key) {
        const re = new RegExp('(?:^|\\s)' + key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '="?([-0-9.eE]+)');
        const m = re.exec(params); return m ? parseFloat(m[1]) : null;
    }
    function mgetStr(params, key) {
        const re = new RegExp(key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '="([^"]*)"');
        const m = re.exec(params); return m ? m[1] : '';
    }

    function peakCoef(f, sr, dB, Q) {
        const A = Math.pow(10, dB/40), w = 2*Math.PI*f/sr, cs = Math.cos(w), sn = Math.sin(w), al = sn/(2*Q);
        const a0 = 1+al/A, a1 = -2*cs, a2 = 1-al/A, b0 = 1+al*A, b1 = -2*cs, b2 = 1-al*A;
        return { b0:b0/a0, b1:b1/a0, b2:b2/a0, a1:a1/a0, a2:a2/a0 };
    }
    const DB2LIN = (db) => Math.pow(10, db/20);

    const DISTORTION_TYPES = {
        'hard clipping':0, 'soft clipping':1, 'soft overdrive':2, 'medium overdrive':3,
        'hard overdrive':4, 'cubic curve (odd harmonics)':5, 'even harmonics':6,
        'expand and compress':7, 'leveller':8, 'rectifier distortion':9, 'hard limiter 1413':10,
    };
    function buildDistortionTable(type, p) {
        const STEPS = 1024, SIZE = 2*STEPS+1, T = new Float64Array(SIZE);
        const threshold = DB2LIN(p.thrDb);
        let makeup = 1.0;
        const LogCurve = (th, v, r) => th + ((Math.exp(r*(th-v))-1)/-r);
        const Cubic = (x) => x - (Math.pow(x,3)/3);
        const copyHalf = () => { for (let n=0;n<STEPS;n++) T[n] = -T[2*STEPS-n]; };
        switch (type) {
            case 0: { const lo=1-threshold, hi=1+threshold;
                for (let n=0;n<SIZE;n++){ if(n<STEPS*lo)T[n]=-threshold; else if(n>STEPS*hi)T[n]=threshold; else T[n]=n/STEPS-1; }
                makeup = 1.0/threshold; break; }
            case 1: { const thr=1+threshold, amount=Math.pow(2,7*p.p1/100), peak=LogCurve(threshold,1.0,amount); makeup=1.0/peak;
                T[STEPS]=0; for (let n=STEPS;n<SIZE;n++){ T[n]=(n<STEPS*thr)?(n/STEPS-1):LogCurve(threshold,n/STEPS-1,amount); } copyHalf(); break; }
            case 2: case 7: { const iter=Math.floor(p.p1/20), frac=p.p1/20-iter, ss=1/STEPS; let lv=0;
                for (let n=STEPS;n<SIZE;n++){ T[n]=lv; for(let i=0;i<iter;i++) T[n]=Math.sin(T[n]*Math.PI/2); T[n]+=(Math.sin(T[n]*Math.PI/2)-T[n])*frac; lv+=ss; } copyHalf(); break; }
            case 3: { const amount=Math.min(0.999,DB2LIN(-p.p1));
                for (let n=STEPS;n<SIZE;n++){ const lv=n/STEPS, scale=-1/(1-amount), curve=Math.exp((lv-1)*Math.log(amount)); T[n]=scale*(curve-1); } copyHalf(); break; }
            case 4: { const amount=p.p1, ss=1/STEPS; let lv=0;
                if(amount===0){ for(let n=STEPS;n<SIZE;n++){T[n]=lv;lv+=ss;} } else { for(let n=STEPS;n<SIZE;n++){ T[n]=Math.log(1+amount*lv)/Math.log(1+amount); lv+=ss; } } copyHalf(); break; }
            case 5: { const amount=p.p1*Math.sqrt(3)/100; let gain=1; if(amount!==0) gain=1/Cubic(Math.min(amount,1)); const ss=amount/STEPS; let x=-amount;
                if(amount===0){ for(let i=0;i<SIZE;i++) T[i]=i/STEPS-1; } else { for(let i=0;i<SIZE;i++){ T[i]=gain*Cubic(x); for(let j=0;j<p.repeats;j++) T[i]=gain*Cubic(T[i]*amount); x+=ss; } } break; }
            case 6: { const amount=p.p1/-100, C=Math.max(0.001,p.p2)/10, step=1/STEPS; let xv=-1;
                for (let i=0;i<SIZE;i++){ T[i]=((1+amount)*xv)-(xv*(amount/Math.tanh(C))*Math.tanh(C*xv)); xv+=step; } break; }
            case 8: { const nf=DB2LIN(p.noiseFloor), passes=p.repeats, np=6;
                const gf=[0.80,1.00,1.20,1.20,1.00,0.80], gl=[0.0001,nf,0.1,0.3,0.5,1.0], add=[0,0,0,0,0,0];
                for (let i=0;i<np-1;i++) add[i+1]=add[i]+(gl[i]*(gf[i]-gf[i+1]));
                for (let n=STEPS;n<SIZE;n++){ T[n]=(n-STEPS)/STEPS;
                    for (let j=0;j<passes;j++){ let idx=np-1; for(let i=idx;i>=0&&T[n]<gl[i];i--) idx=i; T[n]=T[n]*gf[idx]+add[idx]; } } copyHalf(); break; }
            case 9: { const amount=(p.p1/50)-1, ss=1/STEPS; let idx=STEPS;
                for (let n=0;n<=STEPS;n++){ T[idx]=n*ss; idx++; } idx=STEPS-1;
                for (let n=1;n<=STEPS;n++){ T[idx]=n*ss*amount; idx--; } break; }
            case 10: { const lo=1-threshold, hi=1+threshold;
                for (let n=0;n<SIZE;n++){ if(n<STEPS*lo)T[n]=-threshold; else if(n>STEPS*hi)T[n]=threshold; else T[n]=n/STEPS-1; } makeup=1.0/threshold; break; }
            default: for (let n=0;n<SIZE;n++) T[n]=n/STEPS-1;
        }
        return { T, makeup, STEPS };
    }
    function waveShaper(s, T, STEPS) {
        let idx = Math.floor(s*STEPS)+STEPS; if(idx<0)idx=0; if(idx>2*STEPS-1)idx=2*STEPS-1;
        const xo = ((1+s)*STEPS)-idx;
        return T[idx] + (T[idx+1]-T[idx])*xo;
    }
    function distortion(params, pcm, sr) {
        const typeStr = (mgetStr(params,'Type')||'Hard Clipping').toLowerCase();
        const type = DISTORTION_TYPES[typeStr] ?? 0;
        const p = { thrDb: mget(params,'Threshold_dB')??-6, noiseFloor: mget(params,'Noise_Floor')??-70,
                    p1: mget(params,'Parameter_1')??50, p2: mget(params,'Parameter_2')??50,
                    repeats: Math.round(mget(params,'Repeats')??1), dcBlock: (mget(params,'DC_Block')??0)>0.5 };
        const { T, makeup, STEPS } = buildDistortionTable(type, p);
        const out = new Float32Array(pcm.length);
        const wet = p.p1/100, res = p.p2/100;
        const dcLen = Math.max(1, Math.floor(sr/20)); const dcQ = p.dcBlock ? new Float64Array(dcLen) : null; let dcSum=0, dcIdx=0;
        for (let i=0;i<pcm.length;i++){
            const ws = waveShaper(pcm[i],T,STEPS);
            let o;
            if (type===10) o = ws*(wet-res) + pcm[i]*res;
            else if (type===0 || type===1) o = ws*((1-res) + makeup*res);
            else if (type===6 || type===8 || type===9) o = ws;
            else o = ws*res;
            if (p.dcBlock){ dcSum += o - dcQ[dcIdx]; dcQ[dcIdx]=o; dcIdx=(dcIdx+1)%dcLen; o -= dcSum/dcLen; }
            out[i]=o;
        }
        cfg.log(`  [builtin] distortion "${typeStr}" thr=${p.thrDb}dB p1=${p.p1} p2=${p.p2}`);
        return out;
    }

    function compressor(params, pcm, sr) {
        const thrDb = mget(params,'Threshold_dB') ?? mget(params,'Threshold') ?? -12;
        const ratio = mget(params,'Ratio') ?? 2;
        const attack = mget(params,'AttackTime') ?? 0.2;
        const release = mget(params,'ReleaseTime') ?? 1.0;
        const noiseFloorDb = mget(params,'NoiseFloor') ?? -40;
        const normalize = (mget(params,'Normalize') ?? 1) > 0.5;
        const usePeak = (mget(params,'UsePeak') ?? 0) > 0.5;

        const threshold = DB2LIN(thrDb);
        const noiseFloor = DB2LIN(noiseFloorDb);
        const attackInv = Math.exp(Math.log(threshold) / (sr*attack + 0.5));
        const decayFac = Math.exp(Math.log(threshold) / (sr*release + 0.5));
        const compression = ratio>1 ? (1 - 1/ratio) : 0;

        const n = pcm.length;
        if (n === 0) return new Float32Array(0);
        const env = new Float64Array(n);

        const CIRCLE = 100;
        const circle = new Float64Array(CIRCLE);
        let rmsSum = 0, circPos = 0, noiseCounter = 100;

        let last = threshold;
        const blk = Math.min(n, 131072);
        for (let i=0;i<blk;i++){ const a=Math.abs(pcm[i]); if(a>last) last=a; }

        for (let i=0;i<n;i++){
            let level;
            if (usePeak) level = Math.abs(pcm[i]);
            else {
                rmsSum -= circle[circPos];
                circle[circPos] = pcm[i]*pcm[i];
                rmsSum += circle[circPos];
                level = Math.sqrt(rmsSum/CIRCLE);
                circPos = (circPos+1)%CIRCLE;
            }
            if (level < noiseFloor) noiseCounter++; else noiseCounter = 0;
            if (noiseCounter < 100) {
                last *= decayFac;
                if (last < threshold) last = threshold;
                if (level > last) last = level;
            }
            env[i] = last;
        }

        for (let i=n; i--;){
            last *= attackInv;
            if (last < threshold) last = threshold;
            if (env[i] < last) env[i] = last;
            else last = env[i];
        }

        const out = new Float32Array(n);
        let mx = 0;
        for (let i=0;i<n;i++){
            const e = env[i];
            const g = usePeak ? Math.pow(1.0/e, compression) : Math.pow(threshold/e, compression);
            const o = pcm[i]*g;
            const a = Math.abs(o); if (a>mx) mx=a;
            out[i]=o;
        }
        if (normalize && mx>1e-9){ const ng = 1.0/mx; for (let i=0;i<n;i++) out[i]*=ng; }
        cfg.log(`  [builtin] compressor thr=${thrDb}dB ratio=${ratio} ${usePeak?'peak':'rms'}${normalize?' +norm':''}`);
        return out;
    }

    const EQ_N = 16384;
    let eqTw = null;
    function eqTwiddle() {
        if (eqTw) return eqTw;
        const c = new Float64Array(EQ_N / 2), s = new Float64Array(EQ_N / 2);
        for (let i = 0; i < EQ_N / 2; i++) { const a = -2 * Math.PI * i / EQ_N; c[i] = Math.cos(a); s[i] = Math.sin(a); }
        eqTw = { c, s }; return eqTw;
    }
    function eqFFT(re, im, inverse) {
        const n = re.length, { c, s } = eqTwiddle();
        for (let i = 1, j = 0; i < n; i++) {
            let bit = n >> 1;
            for (; j & bit; bit >>= 1) j ^= bit;
            j ^= bit;
            if (i < j) { const tr = re[i]; re[i] = re[j]; re[j] = tr; const ti = im[i]; im[i] = im[j]; im[j] = ti; }
        }
        for (let len = 2; len <= n; len <<= 1) {
            const step = n / len, half = len >> 1;
            for (let i = 0; i < n; i += len) {
                for (let k = 0; k < half; k++) {
                    const tw = k * step, wr = c[tw], wi = inverse ? -s[tw] : s[tw];
                    const a = i + k, b = a + half;
                    const vr = re[b] * wr - im[b] * wi, vi = re[b] * wi + im[b] * wr;
                    re[b] = re[a] - vr; im[b] = im[a] - vi; re[a] += vr; im[a] += vi;
                }
            }
        }
        if (inverse) for (let i = 0; i < n; i++) { re[i] /= n; im[i] /= n; }
    }
    function eqParsePoints(params) {
        const f = {}, v = {};
        for (const m of params.matchAll(/(?:^|\s)f(\d+)="?([-0-9.eE]+)/g)) f[+m[1]] = parseFloat(m[2]);
        for (const m of params.matchAll(/(?:^|\s)v(\d+)="?([-0-9.eE]+)/g)) v[+m[1]] = parseFloat(m[2]);
        const pts = [];
        for (const k of Object.keys(f)) if (v[k] !== undefined) pts.push({ f: f[k], v: v[k] });
        return pts;
    }
    function eqBuildFilter(points, sr, mM) {
        const N = EQ_N, loFreq = 20, hiFreq = sr / 2;
        const loLog = Math.log10(loFreq), hiLog = Math.log10(hiFreq), denom = hiLog - loLog;
        const delta = hiFreq / (N / 2);
        const pts = points.map(p => ({ w: (Math.log10(p.f) - loLog) / denom, v: p.v })).sort((a, b) => a.w - b.w);
        const env = (w) => {
            if (w <= pts[0].w) return pts[0].v;
            if (w >= pts[pts.length - 1].w) return pts[pts.length - 1].v;
            for (let i = 1; i < pts.length; i++) if (pts[i].w >= w) { const a = pts[i - 1], b = pts[i]; return a.v + (b.v - a.v) * (w - a.w) / (b.w - a.w); }
            return pts[pts.length - 1].v;
        };
        const R = new Float64Array(N), val0 = env(0), val1 = env(1);
        R[0] = val0; let freq = delta;
        for (let i = 1; i <= N / 2; i++) { const w = (Math.log10(freq) - loLog) / denom; R[i] = w < 0 ? val0 : w > 1 ? val1 : env(w); freq += delta; }
        R[N / 2] = val1;
        const db2lin = (x) => Math.pow(10, x / 20);
        R[0] = db2lin(R[0]);
        for (let i = 1; i < N / 2; i++) { R[i] = db2lin(R[i]); R[N - i] = R[i]; }
        R[N / 2] = db2lin(R[N / 2]);
        const tr = R.slice(), ti = new Float64Array(N);
        eqFFT(tr, ti, true);
        const half = (mM - 1) / 2;
        for (let i = 0; i <= half; i++) {
            const mult = 0.42 - 0.5 * Math.cos(2 * Math.PI * (i + half) / (mM - 1)) + 0.08 * Math.cos(4 * Math.PI * (i + half) / (mM - 1));
            tr[i] *= mult; if (i !== 0) tr[N - i] *= mult;
        }
        for (let i = half + 1; i <= N / 2; i++) { tr[i] = 0; tr[N - i] = 0; }
        const tempr = new Float64Array(mM);
        let i = 0; for (; i < half; i++) { tempr[half + i] = tr[i]; tempr[i] = tr[N - half + i]; } tempr[half + i] = tr[i];
        const Hr = new Float64Array(N), Hi = new Float64Array(N);
        for (let k = 0; k < mM; k++) Hr[k] = tempr[k];
        eqFFT(Hr, Hi, false);
        return { Hr, Hi, N, mM };
    }
    function eqApply(pcm, H) {
        const { Hr, Hi, N, mM } = H, L = N - (mM - 1), len = pcm.length;
        const y = new Float64Array(len + mM);
        const tr = new Float64Array(N), ti = new Float64Array(N);
        for (let start = 0; start < len; start += L) {
            const n = Math.min(L, len - start);
            tr.fill(0); ti.fill(0);
            for (let i = 0; i < n; i++) tr[i] = pcm[start + i];
            eqFFT(tr, ti, false);
            for (let k = 0; k < N; k++) { const re = tr[k] * Hr[k] - ti[k] * Hi[k], im = tr[k] * Hi[k] + ti[k] * Hr[k]; tr[k] = re; ti[k] = im; }
            eqFFT(tr, ti, true);
            for (let i = 0; i < N && start + i < y.length; i++) y[start + i] += tr[i];
        }
        const offset = (mM - 1) / 2, out = new Float32Array(len);
        for (let i = 0; i < len; i++) out[i] = y[i + offset];
        return out;
    }
    function audacityEq(params, pcm, sr) {
        const pts = eqParsePoints(params);
        if (pts.length < 2) return pcm;
        let mM = parseInt((/FilterLength="?(\d+)/.exec(params) || [])[1] || '4001', 10);
        if (mM % 2 === 0) mM += 1;
        if (mM < 21) mM = 21; if (mM > 8191) mM = 8191;
        return eqApply(pcm, eqBuildFilter(pts, sr, mM));
    }

    function applyBuiltin(cmd, params, pcm, sr) {
        switch (cmd) {
        case 'Amplify': { const r = mget(params,'Ratio') ?? 1; for (let i=0;i<pcm.length;i++) pcm[i]*=r; cfg.log(`  [builtin] gain x${r.toFixed(3)}`); return pcm; }
        case 'Normalize': { let pk=0; for (let i=0;i<pcm.length;i++) pk=Math.max(pk,Math.abs(pcm[i])); const lvl=DB2LIN(mget(params,'PeakLevel')??-1); const g=pk>1e-9?lvl/pk:1; for (let i=0;i<pcm.length;i++) pcm[i]*=g; cfg.log(`  [builtin] normalize x${g.toFixed(3)}`); return pcm; }
        case 'Invert': { for (let i=0;i<pcm.length;i++) pcm[i]=-pcm[i]; cfg.log('  [builtin] invert'); return pcm; }
        case 'Reverse': { pcm.reverse(); cfg.log('  [builtin] reverse'); return pcm; }
        case 'High-passFilter': case 'Low-passFilter': {
            const hp = cmd[0]==='H', f = mget(params,'frequency') ?? 1000, ro = mgetStr(params,'rolloff');
            const dbn = parseInt((/dB?\s*(\d+)/i.exec(ro)||[])[1] || '12', 10);
            const order = dbn>=48?8 : dbn>=36?6 : dbn>=24?4 : dbn>=12?2 : 1;
            if (order === 1) pcm = onePoleRun(hp, f, sr, pcm);
            else for (const q of butterQ(order)) pcm = biquadRun(lphCoef(hp,f,sr,q), pcm);
            cfg.log(`  [builtin] ${hp?'HPF':'LPF'} ${f}Hz ${ro} (Butterworth order ${order})`); return pcm;
        }
        case 'BassAndTreble': {
            const b = mget(params,'Bass')??0, t = mget(params,'Treble')??0, g = mget(params,'Gain')??0;
            pcm = biquadRun(btCoef(0,250,b,sr), pcm);
            pcm = biquadRun(btCoef(1,4000,t,sr), pcm);
            if (g) { const lg = DB2LIN(g); for (let i=0;i<pcm.length;i++) pcm[i]*=lg; }
            cfg.log(`  [builtin] bass${b>=0?'+':''}${b}dB treble${t>=0?'+':''}${t}dB`); return pcm;
        }
        case 'ParametricEq': {
            let freq = mget(params,'freq') ?? 1000;
            let width = (mget(params,'width') ?? 5) * 0.5;
            let gain = mget(params,'gain') ?? 0;
            freq = Math.max(10, Math.min(freq, Math.min(10000, sr/4)));
            width = Math.max(0.1, Math.min(width, 10));
            gain = Math.max(-15, Math.min(gain, 15));
            if (gain !== 0) pcm = biquadRun(eqBandCoef(freq, gain, width, sr), pcm);
            cfg.log(`  [nyquist] ParametricEq ${freq}Hz ${gain>=0?'+':''}${gain}dB w=${width}oct`); return pcm;
        }
        case 'NotchFilter': {
            const f = mget(params,'frequency') ?? 60, q = mget(params,'q') ?? 1;
            if (f >= 0.1 && f < sr/2) {
                const w0 = 2*Math.PI*f/sr, cs = Math.cos(w0), al = Math.sin(w0)/(2*q), a0 = 1+al;
                pcm = biquadRun({ b0:1/a0, b1:-2*cs/a0, b2:1/a0, a1:-2*cs/a0, a2:(1-al)/a0 }, pcm);
            }
            cfg.log(`  [nyquist] NotchFilter ${f}Hz q=${q}`); return pcm;
        }
        case 'ChebyshevTypeIFilter': {
            const fType = (mgetStr(params,'fType')||'Lowpass').toLowerCase().includes('high') ? 1 : 0;
            const n = Math.round(mget(params,'order') ?? 2);
            let fc = mget(params,'fc') ?? 1000, ripple = mget(params,'ripple') ?? 0.05;
            fc = Math.min(Math.max(fc, 0.01), sr/2);
            ripple = Math.min(Math.max(ripple, 0), 3.0);
            pcm = cheby1Filter(pcm, n, fType, fc, ripple, sr);
            cfg.log(`  [nyquist] ChebyI ${fType?'HP':'LP'} order=${n} fc=${fc}Hz ripple=${ripple}dB`); return pcm;
        }
        case 'CombFilter': {
            const f = mget(params,'f') ?? 440, decay = mget(params,'decay') ?? 0.025;
            const normLevel = mget(params,'norm-level') ?? 0.95;
            const D = Math.round(sr/f), g = decay > 0 ? Math.pow(10.0, -3.0*D/(sr*decay)) : 0;
            const out = new Float32Array(pcm.length);
            for (let i=0;i<pcm.length;i++) out[i] = i>=D ? pcm[i-D] + g*out[i-D] : 0;
            let pk=0; for (let i=0;i<out.length;i++) pk=Math.max(pk,Math.abs(out[i]));
            const sc = pk>1e-12 ? normLevel/pk : 1;
            for (let i=0;i<out.length;i++) out[i]*=sc;
            cfg.log(`  [nyquist] CombFilter f=${f}Hz decay=${decay} D=${D} g=${g.toFixed(4)} norm=${normLevel}`); return out;
        }
        case 'Clipper': {
            const tubeStr = mgetStr(params,'tube') || 'Yes';
            if (/^y/i.test(tubeStr) || tubeStr === '0') {
                const drive = 0.2;
                const tmp = new Float32Array(pcm.length);
                for (let i=0;i<pcm.length;i++){ const x=pcm[i]; tmp[i] = (1-drive)*((1-drive)*Math.min(x,0) + (1+drive)*Math.max(x,0)); }
                pcm = onePoleRun(true, 10, sr, tmp);
            }
            cfg.log(`  [nyquist] Clipper (tube=${tubeStr})`); return pcm;
        }
        case 'TapeSaturationLimiter': {
            const thresDb = mget(params,'thres') ?? -3, hfgain = mget(params,'hfgain') ?? -5;
            let ratio = mget(params,'ratio') ?? 2, hfhz = mget(params,'hfhz') ?? 4500;
            const mk = /on/i.test(mgetStr(params,'makeup')||'Off') ? 1 : 0;
            const thresh = DB2LIN(thresDb);
            hfhz = Math.max(Math.min(hfhz, sr/2), 1000);
            ratio = Math.max(1.01, ratio);
            ratio = ratio > 2.0 ? 3.09*ratio : 6.18*(ratio-1);
            const nratio=-ratio, nthresh=-thresh, iratio=1/ratio, inratio=1/nratio;
            let clip = iratio*(1 - Math.exp(ratio*(thresh-1.0)));
            const amp = 1.023*(thresh+clip), gain = mk===1 ? 1/amp : 1.0;
            let sig = onePoleRun(true, 5.5, sr, pcm);
            sig = biquadRun(eqShelfCoef(1, hfhz, -hfgain, 0.7, sr), sig);
            const out = new Float32Array(sig.length);
            for (let i=0;i<sig.length;i++){
                const x = sig[i];
                const top = nratio*(Math.max(x,thresh)+nthresh), bottom = ratio*(Math.min(x,nthresh)+thresh);
                out[i] = gain*(Math.min(thresh, Math.max(x, nthresh)) + inratio*(Math.exp(top)-1) + iratio*(Math.exp(bottom)-1));
            }
            let sig2 = biquadRun(eqShelfCoef(1, hfhz, hfgain, 0.7, sr), out);
            sig2 = onePoleRun(true, 2.0, sr, sig2);
            cfg.log(`  [nyquist] TapeSat thres=${thresDb}dB ratio=${ratio.toFixed(2)} hf=${hfhz}Hz/${hfgain}dB mk=${mk}`); return sig2;
        }
        case 'PopMute': {
            const threshDb = mget(params,'thresh') ?? -6, floorDb = mget(params,'floor') ?? -24;
            const lookMs = mget(params,'look') ?? 10, relMs = mget(params,'rel') ?? 10;
            if (threshDb > 0 || floorDb > 0 || lookMs < 0 || relMs < 0) return pcm;
            const floor = DB2LIN(floorDb), thresh = DB2LIN(threshDb);
            const look = lookMs/1000, rel = relMs/1000;
            const env = gateEnvelope(pcm, sr, look, look, rel, floor, thresh);
            const out = new Float32Array(pcm.length);
            for (let i=0;i<pcm.length;i++){
                let e = env[i] - (1+floor);
                e = Math.min(-floor, e);
                e = Math.max(-1, Math.min(1, e));
                out[i] = pcm[i]*(-e);
            }
            cfg.log(`  [nyquist] PopMute thresh=${threshDb}dB floor=${floorDb}dB look=${lookMs}ms rel=${relMs}ms`); return out;
        }
        case 'RandomAmplitudeModulation': {
            const maxspeed = mget(params,'maxspeed') ?? 0.5, factor = mget(params,'factor') ?? 80;
            const noise = new Float64Array(pcm.length);
            for (let i=0;i<noise.length;i++) noise[i] = Math.random()*2-1;
            let m = nyqLP(noise, maxspeed, sr);
            for (let i=0;i<m.length;i++) m[i] *= factor;
            m = nyqLP(m, 0.5*maxspeed, sr);
            const out = new Float32Array(pcm.length);
            for (let i=0;i<pcm.length;i++) out[i] = pcm[i]*(0.5 + m[i]);
            cfg.log(`  [nyquist] RandomAmpMod maxspeed=${maxspeed}Hz factor=${factor} (non-deterministic)`); return out;
        }
        case 'RandomPitchModulation': {
            const depth = mget(params,'depth') ?? 0.1, maxspeed = mget(params,'maxspeed') ?? 0.5;
            const factor = mget(params,'factor') ?? 80, maxdepth = mget(params,'maxdepth') ?? 0.5;
            const offset = 0.5*maxdepth;
            const noise = new Float64Array(pcm.length);
            for (let i=0;i<noise.length;i++) noise[i] = Math.random()*2-1;
            let r = nyqLP(noise, maxspeed, sr);
            for (let i=0;i<r.length;i++) r[i] *= factor;
            r = nyqLP(r, 0.5*maxspeed, sr);
            for (let i=0;i<r.length;i++) r[i] += offset;
            const out = new Float32Array(pcm.length), maxd = maxdepth*sr;
            for (let i=0;i<pcm.length;i++){
                let d = (offset + depth*r[i])*sr;
                if (d < 0) d = 0; else if (d > maxd) d = maxd;
                const pos = i - d;
                if (pos <= 0) { out[i] = 0; continue; }
                const i0 = Math.floor(pos), frac = pos - i0;
                const a = pcm[i0], b = i0+1 < pcm.length ? pcm[i0+1] : 0;
                out[i] = a + frac*(b - a);
            }
            cfg.log(`  [nyquist] RandomPitchMod depth=${depth} maxspeed=${maxspeed}Hz factor=${factor} maxdepth=${maxdepth} (non-deterministic)`); return out;
        }
        case 'StudioFadeOut': {
            const n = pcm.length, dur = n/sr;
            if (n < 3) return pcm;
            const out = new Float32Array(n);
            const rcosAt = (i, d) => { const t = i/sr; return t >= d ? 0 : 0.5*(1+Math.cos(Math.PI*t/d)); };
            if (dur < 0.2) { for (let i=0;i<n;i++) out[i] = pcm[i]*rcosAt(i, dur); cfg.log(`  [nyquist] StudioFadeOut short ${dur.toFixed(3)}s`); return out; }
            const cf = Math.min(dur/2, 0.5), nyqHz = sr/2;
            const lpOut = new Float64Array(n); let y = 0;
            for (let i=0;i<n;i++){
                const cutoff = nyqHz + (100 - nyqHz)*(i/sr/dur);
                const w = 2*Math.PI*cutoff/sr, c = 2 - Math.cos(w), pole = c - Math.sqrt(c*c - 1);
                y = (1 - pole)*pcm[i] + pole*y; lpOut[i] = y;
            }
            for (let i=0;i<n;i++){ const fo = rcosAt(i, cf); out[i] = (fo*pcm[i] + (1-fo)*lpOut[i]) * rcosAt(i, dur); }
            cfg.log(`  [nyquist] StudioFadeOut ${dur.toFixed(2)}s (sweep lp + raised-cos)`); return out;
        }
        case 'Delay': {
            const dt = /reverse/i.test(mgetStr(params,'delay-type')||'') ? 2 : /bounc/i.test(mgetStr(params,'delay-type')||'') ? 1 : 0;
            const dgain = mget(params,'dgain') ?? -6, shift = mget(params,'shift') ?? 0;
            const delay = mget(params,'delay') ?? 0.3, number = Math.max(1, Math.round(mget(params,'number') ?? 5));
            const delayEff = dt===0 ? delay : delay/number;
            const out = new Float32Array(pcm.length);
            for (let i=0;i<pcm.length;i++) out[i] = pcm[i];
            let dly = 0;
            for (let count=1; count<=number; count++){
                dly += dt===0 ? delay : dt===1 ? delayEff*(number+1-count) : delayEff*count;
                const g = DB2LIN(count*dgain), off = Math.round(dly*sr);
                for (let i=off;i<pcm.length;i++) out[i] += g*pcm[i-off];
            }
            cfg.log(`  [nyquist] Delay type=${dt} n=${number} delay=${delay}s dgain=${dgain}dB${shift?` shift=${shift}(no-pitch approx)`:''}`); return out;
        }
        case 'Flanger(linear)': {
            const pos = (mget(params,'pos') ?? 0)*0.01, decrease = (mget(params,'decrease') ?? 5)*0.001;
            const wet = (mget(params,'wet') ?? 50)*0.01, sign = (mget(params,'sign') ?? 1)===0 ? -1.0 : 1.0;
            const dry = 1.0 - wet;
            if (decrease === 0) return pcm;
            const N = pcm.length, dur = N/sr, shrink = (dur-decrease)/dur;
            const normTo = (arr, target) => { let pk=0; for(let i=0;i<arr.length;i++) pk=Math.max(pk,Math.abs(arr[i])); const s=pk>1e-12?target/pk:1; const o=new Float64Array(arr.length); for(let i=0;i<arr.length;i++) o[i]=arr[i]*s; return o; };
            const s1 = normTo(pcm, 0.95);
            const s2len = Math.round(shrink*N);
            const dryOff = pos<0 ? Math.round(-pos*decrease*sr) : 0, wetOff = pos>=0 ? Math.round(pos*decrease*sr) : 0;
            const outLen = Math.max(dryOff+N, wetOff+s2len);
            const acc = new Float64Array(outLen);
            for (let i=0;i<N;i++) acc[dryOff+i] += dry*s1[i];
            for (let j=0;j<s2len;j++){ const p=j/shrink, i0=Math.floor(p); if(i0+1<N){ const f=p-i0; acc[wetOff+j] += sign*wet*(s1[i0]+f*(s1[i0+1]-s1[i0])); } }
            const fin = normTo(acc, 0.95), res = new Float32Array(outLen);
            for (let i=0;i<outLen;i++) res[i]=fin[i];
            cfg.log(`  [nyquist] Flanger(linear) pos=${pos*100}% decrease=${decrease*1000}ms wet=${wet} sign=${sign}`); return res;
        }
        case 'HarmonicEnhancer': {
            const freq = Math.max(20, Math.min(mget(params,'freq') ?? 3200, sr/4));
            const drive = mget(params,'drive') ?? 0;
            const even = !(mgetStr(params,'mode') || 'Even').toLowerCase().includes('odd');
            const thNg = mget(params,'th_ng') ?? -28, effmix = mget(params,'effmix') ?? -10;
            const oStr = (mgetStr(params,'output') || 'Mix').toLowerCase();
            const outMode = oStr.includes('only') ? 1 : oStr.includes('level') ? 2 : 0;
            const limit = 0.20, lim1 = -limit, ratio1 = 1/lim1;
            const lim2 = even ? lim1*-11 : lim1*-1.1, ratio2 = 1/lim2;
            const fcomp = freq*0.93, gcomp = Math.max(0, (drive+effmix+16)/5.2), wcomp = 0.81;
            const fcNg = freq*0.125, trise = 0.005, tfall = 0.425, lookah = trise+tfall, floor = DB2LIN(-26);
            const sdb = (db) => Math.pow(10, db/20);
            const hp1 = (x, fc) => {
                const h = onePoleRun(true, fc, sr, x);
                const g = fc < 493 ? 1 : fc < 2375 ? sdb(Math.log(fc) - 6.2) : sdb(Math.log(fc)*2 - 13.97);
                if (g !== 1) for (let i=0;i<h.length;i++) h[i]*=g;
                return h;
            };
            let side = biquadRun(eqShelfCoef(true, sr/3.1, -4, 1.0, sr), pcm);
            const dg = sdb(drive); for (let i=0;i<side.length;i++) side[i]*=dg;
            side = hp1(side, freq*1.07);
            side = biquadRun(lphCoef(true, freq, sr, 1.06), side);
            const ctrl = new Float32Array(pcm.length); for (let i=0;i<pcm.length;i++) ctrl[i] = pcm[i]*dg;
            const genv = gateEnvelope(onePoleRun(true, fcNg, sr, ctrl), sr, lookah, trise, tfall, floor, DB2LIN(thNg));
            if (outMode === 2) {
                const out = new Float32Array(pcm.length), eg = 0.501/limit;
                for (let i=0;i<pcm.length;i++) out[i] = side[i]*genv[i]*eg;
                cfg.log(`  [builtin] HarmonicEnhancer (effect level)`); return out;
            }
            const harm = new Float32Array(side.length);
            for (let i=0;i<side.length;i++){ const x=side[i];
                harm[i] = (lim1*(Math.exp(ratio1*Math.max(x,0))-1) + lim2*(Math.exp(ratio2*Math.min(x,0))-1)) * genv[i]; }
            if (outMode === 1) { cfg.log(`  [builtin] HarmonicEnhancer (effect only)`); return harm; }
            let wet = hp1(harm, freq/10);
            const wg = sdb(effmix+0.13); for (let i=0;i<wet.length;i++) wet[i]*=wg;
            const mix = new Float32Array(pcm.length); for (let i=0;i<pcm.length;i++) mix[i] = pcm[i] + wet[i];
            const out = biquadRun(eqBandCoef(fcomp, gcomp, wcomp, sr), mix);
            cfg.log(`  [builtin] HarmonicEnhancer freq=${freq} drive=${drive}dB ${even?'even':'odd'} mix=${effmix}dB`); return out;
        }
        case 'Distortion': return distortion(params, pcm, sr);
        case 'NoiseThing': { cfg.log(`  [builtin] NoiseThing (peak-envelope AM)`); return noiseThing(pcm, pcm); }
        case 'Compressor': case 'Compress&dynamics': return compressor(params, pcm, sr);
        case 'Tremolo': {
            const f = mget(params,'lfo') ?? mget(params,'Frequency') ?? 4;
            const wetPct = mget(params,'wet') ?? mget(params,'Wet') ?? 40;
            const phaseDeg = mget(params,'phase') ?? mget(params,'Phase') ?? 0;
            const wave = (mgetStr(params,'wave') || mgetStr(params,'Waveform') || 'Sine').toLowerCase();
            const w = wetPct/200, dc = 1 - w;
            const isSine = wave.includes('sin') || wave === '0';
            const ph = ((isSine ? phaseDeg-90 : phaseDeg)/360);
            for (let i=0;i<pcm.length;i++){
                const t = f*i/sr + ph, p = t - Math.floor(t);
                let osc;
                if (isSine) osc = Math.sin(2*Math.PI*p);
                else if (wave.includes('tri')) osc = 1 - 4*Math.abs(p - 0.5);
                else if (wave.includes('square')) osc = p < 0.5 ? 1 : -1;
                else if (wave.includes('inverse')) osc = 1 - 2*p;
                else if (wave.includes('saw')) osc = 2*p - 1;
                else osc = Math.sin(2*Math.PI*p);
                pcm[i] *= dc + w*osc;
            }
            cfg.log(`  [builtin] tremolo ${f}Hz wet ${wetPct}% ${wave}`); return pcm;
        }
        case 'ChangeSpeed': {
            const pct = mget(params,'Percentage'); const mult = pct!=null ? 1+pct/100 : (mget(params,'SpeedMultiplier')??1);
            if (mult<=0 || mult===1) return pcm;
            const out = resampleAudio(pcm, mult, 1);
            cfg.log(`  [builtin] changeSpeed x${mult.toFixed(3)} (${pcm.length}->${out.length}, sinc)`); return out;
        }
        case 'Echo': {
            const delay = mget(params,'Delay') ?? 1.0, decay = mget(params,'Decay') ?? 0.5;
            const histLen = Math.trunc(sr * delay);
            if (delay <= 0 || histLen <= 0) { cfg.log(`  [builtin] echo (delay 0, passthrough)`); return pcm; }
            const history = new Float32Array(histLen), out = new Float32Array(pcm.length);
            let histPos = 0;
            for (let i = 0; i < pcm.length; i++) {
                if (histPos === histLen) histPos = 0;
                const o = pcm[i] + history[histPos] * decay;
                history[histPos] = o; out[i] = o; histPos++;
            }
            cfg.log(`  [builtin] echo delay=${delay}s decay=${decay}`); return out;
        }
        case 'Phaser': {
            const stages = Math.max(2, Math.round(mget(params,'Stages') ?? 2));
            const dryWet = mget(params,'DryWet') ?? 128, depth = mget(params,'Depth') ?? 100;
            const freq = mget(params,'Freq') ?? 0.4, phase0 = (mget(params,'Phase') ?? 0) * Math.PI / 180;
            const feedback = mget(params,'Feedback') ?? 0, outgain = DB2LIN(mget(params,'Gain') ?? -6);
            const lfoskip = freq * 2 * Math.PI / sr, LFOSHAPE = 4.0, LFOSKIP = 20;
            const old = new Float64Array(stages), out = new Float32Array(pcm.length);
            let skipcount = 0, gain = 0, fbout = 0;
            for (let i = 0; i < pcm.length; i++) {
                const inp = pcm[i];
                let m = inp + fbout * feedback / 101;
                if ((skipcount++ % LFOSKIP) === 0) {
                    gain = (1.0 + Math.cos(skipcount * lfoskip + phase0)) / 2.0;
                    gain = Math.expm1(gain * LFOSHAPE) / Math.expm1(LFOSHAPE);
                    gain = 1.0 - gain / 255.0 * depth;
                }
                for (let j = 0; j < stages; j++) { const tmp = old[j]; old[j] = gain * tmp + m; m = tmp - gain * old[j]; }
                fbout = m;
                out[i] = outgain * (m * dryWet + inp * (255 - dryWet)) / 255;
            }
            cfg.log(`  [builtin] phaser stages=${stages} freq=${freq}Hz dw=${dryWet}`); return out;
        }
        case 'LoudnessNormalization': {
            const normTo = Math.round(mget(params,'NormalizeTo') ?? 0), dualMono = (mget(params,'DualMono') ?? 1) > 0.5;
            if (normTo !== 0) {
                const target = DB2LIN(mget(params,'RMSLevel') ?? -20);
                let s=0; for (let i=0;i<pcm.length;i++) s+=pcm[i]*pcm[i];
                const rms=Math.sqrt(s/pcm.length); if (rms<1e-12) return pcm;
                const mult=target/rms, out=new Float32Array(pcm.length); for (let i=0;i<pcm.length;i++) out[i]=pcm[i]*mult;
                cfg.log(`  [builtin] LoudnessNormalization RMS ${mget(params,'RMSLevel')}dB x${mult.toFixed(3)}`); return out;
            }
            const lufs = mget(params,'LUFSLevel') ?? -23, ratio = DB2LIN(lufs*2);
            let w = biquadRun(ebuHSF(sr), pcm); w = biquadRun(ebuHPF(sr), w);
            const blockSize = Math.ceil(0.4*sr), step = Math.ceil(0.1*sr), blocks = [];
            for (let s0=0; s0+blockSize<=w.length; s0+=step) { let ms=0; for (let j=s0;j<s0+blockSize;j++) ms+=w[j]*w[j]; blocks.push(ms/blockSize); }
            if (!blocks.length) return pcm;
            const absZ = Math.pow(10,(-70+0.691)/10), g1 = blocks.filter(z=>z>=absZ);
            if (!g1.length) return pcm;
            const meanG1 = g1.reduce((a,b)=>a+b,0)/g1.length, relZ = meanG1*0.1, g2 = g1.filter(z=>z>=relZ);
            const meanG2 = g2.length ? g2.reduce((a,b)=>a+b,0)/g2.length : meanG1, extent = 0.8529037031*meanG2;
            if (extent<=0) return pcm;
            let mult = ratio/extent; if (dualMono) mult/=2.0; mult = Math.sqrt(mult);
            const out=new Float32Array(pcm.length); for (let i=0;i<pcm.length;i++) out[i]=pcm[i]*mult;
            cfg.log(`  [builtin] LoudnessNormalization LUFS ${lufs} x${mult.toFixed(3)}`); return out;
        }
        case 'Limiter': case 'HardLimiter': {
            const gL = DB2LIN(mget(params,'gain-L') ?? mget(params,'Input_gain') ?? mget(params,'gain') ?? 0);
            const thresh = DB2LIN(mget(params,'thresh') ?? mget(params,'Limit') ?? -3);
            const hold = mget(params,'hold') ?? 10;
            const tstr = (mgetStr(params,'type') || (cmd==='HardLimiter' ? 'HardLimit' : 'SoftLimit')).toLowerCase();
            const mkStr = mgetStr(params,'makeup').toLowerCase();
            const makeup = mkStr==='yes' || (mget(params,'makeup')??0) > 0.5;
            for (let i=0;i<pcm.length;i++) pcm[i]*=gL;
            if (tstr.includes('hardclip')) {
                for (let i=0;i<pcm.length;i++) pcm[i]=Math.max(-thresh,Math.min(thresh,pcm[i]));
            } else if (tstr.includes('softclip')) {
                for (let i=0;i<pcm.length;i++) pcm[i]=thresh*Math.tanh(pcm[i]/thresh);
            } else {
                const step = Math.max(1, Math.round(hold/3000*sr));
                const nb = Math.ceil(pcm.length/step)+4;
                const gp = new Float64Array(nb);
                for (let p=0;p<nb;p++){
                    let s0=(p-3)*step, s1=(p+1)*step; if(s0<0)s0=0; if(s1>pcm.length)s1=pcm.length;
                    let pk=0; for (let i=s0;i<s1;i++){ const a=Math.abs(pcm[i]); if(a>pk)pk=a; }
                    gp[p]=1/Math.max(1,pk/thresh);
                }
                for (let i=0;i<pcm.length;i++){ const fp=i/step, p0=Math.floor(fp), fr=fp-p0;
                    pcm[i]*=gp[p0]+(gp[Math.min(nb-1,p0+1)]-gp[p0])*fr; }
            }
            if (makeup){ const mg=0.999/thresh; for (let i=0;i<pcm.length;i++) pcm[i]*=mg; }
            cfg.log(`  [builtin] limiter "${tstr}" to ${(20*Math.log10(thresh)).toFixed(1)}dB hold=${hold}ms`); return pcm;
        }
        case 'NoiseGate': {
            const thrDb = mget(params,'threshold') ?? mget(params,'Threshold') ?? -48;
            const lrDb = mget(params,'level-reduction') ?? mget(params,'Decay') ?? -12;
            const attMs = mget(params,'attack') ?? 250;
            const gateHz = (mget(params,'gate-freq') ?? 0) * 1000;
            const lowCut = mgetStr(params,'low-cut');
            const threshold = DB2LIN(thrDb), silence = lrDb > -96 ? 0 : 1, floor = DB2LIN(lrDb);
            const look = Math.max(1, Math.round((attMs/1000)*sr));
            const gain = 1/(1 - silence*floor);
            let src = pcm;
            if (lowCut.includes('10')) src = onePoleRun(true, 10, sr, src);
            else if (lowCut.includes('20')) src = onePoleRun(true, 20, sr, src);
            const follow = onePoleRun(true, 20, sr, src);
            for (let i=0;i<follow.length;i++) follow[i] = Math.abs(follow[i]);
            const n = src.length, wmax = new Float64Array(n);
            const dq = new Int32Array(n + 1); let head=0, tail=0, nextAdd=0;
            for (let i=0;i<n;i++){
                const r = Math.min(n-1, i+look-1);
                while (nextAdd <= r) { while (tail>head && follow[dq[tail-1]] <= follow[nextAdd]) tail--; dq[tail++]=nextAdd; nextAdd++; }
                while (dq[head] < i) head++;
                wmax[i] = follow[dq[head]];
            }
            const fl = Math.max(floor, 1e-7);
            const riseInc = Math.exp(-Math.log(fl)/look), fallDec = Math.exp(Math.log(fl)/look);
            const env = new Float64Array(n); let g = fl;
            for (let i=0;i<n;i++){
                const target = wmax[i] > threshold ? 1 : fl;
                if (g < target) g = Math.min(target, g*riseInc);
                else if (g > target) g = Math.max(target, g*fallDec);
                env[i] = g - silence*floor;
            }
            let out;
            if (gateHz > 20) {
                const hi = pcm.slice(); let h = hi;
                for (const q of butterQ(8)) h = biquadRun(lphCoef(true, gateHz, sr, q), h);
                let lo = pcm.slice();
                for (const q of butterQ(8)) lo = biquadRun(lphCoef(false, 0.91*gateHz, sr, q), lo);
                out = new Float32Array(n);
                for (let i=0;i<n;i++) out[i] = h[i]*gain*env[i] + lo[i];
            } else {
                out = new Float32Array(n);
                for (let i=0;i<n;i++) out[i] = pcm[i]*gain*env[i];
            }
            cfg.log(`  [builtin] noise gate thr=${thrDb}dB redux=${lrDb}dB att=${attMs}ms${gateHz>20?` >${(gateHz/1000).toFixed(1)}kHz`:''}`); return out;
        }
        case 'MultibandEq': {
            let bands = Math.trunc(mget(params,'bands') ?? 10), band = Math.trunc(mget(params,'band') ?? 1);
            const gain = mget(params,'gain') ?? 0;
            bands = Math.max(2, Math.min(30, bands)); band = Math.max(1, Math.min(band, bands));
            const width = 9.96578428466 / bands;
            const f = 20 * Math.pow(2, width * 0.5 * (band*2 - 1));
            pcm = biquadRun(eqBandCoef(f, gain, width, sr), pcm);
            cfg.log(`  [builtin] MultibandEq band ${band}/${bands} @ ${f.toFixed(0)}Hz ${gain>=0?'+':''}${gain}dB w=${width.toFixed(2)}oct`); return pcm;
        }
        case 'FilterCurve': case 'GraphicEq': {
            const pts = eqParsePoints(params);
            if (pts.length < 2) { cfg.log(`  [builtin] ${cmd} (no curve points)`); return pcm; }
            const out = audacityEq(params, pcm, sr);
            cfg.log(`  [builtin] ${cmd} (linear-phase FFT EQ, ${pts.length} pts)`); return out;
        }
        default:
            if (PROJECT_OPS.has(cmd)) { cfg.log(`  [project-op] ${cmd} (no-op in single-buffer mode)`); return pcm; }
            return null;
        }
    }

    const PROJECT_OPS = new Set([
        'MixAndRender','SetProject','SelectAll','Select','SelectTime','SelectTracks','SelTrackStartToEnd',
        'Paste','Copy','Cut','Undo','Redo','NewMonoTrack','NewStereoTrack','Duplicate','Delete','Trim',
        'StereoToMono','Stereo to Mono','PanLeft','PanRight','Silence','SetTrackAudio','ZoomFit','SetLabelTrack',
    ]);

    const PROJECT_NOOPS = new Set([
        'SelectTime','SelTrackStartToEnd','SelectFrequencies','SelSave','SelRestore',
        'SelCursorEnd','SelStartToCursor','SelCursorStoEnd','SelSyncLockTracks','SetClip','SetEnvelope',
        'Trim','ZoomFit','ZoomNormal','ZoomIn','ZoomOut','FitInWindow','SkipSelStart','SkipSelEnd',
        'CursTrackStart','CursTrackEnd','CursSelStart','CursSelEnd','CursProjectStart','CursProjectEnd','CursNext',
        'SetTrackAudio','SetTrackStatus','SetTrackVisuals','CollapseAllTracks','ExpandAllTracks','Resample',
        'Align_StartToZero','Align_StartToSelStart','Join','Disjoin','PanCenter','SetLabelTrack','NewLabelTrack',
    ]);

    const NON_UNDOABLE = new Set([
        'SelectAll','SelAllTracks','Select','SelectTime','SelectTracks','SelTrackStartToEnd','SelectNone',
        'SelSave','SelRestore','SelCursorEnd','SelStartToCursor','SelCursorStoEnd','SelSyncLockTracks',
        'SelectFrequencies','Copy','Undo','Redo','PanLeft','PanRight','PanCenter','ZoomFit','ZoomNormal','ZoomIn','ZoomOut','FitInWindow',
        'SkipSelStart','SkipSelEnd','CursTrackStart','CursTrackEnd','CursSelStart','CursSelEnd',
        'CursProjectStart','CursProjectEnd','CursNext','CollapseAllTracks','ExpandAllTracks',
        'SetTrackStatus','SetTrackVisuals','Align_StartToZero','Align_StartToSelStart',
    ]);
    function snapshotProj(proj) {
        return { tracks: proj.tracks.map(t => isStereo(t) ? { L: t.L.slice(), R: t.R.slice() } : t.slice()),
                 pans: (proj.pans || []).slice(), selected: new Set(proj.selected),
                 length: proj.length, sr: proj.sr, selRange: proj.selRange ? proj.selRange.slice() : null };
    }
    function restoreProj(proj, s) {
        proj.tracks = s.tracks; proj.pans = s.pans; proj.selected = s.selected;
        proj.length = s.length; proj.sr = s.sr; proj.selRange = s.selRange;
    }

    const RS_A = 40, RS_OVER = 2048, RS_BETA = 12.0, RS_KF = 0.90;
    let rsLut = null;
    function besselI0(x) { let s = 1, t = 1; for (let k = 1; k < 60; k++) { t *= (x/(2*k))*(x/(2*k)); s += t; if (t < 1e-14*s) break; } return s; }
    function rsTable() {
        if (rsLut) return rsLut;
        const lutN = RS_A * RS_OVER, lut = new Float32Array(lutN + 2), den = besselI0(RS_BETA);
        for (let m = 0; m <= lutN; m++) {
            const t = m / RS_OVER;
            if (t >= RS_A) { lut[m] = 0; continue; }
            const xn = t / RS_A, win = besselI0(RS_BETA * Math.sqrt(Math.max(0, 1 - xn*xn))) / den;
            const pt = Math.PI * t;
            lut[m] = (t === 0 ? 1 : Math.sin(pt) / pt) * win;
        }
        rsLut = { lut, lutN }; return rsLut;
    }
    function resampleAudio(x, fromSr, toSr) {
        if (fromSr === toSr || !x || x.length === 0) return x;
        const ratio = toSr / fromSr;
        const outLen = Math.max(1, Math.round(x.length * ratio));
        const out = new Float32Array(outLen);
        const { lut, lutN } = rsTable();
        const fc = RS_KF * Math.min(1, ratio);
        const invStep = fromSr / toSr, half = Math.ceil(RS_A / fc);
        const xlen = x.length;
        for (let i = 0; i < outLen; i++) {
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
        return out;
    }

    let rsPool = null;
    const RS_PARALLEL_MIN = 200000;
    function getRsPool() {
        if (rsPool !== null) return rsPool || null;
        rsPool = false;
        try {
            if (cfg.disableParallel || !global.EmuWorkerPool) return null;
            rsPool = new global.EmuWorkerPool(cfg.pluginDir.replace(/audacity_plugins\/$/, 'js/') + 'resample-worker.js');
        } catch (e) { rsPool = false; }
        return rsPool || null;
    }
    async function resampleAudioParallel(x, fromSr, toSr) {
        if (fromSr === toSr || !x || x.length === 0) return x;
        if (cfg.disableParallel || x.length < RS_PARALLEL_MIN) return resampleAudio(x, fromSr, toSr);
        const pool = getRsPool();
        if (!pool) return resampleAudio(x, fromSr, toSr);
        try {
            const ratio = toSr / fromSr, outLen = Math.max(1, Math.round(x.length * ratio));
            if (typeof SharedArrayBuffer !== 'undefined') {
                const xBuf = new SharedArrayBuffer(x.length * 4); new Float32Array(xBuf).set(x);
                const outBuf = new SharedArrayBuffer(outLen * 4);
                await pool.resample(xBuf, x.length, outBuf, outLen, fromSr, toSr);
                return new Float32Array(outBuf).slice();
            }
            const fc = RS_KF * Math.min(1, ratio), invStep = fromSr / toSr, half = Math.ceil(RS_A / fc);
            const out = new Float32Array(outLen);
            await pool.resampleTransfer(x, outLen, invStep, half, fromSr, toSr, out);
            return out;
        } catch (e) {
            cfg.log('resample parallel failed, serial fallback: ' + (e && e.message));
            return resampleAudio(x, fromSr, toSr);
        }
    }

    function genTone(params, length, sr) {
        const a0 = mget(params, 'Amplitude') ?? mget(params, 'StartAmplitude') ?? 0.8;
        const a1 = mget(params, 'EndAmplitude') ?? a0;
        const f0 = mget(params, 'Frequency') ?? mget(params, 'StartFreq') ?? mget(params, 'StartFrequency') ?? 440;
        const f1 = mget(params, 'EndFreq') ?? mget(params, 'EndFrequency') ?? f0;
        const wave = (mgetStr(params, 'Waveform') || 'Sine').toLowerCase();
        const logI = (mgetStr(params, 'Interpolation') || '').toLowerCase().includes('log');
        const out = new Float32Array(length);
        let phase = 0;
        for (let i = 0; i < length; i++) {
            const u = length > 1 ? i / (length - 1) : 0;
            const f = (logI && f0 > 0 && f1 > 0) ? f0 * Math.pow(f1 / f0, u) : f0 + (f1 - f0) * u;
            const amp = a0 + (a1 - a0) * u;
            phase += f / sr;
            const ph = phase - Math.floor(phase);
            let v;
            if (wave.includes('square')) v = ph < 0.5 ? 1 : -1;
            else if (wave.includes('saw')) v = 2 * ph - 1;
            else if (wave.includes('triang')) v = ph < 0.5 ? 4 * ph - 1 : 3 - 4 * ph;
            else v = Math.sin(2 * Math.PI * ph);
            out[i] = amp * v;
        }
        return out;
    }
    function genNoise(params, length) {
        const amp = mget(params, 'Amplitude') ?? 0.8;
        const type = (mgetStr(params, 'Type') || 'White').toLowerCase();
        const out = new Float32Array(length);
        let seed = 0x1234abcd >>> 0;
        const rnd = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 2147483648 - 1; };
        if (type.includes('pink')) {
            let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
            for (let i = 0; i < length; i++) {
                const w = rnd();
                b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759; b2 = 0.96900 * b2 + w * 0.1538520;
                b3 = 0.86650 * b3 + w * 0.3104856; b4 = 0.55000 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.0168980;
                out[i] = amp * (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11; b6 = w * 0.115926;
            }
        } else if (type.includes('brown')) {
            let last = 0;
            for (let i = 0; i < length; i++) { last += 0.02 * rnd(); if (last > 1) last = 1; if (last < -1) last = -1; out[i] = amp * last * 3.5; }
        } else {
            for (let i = 0; i < length; i++) out[i] = amp * rnd();
        }
        return out;
    }
    function isStereo(t) { return t && t.L !== undefined && t.R !== undefined; }
    function trackLen(t) { return isStereo(t) ? Math.max(t.L.length, t.R.length) : t.length; }
    function panLgain(p) { return p > 0 ? 1 - p : 1; }
    function panRgain(p) { return p < 0 ? 1 + p : 1; }
    function downmix(t) {
        if (!isStereo(t)) return t;
        const n = Math.max(t.L.length, t.R.length), o = new Float32Array(n);
        for (let i = 0; i < n; i++) o[i] = ((t.L[i] || 0) + (t.R[i] || 0)) * 0.5;
        return o;
    }
    function noiseThing(carrier, modulator) {
        const n = carrier.length, bs = 10, nb = Math.max(1, Math.ceil(modulator.length/bs)), bp = new Float64Array(nb);
        for (let b=0;b<nb;b++){ let pk=0; const s0=b*bs, s1=Math.min(modulator.length,s0+bs); for (let i=s0;i<s1;i++){ const a=Math.abs(modulator[i]); if(a>pk)pk=a; } bp[b]=pk; }
        const out = new Float32Array(n);
        for (let i=0;i<n;i++){ const fb=i/bs, b0=Math.min(nb-1,Math.floor(fb)), fr=fb-Math.floor(fb), env=bp[b0]+((bp[Math.min(nb-1,b0+1)]??bp[b0])-bp[b0])*fr; out[i]=carrier[i]*env; }
        return out;
    }
    function mixBuffers(list, minLen) {
        const mono = list.map(downmix);
        let maxLen = minLen || 0;
        for (const t of mono) if (t.length > maxLen) maxLen = t.length;
        const out = new Float32Array(maxLen);
        for (const t of mono) for (let i = 0; i < t.length; i++) out[i] += t[i];
        return out;
    }

    async function applyEffectToSelected(proj, cmd, params, report) {
        const sel = [...proj.selected].sort((a, b) => a - b);
        if (sel.length === 0) { cfg.log(`  [skip] '${cmd}' (no selection)`); return; }
        const entry = resolvePluginEntry(cmd);
        const runOne = async (chan, subReport) => {
            if (!entry) return applyBuiltin(cmd, params, chan, proj.sr);
            const dllBytes = await fetchPlugin(entry.file);
            const ladspa = entry.kind === 'ladspa';
            const par = await runPluginChunked(dllBytes, params, chan, proj.sr, cmd, ladspa);
            if (par) return par;
            return ladspa
                ? await runLadspaPlugin(dllBytes, params, chan, proj.sr, subReport)
                : await runPlugin(dllBytes, params, chan, proj.sr, subReport);
        };
        for (let s = 0; s < sel.length; s++) {
            const idx = sel[s];
            const track = proj.tracks[idx];
            const subReport = (f) => report((s + f) / sel.length);
            if (entry) cfg.log(`  [emulated ${entry.kind === 'ladspa' ? 'LADSPA' : 'VST'}] ${entry.file}${sel.length > 1 ? ` [track ${idx}]` : ''}`);
            if (isStereo(track)) {
                const L = await runOne(track.L, (f) => subReport(f * 0.5));
                const R = await runOne(track.R, (f) => subReport(0.5 + f * 0.5));
                if (entry || (L && R)) proj.tracks[idx] = { L: L || track.L, R: R || track.R };
                else cfg.log(`  [skip] '${cmd}' (not modelled)`);
            } else {
                const bi = await runOne(track, subReport);
                if (entry) proj.tracks[idx] = bi;
                else if (bi) proj.tracks[idx] = bi;
                else cfg.log(`  [skip] '${cmd}' (built-in/Nyquist not modelled)`);
            }
        }
        proj.length = proj.tracks.reduce((m, t) => Math.max(m, trackLen(t)), 0);
    }

    async function applyStep(proj, cmd, params, report) {
        switch (cmd) {
        case 'SetProject': {
            const rate = mget(params, 'Rate');
            if (rate && rate > 0 && Math.abs(rate - proj.sr) > 0.5) {
                for (let i = 0; i < proj.tracks.length; i++) {
                    const t = proj.tracks[i];
                    if (isStereo(t)) {
                        const L = await resampleAudioParallel(t.L, proj.sr, rate);
                        const R = await resampleAudioParallel(t.R, proj.sr, rate);
                        proj.tracks[i] = { L, R };
                    } else {
                        proj.tracks[i] = await resampleAudioParallel(t, proj.sr, rate);
                    }
                }
                proj.length = Math.round(proj.length * rate / proj.sr);
                cfg.log(`  [project] SetProject ${proj.sr} -> ${rate} Hz (resampled ${proj.tracks.length} track[s])`);
                proj.sr = rate;
            }
            return;
        }
        case 'MixAndRender': case 'MixAndRenderToNewTrack': {
            const sel = [...proj.selected].sort((a, b) => a - b);
            if (sel.length === 0) return;
            const pans = proj.pans || [];
            const needStereo = sel.some(i => isStereo(proj.tracks[i]) || Math.abs(pans[i] || 0) > 1e-6);
            let mixed;
            if (needStereo) {
                const len = proj.length;
                const L = new Float32Array(len), R = new Float32Array(len);
                for (const i of sel) {
                    const t = proj.tracks[i], p = pans[i] || 0;
                    const mono = !isStereo(t), k = mono ? 0.5 : 1;
                    const lg = panLgain(p) * k, rg = panRgain(p) * k;
                    const tl = mono ? t : t.L, tr = mono ? t : t.R;
                    for (let j = 0; j < tl.length && j < len; j++) L[j] += tl[j] * lg;
                    for (let j = 0; j < tr.length && j < len; j++) R[j] += tr[j] * rg;
                }
                mixed = { L, R };
            } else {
                mixed = mixBuffers(sel.map(i => proj.tracks[i]), proj.length);
            }
            if (cmd === 'MixAndRenderToNewTrack') {
                proj.tracks.push(mixed);
                if (proj.pans) proj.pans.push(0);
                proj.selected = new Set([proj.tracks.length - 1]);
                cfg.log(`  [project] MixAndRenderToNewTrack (${sel.length} track[s] -> new track ${proj.tracks.length - 1}${needStereo ? ' stereo' : ''})`);
                return;
            }
            const newTracks = [], newPans = []; let inserted = false;
            for (let i = 0; i < proj.tracks.length; i++) {
                if (proj.selected.has(i)) { if (!inserted) { newTracks.push(mixed); newPans.push(0); inserted = true; } }
                else { newTracks.push(proj.tracks[i]); newPans.push(pans[i] || 0); }
            }
            proj.tracks = newTracks; proj.pans = newPans;
            proj.selected = new Set([newTracks.indexOf(mixed)]);
            cfg.log(`  [project] MixAndRender (${sel.length} track[s] -> 1${needStereo ? ' stereo' : ''})`);
            return;
        }
        case 'Undo': {
            if (proj.undoStack && proj.undoStack.length) {
                proj.redoStack.push(snapshotProj(proj));
                restoreProj(proj, proj.undoStack.pop());
                cfg.log(`  [project] Undo (${proj.tracks.length} track[s])`);
            } else cfg.log(`  [project] Undo (history empty)`);
            return;
        }
        case 'Redo': {
            if (proj.redoStack && proj.redoStack.length) {
                proj.undoStack.push(snapshotProj(proj));
                restoreProj(proj, proj.redoStack.pop());
                cfg.log(`  [project] Redo`);
            }
            return;
        }
        case 'Copy':
            proj.clipboard = { tracks: [...proj.selected].sort((a, b) => a - b).map(i => { const t = proj.tracks[i]; return isStereo(t) ? { L: t.L.slice(), R: t.R.slice() } : t.slice(); }), sr: proj.sr };
            return;
        case 'Cut':
            proj.clipboard = { tracks: [...proj.selected].sort((a, b) => a - b).map(i => proj.tracks[i].slice()), sr: proj.sr };
            for (const i of proj.selected) proj.tracks[i] = new Float32Array(0);
            return;
        case 'PanLeft': case 'PanRight': case 'PanCenter': {
            const p = cmd === 'PanLeft' ? -1 : cmd === 'PanRight' ? 1 : 0;
            if (!proj.pans) proj.pans = proj.tracks.map(() => 0);
            for (const i of proj.selected) proj.pans[i] = p;
            cfg.log(`  [project] ${cmd} (tracks [${[...proj.selected]}])`); return;
        }
        case 'StereoToMono': case 'Stereo to Mono': {
            for (const i of proj.selected) { if (isStereo(proj.tracks[i])) proj.tracks[i] = downmix(proj.tracks[i]); if (proj.pans) proj.pans[i] = 0; }
            cfg.log(`  [project] StereoToMono`); return;
        }
        case 'NoiseThing': {
            for (const i of proj.selected) {
                const t = proj.tracks[i];
                proj.tracks[i] = isStereo(t) ? noiseThing(t.L, t.R) : noiseThing(t, t);
                if (proj.pans) proj.pans[i] = 0;
            }
            cfg.log(`  [builtin] NoiseThing (L*env(R))`); return;
        }
        case 'Paste': {
            if (!proj.clipboard) return;
            const cb = proj.clipboard, sel = [...proj.selected].sort((a, b) => a - b);
            for (let s = 0; s < sel.length && s < cb.tracks.length; s++) {
                let src = cb.tracks[s] || new Float32Array(0);
                if (isStereo(src)) {
                    let L = src.L, R = src.R;
                    if (cb.sr !== proj.sr) { L = resampleAudio(L, cb.sr, proj.sr); R = resampleAudio(R, cb.sr, proj.sr); }
                    proj.tracks[sel[s]] = { L: L.slice(), R: R.slice() };
                } else {
                    if (cb.sr !== proj.sr) src = resampleAudio(src, cb.sr, proj.sr);
                    proj.tracks[sel[s]] = src.slice();
                }
            }
            cfg.log(`  [project] Paste`);
            return;
        }
        case 'NewMonoTrack': case 'NewStereoTrack':
            proj.tracks.push(cmd === 'NewStereoTrack' ? { L: new Float32Array(0), R: new Float32Array(0) } : new Float32Array(0));
            if (proj.pans) proj.pans.push(0);
            proj.selected = new Set([proj.tracks.length - 1]);
            cfg.log(`  [project] ${cmd}`);
            return;
        case 'SelectAll': case 'SelAllTracks':
            proj.selected = new Set(proj.tracks.map((_, i) => i));
            proj.selRange = null;
            return;
        case 'SelectTracks': {
            const tr = mget(params,'Track');
            if (tr !== null) {
                const ti = Math.round(tr), cnt = Math.max(1, Math.round(mget(params,'TrackCount') ?? 1));
                const mode = mgetStr(params,'Mode') || 'Set';
                if (mode === 'Add') { for (let k=0;k<cnt;k++) if (ti+k < proj.tracks.length) proj.selected.add(ti+k); }
                else if (mode === 'Remove') { for (let k=0;k<cnt;k++) proj.selected.delete(ti+k); }
                else { proj.selected = new Set(); for (let k=0;k<cnt;k++) if (ti+k >= 0 && ti+k < proj.tracks.length) proj.selected.add(ti+k); }
            }
            proj.selRange = null;
            cfg.log(`  [project] SelectTracks [${[...proj.selected]}]`); return;
        }
        case 'Select': case 'SelectTime': {
            const st = mget(params,'Start'), en = mget(params,'End');
            if (st !== null || en !== null) {
                const relEnd = (mgetStr(params,'RelativeTo')||'').includes('End');
                const s = (st??0)*proj.sr, e = (en??0)*proj.sr;
                proj.selRange = relEnd
                    ? [Math.max(0, Math.round(proj.length - e)), Math.max(0, Math.round(proj.length - s))]
                    : [Math.max(0, Math.round(s)), Math.round(e)];
            }
            const tr = mget(params,'Track');
            if (tr !== null) { const ti = Math.round(tr); if (ti >= 0 && ti < proj.tracks.length) proj.selected = new Set([ti]); }
            cfg.log(`  [project] ${cmd} ${proj.selRange ? '['+proj.selRange[0]+'..'+proj.selRange[1]+']' : 'all'}`);
            return;
        }
        case 'Duplicate': {
            const newSel = new Set();
            for (const i of [...proj.selected].sort((a, b) => a - b)) {
                const t = proj.tracks[i];
                proj.tracks.push(isStereo(t) ? { L: t.L.slice(), R: t.R.slice() } : t.slice());
                if (proj.pans) proj.pans.push(proj.pans[i] || 0);
                newSel.add(proj.tracks.length - 1);
            }
            proj.selected = newSel;
            return;
        }
        case 'RemoveTracks': case 'RemoveAudioTracks': {
            const keep = proj.tracks.filter((_, i) => !proj.selected.has(i));
            const keepPans = proj.pans ? proj.pans.filter((_, i) => !proj.selected.has(i)) : null;
            proj.tracks = keep.length ? keep : [new Float32Array(proj.length)];
            proj.pans = keep.length ? keepPans : [0];
            proj.selected = new Set([0]);
            return;
        }
        case 'Tone': case 'Chirp': {
            const sig = genTone(params, proj.length, proj.sr);
            for (const i of proj.selected) proj.tracks[i] = sig.slice();
            cfg.log(`  [generator] ${cmd}`); return;
        }
        case 'Noise': {
            const sig = genNoise(params, proj.length);
            for (const i of proj.selected) proj.tracks[i] = sig.slice();
            cfg.log(`  [generator] Noise`); return;
        }
        case 'Silence': {
            for (const i of proj.selected) {
                const t = proj.tracks[i];
                if (proj.selRange) {
                    for (const c of (isStereo(t) ? [t.L, t.R] : [t])) {
                        const a = Math.max(0, Math.min(c.length, proj.selRange[0]));
                        const b = Math.max(a, Math.min(c.length, proj.selRange[1]));
                        for (let j = a; j < b; j++) c[j] = 0;
                    }
                } else proj.tracks[i] = isStereo(t) ? { L: new Float32Array(proj.length), R: new Float32Array(proj.length) } : new Float32Array(proj.length);
            }
            proj.selRange = null;
            cfg.log(`  [generator] Silence`); return;
        }
        case 'FadeIn': case 'FadeOut': {
            const fadeIn = cmd === 'FadeIn';
            for (const i of proj.selected) {
                const t = proj.tracks[i];
                for (const c of (isStereo(t) ? [t.L, t.R] : [t])) {
                    const a = proj.selRange ? Math.max(0, Math.min(c.length, proj.selRange[0])) : 0;
                    const b = proj.selRange ? Math.max(a, Math.min(c.length, proj.selRange[1])) : c.length;
                    const n = b - a;
                    if (n <= 0) continue;
                    if (fadeIn) for (let j = a; j < b; j++) c[j] = c[j] * (j - a) / n;
                    else for (let j = a; j < b; j++) c[j] = c[j] * (n - 1 - (j - a)) / n;
                }
            }
            proj.selRange = null;
            cfg.log(`  [builtin] ${cmd}`); return;
        }
        case 'Repeat': {
            const count = Math.max(1, Math.round(mget(params,'Count') ?? 1));
            const tile = (c) => {
                const a = proj.selRange ? Math.max(0, Math.min(c.length, proj.selRange[0])) : 0;
                const b = proj.selRange ? Math.max(a, Math.min(c.length, proj.selRange[1])) : c.length;
                const seg = c.subarray(a, b), segLen = b - a, out = new Float32Array(c.length + segLen * count);
                out.set(c.subarray(0, b), 0);
                for (let k = 0; k < count; k++) out.set(seg, b + k * segLen);
                out.set(c.subarray(b), b + segLen * count);
                return out;
            };
            for (const i of proj.selected) {
                const t = proj.tracks[i];
                proj.tracks[i] = isStereo(t) ? { L: tile(t.L), R: tile(t.R) } : tile(t);
            }
            proj.length = proj.tracks.reduce((m, t) => Math.max(m, trackLen(t)), 0);
            proj.selRange = null;
            cfg.log(`  [builtin] Repeat x${count}`); return;
        }
        case 'AutoDuck': {
            const sr = proj.sr;
            const duckDb = mget(params,'DuckAmountDb') ?? -12;
            const innerDown = mget(params,'InnerFadeDownLen') ?? 0, innerUp = mget(params,'InnerFadeUpLen') ?? 0;
            const outerDown = mget(params,'OuterFadeDownLen') ?? 0.5, outerUp = mget(params,'OuterFadeUpLen') ?? 0.5;
            const thrDb = mget(params,'ThresholdDb') ?? -30;
            let maxPause = mget(params,'MaximumPause') ?? 1.0;
            const sel = [...proj.selected].sort((a,b)=>a-b);
            const ctrlIdx = sel.length ? sel[sel.length-1] + 1 : -1;
            if (ctrlIdx < 0 || ctrlIdx >= proj.tracks.length) { cfg.log(`  [builtin] AutoDuck (no control track, skip)`); return; }
            const ctrl = downmix(proj.tracks[ctrlIdx]);
            const RMSW = 100, thr = DB2LIN(thrDb)*DB2LIN(thrDb)*RMSW;
            if (maxPause < outerDown + outerUp) maxPause = outerDown + outerUp;
            const minPause = Math.round(sr * maxPause);
            const dStart = Math.round(sr * outerDown), dEnd = ctrl.length - Math.round(sr * outerUp);
            const regions = [], rmsWin = new Float64Array(RMSW);
            let rmsSum = 0, rmsPos = 0, inDuck = false, duckStart = 0, pause = 0;
            for (let i = dStart; i < dEnd; i++) {
                rmsSum -= rmsWin[rmsPos]; rmsWin[rmsPos] = ctrl[i]*ctrl[i]; rmsSum += rmsWin[rmsPos]; rmsPos = (rmsPos+1)%RMSW;
                const ex = rmsSum > thr;
                if (ex) { pause = 0; if (!inDuck) { inDuck = true; duckStart = i/sr; } }
                else if (inDuck) { pause++; if (pause >= minPause) { regions.push([duckStart - outerDown, (i - pause)/sr + outerUp]); inDuck = false; } }
            }
            if (inDuck) regions.push([duckStart - outerDown, (dEnd - pause)/sr + outerUp]);
            const fDown = Math.max(1, Math.round(sr*(outerDown+innerDown))), fUp = Math.max(1, Math.round(sr*(outerUp+innerUp)));
            const stepDown = duckDb/fDown, stepUp = duckDb/fUp;
            for (const ti of sel) {
                const t = proj.tracks[ti];
                for (const c of (isStereo(t) ? [t.L, t.R] : [t])) {
                    for (const [t0, t1] of regions) {
                        const rs = Math.round(t0*sr), re = Math.round(t1*sr);
                        for (let i = Math.max(0, rs); i < Math.min(c.length, re); i++) {
                            let g = Math.max(stepDown*(i-rs), stepUp*(re-i));
                            if (g < duckDb) g = duckDb;
                            c[i] *= DB2LIN(g);
                        }
                    }
                }
            }
            proj.selRange = null;
            cfg.log(`  [builtin] AutoDuck ${regions.length} region(s) ${duckDb}dB (ctrl=T${ctrlIdx})`); return;
        }
        case 'DtmfTones': {
            const sr = proj.sr;
            const amp = mget(params,'Amplitude') ?? 0.8;
            const duty = (mget(params,'Duty_Cycle') ?? mget(params,'DutyCycle') ?? 55) / 100;
            const seq = mgetStr(params,'Sequence') || '';
            const n = seq.length, len = proj.length, out = new Float32Array(len);
            if (n > 0) {
                const denom = n*duty + (n-1)*(1-duty), slot = len / denom;
                let nTone = Math.floor(slot*duty), nSil = n>1 ? Math.floor(slot*(1-duty)) : 0;
                let diff = len - (n*nTone) - (n-1)*nSil;
                while (n>1 && diff > 2*n-1) { nTone += Math.floor(diff/n); nSil += Math.floor(diff/(n-1)); diff = len - (n*nTone) - (n-1)*nSil; }
                const fadeA = sr / 250;
                let pos = 0;
                for (let s=0; s<n && pos<len; s++) {
                    let tlen = nTone + (diff-- > 0 ? 1 : 0);
                    tlen = Math.min(tlen, len-pos);
                    const [f1,f2] = dtmfFreqs(seq[s]), A = 2*Math.PI*f1/sr, B = 2*Math.PI*f2/sr;
                    for (let k=0;k<tlen;k++) out[pos+k] = amp * 0.5 * ((f1?Math.sin(A*k):0) + (f2?Math.sin(B*k):0));
                    const fl = Math.min(tlen, fadeA);
                    for (let k=0;k<fl;k++) out[pos+k] *= k/fl;
                    const off = Math.trunc(tlen - fl);
                    for (let k=0;k<fl;k++) out[pos+off+k] *= 1 - k/fl;
                    pos += tlen;
                    if (s < n-1) { let slen = nSil + (diff-- > 0 ? 1 : 0); pos += Math.min(slen, len-pos); }
                }
            }
            for (const i of proj.selected) proj.tracks[i] = out.slice();
            proj.selRange = null;
            cfg.log(`  [generator] DtmfTones "${seq}" duty=${(duty*100)|0}%`); return;
        }
        }
        if (cmd === 'Import2') {
            const base = (mgetStr(params,'Filename') || '').split(/[\\/]/).pop();
            try {
                const r = decodeWavBytes(await fetchNoise(base));
                let npcm = r.sr !== proj.sr ? resampleAudio(r.pcm, r.sr, proj.sr) : r.pcm;
                if (npcm.length > proj.length) npcm = npcm.slice(0, proj.length);
                proj.tracks.push(npcm);
                if (proj.pans) proj.pans.push(0);
                proj.selected = new Set([proj.tracks.length - 1]);
                proj.length = Math.max(proj.length, npcm.length);
                proj.selRange = null;
                cfg.log(`  [project] Import2 ${base} (${npcm.length} smp @ ${proj.sr}Hz, cropped to project)`);
            } catch (e) { cfg.log(`  [skip] Import2 ${base} (not in ${cfg.noiseDir})`); }
            return;
        }
        if (PROJECT_NOOPS.has(cmd)) { cfg.log(`  [project-op] ${cmd}`); return; }
        await applyEffectToSelected(proj, cmd, params, report);
    }

    async function applyMacroText(pcm, sr, text, opts) {
        await ready();
        opts = opts || {};
        const onProgress = opts.onProgress || null;
        const onStep = opts.onStep || null;
        const proj = { sr, length: pcm.length, tracks: [new Float32Array(pcm)], pans: [0], selected: new Set([0]), clipboard: null, selRange: null, undoStack: [], redoStack: [], undoEnabled: false };

        const steps = [];
        for (const raw of text.split(/\r?\n/)) {
            const line = raw.trim();
            if (!line) continue;
            const ci = line.indexOf(':');
            if (ci < 0) continue;
            const cmd = line.slice(0, ci).trim();
            const params = line.slice(ci + 1);
            if (cmd.startsWith('Macro_') || cmd === 'Message') continue;
            steps.push({ cmd, params });
        }
        const total = steps.length;
        proj.undoEnabled = steps.some(st => st.cmd === 'Undo' || st.cmd === 'Redo');
        let maxUndoRun = 0; for (let i = 0, run = 0; i < total; i++) { if (steps[i].cmd === 'Undo') { run++; if (run > maxUndoRun) maxUndoRun = run; } else run = 0; }
        const undoCap = cfg.undoDepth || Math.max(maxUndoRun + 1, 2);
        if (proj.undoEnabled) cfg.log(`  [project] undo history capped at ${undoCap} (macro's deepest undo run = ${maxUndoRun})`);

        const startTime = Date.now();

        for (let s = 0; s < total; s++) {
            const { cmd, params } = steps[s];
            cfg.log(`[${s + 1}/${total}] ${cmd}`);
            if (onStep) onStep(s + 1, total, cmd);
            const report = (frac) => { if (onProgress) onProgress({ step: s + 1, total, cmd, fraction: (s + frac) / total }); };
            if (proj.undoEnabled && !NON_UNDOABLE.has(cmd)) {
                proj.undoStack.push(snapshotProj(proj));
                while (proj.undoStack.length > undoCap) proj.undoStack.shift();
                proj.redoStack.length = 0;
            }
            report(0);
            await applyStep(proj, cmd, params, report);
            report(1);
            if (typeof process !== 'undefined' && process.env && process.env.EMU_STEPTRACE) {
                const parts = proj.tracks.map((t, ti) => {
                    const ch = isStereo(t) ? [t.L, t.R] : [t]; let r = 0, n = 0, pk = 0;
                    for (const c of ch) { for (let j = 0; j < c.length; j++) { r += c[j]*c[j]; const a = Math.abs(c[j]); if (a > pk) pk = a; } n += c.length; }
                    return `${proj.selected.has(ti)?'*':' '}T${ti}rms=${(n?Math.sqrt(r/n):0).toExponential(1)}pk=${pk.toExponential(1)}`;
                });
                cfg.log(`    TR[${s+1}] ${cmd}: ${parts.join(' ')}`);
            }
        }
        if (onProgress) onProgress({ step: total, total, cmd: 'done', fraction: 1 });
        cfg.log(`done: ${total} steps -> ${proj.tracks.length} track[s] @ ${proj.sr} Hz (took ${((Date.now() - startTime)/1000).toFixed(2)} seconds wall-clock time)`);
        return { pcm: mixBuffers(proj.tracks, proj.length), sampleRate: proj.sr };
    }

    async function applyMacroFile(pcm, sr, file, opts) {
        return applyMacroText(pcm, sr, await fetchMacroText(file), opts);
    }

    global.AudacityMacroEngine = {
        config: cfg, ready, listMacros, loadMacroList, resolvePlugin, resolvePluginEntry, resetPluginPool,
        applyMacroText, applyMacroFile, fetchMacroText,
    };
})(typeof window !== 'undefined' ? window : globalThis);
