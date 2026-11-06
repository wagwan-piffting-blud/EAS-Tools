import { entryKey, mergeLayers, parseSourceId, slugifyMatch, validateEntry, LIMITS } from './nwr-pronunciation.js';
import {
    buildSubmission,
    exportPersonal,
    importPersonal,
    parseApiResponse,
    readPersonal,
    readSubmissions,
    recordSubmission,
    removePersonalEntry,
    savePersonalEntry,
    updateSubmission,
} from './nwr-pronunciation-store.js';

export const KIND_LABELS = Object.freeze({ phoneme: 'Phoneme (CMU)', respell: 'Respelling', vtml: 'VTML markup' });
export const LAYER_LABELS = Object.freeze({ national: 'National', wfo: 'Office', tx: 'Transmitter' });
export const STATUS_LABELS = Object.freeze({ pending: 'Waiting for review', approved: 'Approved', rejected: 'Not accepted', withdrawn: 'Withdrawn', superseded: 'Replaced by a newer submission' });
export const VALUE_HINTS = Object.freeze({
    phoneme: 'CMU phones separated by spaces, e.g. IH1 L AH0 N OY1. Stress digits 0 to 2 go on vowels only.',
    respell: 'How Paul should read it, e.g. Illynois.',
    vtml: 'Allowed tags: vtml_phoneme, vtml_pause, vtml_break. Write {{match}} for the original word.',
});
export const SHARED_LIMIT = 200;
export const EXPORT_FILE_NAME = 'eas-tools-pronunciations.json';
export const PRON_TEST_FIELDS = Object.freeze({ pronTest: '1' });

export function exportPersonalText(options = {}) {
    const doc = exportPersonal(readPersonal(options.storage));
    return { fileName: EXPORT_FILE_NAME, text: JSON.stringify(doc, null, 4), count: doc.entries.length };
}

export function importPersonalText(text, options = {}) {
    let envelope;
    try {
        envelope = JSON.parse(String(text ?? ''));
    } catch {
        return { ok: false, error: 'That file is not valid JSON.' };
    }
    const result = importPersonal(envelope, options);
    if (!result.ok) return { ok: false, error: result.error };
    return { ok: true, message: 'Imported ' + result.added + ' pronunciations' + (result.skipped ? ', skipped ' + result.skipped + ' (' + result.error + ')' : '') + '.' };
}

export function replacementText(replace) {
    if (!replace) return '(turned off)';
    if (replace.kind === 'phoneme') return replace.ph + (replace.on ? ' (on "' + replace.on + '")' : '');
    if (replace.kind === 'respell') return replace.text;
    return replace.markup;
}

export function replacementValue(replace) {
    if (!replace) return '';
    return (replace.kind === 'phoneme' ? replace.ph : replace.kind === 'respell' ? replace.text : replace.markup) ?? '';
}

export function buildReplace(kind, value) {
    const text = String(value || '').trim();
    if (kind === 'phoneme') return { kind, ph: text.toUpperCase().replace(/\s+/g, ' ') };
    if (kind === 'respell') return { kind, text };
    return { kind, markup: text };
}

export function scopeLabel(scope) {
    if (scope === 'all') return 'Everywhere';
    const parsed = parseSourceId(scope);
    return parsed ? parsed.id + (parsed.type === 'wfo' ? ' office' : ' transmitter') : String(scope);
}

export function targetLabel(target) {
    if (target === 'national') return 'National dictionary';
    if (String(target).startsWith('wfo/')) return target.slice(4) + ' office';
    if (String(target).startsWith('tx/')) return target.slice(3) + ' transmitter';
    return String(target);
}

export async function loadEditorContext(repository, selection) {
    const source = parseSourceId(selection?.source) || { type: 'national', id: '' };
    const registry = await repository.loadTransmitters();
    const txWfo = source.type === 'tx' ? registry.transmitters?.[source.id]?.wfo || '' : '';
    const wfoId = source.type === 'wfo' ? source.id : txWfo;
    const [national, wfoSet, txSet] = await Promise.all([
        repository.loadSet('national'),
        wfoId ? repository.loadSet('wfo/' + wfoId) : null,
        source.type === 'tx' ? repository.loadSet('tx/' + source.id) : null,
    ]);
    const inherited = mergeLayers([
        { layer: 'national', entries: national?.entries },
        { layer: 'wfo', entries: wfoSet?.entries },
        { layer: 'tx', entries: txSet?.entries },
    ]).sort((a, b) => a.entry.match.localeCompare(b.entry.match));
    const scopes = ['all'];
    if (wfoId) scopes.push('wfo:' + wfoId);
    if (source.type === 'tx') scopes.push('tx:' + source.id);
    const targets = ['national'];
    if (wfoId) targets.push('wfo/' + wfoId);
    if (source.type === 'tx') targets.push('tx/' + source.id);
    const label = source.type === 'national' ? 'the national list' : source.type === 'tx' ? source.id + ' (' + txWfo + ')' : wfoId;
    return { source, txWfo, wfoId, label, scopes, targets, inherited, sets: { national, wfo: wfoSet, tx: txSet } };
}

