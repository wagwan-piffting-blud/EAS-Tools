importScripts('wasm-voice-cache.js');
importScripts('acu.js');

var WASM_URL = '../wasm_tts_voices/acuvoice/acu.wasm';
var DATA_URL = '../wasm_tts_voices/acuvoice/acu.data';
var SAMPLE_RATE = 8000;

var ULAW = new Int16Array(256);
(function () {
    for (var i = 0; i < 256; i++) {
        var x = (~i) & 0xff, s = x & 0x80, e = (x >> 4) & 7, m = x & 0x0f;
        var v = (((m << 3) + 0x84) << e) - 0x84;
        ULAW[i] = s ? -v : v;
    }
})();

var mod = null;
var ready = false;
var booting = false;
var queue = [];
var current = null;

function progress(msg) { postMessage({ type: 'progress', data: msg }); }

var reportDownload = WasmVoiceCache.makeAggregateProgress('AcuVoice voicebank', function (u) {
    postMessage({ type: 'download', label: u.label, loaded: u.loaded, total: u.total });
});

function boot() {
    if (booting) return;
    booting = true;

    Promise.all([
        WasmVoiceCache.fetchCachedBlob(WASM_URL, { cacheKey: 'acuvoice/acu.wasm', onProgress: reportDownload('wasm') }),
        WasmVoiceCache.fetchCachedBlob(DATA_URL, { cacheKey: 'acuvoice/acu.data', onProgress: reportDownload('data') }),
    ]).then(function (blobs) {
        progress('Initializing AcuVoice (unpacking voicebank)...');
        return Promise.all([blobs[0].arrayBuffer(), blobs[1].arrayBuffer()]);
    }).then(function (buffers) {
        var wasmAb = buffers[0];
        var dataAb = buffers[1];
        return AcuModule({
            wasmBinary: new Uint8Array(wasmAb),
            getPreloadedPackage: function () { return dataAb; },
            locateFile: function (path, prefix) {
                if (path.slice(-5) === '.data') return DATA_URL;
                if (path.slice(-5) === '.wasm') return WASM_URL;
                return prefix + path;
            },
            print: function () { },
            printErr: function () { },
        });
    }).then(function (m) {
        mod = m;
        var ok = mod.ccall('acu_boot_wasm', 'number', [], []);
        if (!ok) {
            postMessage({ type: 'fatal', error: 'AcuVoice engine failed to initialize.' });
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
        var len = mod.ccall('acu_synth_wasm', 'number', ['string'], [current.text]);
        if (len <= 0) {
            postMessage({ type: 'synth-error', error: 'Synthesis returned empty audio.' });
        } else {
            var ptr = mod.ccall('acu_ulaw_ptr', 'number', [], []);
            var ulaw = mod.HEAPU8.subarray(ptr, ptr + len);
            var f32 = new Float32Array(len);
            for (var i = 0; i < len; i++) f32[i] = ULAW[ulaw[i]] / 32768;
            postMessage({ type: 'audio', pcm: f32.buffer, sampleRate: SAMPLE_RATE }, [f32.buffer]);
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
