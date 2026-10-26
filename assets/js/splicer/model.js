export const ROLES = {
    header: { label: 'SAME Header' },
    attn: { label: 'Attention Tone' },
    voice: { label: 'Voice' },
    eom: { label: 'EOM' },
    bed: { label: 'Noise Bed' },
    free: { label: 'Audio' },
};

let idSeq = 0;
export const newId = (prefix) => `${prefix}-${Date.now().toString(36)}-${(idSeq++).toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

export function createProject(sampleRate = 44100) {
    return { version: 3, sampleRate, tracks: [], sources: new Map(), markers: [], master: null };
}

export const cloneJson = (v) => (v === null || v === undefined ? null : JSON.parse(JSON.stringify(v)));
export const sameJson = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

export function makeTrack(role = 'voice', name) {
    const r = ROLES[role] ? role : 'free';
    return { id: newId('trk'), name: name || ROLES[r].label, role: r, gainDb: 0, pan: 0, mute: false, solo: false, effects: [], clips: [] };
}

export const clampPan = (v) => (Number.isFinite(+v) ? Math.max(-1, Math.min(1, +v)) : 0);

export function panGain(pan, side) {
    const v = clampPan(pan);
    if (side === 'L') return v > 0 ? 1 - v : 1;
    if (side === 'R') return v < 0 ? 1 + v : 1;
    return 1;
}

export const hasFx = (x) => !!x && Array.isArray(x.effects) && x.effects.some((e) => e && !e.bypass);
export const cloneFx = (list) => (Array.isArray(list) ? list.map((e) => ({ ...e })) : []);

export function clipSpan(c) {
    return hasFx(c) && c.outLen > 0 ? c.outLen : c.length;
}

const fxRatio = (c) => c.length / clipSpan(c);

export function clipEnd(c) {
    return c.start + clipSpan(c);
}

export function subClip(c, s, e) {
    const r = fxRatio(c);
    const a = Math.round((s - c.start) * r);
    const b = Math.round((e - c.start) * r);
    return {
        ...c,
        effects: cloneFx(c.effects),
        id: newId('clip'),
        start: s,
        offset: c.offset + a,
        length: Math.max(1, b - a),
        outLen: hasFx(c) && c.outLen > 0 ? e - s : null,
        fadeIn: s === c.start ? Math.min(c.fadeIn || 0, e - s) : 0,
        fadeOut: e === clipEnd(c) ? Math.min(c.fadeOut || 0, e - s) : 0,
    };
}

export function clampFades(c) {
    const span = clipSpan(c);
    c.fadeIn = Math.max(0, Math.min(Math.round(c.fadeIn || 0), span));
    c.fadeOut = Math.max(0, Math.min(Math.round(c.fadeOut || 0), span - c.fadeIn));
    return c;
}

export function trackEnd(t) {
    let e = 0;
    for (const c of t.clips) if (clipEnd(c) > e) e = clipEnd(c);
    return e;
}

export function projectLength(p) {
    let e = 0;
    for (const t of p.tracks) {
        const te = trackEnd(t);
        if (te > e) e = te;
    }
    return e;
}

export function sortClips(t) {
    t.clips.sort((a, b) => a.start - b.start || a.id.localeCompare(b.id));
}

export function findClip(p, clipId) {
    for (const t of p.tracks) {
        const i = t.clips.findIndex((c) => c.id === clipId);
        if (i >= 0) return { track: t, clip: t.clips[i], index: i };
    }
    return null;
}

export function findTrack(p, trackId) {
    return p.tracks.find((t) => t.id === trackId) || null;
}

export function addSource(p, pcm, label = '', meta = null) {
    const id = newId('src');
    p.sources.set(id, { id, pcm, label, meta });
    return id;
}

export function addDiskSource(p, { file, length, peaks, bucket }, label = '', meta = null) {
    const id = newId('src');
    p.sources.set(id, { id, kind: 'disk', file, length, peaks, bucket, label, meta });
    return id;
}

export const isDisk = (src) => !!src && src.kind === 'disk';
export const srcLength = (src) => (!src ? 0 : (src.pcm ? src.pcm.length : src.length || 0));

export function diskFiles(p) {
    const out = new Set();
    for (const s of p.sources.values()) if (isDisk(s)) out.add(s.file);
    return out;
}

export function usesDisk(p) {
    for (const t of p.tracks) for (const c of t.clips) if (isDisk(p.sources.get(c.sourceId))) return true;
    return false;
}

export function makeClip(sourceId, start, length, extra = {}) {
    return { id: newId('clip'), sourceId, start, offset: 0, length, gainDb: 0, fadeIn: 0, fadeOut: 0, label: '', text: '', effects: [], outLen: null, ...extra };
}

export function addTrack(p, role = 'voice', name, index = p.tracks.length) {
    const t = makeTrack(role, name);
    p.tracks.splice(Math.max(0, Math.min(index, p.tracks.length)), 0, t);
    return t;
}

export function removeTrack(p, trackId) {
    const i = p.tracks.findIndex((t) => t.id === trackId);
    if (i < 0) return null;
    return p.tracks.splice(i, 1)[0];
}

export function moveTrack(p, trackId, toIndex) {
    const i = p.tracks.findIndex((t) => t.id === trackId);
    if (i < 0) return false;
    const [t] = p.tracks.splice(i, 1);
    p.tracks.splice(Math.max(0, Math.min(toIndex, p.tracks.length)), 0, t);
    return true;
}

function overlaps(a, b) {
    return a.start < clipEnd(b) && b.start < clipEnd(a);
}

export function resolveOverlap(t, clip) {
    let guard = 0;
    let moved = true;
    while (moved && guard++ < 10000) {
        moved = false;
        for (const o of t.clips) {
            if (o === clip || o.id === clip.id) continue;
            if (overlaps(o, clip)) {
                clip.start = clipEnd(o);
                moved = true;
            }
        }
    }
    sortClips(t);
    return clip.start;
}

export function appendClip(p, trackId, sourceId, extra = {}) {
    const t = findTrack(p, trackId);
    const src = p.sources.get(sourceId);
    if (!t || !src) return null;
    const c = makeClip(sourceId, trackEnd(t), srcLength(src), extra);
    t.clips.push(c);
    sortClips(t);
    return c;
}

export function placeClip(p, trackId, clip) {
    const t = findTrack(p, trackId);
    if (!t) return null;
    t.clips.push(clip);
    resolveOverlap(t, clip);
    return clip;
}

export function moveClip(p, clipId, newStart, newTrackId) {
    const f = findClip(p, clipId);
    if (!f) return null;
    const dest = newTrackId ? findTrack(p, newTrackId) : f.track;
    if (!dest) return null;
    f.track.clips.splice(f.index, 1);
    f.clip.start = Math.max(0, Math.round(newStart));
    dest.clips.push(f.clip);
    resolveOverlap(dest, f.clip);
    return f.clip;
}

export function trimClip(p, clipId, edge, at, minLen = 1) {
    const f = findClip(p, clipId);
    if (!f) return null;
    const c = f.clip;
    const src = p.sources.get(c.sourceId);
    const srcLen = src ? srcLength(src) : c.offset + c.length;
    at = Math.round(at);
    let lo = 0, hi = Infinity;
    for (const o of f.track.clips) {
        if (o === c) continue;
        if (clipEnd(o) <= c.start && clipEnd(o) > lo) lo = clipEnd(o);
        if (o.start >= clipEnd(c) && o.start < hi) hi = o.start;
    }
    const r = fxRatio(c);
    const fxLen = hasFx(c) && c.outLen > 0;
    if (edge === 'start') {
        const end = clipEnd(c);
        let s = Math.max(at, c.start - Math.round(c.offset / r), lo, 0);
        s = Math.min(s, end - minLen);
        const cut = r === 1 ? s - c.start : Math.round((s - c.start) * r);
        c.offset += cut;
        c.length -= cut;
        if (fxLen) c.outLen = end - s;
        c.start = s;
    } else {
        let e = Math.min(at, c.start + Math.round((srcLen - c.offset) / r), hi);
        e = Math.max(e, c.start + minLen);
        c.length = r === 1 ? e - c.start : Math.max(1, Math.min(srcLen - c.offset, Math.round((e - c.start) * r)));
        if (fxLen) c.outLen = e - c.start;
    }
    return clampFades(c);
}

export function splitClip(p, clipId, at) {
    const f = findClip(p, clipId);
    if (!f) return null;
    const c = f.clip;
    at = Math.round(at);
    if (at <= c.start || at >= clipEnd(c)) return null;
    const right = subClip(c, at, clipEnd(c));
    if (c.outLen > 0 && hasFx(c)) c.outLen = at - c.start;
    c.length = right.offset - c.offset;
    c.fadeOut = 0;
    clampFades(c);
    f.track.clips.push(right);
    sortClips(f.track);
    return right;
}

export function setRenderedLength(p, clipId, outLen) {
    const f = findClip(p, clipId);
    if (!f || !(outLen > 0) || f.clip.outLen === outLen) return false;
    const c = f.clip;
    c.outLen = outLen;
    let edge = clipEnd(c);
    for (const o of f.track.clips) {
        if (o === c || o.start < c.start) continue;
        if (o.start < edge) o.start = edge;
        edge = Math.max(edge, clipEnd(o));
    }
    sortClips(f.track);
    return true;
}

export function replaceClipAudio(p, clipId, sourceId, length) {
    const f = findClip(p, clipId);
    if (!f) return null;
    const c = f.clip;
    c.sourceId = sourceId;
    c.offset = 0;
    c.length = length;
    c.outLen = null;
    clampFades(c);
    let edge = clipEnd(c);
    for (const o of f.track.clips) {
        if (o === c || o.start < c.start) continue;
        if (o.start < edge) o.start = edge;
        edge = Math.max(edge, clipEnd(o));
    }
    sortClips(f.track);
    return c;
}

export function layoutAlert(p, gaps) {
    const order = ['header', 'attn', 'voice', 'eom'];
    const groups = order.map((role) => p.tracks.filter((t) => t.role === role).flatMap((t) => t.clips));
    const all = groups.flat();
    if (!all.length) return 0;
    let cursor = Math.min(...all.map((c) => c.start));
    let first = true, moved = 0;
    order.forEach((role, i) => {
        const cs = groups[i];
        if (!cs.length) return;
        if (!first) cursor += Math.max(0, Math.round(gaps[role] || 0));
        const delta = cursor - Math.min(...cs.map((c) => c.start));
        let end = cursor;
        for (const c of cs) {
            if (delta) {
                c.start += delta;
                moved++;
            }
            end = Math.max(end, clipEnd(c));
        }
        cursor = end;
        first = false;
    });
    for (const t of p.tracks) sortClips(t);
    return moved;
}

export function splitTracksAt(p, trackIds, at) {
    const made = [];
    for (const t of p.tracks) {
        if (trackIds && !trackIds.includes(t.id)) continue;
        for (const c of [...t.clips]) {
            const r = splitClip(p, c.id, at);
            if (r) made.push(r);
        }
    }
    return made;
}

export function deleteClip(p, clipId, ripple = false) {
    const f = findClip(p, clipId);
    if (!f) return null;
    f.track.clips.splice(f.index, 1);
    if (ripple) {
        for (const o of f.track.clips) if (o.start >= clipEnd(f.clip)) o.start -= clipSpan(f.clip);
    }
    return f.clip;
}

export function duplicateClip(p, clipId) {
    const f = findClip(p, clipId);
    if (!f) return null;
    const copy = { ...f.clip, effects: cloneFx(f.clip.effects), id: newId('clip'), start: clipEnd(f.clip) };
    f.track.clips.push(copy);
    resolveOverlap(f.track, copy);
    return copy;
}

export function deleteRange(p, trackIds, a, b, ripple = true) {
    a = Math.round(a);
    b = Math.round(b);
    if (b <= a) return 0;
    let touched = 0;
    for (const t of p.tracks) {
        if (trackIds && !trackIds.includes(t.id)) continue;
        for (const c of [...t.clips]) {
            if (c.start < a && clipEnd(c) > a) splitClip(p, c.id, a);
        }
        for (const c of [...t.clips]) {
            if (c.start < b && clipEnd(c) > b) splitClip(p, c.id, b);
        }
        const keep = [];
        for (const c of t.clips) {
            if (c.start >= a && clipEnd(c) <= b) { touched++; continue; }
            keep.push(c);
        }
        t.clips = keep;
        if (ripple) for (const c of t.clips) if (c.start >= b) c.start -= b - a;
        sortClips(t);
    }
    return touched;
}

export function copyRange(p, trackIds, a, b) {
    a = Math.round(a);
    b = Math.round(b);
    if (b <= a) return null;
    const tracks = [];
    for (const t of p.tracks) {
        if (trackIds && !trackIds.includes(t.id)) continue;
        const clips = [];
        for (const c of t.clips) {
            const s = Math.max(a, c.start), e = Math.min(b, clipEnd(c));
            if (e <= s) continue;
            const sub = subClip(c, s, e);
            sub.start = s - a;
            clips.push(sub);
        }
        tracks.push({ role: t.role, name: t.name, clips });
    }
    return { length: b - a, tracks };
}

export function pasteAt(p, trackIds, at, clip, ripple = true) {
    if (!clip || !clip.tracks.length) return [];
    at = Math.round(at);
    const targets = trackIds && trackIds.length ? trackIds.map((id) => findTrack(p, id)).filter(Boolean) : [];
    while (targets.length < clip.tracks.length) {
        const src = clip.tracks[targets.length];
        const last = targets.length ? p.tracks.indexOf(targets[targets.length - 1]) + 1 : p.tracks.length;
        const used = new Set(targets.map((x) => x.id));
        const next = p.tracks.slice(last).find((x) => !used.has(x.id));
        targets.push(next || addTrack(p, src.role, src.name));
    }
    const made = [];
    clip.tracks.forEach((ct, i) => {
        const t = targets[i];
        if (ripple) {
            for (const c of [...t.clips]) if (c.start < at && clipEnd(c) > at) splitClip(p, c.id, at);
            for (const c of t.clips) if (c.start >= at) c.start += clip.length;
        }
        for (const c of ct.clips) {
            const nc = { ...c, effects: cloneFx(c.effects), id: newId('clip'), start: at + c.start };
            t.clips.push(nc);
            if (!ripple) resolveOverlap(t, nc);
            made.push(nc);
        }
        sortClips(t);
    });
    return made;
}

export function insertSilence(p, trackIds, at, length) {
    if (length <= 0) return;
    for (const t of p.tracks) {
        if (trackIds && !trackIds.includes(t.id)) continue;
        for (const c of [...t.clips]) if (c.start < at && clipEnd(c) > at) splitClip(p, c.id, at);
        for (const c of t.clips) if (c.start >= at) c.start += length;
    }
}

export const dbToGain = (db) => Math.pow(10, (db || 0) / 20);

export function audibleTracks(p) {
    const anySolo = p.tracks.some((t) => t.solo);
    return p.tracks.filter((t) => !t.mute && (!anySolo || t.solo));
}

export const isPanned = (p) => audibleTracks(p).some((t) => clampPan(t.pan) !== 0);

export function clipAudio(p, c, resolve) {
    if (hasFx(c) && resolve && resolve.clip) {
        const r = resolve.clip(c);
        if (r) return { pcm: r, base: 0, len: Math.min(r.length, clipSpan(c)), rendered: true };
    }
    const src = p.sources.get(c.sourceId);
    if (!src) return null;
    const len = Math.min(c.length, clipSpan(c));
    if (isDisk(src)) {
        const got = resolve && resolve.source ? resolve.source(c, src) : null;
        if (got) return { pcm: got.pcm, base: c.offset - got.offset, len, rendered: false };
        return { pcm: null, peakSource: src, base: c.offset, len, rendered: false };
    }
    return { pcm: src.pcm, base: c.offset, len, rendered: false };
}

function addClips(p, t, out, from, to, tg, resolve) {
    for (const c of t.clips) {
        const a = clipAudio(p, c, resolve);
        if (!a || !a.pcm) continue;
        const s = Math.max(from, c.start), e = Math.min(to, c.start + a.len);
        if (e <= s) continue;
        const g = tg * dbToGain(c.gainDb);
        const pcm = a.pcm;
        const srcBase = a.base + (s - c.start);
        const dst = s - from;
        const len = e - s;
        const span = clipSpan(c);
        const fi = Math.min(c.fadeIn || 0, span), fo = Math.min(c.fadeOut || 0, span);
        if (fi > 0 || fo > 0) {
            const pos0 = s - c.start;
            for (let i = 0; i < len; i++) {
                const pos = pos0 + i;
                let env = 1;
                if (pos < fi) env = pos / fi;
                const rem = span - pos;
                if (rem < fo) env = Math.min(env, rem / fo);
                out[dst + i] += (pcm[srcBase + i] || 0) * g * env;
            }
        } else if (g === 1) {
            for (let i = 0; i < len; i++) out[dst + i] += pcm[srcBase + i] || 0;
        } else {
            for (let i = 0; i < len; i++) out[dst + i] += (pcm[srcBase + i] || 0) * g;
        }
    }
}

export function trackBus(p, t, resolve) {
    const bus = new Float32Array(trackEnd(t));
    addClips(p, t, bus, 0, bus.length, 1, resolve);
    return bus;
}

export function mixdown(p, from = 0, to = projectLength(p), resolve = null) {
    const n = Math.max(0, to - from);
    const out = new Float32Array(n);
    if (!n) return out;
    const side = resolve && resolve.side;
    for (const t of audibleTracks(p)) {
        const tg = side ? dbToGain(t.gainDb) * panGain(t.pan, side) : dbToGain(t.gainDb);
        if (tg === 0) continue;
        const fx = hasFx(t) && resolve && resolve.track ? resolve.track(t) : null;
        if (!fx) {
            addClips(p, t, out, from, to, tg, resolve);
            continue;
        }
        const e = Math.min(to, fx.length);
        for (let i = from; i < e; i++) out[i - from] += fx[i] * tg;
    }
    return out;
}

const copyTracks = (tracks) => tracks.map((t) => ({
    ...t,
    effects: cloneFx(t.effects),
    clips: t.clips.map((c) => ({ ...c, effects: cloneFx(c.effects) })),
}));

export function snapshot(p) {
    return {
        tracks: copyTracks(p.tracks),
        markers: p.markers.map((m) => ({ ...m })),
        master: cloneJson(p.master),
    };
}

export function restoreSnapshot(p, s) {
    p.tracks = copyTracks(s.tracks);
    p.markers = s.markers.map((m) => ({ ...m }));
    p.master = cloneJson(s.master);
}

export function createHistory(limit = 200) {
    const undo = [], redo = [];
    return {
        push(p, label) {
            undo.push({ label, snap: snapshot(p) });
            if (undo.length > limit) undo.shift();
            redo.length = 0;
        },
        undo(p) {
            const e = undo.pop();
            if (!e) return null;
            redo.push({ label: e.label, snap: snapshot(p) });
            restoreSnapshot(p, e.snap);
            return e.label;
        },
        redo(p) {
            const e = redo.pop();
            if (!e) return null;
            undo.push({ label: e.label, snap: snapshot(p) });
            restoreSnapshot(p, e.snap);
            return e.label;
        },
        drop() { undo.pop(); },
        canUndo: () => undo.length > 0,
        canRedo: () => redo.length > 0,
        undoLabel: () => (undo.length ? undo[undo.length - 1].label : ''),
        redoLabel: () => (redo.length ? redo[redo.length - 1].label : ''),
        clear() { undo.length = 0; redo.length = 0; },
        referencedSources() {
            const ids = new Set();
            for (const e of [...undo, ...redo]) for (const t of e.snap.tracks) for (const c of t.clips) ids.add(c.sourceId);
            return ids;
        },
    };
}

export function referencedSourceIds(p) {
    const ids = new Set();
    for (const t of p.tracks) for (const c of t.clips) ids.add(c.sourceId);
    return ids;
}

export function gcSources(p, keep = new Set()) {
    const live = referencedSourceIds(p);
    let removed = 0;
    for (const id of [...p.sources.keys()]) {
        if (!live.has(id) && !keep.has(id)) {
            p.sources.delete(id);
            removed++;
        }
    }
    return removed;
}

export function serialize(p) {
    const live = referencedSourceIds(p);
    const sources = [];
    for (const [id, s] of p.sources) {
        if (!live.has(id)) continue;
        if (isDisk(s)) {
            sources.push({ id, kind: 'disk', label: s.label || '', meta: s.meta || null, file: s.file, length: s.length, bucket: s.bucket, peaks: s.peaks.buffer.slice(s.peaks.byteOffset, s.peaks.byteOffset + s.peaks.byteLength) });
            continue;
        }
        sources.push({ id, label: s.label || '', meta: s.meta || null, pcm: s.pcm.buffer.slice(s.pcm.byteOffset, s.pcm.byteOffset + s.pcm.byteLength) });
    }
    return {
        version: 3,
        sampleRate: p.sampleRate,
        tracks: snapshot(p).tracks,
        markers: p.markers.map((m) => ({ ...m })),
        master: cloneJson(p.master),
        sources,
    };
}

export function deserialize(data) {
    const p = createProject(data.sampleRate || 44100);
    for (const s of data.sources || []) {
        if (s.kind === 'disk') {
            p.sources.set(s.id, { id: s.id, kind: 'disk', label: s.label || '', meta: s.meta || null, file: s.file, length: s.length, bucket: s.bucket, peaks: new Float32Array(s.peaks) });
            continue;
        }
        p.sources.set(s.id, { id: s.id, label: s.label || '', meta: s.meta || null, pcm: new Float32Array(s.pcm) });
    }
    p.tracks = (data.tracks || []).map((t) => ({
        ...makeTrack(t.role, t.name),
        ...t,
        effects: cloneFx(t.effects),
        clips: (t.clips || []).map((c) => ({ gainDb: 0, offset: 0, fadeIn: 0, fadeOut: 0, label: '', text: '', outLen: null, ...c, effects: cloneFx(c.effects) })),
    }));
    p.markers = (data.markers || []).map((m) => ({ ...m }));
    p.master = cloneJson(data.master);
    for (const t of p.tracks) {
        t.clips = t.clips.filter((c) => p.sources.has(c.sourceId));
        sortClips(t);
    }
    return p;
}

export function migrateV2(payload) {
    const p = createProject(payload.sampleRate || 44100);
    const t = addTrack(p, 'voice', 'Voice');
    for (const seg of payload.segments || []) {
        const pcm = seg.pcm instanceof Float32Array ? seg.pcm : new Float32Array(seg.pcm);
        if (!pcm.length) continue;
        const sid = addSource(p, pcm, seg.label || 'Segment');
        appendClip(p, t.id, sid, { label: seg.label || 'Segment', text: seg.sourceText || '' });
    }
    return p;
}
