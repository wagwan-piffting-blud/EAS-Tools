#!/usr/bin/env node
/**
 * Build assets/E2T/include/same-marine.json -- the marine SAME codes NWS publishes at
 * https://www.weather.gov/gis/EasNWR, and strip the old hand-carried marine entries out of
 * same-us.json so the two never disagree.
 *
 *   node tools/build-same-marine.mjs              fetch the three NWS files
 *   node tools/build-same-marine.mjs --from DIR   read them from DIR instead
 *
 * Sources (pipe-delimited, no header row):
 *   mareas*.txt  marine zones for EAS          prefix|SAME|name|lat|lon
 *   marnwr*.txt  the same plus NWR synopses    prefix|SAME|name|lat|lon
 *   marst*.txt   marine areas                  prefix|field|short name|long name
 *
 * Every marine area also gets field + "000" as its area-wide code, the way 000 means the
 * whole state for land codes. Zone names keep their ", XX" UGC prefix suffix because
 * tools/build-marine-same.mjs derives the prefix -> field map from it.
 */

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const ROOT = path.resolve(import.meta.dirname, '..');
const INCLUDE = path.join(ROOT, 'assets', 'E2T', 'include');
const BASE_URL = 'https://www.weather.gov/source/gis/Shapefiles/WSOM/';
const FILES = { eas: 'mareas18mr25.txt', nwr: 'marnwr18mr25.txt', areas: 'marst14fe25.txt' };

const fromIndex = process.argv.indexOf('--from');
const fromDir = fromIndex >= 0 ? process.argv[fromIndex + 1] : null;

async function readSource(name) {
    if (fromDir) return fs.readFileSync(path.join(fromDir, name), 'utf8');
    const response = await fetch(BASE_URL + name, { headers: { 'User-Agent': 'eas-tools build-same-marine' } });
    if (!response.ok) throw new Error(`${BASE_URL + name}: HTTP ${response.status}`);
    return response.text();
}

function rows(text) {
    return text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((line) => line.split('|').map((f) => f.trim()));
}

const tidy = (name) => name.replace(/\s+/g, ' ').trim();

const [easText, nwrText, areaText] = await Promise.all([readSource(FILES.eas), readSource(FILES.nwr), readSource(FILES.areas)]);

const areas = {};
for (const [prefix, field, abbr, name] of rows(areaText)) {
    if (!/^[A-Z]{2}$/.test(prefix) || !/^\d{2}$/.test(field)) throw new Error(`bad area row: ${prefix}|${field}`);
    areas[field] = { prefix, abbr: tidy(abbr), name: tidy(name) };
}
const fieldByPrefix = Object.fromEntries(Object.entries(areas).map(([field, a]) => [a.prefix, field]));

const same = {};
const nwrOnly = [];
const problems = [];
const easCodes = new Set();
for (const [label, text] of [['eas', easText], ['nwr', nwrText]]) {
    for (const [prefix, code, name] of rows(text)) {
        if (!/^\d{5}$/.test(code)) { problems.push(`${label}: bad code ${prefix}|${code}`); continue; }
        if (fieldByPrefix[prefix] !== code.slice(0, 2)) { problems.push(`${label}: ${prefix}|${code} is outside field ${fieldByPrefix[prefix]}`); continue; }
        if (label === 'eas') easCodes.add(code);
        else if (!easCodes.has(code)) nwrOnly.push(code);
        const entry = `${tidy(name)}, ${prefix}`;
        if (same[code] && same[code] !== entry) problems.push(`${code}: "${same[code]}" vs "${entry}"`);
        same[code] ??= entry;
    }
}
for (const [field, area] of Object.entries(areas)) same[field + '000'] ??= area.name;

if (problems.length) {
    console.error('Refusing to write; the NWS files disagree with themselves:');
    problems.forEach((p) => console.error('  ' + p));
    process.exit(1);
}

const sorted = Object.fromEntries(Object.keys(same).sort().map((code) => [code, same[code]]));
fs.writeFileSync(path.join(INCLUDE, 'same-marine.json'), JSON.stringify({
    _comment: [
        'Marine SAME codes (without the leading P digit) from https://www.weather.gov/gis/EasNWR.',
        `Zones: ${FILES.eas}; NWR synopses: ${FILES.nwr}; areas: ${FILES.areas}.`,
        'Area-wide codes are the area field + 000. Regenerate with tools/build-same-marine.mjs.',
    ],
    AREAS: areas,
    SAME: sorted,
}, null, 4) + '\n');

// Line-based so the rest of same-us.json keeps its order: a JSON round trip would re-sort
// every integer-like key.
const usPath = path.join(INCLUDE, 'same-us.json');
const marineFields = new Set(Object.keys(areas));
const removed = [];
const kept = fs.readFileSync(usPath, 'utf8').split('\n').filter((line) => {
    const m = /^\s*"(\d{2})\d{3}":/.exec(line);
    if (!m || !marineFields.has(m[1])) return true;
    removed.push(line);
    return false;
});
const usText = kept.join('\n').replace(/,(\n\s*\})/g, '$1');
JSON.parse(usText);
fs.writeFileSync(usPath, usText);

console.log(`same-marine.json : ${Object.keys(sorted).length} codes (${easCodes.size} EAS zones, ${nwrOnly.length} NWR-only synopses, ${marineFields.size} areas)`);
console.log(`same-us.json     : removed ${removed.length} marine entries`);
