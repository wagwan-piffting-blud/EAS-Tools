import { describe, expect, it } from 'vitest';
import {
    EXPORT_FILE_NAME,
    FREE_TEST_NOTE,
    KIND_LABELS,
    PRON_TEST_FIELDS,
    SHARED_LIMIT,
    exportPersonalText,
    importPersonalText,
    buildReplace,
    checkSubmission,
    describeApiError,
    draftEntry,
    draftProblem,
    editorSnapshot,
    filterShared,
    getJson,
    loadEditorContext,
    planSubmissions,
    postForm,
    removePersonalByKey,
    replacementText,
    replacementValue,
    savePersonalDraft,
    scopeLabel,
    sendSubmissions,
    targetLabel,
    testNote,
    turnOffShared,
    withdrawSubmission,
} from '../assets/js/nwr-pronunciation-editing.js';
import { PERSONAL_KEY, SUBMISSIONS_KEY, readPersonal, readSubmissions } from '../assets/js/nwr-pronunciation-store.js';

function memoryStorage(initial = {}) {
    const data = new Map(Object.entries(initial));
    return {
        data,
        getItem: (key) => (data.has(key) ? data.get(key) : null),
        setItem: (key, value) => data.set(key, String(value)),
        removeItem: (key) => data.delete(key),
    };
}

const opts = (storage) => ({ storage, target: null });
const respell = (id, match, text, extra = {}) => ({ id, match, replace: { kind: 'respell', text }, ...extra });
const set = (id, entries, extra = {}) => {
    const [type, sid] = id.split('/');
    const scope = type === 'national' ? { type } : type === 'tx' ? { type, id: sid, wfo: 'LMK' } : { type, id: sid };
    return { schemaVersion: 1, id, scope, rev: 1, voices: ['paul'], entries, ...extra };
};

function response(status, body, headers = {}) {
    return { status, text: async () => (typeof body === 'string' ? body : JSON.stringify(body)), headers: { get: (name) => headers[name] ?? null } };
}

function fakeFetch(routes) {
    const calls = [];
    const impl = async (url, init) => {
        calls.push({ url, init });
        for (const [pattern, handler] of routes) {
            if (url.includes(pattern)) return typeof handler === 'function' ? handler(url, init) : handler;
        }
        throw new Error('offline');
    };
    impl.calls = calls;
    return impl;
}

function repository(sets, transmitters = { WNG570: { wfo: 'LMK' } }) {
    return {
        loadTransmitters: async () => ({ transmitters }),
        loadSet: async (id) => sets[id] || null,
    };
}

describe('labels and replacements', () => {
    it('renders every replacement kind both ways', () => {
        expect(replacementText(null)).toBe('(turned off)');
        expect(replacementText({ kind: 'phoneme', ph: 'W IH1 N D', on: 'wind' })).toBe('W IH1 N D (on "wind")');
        expect(replacementText({ kind: 'phoneme', ph: 'AA1' })).toBe('AA1');
        expect(replacementText({ kind: 'respell', text: 'Kahm' })).toBe('Kahm');
        expect(replacementText({ kind: 'vtml', markup: '{{match}}<vtml_pause time="10"/>' })).toBe('{{match}}<vtml_pause time="10"/>');
        expect(replacementValue(null)).toBe('');
        expect(replacementValue({ kind: 'phoneme', ph: 'AA1' })).toBe('AA1');
        expect(replacementValue({ kind: 'respell', text: 'x' })).toBe('x');
        expect(replacementValue({ kind: 'vtml', markup: 'm' })).toBe('m');
        expect(buildReplace('phoneme', ' ih1   l ')).toEqual({ kind: 'phoneme', ph: 'IH1 L' });
        expect(buildReplace('respell', ' Kahm ')).toEqual({ kind: 'respell', text: 'Kahm' });
        expect(buildReplace('vtml', null)).toEqual({ kind: 'vtml', markup: '' });
    });

    it('labels scopes and targets', () => {
        expect(scopeLabel('all')).toBe('Everywhere');
        expect(scopeLabel('wfo:LOT')).toBe('LOT office');
        expect(scopeLabel('tx:KEC76')).toBe('KEC76 transmitter');
        expect(scopeLabel('odd')).toBe('odd');
        expect(targetLabel('national')).toBe('National dictionary');
        expect(targetLabel('wfo/LOT')).toBe('LOT office');
        expect(targetLabel('tx/KEC76')).toBe('KEC76 transmitter');
        expect(targetLabel('odd')).toBe('odd');
    });
});

