import { describe, expect, it } from 'vitest';
import * as model from '../assets/js/splicer/model.js';

function projectWithClip(pcm = [1, 0.5, -0.5, -1]) {
    const project = model.createProject(8000);
    const track = model.addTrack(project, 'voice', 'Voice');
    const sourceId = model.addSource(project, new Float32Array(pcm), 'sample');
    const clip = model.appendClip(project, track.id, sourceId);
    return { project, track, sourceId, clip };
}

describe('splicer project model', () => {
    it('creates, finds, orders, moves, and removes tracks', () => {
        const p = model.createProject(48000);
        const a = model.addTrack(p, 'bogus', '', -5);
        const b = model.addTrack(p, 'bed', 'Bed');
        expect(p.sampleRate).toBe(48000);
        expect(a.role).toBe('free');
        expect(a.name).toBe('Audio');
        expect(model.findTrack(p, b.id)).toBe(b);
        expect(model.findTrack(p, 'missing')).toBeNull();
        expect(model.moveTrack(p, b.id, -1)).toBe(true);
        expect(p.tracks[0]).toBe(b);
        expect(model.moveTrack(p, 'missing', 1)).toBe(false);
        expect(model.removeTrack(p, a.id)).toBe(a);
        expect(model.removeTrack(p, 'missing')).toBeNull();
    });

    it('normalizes pan, effects, spans, fades, and clip subdivision', () => {
        expect(model.clampPan(2)).toBe(1);
        expect(model.clampPan(-2)).toBe(-1);
        expect(model.clampPan('nope')).toBe(0);
        expect(model.panGain(0.25, 'L')).toBe(0.75);
        expect(model.panGain(-0.25, 'R')).toBe(0.75);
        expect(model.panGain(0, 'X')).toBe(1);
        const c = model.makeClip('s', 10, 100, { effects: [{ type: 'x' }], outLen: 50, offset: 5, fadeIn: 20, fadeOut: 20 });
        expect(model.hasFx(c)).toBe(true);
        expect(model.clipSpan(c)).toBe(50);
        expect(model.clipEnd(c)).toBe(60);
        const sub = model.subClip(c, 20, 50);
        expect(sub).toMatchObject({ start: 20, offset: 25, length: 60, outLen: 30, fadeIn: 0, fadeOut: 0 });
        expect(sub.effects).not.toBe(c.effects);
        expect(model.clampFades({ ...c, fadeIn: 99, fadeOut: 99 })).toMatchObject({ fadeIn: 50, fadeOut: 0 });
        expect(model.cloneFx(null)).toEqual([]);
        expect(model.hasFx({ effects: [{ bypass: true }] })).toBe(false);
    });

    it('manages memory and disk sources', () => {
        const p = model.createProject();
        const sid = model.addSource(p, new Float32Array([1, 2]), 'memory', { kind: 'test' });
        const file = { name: 'clip.wav' };
        const did = model.addDiskSource(p, { file, length: 10, peaks: new Float32Array([0, 1]), bucket: 5 }, 'disk');
        expect(model.srcLength(p.sources.get(sid))).toBe(2);
        expect(model.srcLength(p.sources.get(did))).toBe(10);
        expect(model.srcLength(null)).toBe(0);
        expect(model.isDisk(p.sources.get(did))).toBe(true);
        expect(model.diskFiles(p)).toEqual(new Set([file]));
        expect(model.usesDisk(p)).toBe(false);
        const t = model.addTrack(p);
        model.appendClip(p, t.id, did);
        expect(model.usesDisk(p)).toBe(true);
        expect(model.appendClip(p, 'missing', did)).toBeNull();
        expect(model.appendClip(p, t.id, 'missing')).toBeNull();
    });

    it('places and moves clips without overlaps', () => {
        const { project: p, track: a, sourceId, clip: first } = projectWithClip();
        const second = model.placeClip(p, a.id, model.makeClip(sourceId, 2, 4));
        expect(second.start).toBe(4);
        expect(model.trackEnd(a)).toBe(8);
        expect(model.projectLength(p)).toBe(8);
        expect(model.findClip(p, first.id)?.clip).toBe(first);
        expect(model.findClip(p, 'missing')).toBeNull();
        expect(model.placeClip(p, 'missing', model.makeClip(sourceId, 0, 1))).toBeNull();
        const b = model.addTrack(p);
        expect(model.moveClip(p, second.id, -10, b.id)?.start).toBe(0);
        expect(model.moveClip(p, 'missing', 0)).toBeNull();
        expect(model.moveClip(p, first.id, 0, 'missing')).toBeNull();
        const sameStart = model.makeClip(sourceId, 0, 1, { id: 'aaa' });
        a.clips.push(sameStart);
        model.sortClips(a);
        expect(a.clips[0].id).toBe('aaa');
    });

    it('trims, splits, resizes, duplicates, and replaces clips', () => {
        const { project: p, track, sourceId, clip } = projectWithClip([0, 1, 2, 3, 4, 5, 6, 7]);
        clip.fadeIn = 2;
        clip.fadeOut = 2;
        expect(model.trimClip(p, clip.id, 'start', 2)).toMatchObject({ start: 2, offset: 2, length: 6 });
        expect(model.trimClip(p, clip.id, 'end', 6)).toMatchObject({ length: 4 });
        const right = model.splitClip(p, clip.id, 4);
        expect(right).toMatchObject({ start: 4, offset: 4, length: 2 });
        expect(model.splitClip(p, clip.id, clip.start)).toBeNull();
        expect(model.splitClip(p, 'missing', 1)).toBeNull();
        right.effects = [{ type: 'fx' }];
        right.outLen = 2;
        expect(model.setRenderedLength(p, right.id, 4)).toBe(true);
        expect(model.setRenderedLength(p, right.id, 4)).toBe(false);
        expect(model.setRenderedLength(p, 'missing', 4)).toBe(false);
        expect(model.replaceClipAudio(p, right.id, sourceId, 3)).toMatchObject({ offset: 0, length: 3, outLen: null });
        expect(model.replaceClipAudio(p, 'missing', sourceId, 1)).toBeNull();
        const copy = model.duplicateClip(p, right.id);
        expect(copy.id).not.toBe(right.id);
        expect(model.duplicateClip(p, 'missing')).toBeNull();
        expect(track.clips).toHaveLength(3);
    });

    it('lays out alerts and edits ranges across tracks', () => {
        const p = model.createProject();
        const roles = ['header', 'attn', 'voice', 'eom'];
        const tracks = roles.map((role) => model.addTrack(p, role));
        const sid = model.addSource(p, new Float32Array(10));
        const clips = tracks.map((t, i) => model.placeClip(p, t.id, model.makeClip(sid, i * 2, 10)));
        expect(model.layoutAlert(p, { attn: 2, voice: 3, eom: 4 })).toBeGreaterThan(0);
        expect(clips.map((c) => c.start)).toEqual([0, 12, 25, 39]);
        expect(model.splitTracksAt(p, null, 5)).toHaveLength(1);
        expect(model.copyRange(p, null, 10, 10)).toBeNull();
        const copied = model.copyRange(p, [tracks[1].id], 12, 18);
        expect(copied).toMatchObject({ length: 6 });
        expect(copied.tracks[0].clips[0].start).toBe(0);
        expect(model.deleteRange(p, null, 10, 10)).toBe(0);
        expect(model.deleteRange(p, [tracks[1].id], 13, 17, true)).toBe(1);
        model.insertSilence(p, [tracks[2].id], 27, 3);
        expect(tracks[2].clips.some((c) => c.start >= 30)).toBe(true);
        expect(model.insertSilence(p, null, 0, 0)).toBeUndefined();
    });

    it('copies, pastes, deletes, and ripples clips', () => {
        const { project: p, track, clip } = projectWithClip([1, 2, 3, 4, 5, 6]);
        const copied = model.copyRange(p, [track.id], 1, 5);
        const made = model.pasteAt(p, [track.id], 2, copied, true);
        expect(made).toHaveLength(1);
        expect(model.pasteAt(p, [], 0, null)).toEqual([]);
        const newTrackPaste = model.pasteAt(p, [], 20, { length: 2, tracks: [{ role: 'voice', name: 'new', clips: [model.makeClip(clip.sourceId, 0, 2)] }] }, false);
        expect(newTrackPaste).toHaveLength(1);
        expect(model.deleteClip(p, 'missing')).toBeNull();
        const removed = model.deleteClip(p, made[0].id, true);
        expect(removed).not.toBeNull();
    });

    it('mixes clips with fades, gains, pan, disk resolution, and effects', () => {
        const { project: p, track, clip } = projectWithClip([1, 1, 1, 1]);
        clip.fadeIn = 2;
        clip.fadeOut = 2;
        clip.gainDb = -6;
        track.gainDb = -6;
        track.pan = 1;
        expect(model.dbToGain(-6)).toBeCloseTo(0.501, 2);
        expect([...model.trackBus(p, track)]).toHaveLength(4);
        expect([...model.mixdown(p, 0, 4, { side: 'L' })]).toEqual([0, 0, 0, 0]);
        expect(model.isPanned(p)).toBe(true);
        track.mute = true;
        expect(model.audibleTracks(p)).toEqual([]);
        track.mute = false;
        track.effects = [{ type: 'fx' }];
        expect([...model.mixdown(p, 0, 4, { track: () => new Float32Array([1, 2, 3, 4]) })][1]).toBeGreaterThan(0);
        expect(model.mixdown(p, 2, 2)).toHaveLength(0);

        const disk = model.addDiskSource(p, { file: {}, length: 4, peaks: new Float32Array([0, 1]), bucket: 2 });
        const diskClip = model.makeClip(disk, 0, 4);
        expect(model.clipAudio(p, diskClip)).toMatchObject({ pcm: null, base: 0, len: 4, rendered: false });
        expect(model.clipAudio(p, diskClip, { source: () => ({ pcm: new Float32Array([1, 2]), offset: 0 }) })).toMatchObject({ base: 0 });
        clip.effects = [{ type: 'fx' }];
        clip.outLen = 2;
        expect(model.clipAudio(p, clip, { clip: () => new Float32Array([3, 4]) })).toMatchObject({ rendered: true, len: 2 });
        expect(model.clipAudio(p, { ...clip, sourceId: 'missing', effects: [] })).toBeNull();
    });

    it('snapshots, restores, histories, serializes, and collects sources', () => {
        const { project: p, track, sourceId } = projectWithClip();
        p.markers.push({ at: 1 });
        p.master = { effects: [{ type: 'limiter' }] };
        const snap = model.snapshot(p);
        track.name = 'changed';
        model.restoreSnapshot(p, snap);
        expect(p.tracks[0].name).toBe('Voice');
        expect(model.cloneJson(undefined)).toBeNull();
        expect(model.sameJson(undefined, null)).toBe(true);

        const history = model.createHistory(1);
        expect(history.undo(p)).toBeNull();
        history.push(p, 'before');
        p.tracks[0].name = 'after';
        expect(history.canUndo()).toBe(true);
        expect(history.undoLabel()).toBe('before');
        expect(history.undo(p)).toBe('before');
        expect(history.redoLabel()).toBe('before');
        expect(history.redo(p)).toBe('before');
        history.push(p, 'drop');
        history.drop();
        expect(history.referencedSources()).toBeInstanceOf(Set);
        history.clear();
        expect(history.canRedo()).toBe(false);

        const data = model.serialize(p);
        const restored = model.deserialize(data);
        expect(restored.sampleRate).toBe(p.sampleRate);
        expect(restored.sources.get(sourceId).pcm).toEqual(p.sources.get(sourceId).pcm);
        const orphan = model.addSource(restored, new Float32Array([9]));
        expect(model.gcSources(restored)).toBe(1);
        expect(restored.sources.has(orphan)).toBe(false);
        expect(model.referencedSourceIds(restored)).toEqual(new Set([sourceId]));
    });

    it('round-trips disk sources, filters missing clips, and migrates v2 projects', () => {
        const p = model.createProject();
        const t = model.addTrack(p);
        const file = { name: 'disk.wav' };
        const sid = model.addDiskSource(p, { file, length: 4, peaks: new Float32Array([-1, 1]), bucket: 2 });
        model.appendClip(p, t.id, sid);
        const data = model.serialize(p);
        data.tracks[0].clips.push(model.makeClip('missing', 10, 1));
        const restored = model.deserialize(data);
        expect(model.isDisk(restored.sources.get(sid))).toBe(true);
        expect(restored.tracks[0].clips).toHaveLength(1);
        const migrated = model.migrateV2({ sampleRate: 8000, segments: [{ pcm: [1, 2], label: 'one', sourceText: 'hello' }, { pcm: [], label: 'empty' }] });
        expect(migrated.sampleRate).toBe(8000);
        expect(migrated.tracks[0].clips).toHaveLength(1);
    });

    it('covers boundary and no-op branches without changing project invariants', () => {
        expect(model.panGain(-0.5, 'L')).toBe(1);
        expect(model.panGain(0.5, 'R')).toBe(1);
        expect(model.srcLength({})).toBe(0);
        expect(model.dbToGain(0)).toBe(1);
        const empty = model.createProject();
        expect(model.layoutAlert(empty, {})).toBe(0);
        const onlyVoice = model.addTrack(empty, 'voice');
        const voiceSource = model.addSource(empty, new Float32Array([1, 0, 1, 0]));
        const voiceClip = model.appendClip(empty, onlyVoice.id, voiceSource);
        expect(model.layoutAlert(empty, {})).toBe(0);
        expect(model.moveClip(empty, voiceClip.id, 1)).toBe(voiceClip);
        expect(model.trimClip(empty, 'missing', 'start', 0)).toBeNull();

        const neighbor = model.makeClip(voiceSource, 0, 1);
        onlyVoice.clips.push(neighbor);
        voiceClip.start = 2;
        voiceClip.offset = 2;
        voiceClip.effects = [{ type: 'stretch' }];
        voiceClip.outLen = 2;
        empty.sources.delete(voiceSource);
        expect(model.trimClip(empty, voiceClip.id, 'start', 1, 1).start).toBe(1);
        expect(model.trimClip(empty, voiceClip.id, 'end', 10, 1).outLen).toBeGreaterThan(0);
        expect(model.splitClip(empty, voiceClip.id, 2)?.outLen).toBe(2);
    });

    it('exercises selective and non-ripple editing branches', () => {
        const { project: p, track, sourceId, clip } = projectWithClip([1, 2, 3, 4, 5, 6]);
        const skipped = model.addTrack(p);
        expect(model.splitTracksAt(p, [skipped.id], 2)).toEqual([]);
        expect(model.deleteRange(p, [skipped.id], 1, 2, false)).toBe(0);
        expect(model.copyRange(p, [track.id], 20, 30).tracks[0].clips).toEqual([]);
        const later = model.makeClip(sourceId, 10, 2);
        track.clips.push(later);
        expect(model.deleteClip(p, clip.id, false)).toBe(clip);
        expect(later.start).toBe(10);

        const t2 = model.addTrack(p, 'bed');
        const payload = {
            length: 2,
            tracks: [
                { role: 'voice', name: 'a', clips: [model.makeClip(sourceId, 0, 1)] },
                { role: 'bed', name: 'b', clips: [model.makeClip(sourceId, 0, 1)] },
            ],
        };
        const made = model.pasteAt(p, [track.id], 1, payload, false);
        expect(made).toHaveLength(2);
        expect(p.tracks).toContain(t2);
    });

    it('mixes ordinary, gained, silent, soloed, and unresolved clip paths', () => {
        const { project: p, sourceId, clip } = projectWithClip([1, 0, 1, 0]);
        expect([...model.mixdown(p)]).toEqual([1, 0, 1, 0]);
        clip.gainDb = -6;
        expect(model.mixdown(p)[0]).toBeCloseTo(0.501, 2);
        clip.start = 10;
        expect([...model.mixdown(p, 0, 4)]).toEqual([0, 0, 0, 0]);
        clip.start = 0;
        p.sources.delete(sourceId);
        expect([...model.mixdown(p, 0, 4)]).toEqual([0, 0, 0, 0]);
        p.sources.set(sourceId, { id: sourceId, pcm: new Float32Array([1]) });
        clip.gainDb = 0;
        expect([...model.mixdown(p, 0, 4)]).toEqual([1, 0, 0, 0]);
        const other = model.addTrack(p);
        other.solo = true;
        expect(model.audibleTracks(p)).toEqual([other]);
        other.mute = true;
        expect(model.audibleTracks(p)).toEqual([]);
    });

    it('handles empty/default persistence and history branches', () => {
        const p = model.deserialize({});
        expect(p.sampleRate).toBe(44100);
        expect(p.tracks).toEqual([]);
        const sid = model.addSource(p, new Float32Array([1]));
        const kept = model.addSource(p, new Float32Array([2]));
        const t = model.addTrack(p);
        model.appendClip(p, t.id, sid);
        expect(model.gcSources(p, new Set([kept]))).toBe(0);
        expect(model.serialize(p).sources).toHaveLength(1);

        const history = model.createHistory();
        expect(history.undoLabel()).toBe('');
        expect(history.redoLabel()).toBe('');
        expect(history.redo(p)).toBeNull();
        history.push(p, 'state');
        expect(history.referencedSources()).toEqual(new Set([sid]));

        const migrated = model.migrateV2({ segments: [{ pcm: new Float32Array([1]), sourceText: '' }, { pcm: [] }] });
        expect(migrated.sampleRate).toBe(44100);
        expect(migrated.tracks[0].clips[0].label).toBe('Segment');
    });
});
