import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { lexiconFromSet, validatePronunciationSet } from '../assets/js/nwr-pronunciation.js';
import { DEFAULT_DIR, applyBundle, buildIndex, formatIndex, formatSet, listSetFiles, main, setPath } from '../tools/sync-nwr-pronunciation.mjs';

const read = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const registry = read(path.join(DEFAULT_DIR, 'transmitters.json'));
const national = read(path.join(DEFAULT_DIR, 'national.json'));
const temps = [];

function tempDir() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nwr-pron-'));
    temps.push(dir);
    fs.copyFileSync(path.join(DEFAULT_DIR, 'transmitters.json'), path.join(dir, 'transmitters.json'));
    return dir;
}

afterEach(() => {
    while (temps.length) fs.rmSync(temps.pop(), { recursive: true, force: true });
});

const lot = (rev = 1, text = 'Illynois') => ({
    schemaVersion: 1, id: 'wfo/LOT', scope: { type: 'wfo', id: 'LOT' }, rev, voices: ['paul'],
    entries: [{ id: 'illinois', match: 'Illinois', replace: { kind: 'respell', text } }],
});

describe('shipped pronunciation sets', () => {
    it('all validate against the transmitter registry and index.json is current', () => {
        const { problems, index } = buildIndex(DEFAULT_DIR);
        expect(problems).toEqual([]);
        expect(fs.readFileSync(path.join(DEFAULT_DIR, 'index.json'), 'utf8')).toBe(formatIndex(index));
        expect(Object.keys(index.sets)).toContain('national');
        for (const id of listSetFiles(DEFAULT_DIR)) {
            const set = read(setPath(DEFAULT_DIR, id));
            expect(validatePronunciationSet(set, registry).problems, id).toEqual([]);
            expect(fs.readFileSync(setPath(DEFAULT_DIR, id), 'utf8'), id).toBe(formatSet(set));
        }
    });

    it('keeps every converter national override', () => {
        const fromConverter = national.entries.filter((e) => e.sources?.some((s) => s.source === 'eastools-converter'));
        expect(fromConverter).toHaveLength(71);
        const lexicon = lexiconFromSet(national);
        expect(lexicon.thunderstorm).toBe('TH AH1 N D ER0 S T OW0 R M');
        expect(lexicon['wind down']).toBe('W AY2 N D');
        expect(lexicon['near-zero']).toBe('N IY0 R Z IY0 R OW0');
        expect(national.entries.find((e) => e.match === 'wind down').replace.on).toBe('wind');
    });

    it('carries the defaults and the transmitter speeds from the guide', () => {
        expect(national.prosody.commaPauseMs.value).toBe(200);
        expect(national.prosody.periodPauseMs.value).toBe(900);
        expect(read(setPath(DEFAULT_DIR, 'tx/WNG570')).prosody.speed.value).toBe(93);
        expect(read(setPath(DEFAULT_DIR, 'tx/WNG570')).scope.wfo).toBe('LMK');
        expect(read(setPath(DEFAULT_DIR, 'wfo/LOT')).prosody.speed.value).toBe(113);
        expect(read(setPath(DEFAULT_DIR, 'wfo/FSD')).prosody.speed.verified).toBe(false);
        expect(read(setPath(DEFAULT_DIR, 'wfo/JAX')).prosody.periodPauseMs.value).toBe(925);
    });
});

describe('sync tool', () => {
    it('applies a backend bundle, prunes, and reindexes', async () => {
        const dir = tempDir();
        fs.mkdirSync(path.join(dir, 'wfo'));
        fs.writeFileSync(setPath(dir, 'wfo/IND'), formatSet({ ...lot(), id: 'wfo/IND', scope: { type: 'wfo', id: 'IND' } }));
        const result = applyBundle(dir, { ok: true, sets: { 'wfo/LOT': lot(2) } }, { prune: true });
        expect(result).toEqual({ problems: [], written: ['wfo/LOT'], removed: ['wfo/IND'] });
        expect(applyBundle(dir, { ok: true, sets: { 'wfo/LOT': lot(2) } }).written).toEqual([]);
        expect(await main(['--dir', dir])).toBe(0);
        expect(read(path.join(dir, 'index.json')).sets['wfo/LOT'].rev).toBe(2);
        expect(await main(['--dir', dir, '--check'])).toBe(0);
        fs.writeFileSync(setPath(dir, 'wfo/LOT'), formatSet(lot(3)));
        expect(await main(['--dir', dir, '--check'])).toBe(1);
    });

    it('refuses invalid bundles and broken files', async () => {
        const dir = tempDir();
        expect(applyBundle(dir, { ok: false }).problems).toEqual(['bundle response has no sets']);
        expect(applyBundle(dir, { sets: { 'wfo/LOT': { ...lot(), id: 'wfo/IND' } } }).problems).toEqual(['wfo/LOT: id mismatch']);
        expect(applyBundle(dir, { sets: { 'wfo/LOT': lot(1, '<b>') } }).problems[0]).toMatch(/^wfo\/LOT: entries\[0\]\.replace\.text/);
        const bundleFile = path.join(dir, 'bundle.json');
        fs.writeFileSync(bundleFile, JSON.stringify({ sets: { 'wfo/LOT': lot(1, '<b>') } }));
        expect(await main(['--dir', dir, '--from', bundleFile])).toBe(1);
        fs.writeFileSync(bundleFile, JSON.stringify({ ok: true, sets: { 'wfo/LOT': lot(4) } }));
        expect(await main(['--dir', dir, '--from', bundleFile])).toBe(0);
        fs.mkdirSync(path.join(dir, 'tx'));
        fs.writeFileSync(setPath(dir, 'tx/KEC76'), '{broken');
        fs.writeFileSync(setPath(dir, 'national'), formatSet({ ...lot(), id: 'wfo/IND', scope: { type: 'wfo', id: 'IND' } }));
        const { problems } = buildIndex(dir);
        expect(problems[0]).toBe('national: file holds id "wfo/IND"');
        expect(problems.some((p) => p.startsWith('tx/KEC76: '))).toBe(true);
        expect(await main(['--dir', dir])).toBe(1);
    });

    it('works without a transmitter registry', () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nwr-pron-'));
        temps.push(dir);
        expect(applyBundle(dir, { sets: { 'wfo/LOT': lot() } }).written).toEqual(['wfo/LOT']);
        expect(buildIndex(dir).index.sets['wfo/LOT'].prosody).toBe(false);
    });

    it('orders set keys and entries deterministically', () => {
        const text = formatSet({ entries: [{ id: 'b' }, { id: 'a' }], extra: 1, id: 'national', schemaVersion: 1 });
        expect(Object.keys(JSON.parse(text))).toEqual(['schemaVersion', 'id', 'entries', 'extra']);
        expect(JSON.parse(text).entries.map((e) => e.id)).toEqual(['a', 'b']);
    });
});
