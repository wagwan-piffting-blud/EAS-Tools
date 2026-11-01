#!/usr/bin/env node
/**
 * Maintain the bundled VT Paul pronunciation snapshot in assets/nwr-pronunciation/.
 * After launch the TTS backend's moderation queue is the source of truth; this snapshot is
 * the offline / mobile fallback and the backend's one-time seed.
 *
 *   node tools/sync-nwr-pronunciation.mjs --reindex          rebuild index.json from the set files
 *   node tools/sync-nwr-pronunciation.mjs --check            exit 1 if any set is invalid or index.json is stale
 *   node tools/sync-nwr-pronunciation.mjs --url [URL]        pull approved sets from the backend bundle endpoint
 *   node tools/sync-nwr-pronunciation.mjs --from FILE        same, from a saved bundle response
 *   add --prune to delete local set files the bundle no longer has
 *   add --dir DIR to work on another directory (tests)
 *   node tools/sync-nwr-pronunciation.mjs --export-rules DIR   write rules.json + parity.json for the Flask blueprint
 *
 * Set files: national.json, wfo/<WFO>.json, tx/<CALLSIGN>.json (see docs/development.md).
 * Every set is validated with assets/js/nwr-pronunciation.js before anything is written.
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { SCHEMA_VERSION, DEFAULT_VOICES, isSetId, normalizeMarkupTags, validateEntry, validateProsody, validatePronunciationSet, validationRules } from '../assets/js/nwr-pronunciation.js';

const ROOT = path.resolve(import.meta.dirname, '..');
export const DEFAULT_DIR = path.join(ROOT, 'assets', 'nwr-pronunciation');
export const DEFAULT_BUNDLE_URL = 'https://wagspuzzle.space/tools/eas-tts/index.php?handler=toolkit&pron=bundle';

const sha256 = (text) => crypto.createHash('sha256').update(text).digest('hex');

export function setPath(dir, id) {
    return path.join(dir, ...id.split('/')) + '.json';
}

export function formatSet(set) {
    const ordered = {};
    for (const key of ['_comment', 'schemaVersion', 'id', 'scope', 'rev', 'updatedAt', 'voices', 'sources', 'prosody', 'entries', 'style']) {
        if (set[key] !== undefined) ordered[key] = set[key];
    }
    for (const key of Object.keys(set)) if (!(key in ordered)) ordered[key] = set[key];
    if (Array.isArray(ordered.entries)) ordered.entries = [...ordered.entries].sort((a, b) => String(a.id).localeCompare(String(b.id)));
    return JSON.stringify(ordered, null, 4) + '\n';
}

export function listSetFiles(dir) {
    const out = [];
    if (fs.existsSync(path.join(dir, 'national.json'))) out.push('national');
    for (const type of ['wfo', 'tx']) {
        const sub = path.join(dir, type);
        if (!fs.existsSync(sub)) continue;
        for (const name of fs.readdirSync(sub).sort()) {
            if (name.endsWith('.json')) out.push(type + '/' + name.slice(0, -5));
        }
    }
    return out;
}

function loadRegistry(dir) {
    const file = path.join(dir, 'transmitters.json');
    if (!fs.existsSync(file)) return { offices: null, transmitters: null };
    const doc = JSON.parse(fs.readFileSync(file, 'utf8'));
    return { offices: doc.offices || null, transmitters: doc.transmitters || null };
}

export function buildIndex(dir) {
    const problems = [];
    const registry = loadRegistry(dir);
    const sets = {};
    let revision = 0;
    for (const id of listSetFiles(dir)) {
        const text = fs.readFileSync(setPath(dir, id), 'utf8');
        let set;
        try {
            set = JSON.parse(text);
        } catch (err) {
            problems.push(`${id}: ${err.message}`);
            continue;
        }
        if (set.id !== id) problems.push(`${id}: file holds id "${set.id}"`);
        const result = validatePronunciationSet(set, registry);
        for (const p of result.problems) problems.push(`${id}: ${p.path || '(set)'} ${p.problem}`);
        const prosody = !!set.prosody && Object.values(set.prosody).some((f) => f && Number.isInteger(f.value));
        sets[id] = { rev: set.rev, sha256: sha256(text), entries: Array.isArray(set.entries) ? set.entries.length : 0, prosody };
        revision += Number(set.rev) || 0;
    }
    return { problems, index: { schemaVersion: SCHEMA_VERSION, revision, voices: [...DEFAULT_VOICES], sets } };
}

export function formatIndex(index) {
    return JSON.stringify({
        _comment: ['Snapshot index of the VT Paul pronunciation sets. Regenerate with tools/sync-nwr-pronunciation.mjs --reindex.'],
        ...index,
    }, null, 4) + '\n';
}

export function applyBundle(dir, bundle, { prune = false } = {}) {
    const problems = [];
    if (!bundle || bundle.ok === false || typeof bundle.sets !== 'object') return { problems: ['bundle response has no sets'], written: [], removed: [] };
    const registry = loadRegistry(dir);
    const incoming = Object.entries(bundle.sets);
    for (const [id, set] of incoming) {
        if (!isSetId(id) || set?.id !== id) {
            problems.push(`${id}: id mismatch`);
            continue;
        }
        for (const p of validatePronunciationSet(set, registry).problems) problems.push(`${id}: ${p.path || '(set)'} ${p.problem}`);
    }
    if (problems.length) return { problems, written: [], removed: [] };
    const written = [];
    for (const [id, set] of incoming) {
        const file = setPath(dir, id);
        const text = formatSet(set);
        if (fs.existsSync(file) && fs.readFileSync(file, 'utf8') === text) continue;
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, text);
        written.push(id);
    }
    const removed = [];
    if (prune) {
        const keep = new Set(incoming.map(([id]) => id));
        for (const id of listSetFiles(dir)) {
            if (!keep.has(id)) {
                fs.unlinkSync(setPath(dir, id));
                removed.push(id);
            }
        }
    }
    return { problems, written, removed };
}

async function readBundle(argv) {
    const at = (name) => argv.indexOf(name);
    if (at('--from') >= 0) return JSON.parse(fs.readFileSync(argv[at('--from') + 1], 'utf8'));
    const next = argv[at('--url') + 1];
    const url = next && !next.startsWith('--') ? next : DEFAULT_BUNDLE_URL;
    const response = await fetch(url, { headers: { 'User-Agent': 'eas-tools sync-nwr-pronunciation' } });
    if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
    return response.json();
}

const PARITY_ENTRIES = [
    { id: 'ok-phoneme', match: 'Illinois', replace: { kind: 'phoneme', ph: 'IH1 L IH0 N OY1' } },
    { id: 'ok-on', match: 'wind down', replace: { kind: 'phoneme', ph: 'W AY2 N D', on: 'wind' } },
    { id: 'ok-vtml', match: 'beach', replace: { kind: 'vtml', markup: '{{match}}<vtml_pause time="0"/>' } },
    { id: 'ok-variants', match: 'Medina', replace: { kind: 'respell', text: 'Ma Dy Nah' }, variants: [{ id: 'alt', label: 'Alternate', replace: { kind: 'respell', text: 'Ma-Die-uh' } }] },
    { id: 'bad-phone', match: 'Thunderstorm', replace: { kind: 'phoneme', ph: 'TH AH2 N D ER S T AR2 R M' } },
    { id: 'bad-stress', match: 'x', replace: { kind: 'phoneme', ph: 'K1 AE' } },
    { id: 'bad-on', match: 'wind down', replace: { kind: 'phoneme', ph: 'W', on: 'up' } },
    { id: 'Bad Id', match: ' two  spaces', caseSensitive: 'yes', verified: 1, replace: { kind: 'other' }, notes: 5, sources: 'p3' },
    { id: 'bad-respell', match: 'ok', replace: { kind: 'respell', text: '<b>' } },
    { id: 'bad-tag', match: 'ok', replace: { kind: 'vtml', markup: '<script>x</script>' } },
    { id: 'bad-pause', match: 'ok', replace: { kind: 'vtml', markup: '<vtml_pause time="9000"/>' } },
    { id: 'bad-unclosed', match: 'ok', replace: { kind: 'vtml', markup: '<vtml_phoneme alphabet="x-cmu" ph="AA">x' } },
    { id: 'bad-token', match: '-bad', replace: { kind: 'respell', text: 'a' } },
    { id: 'bad-long', match: 'a b c d e f g h i', replace: { kind: 'respell', text: 'a' } },
    { id: 'bad-variant', match: 'ok', replace: { kind: 'respell', text: 'a' }, variants: [{ id: 'X', replace: { kind: 'respell', text: '' } }] },
    { id: 'bad-replace', match: 'ok', replace: null },
];

const PARITY_MARKUP = [
    '<vtml_speed value=117>Test</vtml_speed>',
    '<vtml_pause time = 500 /> go',
    "<vtml_sub alias='say \"hi\"'>x</vtml_sub>",
    '<vtml_phoneme alphabet=x-cmu ph="W IH1 N D">wind</vtml_phoneme>',
    '<rate absspeed=5 >fast</rate>',
    '<vtml_speed  value="117"  >a</vtml_speed>',
    '<vtml_phoneme ph=W IH1 N D>wind</vtml_phoneme>',
    'winds 5 <10 mph, a < b and c > d',
    '<a href=http://x/y>link</a> <!-- n --> &lt;vtml_speed value=117&gt;',
    '<vtml_speed value=é>x</vtml_speed> <vé a=1>',
];

export function exportServerRules(outDir) {
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, 'rules.json'), JSON.stringify(validationRules(), null, 4) + '\n');
    const cases = PARITY_ENTRIES.map((entry) => ({ entry, paths: [...new Set(validateEntry(entry).map((p) => p.path))].sort() }));
    const prosody = [
        { speed: { value: 113, verified: true }, commaPauseMs: { value: 200 }, periodPauseMs: null },
        { speed: { value: 300 } },
        { tempo: 1 },
        { speed: { value: 100, variants: [null, { value: 1 }] } },
    ].map((p) => ({ prosody: p, paths: [...new Set(validateProsody(p).map((x) => x.path))].sort() }));
    const markup = PARITY_MARKUP.map((input) => ({ input, output: normalizeMarkupTags(input) }));
    fs.writeFileSync(path.join(outDir, 'parity.json'), JSON.stringify({ entries: cases, prosody, markup }, null, 4) + '\n');
}

export async function main(argv) {
    const dirAt = argv.indexOf('--dir');
    const dir = dirAt >= 0 ? path.resolve(argv[dirAt + 1]) : DEFAULT_DIR;
    const indexFile = path.join(dir, 'index.json');
    const rulesAt = argv.indexOf('--export-rules');
    if (rulesAt >= 0) {
        exportServerRules(path.resolve(argv[rulesAt + 1]));
        console.log('wrote rules.json and parity.json to ' + argv[rulesAt + 1]);
        return 0;
    }
    if (argv.includes('--url') || argv.includes('--from')) {
        const result = applyBundle(dir, await readBundle(argv), { prune: argv.includes('--prune') });
        if (result.problems.length) {
            console.error('Refusing to write; the bundle has invalid sets:');
            result.problems.forEach((p) => console.error('  ' + p));
            return 1;
        }
        console.log(`sync: ${result.written.length} sets written, ${result.removed.length} removed`);
    }
    const { problems, index } = buildIndex(dir);
    if (problems.length) {
        console.error('Invalid pronunciation sets:');
        problems.forEach((p) => console.error('  ' + p));
        return 1;
    }
    const text = formatIndex(index);
    if (argv.includes('--check')) {
        const current = fs.existsSync(indexFile) ? fs.readFileSync(indexFile, 'utf8') : '';
        if (current !== text) {
            console.error('index.json is stale; run node tools/sync-nwr-pronunciation.mjs --reindex');
            return 1;
        }
        console.log(`nwr-pronunciation: ${Object.keys(index.sets).length} sets valid, index current`);
        return 0;
    }
    fs.writeFileSync(indexFile, text);
    console.log(`index.json : ${Object.keys(index.sets).length} sets, revision ${index.revision}`);
    return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    process.exitCode = await main(process.argv.slice(2));
}
