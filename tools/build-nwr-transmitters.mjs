#!/usr/bin/env node
/**
 * Build assets/nwr-pronunciation/transmitters.json -- every NOAA Weather Radio transmitter
 * (callsign, site, frequency, status) and the forecast office that programs it, for the
 * VT Paul pronunciation picker.
 *
 *   node tools/build-nwr-transmitters.mjs                fetch CCL.js from weather.gov
 *   node tools/build-nwr-transmitters.mjs --from FILE    read a saved copy instead
 *   node tools/build-nwr-transmitters.mjs --out DIR      write somewhere else (tests)
 *
 * Source: https://www.weather.gov/source/nwr/JS/CCL.js, the county coverage listing behind
 * weather.gov/nwr/county_coverage. It is parallel arrays (CALLSIGN[i], WFO[i], ...) with one
 * row per county a transmitter serves. It is parsed as text and never executed.
 * Its WFO column is a "City|ST" label that does not always match civil_sites.json, so every
 * label must appear in OFFICE_BY_LABEL; an unknown label stops the build.
 */

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(import.meta.dirname, '..');
export const SOURCE_URL = 'https://www.weather.gov/source/nwr/JS/CCL.js';
const FIELDS = ['CALLSIGN', 'WFO', 'SITENAME', 'SITELOC', 'SITESTATE', 'FREQ', 'STATUS'];

