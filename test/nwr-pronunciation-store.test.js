import { describe, expect, it, vi } from 'vitest';
import {
    CACHE_KEY,
    CACHE_MAX_CHARS,
    EXPORT_TYPE,
    PERSONAL_CHANGE,
    PERSONAL_KEY,
    SELECTION_CHANGE,
    SELECTION_KEY,
    SUBMISSIONS_KEY,
    buildSubmission,
    createPronunciationRepository,
    defaultSelection,
    exportPersonal,
    importPersonal,
    parseApiResponse,
    personalForSource,
    readPersonal,
    readSelection,
    readSubmissions,
    recordSubmission,
    removePersonalEntry,
    savePersonalEntry,
    snapshotSelection,
    onSelectionChange,
    updateSubmission,
    writeSelection,
} from '../assets/js/nwr-pronunciation-store.js';
import { applyPronunciations, LIMITS } from '../assets/js/nwr-pronunciation.js';

function memoryStorage(initial = {}) {
    const data = new Map(Object.entries(initial));
    return {
        data,
        getItem: (key) => (data.has(key) ? data.get(key) : null),
        setItem: (key, value) => data.set(key, String(value)),
        removeItem: (key) => data.delete(key),
    };
}

function eventTarget() {
    const events = [];
    return { events, dispatchEvent: (event) => events.push({ type: event.type, detail: event.detail }) };
}

const respell = (id, match, text, extra = {}) => ({ id, match, replace: { kind: 'respell', text }, ...extra });
const set = (id, entries = [], extra = {}) => {
    const [type, sid] = id.split('/');
    const scope = type === 'national' ? { type } : type === 'tx' ? { type, id: sid, wfo: extra.wfo || 'LMK' } : { type, id: sid };
    return { schemaVersion: 1, id, scope, rev: extra.rev || 1, voices: ['paul'], entries, prosody: extra.prosody };
};

function jsonResponse(body, status = 200) {
    return { ok: status >= 200 && status < 300, status, type: 'basic', json: async () => body };
}

function fakeFetch(routes) {
    const calls = [];
    const inits = [];
    const impl = vi.fn(async (url, init) => {
        calls.push(url);
        inits.push(init);
        for (const [pattern, handler] of routes) {
            if (url.includes(pattern)) return typeof handler === 'function' ? handler(url) : jsonResponse(handler);
        }
        return jsonResponse({}, 404);
    });
    impl.calls = calls;
    impl.inits = inits;
    return impl;
}

const BUNDLED = {
    'b/index.json': { schemaVersion: 1, revision: 3, voices: ['paul'], sets: { national: { rev: 1, entries: 1 }, 'wfo/LMK': { rev: 2, entries: 1, prosody: true }, 'tx/WNG570': { rev: 1, entries: 1, prosody: true }, 'bad id': { rev: 1 } } },
    'b/transmitters.json': {
        offices: { LMK: { label: 'Louisville KY', region: 'CR' }, LOT: { label: 'Chicago IL', region: 'CR' } },
        transmitters: { WNG570: { wfo: 'LMK', site: 'Bowling Green', state: 'KY', freq: '162.425', status: 'NORMAL' }, KEC76: { wfo: 'LOT', site: 'Chicago', state: 'IL', freq: '162.550' } },
    },
    'b/national.json': set('national', [respell('illinois', 'Illinois', 'Illynois'), respell('severe', 'severe', 'n-severe')], { prosody: { speed: null, commaPauseMs: { value: 200 }, periodPauseMs: { value: 900 } } }),
    'b/wfo/LMK.json': set('wfo/LMK', [respell('severe', 'severe', 'lmk-severe')], { rev: 2, prosody: { speed: { value: 105 } } }),
    'b/tx/WNG570.json': set('tx/WNG570', [respell('calm', 'calm', 'tx-calm')], { prosody: { speed: { value: 93, verified: false } } }),
};

