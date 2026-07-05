importScripts('wasm-voice-cache.js');
importScripts('spfy_wasm.js');

var WASM_URL = '../wasm_tts_voices/spfy/spfy_wasm.wasm';
var DATA_URL = '../wasm_tts_voices/spfy/spfy_wasm.data';

var mod = null;
var api = null;
var ready = false;
var booting = false;
var queue = [];
var current = null;

function progress(msg) { postMessage({ type: 'progress', data: msg }); }

var reportDownload = WasmVoiceCache.makeAggregateProgress('Speechify voice', function (u) {
    postMessage({ type: 'download', label: u.label, loaded: u.loaded, total: u.total });
});

function boot() {
    if (booting) return;
    booting = true;

    Promise.all([
        WasmVoiceCache.fetchCachedBlob(WASM_URL, { cacheKey: 'spfy/spfy_wasm.wasm', onProgress: reportDownload('wasm') }),
        WasmVoiceCache.fetchCachedBlob(DATA_URL, { cacheKey: 'spfy/spfy_wasm.data', onProgress: reportDownload('data') }),
    ]).then(function (blobs) {
        var wasmBlob = blobs[0];
        var dataBlob = blobs[1];
        progress('Initializing Speechify voice...');
        var dataUrl = URL.createObjectURL(dataBlob);
        return wasmBlob.arrayBuffer().then(function (wasmAb) {
            return createSpfyModule({
                wasmBinary: new Uint8Array(wasmAb),
                locateFile: function (path, prefix) {
                    if (path.slice(-5) === '.data') return dataUrl;
                    if (path.slice(-5) === '.wasm') return WASM_URL;
                    return prefix + path;
                },
                print: function () { },
                printErr: function () { },
            }).then(function (m) {
                try { URL.revokeObjectURL(dataUrl); } catch (e) { }
                return m;
            });
        });
    }).then(function (m) {
        mod = m;
        api = {
            init: mod.cwrap('spfy_wasm_init', 'number', ['string']),
            synth: mod.cwrap('spfy_wasm_synth', 'number', ['string']),
            pcmPtr: mod.cwrap('spfy_wasm_pcm_ptr', 'number', []),
            pcmLen: mod.cwrap('spfy_wasm_pcm_len', 'number', []),
            sampleRate: mod.cwrap('spfy_wasm_sample_rate', 'number', []),
        };
        var rc = api.init('/voice');
        if (rc !== 0) {
            postMessage({ type: 'fatal', error: 'Speechify voice failed to load (code ' + rc + ').' });
            return;
        }
        ready = true;
        postMessage({ type: 'ready' });
        pump();
    }).catch(function (err) {
        postMessage({ type: 'fatal', error: (err && err.message) ? err.message : ('' + err) });
    });
}

function pump() {
    if (!ready || current || !queue.length) return;
    current = queue.shift();
    try {
        var rc = api.synth(current.text);
        if (rc !== 0) {
            postMessage({ type: 'synth-error', error: 'Synthesis failed (code ' + rc + ').' });
        } else {
            var ptr = api.pcmPtr();
            var n = api.pcmLen();
            var sr = api.sampleRate();
            if (!ptr || !n) {
                postMessage({ type: 'synth-error', error: 'Synthesis returned empty audio.' });
            } else {
                var view = mod.HEAP16.subarray(ptr >> 1, (ptr >> 1) + n);
                var f32 = new Float32Array(n);
                for (var i = 0; i < n; i++) f32[i] = view[i] / 32768;
                postMessage({ type: 'audio', pcm: f32.buffer, sampleRate: sr }, [f32.buffer]);
            }
        }
    } catch (err) {
        postMessage({ type: 'synth-error', error: (err && err.message) ? err.message : ('' + err) });
    }
    current = null;
    pump();
}

onmessage = function (e) {
    var m = e.data || {};
    if (m.type === 'synth') {
        queue.push({ text: m.text });
        pump();
    }
};

boot();
