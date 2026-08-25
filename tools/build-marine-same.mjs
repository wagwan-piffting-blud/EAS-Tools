#!/usr/bin/env node
/**
 * Build assets/E2T/include/marine-same.json -- the UGC marine prefix to SAME state-field
 * mapping used when converting a marine product to a ZCZC header.
 *
 *   node tools/build-marine-same.mjs
 *
 * NWS assigns marine SAME codes by convention rather than publishing a lookup: the code is
 * 0 + a two-digit field standing in for the marine prefix + the UGC zone number. ANZ350
 * is 073350, GMZ531 is 077531, and so on. NWS's own SameCode.txt covers counties only, so
 * the mapping is recovered here from the marine entries already in same-us.json, whose
 * names carry their UGC prefix as a trailing ", AN" / ", GM" suffix.
 *
 * Deriving it rather than hand-typing it means the file can be regenerated and checked, and
 * the script fails loudly if a prefix ever maps to more than one field.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const INCLUDE = path.join(ROOT, 'assets', 'E2T', 'include');

const same = JSON.parse(fs.readFileSync(path.join(INCLUDE, 'same-us.json'), 'utf8'));

const tally = {};
for (const [code, name] of Object.entries(same.SAME || {})) {
    const m = /,\s*([A-Z]{2})\s*$/.exec(name);
    if (!m) continue;
    const prefix = m[1];
    const field = code.slice(0, 2);
    tally[prefix] = tally[prefix] || {};
    tally[prefix][field] = (tally[prefix][field] || 0) + 1;
}

/**
 * The marine UGC prefixes from NWS Directive 10-1701. This has to be an allowlist rather
 * than "any SAME field above the state range": a handful of Gulf and Atlantic zones are
 * named ", FL" or ", NC" after the state they front, and inferring from those would map
 * Florida's own FLZ### land zones onto Gulf marine codes. Territory prefixes (PR, VI, GU,
 * AS, MP) are land zones too and are deliberately absent.
 */
const MARINE_PREFIXES = [
    'AM', 'AN', 'GM', 'LC', 'LE', 'LH', 'LM', 'LO', 'LS',
    'PH', 'PK', 'PM', 'PS', 'PZ', 'PW', 'SL', 'AH'
];

const STATE_FIELD_MAX = 56;
const prefixes = {};
const ambiguous = [];
const absent = [];

for (const prefix of MARINE_PREFIXES) {
    const fields = tally[prefix];
    const entries = fields
        ? Object.entries(fields).filter(([f]) => parseInt(f, 10) > STATE_FIELD_MAX)
            .sort((a, b) => b[1] - a[1])
        : [];
    if (!entries.length) { absent.push(prefix); continue; }
    if (entries.length > 1) ambiguous.push(prefix + ' -> ' + entries.map(e => e[0] + '(' + e[1] + ')').join(' '));
    prefixes[prefix] = entries[0][0];
}

if (ambiguous.length) {
    console.error('Ambiguous marine prefixes, refusing to write:');
    ambiguous.forEach(a => console.error('  ' + a));
    process.exit(1);
}

const dest = path.join(INCLUDE, 'marine-same.json');
fs.writeFileSync(dest, JSON.stringify({
    _comment: [
        'UGC marine prefix -> SAME state field. A marine SAME code is 0 + this field + the',
        'UGC zone number, so ANZ350 becomes 073350.',
        'Derived from the marine entries in same-us.json by tools/build-marine-same.mjs;',
        'NWS SameCode.txt covers counties only and has no marine listing to fetch.'
    ],
    prefixes: prefixes
}, null, 4) + '\n');

const sorted = Object.keys(prefixes).sort();
console.log('marine prefixes : ' + sorted.length + ' of ' + MARINE_PREFIXES.length);
if (absent.length) console.log('no SAME codes   : ' + absent.join(' '));
sorted.forEach(p => console.log('  ' + p + ' -> ' + prefixes[p]
    + '   (' + tally[p][prefixes[p]] + ' codes in same-us.json)'));
console.log('output          : ' + dest);