function bundledRoutes(extra = []) {
    return [...extra, ...Object.entries(BUNDLED).map(([path, body]) => [path, body])];
}

describe('selection', () => {
    it('defaults to enabled national', () => {
        expect(readSelection(memoryStorage())).toEqual(defaultSelection());
        expect(readSelection(null)).toEqual(defaultSelection());
        expect(readSelection(memoryStorage({ [SELECTION_KEY]: '{bad' }))).toEqual(defaultSelection());
        expect(readSelection(memoryStorage({ [SELECTION_KEY]: '[1]' }))).toEqual(defaultSelection());
        expect(readSelection(memoryStorage({ [SELECTION_KEY]: JSON.stringify({ enabled: false, source: 'tx:KEC76' }) }))).toEqual({ version: 1, enabled: false, source: 'tx:KEC76' });
        expect(readSelection(memoryStorage({ [SELECTION_KEY]: JSON.stringify({ source: 'garbage' }) })).source).toBe('');
        expect(readSelection(memoryStorage({ [SELECTION_KEY]: JSON.stringify({ source: 'national' }) })).source).toBe('');
    });

    it('writes, validates and announces changes', () => {
        const storage = memoryStorage();
        const target = eventTarget();
        expect(writeSelection({ source: 'wfo:LOT' }, { storage, target })).toEqual({ ok: true, selection: { version: 1, enabled: true, source: 'wfo:LOT' } });
        expect(writeSelection({ enabled: false }, { storage, target }).selection).toEqual({ version: 1, enabled: false, source: 'wfo:LOT' });
        expect(writeSelection({ source: 'national' }, { storage, target }).selection.source).toBe('');
        expect(writeSelection({ source: 'nope' }, { storage, target }).ok).toBe(false);
        expect(writeSelection({}, { storage: null }).ok).toBe(false);
        const failing = { getItem: () => null, setItem: () => { throw new Error('full'); } };
        expect(writeSelection({ enabled: true }, { storage: failing, target }).error).toMatch(/Could not save/);
        expect(target.events.map((e) => e.type)).toEqual([SELECTION_CHANGE, SELECTION_CHANGE, SELECTION_CHANGE]);
        expect(snapshotSelection(storage)).toEqual({ enabled: false, source: '' });
    });

    it('notifies listeners about local and cross-tab changes', () => {
        const storage = memoryStorage();
        const listeners = {};
        const target = {
            addEventListener: (type, fn) => { listeners[type] = fn; },
            removeEventListener: (type) => { delete listeners[type]; },
        };
        const seen = [];
        const stop = onSelectionChange((selection) => seen.push(selection.source), { target, storage });
        writeSelection({ source: 'wfo:IND' }, { storage, target: null });
        listeners[SELECTION_CHANGE]();
        listeners.storage({ key: 'other' });
        listeners.storage({ key: SELECTION_KEY });
        listeners.storage({ key: null });
        expect(seen).toEqual(['wfo:IND', 'wfo:IND', 'wfo:IND']);
        stop();
        expect(listeners).toEqual({});
        expect(typeof onSelectionChange(() => {}, { target: null })).toBe('function');
    });
});

