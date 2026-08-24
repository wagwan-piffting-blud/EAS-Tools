importScripts('wasm-voice-cache.js');
importScripts('spfy_wasm.js');

var BASE_URL = '../wasm_tts_voices/spfy/';
var WASM_URL = BASE_URL + 'spfy_wasm.wasm';
var MANIFEST_URL = BASE_URL + 'voices/manifest.json';
var WASM_CACHE_KEY = 'spfy/spfy_wasm.wasm';
var DEFAULT_VOICE = 'tom';
var FS_DIR = '/voice';
var WRITE_CHUNK = 8 * 1024 * 1024;

var manifest = null;
var wasmBytes = null;
var mod = null;
var api = null;
var loadedVoice = null;
var ready = false;
var booting = false;
var busy = false;
var queue = [];

function progress(msg) { postMessage({ type: 'progress', data: msg }); }

function makeDownloadSink(label) {
    return WasmVoiceCache.makeAggregateProgress(label, function (u) {
        postMessage({ type: 'download', label: u.label, loaded: u.loaded, total: u.total });
    });
}

function voicePartKey(voice, f, idx) {
    return 'spfy/voices/' + voice.dir + '/' + f.name + '@' + f.bytes + '.part' + idx;
}

function currentCacheKeys() {
    var keep = [WASM_CACHE_KEY];
    var list = (manifest && manifest.voices) || [];
    for (var i = 0; i < list.length; i++) {
        var v = list[i];
        var files = v.files || [];
        for (var j = 0; j < files.length; j++) {
            var f = files[j];
            var parts = f.parts || [];
            for (var k = 0; k < parts.length; k++) {
                keep.push(voicePartKey(v, f, k));
            }
        }
    }
    return keep;
}

function boot() {
    if (booting) return;
    booting = true;

    var reportDownload = makeDownloadSink('Speechify engine');
    WasmVoiceCache.resolveUrl(MANIFEST_URL).then(function (manifestUrl) {
        return fetch(manifestUrl, { cache: 'no-store' });
    }).then(function (r) {
        if (!r || !r.ok) throw new Error('Speechify voice manifest fetch failed (HTTP ' + (r ? r.status : '?') + ').');
        return r.json();
    }).then(function (m) {
        manifest = m;
        if (!manifest || !manifest.voices || !manifest.voices.length) {
            throw new Error('Speechify voice manifest is empty.');
        }
        WasmVoiceCache.pruneKeys('spfy/', currentCacheKeys());
        return WasmVoiceCache.fetchCachedBlob(WASM_URL, {
            cacheKey: WASM_CACHE_KEY,
            revalidate: true,
            onProgress: reportDownload('wasm'),
        });
    }).then(function (blob) {
        return blob.arrayBuffer();
    }).then(function (ab) {
        wasmBytes = new Uint8Array(ab);
        ready = true;
        postMessage({ type: 'ready' });
        pump();
    }).catch(function (err) {
        postMessage({ type: 'fatal', error: (err && err.message) ? err.message : ('' + err) });
    });
}

function defaultVoiceId() {
    return (manifest && manifest.default) || DEFAULT_VOICE;
}

function findVoice(id) {
    var want = ('' + (id || defaultVoiceId())).toLowerCase();
    var list = (manifest && manifest.voices) || [];
    for (var i = 0; i < list.length; i++) {
        if (('' + list[i].id).toLowerCase() === want) return list[i];
    }
    return null;
}