describe('loadEditorContext', () => {
    const sets = {
        national: set('national', [respell('calm', 'Calm', 'Kahm')]),
        'wfo/LMK': set('wfo/LMK', [respell('calm', 'Calm', 'Kawm'), respell('beta', 'Beta', 'Bayta', { verified: false })]),
        'tx/WNG570': set('tx/WNG570', [respell('alpha', 'Alpha', 'Alfa')]),
    };

    it('merges national, office and transmitter layers for a transmitter', async () => {
        const ctx = await loadEditorContext(repository(sets), { source: 'tx:WNG570' });
        expect(ctx.wfoId).toBe('LMK');
        expect(ctx.label).toBe('WNG570 (LMK)');
        expect(ctx.scopes).toEqual(['all', 'wfo:LMK', 'tx:WNG570']);
        expect(ctx.targets).toEqual(['national', 'wfo/LMK', 'tx/WNG570']);
        expect(ctx.inherited.map((i) => [i.entry.match, i.layer])).toEqual([['Alpha', 'tx'], ['Beta', 'wfo'], ['Calm', 'wfo']]);
        expect(filterShared(ctx.inherited, ' be ').map((i) => i.entry.match)).toEqual(['Beta']);
        expect(filterShared(ctx.inherited, '')).toHaveLength(3);
    });

    it('handles an office, national and an unknown transmitter', async () => {
        const office = await loadEditorContext(repository(sets), { source: 'wfo:LMK' });
        expect([office.label, office.scopes, office.targets]).toEqual(['LMK', ['all', 'wfo:LMK'], ['national', 'wfo/LMK']]);
        const national = await loadEditorContext(repository(sets), { source: '' });
        expect([national.label, national.scopes, national.targets]).toEqual(['the national list', ['all'], ['national']]);
        const unknown = await loadEditorContext(repository(sets, {}), { source: 'tx:KXX99' });
        expect(unknown.scopes).toEqual(['all', 'tx:KXX99']);
        expect(unknown.sets.wfo).toBeNull();
        const bare = await loadEditorContext(repository({}), undefined);
        expect(bare.inherited).toEqual([]);
    });
});

