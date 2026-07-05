import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);
const ROOT       = path.resolve(__dirname, '..');
const GEOJSON    = path.join(ROOT, 'data', 'us_counties.geojson');
const WFO_PATH   = path.join(ROOT, 'data', 'wfo_locations.json');
const OUT_DIR    = path.join(__dirname, 'output');

const API_BASE        = 'https://mesonet.agron.iastate.edu/api/1';
const RATE_LIMIT_MS   = 400;
const SAMPLE_DATES    = (() => {
    const out = [];
    const d = new Date(Date.UTC(2024, 2, 1));
    const end = new Date(Date.UTC(2024, 7, 31));
    while (d <= end) {
        out.push(d.toISOString().slice(0, 10));
        d.setUTCDate(d.getUTCDate() + 7);
    }
    return out;
})();
const TARGET_EVENTS = 3;
const WARN_PILS = new Set(['SVR', 'TOR', 'FFW']);

const CWA_STATE_REGION_OVERRIDES = {
    MEG: { TN: { FFW: 'Tennessee' } }
};

const STATE_NAMES = {
    AL:'Alabama', AK:'Alaska', AZ:'Arizona', AR:'Arkansas', CA:'California',
    CO:'Colorado', CT:'Connecticut', DE:'Delaware', DC:'District of Columbia',
    FL:'Florida', GA:'Georgia', HI:'Hawaii', ID:'Idaho', IL:'Illinois',
    IN:'Indiana', IA:'Iowa', KS:'Kansas', KY:'Kentucky', LA:'Louisiana',
    ME:'Maine', MD:'Maryland', MA:'Massachusetts', MI:'Michigan',
    MN:'Minnesota', MS:'Mississippi', MO:'Missouri', MT:'Montana',
    NE:'Nebraska', NV:'Nevada', NH:'New Hampshire', NJ:'New Jersey',
    NM:'New Mexico', NY:'New York', NC:'North Carolina', ND:'North Dakota',
    OH:'Ohio', OK:'Oklahoma', OR:'Oregon', PA:'Pennsylvania',
    RI:'Rhode Island', SC:'South Carolina', SD:'South Dakota',
    TN:'Tennessee', TX:'Texas', UT:'Utah', VT:'Vermont', VA:'Virginia',
    WA:'Washington', WV:'West Virginia', WI:'Wisconsin', WY:'Wyoming',
    AS:'American Samoa', GU:'Guam', MP:'Northern Mariana Islands',
    PR:'Puerto Rico', VI:'U.S. Virgin Islands'
};

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function fetchJson(url) {
    await sleep(RATE_LIMIT_MS);
    const res = await fetch(url, { headers: { 'User-Agent': 'eas-tools verify_phrasing' } });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText} :: ${url}`);
    return res.json();
}
async function fetchText(url) {
    await sleep(RATE_LIMIT_MS);
    const res = await fetch(url, { headers: { 'User-Agent': 'eas-tools verify_phrasing' } });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText} :: ${url}`);
    return res.text();
}

function formatPartOfStatePhrase(arr) {
    const set = new Set((arr || []).map(s => String(s).toUpperCase()));
    let phrase = '';
    if (set.has('NORTH')) phrase += 'north';
    if (set.has('SOUTH')) phrase += 'south';
    if (set.has('EAST'))  phrase += 'east';
    if (set.has('WEST'))  phrase += 'west';
    const cardinal = set.has('NORTH') || set.has('SOUTH') || set.has('EAST') || set.has('WEST');
    if (set.has('CENTRAL')) {
        phrase = cardinal ? `${phrase} central` : 'central';
    } else if (cardinal) {
        phrase += 'ern';
    }
    return phrase;
}

const FE_CODE_TO_PHRASE = {
    PA: 'the Panhandle of',
    BB: 'Big Bend',
    DS: 'Deep South',
    UP: 'Upstate',
    MI: 'Middle',
    PD: 'the Piedmont of',
    CP: 'central Panhandle',
    EP: 'eastern Panhandle',
    WP: 'western Panhandle',
    NP: 'northern Panhandle',
    SP: 'southern Panhandle',
    ER: 'east central Upper',
    EU: 'eastern Upper',
    NR: 'north central Upper',
    SR: 'south central Upper',
    WU: 'western Upper',
    EA: 'east',
    NO: 'north',
    SO: 'south',
    WE: 'west',
    WS: 'southwest',
    ES: 'southeast',
    WN: 'northwest',
    EN: 'northeast'
};

function formatRegionalCode(code) {
    return FE_CODE_TO_PHRASE[code] || '';
}

