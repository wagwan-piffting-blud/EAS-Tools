import { MODE_OPTIONS, ATTENTION_KINDS, validHeader, defaultHeader } from './generators.js';

let seq = 0;

function field(label, input, hint) {
    const id = `spa-${++seq}`;
    input.id = id;
    const wrap = document.createElement('div');
    wrap.className = 'sp-alert-field';
    const l = document.createElement('label');
    l.htmlFor = id;
    l.textContent = label;
    wrap.append(l, input);
    if (hint) {
        const h = document.createElement('small');
        h.id = `${id}-hint`;
        h.textContent = hint;
        input.setAttribute('aria-describedby', h.id);
        wrap.append(h);
    }
    return wrap;
}

function make(tag, props = {}) {
    const n = document.createElement(tag);
    Object.assign(n, props);
    return n;
}

function select(options, value) {
    const s = make('select');
    for (const o of options) s.add(new Option(o.label, o.value));
    s.value = value;
    return s;
}

function check(label, checked) {
    const box = make('input', { type: 'checkbox', checked: !!checked });
    const wrap = document.createElement('div');
    wrap.className = 'sp-alert-field sp-alert-check';
    const id = `spa-${++seq}`;
    box.id = id;
    const l = document.createElement('label');
    l.htmlFor = id;
    l.textContent = label;
    wrap.append(box, l);
    return { wrap, box };
}

export function openAlertDialog({ initial = {}, only = null, adding = false } = {}) {
    return new Promise((resolve) => {
        const v = {
            header: defaultHeader(),
            mode: 'DEFAULT',
            tone: 'wat',
            seconds: 8,
            text: '',
            eom: true,
            bed: false,
            bedDb: -40,
            clip: false,
            emulate: true,
            ...initial,
        };
        const show = (k) => !only || only === k;
        const dlg = make('dialog', { className: 'sp-alert-dialog' });
        const titleId = `spa-title-${++seq}`;
        dlg.setAttribute('aria-labelledby', titleId);
        const title = make('h3', { id: titleId, textContent: adding ? 'Generate Clip' : (only ? 'Edit Generator' : 'New Alert') });
        const intro = make('p', {
            textContent: adding
                ? 'Generates a clip on this track at the playhead.'
                : (only
                    ? 'Change the settings and regenerate this clip. It keeps its place on the timeline.'
                    : 'Builds a complete alert on its own tracks: SAME header, attention tone, message and EOM, spaced with the gaps of the chosen ENDEC.'),
        });
        const form = make('form', { method: 'dialog' });
        const header = make('input', { type: 'text', value: v.header, spellcheck: false, autocomplete: 'off' });
        header.style.width = '100%';
        const mode = select(MODE_OPTIONS, v.mode);
        const tone = select([...ATTENTION_KINDS, ...(only ? [] : [{ value: 'none', label: 'No attention tone' }])], v.tone);
        const seconds = make('input', { type: 'number', min: '1', max: '25', step: '1', value: String(v.seconds) });
        const text = make('textarea', { rows: 3, value: v.text });
        text.style.width = '100%';
        const eom = check('Add EOM (NNNN)', v.eom);
        const bed = check('Add a noise bed under the alert', v.bed);
        const bedDb = make('input', { type: 'number', min: '-80', max: '-6', step: '1', value: String(v.bedDb) });
        const clip = check('Clip tones and data at ±0.79 (like the Encoder\'s clip option)', v.clip);
        const emulate = check('Emulate the ENDEC\'s sample rate', v.emulate);
        const err = make('p', { className: 'sp-alert-error' });
        err.setAttribute('role', 'alert');

        const rows = [];
        if (show('same-header')) rows.push(field('SAME header', header, 'ZCZC-ORG-EEE-PSSCCC+TTTT-JJJHHMM-LLLLLLLL-'));
        if (show('same-header') || show('eom') || show('attention')) rows.push(field('ENDEC style', mode));
        if (show('attention')) rows.push(field('Attention tone', tone), field('Tone length (seconds)', seconds));
        if (!only) rows.push(field('Message (spoken with the voice selected under Generate & Append)', text, 'Leave empty to skip the message.'));
        if (!only) rows.push(eom.wrap, bed.wrap, field('Noise bed level (dBFS)', bedDb));
        if (show('same-header') || show('eom') || show('attention')) rows.push(clip.wrap, emulate.wrap);

        const actions = make('div', { className: 'sp-alert-actions' });
        const ok = make('button', { type: 'submit', textContent: adding ? 'Add Clip' : (only ? 'Regenerate' : 'Create Alert'), value: 'ok' });
        const cancel = make('button', { type: 'button', textContent: 'Cancel' });
        cancel.addEventListener('click', () => dlg.close('cancel'));
        actions.append(ok, cancel);
        form.append(...rows, err, actions);
        dlg.append(title, intro, form);
        document.body.append(dlg);

        const opener = document.activeElement;
        form.addEventListener('submit', (e) => {
            if (show('same-header') && tone.value !== 'pelmorex' && !validHeader(header.value)) {
                e.preventDefault();
                err.textContent = 'The SAME header is not valid. Expected ZCZC-ORG-EEE-PSSCCC+TTTT-JJJHHMM-LLLLLLLL-';
                header.focus();
            }
        });
        dlg.addEventListener('close', () => {
            const done = dlg.returnValue === 'ok';
            const out = done ? {
                header: header.value.trim(),
                mode: mode.value,
                tone: tone.value,
                seconds: Math.max(1, Math.min(25, Number(seconds.value) || 8)),
                text: text.value.trim(),
                eom: eom.box.checked,
                bed: bed.box.checked,
                bedDb: Math.max(-80, Math.min(-6, Number(bedDb.value) || -40)),
                clip: clip.box.checked,
                emulate: emulate.box.checked,
            } : null;
            dlg.remove();
            if (opener && opener.isConnected && typeof opener.focus === 'function') opener.focus();
            resolve(out);
        });
        dlg.showModal();
        (rows[0] && rows[0].querySelector('input, select, textarea') || ok).focus();
    });
}