describe('personal entries', () => {
    it('validates, saves, edits across scopes and removes', () => {
        const storage = memoryStorage();
        expect(draftEntry({ match: '  Calm   winds ', kind: 'respell', value: 'Kahm', scope: 'all' })).toMatchObject({ id: 'calm-winds', match: 'Calm winds', caseSensitive: false });
        expect(draftProblem(draftEntry({ match: 'QQ', kind: 'phoneme', value: 'AR2', scope: 'all' }))).toBe('unknown phone AR2');
        expect(savePersonalDraft({ match: 'QQ', kind: 'phoneme', value: 'AR2', scope: 'all' }, null, opts(storage))).toEqual({ ok: false, error: 'unknown phone AR2' });

        const saved = savePersonalDraft({ match: 'Calm', kind: 'respell', value: 'Kahm', scope: 'all' }, null, opts(storage));
        expect(saved).toMatchObject({ ok: true, message: 'Saved "Calm" for Everywhere.' });
        const updated = savePersonalDraft({ match: 'Calm', kind: 'respell', value: 'Kawm', scope: 'all' }, null, opts(storage));
        expect(updated.message).toBe('Updated "Calm" for Everywhere.');
        const moved = savePersonalDraft({ match: 'Calm', kind: 'respell', value: 'Kawm', scope: 'wfo:LMK' }, { id: 'calm', scope: 'all' }, opts(storage));
        expect(moved.message).toBe('Saved "Calm" for LMK office.');
        expect(readPersonal(storage).map((e) => e.scope)).toEqual(['wfo:LMK']);

        expect(removePersonalByKey('calm', 'wfo:LMK', opts(storage))).toEqual({ ok: true, message: 'Removed "Calm".' });
        expect(removePersonalByKey('calm', 'wfo:LMK', opts(storage))).toEqual({ ok: false, error: 'That pronunciation is already gone.' });
    });

    it('reports a storage failure', () => {
        expect(savePersonalDraft({ match: 'Calm', kind: 'respell', value: 'Kahm', scope: 'all' }, null, { storage: null, target: null }).ok).toBe(false);
    });

    it('turns off a shared entry for a scope', () => {
        const storage = memoryStorage();
        expect(turnOffShared(respell('calm', 'Calm', 'Kahm'), 'wfo:LMK', opts(storage))).toEqual({ ok: true, message: 'Turned off "Calm" for LMK office.' });
        expect(readPersonal(storage)[0]).toMatchObject({ match: 'Calm', disabled: true, scope: 'wfo:LMK' });
        expect(turnOffShared(respell('calm', 'Calm', 'Kahm'), 'nowhere', opts(storage)).ok).toBe(false);
    });
});

describe('planSubmissions', () => {
    const sets = { national: set('national', []), wfo: set('wfo/LMK', [respell('calm', 'Calm', 'Kahm'), respell('beta', 'Beta', 'Bayta')]), tx: set('tx/WNG570', []) };

    it('groups entries into add, change and remove, plus prosody', () => {
        const chosen = [
            respell('new', 'Novel', 'Nawvel'),
            respell('mine', 'Calm', 'Kawm'),
            { id: 'beta', match: 'Beta', disabled: true },
            { id: 'gone', match: 'Gone', disabled: true },
        ];
        const plan = planSubmissions({ chosen, target: 'wfo/LMK', sets, prosody: { speed: '105', comma: '', period: 950 }, notes: 'heard it', links: 'https://a.example/x https://b.example/y', client: { app: 'web', version: '' } });
        expect(plan.ok).toBe(true);
        expect(plan.requests.map((r) => r.payload.action)).toEqual(['add', 'change', 'remove', 'prosody']);
        expect(plan.requests[1].payload.entries[0].id).toBe('calm');
        expect(plan.requests[2].payload.entries[0].replace).toEqual({ kind: 'respell', text: 'Bayta' });
        expect(plan.requests[3].payload.prosody).toEqual({ speed: { value: 105 }, periodPauseMs: { value: 950 } });
        expect(plan.requests[0].payload.evidence.links).toEqual(['https://a.example/x', 'https://b.example/y']);
    });

    it('targets the national and transmitter sets and accepts link arrays', () => {
        const national = planSubmissions({ chosen: [respell('calm', 'Calm', 'Kahm')], target: 'national', sets, links: ['https://a.example'] });
        expect(national.requests[0].payload.action).toBe('add');
        const tx = planSubmissions({ chosen: [], target: 'tx/WNG570', sets, prosody: { comma: 150 } });
        expect(tx.requests[0].payload.prosody).toEqual({ commaPauseMs: { value: 150 } });
    });

    it('explains why nothing would be sent', () => {
        expect(planSubmissions({ chosen: [], target: 'wfo/LMK', sets })).toEqual({ ok: false, error: 'Choose at least one pronunciation, or fill in speed or pauses.' });
        expect(planSubmissions({ chosen: [{ id: 'gone', match: 'Gone', disabled: true }], target: 'wfo/LMK', sets }).error).toBe('Those pronunciations already match the shared dictionary.');
        expect(planSubmissions({ chosen: [], target: 'wfo/LMK', sets, prosody: { speed: 999 } }).ok).toBe(false);
        expect(planSubmissions().ok).toBe(false);
    });
});

