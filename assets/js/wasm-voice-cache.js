(function (scope) {
    var DB_NAME = 'eas-wasm-voice-cache';
    var STORE = 'files';
    var DB_VERSION = 1;
    var CACHE_VERSION = 'v1';
    var HEAD_TIMEOUT_MS = 8000;

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

    function idbDelete(key) {
        return openDb().then(function (db) {
            return new Promise(function (resolve, reject) {
                var tx = db.transaction(STORE, 'readwrite');
                tx.objectStore(STORE).delete(key);
                tx.oncomplete = function () { resolve(); };
                tx.onerror = function () { reject(tx.error); };
            });
        });
    }

    function deleteCached(cacheKeys) {
        var list = Array.isArray(cacheKeys) ? cacheKeys : [cacheKeys];
        return Promise.all(list.map(function (k) {
            return idbDelete(CACHE_VERSION + ':' + k).catch(function () { });
        }));
    }

    function pruneKeys(prefix, keepCacheKeys) {
        var keep = {};
        var list = Array.isArray(keepCacheKeys) ? keepCacheKeys : [];
        for (var i = 0; i < list.length; i++) keep[CACHE_VERSION + ':' + list[i]] = true;
        var full = CACHE_VERSION + ':' + prefix;
        return openDb().then(function (db) {
            return new Promise(function (resolve, reject) {
                var tx = db.transaction(STORE, 'readwrite');
                var store = tx.objectStore(STORE);
                var req = store.getAllKeys();
                req.onsuccess = function () {
                    var keys = req.result || [];
                    for (var i = 0; i < keys.length; i++) {
                        var k = keys[i];
                        if (typeof k === 'string' && k.indexOf(full) === 0 && !keep[k]) {
                            store.delete(k);
                        }
                    }
                };
                tx.oncomplete = function () { resolve(); };
                tx.onerror = function () { reject(tx.error); };
            });
        }).catch(function () { });
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
                    resolve({
                        blob: xhr.response,
                        head: {
                            etag: xhr.getResponseHeader('ETag') || '',
                            lastModified: xhr.getResponseHeader('Last-Modified') || '',
                        },
                    });
                } else {
                    reject(new Error('HTTP ' + xhr.status + ' for ' + url));
                }
            };
            xhr.onerror = function () { reject(new Error('Network error fetching ' + url)); };
            xhr.send();
        });
    }

    var _remoteBasePromise = null;
    function remoteBase() {
        if (_remoteBasePromise) return _remoteBasePromise;
        _remoteBasePromise = (scope.fetch ? scope.fetch('/remote-manifest.json') : Promise.reject())
            .then(function (r) { return (r && r.ok) ? r.json() : null; })
            .then(function (m) { return (m && m.platform === 'ios' && m.remoteBase) ? m.remoteBase : ''; })
            .catch(function () { return ''; });
        return _remoteBasePromise;
    }

    function resolveUrl(url) {
        return remoteBase().then(function (base) {
            if (base && !/^https?:\/\//i.test(url)) {
                try {
                    var abs = new URL(url, (scope.location && scope.location.href) || undefined);
                    return base + abs.pathname.replace(/^\//, '') + abs.search;
                } catch (e) { }
            }
            return url;
        });
    }

    function bustUrl(url) {
        return url + (url.indexOf('?') === -1 ? '?' : '&') + 'cb=' + Date.now();
    }

    function headValidators(url) {
        if (typeof scope.fetch !== 'function') return Promise.resolve(null);
        var opts = { method: 'HEAD', cache: 'no-store' };
        var timer = null;
        try {
            if (typeof AbortController === 'function') {
                var ctl = new AbortController();
                opts.signal = ctl.signal;
                timer = setTimeout(function () { ctl.abort(); }, HEAD_TIMEOUT_MS);
            }
        } catch (e) { }
        return scope.fetch(url, opts).then(function (r) {
            if (timer) clearTimeout(timer);
            if (!r || !r.ok) return null;
            var enc = (r.headers.get('content-encoding') || '').toLowerCase();
            var len = parseInt(r.headers.get('content-length') || '', 10);
            return {
                etag: r.headers.get('etag') || '',
                lastModified: r.headers.get('last-modified') || '',
                contentLength: isFinite(len) ? len : -1,
                encoded: !!(enc && enc !== 'identity'),
            };
        }).catch(function () {
            if (timer) clearTimeout(timer);
            return null;
        });
    }

    function unwrapRecord(value) {
        if (value instanceof Blob) {
            return { blob: value, etag: '', lastModified: '' };
        }
        if (value && value.blob instanceof Blob) {
            return { blob: value.blob, etag: value.etag || '', lastModified: value.lastModified || '' };
        }
        return null;
    }

    function validatorsMatch(rec, head) {
        if (!head) return true;
        if (rec.etag && head.etag) return rec.etag === head.etag;
        if (rec.lastModified && head.lastModified) return rec.lastModified === head.lastModified;
        if (!head.encoded && head.contentLength >= 0) return head.contentLength === rec.blob.size;
        return true;
    }

    function storeRecord(key, blob, head) {
        return idbPut(key, {
            blob: blob,
            etag: (head && head.etag) || '',
            lastModified: (head && head.lastModified) || '',
            savedAt: Date.now(),
        }).catch(function () { });
    }

    function fetchCachedBlob(url, opts) {
        opts = opts || {};
        var key = CACHE_VERSION + ':' + (opts.cacheKey || url);
        var onProgress = opts.onProgress;
        var expectedBytes = (typeof opts.expectedBytes === 'number' && isFinite(opts.expectedBytes)) ? opts.expectedBytes : null;
        var revalidate = opts.revalidate !== false;

        return resolveUrl(url).then(function (fetchUrl) {
            return idbGet(key).catch(function () { return null; }).then(function (raw) {
                var rec = unwrapRecord(raw);

                var serveCached = function () {
                    if (onProgress) onProgress({ phase: 'cache', loaded: rec.blob.size, total: rec.blob.size });
                    return rec.blob;
                };

                var download = function (bust) {
                    return fetchBlobWithProgress(bust ? bustUrl(fetchUrl) : fetchUrl, onProgress).then(function (result) {
                        return storeRecord(key, result.blob, result.head).then(function () { return result.blob; });
                    });
                };

                if (!rec || !rec.blob || !rec.blob.size) {
                    return download(false);
                }

                if (expectedBytes !== null) {
                    if (rec.blob.size === expectedBytes) return serveCached();
                    return download(true);
                }

                if (!revalidate) {
                    return serveCached();
                }

                return headValidators(fetchUrl).then(function (head) {
                    if (validatorsMatch(rec, head)) {
                        if (head && ((!rec.etag && head.etag) || (!rec.lastModified && head.lastModified))) {
                            storeRecord(key, rec.blob, head);
                        }
                        return serveCached();
                    }
                    return download(true);
                });
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
        deleteCached: deleteCached,
        pruneKeys: pruneKeys,
        resolveUrl: resolveUrl,
        makeAggregateProgress: makeAggregateProgress,
    };
})(typeof self !== 'undefined' ? self : this);