function partUrl(voice, part) {
    if (/^https?:\/\//i.test(part)) return part;
    return BASE_URL + 'voices/' + voice.dir + '/' + part;
}

function createModule() {
    return createSpfyModule({
        wasmBinary: wasmBytes,
        locateFile: function (path, prefix) {
            if (path.slice(-5) === '.wasm') return WASM_URL;
            return prefix + path;
        },
        print: function () { },
        printErr: function () { },
    });
}

function writeBlobChunks(m, stream, blob, pos) {
    var offset = 0;
    function next() {
        if (offset >= blob.size) return Promise.resolve(pos);
        var slice = blob.slice(offset, Math.min(offset + WRITE_CHUNK, blob.size));
        return slice.arrayBuffer().then(function (ab) {
            var u8 = new Uint8Array(ab);
            m.FS.write(stream, u8, 0, u8.length, pos);
            pos += u8.length;
            offset += u8.length;
            return next();
        });
    }
    return next();
}

function writeVoiceFile(m, name, partBlobs) {
    var stream = m.FS.open(FS_DIR + '/' + name, 'w');
    var p = Promise.resolve(0);
    for (var i = 0; i < partBlobs.length; i++) {
        (function (blob) {
            p = p.then(function (pos) { return writeBlobChunks(m, stream, blob, pos); });
        })(partBlobs[i]);
    }
    return p.then(function () {
        m.FS.close(stream);
    }, function (err) {
        try { m.FS.close(stream); } catch (e) { }
        throw err;
    });
}

function ensureVoice(voiceId) {
    var voice = findVoice(voiceId);
    if (!voice) return Promise.reject(new Error('Unknown Speechify voice "' + voiceId + '".'));
    if (mod && api && loadedVoice === voice.id) return Promise.resolve();

    mod = null;
    api = null;
    loadedVoice = null;

    var reportDownload = makeDownloadSink('Speechify voice (' + voice.display + ')');
    progress('Downloading Speechify voice "' + voice.display + '"...');

    var fetches = voice.files.map(function (f) {
        return Promise.all(f.parts.map(function (part, idx) {
            return WasmVoiceCache.fetchCachedBlob(partUrl(voice, part), {
                cacheKey: voicePartKey(voice, f, idx),
                expectedBytes: f.parts.length === 1 ? f.bytes : null,
                onProgress: reportDownload(f.name + '#' + idx),
            });
        }));
    });

    return Promise.all(fetches).then(function (fileParts) {
        progress('Initializing Speechify voice "' + voice.display + '"...');
        return createModule().then(function (m) {
            try { m.FS.mkdir(FS_DIR); } catch (e) { }
            var p = Promise.resolve();
            voice.files.forEach(function (f, fi) {
                p = p.then(function () { return writeVoiceFile(m, f.name, fileParts[fi]); });
            });
            return p.then(function () { return m; });
        });
    }).then(function (m) {
        var voiceApi = {
            init: m.cwrap('spfy_wasm_init', 'number', ['string', 'string']),
            synth: m.cwrap('spfy_wasm_synth', 'number', ['string']),
            pcmPtr: m.cwrap('spfy_wasm_pcm_ptr', 'number', []),
            pcmLen: m.cwrap('spfy_wasm_pcm_len', 'number', []),
            sampleRate: m.cwrap('spfy_wasm_sample_rate', 'number', []),
        };
        var rc = voiceApi.init(FS_DIR, voice.prefix);
        if (rc !== 0) {
            throw new Error('Speechify voice "' + voice.display + '" failed to load (code ' + rc + ').');
        }
        mod = m;
        api = voiceApi;
        loadedVoice = voice.id;
        progress('Speechify voice "' + voice.display + '" ready.');
    });
}

function runSynth(job) {
    return ensureVoice(job.voice).then(function () {
        var rc = api.synth(job.text);
        if (rc !== 0) {
            postMessage({ type: 'synth-error', error: 'Synthesis failed (code ' + rc + ').' });
            return;
        }
        var ptr = api.pcmPtr();
        var n = api.pcmLen();
        var sr = api.sampleRate();
        if (!ptr || !n) {
            postMessage({ type: 'synth-error', error: 'Synthesis returned empty audio.' });
            return;
        }
        var view = mod.HEAP16.subarray(ptr >> 1, (ptr >> 1) + n);
        var f32 = new Float32Array(n);
        for (var i = 0; i < n; i++) f32[i] = view[i] / 32768;
        postMessage({ type: 'audio', pcm: f32.buffer, sampleRate: sr }, [f32.buffer]);
    });
}

function pump() {
    if (!ready || busy || !queue.length) return;
    busy = true;
    var job = queue.shift();
    runSynth(job).catch(function (err) {
        postMessage({ type: 'synth-error', error: (err && err.message) ? err.message : ('' + err) });
    }).then(function () {
        busy = false;
        pump();
    });
}

onmessage = function (e) {
    var m = e.data || {};
    if (m.type === 'synth') {
        queue.push({ text: m.text, voice: m.voice || null });
        pump();
    }
};

boot();