describe('server calls', () => {
    const plan = () => planSubmissions({ chosen: [respell('novel', 'Novel', 'Nawvel')], target: 'wfo/LMK', sets: { wfo: set('wfo/LMK', []) }, prosody: { speed: 100 } });

    it('posts forms and reads JSON, mapping network failures', async () => {
        const ok = fakeFetch([['x', response(200, { ok: true, value: 1 })]]);
        expect((await postForm('https://api/x', 'a=1', ok)).ok).toBe(true);
        expect(ok.calls[0].init.method).toBe('POST');
        expect((await getJson('https://api/x', ok)).data.value).toBe(1);
        const down = fakeFetch([]);
        expect((await postForm('https://api/x', '', down)).ok).toBe(false);
        expect((await getJson('https://api/x', down)).ok).toBe(false);
    });

    it('sends submissions and records them', async () => {
        const storage = memoryStorage();
        let n = 0;
        const fetchImpl = fakeFetch([['pron=submit', () => response(202, { ok: true, id: 'sub_' + ++n, status: 'pending', token: 't' + n })]]);
        const result = await sendSubmissions(plan().requests, { apiUrl: 'https://api/x?handler=toolkit', target: 'wfo/LMK', fetchImpl, storage, now: () => 42 });
        expect(result).toEqual({ sent: 2, error: '', message: 'Sent 2 submissions for review. Thank you.' });
        expect(readSubmissions(storage).map((s) => [s.id, s.action, s.submittedAt])).toEqual([['sub_2', 'prosody', 42], ['sub_1', 'add', 42]]);
        const one = await sendSubmissions(plan().requests.slice(0, 1), { apiUrl: 'https://api/x', target: 'wfo/LMK', fetchImpl, storage: memoryStorage() });
        expect(one.message).toBe('Sent 1 submission for review. Thank you.');
        expect((await sendSubmissions([], { apiUrl: 'https://api/x', storage })).message).toBe('');
    });

    it('stops at the first refusal and explains rate limits', async () => {
        const limited = fakeFetch([['pron=submit', response(429, { ok: false, error: 'Slow down', code: 'rate_limited', retryAfter: 600 }, { 'Retry-After': '600' })]]);
        const result = await sendSubmissions(plan().requests, { apiUrl: 'https://api/x', target: 'wfo/LMK', fetchImpl: limited, storage: memoryStorage() });
        expect(result).toEqual({ sent: 0, error: 'Too many submissions for now; try again in 10 minutes.' });
        expect(describeApiError({ error: 'Bad', details: [{ path: 'entries[0]', problem: 'nope' }] })).toBe('Bad (entries[0]: nope)');
        expect(describeApiError({ error: 'Bad', details: [] })).toBe('Bad');
    });

    it('checks and withdraws a stored submission', async () => {
        const storage = memoryStorage({ [SUBMISSIONS_KEY]: JSON.stringify([{ id: 'sub_1', token: 'tok', target: 'wfo/LMK', lastStatus: 'pending' }]) });
        const fetchImpl = fakeFetch([
            ['pron=status', response(200, { ok: true, id: 'sub_1', status: 'approved', reviewerNote: 'Thanks' })],
            ['pron=withdraw', response(200, { ok: true, status: 'withdrawn' })],
        ]);
        const checked = await checkSubmission('sub_1', { apiUrl: 'https://api/x', fetchImpl, storage });
        expect(checked).toEqual({ ok: true, status: 'approved', newlyApproved: true });
        expect(fetchImpl.calls[0].url).toContain('&id=sub_1&token=tok');
        expect(readSubmissions(storage)[0]).toMatchObject({ lastStatus: 'approved', reviewerNote: 'Thanks' });
        expect((await checkSubmission('sub_1', { apiUrl: 'https://api/x', fetchImpl, storage })).newlyApproved).toBe(false);
        expect(await withdrawSubmission('sub_1', { apiUrl: 'https://api/x', fetchImpl, storage })).toEqual({ ok: true });
        expect(readSubmissions(storage)[0].lastStatus).toBe('withdrawn');
        expect(fetchImpl.calls.at(-1).init.body).toBe('id=sub_1&token=tok');
    });

    it('reports unknown submissions and server errors', async () => {
        const storage = memoryStorage({ [SUBMISSIONS_KEY]: JSON.stringify([{ id: 'sub_1', token: 'tok', target: 'wfo/LMK', lastStatus: 'pending' }]) });
        const fail = fakeFetch([['pron=', response(404, { ok: false, error: 'Not found', code: 'not_found' })]]);
        expect((await checkSubmission('nope', { apiUrl: 'https://api/x', fetchImpl: fail, storage })).error).toBe('That submission is not on this device.');
        expect((await withdrawSubmission('nope', { apiUrl: 'https://api/x', fetchImpl: fail, storage })).error).toBe('That submission is not on this device.');
        expect(await checkSubmission('sub_1', { apiUrl: 'https://api/x', fetchImpl: fail, storage })).toEqual({ ok: false, error: 'Not found' });
        expect(await withdrawSubmission('sub_1', { apiUrl: 'https://api/x', fetchImpl: fail, storage })).toEqual({ ok: false, error: 'Not found' });
    });
});

