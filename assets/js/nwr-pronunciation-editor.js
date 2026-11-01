import { TTS_BACKEND_URL, fetchRemoteTtsAudio, getPronunciationRepository, getRemoteTtsFeatures, saveFile } from './common-functions.js';
import { entryKey, mergeLayers, parseSourceId, renderReplacement, slugifyMatch, validateEntry, LIMITS } from './nwr-pronunciation.js';
import {
    buildSubmission,
    exportPersonal,
    importPersonal,
    parseApiResponse,
    readPersonal,
    readSelection,
    readSubmissions,
    recordSubmission,
    removePersonalEntry,
    savePersonalEntry,
    updateSubmission,
} from './nwr-pronunciation-store.js';

const KIND_LABELS = { phoneme: 'Phoneme (CMU)', respell: 'Respelling', vtml: 'VTML markup' };
const LAYER_LABELS = { national: 'National', wfo: 'Office', tx: 'Transmitter' };
const STATUS_LABELS = { pending: 'Waiting for review', approved: 'Approved', rejected: 'Not accepted', withdrawn: 'Withdrawn', superseded: 'Replaced by a newer submission' };

let openDialog = null;

function el(tag, props = {}, children = []) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(props)) {
        if (value === undefined || value === null) continue;
        if (key === 'text') node.textContent = value;
        else if (key === 'hidden') node.hidden = !!value;
        else if (key === 'checked' || key === 'disabled' || key === 'value') node[key] = value;
        else if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2), value);
        else node.setAttribute(key, value);
    }
    for (const child of children) node.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
    return node;
}

function field(labelText, control, hint) {
    const wrap = el('div', { class: 'sp-alert-field' }, [el('label', { for: control.id, text: labelText }), control]);
    if (hint) {
        const hintId = control.id + 'Hint';
        control.setAttribute('aria-describedby', hintId);
        wrap.appendChild(el('small', { id: hintId, text: hint }));
    }
    return wrap;
}

function replacementText(replace) {
    if (!replace) return '(turned off)';
    if (replace.kind === 'phoneme') return replace.ph + (replace.on ? ' (on "' + replace.on + '")' : '');
    if (replace.kind === 'respell') return replace.text;
    return replace.markup;
}

function replacementValue(replace) {
    if (!replace) return '';
    return replace.kind === 'phoneme' ? replace.ph : replace.kind === 'respell' ? replace.text : replace.markup;
}

function buildReplace(kind, value) {
    const text = String(value || '').trim();
    if (kind === 'phoneme') return { kind, ph: text.toUpperCase().replace(/\s+/g, ' ') };
    if (kind === 'respell') return { kind, text };
    return { kind, markup: text };
}

function scopeLabel(scope) {
    if (scope === 'all') return 'Everywhere';
    const parsed = parseSourceId(scope);
    return parsed ? parsed.id + (parsed.type === 'wfo' ? ' office' : ' transmitter') : scope;
}

async function postForm(url, body) {
    try {
        const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
        return parseApiResponse(response.status, await response.text(), response.headers.get('Retry-After'));
    } catch {
        return parseApiResponse(0, '');
    }
}

async function getJson(url) {
    try {
        const response = await fetch(url);
        return parseApiResponse(response.status, await response.text(), response.headers.get('Retry-After'));
    } catch {
        return parseApiResponse(0, '');
    }
}

async function playPcm(pcm, sampleRate) {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) throw new Error('this browser cannot play audio');
    const ctx = new Ctx();
    const buffer = ctx.createBuffer(1, pcm.length, sampleRate);
    buffer.getChannelData(0).set(pcm);
    const node = ctx.createBufferSource();
    node.buffer = buffer;
    node.connect(ctx.destination);
    node.onended = () => ctx.close().catch(() => { });
    node.start();
}