function expectedPhrase(countyProps, siteId, pilPrefix) {
    const stateAbbr = countyProps.state;
    const off = CWA_STATE_REGION_OVERRIDES[siteId];
    if (off && off[stateAbbr] && off[stateAbbr][pilPrefix]) {
        return off[stateAbbr][pilPrefix];
    }
    const stateName = STATE_NAMES[stateAbbr] || stateAbbr;
    const arr = countyProps.partOfParentRegion || [];
    if (arr.length === 1 && /^[A-Z]{2}$/.test(arr[0]) && FE_CODE_TO_PHRASE[arr[0]]) {
        const phrase = formatRegionalCode(arr[0]);
        if (phrase.endsWith(' of')) return `${phrase} ${stateName}`;
        return `${phrase} ${stateName}`;
    }
    const pos = formatPartOfStatePhrase(arr);
    return pos ? `${pos} ${stateName}` : stateName;
}

const COUNTY_LINE_RE = /^\s+(.+?)\s+(County|Parish|Borough|Municipio|Independent City)\s+in\s+(.+?)\.\.\.\s*$/;
const BLOCK_HEADER_RE = /^\* (Severe Thunderstorm Warning|Tornado Warning|Flash Flood Warning) for\.\.\.\s*$/i;

function parseCountyLines(text) {
    const out = [];
    let inBlock = false;
    for (const raw of text.split(/\r?\n/)) {
        if (BLOCK_HEADER_RE.test(raw)) { inBlock = true; continue; }
        if (!inBlock) continue;
        if (/^\*/.test(raw)) { inBlock = false; continue; }
        const m = raw.match(COUNTY_LINE_RE);
        if (m) out.push({ leftSide: m[1].trim(), notation: m[2], phrase: m[3].trim() });
    }
    return out;
}

function buildCountyIndex(geo) {
    const byCwa = new Map();
    for (const feat of geo.features) {
        const p = feat.properties;
        if (!p || !p.cwa || !p.name) continue;
        if (!byCwa.has(p.cwa)) byCwa.set(p.cwa, []);
        byCwa.get(p.cwa).push(p);
    }
    for (const list of byCwa.values()) {
        list.sort((a, b) => b.name.length - a.name.length);
    }
    return byCwa;
}

const STATE_NAME_PAIRS = Object.entries(STATE_NAMES)
    .map(([abbr, name]) => [name.toLowerCase(), abbr])
    .sort((a, b) => b[0].length - a[0].length);

function stateFromPhrase(phrase) {
    const lc = phrase.toLowerCase();
    for (const [name, abbr] of STATE_NAME_PAIRS) {
        if (lc === name || lc.endsWith(' ' + name)) return abbr;
    }
    return null;
}

function findCounty(index, cwa, leftSide, actualPhrase) {
    const candidates = index.get(cwa) || [];
    const lc = leftSide.toLowerCase();
    const wantState = actualPhrase ? stateFromPhrase(actualPhrase) : null;
    if (wantState) {
        for (const c of candidates) {
            if (c.state !== wantState) continue;
            const nameLc = c.name.toLowerCase();
            if (lc === nameLc || lc.endsWith(' ' + nameLc)) return c;
        }
    }
    for (const c of candidates) {
        const nameLc = c.name.toLowerCase();
        if (lc === nameLc || lc.endsWith(' ' + nameLc)) return c;
    }
    return null;
}

async function listProductsForDay(cwa, date) {
    const url = `${API_BASE}/nws/afos/list.json?cccc=K${cwa}&date=${date}`;
    const json = await fetchJson(url);
    return (json.data || []).filter(row => {
        const pil = row.pil || '';
        const prefix = pil.slice(0, 3);
        return WARN_PILS.has(prefix);
    });
}

async function fetchProductText(productId) {
    return fetchText(`${API_BASE}/nwstext/${productId}`);
}

async function verifyOneCwa(cwa, countyIndex, log) {
    const products = [];
    for (const date of SAMPLE_DATES) {
        if (products.length >= TARGET_EVENTS) break;
        let rows;
        try {
            rows = await listProductsForDay(cwa, date);
        } catch (err) {
            log(`  [${cwa} ${date}] list error: ${err.message}`);
            continue;
        }
        for (const row of rows) {
            if (products.length >= TARGET_EVENTS) break;
            products.push(row);
        }
    }

    const findings = [];
    for (const prod of products) {
        const pilPrefix = prod.pil.slice(0, 3);
        let text;
        try {
            text = await fetchProductText(prod.product_id);
        } catch (err) {
            log(`  [${cwa}] fetch text error for ${prod.product_id}: ${err.message}`);
            continue;
        }
        const lines = parseCountyLines(text);
        for (const line of lines) {
            const county = findCounty(countyIndex, cwa, line.leftSide, line.phrase);
            if (!county) {
                findings.push({
                    product_id: prod.product_id,
                    pil: prod.pil,
                    leftSide: line.leftSide,
                    notation: line.notation,
                    actual: line.phrase,
                    expected: null,
                    status: 'county-not-found'
                });
                continue;
            }
            const expected = expectedPhrase(county, cwa, pilPrefix);
            const match = expected === line.phrase;
            findings.push({
                product_id: prod.product_id,
                pil: prod.pil,
                countyName: county.name,
                fips: county.fips,
                state: county.state,
                leftSide: line.leftSide,
                expected,
                actual: line.phrase,
                status: match ? 'match' : 'mismatch',
                partOfParentRegion: county.partOfParentRegion
            });
        }
    }

    const matches    = findings.filter(f => f.status === 'match').length;
    const mismatches = findings.filter(f => f.status === 'mismatch');
    const orphans    = findings.filter(f => f.status === 'county-not-found');
    return {
        cwa,
        productsScanned: products.length,
        productIds: products.map(p => p.product_id),
        countyLines: findings.length,
        matches,
        mismatchCount: mismatches.length,
        orphanCount: orphans.length,
        mismatches,
        orphans
    };
}