describe('personal entries', () => {
    it('saves, replaces, filters and removes', () => {
        const storage = memoryStorage();
        const target = eventTarget();
        expect(savePersonalEntry({ match: '  Calm ', scope: 'wfo:LMK', replace: { kind: 'respell', text: 'Callm' } }, { storage, target })).toMatchObject({ ok: true, replaced: false, entry: { id: 'calm', match: 'Calm', scope: 'wfo:LMK' } });
        expect(savePersonalEntry({ match: 'calm', scope: 'wfo:LMK', replace: { kind: 'respell', text: 'Kahm' }, notes: 'n' }, { storage, target }).replaced).toBe(true);
        expect(savePersonalEntry({ match: 'wind', scope: 'all', disabled: true }, { storage, target }).ok).toBe(true);
        expect(savePersonalEntry({ match: 'x', scope: 'everywhere', replace: { kind: 'respell', text: 'y' } }, { storage }).error).toMatch(/Scope/);
        expect(savePersonalEntry({ match: '', replace: { kind: 'respell', text: 'y' } }, { storage }).ok).toBe(false);
        expect(savePersonalEntry({ match: 'x' }, { storage: null }).ok).toBe(false);
        const list = readPersonal(storage);
        expect(list.map((e) => [e.id, e.scope, e.replace?.text, e.disabled])).toEqual([['calm', 'wfo:LMK', 'Kahm', undefined], ['wind', 'all', undefined, true]]);
        expect(personalForSource(list, 'tx:WNG570', 'LMK').map((e) => e.id)).toEqual(['calm', 'wind']);
        expect(personalForSource(list, '', '').map((e) => e.id)).toEqual(['wind']);
        expect(removePersonalEntry('calm', 'wfo:LMK', { storage, target }).ok).toBe(true);
        expect(removePersonalEntry('calm', 'wfo:LMK', { storage, target }).ok).toBe(false);
        expect(target.events.every((e) => e.type === PERSONAL_CHANGE)).toBe(true);
    });

    it('reads defensively and caps the list', () => {
        const entries = [
            { id: 'a', scope: 'bogus', match: 'alpha', replace: { kind: 'respell', text: 'x' } },
            { id: 'a2', scope: 'all', match: 'Alpha', replace: { kind: 'respell', text: 'y' } },
            { match: 'beta', replace: { kind: 'respell', text: 'b' }, notes: 'n'.repeat(900) },
            { id: 'bad', match: 'gamma', replace: { kind: 'respell', text: '<x>' } },
            null,
        ];
        const storage = memoryStorage({ [PERSONAL_KEY]: JSON.stringify({ entries }) });
        const list = readPersonal(storage);
        expect(list.map((e) => [e.id, e.scope])).toEqual([['a', 'all'], ['beta', 'all']]);
        expect(list[1].notes).toHaveLength(LIMITS.notesChars);
        expect(readPersonal(memoryStorage({ [PERSONAL_KEY]: '{bad' }))).toEqual([]);
        const many = Array.from({ length: LIMITS.personalEntries + 5 }, (_, i) => ({ id: 'w' + i, match: 'w' + i, replace: { kind: 'respell', text: 'x' } }));
        const full = memoryStorage({ [PERSONAL_KEY]: JSON.stringify({ entries: many }) });
        expect(readPersonal(full)).toHaveLength(LIMITS.personalEntries);
        expect(savePersonalEntry({ match: 'brandnew', replace: { kind: 'respell', text: 'x' } }, { storage: full, target: null }).error).toMatch(/up to/);
        const failing = { getItem: () => null, setItem: () => { throw new Error('full'); } };
        expect(savePersonalEntry({ match: 'x', replace: { kind: 'respell', text: 'y' } }, { storage: failing }).error).toMatch(/Could not save/);
    });

    it('exports and imports envelopes', () => {
        const storage = memoryStorage();
        savePersonalEntry({ match: 'calm', scope: 'wfo:LMK', replace: { kind: 'respell', text: 'Callm' } }, { storage, target: null });
        savePersonalEntry({ match: 'wind', scope: 'all', disabled: true }, { storage, target: null });
        const all = exportPersonal(readPersonal(storage));
        expect(all).toMatchObject({ type: EXPORT_TYPE, version: 1, scope: 'mixed' });
        expect(exportPersonal(readPersonal(storage), 'wfo:LMK').entries).toHaveLength(1);
        const other = memoryStorage();
        const target = eventTarget();
        const result = importPersonal({ ...all, entries: [...all.entries, { match: '', replace: {} }] }, { storage: other, target });
        expect(result).toMatchObject({ ok: true, added: 2, skipped: 1 });
        expect(target.events).toHaveLength(1);
        expect(importPersonal({ type: 'x' }, { storage: other }).ok).toBe(false);
        expect(importPersonal(all, { storage: null }).ok).toBe(false);
        expect(importPersonal({ type: EXPORT_TYPE, version: 1, entries: [] }, { storage: other, target: null }).ok).toBe(true);
    });
});

