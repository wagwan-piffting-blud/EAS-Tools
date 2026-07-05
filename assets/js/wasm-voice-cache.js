(function (scope) {
    var DB_NAME = 'eas-wasm-voice-cache';
    var STORE = 'files';
    var DB_VERSION = 1;
    var CACHE_VERSION = 'v1';

    var dbPromise = null;

    function openDb() {
        if (dbPromise) return dbPromise;
        dbPromise = new Promise(function (resolve, reject) {
            if (!scope.indexedDB) {
                reject(new Error('IndexedDB unavailable'));
                return;
            }
            var req = scope.indexedDB.open(DB_NAME, DB_VERSION);
            req.onupgradeneeded = function () {
                if (!req.result.objectStoreNames.contains(STORE)) {
                    req.result.createObjectStore(STORE);
                }
            };
            req.onsuccess = function () { resolve(req.result); };
            req.onerror = function () { reject(req.error); };
        });
        return dbPromise;
    }

    function idbGet(key) {
        return openDb().then(function (db) {
            return new Promise(function (resolve, reject) {
                var tx = db.transaction(STORE, 'readonly');
                var req = tx.objectStore(STORE).get(key);
                req.onsuccess = function () { resolve(req.result || null); };
                req.onerror = function () { reject(req.error); };
            });
        });
    }

    function idbPut(key, value) {
        return openDb().then(function (db) {
            return new Promise(function (resolve, reject) {
                var tx = db.transaction(STORE, 'readwrite');
                tx.objectStore(STORE).put(value, key);
                tx.oncomplete = function () { resolve(); };
                tx.onerror = function () { reject(tx.error); };
            });
        });
    }

    function fetchBlobWithProgress(url, onProgress) {
        return new Promise(function (resolve, reject) {
            var xhr = new XMLHttpRequest();
            xhr.open('GET', url, true);
            xhr.responseType = 'blob';
            xhr.onprogress = function (event) {
                if (onProgress) {
                    onProgress({ phase: 'download', loaded: event.loaded || 0, total: event.total || 0 });
                }
            };
            xhr.onload = function () {
                if (xhr.status >= 200 && xhr.status < 300) {
                    resolve(xhr.response);
                } else {
                    reject(new Error('HTTP ' + xhr.status + ' for ' + url));
                }
            };
            xhr.onerror = function () { reject(new Error('Network error fetching ' + url)); };
            xhr.send();
        });
    }

    function fetchCachedBlob(url, opts) {
        opts = opts || {};
        var key = CACHE_VERSION + ':' + (opts.cacheKey || url);
        var onProgress = opts.onProgress;

        return idbGet(key).catch(function () { return null; }).then(function (hit) {
            if (hit instanceof Blob && hit.size > 0) {
                if (onProgress) onProgress({ phase: 'cache', loaded: hit.size, total: hit.size });
                return hit;
            }
            return fetchBlobWithProgress(url, onProgress).then(function (blob) {
                return idbPut(key, blob).catch(function () { }).then(function () { return blob; });
            });
        });
    }

    function makeAggregateProgress(label, sink) {
        var files = {};
        return function (key) {
            return function (p) {
                if (!p || p.phase !== 'download') return;
                files[key] = { loaded: p.loaded || 0, total: p.total || 0 };
                var loaded = 0, total = 0, known = true;
                for (var k in files) {
                    loaded += files[k].loaded;
                    total += files[k].total;
                    if (!files[k].total) known = false;
                }
                sink({ label: label, loaded: loaded, total: known ? total : 0 });
            };
        };
    }

    scope.WasmVoiceCache = {
        fetchCachedBlob: fetchCachedBlob,
        idbGet: idbGet,
        idbPut: idbPut,
        makeAggregateProgress: makeAggregateProgress,
    };
})(typeof self !== 'undefined' ? self : this);
