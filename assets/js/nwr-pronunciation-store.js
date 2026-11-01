import {
    LIMITS,
    SCHEMA_VERSION,
    SUBMISSION_ACTIONS,
    SUBMISSION_APPS,
    DEFAULT_VOICES,
    compileMatcher,
    entryKey,
    isSetId,
    mergeLayers,
    normalizeMatch,
    parseSourceId,
    resolveProsody,
    slugifyMatch,
    validateEntry,
    validateProsody,
    validatePronunciationSet,
} from './nwr-pronunciation.js';

export const SELECTION_KEY = 'eas-tools-nwr-pron-selection';
export const PERSONAL_KEY = 'eas-tools-nwr-pron-personal';
export const SUBMISSIONS_KEY = 'eas-tools-nwr-pron-submissions';
export const CACHE_KEY = 'eas-tools-nwr-pron-cache';
export const SELECTION_CHANGE = 'eas:nwr-pron-selection-change';
export const PERSONAL_CHANGE = 'eas:nwr-pron-personal-change';
export const EXPORT_TYPE = 'eas-tools-nwr-pronunciation';
export const MAX_SUBMISSIONS = 50;
export const CACHE_MAX_CHARS = 512 * 1024;

const PERSONAL_SCOPE_RE = /^(?:all|wfo:[A-Z]{3}|tx:[A-Z0-9]{3,7})$/;

const defaultStorage = () => {
    try {
        return globalThis.localStorage || null;
    } catch {
        return null;
    }
};

const isObject = (value) => !!value && typeof value === 'object' && !Array.isArray(value);

function readJson(storage, key, fallback) {
    try {
        const raw = storage?.getItem(key);
        if (!raw) return fallback;
        return JSON.parse(raw);
    } catch {
        return fallback;
    }
}

function writeJson(storage, key, value) {
    try {
        storage.setItem(key, JSON.stringify(value));
        return true;
    } catch {
        return false;
    }
}

function emit(target, type, detail) {
    if (target && typeof target.dispatchEvent === 'function' && typeof CustomEvent === 'function') {
        target.dispatchEvent(new CustomEvent(type, { detail }));
    }
}

export function defaultSelection() {
    return { version: 1, enabled: true, source: '' };
}

export function readSelection(storage = defaultStorage()) {
    const raw = readJson(storage, SELECTION_KEY, null);
    const out = defaultSelection();
    if (!isObject(raw)) return out;
    if (typeof raw.enabled === 'boolean') out.enabled = raw.enabled;
    if (typeof raw.source === 'string' && parseSourceId(raw.source)) out.source = parseSourceId(raw.source).type === 'national' ? '' : raw.source;
    return out;
}

export function writeSelection(next, { storage = defaultStorage(), target = globalThis } = {}) {
    if (!storage) return { ok: false, error: 'This browser is not letting the page save settings.' };
    const current = readSelection(storage);
    const merged = { ...current };
    if (next && typeof next.enabled === 'boolean') merged.enabled = next.enabled;
    if (next && next.source !== undefined) {
        const parsed = parseSourceId(next.source);
        if (!parsed) return { ok: false, error: 'Pick an office (wfo:XXX) or transmitter (tx:CALLSIGN).' };
        merged.source = parsed.type === 'national' ? '' : String(next.source).trim();
    }
    if (!writeJson(storage, SELECTION_KEY, merged)) return { ok: false, error: 'Could not save the pronunciation setting.' };
    emit(target, SELECTION_CHANGE, { selection: { ...merged } });
    return { ok: true, selection: merged };
}

export function onSelectionChange(handler, { target = globalThis, storage = defaultStorage() } = {}) {
    if (!target || typeof target.addEventListener !== 'function') return () => { };
    const local = () => handler(readSelection(storage));
    const remote = (event) => {
        if (event.key === SELECTION_KEY || event.key === null) handler(readSelection(storage));
    };
    target.addEventListener(SELECTION_CHANGE, local);
    target.addEventListener('storage', remote);
    return () => {
        target.removeEventListener(SELECTION_CHANGE, local);
        target.removeEventListener('storage', remote);
    };
}

export function snapshotSelection(storage = defaultStorage()) {
    const { enabled, source } = readSelection(storage);
    return { enabled, source };
}

