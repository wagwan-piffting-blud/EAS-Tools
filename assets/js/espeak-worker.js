importScripts('wasm-voice-cache.js');

var BASE = '../wasm_tts_voices/espeak/';
var WASM_URL = BASE + 'espeak-ng.wasm';
var DATA_URL = BASE + 'espeak-ng.eas.data';
var LOADER_URL = BASE + 'espeak-ng.eas.js';

var DEFAULT_VOICE = 'en-us';
var DEFAULT_RATE = 175;
var DEFAULT_PITCH = 50;
var MAX_CHUNK_CHARS = 2000;

self.__espeakNgScriptUrl = new URL(LOADER_URL, self.location.href).href;
importScripts(LOADER_URL);

var mod = null;
var ready = false;
var booting = false;
var queue = [];
var current = null;
var sampleRate = 22050;
var activeVoice = null;

function progress(msg) { postMessage({ type: 'progress', data: msg }); }

var reportDownload = WasmVoiceCache.makeAggregateProgress('eSpeak NG engine', function (u) {
    postMessage({ type: 'download', label: u.label, loaded: u.loaded, total: u.total });
});

function boot() {
    if (booting) return;
    booting = true;

    Promise.all([
        WasmVoiceCache.fetchCachedBlob(WASM_URL, { cacheKey: 'espeak/espeak-ng.wasm', onProgress: reportDownload('wasm') }),
        WasmVoiceCache.fetchCachedBlob(DATA_URL, { cacheKey: 'espeak/espeak-ng.eas.data', onProgress: reportDownload('data') }),
    ]).then(function (blobs) {
        progress('Initializing eSpeak NG...');
        return Promise.all([blobs[0].arrayBuffer(), blobs[1].arrayBuffer()]);
    }).then(function (buffers) {
        var wasmAb = buffers[0];
        var dataAb = buffers[1];
        return self.EspeakNgModule({
            instantiateWasm: function (imports, successCallback) {
                WebAssembly.instantiate(wasmAb, imports).then(function (result) {
                    successCallback(result.instance);
                }).catch(function (err) {
                    postMessage({ type: 'fatal', error: 'eSpeak NG wasm instantiation failed: ' + ((err && err.message) || err) });
                });
                return {};
            },
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
        var sr = mod.ccall('espeakng_init', 'number', ['string'], ['/']);
        if (!sr || sr <= 0) {
            postMessage({ type: 'fatal', error: 'eSpeak NG engine failed to initialize.' });
            return;
        }
        sampleRate = sr;
        if (!setVoice(DEFAULT_VOICE)) {
            postMessage({ type: 'fatal', error: 'eSpeak NG default voice is missing from the data package.' });
            return;
        }
        ready = true;
        postMessage({ type: 'ready' });
        pump();
    }).catch(function (err) {
        postMessage({ type: 'fatal', error: (err && err.message) ? err.message : ('' + err) });
    });
}

function setVoice(voice) {
    if (activeVoice === voice) return true;
    if (mod.ccall('espeakng_set_voice', 'number', ['string'], [voice]) !== 0) return false;
    activeVoice = voice;
    return true;
}

function splitForSynthesis(text) {
    if (text.length <= MAX_CHUNK_CHARS) return [text];
    var pieces = text.match(/[^.!?\n]+[.!?\n]*\s*/g) || [text];
    var chunks = [];
    var buf = '';
    for (var i = 0; i < pieces.length; i++) {
        var piece = pieces[i];
        while (piece.length > MAX_CHUNK_CHARS) {
            var cut = piece.lastIndexOf(' ', MAX_CHUNK_CHARS);
            if (cut <= 0) cut = MAX_CHUNK_CHARS;
            if (buf) { chunks.push(buf); buf = ''; }
            chunks.push(piece.slice(0, cut));
            piece = piece.slice(cut);
        }
        if (buf.length + piece.length > MAX_CHUNK_CHARS) {
            chunks.push(buf);
            buf = piece;
        } else {
            buf += piece;
        }
    }
    if (buf) chunks.push(buf);
    return chunks.filter(function (c) { return c.trim().length > 0; });
}

function synthesizeChunk(text) {
    var n = mod.ccall('espeakng_synthesize', 'number', ['string'], [text]);
    if (n === -3) throw new Error('eSpeak NG could not allocate its audio buffer.');
    if (n === -2) throw new Error('eSpeak NG rejected the announcement text.');
    if (n === -1) throw new Error('Announcement is too long for eSpeak NG to render in one pass.');
    if (n <= 0) throw new Error('eSpeak NG returned no audio.');
    var ptr = mod.ccall('espeakng_pcm', 'number', [], []);
    var out = new Float32Array(n);
    var heap = mod.HEAP16;
    var base = ptr >> 1;
    for (var i = 0; i < n; i++) out[i] = heap[base + i] / 32768;
    return out;
}

function pump() {
    if (!ready || current || !queue.length) return;
    current = queue.shift();
    try {
        var voice = current.voice || DEFAULT_VOICE;
        if (!setVoice(voice)) {
            postMessage({ type: 'synth-error', error: 'eSpeak NG voice "' + voice + '" is not in the data package.' });
            current = null;
            pump();
            return;
        }
        mod.ccall('espeakng_set_rate', 'number', ['number'], [current.rate]);
        mod.ccall('espeakng_set_pitch', 'number', ['number'], [current.pitch]);

        var chunks = splitForSynthesis(current.text);
        var rendered = [];
        var total = 0;
        for (var i = 0; i < chunks.length; i++) {
            var pcm = synthesizeChunk(chunks[i]);
            rendered.push(pcm);
            total += pcm.length;
        }
        var joined;
        if (rendered.length === 1) {
            joined = rendered[0];
        } else {
            joined = new Float32Array(total);
            var offset = 0;
            for (var j = 0; j < rendered.length; j++) {
                joined.set(rendered[j], offset);
                offset += rendered[j].length;
            }
        }
        postMessage({ type: 'audio', pcm: joined.buffer, sampleRate: sampleRate }, [joined.buffer]);
    } catch (err) {
        postMessage({ type: 'synth-error', error: (err && err.message) ? err.message : ('' + err) });
    }
    current = null;
    pump();
}

function clampNumber(value, min, max, fallback) {
    var n = Number(value);
    if (!isFinite(n)) return fallback;
    return Math.max(min, Math.min(max, Math.round(n)));
}

onmessage = function (e) {
    var m = e.data || {};
    if (m.type === 'synth') {
        queue.push({
            text: m.text,
            voice: m.voice || DEFAULT_VOICE,
            rate: clampNumber(m.rate, 80, 450, DEFAULT_RATE),
            pitch: clampNumber(m.pitch, 0, 99, DEFAULT_PITCH),
        });
        pump();
    }
};

boot();
