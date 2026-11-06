import { TTS_BACKEND_URL, fetchRemoteTtsAudio, getPronunciationRepository, getRemoteTtsFeatures, saveFile } from './common-functions.js';
import { renderReplacement, LIMITS } from './nwr-pronunciation.js';
import { readPersonal, readSelection, readSubmissions } from './nwr-pronunciation-store.js';
import {
    KIND_LABELS,
    PRON_TEST_FIELDS,
    exportPersonalText,
    importPersonalText,
    LAYER_LABELS,
    SHARED_LIMIT,
    STATUS_LABELS,
    testNote,
    VALUE_HINTS,
    checkSubmission,
    draftEntry,
    draftProblem,
    filterShared,
    loadEditorContext,
    planSubmissions,
    removePersonalByKey,
    replacementText,
    replacementValue,
    savePersonalDraft,
    scopeLabel,
    sendSubmissions,
    targetLabel,
    turnOffShared,
    withdrawSubmission,
} from './nwr-pronunciation-editing.js';

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

export function clientInfo() {
    return { app: window.Capacitor ? (/iphone|ipad/i.test(navigator.userAgent) ? 'ios' : 'android') : 'web', version: '' };
}

export async function playPcm(pcm, sampleRate) {
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

export async function testDraftWithPaul(draft, voice = 'paul') {
    const problem = draftProblem(draft);
    if (problem) return { ok: false, error: problem };
    try {
        const result = await fetchRemoteTtsAudio({ text: renderReplacement(draft.replace, draft.match), voice, backend: 'VT', pronunciation: false, extraFields: PRON_TEST_FIELDS });
        await playPcm(result.pcm, result.sampleRate);
        return { ok: true, message: 'Playing "' + draft.match + '".' };
    } catch (error) {
        return { ok: false, error: 'Could not test: ' + error.message };
    }
}

export async function openPronunciationEditor({ returnFocus = null, voice = 'paul', onClose = null } = {}) {
    if (openDialog) {
        openDialog.focus();
        return openDialog;
    }
    const repository = getPronunciationRepository();
    const context = await loadEditorContext(repository, readSelection());
    const { scopes, targets, inherited, sets } = context;
    const canSubmit = !!getRemoteTtsFeatures()?.pronunciation?.submit;
    let editing = null;

    const title = el('h3', { id: 'nwrPronEditorTitle', text: 'My VT Paul pronunciations' });
    const intro = el('p', { text: 'Your own pronunciations are kept in this browser and win over the shared ones. Showing the shared dictionary for ' + context.label + '.' });

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
    const form = el('section', { class: 'nwr-pron-editor__form', 'aria-labelledby': 'nwrPronFormTitle' }, [
        el('h4', { id: 'nwrPronFormTitle', text: 'Add or change a pronunciation' }),
        field('Word or phrase', matchInput),
        field('Kind of replacement', kindSelect),
        field('Replacement', valueInput, VALUE_HINTS.phoneme),
        el('div', { class: 'sp-alert-field sp-alert-check' }, [caseInput, el('label', { for: caseInput.id, text: 'Only when the capitalisation matches exactly' })]),
        field('Applies to', scopeSelect),
        formError,
        el('div', { class: 'sp-alert-actions' }, [clearButton, testButton, saveButton]),
        el('small', { class: 'nwr-pron-editor__test-note', text: testNote(getRemoteTtsFeatures()), hidden: !testNote(getRemoteTtsFeatures()) }),
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

    const submitTarget = el('select', { id: 'nwrPronSubmitTarget' }, targets.map((t) => el('option', { value: t, text: targetLabel(t) })));
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
        el('h4', { id: 'nwrPronSubmitTitle', text: 'Suggest these changes for everyone who uses EAS Tools' }),
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
    const hr = el('hr');
    const br = el('br');
    const closeButton = el('button', { type: 'button', text: 'Close' });
    const dialog = el('dialog', { class: 'sp-alert-dialog nwr-pron-editor', 'aria-labelledby': title.id }, [
        title,
        intro,
        hr.cloneNode(),
        form,
        personalTable,
        br.cloneNode(),
        hr.cloneNode(),
        submitSection,
        hr.cloneNode(),
        br.cloneNode(),
        el('section', { 'aria-labelledby': 'nwrPronInheritedTitle' }, [
            el('h4', { id: 'nwrPronInheritedTitle', text: 'Shared dictionary for this selection' }),
            field('Filter by word', filterInput),
            inheritedCount,
            inheritedTable,
        ]),
        hr.cloneNode(),
        el('section', { 'aria-labelledby': 'nwrPronShareTitle' }, [
            el('h4', { id: 'nwrPronShareTitle', text: 'Import other\'s pronunciations, or export your own to share' }),
            el('div', { class: 'sp-alert-actions nwr-pron-editor__left' }, [
                el('button', { type: 'button', text: 'Import', onclick: () => fileInput.click() }),
                el('button', { type: 'button', text: 'Export', onclick: exportFile }),
            ]),
            fileInput,
            shareStatus,
        ]),
        el('div', { class: 'sp-alert-actions' }, [closeButton]),
    ]);

    const formValues = () => ({ match: matchInput.value, kind: kindSelect.value, value: valueInput.value, caseSensitive: caseInput.checked, scope: scopeSelect.value });

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
        if (hint) hint.textContent = VALUE_HINTS[kindSelect.value];
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
                            const result = removePersonalByKey(entry.id, entry.scope);
                            formStatus.textContent = result.ok ? result.message : result.error;
                            renderAll();
                        },
                    }),
                ]),
            ]));
        }
        submitChoices.replaceChildren(el('legend', { text: 'Pronunciations to send' }));
        if (!entries.length) submitChoices.appendChild(el('p', { text: 'Save a pronunciation first, or send only speed and pauses (below).' }));
        entries.forEach((entry, i) => {
            const box = el('input', { type: 'checkbox', id: 'nwrPronSend' + i, value: String(i) });
            submitChoices.appendChild(el('div', { class: 'sp-alert-field sp-alert-check' }, [box, el('label', { for: box.id, text: entry.match + ' → ' + (entry.disabled ? 'remove' : replacementText(entry.replace)) })]));
        });
    }

    function renderInherited() {
        const rows = filterShared(inherited, filterInput.value);
        inheritedBody.replaceChildren();
        for (const item of rows.slice(0, SHARED_LIMIT)) {
            const { entry, layer } = item;
            const name = '"' + entry.match + '"';
            const scope = scopes[scopes.length - 1];
            const actions = [
                el('button', { type: 'button', text: 'Override', 'aria-label': 'Write your own pronunciation for ' + name, onclick: () => fillForm({ ...entry, id: entry.id }, scope) }),
                ' ',
                el('button', {
                    type: 'button', text: 'Turn off', 'aria-label': 'Turn off the shared pronunciation for ' + name,
                    onclick: () => {
                        const result = turnOffShared(entry, scope);
                        formStatus.textContent = result.ok ? result.message : result.error;
                        renderAll();
                    },
                }),
            ];
            for (const v of entry.variants || []) {
                actions.push(' ', el('button', {
                    type: 'button', text: 'Use: ' + (v.label || v.id), 'aria-label': 'Use the variant "' + (v.label || v.id) + '" for ' + name,
                    onclick: () => fillForm({ ...entry, replace: v.replace }, scope),
                }));
            }
            inheritedBody.appendChild(el('tr', {}, [
                el('th', { scope: 'row', text: entry.match }),
                el('td', { text: replacementText(entry.replace) + (entry.verified === false ? ' (unverified)' : '') }),
                el('td', { text: LAYER_LABELS[layer] || layer }),
                el('td', {}, actions),
            ]));
        }
        inheritedCount.textContent = rows.length > SHARED_LIMIT ? 'Showing ' + SHARED_LIMIT + ' of ' + rows.length + ' entries; filter to narrow it down.' : rows.length + (rows.length === 1 ? ' entry.' : ' entries.');
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
                        const result = await checkSubmission(sub.id, { apiUrl: TTS_BACKEND_URL });
                        if (result.ok) {
                            if (result.newlyApproved) repository.invalidate();
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
                        const result = await withdrawSubmission(sub.id, { apiUrl: TTS_BACKEND_URL });
                        if (!result.ok) status.textContent = result.error;
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
        const file = exportPersonalText();
        saveFile(file.fileName, file.text, 'application/json')
            .then(() => { shareStatus.textContent = 'Exported ' + file.count + ' pronunciations.'; })
            .catch((error) => { shareStatus.textContent = 'Could not export: ' + error.message; });
    }

    async function submitAll() {
        submitError.textContent = '';
        const personal = readPersonal();
        const chosen = [...submitChoices.querySelectorAll('input[type="checkbox"]:checked')].map((box) => personal[Number(box.value)]).filter(Boolean);
        const target = submitTarget.value;
        const plan = planSubmissions({
            chosen,
            target,
            sets,
            prosody: { speed: speedInput.value, comma: commaInput.value, period: periodInput.value },
            notes: submitNotes.value,
            links: submitLinks.value,
            client: clientInfo(),
        });
        if (!plan.ok) {
            submitError.textContent = plan.error;
            return;
        }
        submitButton.disabled = true;
        submitStatus.textContent = 'Sending...';
        const result = await sendSubmissions(plan.requests, { apiUrl: TTS_BACKEND_URL, target });
        submitButton.disabled = false;
        if (result.error) submitError.textContent = result.error;
        submitStatus.textContent = result.message || '';
        renderSubmissions();
    }

    kindSelect.addEventListener('change', updateHint);
    filterInput.addEventListener('input', renderInherited);
    clearButton.addEventListener('click', () => fillForm(null, scopes[scopes.length - 1]));
    saveButton.addEventListener('click', () => {
        const result = savePersonalDraft(formValues(), editing);
        if (!result.ok) {
            formError.textContent = result.error;
            return;
        }
        formError.textContent = '';
        formStatus.textContent = result.message;
        editing = null;
        renderAll();
    });
    testButton.addEventListener('click', async () => {
        const draft = draftEntry(formValues(), editing);
        const problem = draftProblem(draft);
        if (problem) {
            formError.textContent = problem;
            return;
        }
        formError.textContent = '';
        testButton.disabled = true;
        formStatus.textContent = 'Asking Paul...';
        const result = await testDraftWithPaul(draft, voice);
        formStatus.textContent = result.ok ? result.message : result.error;
        testButton.disabled = false;
    });
    fileInput.addEventListener('change', async () => {
        const file = fileInput.files?.[0];
        fileInput.value = '';
        if (!file) return;
        const result = importPersonalText(await file.text());
        shareStatus.textContent = result.ok ? result.message : result.error;
        renderAll();
    });
    submitButton.addEventListener('click', submitAll);
    closeButton.addEventListener('click', () => dialog.close());
    const outsideDialog = (event) => {
        if (event.target !== dialog) return false;
        const rect = dialog.getBoundingClientRect();
        return event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom;
    };
    let pressedOutside = false;
    dialog.addEventListener('pointerdown', (event) => {
        pressedOutside = outsideDialog(event);
    });
    dialog.addEventListener('click', (event) => {
        if (pressedOutside && outsideDialog(event)) dialog.close();
        pressedOutside = false;
    });
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