export async function openPronunciationEditor({ returnFocus = null, voice = 'paul', onClose = null } = {}) {
    if (openDialog) {
        openDialog.focus();
        return openDialog;
    }
    const repository = getPronunciationRepository();
    const selection = readSelection();
    const source = parseSourceId(selection.source) || { type: 'national', id: '' };
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
    const canSubmit = !!getRemoteTtsFeatures()?.pronunciation?.submit;
    let editing = null;

    const title = el('h3', { id: 'nwrPronEditorTitle', text: 'My VT Paul pronunciations' });
    const intro = el('p', { text: 'Your own pronunciations are kept in this browser and win over the shared ones. Showing the shared dictionary for ' + (source.type === 'national' ? 'the national list' : (source.type === 'tx' ? source.id + ' (' + txWfo + ')' : wfoId)) + '.' });

    const matchInput = el('input', { id: 'nwrPronMatch', type: 'text', maxlength: String(LIMITS.matchChars), autocomplete: 'off', spellcheck: 'false' });
    const kindSelect = el('select', { id: 'nwrPronKind' }, Object.entries(KIND_LABELS).map(([value, label]) => el('option', { value, text: label })));
    const valueInput = el('input', { id: 'nwrPronValue', type: 'text', autocomplete: 'off', spellcheck: 'false' });
    const caseInput = el('input', { id: 'nwrPronCase', type: 'checkbox' });
    const scopeSelect = el('select', { id: 'nwrPronScope' }, scopes.map((scope) => el('option', { value: scope, text: scopeLabel(scope) })));
    const formError = el('p', { class: 'sp-alert-error', role: 'alert' });
    const formStatus = el('p', { class: 'nwr-pron-editor__status', 'aria-live': 'polite' });
    const saveButton = el('button', { type: 'button', text: 'Save pronunciation' });
    const testButton = el('button', { type: 'button', text: 'Test with Paul' });
    const clearButton = el('button', { type: 'button', text: 'Clear form' });
    const valueHints = {
        phoneme: 'CMU phones separated by spaces, e.g. IH1 L AH0 N OY1. Stress digits 0 to 2 go on vowels only.',
        respell: 'How Paul should read it, e.g. Illynois.',
        vtml: 'Allowed tags: vtml_phoneme, vtml_pause, vtml_break. Write {{match}} for the original word.',
    };
    const form = el('section', { class: 'nwr-pron-editor__form', 'aria-labelledby': 'nwrPronFormTitle' }, [
        el('h4', { id: 'nwrPronFormTitle', text: 'Add or change a pronunciation' }),
        field('Word or phrase', matchInput),
        field('Kind of replacement', kindSelect),
        field('Replacement', valueInput, valueHints.phoneme),
        el('div', { class: 'sp-alert-field sp-alert-check' }, [caseInput, el('label', { for: caseInput.id, text: 'Only when the capitalisation matches exactly' })]),
        field('Applies to', scopeSelect),
        formError,
        el('div', { class: 'sp-alert-actions' }, [clearButton, testButton, saveButton]),
        formStatus,
    ]);

    const personalBody = el('tbody');
    const personalTable = el('table', { class: 'nwr-pron-editor__table' }, [
        el('caption', { text: 'Your pronunciations' }),
        el('thead', {}, [el('tr', {}, ['Word', 'Replacement', 'Applies to', 'Actions'].map((h) => el('th', { scope: 'col', text: h })))]),
        personalBody,
    ]);

    const filterInput = el('input', { id: 'nwrPronFilter', type: 'search', autocomplete: 'off' });
    const inheritedBody = el('tbody');
    const inheritedCount = el('p', { 'aria-live': 'polite' });
    const inheritedTable = el('table', { class: 'nwr-pron-editor__table' }, [
        el('caption', { text: 'Shared dictionary' }),
        el('thead', {}, [el('tr', {}, ['Word', 'Replacement', 'From', 'Actions'].map((h) => el('th', { scope: 'col', text: h })))]),
        inheritedBody,
    ]);

    const fileInput = el('input', { type: 'file', accept: '.json,application/json', hidden: true, 'aria-hidden': 'true', tabindex: '-1' });
    const shareStatus = el('p', { 'aria-live': 'polite' });

    const submitTarget = el('select', { id: 'nwrPronSubmitTarget' }, targets.map((t) => el('option', { value: t, text: t === 'national' ? 'National dictionary' : t.replace('wfo/', '').replace('tx/', '') + (t.startsWith('wfo/') ? ' office' : ' transmitter') })));
    submitTarget.value = targets[targets.length - 1];
    const submitNotes = el('textarea', { id: 'nwrPronSubmitNotes', rows: '3', maxlength: String(LIMITS.evidenceNotesChars) });
    const submitLinks = el('input', { id: 'nwrPronSubmitLinks', type: 'text', autocomplete: 'off' });
    const submitChoices = el('fieldset', { class: 'nwr-pron-editor__choices' });
    const speedInput = el('input', { id: 'nwrPronSpeed', type: 'number', min: String(LIMITS.speedMin), max: String(LIMITS.speedMax), step: '1' });
    const commaInput = el('input', { id: 'nwrPronComma', type: 'number', min: '0', max: String(LIMITS.commaPauseMax), step: '5' });
    const periodInput = el('input', { id: 'nwrPronPeriod', type: 'number', min: '0', max: String(LIMITS.periodPauseMax), step: '5' });
    const submitError = el('p', { class: 'sp-alert-error', role: 'alert' });
    const submitStatus = el('p', { 'aria-live': 'polite' });
    const submitButton = el('button', { type: 'button', text: 'Send for review' });
    const submissionsList = el('ul', { class: 'nwr-pron-editor__submissions' });
    const submitSection = el('section', { 'aria-labelledby': 'nwrPronSubmitTitle', hidden: !canSubmit }, [
        el('h4', { id: 'nwrPronSubmitTitle', text: 'Suggest these for everyone' }),
        el('p', { text: 'Submissions are anonymous and are reviewed before anyone else hears them. Include how you know, such as a recording of the transmitter.' }),
        field('Dictionary to change', submitTarget),
        submitChoices,
        el('fieldset', {}, [
            el('legend', { text: 'Speed and pauses (optional)' }),
            field('Speed (100 is normal)', speedInput),
            field('Comma pause in milliseconds', commaInput),
            field('Period pause in milliseconds', periodInput),
        ]),
        field('How do you know? (optional)', submitNotes),
        field('Links to recordings (optional, https only, separate with spaces)', submitLinks),
        submitError,
        el('div', { class: 'sp-alert-actions' }, [submitButton]),
        submitStatus,
        el('h4', { text: 'My submissions' }),
        submissionsList,
    ]);

    const closeButton = el('button', { type: 'button', text: 'Close' });
    const dialog = el('dialog', { class: 'sp-alert-dialog nwr-pron-editor', 'aria-labelledby': title.id }, [
        title,
        intro,
        form,
        personalTable,
        el('section', { 'aria-labelledby': 'nwrPronInheritedTitle' }, [
            el('h4', { id: 'nwrPronInheritedTitle', text: 'Shared dictionary for this selection' }),
            field('Filter by word', filterInput),
            inheritedCount,
            inheritedTable,
        ]),
        el('section', { 'aria-labelledby': 'nwrPronShareTitle' }, [
            el('h4', { id: 'nwrPronShareTitle', text: 'Back up or share a file' }),
            el('div', { class: 'sp-alert-actions nwr-pron-editor__left' }, [
                el('button', { type: 'button', text: 'Export my pronunciations', onclick: exportFile }),
                el('button', { type: 'button', text: 'Import a pronunciation file', onclick: () => fileInput.click() }),
            ]),
            fileInput,
            shareStatus,
        ]),
        submitSection,
        el('div', { class: 'sp-alert-actions' }, [closeButton]),
    ]);

    function draftEntry() {
        const match = matchInput.value.trim().replace(/\s+/g, ' ');
        const entry = { id: editing?.id || slugifyMatch(match), match, replace: buildReplace(kindSelect.value, valueInput.value), caseSensitive: caseInput.checked, scope: scopeSelect.value };
        return entry;
    }

    function fillForm(entry, scope) {
        editing = entry && scope ? { id: entry.id, scope } : null;
        matchInput.value = entry?.match || '';
        kindSelect.value = entry?.replace?.kind || 'phoneme';
        valueInput.value = replacementValue(entry?.replace);
        caseInput.checked = !!entry?.caseSensitive;
        scopeSelect.value = scopes.includes(scope) ? scope : scopes[scopes.length - 1];
        updateHint();
        formError.textContent = '';
        matchInput.focus();
    }

    function updateHint() {
        const hint = form.querySelector('#nwrPronValueHint');
        if (hint) hint.textContent = valueHints[kindSelect.value];
    }

    function renderPersonal() {
        const entries = readPersonal();
        personalBody.replaceChildren();
        if (!entries.length) {
            personalBody.appendChild(el('tr', {}, [el('td', { colspan: '4', text: 'None yet.' })]));
        }
        for (const entry of entries) {
            const name = '"' + entry.match + '"';
            personalBody.appendChild(el('tr', {}, [
                el('th', { scope: 'row', text: entry.match }),
                el('td', { text: entry.disabled ? '(turned off)' : replacementText(entry.replace) }),
                el('td', { text: scopeLabel(entry.scope) }),
                el('td', {}, [
                    el('button', { type: 'button', text: 'Edit', 'aria-label': 'Edit ' + name, disabled: !!entry.disabled, onclick: () => fillForm(entry, entry.scope) }),
                    ' ',
                    el('button', {
                        type: 'button', text: 'Remove', 'aria-label': 'Remove ' + name,
                        onclick: () => {
                            removePersonalEntry(entry.id, entry.scope);
                            formStatus.textContent = 'Removed ' + name + '.';
                            renderAll();
                        },
                    }),
                ]),
            ]));
        }
        submitChoices.replaceChildren(el('legend', { text: 'Pronunciations to send' }));
        if (!entries.length) submitChoices.appendChild(el('p', { text: 'Save a pronunciation first, or send only speed and pauses.' }));
        entries.forEach((entry, i) => {
            const box = el('input', { type: 'checkbox', id: 'nwrPronSend' + i, value: String(i) });
            submitChoices.appendChild(el('div', { class: 'sp-alert-field sp-alert-check' }, [box, el('label', { for: box.id, text: entry.match + ' → ' + (entry.disabled ? 'remove' : replacementText(entry.replace)) })]));
        });
    }

    function renderInherited() {
        const query = filterInput.value.trim().toLowerCase();
        const rows = inherited.filter((item) => !query || item.entry.match.toLowerCase().includes(query));
        inheritedBody.replaceChildren();
        for (const item of rows.slice(0, 200)) {
            const { entry, layer } = item;
            const name = '"' + entry.match + '"';
            const actions = [
                el('button', { type: 'button', text: 'Override', 'aria-label': 'Write your own pronunciation for ' + name, onclick: () => fillForm({ ...entry, id: entry.id }, scopes[scopes.length - 1]) }),
                ' ',
                el('button', {
                    type: 'button', text: 'Turn off', 'aria-label': 'Turn off the shared pronunciation for ' + name,
                    onclick: () => {
                        const result = savePersonalEntry({ id: entry.id, match: entry.match, caseSensitive: !!entry.caseSensitive, scope: scopes[scopes.length - 1], disabled: true });
                        formStatus.textContent = result.ok ? 'Turned off ' + name + ' for ' + scopeLabel(scopes[scopes.length - 1]) + '.' : result.error;
                        renderAll();
                    },
                }),
            ];
            for (const v of entry.variants || []) {
                actions.push(' ', el('button', {
                    type: 'button', text: 'Use: ' + (v.label || v.id), 'aria-label': 'Use the variant "' + (v.label || v.id) + '" for ' + name,
                    onclick: () => fillForm({ ...entry, replace: v.replace }, scopes[scopes.length - 1]),
                }));
            }
            inheritedBody.appendChild(el('tr', {}, [
                el('th', { scope: 'row', text: entry.match }),
                el('td', { text: replacementText(entry.replace) + (entry.verified === false ? ' (unverified)' : '') }),
                el('td', { text: LAYER_LABELS[layer] || layer }),
                el('td', {}, actions),
            ]));
        }
        inheritedCount.textContent = rows.length > 200 ? 'Showing 200 of ' + rows.length + ' entries; filter to narrow it down.' : rows.length + (rows.length === 1 ? ' entry.' : ' entries.');
    }

    function renderSubmissions() {
        const list = readSubmissions();
        submissionsList.replaceChildren();
        if (!list.length) submissionsList.appendChild(el('li', { text: 'Nothing sent yet.' }));
        for (const sub of list) {
            const status = el('span', { text: STATUS_LABELS[sub.lastStatus] || sub.lastStatus || 'Unknown' });
            const item = el('li', {}, [
                sub.target + ' · ' + new Date(sub.submittedAt || Date.now()).toLocaleDateString() + ' · ', status,
                sub.reviewerNote ? ' · Reviewer: ' + sub.reviewerNote : '',
                ' ',
                el('button', {
                    type: 'button', text: 'Check status', 'aria-label': 'Check the status of submission ' + sub.id,
                    onclick: async () => {
                        const result = await getJson(TTS_BACKEND_URL + '&pron=status&id=' + encodeURIComponent(sub.id) + '&token=' + encodeURIComponent(sub.token));
                        if (result.ok) {
                            updateSubmission(sub.id, { lastStatus: result.data.status, reviewerNote: result.data.reviewerNote || '' });
                            renderSubmissions();
                        } else {
                            status.textContent = result.error;
                        }
                    },
                }),
            ]);
            if (sub.lastStatus === 'pending') {
                item.appendChild(document.createTextNode(' '));
                item.appendChild(el('button', {
                    type: 'button', text: 'Withdraw', 'aria-label': 'Withdraw submission ' + sub.id,
                    onclick: async () => {
                        const body = new URLSearchParams({ id: sub.id, token: sub.token }).toString();
                        const result = await postForm(TTS_BACKEND_URL + '&pron=withdraw', body);
                        if (result.ok) updateSubmission(sub.id, { lastStatus: 'withdrawn' });
                        else status.textContent = result.error;
                        renderSubmissions();
                    },
                }));
            }
            submissionsList.appendChild(item);
        }
    }

    function renderAll() {
        renderPersonal();
        renderInherited();
        if (canSubmit) renderSubmissions();
    }

    function exportFile() {
        const doc = exportPersonal(readPersonal());
        saveFile('eas-tools-pronunciations.json', JSON.stringify(doc, null, 4), 'application/json')
            .then(() => { shareStatus.textContent = 'Exported ' + doc.entries.length + ' pronunciations.'; })
            .catch((error) => { shareStatus.textContent = 'Could not export: ' + error.message; });
    }

    async function submitAll() {
        submitError.textContent = '';
        const personal = readPersonal();
        const chosen = [...submitChoices.querySelectorAll('input[type="checkbox"]:checked')].map((box) => personal[Number(box.value)]).filter(Boolean);
        const target = submitTarget.value;
        const targetSet = target === 'national' ? national : target.startsWith('wfo/') ? wfoSet : txSet;
        const existing = new Map((targetSet?.entries || []).map((e) => [entryKey(e), e]));
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
        const prosody = {};
        const num = (input) => (input.value === '' ? null : Number(input.value));
        if (num(speedInput) !== null) prosody.speed = { value: num(speedInput) };
        if (num(commaInput) !== null) prosody.commaPauseMs = { value: num(commaInput) };
        if (num(periodInput) !== null) prosody.periodPauseMs = { value: num(periodInput) };
        const evidence = { notes: submitNotes.value, links: submitLinks.value.split(/\s+/).filter(Boolean) };
        const client = { app: window.Capacitor ? (/iphone|ipad/i.test(navigator.userAgent) ? 'ios' : 'android') : 'web', version: '' };
        const requests = [];
        for (const action of ['add', 'change', 'remove']) {
            if (groups[action].length) requests.push(buildSubmission({ target, action, entries: groups[action], evidence, client }));
        }
        if (Object.keys(prosody).length) requests.push(buildSubmission({ target, action: 'prosody', prosody, evidence, client }));
        if (!requests.length) {
            submitError.textContent = chosen.length ? 'Those pronunciations already match the shared dictionary.' : 'Choose at least one pronunciation, or fill in speed or pauses.';
            return;
        }
        const invalid = requests.find((r) => !r.ok);
        if (invalid) {
            submitError.textContent = invalid.error;
            return;
        }
        submitButton.disabled = true;
        submitStatus.textContent = 'Sending...';
        let sent = 0;
        for (const request of requests) {
            const result = await postForm(TTS_BACKEND_URL + '&pron=submit', request.body);
            if (!result.ok) {
                submitError.textContent = result.code === 'rate_limited' && result.retryAfter
                    ? 'Too many submissions for now; try again in ' + Math.ceil(result.retryAfter / 60) + ' minutes.'
                    : result.error + (result.details[0] ? ' (' + result.details[0].path + ': ' + result.details[0].problem + ')' : '');
                break;
            }
            recordSubmission({ id: result.data.id, token: result.data.token, target, action: request.payload.action, submittedAt: Date.now(), lastStatus: result.data.status || 'pending' });
            sent++;
        }
        submitButton.disabled = false;
        submitStatus.textContent = sent ? 'Sent ' + sent + (sent === 1 ? ' submission' : ' submissions') + ' for review. Thank you.' : '';
        renderSubmissions();
    }

    kindSelect.addEventListener('change', updateHint);
    filterInput.addEventListener('input', renderInherited);
    clearButton.addEventListener('click', () => fillForm(null, scopes[scopes.length - 1]));
    saveButton.addEventListener('click', () => {
        const draft = draftEntry();
        const problems = validateEntry({ ...draft, scope: undefined });
        if (problems.length) {
            formError.textContent = problems[0].problem;
            return;
        }
        if (editing && (editing.scope !== draft.scope || editing.id !== draft.id)) removePersonalEntry(editing.id, editing.scope);
        const result = savePersonalEntry(draft);
        if (!result.ok) {
            formError.textContent = result.error;
            return;
        }
        formError.textContent = '';
        formStatus.textContent = (result.replaced ? 'Updated ' : 'Saved ') + '"' + result.entry.match + '" for ' + scopeLabel(result.entry.scope) + '.';
        editing = null;
        renderAll();
    });
    testButton.addEventListener('click', async () => {
        const draft = draftEntry();
        const problems = validateEntry({ ...draft, scope: undefined });
        if (problems.length) {
            formError.textContent = problems[0].problem;
            return;
        }
        formError.textContent = '';
        testButton.disabled = true;
        formStatus.textContent = 'Asking Paul...';
        try {
            const result = await fetchRemoteTtsAudio({ text: renderReplacement(draft.replace, draft.match), voice, backend: 'VT', pronunciation: false });
            await playPcm(result.pcm, result.sampleRate);
            formStatus.textContent = 'Playing "' + draft.match + '".';
        } catch (error) {
            formStatus.textContent = 'Could not test: ' + error.message;
        } finally {
            testButton.disabled = false;
        }
    });
    fileInput.addEventListener('change', async () => {
        const file = fileInput.files?.[0];
        fileInput.value = '';
        if (!file) return;
        try {
            const result = importPersonal(JSON.parse(await file.text()));
            shareStatus.textContent = result.ok
                ? 'Imported ' + result.added + ' pronunciations' + (result.skipped ? ', skipped ' + result.skipped + ' (' + result.error + ')' : '') + '.'
                : result.error;
        } catch {
            shareStatus.textContent = 'That file is not valid JSON.';
        }
        renderAll();
    });
    submitButton.addEventListener('click', submitAll);
    closeButton.addEventListener('click', () => dialog.close());
    dialog.addEventListener('close', () => {
        dialog.remove();
        openDialog = null;
        if (typeof onClose === 'function') onClose();
        if (returnFocus && typeof returnFocus.focus === 'function') returnFocus.focus();
    });

    renderAll();
    updateHint();
    document.body.appendChild(dialog);
    openDialog = dialog;
    dialog.showModal();
    matchInput.focus();
    return dialog;
}
