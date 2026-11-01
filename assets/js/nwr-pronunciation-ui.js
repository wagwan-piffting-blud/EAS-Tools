import { getPronunciationRepository, getRemoteTtsFeatures, planTtsPronunciation } from './common-functions.js';
import { isEligibleVoice, describeSpeed } from './nwr-pronunciation.js';
import { SELECTION_CHANGE, PERSONAL_CHANGE, readPersonal, readSelection, writeSelection } from './nwr-pronunciation-store.js';

const OFFICE_RE = /^[A-Z]{3}$/;

async function loadSearchableSelect() {
    if (!document.querySelector('link[href$="searchable-select.css"]')) {
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = new URL('../css/searchable-select.css', import.meta.url).href;
        document.head.appendChild(link);
    }
    if (!window.EASSearchableSelect) {
        try {
            await import('./searchable-select.js');
        } catch (error) {
            console.error('Unable to load the searchable select component.', error);
        }
    }
    return window.EASSearchableSelect || null;
}

function el(tag, props = {}, children = []) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(props)) {
        if (key === 'text') node.textContent = value;
        else if (key === 'hidden') node.hidden = !!value;
        else if (key in node && typeof value !== 'string') node[key] = value;
        else node.setAttribute(key, value);
    }
    for (const child of children) node.appendChild(child);
    return node;
}

function pauseText(summary) {
    const parts = [];
    if (summary.commaPauseMs) parts.push('comma ' + summary.commaPauseMs.value + ' ms');
    if (summary.periodPauseMs) parts.push('period ' + summary.periodPauseMs.value + ' ms');
    return parts.join(', ');
}

export function describeSelectionSummary(summary, features = getRemoteTtsFeatures()) {
    if (!summary) return '';
    const parts = [summary.label];
    const speed = describeSpeed(summary);
    if (speed) parts.push(speed);
    const pauses = pauseText(summary);
    if (pauses) parts.push(pauses);
    let text = parts.join(' · ') + '.';
    if (summary.unsupported.length) {
        const speedOnly = summary.unsupported.every((f) => f === 'vtSpeed');
        text += features?.vtProsody
            ? ' The TTS server cannot set ' + summary.unsupported.join(', ') + ' for this voice.'
            : speedOnly
                ? ' The TTS server cannot set office speed yet, so it is sent as speed markup.'
                : ' The TTS server cannot set office speed or pauses yet: speed is sent as markup and the pauses are skipped.';
    }
    return text;
}