describe('editorSnapshot', () => {
    it('serialises the editor for the native apps', async () => {
        const many = Array.from({ length: SHARED_LIMIT + 5 }, (_, i) => respell('w' + i, 'Word' + String(i).padStart(3, '0'), 'x'));
        const sets = {
            national: set('national', [...many, { id: 'alt', match: 'Alt', replace: { kind: 'phoneme', ph: 'AA1 L T' }, verified: false, variants: [{ id: 'v1', label: 'Long', replace: { kind: 'respell', text: 'Awlt' } }, { id: 'v2', replace: {} }] }]),
        };
        const ctx = await loadEditorContext(repository(sets), { source: 'wfo:LMK' });
        const snap = editorSnapshot(ctx, {
            personal: [respell('calm', 'Calm', 'Kahm', { scope: 'all', caseSensitive: true }), { id: 'off', match: 'Off', disabled: true, scope: 'wfo:LMK' }],
            submissions: [{ id: 'sub_1', target: 'wfo/LMK', action: 'add', submittedAt: 5, lastStatus: 'pending' }, { id: 'sub_2', target: 'national', lastStatus: 'mystery' }, { id: 'sub_3', target: 'national' }],
            canSubmit: 1,
        });
        expect(snap.label).toBe('LMK');
        expect(snap.scopes).toEqual([{ id: 'all', label: 'Everywhere' }, { id: 'wfo:LMK', label: 'LMK office' }]);
        expect(snap.targets.map((t) => t.label)).toEqual(['National dictionary', 'LMK office']);
        expect(snap.kinds.map((k) => k.id)).toEqual(Object.keys(KIND_LABELS));
        expect(snap.canSubmit).toBe(true);
        expect(snap.testNote).toBe('');
        expect(editorSnapshot(ctx, { features: { pronunciation: { freeTest: true } } }).testNote).toBe(FREE_TEST_NOTE);
        expect(testNote({ pronunciation: { freeTest: false } })).toBe('');
        expect(snap.limits.speedMax).toBeGreaterThan(snap.limits.speedMin);
        expect(snap.personal[0]).toEqual({ id: 'calm', scope: 'all', scopeLabel: 'Everywhere', match: 'Calm', kind: 'respell', value: 'Kahm', caseSensitive: true, disabled: false, text: 'Kahm' });
        expect(snap.personal[1]).toMatchObject({ kind: '', value: '', disabled: true, text: '(turned off)' });
        expect(snap.sharedTotal).toBe(SHARED_LIMIT + 6);
        expect(snap.shared).toHaveLength(SHARED_LIMIT);
        const alt = editorSnapshot(ctx, { query: 'alt' }).shared[0];
        expect(alt).toMatchObject({ match: 'Alt', kind: 'phoneme', value: 'AA1 L T', text: 'AA1 L T (unverified)', layer: 'national', layerLabel: 'National' });
        expect(alt.variants).toEqual([{ label: 'Long', kind: 'respell', value: 'Awlt' }, { label: 'v2', kind: '', value: '' }]);
        expect(snap.submissions.map((s) => [s.statusLabel, s.canWithdraw, s.targetLabel])).toEqual([
            ['Waiting for review', true, 'LMK office'],
            ['mystery', false, 'National dictionary'],
            ['Unknown', false, 'National dictionary'],
        ]);
        expect(editorSnapshot({ ...ctx, inherited: [{ entry: { id: 'z', match: 'Z', replace: null }, layer: 'odd' }] }).shared[0]).toMatchObject({ kind: '', layerLabel: 'odd', text: '(turned off)' });
        expect(snap.submissions[1]).toMatchObject({ action: '', submittedAt: 0, reviewerNote: '' });
    });
});

