import * as M from './model.js';
import { drawPeaks } from './peaks.js';

const ROLE_COLORS = {
    header: '#ff7800',
    attn: '#e53935',
    voice: '#3aa0ff',
    eom: '#ab47bc',
    bed: '#9e9e9e',
    free: '#26a69a',
};
const ZOOM_STEPS = 1.5;
const MIN_PPS = 0.5;
const MAX_PPS = 20000;
const RULER_STEPS = [0.001, 0.005, 0.01, 0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600];

function el(tag, attrs = {}, ...kids) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
        if (v === undefined || v === null || v === false) continue;
        if (k === 'class') n.className = v;
        else if (k === 'text') n.textContent = v;
        else if (k === 'style') n.style.cssText = v;
        else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
        else if (k === 'dataset') Object.assign(n.dataset, v);
        else n.setAttribute(k, v === true ? '' : String(v));
    }
    for (const k of kids.flat()) if (k !== null && k !== undefined && k !== false) n.append(k.nodeType ? k : document.createTextNode(String(k)));
    return n;
}

export function fmtTime(sec, precise = true) {
    if (!Number.isFinite(sec) || sec < 0) sec = 0;
    const m = Math.floor(sec / 60);
    const s = sec - m * 60;
    return `${m}:${s.toFixed(precise ? 2 : 0).padStart(precise ? 5 : 2, '0')}`;
}

function spokenTime(sec) {
    if (!Number.isFinite(sec) || sec < 0) sec = 0;
    const m = Math.floor(sec / 60);
    const s = (sec - m * 60).toFixed(2);
    return m ? `${m} minute${m === 1 ? '' : 's'} ${s} seconds` : `${s} seconds`;
}

export function parseTime(text) {
    const m = /^\s*(?:(\d+):)?(?:(\d+):)?(\d*(?:[.,]\d*)?)\s*s?\s*$/i.exec(String(text));
    if (!m || !/\d/.test(text)) return null;
    const sec = parseFloat((m[3] || '0').replace(',', '.')) || 0;
    const a = m[1] === undefined ? 0 : +m[1];
    return m[2] === undefined ? a * 60 + sec : a * 3600 + (+m[2]) * 60 + sec;
}

const isTyping = (t) => !!t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));