describe('submission history', () => {
    it('records and updates', () => {
        const storage = memoryStorage({ [SUBMISSIONS_KEY]: JSON.stringify([{ id: 'old', token: 't' }, { bad: true }]) });
        expect(readSubmissions(storage)).toHaveLength(1);
        recordSubmission({ id: 'sub_1', token: 'abc', target: 'wfo/LOT', lastStatus: 'pending' }, storage);
        recordSubmission({ id: 'sub_1', token: 'abc', target: 'wfo/LOT', lastStatus: 'pending' }, storage);
        expect(readSubmissions(storage).map((s) => s.id)).toEqual(['sub_1', 'old']);
        expect(updateSubmission('sub_1', { lastStatus: 'approved' }, storage)[0].lastStatus).toBe('approved');
        expect(readSubmissions(memoryStorage({ [SUBMISSIONS_KEY]: '{}' }))).toEqual([]);
    });
});

describe('buildSubmission and parseApiResponse', () => {
    it('builds an anonymous form-encoded payload', () => {
        const result = buildSubmission({
            target: 'wfo/LOT',
            action: 'add',
            entries: [{ match: 'Illinois', scope: 'all', disabled: false, replace: { kind: 'respell', text: 'Illynois' } }],
            evidence: { notes: 'Heard on KEC76', links: ['https://example.com/clip', ' '] },
            client: { app: 'android', version: '2.0' },
        });
        expect(result.ok).toBe(true);
        expect(result.payload).toEqual({
            schemaVersion: 1,
            client: { app: 'android', version: '2.0' },
            target: 'wfo/LOT',
            action: 'add',
            entries: [{ id: 'illinois', match: 'Illinois', replace: { kind: 'respell', text: 'Illynois' } }],
            evidence: { notes: 'Heard on KEC76', links: ['https://example.com/clip'] },
        });
        const params = new URLSearchParams(result.body);
        expect(JSON.parse(params.get('payload')).target).toBe('wfo/LOT');
        expect(params.get('website')).toBe('');
    });

    it('builds prosody submissions', () => {
        const ok = buildSubmission({ target: 'tx/WNG570', action: 'prosody', prosody: { speed: { value: 93 } }, client: { app: 'nope' } });
        expect(ok.ok).toBe(true);
        expect(ok.payload.client.app).toBe('web');
        expect(ok.payload.prosody).toEqual({ speed: { value: 93 } });
        expect(buildSubmission({ target: 'tx/WNG570', action: 'prosody' }).error).toMatch(/speed or pause/);
        expect(buildSubmission({ target: 'tx/WNG570', action: 'prosody', prosody: { speed: { value: 999 } } }).ok).toBe(false);
    });

    it('rejects bad submissions', () => {
        expect(buildSubmission().ok).toBe(false);
        expect(buildSubmission({ target: 'wfo/LOT', action: 'add' }).error).toMatch(/at least one/);
        expect(buildSubmission({ target: 'wfo/LOT', action: 'add', entries: 'x' }).problems.map((p) => p.path)).toContain('entries');
        expect(buildSubmission({ target: 'wfo/LOT', action: 'add', entries: new Array(51).fill({ match: 'a', replace: { kind: 'respell', text: 'b' } }) }).error).toMatch(/at most 50/);
        expect(buildSubmission({ target: 'wfo/LOT', action: 'add', entries: [{ match: 'a', replace: { kind: 'respell', text: '' } }] }).ok).toBe(false);
        const evidence = buildSubmission({ target: 'national', action: 'add', entries: [respell('a', 'a', 'b')], evidence: { notes: 'n'.repeat(2001), links: ['http://x.com', 'https://a', 'https://b', 'https://c', 'https://d', 'https://e'] } });
        expect(evidence.problems.map((p) => p.path)).toEqual(expect.arrayContaining(['evidence.notes', 'evidence.links', 'evidence.links[0]']));
    });

    it('normalizes API responses', () => {
        expect(parseApiResponse(202, '{"ok":true,"id":"sub_1"}')).toEqual({ ok: true, status: 202, data: { ok: true, id: 'sub_1' } });
        expect(parseApiResponse(400, '{"ok":false,"error":"bad","code":"invalid","details":[{"path":"x"}]}')).toEqual({ ok: false, status: 400, code: 'invalid', error: 'bad', details: [{ path: 'x' }], retryAfter: null });
        expect(parseApiResponse(429, 'nope', '30')).toMatchObject({ code: 'rate_limited', retryAfter: 30 });
        expect(parseApiResponse(429, '{"retryAfter":12}').retryAfter).toBe(12);
        expect(parseApiResponse(0, '')).toMatchObject({ code: 'network', error: 'Could not reach the TTS server.' });
        expect(parseApiResponse(500, '')).toMatchObject({ code: 'server', error: 'The TTS server answered with status 500.' });
        expect(parseApiResponse(200, '{"ok":false,"error":"closed","code":"closed"}').ok).toBe(false);
    });
});