export function filterShared(inherited, query) {
    const q = String(query || '').trim().toLowerCase();
    return q ? inherited.filter((item) => item.entry.match.toLowerCase().includes(q)) : inherited;
}

export function draftEntry({ match, kind, value, caseSensitive, scope } = {}, editing = null) {
    const text = String(match || '').trim().replace(/\s+/g, ' ');
    return { id: editing?.id || slugifyMatch(text), match: text, replace: buildReplace(kind, value), caseSensitive: !!caseSensitive, scope };
}

export function draftProblem(draft) {
    const problems = validateEntry({ ...draft, scope: undefined });
    return problems.length ? problems[0].problem : '';
}

export function savePersonalDraft(form, editing = null, options = {}) {
    const draft = draftEntry(form, editing);
    const problem = draftProblem(draft);
    if (problem) return { ok: false, error: problem };
    if (editing && (editing.scope !== draft.scope || editing.id !== draft.id)) removePersonalEntry(editing.id, editing.scope, options);
    const result = savePersonalEntry(draft, options);
    if (!result.ok) return { ok: false, error: result.error };
    return { ok: true, entry: result.entry, message: (result.replaced ? 'Updated ' : 'Saved ') + '"' + result.entry.match + '" for ' + scopeLabel(result.entry.scope) + '.' };
}

export function removePersonalByKey(id, scope, options = {}) {
    const entry = readPersonal(options.storage).find((e) => e.id === id && e.scope === scope);
    const result = removePersonalEntry(id, scope, options);
    return result.ok ? { ok: true, message: 'Removed "' + (entry?.match || id) + '".' } : { ok: false, error: 'That pronunciation is already gone.' };
}

export function turnOffShared(entry, scope, options = {}) {
    const result = savePersonalEntry({ id: entry.id, match: entry.match, caseSensitive: !!entry.caseSensitive, scope, disabled: true }, options);
    return result.ok
        ? { ok: true, message: 'Turned off "' + entry.match + '" for ' + scopeLabel(scope) + '.' }
        : { ok: false, error: result.error };
}

function setForTarget(sets, target) {
    if (target === 'national') return sets.national;
    return String(target).startsWith('wfo/') ? sets.wfo : sets.tx;
}

export function planSubmissions({ chosen = [], target, sets = {}, prosody = {}, notes = '', links = [], client = {} } = {}) {
    const existing = new Map((setForTarget(sets, target)?.entries || []).map((e) => [entryKey(e), e]));
    const groups = { add: [], change: [], remove: [] };
    for (const entry of chosen) {
        const prior = existing.get(entryKey(entry));
        if (entry.disabled) {
            if (prior) groups.remove.push({ ...prior });
        } else if (prior) {
            groups.change.push({ ...entry, id: prior.id });
        } else {
            groups.add.push(entry);
        }
    }
    const fields = {};
    const number = (value) => (value === '' || value === null || value === undefined ? null : Number(value));
    if (number(prosody.speed) !== null) fields.speed = { value: number(prosody.speed) };
    if (number(prosody.comma) !== null) fields.commaPauseMs = { value: number(prosody.comma) };
    if (number(prosody.period) !== null) fields.periodPauseMs = { value: number(prosody.period) };
    const evidence = { notes: String(notes || ''), links: (Array.isArray(links) ? links : String(links || '').split(/\s+/)).filter(Boolean) };
    const requests = [];
    for (const action of ['add', 'change', 'remove']) {
        if (groups[action].length) requests.push(buildSubmission({ target, action, entries: groups[action], evidence, client }));
    }
    if (Object.keys(fields).length) requests.push(buildSubmission({ target, action: 'prosody', prosody: fields, evidence, client }));
    if (!requests.length) {
        return { ok: false, error: chosen.length ? 'Those pronunciations already match the shared dictionary.' : 'Choose at least one pronunciation, or fill in speed or pauses.' };
    }
    const invalid = requests.find((r) => !r.ok);
    if (invalid) return { ok: false, error: invalid.error };
    return { ok: true, requests };
}

export function describeApiError(result) {
    if (result.code === 'rate_limited' && result.retryAfter) return 'Too many submissions for now; try again in ' + Math.ceil(result.retryAfter / 60) + ' minutes.';
    return result.error + (result.details?.[0] ? ' (' + result.details[0].path + ': ' + result.details[0].problem + ')' : '');
}