function writeMarkdownSummary(report, outPath) {
    const lines = [];
    lines.push(`# WarnGen phrasing verification`);
    lines.push('');
    lines.push(`Generated: ${report.generatedAt}`);
    lines.push(`Date range: ${report.dateStart} → ${report.dateEnd} (${SAMPLE_DATES.length} sample dates, weekly)`);
    lines.push(`Target events per CWA: ${TARGET_EVENTS}`);
    lines.push('');
    lines.push(`## Summary`);
    lines.push('');
    lines.push(`| CWA | Products | County lines | Matches | Mismatches | Orphans |`);
    lines.push(`|-----|---------:|------------:|--------:|-----------:|--------:|`);
    const sorted = [...report.cwas].sort((a, b) => b.mismatchCount - a.mismatchCount);
    for (const r of sorted) {
        lines.push(`| ${r.cwa} | ${r.productsScanned} | ${r.countyLines} | ${r.matches} | ${r.mismatchCount} | ${r.orphanCount} |`);
    }
    lines.push('');
    lines.push(`## Mismatches`);
    lines.push('');
    for (const r of sorted) {
        if (r.mismatchCount === 0) continue;
        lines.push(`### ${r.cwa} — ${r.mismatchCount} mismatches`);
        lines.push('');
        const grouped = new Map();
        for (const m of r.mismatches) {
            const key = `${m.state} :: expected "${m.expected}" → actual "${m.actual}"`;
            if (!grouped.has(key)) grouped.set(key, []);
            grouped.get(key).push(m);
        }
        for (const [key, items] of grouped) {
            lines.push(`- **${key}** (${items.length}× — ${items.map(i => i.countyName).filter(Boolean).slice(0, 6).join(', ')}${items.length > 6 ? ', …' : ''})`);
            lines.push(`  example: \`${items[0].product_id}\``);
        }
        lines.push('');
    }
    return fs.writeFile(outPath, lines.join('\n'));
}

async function main() {
    await fs.mkdir(OUT_DIR, { recursive: true });
    const logPath = path.join(OUT_DIR, 'verify_phrasing.log');
    const logStream = await fs.open(logPath, 'w');
    const log = (msg) => {
        const ts = new Date().toISOString();
        const line = `[${ts}] ${msg}\n`;
        process.stdout.write(line);
        logStream.write(line);
    };

    log(`loading geojson...`);
    const geo = JSON.parse(await fs.readFile(GEOJSON, 'utf8'));
    const countyIndex = buildCountyIndex(geo);
    log(`indexed ${geo.features.length} counties across ${countyIndex.size} CWAs`);

    const wfo = JSON.parse(await fs.readFile(WFO_PATH, 'utf8'));
    const offices = wfo.offices || wfo;
    const argFilter = process.argv.slice(2).map(s => s.toUpperCase());
    const allCwas = Object.keys(offices).filter(k => /^[A-Z]{3}$/.test(k)).sort();
    const cwas = argFilter.length ? allCwas.filter(c => argFilter.includes(c)) : allCwas;
    log(`will verify ${cwas.length} CWAs across ${SAMPLE_DATES.length} sample dates`);

    const report = {
        generatedAt: new Date().toISOString(),
        dateStart: SAMPLE_DATES[0],
        dateEnd: SAMPLE_DATES[SAMPLE_DATES.length - 1],
        cwas: []
    };

    let idx = 0;
    for (const cwa of cwas) {
        idx++;
        log(`[${idx}/${cwas.length}] ${cwa} starting...`);
        try {
            const r = await verifyOneCwa(cwa, countyIndex, log);
            report.cwas.push(r);
            log(`[${idx}/${cwas.length}] ${cwa} done — ${r.matches}/${r.countyLines} match, ${r.mismatchCount} mismatch, ${r.orphanCount} orphan`);
        } catch (err) {
            log(`[${idx}/${cwas.length}] ${cwa} FAILED — ${err.message}`);
            report.cwas.push({ cwa, error: err.message });
        }
        await fs.writeFile(path.join(OUT_DIR, 'verify_report.json'), JSON.stringify(report, null, 2));
    }

    await writeMarkdownSummary(report, path.join(OUT_DIR, 'verify_report.md'));
    log(`done. wrote verify_report.json + verify_report.md to ${OUT_DIR}`);
    await logStream.close();
}

main().catch(err => {
    console.error('fatal:', err);
    process.exit(1);
});