describe('repository', () => {
    it('resolves national-only by default', async () => {
        const fetchImpl = fakeFetch(bundledRoutes());
        const repo = createPronunciationRepository({ fetchImpl, bundledBase: 'b', storage: memoryStorage() });
        const ctx = await repo.resolveContext(defaultSelection(), []);
        expect(ctx).toMatchObject({ enabled: true, source: '', label: 'National', officeSelected: false, sets: ['national'] });
        expect(ctx.prosody.speed).toBeNull();
        expect(applyPronunciations('severe Illinois', ctx.matcher).text).toBe('n-severe Illynois');
        expect(await repo.resolveContext({ enabled: false, source: '' })).toEqual({ enabled: false, voices: ['paul'] });
    });

    it('layers transmitter over office over national, with personal on top', async () => {
        const fetchImpl = fakeFetch(bundledRoutes());
        const repo = createPronunciationRepository({ fetchImpl, bundledBase: 'b/', storage: memoryStorage() });
        const personal = [{ id: 'illinois', scope: 'wfo:LMK', match: 'Illinois', replace: { kind: 'respell', text: 'Ill-ih-noy' } }];
        const ctx = await repo.resolveContext({ enabled: true, source: 'tx:WNG570' }, personal);
        expect(ctx).toMatchObject({ source: 'tx:WNG570', label: 'WNG570 (Bowling Green, KY)', wfo: 'LMK', officeSelected: true, sets: ['national', 'wfo/LMK', 'tx/WNG570'] });
        expect(ctx.prosody.speed).toMatchObject({ value: 93, verified: false, from: 'tx' });
        expect(applyPronunciations('severe Illinois calm', ctx.matcher).text).toBe('lmk-severe Ill-ih-noy tx-calm');
        const again = await repo.resolveContext({ enabled: true, source: 'tx:WNG570' }, personal);
        expect(again.matcher).toBe(ctx.matcher);
        const office = await repo.resolveContext({ enabled: true, source: 'wfo:LOT' }, []);
        expect(office).toMatchObject({ label: 'LOT (Chicago IL)', sets: ['national'] });
        const unknownTx = await repo.resolveContext({ enabled: true, source: 'tx:ZZZ99' }, []);
        expect(unknownTx).toMatchObject({ label: 'ZZZ99', wfo: '' });
        const bogus = await repo.resolveContext({ enabled: true, source: 'garbage' }, []);
        expect(bogus.source).toBe('');
        const unlabeled = await createPronunciationRepository({ fetchImpl: fakeFetch(bundledRoutes([['transmitters.json', { offices: { ZZZ: {} } }]])), bundledBase: 'b' }).resolveContext({ enabled: true, source: 'wfo:ZZZ' });
        expect(unlabeled.label).toBe('ZZZ');
    });

    it('lists offices and transmitters', async () => {
        const repo = createPronunciationRepository({ fetchImpl: fakeFetch(bundledRoutes()), bundledBase: 'b', storage: memoryStorage() });
        const sources = await repo.listSources();
        expect(sources.offices.map((o) => [o.source, o.label, !!o.set])).toEqual([['wfo:LMK', 'Louisville KY', true], ['wfo:LOT', 'Chicago IL', false]]);
        expect(sources.transmitters.map((t) => [t.source, t.wfo, t.freq, !!t.set])).toEqual([['tx:KEC76', 'LOT', '162.550', false], ['tx:WNG570', 'LMK', '162.425', true]]);
        expect(sources.voices).toEqual(['paul']);
    });

    it('survives missing bundled files', async () => {
        const repo = createPronunciationRepository({ fetchImpl: fakeFetch([]), bundledBase: 'b', storage: memoryStorage() });
        const ctx = await repo.resolveContext(defaultSelection(), []);
        expect(ctx.sets).toEqual([]);
        expect(ctx.voices).toEqual(['paul']);
        expect(await repo.loadSet('bad id')).toBeNull();
        expect(await repo.loadSet('wfo/ZZZ')).toBeNull();
        const sources = await repo.listSources();
        expect(sources.offices).toEqual([]);
        const throwing = createPronunciationRepository({ fetchImpl: async () => { throw new Error('offline'); }, bundledBase: 'b' });
        expect((await throwing.loadIndex()).sets).toEqual({});
    });

    it('rejects invalid bundled sets', async () => {
        const fetchImpl = fakeFetch(bundledRoutes([['b/national.json', { schemaVersion: 9 }]]));
        const repo = createPronunciationRepository({ fetchImpl, bundledBase: 'b', storage: memoryStorage() });
        expect(await repo.loadSet('national')).toBeNull();
    });

    it('prefers newer remote sets, caches them, and falls back when remote is invalid', async () => {
        const storage = memoryStorage();
        const remoteLmk = set('wfo/LMK', [respell('severe', 'severe', 'remote-severe')], { rev: 5 });
        const remoteIndex = { ok: true, revision: 9, voices: ['paul', 'james'], sets: { 'wfo/LMK': { rev: 5, entries: 1 }, 'wfo/LOT': { rev: 1, entries: 1 }, national: { rev: 1 }, 'bad id': {} } };
        const fetchImpl = fakeFetch(bundledRoutes([
            ['pron=index', remoteIndex],
            ['pron=set&id=wfo%2FLMK', remoteLmk],
            ['pron=set&id=wfo%2FLOT', { schemaVersion: 1, id: 'wfo/LOT' }],
        ]));
        let clock = 1000;
        const make = () => createPronunciationRepository({ fetchImpl, bundledBase: 'b', apiUrl: 'https://tts/x?handler=toolkit', storage, remoteEnabled: () => true, now: () => clock });
        const repo = make();
        const index = await repo.loadIndex();
        expect(index.revision).toBe(9);
        expect(index.voices).toEqual(['paul', 'james']);
        expect(index.sets['wfo/LMK']).toMatchObject({ rev: 5, origin: 'remote', bundledRev: 2 });
        expect(index.sets.national.origin).toBe('bundled');
        expect((await repo.loadSet('wfo/LMK')).rev).toBe(5);
        expect(await repo.loadSet('wfo/LOT')).toBeNull();
        expect(fetchImpl.calls.filter((u) => u.includes('pron=index'))).toHaveLength(1);
        const cached = JSON.parse(storage.getItem(CACHE_KEY));
        expect(Object.keys(cached.sets)).toEqual(['wfo/LMK@5']);
        const second = make();
        expect((await second.loadSet('wfo/LMK')).rev).toBe(5);
        expect(fetchImpl.calls.filter((u) => u.includes('pron=index'))).toHaveLength(2);
        expect(fetchImpl.calls.filter((u) => u.includes('pron=set&id=wfo%2FLMK'))).toHaveLength(1);
        repo.invalidate();
        expect((await repo.loadIndex()).revision).toBe(9);
        expect(fetchImpl.calls.filter((u) => u.includes('pron=index'))).toHaveLength(3);
    });

    it('sees a set approved after the index was cached, and keys cached sets by content hash', async () => {
        const storage = memoryStorage();
        let remoteIndex = { ok: true, revision: 3, sets: {} };
        let remoteTx = set('tx/KIH41', [], { rev: 1, prosody: { speed: { value: 100 } } });
        const fetchImpl = fakeFetch(bundledRoutes([
            ['pron=index', () => jsonResponse(remoteIndex)],
            ['pron=set&id=tx%2FKIH41', () => jsonResponse(remoteTx)],
        ]));
        const make = () => createPronunciationRepository({ fetchImpl, bundledBase: 'b', apiUrl: 'https://tts/x', storage, remoteEnabled: () => true });
        expect((await make().loadSet('tx/KIH41'))).toBeNull();
        remoteIndex = { ok: true, revision: 4, sets: { 'tx/KIH41': { rev: 1, sha256: 'a'.repeat(64) } } };
        expect((await make().loadSet('tx/KIH41')).prosody.speed.value).toBe(100);
        remoteTx = set('tx/KIH41', [], { rev: 1, prosody: { speed: { value: 95 } } });
        remoteIndex = { ok: true, revision: 4, sets: { 'tx/KIH41': { rev: 1, sha256: 'b'.repeat(64) } } };
        expect((await make().loadSet('tx/KIH41')).prosody.speed.value).toBe(95);
        expect(Object.keys(JSON.parse(storage.getItem(CACHE_KEY)).sets)).toEqual(['tx/KIH41@1@aaaaaaaaaaaaaaaa', 'tx/KIH41@1@bbbbbbbbbbbbbbbb']);
        expect(fetchImpl.inits.filter((init) => init?.cache === 'no-cache').length).toBe(fetchImpl.calls.filter((u) => u.includes('pron=')).length);
    });

    it('falls back to the bundled copy when a remote set fails', async () => {
        const fetchImpl = fakeFetch(bundledRoutes([
            ['pron=index', { ok: true, sets: { 'wfo/LMK': { rev: 7 } } }],
            ['pron=set', () => jsonResponse({}, 500)],
        ]));
        const repo = createPronunciationRepository({ fetchImpl, bundledBase: 'b', apiUrl: 'https://tts/x', storage: memoryStorage(), remoteEnabled: () => true });
        expect((await repo.loadSet('wfo/LMK')).rev).toBe(2);
    });

    it('ignores broken remote indexes and keeps a stale cache', async () => {
        const storage = memoryStorage({ [CACHE_KEY]: JSON.stringify({ index: { at: 0, data: { sets: { 'wfo/LOT': { rev: 3 } } } }, sets: {}, order: [] }) });
        const repo = createPronunciationRepository({ fetchImpl: fakeFetch(bundledRoutes([['pron=index', { ok: false }]])), bundledBase: 'b', apiUrl: 'https://tts/x', storage, remoteEnabled: () => true });
        expect((await repo.loadIndex()).sets['wfo/LOT'].rev).toBe(3);
        const failing = createPronunciationRepository({ fetchImpl: fakeFetch(bundledRoutes([['pron=index', () => { throw new Error('down'); }]])), bundledBase: 'b', apiUrl: 'https://tts/x', storage: memoryStorage(), remoteEnabled: () => true });
        expect((await failing.loadIndex()).sets['wfo/LOT']).toBeUndefined();
        const garbageCache = memoryStorage({ [CACHE_KEY]: '[]' });
        const g = createPronunciationRepository({ fetchImpl: fakeFetch(bundledRoutes()), bundledBase: 'b', apiUrl: 'https://tts/x', storage: garbageCache, remoteEnabled: () => true });
        expect((await g.loadIndex()).revision).toBe(3);
        const noApi = createPronunciationRepository({ fetchImpl: fakeFetch(bundledRoutes()), bundledBase: 'b', storage: memoryStorage(), remoteEnabled: () => true });
        expect((await noApi.loadIndex()).revision).toBe(3);
    });

    it('times out slow remote requests', async () => {
        vi.useFakeTimers();
        try {
            const fetchImpl = vi.fn((url) => (url.includes('pron=') ? new Promise(() => {}) : Promise.resolve(jsonResponse(BUNDLED[Object.keys(BUNDLED).find((k) => url.endsWith(k))] || {}))));
            const repo = createPronunciationRepository({ fetchImpl, bundledBase: 'b', apiUrl: 'https://tts/x', storage: memoryStorage(), remoteEnabled: () => true, timeoutMs: 50 });
            const pending = repo.loadIndex();
            await vi.advanceTimersByTimeAsync(60);
            expect((await pending).revision).toBe(3);
        } finally {
            vi.useRealTimers();
        }
    });

    it('evicts the oldest cached sets past the size cap', async () => {
        const storage = memoryStorage();
        const big = (id, rev) => set(id, [respell('x', 'x', 'y'.repeat(100), { notes: 'n'.repeat(400) })], { rev });
        const pad = 'p'.repeat(Math.floor(CACHE_MAX_CHARS / 2));
        const fetchImpl = fakeFetch(bundledRoutes([
            ['pron=index', { ok: true, sets: { 'wfo/AAA': { rev: 1 }, 'wfo/BBB': { rev: 1 }, 'wfo/CCC': { rev: 1 } } }],
            ['id=wfo%2FAAA', { ...big('wfo/AAA', 1), style: { pad } }],
            ['id=wfo%2FBBB', { ...big('wfo/BBB', 1), style: { pad } }],
            ['id=wfo%2FCCC', big('wfo/CCC', 1)],
        ]));
        const repo = createPronunciationRepository({ fetchImpl, bundledBase: 'b', apiUrl: 'https://tts/x', storage, remoteEnabled: () => true });
        await repo.loadSet('wfo/AAA');
        await repo.loadSet('wfo/BBB');
        await repo.loadSet('wfo/CCC');
        const cached = JSON.parse(storage.getItem(CACHE_KEY));
        expect(cached.order).toEqual(['wfo/BBB@1', 'wfo/CCC@1']);
        const quota = { getItem: () => null, setItem: () => { throw new Error('quota'); } };
        const q = createPronunciationRepository({ fetchImpl, bundledBase: 'b', apiUrl: 'https://tts/x', storage: quota, remoteEnabled: () => true });
        expect((await q.loadSet('wfo/CCC')).id).toBe('wfo/CCC');
    });

    it('accepts iOS status-0 responses for bundled files', async () => {
        const fetchImpl = vi.fn(async (url) => {
            const key = Object.keys(BUNDLED).find((k) => url.endsWith(k));
            return key ? { ok: false, status: 0, type: 'basic', json: async () => BUNDLED[key] } : { ok: false, status: 0, type: 'opaque', json: async () => ({}) };
        });
        const repo = createPronunciationRepository({ fetchImpl, bundledBase: 'b', storage: memoryStorage() });
        expect((await repo.loadSet('national')).id).toBe('national');
    });
});