export function mountPronunciationControls({ anchor, suffix = '', getText = () => '', getProsody = () => ({}), onEdit = null } = {}) {
    if (!anchor) return null;
    const id = (name) => 'nwrPron' + name + suffix;
    const repository = getPronunciationRepository();
    let voice = '';
    let backend = '';
    let sourcesReady = null;

    const enabled = el('input', { type: 'checkbox', id: id('Enabled') });
    const select = el('select', { id: id('Source') }, [el('option', { value: '', text: 'National dictionary only' })]);
    const summary = el('p', { id: id('Summary'), class: 'inline-note nwr-pron__summary', 'aria-live': 'polite' });
    const previewButton = el('button', { type: 'button', id: id('Preview'), text: 'Preview replacements' });
    const editButton = el('button', { type: 'button', id: id('Edit'), text: 'My pronunciations…' });
    const previewOut = el('pre', { id: id('PreviewOut'), class: 'nwr-pron__preview', tabindex: '0', 'aria-label': 'Text as it will be sent to VT Paul', hidden: true });
    const fieldset = el('fieldset', { id: id(''), class: 'nwr-pron', hidden: true }, [
        el('legend', { text: 'NWR pronunciations (VT Paul)' }),
        el('div', { class: 'nwr-pron__row' }, [enabled, el('label', { for: enabled.id, text: ' Use NWS pronunciations, speed and pauses' })]),
        el('div', { class: 'nwr-pron__row' }, [el('label', { for: select.id, text: 'Office or transmitter: ' }), select]),
        summary,
        el('div', { class: 'nwr-pron__row' }, [previewButton, document.createTextNode(' '), editButton]),
        previewOut,
    ]);
    anchor.insertAdjacentElement('afterend', fieldset);

    function syncFromStore() {
        const selection = readSelection();
        enabled.checked = selection.enabled;
        select.disabled = !selection.enabled;
        if (select.value !== selection.source) {
            if (selection.source && !select.querySelector('option[value="' + selection.source + '"]')) {
                select.appendChild(el('option', { value: selection.source, text: selection.source.replace(':', ' ').toUpperCase() }));
            }
            select.value = selection.source;
        }
    }

    function loadSources() {
        if (!sourcesReady) {
            sourcesReady = (async () => {
                const { offices, transmitters } = await repository.listSources();
                const officeGroup = el('optgroup', { label: 'Forecast offices' });
                for (const office of offices) {
                    const extra = office.set ? ' · ' + office.set.entries + (office.set.entries === 1 ? ' entry' : ' entries') : '';
                    officeGroup.appendChild(el('option', { value: office.source, text: office.id + ' — ' + office.label + extra }));
                }
                const txGroup = el('optgroup', { label: 'NOAA Weather Radio transmitters' });
                for (const tx of transmitters) {
                    const place = [tx.site, tx.state].filter(Boolean).join(', ');
                    const extra = tx.set ? ' · local settings' : '';
                    const status = tx.status && tx.status !== 'NORMAL' ? ' (' + tx.status.toLowerCase() + ')' : '';
                    txGroup.appendChild(el('option', { value: tx.source, text: tx.id + ' — ' + place + ' ' + tx.freq + ' (' + tx.wfo + ')' + status + extra }));
                }
                for (const stray of [...select.querySelectorAll('option')].slice(1)) stray.remove();
                select.appendChild(officeGroup);
                select.appendChild(txGroup);
                syncFromStore();
                const searchable = await loadSearchableSelect();
                searchable?.enhance(select, { placeholder: 'Type an office, city or callsign…', emptyText: 'No matching office or transmitter.', matchValue: true, className: 'nwr-pron-combo' });
            })().catch((error) => {
                console.error('Could not load the office and transmitter list.', error);
                summary.textContent = 'Could not load the office and transmitter list.';
            });
        }
        return sourcesReady;
    }

    let refreshSeq = 0;

    async function refresh() {
        const seq = ++refreshSeq;
        syncFromStore();
        if (fieldset.hidden) return;
        const selection = readSelection();
        if (!selection.enabled) {
            summary.textContent = 'Off: text is sent to VT Paul exactly as written.';
            return;
        }
        const plan = await planTtsPronunciation({ text: '', voice, backend, prosody: getProsody(), pronunciation: selection });
        if (seq !== refreshSeq) return;
        const personal = readPersonal().length;
        summary.textContent = describeSelectionSummary(plan.summary) + (personal ? ' Your own pronunciations: ' + personal + '.' : '');
    }

    async function setVoice(nextVoice, nextBackend) {
        voice = String(nextVoice || '');
        backend = String(nextBackend || '');
        let eligible = isEligibleVoice(voice, backend);
        if (!eligible && String(backend).toLowerCase().includes('vt')) {
            const index = await repository.loadIndex().catch(() => null);
            eligible = isEligibleVoice(voice, backend, index?.voices);
        }
        fieldset.hidden = !eligible;
        previewOut.hidden = true;
        if (eligible) {
            await loadSources();
            await refresh();
        }
    }

    async function adoptOffice(office) {
        const code = String(office || '').trim().toUpperCase();
        if (!OFFICE_RE.test(code)) return false;
        const current = readSelection();
        if (current.source === 'wfo:' + code) return false;
        if (current.source.startsWith('tx:')) {
            const tx = await repository.loadTransmitters().catch(() => null);
            if (tx?.transmitters?.[current.source.slice(3)]?.wfo === code) return false;
        }
        const result = writeSelection({ source: 'wfo:' + code });
        if (!result.ok) return false;
        await refresh();
        if (!fieldset.hidden) summary.textContent = 'Switched to ' + code + ' because the text came from that office. ' + summary.textContent;
        return true;
    }

    enabled.addEventListener('change', () => {
        writeSelection({ enabled: enabled.checked });
    });
    select.addEventListener('change', () => {
        previewOut.hidden = true;
        if (select.value !== readSelection().source) writeSelection({ source: select.value });
    });
    previewButton.addEventListener('click', async () => {
        const text = String(getText() || '');
        if (!text.trim()) {
            summary.textContent = 'Type some text first, then preview it.';
            return;
        }
        const plan = await planTtsPronunciation({ text, voice, backend, prosody: getProsody() });
        previewOut.textContent = plan.text;
        previewOut.hidden = false;
        const hits = plan.hits ? plan.hits.length : 0;
        summary.textContent = plan.applied
            ? hits + (hits === 1 ? ' word or phrase' : ' words or phrases') + ' will be replaced. ' + describeSelectionSummary(plan.summary)
            : 'Pronunciations are off, so nothing will be replaced.';
    });
    editButton.addEventListener('click', async () => {
        if (typeof onEdit === 'function') {
            onEdit({ voice, backend, refresh });
            return;
        }
        try {
            const { openPronunciationEditor } = await import('./nwr-pronunciation-editor.js');
            openPronunciationEditor({ returnFocus: editButton, voice, backend, getText, onClose: refresh });
        } catch (error) {
            console.error(error);
            summary.textContent = 'Could not open the pronunciation editor.';
        }
    });
    window.addEventListener(SELECTION_CHANGE, () => refresh());
    window.addEventListener(PERSONAL_CHANGE, () => refresh());
    window.addEventListener('storage', (event) => {
        if (event.key && event.key.startsWith('eas-tools-nwr-pron-')) refresh();
    });

    syncFromStore();
    return { element: fieldset, select, setVoice, adoptOffice, refresh };
}