export async function postForm(url, body, fetchImpl = globalThis.fetch) {
    try {
        const response = await fetchImpl(url, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
        return parseApiResponse(response.status, await response.text(), response.headers.get('Retry-After'));
    } catch {
        return parseApiResponse(0, '');
    }
}

export async function getJson(url, fetchImpl = globalThis.fetch) {
    try {
        const response = await fetchImpl(url);
        return parseApiResponse(response.status, await response.text(), response.headers.get('Retry-After'));
    } catch {
        return parseApiResponse(0, '');
    }
}

export async function sendSubmissions(requests, { apiUrl, target, fetchImpl = globalThis.fetch, storage, now = Date.now } = {}) {
    let sent = 0;
    for (const request of requests) {
        const result = await postForm(apiUrl + '&pron=submit', request.body, fetchImpl);
        if (!result.ok) return { sent, error: describeApiError(result) };
        recordSubmission({ id: result.data.id, token: result.data.token, target, action: request.payload.action, submittedAt: now(), lastStatus: result.data.status || 'pending' }, storage);
        sent++;
    }
    return { sent, error: '', message: sent ? 'Sent ' + sent + (sent === 1 ? ' submission' : ' submissions') + ' for review. Thank you.' : '' };
}

export async function checkSubmission(id, { apiUrl, fetchImpl = globalThis.fetch, storage } = {}) {
    const sub = readSubmissions(storage).find((s) => s.id === id);
    if (!sub) return { ok: false, error: 'That submission is not on this device.' };
    const result = await getJson(apiUrl + '&pron=status&id=' + encodeURIComponent(sub.id) + '&token=' + encodeURIComponent(sub.token), fetchImpl);
    if (!result.ok) return { ok: false, error: result.error };
    updateSubmission(sub.id, { lastStatus: result.data.status, reviewerNote: result.data.reviewerNote || '' }, storage);
    return { ok: true, status: result.data.status, newlyApproved: result.data.status === 'approved' && sub.lastStatus !== 'approved' };
}

export async function withdrawSubmission(id, { apiUrl, fetchImpl = globalThis.fetch, storage } = {}) {
    const sub = readSubmissions(storage).find((s) => s.id === id);
    if (!sub) return { ok: false, error: 'That submission is not on this device.' };
    const result = await postForm(apiUrl + '&pron=withdraw', new URLSearchParams({ id: sub.id, token: sub.token }).toString(), fetchImpl);
    if (!result.ok) return { ok: false, error: result.error };
    updateSubmission(sub.id, { lastStatus: 'withdrawn' }, storage);
    return { ok: true };
}

export const FREE_TEST_NOTE = 'Tests do not count against your daily TTS limit.';

export function testNote(features) {
    return features?.pronunciation?.freeTest ? FREE_TEST_NOTE : '';
}

export function editorSnapshot(context, { personal = [], submissions = [], canSubmit = false, query = '', features = null } = {}) {
    const shared = filterShared(context.inherited, query);
    return {
        label: context.label,
        scopes: context.scopes.map((id) => ({ id, label: scopeLabel(id) })),
        targets: context.targets.map((id) => ({ id, label: targetLabel(id) })),
        kinds: Object.entries(KIND_LABELS).map(([id, label]) => ({ id, label, hint: VALUE_HINTS[id] })),
        canSubmit: !!canSubmit,
        testNote: testNote(features),
        limits: {
            matchChars: LIMITS.matchChars,
            speedMin: LIMITS.speedMin,
            speedMax: LIMITS.speedMax,
            commaPauseMax: LIMITS.commaPauseMax,
            periodPauseMax: LIMITS.periodPauseMax,
            evidenceNotesChars: LIMITS.evidenceNotesChars,
            evidenceLinks: LIMITS.evidenceLinks,
        },
        personal: personal.map((e) => ({
            id: e.id,
            scope: e.scope,
            scopeLabel: scopeLabel(e.scope),
            match: e.match,
            kind: e.replace?.kind || '',
            value: replacementValue(e.replace),
            caseSensitive: !!e.caseSensitive,
            disabled: !!e.disabled,
            text: e.disabled ? '(turned off)' : replacementText(e.replace),
        })),
        sharedTotal: shared.length,
        shared: shared.slice(0, SHARED_LIMIT).map(({ entry, layer }) => ({
            key: entryKey(entry),
            id: entry.id,
            match: entry.match,
            caseSensitive: !!entry.caseSensitive,
            kind: entry.replace?.kind || '',
            value: replacementValue(entry.replace),
            text: replacementText(entry.replace) + (entry.verified === false ? ' (unverified)' : ''),
            layer,
            layerLabel: LAYER_LABELS[layer] || layer,
            variants: (entry.variants || []).map((v) => ({ label: v.label || v.id, kind: v.replace?.kind || '', value: replacementValue(v.replace) })),
        })),
        submissions: submissions.map((s) => ({
            id: s.id,
            target: s.target,
            targetLabel: targetLabel(s.target),
            action: s.action || '',
            submittedAt: s.submittedAt || 0,
            status: s.lastStatus || '',
            statusLabel: STATUS_LABELS[s.lastStatus] || s.lastStatus || 'Unknown',
            reviewerNote: s.reviewerNote || '',
            canWithdraw: s.lastStatus === 'pending',
        })),
    };
}