function cleanPersonalEntry(raw) {
    if (!isObject(raw)) return null;
    const scope = PERSONAL_SCOPE_RE.test(String(raw.scope ?? '')) ? raw.scope : 'all';
    const entry = {
        id: String(raw.id ?? ''),
        scope,
        match: normalizeMatch(raw.match),
        caseSensitive: raw.caseSensitive === true,
    };
    if (raw.disabled === true) entry.disabled = true;
    if (isObject(raw.replace)) entry.replace = { ...raw.replace };
    if (typeof raw.notes === 'string' && raw.notes) entry.notes = raw.notes.slice(0, LIMITS.notesChars);
    if (!entry.id) entry.id = slugifyMatch(entry.match);
    return validateEntry(entry, 'entry', { personal: true }).length ? null : entry;
}

export function readPersonal(storage = defaultStorage()) {
    const raw = readJson(storage, PERSONAL_KEY, null);
    const list = Array.isArray(raw?.entries) ? raw.entries : [];
    const out = [];
    const seen = new Set();
    for (const item of list) {
        const entry = cleanPersonalEntry(item);
        if (!entry) continue;
        const key = entry.scope + '|' + entryKey(entry);
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(entry);
        if (out.length >= LIMITS.personalEntries) break;
    }
    return out;
}

function writePersonal(entries, storage, target) {
    if (!writeJson(storage, PERSONAL_KEY, { version: 1, entries })) return false;
    emit(target, PERSONAL_CHANGE, { entries: entries.map((e) => ({ ...e })) });
    return true;
}

export function savePersonalEntry(raw, { storage = defaultStorage(), target = globalThis } = {}) {
    if (!storage) return { ok: false, error: 'This browser is not letting the page save settings.' };
    const candidate = { ...raw, match: normalizeMatch(raw?.match) };
    if (!candidate.id) candidate.id = slugifyMatch(candidate.match);
    if (!PERSONAL_SCOPE_RE.test(String(candidate.scope ?? 'all'))) return { ok: false, error: 'Scope must be all, an office or a transmitter.' };
    const problems = validateEntry({ ...candidate, scope: undefined }, 'entry', { personal: true });
    if (problems.length) return { ok: false, error: problems[0].problem, problems };
    const entry = cleanPersonalEntry(candidate);
    const entries = readPersonal(storage);
    const key = entry.scope + '|' + entryKey(entry);
    const at = entries.findIndex((e) => e.scope + '|' + entryKey(e) === key || (e.id === entry.id && e.scope === entry.scope));
    if (at < 0 && entries.length >= LIMITS.personalEntries) return { ok: false, error: 'You can keep up to ' + LIMITS.personalEntries + ' personal pronunciations.' };
    if (at >= 0) entries[at] = entry;
    else entries.push(entry);
    if (!writePersonal(entries, storage, target)) return { ok: false, error: 'Could not save the pronunciation.' };
    return { ok: true, entry, replaced: at >= 0, entries };
}

export function removePersonalEntry(id, scope, { storage = defaultStorage(), target = globalThis } = {}) {
    const entries = readPersonal(storage);
    const kept = entries.filter((e) => !(e.id === id && e.scope === scope));
    if (!storage || kept.length === entries.length) return { ok: false, entries };
    writePersonal(kept, storage, target);
    return { ok: true, entries: kept };
}

export function personalForSource(entries, source, txWfo = '') {
    const scopes = new Set(['all']);
    if (source) scopes.add(source);
    if (txWfo) scopes.add('wfo:' + txWfo);
    return entries.filter((e) => scopes.has(e.scope));
}

export function exportPersonal(entries, scope = null) {
    const list = scope ? entries.filter((e) => e.scope === scope) : entries;
    return { type: EXPORT_TYPE, version: 1, scope: scope || 'mixed', entries: list.map((e) => ({ ...e })) };
}

export function importPersonal(envelope, { storage = defaultStorage(), target = globalThis } = {}) {
    if (!isObject(envelope) || envelope.type !== EXPORT_TYPE || envelope.version !== 1 || !Array.isArray(envelope.entries)) {
        return { ok: false, error: 'This is not an EAS Tools pronunciation file.' };
    }
    if (!storage) return { ok: false, error: 'This browser is not letting the page save settings.' };
    let added = 0;
    let skipped = 0;
    let lastError = '';
    for (const item of envelope.entries) {
        const result = savePersonalEntry(item, { storage, target: null });
        if (result.ok) added++;
        else {
            skipped++;
            lastError = result.error;
        }
    }
    const entries = readPersonal(storage);
    emit(target, PERSONAL_CHANGE, { entries });
    return { ok: added > 0 || envelope.entries.length === 0, added, skipped, error: lastError, entries };
}