export function createEditor(host) {
    const P = () => host.getProject();
    const history = host.history;
    const S = {
        pps: 0,
        fit: true,
        selA: 0,
        selB: 0,
        selTracks: new Set(),
        clipId: null,
        focusTrack: null,
        focusClip: null,
        anchor: null,
        clipboard: null,
        drag: null,
        pointers: new Map(),
        pinch: null,
        raf: 0,
        lastPlaying: false,
        moreOpen: new Set(),
    };
    const sr = () => P().sampleRate || 44100;
    const narrow = () => window.matchMedia && window.matchMedia('(max-width: 700px)').matches;
    const headW = () => (narrow() ? 112 : 176);

    const live = el('div', { class: 'visually-hidden', 'aria-live': 'polite', 'aria-atomic': 'true' });
    const announce = (msg) => {
        live.textContent = '';
        setTimeout(() => { live.textContent = msg; }, 30);
    };

    const btn = (label, onClick, extra = {}) => el('button', { type: 'button', class: 'sp-btn', onclick: onClick, ...extra }, label);

    const playBtn = btn('Play', () => togglePlay('all'), { 'aria-keyshortcuts': 'Space', title: 'Play / pause (Space)' });
    const playSelBtn = btn('Play Selection', () => togglePlay('selection'), { title: 'Play the selected time range' });
    const stopBtn = btn('Stop', () => {
        if (host.isRecording && host.isRecording()) { host.toggleRecord(); return; }
        host.stop();
        syncTransport();
    });
    const recLabel = el('span', {}, 'Record');
    const recTime = el('span', { class: 'sp-rec-time', 'aria-hidden': 'true' });
    const recBtn = el('button', {
        type: 'button', class: 'sp-btn sp-rec', 'aria-keyshortcuts': 'R', title: 'Record from the microphone at the playhead (R)',
        onclick: () => host.toggleRecord && host.toggleRecord(),
    }, recLabel, recTime);
    const timeReadout = el('span', { class: 'sp-time', 'aria-live': 'off' }, '0:00.00 / 0:00.00');

    const splitBtn = btn('Split', () => splitAtPlayhead(), { 'aria-keyshortcuts': 'S', title: 'Split clips at the playhead (S)' });
    const cutBtn = btn('Cut', () => cut(), { 'aria-keyshortcuts': 'Control+X', title: 'Cut (Ctrl+X)' });
    const copyBtn = btn('Copy', () => copy(), { 'aria-keyshortcuts': 'Control+C', title: 'Copy (Ctrl+C)' });
    const pasteBtn = btn('Paste', () => paste(), { 'aria-keyshortcuts': 'Control+V', title: 'Paste at the playhead (Ctrl+V)' });
    const delBtn = btn('Delete', () => del(false), { 'aria-keyshortcuts': 'Delete', title: 'Delete selection or clip (Delete); Shift+Delete closes the gap' });
    const dupBtn = btn('Duplicate', () => duplicate(), { 'aria-keyshortcuts': 'Control+D', title: 'Duplicate clip (Ctrl+D)' });
    const undoBtn = btn('Undo', () => undo(), { 'aria-keyshortcuts': 'Control+Z', title: 'Undo (Ctrl+Z)' });
    const redoBtn = btn('Redo', () => redo(), { 'aria-keyshortcuts': 'Control+Y', title: 'Redo (Ctrl+Y)' });

    const roleSelect = el('select', { class: 'sp-role-select', 'aria-label': 'New track type' },
        ...Object.entries(M.ROLES).map(([k, v]) => el('option', { value: k }, v.label)));
    roleSelect.value = 'voice';
    const addTrackBtn = btn('Add Track', () => addTrack(roleSelect.value));
    const newAlertBtn = btn('New Alert…', () => host.newAlert && host.newAlert(), { title: 'Build a SAME header, attention tone, message and EOM on their own tracks' });
    const spaceAlertBtn = btn('Space Alert', () => {
        if (!host.spaceAlert) return;
        const moved = host.spaceAlert();
        announce(moved ? 'Spaced the header, tone, message and EOM with the ENDEC gaps.' : 'The alert parts are already spaced.');
    }, { title: 'Space the header, attention tone, message and EOM tracks with the Part 11 gaps of the header\'s ENDEC style' });

    const zoomOutBtn = btn('Zoom Out', () => zoomBy(1 / ZOOM_STEPS), { 'aria-keyshortcuts': '-', title: 'Zoom out (-, or the mouse wheel over the timeline; Shift+wheel scrolls sideways)' });
    const zoomInBtn = btn('Zoom In', () => zoomBy(ZOOM_STEPS), { 'aria-keyshortcuts': '+', title: 'Zoom in (+, or the mouse wheel over the timeline; Shift+wheel scrolls sideways)' });
    const fitBtn = btn('Fit', () => { S.fit = true; render(); announce('Zoomed to fit the project.'); }, { 'aria-keyshortcuts': '0', title: 'Zoom to fit (0)' });

    const projSelect = el('select', { class: 'sp-proj-select', 'aria-label': 'Saved projects' });
    const projName = el('input', { type: 'text', class: 'sp-proj-name', placeholder: 'Project name', 'aria-label': 'Project name to save as', maxlength: '80' });
    const projSaveBtn = btn('Save As', () => saveNamed());
    const projOpenBtn = btn('Open', () => openNamed());
    const projDelBtn = btn('Delete Saved', () => deleteNamed());
    const projFileIn = el('input', { type: 'file', accept: '.zip,application/zip,application/x-zip-compressed', hidden: true, tabindex: '-1', 'aria-hidden': 'true' });
    const projExportBtn = btn('Export Project File', () => exportFile(), { title: 'Download this project and all of its audio as one .zip file' });
    const projImportBtn = btn('Open Project File…', () => projFileIn.click(), { title: 'Open a project .zip exported from the Splicer; it replaces the current project' });
    projFileIn.addEventListener('change', () => {
        const f = projFileIn.files && projFileIn.files[0];
        projFileIn.value = '';
        if (f) setTimeout(() => importFile(f));
    });

    const toolbar = el('div', { class: 'sp-toolbar' },
        el('div', { class: 'sp-group', role: 'group', 'aria-label': 'Transport' }, playBtn, playSelBtn, stopBtn, recBtn, timeReadout),
        el('div', { class: 'sp-group', role: 'group', 'aria-label': 'Edit' }, splitBtn, cutBtn, copyBtn, pasteBtn, delBtn, dupBtn, undoBtn, redoBtn),
        el('div', { class: 'sp-group', role: 'group', 'aria-label': 'Tracks' }, roleSelect, addTrackBtn, newAlertBtn, spaceAlertBtn),
        el('div', { class: 'sp-group', role: 'group', 'aria-label': 'Zoom' }, zoomOutBtn, zoomInBtn, fitBtn));
    const projectBar = el('details', { class: 'sp-projects' },
        el('summary', {}, 'Projects'),
        el('div', { class: 'sp-projectbar', role: 'group', 'aria-label': 'Saved projects' }, projSelect, projOpenBtn, projDelBtn, projName, projSaveBtn),
        el('div', { class: 'sp-projectbar', role: 'group', 'aria-label': 'Project files' }, projExportBtn, projImportBtn, projFileIn));

    const playhead = el('input', {
        type: 'text', class: 'sp-playhead-slider', role: 'spinbutton', 'aria-label': 'Playhead position',
        autocomplete: 'off', spellcheck: 'false', value: fmtTime(0), title: 'Type a time such as 0:16.6 and press Enter',
        'aria-valuemin': '0', 'aria-valuemax': '0', 'aria-valuenow': '0', 'aria-valuetext': '0 seconds',
        'aria-keyshortcuts': 'ArrowLeft ArrowRight ArrowUp ArrowDown Shift+ArrowLeft Shift+ArrowRight Home End Enter',
    });
    let phDirty = false;
    let phSelectOnUp = false;
    const selLabel = el('div', { class: 'sp-sel-label' });
    const playheadRow = el('div', { class: 'sp-playhead-row' },
        el('span', { class: 'sp-playhead-hint', 'aria-hidden': 'true' }, 'Playhead:'), playhead, selLabel,
        el('span', { class: 'visually-hidden', id: 'spPlayheadHint' }, 'Type a time such as 0:16.6 and press Enter to move the playhead. Arrow keys move the playhead; Control plus arrows move by one second; Shift plus arrows select time.'));
    playhead.setAttribute('aria-describedby', 'spPlayheadHint');

    const inspector = el('div', { class: 'sp-inspector', role: 'group', 'aria-label': 'Selected clip', hidden: true });

    const scroller = el('div', { class: 'sp-scroller' });
    const inner = el('div', { class: 'sp-inner' });
    const rulerCanvas = el('canvas', { class: 'sp-canvas', 'aria-hidden': 'true' });
    const rulerLane = el('div', { class: 'sp-lane sp-ruler-lane' }, rulerCanvas);
    const rulerRow = el('div', { class: 'sp-row sp-ruler-row' }, el('div', { class: 'sp-head sp-ruler-head', 'aria-hidden': 'true' }, 'Time'), rulerLane);
    const outCanvas = el('canvas', { class: 'sp-canvas', 'aria-hidden': 'true' });
    const outLane = el('div', { class: 'sp-lane sp-out-lane' }, outCanvas);
    const masterGainIn = el('input', { type: 'number', class: 'sp-master-gain', 'data-fk': 'master:gain', min: '-60', max: '12', step: '0.5', value: '0', 'aria-label': 'Master gain in decibels', title: 'Master gain (dB)' });
    masterGainIn.addEventListener('change', () => {
        const v = Math.max(-60, Math.min(12, parseFloat(masterGainIn.value) || 0));
        masterGainIn.value = String(v);
        if (host.setMasterGain) host.setMasterGain(v);
        announce(`Master gain ${v} dB.`);
    });
    const masterFxBtn = el('button', { type: 'button', class: 'sp-tbtn', 'data-fk': 'master:fx', onclick: () => host.openMasterEffects && host.openMasterEffects() },
        el('span', { class: 'sp-wide-only' }, 'Effects'), el('span', { class: 'sp-narrow-only' }, 'FX'));
    const bypassBtn = el('button', { type: 'button', class: 'sp-tbtn', 'data-fk': 'master:bypass', 'aria-pressed': 'false', title: 'Hear the mix without the master effects' }, 'Bypass');
    bypassBtn.addEventListener('click', () => {
        const on = bypassBtn.getAttribute('aria-pressed') !== 'true';
        if (host.setMasterBypass) host.setMasterBypass(on);
        refreshMaster();
        queueDraw();
        announce(on ? 'Master effects bypassed.' : 'Master effects on.');
    });
    const outRow = el('div', { class: 'sp-row sp-out-row' },
        el('div', { class: 'sp-head sp-out-head', role: 'group', 'aria-label': 'Master output' },
            el('div', { class: 'sp-master-top' }, el('span', { class: 'sp-master-title' }, 'Master'), masterGainIn, el('span', { class: 'sp-master-db', 'aria-hidden': 'true' }, 'dB')),
            el('div', { class: 'sp-head-btns' }, masterFxBtn, bypassBtn)),
        outLane);
    let masterSummary = '';
    const grid = el('div', { class: 'sp-grid', role: 'grid', 'aria-label': 'Tracks and clips', 'aria-describedby': 'spGridHint' });
    const gridHint = el('p', { class: 'visually-hidden', id: 'spGridHint' },
        'Arrow keys move between clips and tracks. Enter selects a clip. S splits at the playhead, Delete removes, Control plus X, C and V cut, copy and paste, left and right brackets nudge the selected clip, E edits effects on the selected clip or the focused track.');
    const playLine = el('div', { class: 'sp-playline', 'aria-hidden': 'true' });
    inner.append(rulerRow, outRow, grid, playLine);
    scroller.append(inner);

    const helpKey = 'eas-splicer-help-open';
    const keyList = (sep, ks) => ks.flatMap((k, i) => (i ? [sep, el('kbd', {}, k)] : [el('kbd', {}, k)]));
    const keys = (...ks) => keyList(' or ', ks);
    const keysEach = (...ks) => keyList(', ', ks);
    const item = (what, ...how) => el('li', {}, ...how, ' ', what);
    const helpBox = el('details', { class: 'sp-help' },
        el('summary', {}, 'Controls'),
        el('div', { class: 'sp-help-cols' },
            el('section', { 'aria-labelledby': 'spHelpMouse' },
                el('h3', { id: 'spHelpMouse' }, 'Mouse'),
                el('ul', {},
                    el('li', {}, 'Click a clip to select it; double-click to select its time range.'),
                    el('li', {}, 'Drag a clip to move it, onto another track too. It snaps to nearby clip edges.'),
                    el('li', {}, 'Drag a clip\'s left or right edge to trim it, or its fade handles to fade in and out.'),
                    el('li', {}, 'Click empty track space to move the playhead; drag across tracks to select time. Shift+click extends the selection.'),
                    el('li', {}, 'Click or drag the ruler to scrub the playhead.'),
                    el('li', {}, 'Mouse wheel over the timeline zooms around the pointer; Shift+wheel scrolls sideways.'))),
            el('section', { 'aria-labelledby': 'spHelpTouch' },
                el('h3', { id: 'spHelpTouch' }, 'Touch'),
                el('ul', {},
                    el('li', {}, 'Tap a clip to select it; drag it to move it, onto another track too.'),
                    el('li', {}, 'Drag a clip\'s edges to trim it, or its fade handles to fade.'),
                    el('li', {}, 'Tap empty track space to move the playhead; drag to select time.'),
                    el('li', {}, 'Drag the ruler to scrub the playhead.'),
                    el('li', {}, 'Pinch with two fingers to zoom.'),
                    el('li', {}, 'Use More on a track for gain, pan, effects and generators.'))),
            el('section', { 'aria-labelledby': 'spHelpKeys' },
                el('h3', { id: 'spHelpKeys' }, 'Keyboard'),
                el('ul', {},
                    item('plays or pauses from anywhere in the Splicer, except while typing in a field. Space, R, S, E, Delete, the brackets, zoom keys and undo work the same way; use Enter to press a focused button.', ...keys('Space')),
                    item('starts and stops recording from the microphone.', ...keys('R')),
                    item('move between clips and tracks in the clip grid; Home and End jump to the first and last clip; Enter selects a clip, Shift+Enter its time range.', ...keys('Arrows')),
                    el('li', {}, 'Type a time into the playhead box, such as 0:16.6, 16.6 or 1:02:03, and press Enter to jump there; a time past the end goes to the end. Escape undoes what you typed.'),
                    el('li', {}, 'On the playhead box, the arrows move 0.1 s, Ctrl+arrows 1 s, Alt+arrows 0.01 s, and Page Up and Page Down 5 s; Shift+arrows select time.'),
                    item('splits clips at the playhead.', ...keys('S')),
                    item('deletes the selection or clip; Shift+Delete also closes the gap.', ...keys('Delete')),
                    item('cut, copy, paste and duplicate (⌘ on a Mac).', ...keysEach('Ctrl+X', 'Ctrl+C', 'Ctrl+V', 'Ctrl+D')),
                    item('undo and redo; Ctrl+Shift+Z also redoes.', ...keysEach('Ctrl+Z', 'Ctrl+Y')),
                    item('nudge the selected clip left or right 0.1 s; with Shift, 1 s.', ...keysEach('[', ']')),
                    item('edits effects on the selected clip, or on the focused track.', ...keys('E')),
                    item('zoom in and out; 0 zooms to fit.', ...keysEach('+', '-'))))));
    try { helpBox.open = localStorage.getItem(helpKey) === '1'; } catch { /* storage is optional */ }
    helpBox.addEventListener('toggle', () => {
        try { localStorage.setItem(helpKey, helpBox.open ? '1' : '0'); } catch { /* storage is optional */ }
    });

    const slots = host.slots || {};
    const root = el('div', { class: 'sp-editor' }, el('div', { class: 'sp-top' }, toolbar, playheadRow),
        slots.projects ? null : projectBar, gridHint, scroller, inspector, slots.help ? null : helpBox, live);
    host.mount.append(root);
    if (slots.projects) slots.projects.append(projectBar);
    if (slots.help) slots.help.append(helpBox);

    let rows = [];

    const pps = () => {
        if (S.fit || !S.pps) {
            const vw = Math.max(200, scroller.clientWidth - headW() - 12);
            const dur = Math.max(5, M.projectLength(P()) / sr());
            S.pps = Math.min(MAX_PPS, Math.max(MIN_PPS, vw / dur));
        }
        return S.pps;
    };
    const sToX = (samples) => (samples / sr()) * pps();
    const xToS = (x) => Math.max(0, Math.round((x / pps()) * sr()));
    const playheadSamples = () => Math.round(host.needleSeconds() * sr());
    const contentW = () => Math.max(scroller.clientWidth - headW(), sToX(Math.max(M.projectLength(P()), 5 * sr())), sToX(M.projectLength(P())) + pps() * 2 + 40);

    const tracksForEdit = () => {
        const p = P();
        if (S.selTracks.size) return p.tracks.filter((t) => S.selTracks.has(t.id)).map((t) => t.id);
        if (S.focusTrack && M.findTrack(p, S.focusTrack)) return [S.focusTrack];
        return p.tracks.map((t) => t.id);
    };

    function commit(label, fn, msg) {
        const p = P();
        history.push(p, label);
        let r;
        try { r = fn(p); } catch (e) { history.undo(p); host.status(`Edit failed: ${e.message || e}`, false); return false; }
        if (r === false) { history.drop(); return false; }
        host.changed(label);
        if (msg) announce(msg);
        return true;
    }

    function undo() {
        const label = history.undo(P());
        if (!label) { announce('Nothing to undo.'); return; }
        validateSelection();
        host.changed('undo');
        announce(`Undid ${label}.`);
    }

    function redo() {
        const label = history.redo(P());
        if (!label) { announce('Nothing to redo.'); return; }
        validateSelection();
        host.changed('redo');
        announce(`Redid ${label}.`);
    }

    function validateSelection() {
        const p = P();
        if (S.clipId && !M.findClip(p, S.clipId)) S.clipId = null;
        if (S.focusClip && !M.findClip(p, S.focusClip)) S.focusClip = null;
        if (S.focusTrack && !M.findTrack(p, S.focusTrack)) S.focusTrack = null;
        for (const id of [...S.selTracks]) if (!M.findTrack(p, id)) S.selTracks.delete(id);
    }

    function setSelection(a, b, tracks, quiet) {
        if (b < a) [a, b] = [b, a];
        S.selA = Math.max(0, Math.round(a));
        S.selB = Math.max(0, Math.round(b));
        if (tracks) S.selTracks = new Set(tracks);
        host.onSelectionChange(S.selA / sr(), S.selB / sr());
        paintSelection();
        updateSelLabel();
        if (!quiet && S.selB > S.selA) announce(`Selected ${spokenTime((S.selB - S.selA) / sr())} from ${spokenTime(S.selA / sr())}.`);
    }

    function updateSelLabel() {
        const a = S.selA / sr(), b = S.selB / sr();
        selLabel.textContent = S.selB > S.selA ? `Selection ${fmtTime(a)} – ${fmtTime(b)} (${(b - a).toFixed(2)} s)` : 'No time selection';
    }

    function selectClip(clipId, { focus = false, announceIt = true, range = false } = {}) {
        const p = P();
        const f = clipId ? M.findClip(p, clipId) : null;
        S.clipId = f ? clipId : null;
        if (f) {
            S.focusTrack = f.track.id;
            S.focusClip = clipId;
            S.selTracks = new Set([f.track.id]);
            if (range) setSelection(f.clip.start, M.clipEnd(f.clip), [f.track.id], true);
            else paintSelection();
        }
        renderInspector();
        markClipStates();
        if (focus) focusCell();
        if (f && announceIt) announce(clipDescription(f.track, f.clip) + (range ? ' Selected its time range.' : ''));
    }

    const fxState = (kind, x) => (host.fxState ? host.fxState(kind, x) : 'none');
    const fxLabel = (x) => (host.fxLabel ? host.fxLabel(x.effects) : '');

    function fxDescription(kind, x) {
        const st = fxState(kind, x);
        if (st === 'none') return '';
        const extra = st === 'rendering' ? ', rendering' : (st === 'failed' ? ', failed to render' : '');
        return `, effects: ${fxLabel(x)}${extra}`;
    }

    function clipDescription(t, c) {
        const name = c.label || P().sources.get(c.sourceId)?.label || 'Clip';
        const idx = t.clips.indexOf(c) + 1;
        const fades = `${c.fadeIn ? `, fade in ${spokenTime(c.fadeIn / sr())}` : ''}${c.fadeOut ? `, fade out ${spokenTime(c.fadeOut / sr())}` : ''}`;
        return `${name}, clip ${idx} of ${t.clips.length} on ${t.name}, starts ${spokenTime(c.start / sr())}, length ${spokenTime(M.clipSpan(c) / sr())}${c.gainDb ? `, gain ${c.gainDb} dB` : ''}${fades}${fxDescription('clip', c)}.`;
    }

    function editEffects() {
        const p = P();
        const cid = S.clipId || S.focusClip;
        if (cid && M.findClip(p, cid)) {
            host.editEffects('clip', cid);
            return;
        }
        const tid = S.focusTrack && M.findTrack(p, S.focusTrack) ? S.focusTrack : (p.tracks[0] && p.tracks[0].id);
        if (tid) host.editEffects('track', tid);
    }

    function addTrack(role) {
        let made = null;
        commit('add track', (p) => {
            const at = S.focusTrack ? p.tracks.findIndex((t) => t.id === S.focusTrack) + 1 : p.tracks.length;
            made = M.addTrack(p, role, undefined, at);
        });
        if (made) {
            S.focusTrack = made.id;
            S.focusClip = null;
            S.selTracks = new Set([made.id]);
            render();
            focusCell();
            announce(`Added ${made.name} track. ${P().tracks.length} tracks.`);
        }
    }

    function splitAtPlayhead() {
        const at = playheadSamples();
        let n = 0;
        commit('split', (p) => {
            n = M.splitTracksAt(p, tracksForEdit(), at).length;
            return n > 0;
        });
        announce(n ? `Split ${n} clip${n === 1 ? '' : 's'} at ${spokenTime(at / sr())}.` : 'No clip under the playhead to split.');
    }

    function rangeActive() {
        return S.selB > S.selA;
    }

    function copy() {
        const p = P();
        if (rangeActive()) {
            S.clipboard = M.copyRange(p, tracksForEdit(), S.selA, S.selB);
            announce(`Copied ${spokenTime((S.selB - S.selA) / sr())} from ${S.clipboard.tracks.length} track${S.clipboard.tracks.length === 1 ? '' : 's'}.`);
        } else if (S.clipId) {
            const f = M.findClip(p, S.clipId);
            S.clipboard = M.copyRange(p, [f.track.id], f.clip.start, M.clipEnd(f.clip));
            announce('Copied clip.');
        } else {
            announce('Select a time range or a clip to copy.');
            return false;
        }
        syncButtons();
        return true;
    }

    function cut() {
        if (!copy()) return;
        if (rangeActive()) {
            const a = S.selA, b = S.selB, ids = tracksForEdit();
            commit('cut', (p) => { M.deleteRange(p, ids, a, b, true); });
            setSelection(a, a, null, true);
            announce('Cut selection.');
        } else if (S.clipId) {
            const id = S.clipId;
            commit('cut clip', (p) => { M.deleteClip(p, id, false); });
            S.clipId = null;
            announce('Cut clip.');
        }
    }

    function paste() {
        if (!S.clipboard) { announce('Clipboard is empty.'); return; }
        const at = playheadSamples();
        const ids = S.selTracks.size ? tracksForEdit() : (S.focusTrack ? [S.focusTrack] : []);
        let made = [];
        commit('paste', (p) => { made = M.pasteAt(p, ids, at, S.clipboard, true); return made.length > 0; });
        if (made.length) {
            setSelection(at, at + S.clipboard.length, null, true);
            announce(`Pasted ${spokenTime(S.clipboard.length / sr())} at ${spokenTime(at / sr())}.`);
        }
    }

    function del(ripple) {
        if (rangeActive()) {
            const a = S.selA, b = S.selB, ids = tracksForEdit();
            let n = 0;
            commit('delete', (p) => { M.deleteRange(p, ids, a, b, true); n = 1; });
            setSelection(a, a, null, true);
            if (n) announce(`Deleted ${spokenTime((b - a) / sr())}; later audio moved left.`);
            return;
        }
        if (S.clipId) {
            const id = S.clipId;
            const f = M.findClip(P(), id);
            const trackId = f.track.id;
            const idx = f.index;
            commit(ripple ? 'ripple delete clip' : 'delete clip', (p) => { M.deleteClip(p, id, ripple); });
            S.clipId = null;
            const t = M.findTrack(P(), trackId);
            S.focusClip = t && t.clips.length ? t.clips[Math.min(idx, t.clips.length - 1)].id : null;
            render();
            focusCell();
            announce(ripple ? 'Deleted clip and closed the gap.' : 'Deleted clip.');
            return;
        }
        announce('Select a time range or a clip to delete.');
    }

    function duplicate() {
        if (!S.clipId) { announce('Select a clip to duplicate.'); return; }
        let made = null;
        const id = S.clipId;
        commit('duplicate', (p) => { made = M.duplicateClip(p, id); return !!made; });
        if (made) selectClip(made.id, { focus: true, announceIt: false });
        if (made) announce(`Duplicated clip to ${spokenTime(made.start / sr())}.`);
    }

    function nudge(deltaSec) {
        if (!S.clipId) { announce('Select a clip to move.'); return; }
        const f = M.findClip(P(), S.clipId);
        const id = S.clipId;
        const to = Math.max(0, f.clip.start + Math.round(deltaSec * sr()));
        commit('move clip', (p) => { M.moveClip(p, id, to); });
        const c = M.findClip(P(), id);
        if (c) announce(`Clip starts at ${spokenTime(c.clip.start / sr())}.`);
        focusCell();
    }

    function togglePlay(mode) {
        if (host.isPlaying()) {
            host.pause();
            syncTransport();
            return;
        }
        host.play(mode).then(() => { syncTransport(); startTicker(); }).catch((e) => host.status(`Playback failed: ${e.message || e}`, false));
    }

    function zoomBy(f, centerX) {
        const old = pps();
        const cx = centerX ?? scroller.clientWidth / 2;
        const t = (scroller.scrollLeft + cx - headW()) / old;
        S.fit = false;
        S.pps = Math.min(MAX_PPS, Math.max(MIN_PPS, old * f));
        layout();
        scroller.scrollLeft = Math.max(0, t * S.pps - cx + headW());
        drawAll();
        if (centerX === undefined) announce(`Zoom ${Math.round(S.pps)} pixels per second.`);
    }

    function ensureVisible(samples) {
        const x = sToX(samples) + headW();
        const left = scroller.scrollLeft + headW(), right = scroller.scrollLeft + scroller.clientWidth;
        if (x < left + 10) scroller.scrollLeft = Math.max(0, x - headW() - 40);
        else if (x > right - 10) scroller.scrollLeft = x - scroller.clientWidth + 60;
    }

    function trackRow(t, ti) {
        const p = P();
        const color = ROLE_COLORS[t.role] || ROLE_COLORS.free;
        const nameIn = el('input', { 'data-fk': `${t.id}:name`, type: 'text', class: 'sp-track-name', value: t.name, 'aria-label': `Track ${ti + 1} name`, maxlength: '40' });
        nameIn.addEventListener('change', () => {
            const v = nameIn.value.trim() || M.ROLES[t.role]?.label || 'Track';
            const id = t.id;
            setTimeout(() => commit('rename track', (pp) => { M.findTrack(pp, id).name = v; }, `Track renamed to ${v}.`));
        });
        const muteBtn = el('button', { 'data-fk': `${t.id}:mute`, type: 'button', class: 'sp-tbtn', 'aria-pressed': t.mute ? 'true' : 'false', title: 'Mute', 'aria-label': `Mute ${t.name}` }, 'M');
        muteBtn.addEventListener('click', () => {
            const id = t.id, v = !t.mute;
            commit(v ? 'mute' : 'unmute', (pp) => { M.findTrack(pp, id).mute = v; }, `${t.name} ${v ? 'muted' : 'unmuted'}.`);
        });
        const soloBtn = el('button', { 'data-fk': `${t.id}:solo`, type: 'button', class: 'sp-tbtn', 'aria-pressed': t.solo ? 'true' : 'false', title: 'Solo', 'aria-label': `Solo ${t.name}` }, 'S');
        soloBtn.addEventListener('click', () => {
            const id = t.id, v = !t.solo;
            commit(v ? 'solo' : 'unsolo', (pp) => { M.findTrack(pp, id).solo = v; }, `${t.name} ${v ? 'soloed' : 'unsoloed'}.`);
        });
        const gainIn = el('input', { 'data-fk': `${t.id}:gain`, type: 'number', class: 'sp-num', min: '-60', max: '24', step: '0.5', value: String(t.gainDb || 0), 'aria-label': `${t.name} gain in decibels` });
        gainIn.addEventListener('change', () => {
            const v = Math.max(-60, Math.min(24, parseFloat(gainIn.value) || 0));
            const id = t.id;
            setTimeout(() => commit('track gain', (pp) => { M.findTrack(pp, id).gainDb = v; }, `${t.name} gain ${v} dB.`));
        });
        const panIn = el('input', {
            'data-fk': `${t.id}:pan`, type: 'number', class: 'sp-num', min: '-100', max: '100', step: '5',
            value: String(Math.round(M.clampPan(t.pan) * 100)), 'aria-label': `${t.name} pan, -100 left to 100 right; used when exporting in stereo`,
        });
        panIn.addEventListener('change', () => {
            const v = Math.round(Math.max(-100, Math.min(100, parseFloat(panIn.value) || 0)));
            const id = t.id;
            const said = v === 0 ? 'center' : `${Math.abs(v)} ${v < 0 ? 'left' : 'right'}`;
            setTimeout(() => commit('track pan', (pp) => { M.findTrack(pp, id).pan = v / 100; }, `${t.name} pan ${said}.`));
        });
        const upBtn = el('button', { 'data-fk': `${t.id}:up`, type: 'button', class: 'sp-btn sp-small', disabled: ti === 0, 'aria-label': `Move ${t.name} up` }, 'Up');
        upBtn.addEventListener('click', () => { const id = t.id; commit('move track', (pp) => { M.moveTrack(pp, id, ti - 1); }, `${t.name} moved up.`); });
        const downBtn = el('button', { 'data-fk': `${t.id}:down`, type: 'button', class: 'sp-btn sp-small', disabled: ti === p.tracks.length - 1, 'aria-label': `Move ${t.name} down` }, 'Down');
        downBtn.addEventListener('click', () => { const id = t.id; commit('move track', (pp) => { M.moveTrack(pp, id, ti + 1); }, `${t.name} moved down.`); });
        const rmBtn = el('button', { type: 'button', class: 'sp-btn sp-small', 'aria-label': `Remove ${t.name} track` }, 'Remove');
        rmBtn.addEventListener('click', () => {
            const id = t.id, name = t.name;
            commit('remove track', (pp) => { M.removeTrack(pp, id); }, `Removed ${name} track.`);
        });
        const nFx = (t.effects || []).length;
        const fxBtn = el('button', { 'data-fk': `${t.id}:fx`, type: 'button', class: 'sp-btn sp-small', 'aria-label': `${t.name} track effects${nFx ? ': ' + fxLabel(t) : ', none'}` }, `Effects${nFx ? ` (${nFx})` : ''}…`);
        fxBtn.addEventListener('click', () => host.editEffects('track', t.id));
        const genBtn = host.canGenerate && host.canGenerate(t.role)
            ? btn('Generate…', () => host.generateOnTrack(t.id).then((ok) => { if (ok) announce(`Generated a clip on ${t.name} at the playhead.`); }),
                { 'data-fk': `${t.id}:gen`, class: 'sp-btn sp-small', 'aria-label': `Generate a clip on ${t.name} at the playhead` })
            : null;
        const isOpen = S.moreOpen.has(t.id);
        const more = el('details', { class: 'sp-track-more', open: isOpen },
            el('summary', { 'data-fk': `${t.id}:more`, 'aria-label': `${t.name} track options` }, 'More'),
            el('div', { class: 'sp-more-panel' }, el('label', { class: 'sp-gain-label' }, 'Gain dB ', gainIn), el('label', { class: 'sp-gain-label' }, 'Pan ', panIn), genBtn, fxBtn, upBtn, downBtn, rmBtn));
        more.addEventListener('toggle', () => {
            if (more.open) S.moreOpen.add(t.id);
            else S.moreOpen.delete(t.id);
            const rowNode = more.closest('.sp-track-row');
            if (rowNode) rowNode.classList.toggle('is-more-open', more.open);
            queueDraw();
        });
        const tState = fxState('track', t);
        const panNow = Math.round(M.clampPan(t.pan) * 100);
        const head = el('div', {
            class: 'sp-head', role: 'rowheader', style: `--role:${color}`,
            'aria-label': `${t.name}${t.mute ? ', muted' : ''}${t.solo ? ', soloed' : ''}${panNow ? `, pan ${Math.abs(panNow)} ${panNow < 0 ? 'left' : 'right'}` : ''}`,
        },
            el('span', { class: 'sp-role-chip', 'aria-hidden': 'true' }, M.ROLES[t.role]?.label || 'Audio',
                tState !== 'none' ? el('span', { class: `sp-fx-badge is-${tState}`, title: `Track effects: ${fxLabel(t)}` }, ' FX') : null),
            nameIn, el('div', { class: 'sp-head-btns' }, muteBtn, soloBtn), more);

        const canvas = el('canvas', { class: 'sp-canvas', 'aria-hidden': 'true' });
        const sel = el('div', { class: 'sp-sel', 'aria-hidden': 'true' });
        const lane = el('div', { class: 'sp-lane', dataset: { track: t.id } }, canvas, sel);
        const cells = [];
        if (!t.clips.length) {
            const empty = el('div', {
                class: 'sp-empty', role: 'gridcell', tabindex: '-1', dataset: { track: t.id },
                'aria-label': `${t.name} is empty. Load audio or generate speech to add a clip here.`,
            }, 'Empty track');
            lane.append(empty);
            cells.push(empty);
        }
        for (const c of t.clips) {
            const label = c.label || p.sources.get(c.sourceId)?.label || 'Clip';
            const st = fxState('clip', c);
            const node = el('div', {
                class: 'sp-clip' + (st !== 'none' ? ` has-fx is-${st}` : ''), role: 'gridcell', tabindex: '-1',
                dataset: { clip: c.id, track: t.id },
                style: `--role:${color}`,
            }, el('span', { class: 'sp-trim sp-trim-l', 'aria-hidden': 'true', dataset: { edge: 'start' } }),
            el('span', { class: 'sp-fade sp-fade-in', 'aria-hidden': 'true', title: 'Drag to fade in', dataset: { fade: 'in' } }),
            el('span', { class: 'sp-fade sp-fade-out', 'aria-hidden': 'true', title: 'Drag to fade out', dataset: { fade: 'out' } }),
            el('span', { class: 'sp-clip-label' }, label),
            st !== 'none' ? el('span', { class: 'sp-clip-fx', 'aria-hidden': 'true' }, st === 'rendering' ? 'FX…' : (st === 'failed' ? 'FX!' : 'FX')) : null,
            el('span', { class: 'sp-trim sp-trim-r', 'aria-hidden': 'true', dataset: { edge: 'end' } }));
            lane.append(node);
            cells.push(node);
        }
        const row = el('div', {
            class: 'sp-row sp-track-row' + (t.mute ? ' is-muted' : '') + (isOpen ? ' is-more-open' : ''), role: 'row', dataset: { track: t.id },
            'aria-label': `${t.name}, ${M.ROLES[t.role]?.label || 'Audio'} track ${ti + 1} of ${p.tracks.length}, ${t.clips.length} clip${t.clips.length === 1 ? '' : 's'}${t.mute ? ', muted' : ''}${t.solo ? ', soloed' : ''}${fxDescription('track', t)}`,
        }, head, lane);
        return { row, lane, canvas, sel, cells, trackId: t.id };
    }

    function placeFadeHandles(node, fadeIn, fadeOut) {
        const fin = node.querySelector('.sp-fade-in'), fout = node.querySelector('.sp-fade-out');
        if (fin) fin.style.left = sToX(fadeIn) + 'px';
        if (fout) fout.style.right = sToX(fadeOut) + 'px';
        node.classList.toggle('has-fade', fadeIn > 0 || fadeOut > 0);
    }

    function layout() {
        const p = P();
        const w = contentW();
        inner.style.setProperty('--head-w', headW() + 'px');
        inner.style.width = (headW() + w) + 'px';
        for (const r of rows) {
            const t = M.findTrack(p, r.trackId);
            if (!t) continue;
            for (const node of r.cells) {
                if (!node.dataset.clip) continue;
                const c = t.clips.find((x) => x.id === node.dataset.clip);
                if (!c) continue;
                node.style.left = sToX(c.start) + 'px';
                node.style.width = Math.max(3, sToX(M.clipSpan(c))) + 'px';
                placeFadeHandles(node, c.fadeIn || 0, c.fadeOut || 0);
            }
        }
        for (const lane of [rulerLane, outLane, ...rows.map((r) => r.lane)]) lane.style.width = w + 'px';
        paintSelection();
        paintPlayhead();
    }

    function render() {
        const p = P();
        const active = document.activeElement;
        const hadFocus = !!active && root.contains(active);
        const fk = hadFocus && active.dataset ? active.dataset.fk : null;
        const wasCell = hadFocus && active.getAttribute && active.getAttribute('role') === 'gridcell';
        const wasDetailsOpen = hadFocus && active.closest && active.closest('details[open]') ? true : false;
        validateSelection();
        if (!p.tracks.length) {
            M.addTrack(p, 'voice');
        }
        rows = p.tracks.map((t, i) => trackRow(t, i));
        grid.replaceChildren(...rows.map((r) => r.row));
        markClipStates();
        layout();
        drawAll();
        renderInspector();
        syncButtons();
        syncTransport();
        updateSelLabel();
        updateRoving();
        if (hadFocus && !root.contains(document.activeElement)) {
            const target = fk ? root.querySelector(`[data-fk="${CSS.escape(fk)}"]`) : null;
            if (target) {
                if (wasDetailsOpen) { const d = target.closest('details'); if (d) d.open = true; }
                target.focus({ preventScroll: true });
            } else if (wasCell || hadFocus) {
                focusCell();
            }
        }
    }

    function markClipStates() {
        for (const r of rows) for (const node of r.cells) {
            const on = !!node.dataset.clip && node.dataset.clip === S.clipId;
            node.classList.toggle('is-selected', on);
            node.setAttribute('aria-selected', on ? 'true' : 'false');
            if (node.dataset.clip) {
                const f = M.findClip(P(), node.dataset.clip);
                if (f) node.setAttribute('aria-label', clipDescription(f.track, f.clip));
            }
        }
    }

    function currentCell() {
        const r = rows.find((x) => x.trackId === S.focusTrack) || rows[0];
        if (!r) return null;
        if (S.focusClip) {
            const n = r.cells.find((c) => c.dataset.clip === S.focusClip);
            if (n) return n;
        }
        return r.cells[0] || null;
    }

    function updateRoving() {
        const cur = currentCell();
        for (const r of rows) for (const n of r.cells) n.tabIndex = n === cur ? 0 : -1;
    }

    function focusCell() {
        updateRoving();
        const cur = currentCell();
        if (cur) {
            cur.focus({ preventScroll: true });
            if (cur.dataset.clip) {
                const f = M.findClip(P(), cur.dataset.clip);
                if (f) ensureVisible(f.clip.start);
            }
        }
    }

    function moveFocus(dTrack, dClip, edge) {
        const p = P();
        let ti = Math.max(0, p.tracks.findIndex((t) => t.id === S.focusTrack));
        const t0 = p.tracks[ti];
        let ci = t0 ? t0.clips.findIndex((c) => c.id === S.focusClip) : -1;
        if (dTrack) {
            const cur = t0 && ci >= 0 ? t0.clips[ci] : null;
            ti = Math.max(0, Math.min(p.tracks.length - 1, ti + dTrack));
            const t = p.tracks[ti];
            S.focusTrack = t.id;
            if (t.clips.length) {
                const ref = cur ? cur.start : playheadSamples();
                let best = t.clips[0], bd = Infinity;
                for (const c of t.clips) { const d = Math.abs(c.start - ref); if (d < bd) { bd = d; best = c; } }
                S.focusClip = best.id;
            } else S.focusClip = null;
        } else if (t0 && t0.clips.length) {
            if (edge === 'home') ci = 0;
            else if (edge === 'end') ci = t0.clips.length - 1;
            else ci = Math.max(0, Math.min(t0.clips.length - 1, (ci < 0 ? 0 : ci) + dClip));
            S.focusClip = t0.clips[ci].id;
            S.focusTrack = t0.id;
        }
        focusCell();
        const t = M.findTrack(p, S.focusTrack);
        const f = S.focusClip ? M.findClip(p, S.focusClip) : null;
        if (f) announce(clipDescription(f.track, f.clip));
        else if (t) announce(`${t.name}, empty track ${p.tracks.indexOf(t) + 1} of ${p.tracks.length}.`);
    }

    function renderInspector() {
        const p = P();
        const f = S.clipId ? M.findClip(p, S.clipId) : null;
        if (!f) { inspector.hidden = true; inspector.replaceChildren(); inspector.dataset.sig = ''; return; }
        const c = f.clip;
        const id = c.id;
        const sig = [id, (c.effects || []).length, fxLabel(c), fxState('clip', c), c.text || '', c.gen ? JSON.stringify(c.gen) : ''].join('|');
        if (!inspector.hidden && inspector.dataset.sig === sig) {
            const set = (fk, v) => {
                const n = inspector.querySelector(`[data-fk="${fk}"]`);
                if (n && n !== document.activeElement && n.value !== v) n.value = v;
            };
            set('insp:label', c.label || '');
            set('insp:start', (c.start / sr()).toFixed(3));
            set('insp:gain', String(c.gainDb || 0));
            set('insp:fadeIn', ((c.fadeIn || 0) / sr()).toFixed(2));
            set('insp:fadeOut', ((c.fadeOut || 0) / sr()).toFixed(2));
            const len = inspector.querySelector('.sp-insp-len');
            if (len) len.textContent = `Length ${(M.clipSpan(c) / sr()).toFixed(2)} s`;
            return;
        }
        inspector.dataset.sig = sig;
        const labelIn = el('input', { 'data-fk': 'insp:label', type: 'text', class: 'sp-insp-label', value: c.label || '', 'aria-label': 'Clip name', maxlength: '60' });
        labelIn.addEventListener('change', () => commit('rename clip', (pp) => { M.findClip(pp, id).clip.label = labelIn.value.trim(); }, 'Clip renamed.'));
        const startIn = el('input', { 'data-fk': 'insp:start', type: 'number', class: 'sp-num', min: '0', step: '0.01', value: (c.start / sr()).toFixed(3), 'aria-label': 'Clip start in seconds' });
        startIn.addEventListener('change', () => {
            const v = Math.max(0, parseFloat(startIn.value) || 0);
            commit('move clip', (pp) => { M.moveClip(pp, id, v * sr()); });
            const g = M.findClip(P(), id);
            if (g) announce(`Clip starts at ${spokenTime(g.clip.start / sr())}.`);
        });
        const gainIn = el('input', { 'data-fk': 'insp:gain', type: 'number', class: 'sp-num', min: '-60', max: '24', step: '0.5', value: String(c.gainDb || 0), 'aria-label': 'Clip gain in decibels' });
        gainIn.addEventListener('change', () => {
            const v = Math.max(-60, Math.min(24, parseFloat(gainIn.value) || 0));
            commit('clip gain', (pp) => { M.findClip(pp, id).clip.gainDb = v; }, `Clip gain ${v} dB.`);
        });
        const fadeInput = (key, label) => {
            const input = el('input', { 'data-fk': `insp:${key}`, type: 'number', class: 'sp-num', min: '0', step: '0.05', value: ((c[key] || 0) / sr()).toFixed(2), 'aria-label': `${label} in seconds` });
            input.addEventListener('change', () => {
                const v = Math.max(0, parseFloat(input.value) || 0);
                commit('clip fade', (pp) => {
                    const cc = M.findClip(pp, id).clip;
                    cc[key] = Math.round(v * sr());
                    M.clampFades(cc);
                });
                const g = M.findClip(P(), id);
                if (g) announce(`${label} ${spokenTime((g.clip[key] || 0) / sr())}.`);
            });
            return input;
        };
        const fadeInIn = fadeInput('fadeIn', 'Fade in');
        const fadeOutIn = fadeInput('fadeOut', 'Fade out');
        const selRangeBtn = btn('Select Range', () => selectClip(id, { range: true }));
        const nFx = (c.effects || []).length;
        const st = fxState('clip', c);
        const fxBtn = btn(`Effects${nFx ? ` (${nFx})` : ''}…`, () => host.editEffects('clip', id), {
            'data-fk': 'insp:fx', 'aria-keyshortcuts': 'E',
            'aria-label': `Clip effects${nFx ? ': ' + fxLabel(c) : ', none'}${st === 'rendering' ? ', rendering' : (st === 'failed' ? ', failed to render' : '')}`,
            title: 'Add or edit effects on this clip (E)',
        });
        inspector.replaceChildren(...[
            el('span', { class: 'sp-insp-title' }, 'Clip:'),
            el('label', {}, 'Name ', labelIn),
            el('label', {}, 'Start (s) ', startIn),
            el('span', { class: 'sp-insp-len' }, `Length ${(M.clipSpan(c) / sr()).toFixed(2)} s`),
            el('label', {}, 'Gain dB ', gainIn),
            el('label', {}, 'Fade in (s) ', fadeInIn),
            el('label', {}, 'Fade out (s) ', fadeOutIn),
            fxBtn,
            c.gen && host.describeGen ? el('span', { class: 'sp-insp-gen' }, host.describeGen(c.gen)) : null,
            c.gen && host.regenerate ? btn('Regenerate', () => {
                host.regenerate(id).then((ok) => { if (ok) announce('Clip regenerated.'); });
            }, { 'data-fk': 'insp:regen', title: 'Rebuild this clip from its generator settings' }) : null,
            c.gen && host.editGenerator && !['tts', 'noise-bed'].includes(c.gen.kind) ? btn('Edit…', () => {
                host.editGenerator(id).then((ok) => { if (ok) announce('Clip regenerated with the new settings.'); });
            }, { 'data-fk': 'insp:editgen', 'aria-label': 'Edit generator settings', title: 'Change the generator settings and regenerate' }) : null,
            nFx ? el('span', { class: 'sp-insp-fx' }, fxLabel(c) + (st === 'rendering' ? ' (rendering…)' : (st === 'failed' ? ' (failed)' : ''))) : null,
            selRangeBtn,
            c.text ? el('span', { class: 'sp-insp-text', title: c.text }, `“${c.text.length > 60 ? c.text.slice(0, 60) + '…' : c.text}”`) : null,
        ].filter(Boolean));
        inspector.hidden = false;
    }

    function syncButtons() {
        const p = P();
        const hasClips = p.tracks.some((t) => t.clips.length);
        const hasSel = rangeActive() || !!S.clipId;
        cutBtn.disabled = !hasSel;
        copyBtn.disabled = !hasSel;
        delBtn.disabled = !hasSel;
        dupBtn.disabled = !S.clipId;
        pasteBtn.disabled = !S.clipboard;
        splitBtn.disabled = !hasClips;
        undoBtn.disabled = !history.canUndo();
        redoBtn.disabled = !history.canRedo();
        undoBtn.title = history.canUndo() ? `Undo ${history.undoLabel()} (Ctrl+Z)` : 'Undo (Ctrl+Z)';
        redoBtn.title = history.canRedo() ? `Redo ${history.redoLabel()} (Ctrl+Y)` : 'Redo (Ctrl+Y)';
        playBtn.disabled = !hasClips;
        playSelBtn.disabled = !hasClips;
        stopBtn.disabled = !hasClips;
    }

    function syncTransport() {
        const playing = host.isPlaying();
        playBtn.textContent = playing && host.playMode() === 'all' ? 'Pause' : 'Play';
        playSelBtn.textContent = playing && host.playMode() === 'selection' ? 'Pause' : 'Play Selection';
        paintPlayhead();
    }

    function paintPlayhead() {
        const t = host.needleSeconds();
        const dur = M.projectLength(P()) / sr();
        timeReadout.textContent = `${fmtTime(t)} / ${fmtTime(dur)}`;
        playLine.style.left = (headW() + t * pps()) + 'px';
        playhead.setAttribute('aria-valuemax', dur.toFixed(2));
        playhead.setAttribute('aria-valuenow', t.toFixed(2));
        playhead.setAttribute('aria-valuetext', spokenTime(t));
        if (phDirty) return;
        const text = fmtTime(t);
        if (playhead.value === text) return;
        const all = document.activeElement === playhead && playhead.selectionStart === 0 && playhead.selectionEnd === playhead.value.length;
        playhead.value = text;
        if (all) playhead.select();
    }

    function commitPlayhead() {
        if (!phDirty) return;
        phDirty = false;
        const want = parseTime(playhead.value);
        if (want === null) {
            paintPlayhead();
            announce('Not a time. Type a time such as 0:16.6 or 16.6.');
            return;
        }
        const dur = M.projectLength(P()) / sr();
        const t = Math.min(Math.max(0, want), dur);
        S.anchor = null;
        host.setPlayheadSeconds(t);
        paintPlayhead();
        ensureVisible(Math.round(t * sr()));
        announce(want > dur ? `Past the end; playhead at the end, ${spokenTime(t)}.` : `Playhead ${spokenTime(t)}.`);
    }

    function playheadEntryKey(e) {
        if (e.key === 'Enter') {
            e.preventDefault();
            commitPlayhead();
            playhead.select();
            return true;
        }
        if (e.key === 'Escape' && phDirty) {
            e.preventDefault();
            phDirty = false;
            paintPlayhead();
            playhead.select();
            return true;
        }
        if (phDirty) return true;
        if (e.ctrlKey || e.metaKey || e.altKey) return false;
        return (e.key.length === 1 && /[\d:.,]/.test(e.key)) || e.key === 'Backspace' || e.key === 'Delete';
    }

    playhead.addEventListener('input', () => { phDirty = true; });
    playhead.addEventListener('blur', commitPlayhead);
    playhead.addEventListener('focus', () => playhead.select());
    playhead.addEventListener('pointerdown', () => { phSelectOnUp = document.activeElement !== playhead; });
    playhead.addEventListener('mouseup', (e) => {
        if (phSelectOnUp) {
            e.preventDefault();
            playhead.select();
        }
        phSelectOnUp = false;
    });

    function paintSelection() {
        for (const r of rows) {
            const on = S.selB > S.selA && S.selTracks.has(r.trackId);
            r.sel.hidden = !on;
            if (on) {
                r.sel.style.left = sToX(S.selA) + 'px';
                r.sel.style.width = Math.max(2, sToX(S.selB - S.selA)) + 'px';
            }
            r.row.classList.toggle('is-selected-track', S.selTracks.has(r.trackId));
        }
        syncButtons();
    }

    function prepCanvas(canvas, w, h) {
        const dpr = Math.min(3, window.devicePixelRatio || 1);
        const cw = Math.max(1, Math.round(w * dpr)), ch = Math.max(1, Math.round(h * dpr));
        if (canvas.width !== cw || canvas.height !== ch) {
            canvas.width = cw;
            canvas.height = ch;
        }
        canvas.style.width = w + 'px';
        canvas.style.height = h + 'px';
        const g = canvas.getContext('2d');
        g.setTransform(dpr, 0, 0, dpr, 0, 0);
        return g;
    }

    function cssVar(name, fallback) {
        const v = getComputedStyle(root).getPropertyValue(name).trim();
        return v || fallback;
    }

    function visibleWidth() {
        return Math.max(1, Math.min(scroller.clientWidth - headW(), contentW()));
    }

    function drawRuler() {
        const w = visibleWidth(), h = rulerLane.clientHeight || 26;
        const g = prepCanvas(rulerCanvas, w, h);
        const fg = cssVar('--color-text', '#ddd');
        g.clearRect(0, 0, w, h);
        const v = pps();
        const t0 = scroller.scrollLeft / v, t1 = t0 + w / v;
        let step = RULER_STEPS[RULER_STEPS.length - 1];
        for (const s of RULER_STEPS) if (s * v >= 70) { step = s; break; }
        g.strokeStyle = fg;
        g.fillStyle = fg;
        g.globalAlpha = 0.75;
        g.font = '11px Hack, monospace';
        g.beginPath();
        for (let t = Math.floor(t0 / step) * step; t <= t1 + step; t += step) {
            const x = Math.round((t - t0) * v) + 0.5;
            g.moveTo(x, h - 9);
            g.lineTo(x, h);
            const minor = step / 5;
            for (let k = 1; k < 5; k++) {
                const mx = Math.round((t + k * minor - t0) * v) + 0.5;
                g.moveTo(mx, h - 4);
                g.lineTo(mx, h);
            }
            const label = step < 1 ? `${fmtTime(t, true)}` : fmtTime(t, step < 60 ? false : false);
            g.fillText(label, x + 3, h - 12);
        }
        g.stroke();
        g.globalAlpha = 1;
    }

    function drawLane(r) {
        const p = P();
        const t = M.findTrack(p, r.trackId);
        if (!t) return;
        const w = visibleWidth(), h = r.lane.clientHeight || 64;
        const g = prepCanvas(r.canvas, w, h);
        g.clearRect(0, 0, w, h);
        const v = pps();
        const left = scroller.scrollLeft;
        const color = ROLE_COLORS[t.role] || ROLE_COLORS.free;
        const spp = sr() / v;
        const audible = M.audibleTracks(p).includes(t);
        const tg = M.dbToGain(t.gainDb);
        for (const c of t.clips) {
            const x0 = sToX(c.start) - left, x1 = sToX(M.clipEnd(c)) - left;
            if (x1 < 0 || x0 > w) continue;
            g.globalAlpha = audible ? 0.18 : 0.08;
            g.fillStyle = color;
            g.fillRect(Math.max(0, x0), 2, Math.min(w, x1) - Math.max(0, x0), h - 4);
            const a = host.clipAudio ? host.clipAudio(c) : null;
            if (!a) continue;
            const pending = M.hasFx(c) && !a.rendered;
            g.globalAlpha = audible ? (pending ? 0.4 : 0.95) : 0.35;
            const vx0 = Math.max(0, x0), vx1 = Math.min(w, x1, sToX(c.start + a.len) - left);
            if (vx1 <= vx0) continue;
            drawPeaks(g, a.pcm || a.peakSource, {
                x0: vx0, x1: vx1,
                srcStart: a.base + (vx0 - x0) * spp,
                samplesPerPx: spp,
                top: 16, height: h - 20,
                gain: tg * M.dbToGain(c.gainDb),
                color,
            });
        }
        g.globalAlpha = 1;
        g.strokeStyle = cssVar('--color-text', '#ddd');
        g.lineWidth = 1.5;
        for (const c of t.clips) {
            const pv = S.fadePreview && S.fadePreview.clipId === c.id ? S.fadePreview : c;
            const fi = pv.fadeIn || 0, fo = pv.fadeOut || 0;
            if (!fi && !fo) continue;
            const x0 = sToX(c.start) - left, x1 = sToX(M.clipEnd(c)) - left;
            if (x1 < 0 || x0 > w) continue;
            g.beginPath();
            if (fi) { g.moveTo(x0, h - 3); g.lineTo(x0 + sToX(fi), 4); }
            if (fo) { g.moveTo(x1 - sToX(fo), 4); g.lineTo(x1, h - 3); }
            g.stroke();
        }
    }

    function drawOutput() {
        const w = visibleWidth(), h = outLane.clientHeight || 40;
        const g = prepCanvas(outCanvas, w, h);
        g.clearRect(0, 0, w, h);
        refreshMaster();
        const prev = host.outputPreview();
        if (prev && prev.pcm && prev.pcm.length) {
            const v = pps();
            const spp = prev.sampleRate / v;
            const x0 = -scroller.scrollLeft;
            const x1 = x0 + (prev.pcm.length / prev.sampleRate) * v;
            const vx0 = Math.max(0, x0), vx1 = Math.min(w, x1);
            if (vx1 > vx0) {
                g.globalAlpha = 0.9;
                drawPeaks(g, prev.pcm, { x0: vx0, x1: vx1, srcStart: (vx0 - x0) * spp, samplesPerPx: spp, top: 2, height: h - 4, gain: prev.gain || 1, color: cssVar('--color-orange', '#ff7800') });
                g.globalAlpha = 1;
            }
        }
        if (masterSummary) {
            g.font = '11px Hack, monospace';
            const tw = Math.min(w - 8, g.measureText(masterSummary).width + 10);
            g.globalAlpha = 0.8;
            g.fillStyle = cssVar('--color-bg', '#111');
            g.fillRect(4, 3, tw, 16);
            g.globalAlpha = 1;
            g.fillStyle = cssVar('--color-text', '#ddd');
            g.fillText(masterSummary, 9, 15, tw - 10);
        }
    }

    function refreshMaster() {
        const m = host.master ? host.master() : null;
        if (!m) return;
        const fx = m.effects.length ? m.effects.join(', ') : 'no effects';
        const level = `gain ${m.levelDb > 0 ? '+' : ''}${m.levelDb} dB`;
        const stateText = m.bypass ? 'bypassed' : (m.state === 'rendering' ? 'rendering…' : (m.state === 'dry' ? 'not rendered yet' : (m.state === 'large' ? 'applied on export (use Macro Preview for a selection)' : '')));
        if (document.activeElement !== masterGainIn && parseFloat(masterGainIn.value) !== m.levelDb) masterGainIn.value = String(m.levelDb);
        bypassBtn.setAttribute('aria-pressed', m.bypass ? 'true' : 'false');
        bypassBtn.disabled = (!m.active && !m.bypass) || m.state === 'large';
        masterFxBtn.setAttribute('aria-label', `Master effects: ${fx}${stateText ? ', ' + stateText : ''}. Opens the effect controls.`);
        const summary = `${m.effects.length ? m.effects.join(' · ') : 'No master effects'} · ${level}${stateText ? ' · ' + stateText : ''}`;
        if (summary !== masterSummary) {
            masterSummary = summary;
            queueDraw();
        }
        syncButtons();
    }

    let drawQueued = false;
    function drawAll() {
        drawQueued = false;
        drawRuler();
        drawOutput();
        for (const r of rows) drawLane(r);
        paintPlayhead();
    }
    function queueDraw() {
        if (drawQueued) return;
        drawQueued = true;
        requestAnimationFrame(drawAll);
    }

    function startTicker() {
        if (S.raf) return;
        const tick = () => {
            S.raf = 0;
            const playing = host.isPlaying();
            paintPlayhead();
            if (playing) {
                ensureVisible(playheadSamples());
                S.raf = requestAnimationFrame(tick);
            } else if (S.lastPlaying) {
                syncTransport();
            }
            S.lastPlaying = playing;
        };
        S.raf = requestAnimationFrame(tick);
    }

    function laneTime(lane, clientX) {
        const rect = lane.getBoundingClientRect();
        return xToS(clientX - rect.left);
    }

    function trackAtPoint(x, y) {
        const hit = document.elementFromPoint(x, y);
        const row = hit && hit.closest ? hit.closest('.sp-track-row') : null;
        return row ? row.dataset.track : null;
    }

    function snapSamples(s, excludeClipId) {
        const p = P();
        const tol = Math.round((8 / pps()) * sr());
        let best = s, bd = tol + 1;
        const cand = [0, playheadSamples(), S.selA, S.selB];
        const gap = sr();
        for (const t of p.tracks) for (const c of t.clips) {
            if (c.id === excludeClipId) continue;
            cand.push(c.start, M.clipEnd(c), M.clipEnd(c) + gap);
        }
        for (const c of cand) { const d = Math.abs(c - s); if (d < bd) { bd = d; best = c; } }
        return bd <= tol ? best : s;
    }

    function onPointerDown(e) {
        if (e.button !== undefined && e.button !== 0 && e.pointerType === 'mouse') return;
        S.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (S.pointers.size === 2) {
            const [a, b] = [...S.pointers.values()];
            S.pinch = { dist: Math.hypot(a.x - b.x, a.y - b.y), pps: pps(), cx: (a.x + b.x) / 2 };
            if (S.drag && S.drag.node) S.drag.node.style.transform = '';
            S.drag = null;
            return;
        }
        const ruler = e.target.closest('.sp-ruler-lane, .sp-out-lane');
        if (ruler) {
            S.drag = { kind: 'scrub', lane: ruler };
            host.setPlayheadSeconds(laneTime(ruler, e.clientX) / sr());
            paintPlayhead();
            ruler.setPointerCapture?.(e.pointerId);
            e.preventDefault();
            return;
        }
        const lane = e.target.closest('.sp-track-row .sp-lane');
        if (!lane) return;
        const clipNode = e.target.closest('.sp-clip');
        const trackId = lane.dataset.track;
        const at = laneTime(lane, e.clientX);
        if (clipNode) {
            const f = M.findClip(P(), clipNode.dataset.clip);
            if (!f) return;
            const edge = e.target.dataset.edge;
            const fade = e.target.dataset.fade;
            S.drag = {
                kind: fade ? 'fade' : (edge ? 'trim' : 'press'), edge, fade, lane, clipId: f.clip.id, trackId, node: clipNode,
                x0: e.clientX, y0: e.clientY, start: f.clip.start, end: M.clipEnd(f.clip), at, moved: false,
                pointerType: e.pointerType,
            };
            clipNode.setPointerCapture?.(e.pointerId);
            e.preventDefault();
            return;
        }
        S.drag = { kind: 'lane', trackId, x0: e.clientX, y0: e.clientY, at, moved: false, lane, shift: e.shiftKey };
        if (e.pointerType === 'mouse') { lane.setPointerCapture?.(e.pointerId); e.preventDefault(); }
    }

    function onPointerMove(e) {
        if (S.pointers.has(e.pointerId)) S.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (S.pinch && S.pointers.size >= 2) {
            const [a, b] = [...S.pointers.values()];
            const d = Math.hypot(a.x - b.x, a.y - b.y);
            if (d > 10 && S.pinch.dist > 10) {
                const rect = scroller.getBoundingClientRect();
                const target = Math.min(MAX_PPS, Math.max(MIN_PPS, S.pinch.pps * d / S.pinch.dist));
                zoomBy(target / pps(), S.pinch.cx - rect.left);
            }
            e.preventDefault();
            return;
        }
        const d = S.drag;
        if (!d) return;
        if (d.kind === 'scrub') {
            host.setPlayheadSeconds(laneTime(d.lane, e.clientX) / sr());
            paintPlayhead();
            return;
        }
        const dx = e.clientX - d.x0, dy = e.clientY - (d.y0 || 0);
        if (!d.moved && Math.hypot(dx, dy) < 5) return;
        d.moved = true;
        if (d.kind === 'press') d.kind = 'move';
        if (d.kind === 'move') {
            const ds = Math.round((dx / pps()) * sr());
            let ns = Math.max(0, snapSamples(d.start + ds, d.clipId));
            const endSnap = snapSamples(d.start + ds + (d.end - d.start), d.clipId);
            if (endSnap !== d.start + ds + (d.end - d.start) && ns === Math.max(0, d.start + ds)) ns = Math.max(0, endSnap - (d.end - d.start));
            d.newStart = ns;
            d.newTrack = trackAtPoint(e.clientX, e.clientY) || d.trackId;
            const rowNode = grid.querySelector(`.sp-track-row[data-track="${d.newTrack}"]`);
            const fromRow = grid.querySelector(`.sp-track-row[data-track="${d.trackId}"]`);
            const ty = rowNode && fromRow ? rowNode.getBoundingClientRect().top - fromRow.getBoundingClientRect().top : 0;
            d.node.style.transform = `translate(${sToX(ns - d.start)}px, ${ty}px)`;
            d.node.classList.add('is-dragging');
            e.preventDefault();
        } else if (d.kind === 'fade') {
            const f = M.findClip(P(), d.clipId);
            if (!f) return;
            const span = d.end - d.start;
            const at = laneTime(d.lane, e.clientX);
            let fi = f.clip.fadeIn || 0, fo = f.clip.fadeOut || 0;
            if (d.fade === 'in') fi = Math.max(0, Math.min(at - d.start, span - fo));
            else fo = Math.max(0, Math.min(d.end - at, span - fi));
            S.fadePreview = { clipId: d.clipId, fadeIn: fi, fadeOut: fo };
            placeFadeHandles(d.node, fi, fo);
            queueDraw();
            e.preventDefault();
        } else if (d.kind === 'trim') {
            const ds = Math.round((dx / pps()) * sr());
            const raw = (d.edge === 'start' ? d.start : d.end) + ds;
            d.newEdge = snapSamples(raw, d.clipId);
            const ns = d.edge === 'start' ? Math.min(d.newEdge, d.end - 1) : d.start;
            const ne = d.edge === 'end' ? Math.max(d.newEdge, d.start + 1) : d.end;
            d.node.style.left = sToX(ns) + 'px';
            d.node.style.width = Math.max(3, sToX(ne - ns)) + 'px';
            e.preventDefault();
        } else if (d.kind === 'lane') {
            const cur = laneTime(d.lane, e.clientX);
            const endTrack = trackAtPoint(e.clientX, e.clientY) || d.trackId;
            const p = P();
            const i0 = p.tracks.findIndex((t) => t.id === d.trackId), i1 = p.tracks.findIndex((t) => t.id === endTrack);
            const ids = p.tracks.slice(Math.min(i0, i1), Math.max(i0, i1) + 1).map((t) => t.id);
            S.clipId = null;
            setSelection(snapSamples(d.at), snapSamples(cur), ids, true);
            renderInspector();
            markClipStates();
            if (e.pointerType === 'mouse') e.preventDefault();
        }
    }

    function onPointerUp(e) {
        S.pointers.delete(e.pointerId);
        if (S.pinch) {
            if (S.pointers.size < 2) S.pinch = null;
            return;
        }
        const d = S.drag;
        S.drag = null;
        if (!d) return;
        if (d.kind === 'scrub') { announce(`Playhead ${spokenTime(host.needleSeconds())}.`); return; }
        if (d.kind === 'fade') {
            const pv = S.fadePreview;
            S.fadePreview = null;
            if (d.moved && pv) {
                const id = d.clipId;
                commit('clip fade', (p) => {
                    const c = M.findClip(p, id).clip;
                    c.fadeIn = pv.fadeIn;
                    c.fadeOut = pv.fadeOut;
                    M.clampFades(c);
                });
                const g = M.findClip(P(), id);
                if (g) announce(d.fade === 'in' ? `Fade in ${spokenTime(g.clip.fadeIn / sr())}.` : `Fade out ${spokenTime(g.clip.fadeOut / sr())}.`);
                return;
            }
            d.kind = 'press';
        }
        if (d.kind === 'move') {
            d.node.style.transform = '';
            d.node.classList.remove('is-dragging');
            const id = d.clipId, ns = d.newStart ?? d.start, nt = d.newTrack || d.trackId;
            if (ns !== d.start || nt !== d.trackId) {
                commit('move clip', (p) => { M.moveClip(p, id, ns, nt); });
                const f = M.findClip(P(), id);
                if (f) { selectClip(id, { announceIt: false }); announce(`Moved clip to ${f.track.name} at ${spokenTime(f.clip.start / sr())}.`); }
            } else layout();
            return;
        }
        if (d.kind === 'trim') {
            if (d.newEdge === undefined) { layout(); return; }
            const id = d.clipId, edge = d.edge, at = d.newEdge;
            commit('trim clip', (p) => { M.trimClip(p, id, edge, at); });
            const f = M.findClip(P(), id);
            if (f) announce(`Clip trimmed: starts ${spokenTime(f.clip.start / sr())}, length ${spokenTime(f.clip.length / sr())}.`);
            return;
        }
        if (d.kind === 'press') {
            host.setPlayheadSeconds(d.at / sr());
            setSelection(d.at, d.at, [d.trackId], true);
            selectClip(d.clipId, { focus: true });
            paintPlayhead();
            return;
        }
        if (d.kind === 'lane') {
            if (!d.moved) {
                S.clipId = null;
                S.focusTrack = d.trackId;
                const t = M.findTrack(P(), d.trackId);
                S.focusClip = t && t.clips.length ? null : null;
                if (d.shift && S.selTracks.size) {
                    const anchor = Math.abs(d.at - S.selA) < Math.abs(d.at - S.selB) ? S.selB : S.selA;
                    setSelection(anchor, d.at, null);
                } else {
                    setSelection(d.at, d.at, [d.trackId], true);
                    host.setPlayheadSeconds(d.at / sr());
                }
                renderInspector();
                markClipStates();
                paintPlayhead();
                announce(`Playhead ${spokenTime(d.at / sr())} on ${t ? t.name : 'track'}.`);
            } else if (rangeActive()) {
                host.setPlayheadSeconds(S.selA / sr());
                paintPlayhead();
                announce(`Selected ${spokenTime((S.selB - S.selA) / sr())} on ${S.selTracks.size} track${S.selTracks.size === 1 ? '' : 's'}.`);
            }
        }
    }

    function onPointerCancel(e) {
        S.pointers.delete(e.pointerId);
        if (S.pointers.size < 2) S.pinch = null;
        if (S.fadePreview) { S.fadePreview = null; queueDraw(); }
        if (S.drag && S.drag.node) {
            S.drag.node.style.transform = '';
            S.drag.node.classList.remove('is-dragging');
            layout();
        }
        S.drag = null;
    }

    function onDblClick(e) {
        const clipNode = e.target.closest('.sp-clip');
        if (clipNode) selectClip(clipNode.dataset.clip, { range: true });
    }

    function onWheel(e) {
        const mod = e.ctrlKey || e.metaKey;
        const unit = e.deltaMode === 1 ? 40 : (e.deltaMode === 2 ? 800 : 1);
        if (!mod && e.target.closest && e.target.closest('.sp-head, input, select, textarea, button')) return;
        if (!mod && (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY))) {
            if (e.shiftKey && !e.deltaX && e.deltaY) {
                e.preventDefault();
                scroller.scrollLeft += e.deltaY * unit;
            }
            return;
        }
        const dy = e.deltaY * unit;
        if (!dy) return;
        e.preventDefault();
        const rect = scroller.getBoundingClientRect();
        const f = Math.min(2, Math.max(0.5, Math.pow(2, -dy / 300)));
        zoomBy(f, Math.max(headW(), e.clientX - rect.left));
    }

    function onGridKey(e) {
        const cell = e.target.closest('[role="gridcell"]');
        if (!cell) return false;
        S.focusTrack = cell.dataset.track;
        S.focusClip = cell.dataset.clip || null;
        switch (e.key) {
        case 'ArrowRight': moveFocus(0, 1); return true;
        case 'ArrowLeft': moveFocus(0, -1); return true;
        case 'ArrowDown': moveFocus(1, 0); return true;
        case 'ArrowUp': moveFocus(-1, 0); return true;
        case 'Home': moveFocus(0, 0, 'home'); return true;
        case 'End': moveFocus(0, 0, 'end'); return true;
        case 'Enter':
            if (cell.dataset.clip) {
                const f = M.findClip(P(), cell.dataset.clip);
                if (f) host.setPlayheadSeconds(f.clip.start / sr());
                selectClip(cell.dataset.clip, { range: e.shiftKey });
                paintPlayhead();
            } else {
                S.selTracks = new Set([cell.dataset.track]);
                paintSelection();
                announce('Track selected.');
            }
            return true;
        default: return false;
        }
    }

    function onPlayheadKey(e) {
        const step = e.ctrlKey || e.metaKey ? 1 : (e.altKey ? 0.01 : 0.1);
        const dur = M.projectLength(P()) / sr();
        let t = host.needleSeconds();
        let handled = true;
        switch (e.key) {
        case 'ArrowRight':
        case 'ArrowUp': t = Math.min(dur, t + step); break;
        case 'ArrowLeft':
        case 'ArrowDown': t = Math.max(0, t - step); break;
        case 'PageUp': t = Math.min(dur, t + 5); break;
        case 'PageDown': t = Math.max(0, t - 5); break;
        case 'Home': t = 0; break;
        case 'End': t = dur; break;
        default: handled = false;
        }
        if (!handled) return false;
        const before = host.needleSeconds();
        if (e.shiftKey) {
            if (S.anchor === null || S.selB <= S.selA) S.anchor = Math.round(before * sr());
            const ids = S.selTracks.size ? [...S.selTracks] : P().tracks.map((x) => x.id);
            setSelection(S.anchor, Math.round(t * sr()), ids, true);
            announce(`Selection ${spokenTime((S.selB - S.selA) / sr())}.`);
        } else {
            S.anchor = null;
        }
        host.setPlayheadSeconds(t);
        paintPlayhead();
        ensureVisible(Math.round(t * sr()));
        if (!e.shiftKey) announce(spokenTime(t));
        return true;
    }

    const OWNS_KEYS = '[role="tablist"], [role="listbox"], [role="menu"], [role="menubar"], [role="combobox"], [role="radiogroup"], [role="tree"], [contenteditable="true"], .CodeMirror';
    const modalOpen = () => !!document.querySelector('dialog[open], .splice-chain-backdrop:not([hidden])');
    let spaceTaken = false;

    function onKey(e, global = false) {
        if (e.defaultPrevented) return;
        const onHead = e.target === playhead;
        if (onHead && playheadEntryKey(e)) return;
        const typing = !onHead && isTyping(e.target);
        const mod = e.ctrlKey || e.metaKey;
        if (!typing && !global) {
            if (e.target === playhead && onPlayheadKey(e)) { e.preventDefault(); return; }
            if (onGridKey(e)) { e.preventDefault(); return; }
        }
        if (typing) return;
        const k = e.key.toLowerCase();
        if (mod && k === 'z' && !e.shiftKey) { e.preventDefault(); undo(); return; }
        if (mod && (k === 'y' || (k === 'z' && e.shiftKey))) { e.preventDefault(); redo(); return; }
        if (!global) {
            if (mod && k === 'x') { e.preventDefault(); cut(); return; }
            if (mod && k === 'c') { e.preventDefault(); copy(); return; }
            if (mod && k === 'v') { e.preventDefault(); paste(); return; }
            if (mod && k === 'd') { e.preventDefault(); duplicate(); return; }
        }
        if (mod || e.altKey) return;
        if (e.key === ' ') {
            e.preventDefault();
            spaceTaken = true;
            if (!e.repeat) togglePlay('all');
            return;
        }
        if (k === 's') { e.preventDefault(); splitAtPlayhead(); return; }
        if (k === 'r' && host.toggleRecord) { e.preventDefault(); host.toggleRecord(); return; }
        if (k === 'e') { e.preventDefault(); editEffects(); return; }
        if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); del(e.shiftKey); return; }
        if (e.key === '[' || e.key === '{') { e.preventDefault(); nudge(e.shiftKey ? -1 : -0.1); return; }
        if (e.key === ']' || e.key === '}') { e.preventDefault(); nudge(e.shiftKey ? 1 : 0.1); return; }
        if (e.key === '+' || e.key === '=') { e.preventDefault(); zoomBy(ZOOM_STEPS); return; }
        if (e.key === '-' || e.key === '_') { e.preventDefault(); zoomBy(1 / ZOOM_STEPS); return; }
        if (e.key === '0') { e.preventDefault(); S.fit = true; render(); announce('Zoomed to fit the project.'); }
    }

    async function refreshProjects(selectName) {
        let names;
        try { names = await host.projects.list(); } catch { names = []; }
        projSelect.replaceChildren(el('option', { value: '' }, names.length ? 'Choose a saved project' : 'No saved projects'),
            ...names.map((n) => el('option', { value: n }, n)));
        if (selectName && names.includes(selectName)) projSelect.value = selectName;
        projOpenBtn.disabled = !names.length;
        projDelBtn.disabled = !names.length;
    }

    async function saveNamed() {
        const name = projName.value.trim();
        if (!name) { announce('Type a project name first.'); projName.focus(); return; }
        try {
            await host.projects.save(name);
            await refreshProjects(name);
            host.status(`Saved project "${name}".`, true);
            announce(`Saved project ${name}.`);
        } catch (e) { host.status(`Could not save project: ${e.message || e}`, false); }
    }

    async function openNamed() {
        const name = projSelect.value;
        if (!name) { announce('Choose a saved project first.'); projSelect.focus(); return; }
        try {
            await host.projects.open(name);
            history.clear();
            S.clipId = null; S.focusClip = null; S.focusTrack = null; S.selTracks.clear(); S.fit = true;
            setSelection(0, 0, [], true);
            projName.value = name;
            render();
            host.status(`Opened project "${name}".`, true);
            announce(`Opened project ${name}.`);
        } catch (e) { host.status(`Could not open project: ${e.message || e}`, false); }
    }

    async function exportFile() {
        if (!host.projects.exportFile) return;
        try {
            await host.projects.exportFile(projName.value.trim() || projSelect.value);
        } catch (e) {
            host.status(`Could not export the project file: ${e.message || e}`, false);
            announce(`Could not export the project file: ${e.message || e}`);
        }
    }

    async function importFile(f) {
        if (!host.projects.importFile) return;
        host.status(`Opening ${f.name}...`, true);
        try {
            const r = await host.projects.importFile(f);
            history.clear();
            S.clipId = null; S.focusClip = null; S.focusTrack = null; S.selTracks.clear(); S.fit = true;
            setSelection(0, 0, [], true);
            projName.value = (f.name || '').replace(/\.zip$/i, '');
            render();
            host.status(`Opened project file "${f.name}".`, true);
            announce(`Opened project file ${f.name}: ${r.tracks} track${r.tracks === 1 ? '' : 's'}, ${r.clips} clip${r.clips === 1 ? '' : 's'}.`);
        } catch (e) {
            host.status(`Could not open the project file: ${e.message || e}`, false);
            announce(`Could not open the project file: ${e.message || e}.`);
        }
    }

    async function deleteNamed() {
        const name = projSelect.value;
        if (!name) { announce('Choose a saved project first.'); return; }
        if (typeof window.confirm === 'function' && !window.confirm(`Delete saved project "${name}"?`)) return;
        try {
            await host.projects.remove(name);
            await refreshProjects();
            announce(`Deleted saved project ${name}.`);
        } catch (e) { host.status(`Could not delete project: ${e.message || e}`, false); }
    }

    root.addEventListener('keydown', (e) => {
        if (modalOpen()) return;
        onKey(e);
    });
    document.addEventListener('keydown', (e) => {
        if (root.hidden || !root.offsetParent || modalOpen()) return;
        const t = e.target;
        if (t && root.contains(t)) return;
        if (t === document.body || t === document.documentElement || !t) { onKey(e); return; }
        if (t.closest && t.closest(OWNS_KEYS)) return;
        if (t.tagName === 'INPUT' && /^(checkbox|radio)$/i.test(t.type)) return;
        onKey(e, true);
    });
    document.addEventListener('keyup', (e) => {
        if (e.key !== ' ' || !spaceTaken) return;
        spaceTaken = false;
        e.preventDefault();
    }, true);
    scroller.addEventListener('pointerdown', onPointerDown);
    scroller.addEventListener('pointermove', onPointerMove);
    scroller.addEventListener('pointerup', onPointerUp);
    scroller.addEventListener('pointercancel', onPointerCancel);
    scroller.addEventListener('dblclick', onDblClick);
    scroller.addEventListener('wheel', onWheel, { passive: false });
    scroller.addEventListener('scroll', queueDraw, { passive: true });
    grid.addEventListener('focusin', (e) => {
        const cell = e.target.closest('[role="gridcell"]');
        if (!cell) return;
        S.focusTrack = cell.dataset.track;
        S.focusClip = cell.dataset.clip || null;
        updateRoving();
    });
    if (typeof ResizeObserver === 'function') {
        let lastW = 0;
        new ResizeObserver(() => {
            if (scroller.clientWidth === lastW) return;
            lastW = scroller.clientWidth;
            layout();
            queueDraw();
        }).observe(scroller);
    }
    window.addEventListener('resize', () => { layout(); queueDraw(); });
    refreshProjects();

    return {
        root,
        render,
        redraw: queueDraw,
        refreshOutput: () => queueDraw(),
        refreshMaster,
        focusGrid: () => focusCell(),
        setRecording: (on, secs) => {
            recLabel.textContent = on ? 'Stop Recording' : 'Record';
            recBtn.classList.toggle('is-recording', !!on);
            const s = Math.max(0, Math.floor(secs || 0));
            recTime.textContent = on ? ` ${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` : '';
        },
        announce,
        syncTransport: () => { syncTransport(); if (host.isPlaying()) startTicker(); },
        tick: paintPlayhead,
        selectionSeconds: () => ({ start: S.selA / sr(), end: S.selB / sr(), tracks: [...S.selTracks] }),
        setSelectionSeconds: (a, b) => setSelection(a * sr(), b * sr(), S.selTracks.size ? null : P().tracks.map((t) => t.id), true),
        resetView: () => { S.fit = true; S.clipId = null; S.focusClip = null; S.selTracks.clear(); S.selA = S.selB = 0; },
        targetTrackId: (role = 'voice') => {
            const p = P();
            if (S.focusTrack && M.findTrack(p, S.focusTrack)) return S.focusTrack;
            if (S.selTracks.size) { const t = p.tracks.find((x) => S.selTracks.has(x.id)); if (t) return t.id; }
            const byRole = p.tracks.find((t) => t.role === role) || p.tracks[0];
            return byRole ? byRole.id : null;
        },
        selectClip: (id) => selectClip(id, { announceIt: false }),
        refreshProjects,
        setVisible: (v) => { root.hidden = !v; },
    };
}