export const OFFICE_BY_LABEL = {
    'Aberdeen|SD': 'ABR', 'Albany|NY': 'ALY', 'Albuquerque|NM': 'ABQ', 'Amarillo|TX': 'AMA',
    'Anchorage|AK': 'AFC', 'Austin/San Antonio|TX': 'EWX', 'Baltimore/Washington|VA': 'LWX', 'Billings|MT': 'BYZ',
    'Binghamton|NY': 'BGM', 'Birmingham|AL': 'BMX', 'Bismarck|ND': 'BIS', 'Blacksburg|VA': 'RNK',
    'Boise|ID': 'BOI', 'Boston/Norton|MA': 'BOX', 'Boulder|CO': 'BOU', 'Brownsville/Rio Grande Valley|TX': 'BRO',
    'Buffalo|NY': 'BUF', 'Burlington|VT': 'BTV', 'Caribou|ME': 'CAR', 'Charleston|SC': 'CHS',
    'Charleston|WV': 'RLX', 'Cheyenne|WY': 'CYS', 'Chicago|IL': 'LOT', 'Cleveland|OH': 'CLE',
    'Columbia|SC': 'CAE', 'Corpus Christi|TX': 'CRP', 'Des Moines|IA': 'DMX', 'Detroit/Pontiac|MI': 'DTX',
    'Dodge City|KS': 'DDC', 'Duluth|MN': 'DLH', 'El Paso|TX': 'EPZ', 'Elko|NV': 'LKN',
    'Eureka|CA': 'EKA', 'Fairbanks|AK': 'AFG', 'Flagstaff|AZ': 'FGZ', 'Fort Worth-Dallas|TX': 'FWD',
    'Gaylord|MI': 'APX', 'Glasgow|MT': 'GGW', 'Goodland|KS': 'GLD', 'Grand Forks|ND': 'FGF',
    'Grand Junction|CO': 'GJT', 'Grand Rapids|MI': 'GRR', 'Gray/Portland|ME': 'GYX', 'Great Falls|MT': 'TFX',
    'Green Bay|WI': 'GRB', 'Greenville-Spartanburg|SC': 'GSP', 'Guam|GU': 'GUM', 'Hanford|CA': 'HNX',
    'Hastings|NE': 'GID', 'Honolulu|HI': 'HFO', 'Houston/Galveston|TX': 'HGX', 'Huntsville|AL': 'HUN',
    'Indianapolis|IN': 'IND', 'Jacksonville|FL': 'JAX', 'Jackson|KY': 'JKL', 'Jackson|MS': 'JAN',
    'Juneau|AK': 'AJK', 'Kansas City|MO': 'EAX', 'Key West|FL': 'KEY', 'Kodiak|AK (WSO)': 'AFC',
    'La Crosse|WI': 'ARX', 'Lake Charles|LA': 'LCH', 'Las Vegas|NV': 'VEF', 'Lincoln|IL': 'ILX',
    'Little Rock|AR': 'LZK', 'Los Angeles|CA': 'LOX', 'Louisville|KY': 'LMK', 'Lubbock|TX': 'LUB',
    'Marquette|MI': 'MQT', 'Medford|OR': 'MFR', 'Melbourne|FL': 'MLB', 'Memphis|TN': 'MEG',
    'Miami|FL': 'MFL', 'Midland/Odessa|TX': 'MAF', 'Milwaukee/Sullivan|WI': 'MKX', 'Missoula|MT': 'MSO',
    'Mobile|AL': 'MOB', 'Morristown|TN': 'MRX', 'Nashville|TN': 'OHX', 'New Orleans/Baton Rouge|LA': 'LIX',
    'New York|NY': 'OKX', 'Newport/Morehead City|NC': 'MHX', 'Norman|OK': 'OUN', 'North Platte|NE': 'LBF',
    'Northern Indiana|IN': 'IWX', 'Omaha/Valley|NE': 'OAX', 'Paducah|KY': 'PAH', 'Pago Pago|AS (WSO)': 'PPG',
    'Peachtree City|GA': 'FFC', 'Pendleton|OR': 'PDT', 'Philadelphia/Mt Holly|NJ': 'PHI', 'Phoenix|AZ': 'PSR',
    'Pittsburgh|PA': 'PBZ', 'Pocatello|ID': 'PIH', 'Portland|OR': 'PQR', 'Pueblo|CO': 'PUB',
    'Quad Cities|IA': 'DVN', 'Raleigh|NC': 'RAH', 'Rapid City|SD': 'UNR', 'Reno|NV': 'REV',
    'Riverton|WY': 'RIW', 'Sacramento|CA': 'STO', 'Salt Lake City|UT': 'SLC', 'San Angelo|TX': 'SJT',
    'San Diego|CA': 'SGX', 'San Francisco|CA': 'MTR', 'San Juan|PR': 'SJU', 'Seattle/Tacoma|WA': 'SEW',
    'Shreveport|LA': 'SHV', 'Sioux Falls|SD': 'FSD', 'Spokane|WA': 'OTX', 'Springfield|MO': 'SGF',
    'St. Louis|MO': 'LSX', 'State College|PA': 'CTP', 'Tallahassee|FL': 'TAE', 'Tampa Bay Area|FL': 'TBW',
    'Topeka|KS': 'TOP', 'Tucson|AZ': 'TWC', 'Tulsa|OK': 'TSA', 'Twin Cities/Chanhassen|MN': 'MPX',
    'Wakefield|VA': 'AKQ', 'Wichita|KS': 'ICT', 'Wilmington|NC': 'ILM', 'Wilmington|OH': 'ILN',
};

const tidy = (text) => String(text ?? '').replace(/\s+/g, ' ').trim();

export function parseCcl(text) {
    const columns = Object.fromEntries(FIELDS.map((f) => [f, []]));
    const re = /^([A-Z]+)\[(\d+)\]\s*=\s*"((?:[^"\\]|\\.)*)";?\s*$/;
    for (const line of String(text).split(/\r?\n/)) {
        const m = re.exec(line.trim());
        if (!m || !columns[m[1]]) continue;
        columns[m[1]][Number(m[2])] = m[3].replace(/\\(.)/g, '$1');
    }
    const rows = [];
    for (let i = 0; i < columns.CALLSIGN.length; i++) {
        if (columns.CALLSIGN[i] === undefined) continue;
        rows.push(Object.fromEntries(FIELDS.map((f) => [f, tidy(columns[f][i])])));
    }
    return rows;
}