describe('import and export', () => {
    it('round-trips personal entries through a JSON file', () => {
        const from = memoryStorage();
        savePersonalDraft({ match: 'Calm', kind: 'respell', value: 'Kahm', scope: 'all' }, null, opts(from));
        savePersonalDraft({ match: 'Beta', kind: 'phoneme', value: 'B EY1 T AH0', scope: 'wfo:LMK' }, null, opts(from));
        const file = exportPersonalText(opts(from));
        expect(file.fileName).toBe(EXPORT_FILE_NAME);
        expect(file.count).toBe(2);
        expect(JSON.parse(file.text)).toMatchObject({ type: 'eas-tools-nwr-pronunciation', version: 1 });
        const to = memoryStorage();
        expect(importPersonalText(file.text, opts(to))).toEqual({ ok: true, message: 'Imported 2 pronunciations.' });
        expect(readPersonal(to).map((e) => e.match)).toEqual(['Calm', 'Beta']);
    });

    it('reports skipped entries, wrong files and broken JSON', () => {
        const mixed = JSON.stringify({ type: 'eas-tools-nwr-pronunciation', version: 1, entries: [respell('ok', 'Okay', 'Okey', { scope: 'all' }), { id: 'bad', match: 'QQ', replace: { kind: 'phoneme', ph: 'AR2' }, scope: 'all' }] });
        expect(importPersonalText(mixed, opts(memoryStorage()))).toEqual({ ok: true, message: 'Imported 1 pronunciations, skipped 1 (unknown phone AR2).' });
        expect(importPersonalText('{"type":"other"}', opts(memoryStorage()))).toEqual({ ok: false, error: 'This is not an EAS Tools pronunciation file.' });
        expect(importPersonalText('{broken', opts(memoryStorage()))).toEqual({ ok: false, error: 'That file is not valid JSON.' });
        expect(importPersonalText(undefined, opts(memoryStorage())).ok).toBe(false);
        expect(PRON_TEST_FIELDS).toEqual({ pronTest: '1' });
    });
});

describe('storage keys', () => {
    it('writes personal entries where the store reads them', () => {
        const storage = memoryStorage();
        savePersonalDraft({ match: 'Calm', kind: 'respell', value: 'Kahm', scope: 'all' }, null, opts(storage));
        expect(JSON.parse(storage.getItem(PERSONAL_KEY)).entries).toHaveLength(1);
    });
});