export function readSubmissions(storage = defaultStorage()) {
    const raw = readJson(storage, SUBMISSIONS_KEY, []);
    return (Array.isArray(raw) ? raw : []).filter((s) => isObject(s) && typeof s.id === 'string' && typeof s.token === 'string');
}

export function recordSubmission(record, storage = defaultStorage()) {
    const list = readSubmissions(storage).filter((s) => s.id !== record.id);
    list.unshift({ ...record });
    writeJson(storage, SUBMISSIONS_KEY, list.slice(0, MAX_SUBMISSIONS));
    return list.slice(0, MAX_SUBMISSIONS);
}

export function updateSubmission(id, patch, storage = defaultStorage()) {
    const list = readSubmissions(storage).map((s) => (s.id === id ? { ...s, ...patch } : s));
    writeJson(storage, SUBMISSIONS_KEY, list);
    return list;
}

export function buildSubmission({ target, action, entries = [], prosody, evidence = {}, client = {} } = {}) {
    const problems = [];
    if (!isSetId(target)) problems.push({ path: 'target', problem: 'Pick national, an office or a transmitter.' });
    if (!SUBMISSION_ACTIONS.includes(action)) problems.push({ path: 'action', problem: 'Choose add, change, remove or prosody.' });
    if (!Array.isArray(entries) || entries.length > LIMITS.submissionEntries) {
        problems.push({ path: 'entries', problem: 'Send at most ' + LIMITS.submissionEntries + ' pronunciations at a time.' });
    }
    const cleanEntries = (Array.isArray(entries) ? entries : []).map((raw) => {
        const entry = { ...raw };
        delete entry.scope;
        delete entry.disabled;
        if (!entry.id) entry.id = slugifyMatch(entry.match);
        return entry;
    });
    cleanEntries.forEach((entry, i) => problems.push(...validateEntry(entry, 'entries[' + i + ']')));
    if (action === 'prosody') {
        if (!isObject(prosody)) problems.push({ path: 'prosody', problem: 'Include the speed or pause values.' });
        else problems.push(...validateProsody(prosody));
    } else if (!cleanEntries.length) {
        problems.push({ path: 'entries', problem: 'Include at least one pronunciation.' });
    }
    const notes = String(evidence?.notes ?? '');
    if (notes.length > LIMITS.evidenceNotesChars) problems.push({ path: 'evidence.notes', problem: 'Keep notes to ' + LIMITS.evidenceNotesChars + ' characters.' });
    const links = Array.isArray(evidence?.links) ? evidence.links.map((l) => String(l).trim()).filter(Boolean) : [];
    if (links.length > LIMITS.evidenceLinks) problems.push({ path: 'evidence.links', problem: 'Include at most ' + LIMITS.evidenceLinks + ' links.' });
    links.forEach((link, i) => {
        if (!/^https:\/\/[^\s<>"]{3,500}$/.test(link)) problems.push({ path: 'evidence.links[' + i + ']', problem: 'Links must start with https://' });
    });
    const app = SUBMISSION_APPS.includes(client?.app) ? client.app : 'web';
    if (problems.length) return { ok: false, error: problems[0].problem, problems };
    const payload = {
        schemaVersion: SCHEMA_VERSION,
        client: { app, version: String(client?.version ?? '').slice(0, 40) },
        target,
        action,
        entries: cleanEntries,
        evidence: { notes, links },
    };
    if (action === 'prosody') payload.prosody = prosody;
    const body = new URLSearchParams();
    body.set('payload', JSON.stringify(payload));
    body.set('website', '');
    return { ok: true, payload, body: body.toString() };
}

export function parseApiResponse(status, text, retryAfterHeader = null) {
    let data = null;
    try {
        data = JSON.parse(text);
    } catch {
        data = null;
    }
    if (status >= 200 && status < 300 && isObject(data) && data.ok !== false) return { ok: true, status, data };
    const retry = Number(retryAfterHeader ?? data?.retryAfter);
    return {
        ok: false,
        status,
        code: data?.code || (status === 429 ? 'rate_limited' : status === 0 ? 'network' : 'server'),
        error: data?.error || (status === 0 ? 'Could not reach the TTS server.' : 'The TTS server answered with status ' + status + '.'),
        details: Array.isArray(data?.details) ? data.details : [],
        retryAfter: Number.isFinite(retry) && retry > 0 ? retry : null,
    };
}

function okResponse(response) {
    return !!response && (response.ok || (response.status === 0 && response.type !== 'opaque'));
}

function hashText(text) {
    let h = 2166136261;
    for (let i = 0; i < text.length; i++) {
        h ^= text.charCodeAt(i);
        h = Math.imul(h, 16777619);
    }
    return (h >>> 0).toString(36);
}

export function createPronunciationRepository({
    fetchImpl = globalThis.fetch?.bind(globalThis),
    bundledBase = '',
    apiUrl = '',
    storage = defaultStorage(),
    now = () => Date.now(),
    remoteEnabled = () => false,
    timeoutMs = 4000,
} = {}) {
    const base = String(bundledBase).replace(/\/?$/, '/');
    let indexPromise = null;
    let transmittersPromise = null;
    const setPromises = new Map();
    let compiled = { key: '', matcher: null };

    function withTimeout(url) {
        const controller = typeof AbortController === 'function' ? new AbortController() : null;
        let timer = null;
        const request = fetchImpl(url, controller ? { cache: 'no-cache', signal: controller.signal } : { cache: 'no-cache' });
        const timeout = new Promise((_, reject) => {
            timer = setTimeout(() => {
                controller?.abort();
                reject(new Error('timeout'));
            }, timeoutMs);
        });
        return Promise.race([request, timeout]).finally(() => clearTimeout(timer));
    }

    async function getJson(url, timed = false) {
        const response = await (timed ? withTimeout(url) : fetchImpl(url));
        if (!okResponse(response)) throw new Error('HTTP ' + response?.status);
        return response.json();
    }

    function readCache() {
        const raw = readJson(storage, CACHE_KEY, null);
        return isObject(raw) ? { index: raw.index || null, sets: isObject(raw.sets) ? raw.sets : {}, order: Array.isArray(raw.order) ? raw.order : [] } : { index: null, sets: {}, order: [] };
    }

    function writeCache(cache) {
        let text = JSON.stringify(cache);
        while (text.length > CACHE_MAX_CHARS && cache.order.length) {
            delete cache.sets[cache.order.shift()];
            text = JSON.stringify(cache);
        }
        if (text.length <= CACHE_MAX_CHARS && storage) {
            try {
                storage.setItem(CACHE_KEY, text);
            } catch {
                return;
            }
        }
    }

    function remoteUrl(params) {
        if (!apiUrl) return '';
        return apiUrl + (apiUrl.includes('?') ? '&' : '?') + params;
    }

    async function loadRemoteIndex() {
        if (!remoteEnabled() || !apiUrl) return null;
        const cache = readCache();
        try {
            const data = await getJson(remoteUrl('pron=index'), true);
            if (!isObject(data) || data.ok === false || !isObject(data.sets)) return cache.index?.data || null;
            cache.index = { at: now(), data };
            writeCache(cache);
            return data;
        } catch {
            return cache.index?.data || null;
        }
    }

    function loadIndex() {
        if (!indexPromise) {
            indexPromise = (async () => {
                let bundled = null;
                try {
                    bundled = await getJson(base + 'index.json');
                } catch {
                    bundled = null;
                }
                const remote = await loadRemoteIndex();
                const sets = {};
                for (const [id, meta] of Object.entries(isObject(bundled?.sets) ? bundled.sets : {})) {
                    if (isSetId(id) && isObject(meta)) sets[id] = { rev: Number(meta.rev) || 0, entries: meta.entries || 0, prosody: !!meta.prosody, origin: 'bundled', bundledRev: Number(meta.rev) || 0 };
                }
                for (const [id, meta] of Object.entries(isObject(remote?.sets) ? remote.sets : {})) {
                    if (!isSetId(id) || !isObject(meta)) continue;
                    const rev = Number(meta.rev) || 0;
                    if (!sets[id] || rev > sets[id].rev) {
                        const sha = typeof meta.sha256 === 'string' ? meta.sha256.slice(0, 16) : '';
                        sets[id] = { rev, sha, entries: meta.entries || 0, prosody: !!meta.prosody, origin: 'remote', bundledRev: sets[id]?.bundledRev || 0 };
                    }
                }
                const voices = Array.isArray(remote?.voices) ? remote.voices : Array.isArray(bundled?.voices) ? bundled.voices : [...DEFAULT_VOICES];
                return { voices, sets, revision: Math.max(Number(bundled?.revision) || 0, Number(remote?.revision) || 0) };
            })();
        }
        return indexPromise;
    }

    function loadTransmitters() {
        if (!transmittersPromise) {
            transmittersPromise = getJson(base + 'transmitters.json').catch(() => ({ offices: {}, transmitters: {} }));
        }
        return transmittersPromise;
    }

    async function loadBundledSet(id) {
        try {
            const set = await getJson(base + id + '.json');
            return validatePronunciationSet(set).ok ? set : null;
        } catch {
            return null;
        }
    }

    async function loadRemoteSet(id, rev, sha = '') {
        const cacheId = id + '@' + rev + (sha ? '@' + sha : '');
        const cache = readCache();
        if (cache.sets[cacheId]) {
            cache.order = cache.order.filter((k) => k !== cacheId).concat(cacheId);
            writeCache(cache);
            return cache.sets[cacheId];
        }
        try {
            const set = await getJson(remoteUrl('pron=set&id=' + encodeURIComponent(id)), true);
            if (!validatePronunciationSet(set).ok) return null;
            cache.sets[cacheId] = set;
            cache.order = cache.order.filter((k) => k !== cacheId).concat(cacheId);
            writeCache(cache);
            return set;
        } catch {
            return null;
        }
    }

    function loadSet(id) {
        if (!isSetId(id)) return Promise.resolve(null);
        if (!setPromises.has(id)) {
            setPromises.set(id, (async () => {
                const index = await loadIndex();
                const meta = index.sets[id];
                if (!meta) return null;
                if (meta.origin === 'remote') {
                    const remote = await loadRemoteSet(id, meta.rev, meta.sha);
                    if (remote) return remote;
                    return meta.bundledRev ? loadBundledSet(id) : null;
                }
                return loadBundledSet(id);
            })());
        }
        return setPromises.get(id);
    }

    async function listSources() {
        const [index, tx] = await Promise.all([loadIndex(), loadTransmitters()]);
        const offices = Object.entries(tx.offices || {}).map(([id, meta]) => ({
            source: 'wfo:' + id, id, label: meta.label || id, region: meta.region || '', set: index.sets['wfo/' + id] || null,
        })).sort((a, b) => a.id.localeCompare(b.id));
        const transmitters = Object.entries(tx.transmitters || {}).map(([id, meta]) => ({
            source: 'tx:' + id, id, wfo: meta.wfo, site: meta.site || '', state: meta.state || '', freq: meta.freq || '', status: meta.status || '',
            set: index.sets['tx/' + id] || null,
        })).sort((a, b) => a.id.localeCompare(b.id));
        return { offices, transmitters, voices: index.voices };
    }

    async function resolveContext(selection = defaultSelection(), personal = []) {
        const index = await loadIndex();
        if (!selection.enabled) return { enabled: false, voices: index.voices };
        const parsed = parseSourceId(selection.source) || { type: 'national', id: '' };
        const tx = await loadTransmitters();
        let wfoId = parsed.type === 'wfo' ? parsed.id : '';
        let label = 'National';
        let txSet = null;
        if (parsed.type === 'tx') {
            const meta = tx.transmitters?.[parsed.id];
            wfoId = meta?.wfo || '';
            label = parsed.id + (meta?.site ? ' (' + meta.site + ', ' + meta.state + ')' : '');
            txSet = await loadSet('tx/' + parsed.id);
        } else if (parsed.type === 'wfo') {
            const meta = tx.offices?.[wfoId];
            label = wfoId + (meta?.label ? ' (' + meta.label + ')' : '');
        }
        const [national, wfoSet] = await Promise.all([loadSet('national'), wfoId ? loadSet('wfo/' + wfoId) : null]);
        const personalEntries = personalForSource(personal, selection.source, parsed.type === 'tx' ? wfoId : '');
        const sets = [national, wfoSet, txSet].filter(Boolean);
        const key = sets.map((s) => s.id + '@' + s.rev).join(',') + '|' + hashText(JSON.stringify(personalEntries));
        if (compiled.key !== key) {
            compiled = {
                key,
                matcher: compileMatcher(mergeLayers([
                    { layer: 'national', entries: national?.entries },
                    { layer: 'wfo', entries: wfoSet?.entries },
                    { layer: 'tx', entries: txSet?.entries },
                    { layer: 'personal', entries: personalEntries },
                ])),
            };
        }
        return {
            enabled: true,
            source: parsed.type === 'national' ? '' : selection.source,
            label,
            wfo: wfoId,
            voices: index.voices,
            officeSelected: parsed.type !== 'national',
            matcher: compiled.matcher,
            prosody: resolveProsody({ national, wfo: wfoSet, tx: txSet }),
            sets: sets.map((s) => s.id),
        };
    }

    function invalidate() {
        indexPromise = null;
        setPromises.clear();
        compiled = { key: '', matcher: null };
    }

    return { loadIndex, loadSet, loadTransmitters, listSources, resolveContext, invalidate };
}