export function buildTransmitters(rows, civilSites) {
    const problems = [];
    const offices = {};
    for (const [id, site] of Object.entries(civilSites)) {
        offices[id] = { label: tidy(site.wfoCityState), region: site.region || '' };
    }
    const transmitters = {};
    for (const row of rows) {
        if (!row.CALLSIGN && !row.WFO) continue;
        const call = row.CALLSIGN.toUpperCase();
        if (!/^[A-Z0-9]{3,7}$/.test(call)) {
            problems.push(`bad callsign "${row.CALLSIGN}"`);
            continue;
        }
        const wfo = OFFICE_BY_LABEL[row.WFO];
        if (!wfo) {
            problems.push(`${call}: no office for WFO label "${row.WFO}"`);
            continue;
        }
        if (!offices[wfo]) {
            problems.push(`${call}: office ${wfo} is not in civil_sites.json`);
            continue;
        }
        const record = { wfo, site: row.SITENAME || row.SITELOC, state: row.SITESTATE, freq: row.FREQ, status: row.STATUS };
        const prior = transmitters[call];
        if (prior) {
            for (const key of ['wfo', 'site', 'freq']) {
                if (prior[key] !== record[key]) problems.push(`${call}: ${key} "${prior[key]}" vs "${record[key]}"`);
            }
            continue;
        }
        if (!/^16\d\.\d{3}$/.test(record.freq)) problems.push(`${call}: odd frequency "${record.freq}"`);
        transmitters[call] = record;
    }
    const sortKeys = (obj) => Object.fromEntries(Object.keys(obj).sort().map((k) => [k, obj[k]]));
    return { problems: [...new Set(problems)], offices: sortKeys(offices), transmitters: sortKeys(transmitters) };
}

/** One record per line keeps the file about half the size of a fully indented dump. */
export function formatTransmitters(doc) {
    const block = (obj) => Object.entries(obj).map(([k, v]) => `        ${JSON.stringify(k)}: ${JSON.stringify(v)}`).join(',\n');
    return [
        '{',
        `    "_comment": ${JSON.stringify(doc._comment, null, 4).replace(/\n/g, '\n    ')},`,
        '    "offices": {',
        block(doc.offices),
        '    },',
        '    "transmitters": {',
        block(doc.transmitters),
        '    }',
        '}',
        '',
    ].join('\n');
}

async function main(argv) {
    const flag = (name) => {
        const at = argv.indexOf(name);
        return at >= 0 ? argv[at + 1] : null;
    };
    const fromFile = flag('--from');
    const outDir = flag('--out') || path.join(ROOT, 'assets', 'nwr-pronunciation');
    let text;
    if (fromFile) {
        text = fs.readFileSync(fromFile, 'utf8');
    } else {
        const response = await fetch(SOURCE_URL, { headers: { 'User-Agent': 'eas-tools build-nwr-transmitters' } });
        if (!response.ok) throw new Error(`${SOURCE_URL}: HTTP ${response.status}`);
        text = await response.text();
    }
    const civil = JSON.parse(fs.readFileSync(path.join(ROOT, 'warngen', 'data', 'civil_sites.json'), 'utf8')).sites;
    const rows = parseCcl(text);
    const built = buildTransmitters(rows, civil);
    if (!rows.length) built.problems.push('no transmitter rows found');
    if (built.problems.length) {
        console.error('Refusing to write transmitters.json:');
        built.problems.forEach((p) => console.error('  ' + p));
        return 1;
    }
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, 'transmitters.json'), formatTransmitters({
        _comment: [
            'NOAA Weather Radio transmitters and the office that programs each one.',
            `Source: ${SOURCE_URL} (county coverage listing); offices: warngen/data/civil_sites.json.`,
            'Regenerate with tools/build-nwr-transmitters.mjs.',
        ],
        offices: built.offices,
        transmitters: built.transmitters,
    }));
    console.log(`transmitters.json : ${Object.keys(built.transmitters).length} transmitters from ${rows.length} county rows, ${Object.keys(built.offices).length} offices`);
    return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    process.exitCode = await main(process.argv.slice(2));
}
