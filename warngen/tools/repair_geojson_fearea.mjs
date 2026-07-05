import fs from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT      = path.resolve(__dirname, '..');
const DBF_PATH  = path.join(ROOT, 'data', 'awips_counties', 'c_16ap26.dbf');
const GEOJSON   = path.join(ROOT, 'data', 'us_counties.geojson');
const BACKUP    = path.join(ROOT, 'data', 'us_counties.geojson.pre-fearea.bak');
const OUT_DIR   = path.join(__dirname, 'output');

const FE_AREA_TO_ARRAY = {
    '':   [],
    'cc': ['CENTRAL'],
    'nn': ['NORTH'],
    'ss': ['SOUTH'],
    'ee': ['EAST'],
    'ww': ['WEST'],
    'nc': ['NORTH', 'CENTRAL'],
    'sc': ['SOUTH', 'CENTRAL'],
    'ec': ['EAST',  'CENTRAL'],
    'wc': ['WEST',  'CENTRAL'],
    'ne': ['NORTH', 'EAST'],
    'nw': ['NORTH', 'WEST'],
    'se': ['SOUTH', 'EAST'],
    'sw': ['SOUTH', 'WEST']
};
const PASSTHROUGH_CODES = new Set([
    'pa', 'mi', 'up', 'bb', 'pd', 'ds',
    'ea', 'we', 'so',
    'sr', 'wu', 'nr', 'eu', 'er'
]);

function codeToArray(fe) {
    if (fe in FE_AREA_TO_ARRAY) return FE_AREA_TO_ARRAY[fe];
    if (PASSTHROUGH_CODES.has(fe)) return [fe.toUpperCase()];
    return null;
}

function readDbf(buf) {
    const numRecords = buf.readUInt32LE(4);
    const headerLen  = buf.readUInt16LE(8);
    const recordLen  = buf.readUInt16LE(10);
    const numFields  = Math.floor((headerLen - 33) / 32);
    const fields = [];
    for (let i = 0; i < numFields; i++) {
        const off = 32 + i * 32;
        const name = buf.slice(off, off + 11).toString('ascii').replace(/\0+$/, '').trim();
        const type = String.fromCharCode(buf[off + 11]);
        const len  = buf[off + 16];
        fields.push({ name, type, len });
    }
    const records = [];
    for (let r = 0; r < numRecords; r++) {
        const recOff = headerLen + r * recordLen;
        if (buf[recOff] === 0x2A) continue;
        let pos = recOff + 1;
        const row = {};
        for (const f of fields) {
            row[f.name] = buf.slice(pos, pos + f.len).toString('ascii').trim();
            pos += f.len;
        }
        records.push(row);
    }
    return records;
}

function arrayEqual(a, b) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
}

async function main() {
    await fs.mkdir(OUT_DIR, { recursive: true });

    console.log('reading DBF...');
    const dbfBuf = readFileSync(DBF_PATH);
    const records = readDbf(dbfBuf);
    console.log(`  ${records.length} rows`);

    const byFips = new Map();
    const dupFips = [];
    for (const r of records) {
        const fips = r.FIPS;
        const fe   = (r.FE_AREA || '').toLowerCase();
        if (byFips.has(fips)) dupFips.push(fips);
        byFips.set(fips, { feArea: fe, state: r.STATE, cwa: r.CWA, name: r.COUNTYNAME });
    }
    console.log(`  ${byFips.size} unique FIPS (${dupFips.length} duplicates noted)`);

    console.log('reading geojson...');
    const geo = JSON.parse(readFileSync(GEOJSON, 'utf8'));
    console.log(`  ${geo.features.length} features`);

    if (!existsSync(BACKUP)) {
        await fs.copyFile(GEOJSON, BACKUP);
        console.log(`  backed up to ${path.basename(BACKUP)}`);
    } else {
        console.log(`  backup already exists; not overwriting`);
    }

    let changed   = 0;
    let unchanged = 0;
    let notFound  = 0;
    let unknownCode = 0;
    const changes = [];
    const missing = [];
    const unknown = [];

    for (const feat of geo.features) {
        const p = feat.properties;
        if (!p || !p.fips) continue;
        const fips = String(p.fips);

        const rec = byFips.get(fips);
        if (!rec) {
            notFound++;
            missing.push({ fips, name: p.name, state: p.state });
            continue;
        }

        const arr = codeToArray(rec.feArea);
        if (arr === null) {
            unknownCode++;
            unknown.push({ fips, name: p.name, state: p.state, code: rec.feArea });
            continue;
        }

        const before = Array.isArray(p.partOfParentRegion) ? p.partOfParentRegion : [];
        if (!arrayEqual(before, arr)) {
            changes.push({ fips, name: p.name, state: p.state, before, after: arr });
            p.partOfParentRegion = arr;
            changed++;
        } else {
            unchanged++;
        }
    }

    console.log(`changed:   ${changed}`);
    console.log(`unchanged: ${unchanged}`);
    console.log(`not found: ${notFound}`);
    console.log(`unknown FE_AREA: ${unknownCode}`);

    console.log('writing geojson...');
    await fs.writeFile(GEOJSON, JSON.stringify(geo));
    console.log('  done.');

    const lines = [];
    lines.push(`# Geojson partOfParentRegion repair from AWIPS FE_AREA`);
    lines.push('');
    lines.push(`Run: ${new Date().toISOString()}`);
    lines.push(`Source: c_16ap26.dbf (${records.length} rows)`);
    lines.push(`Geojson: ${geo.features.length} features`);
    lines.push('');
    lines.push(`- changed: **${changed}**`);
    lines.push(`- unchanged: ${unchanged}`);
    lines.push(`- not found in shapefile: ${notFound}`);
    lines.push(`- unknown FE_AREA code: ${unknownCode}`);
    lines.push('');

    if (missing.length) {
        lines.push(`## Counties in geojson but not in shapefile (${missing.length})`);
        for (const m of missing.slice(0, 50)) {
            lines.push(`- ${m.fips} ${m.name} ${m.state}`);
        }
        if (missing.length > 50) lines.push(`- … and ${missing.length - 50} more`);
        lines.push('');
    }
    if (unknown.length) {
        lines.push(`## Unknown FE_AREA codes`);
        for (const u of unknown) lines.push(`- ${u.fips} ${u.name} ${u.state} → '${u.code}'`);
        lines.push('');
    }

    const groups = new Map();
    for (const c of changes) {
        const key = `${c.state} :: [${c.before.join(',') || '∅'}] → [${c.after.join(',') || '∅'}]`;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(c);
    }
    const sortedGroups = [...groups.entries()].sort((a, b) => b[1].length - a[1].length);
    lines.push(`## Changes by (state, before → after) — top 50 groups`);
    lines.push('');
    for (const [key, items] of sortedGroups.slice(0, 50)) {
        const sample = items.slice(0, 5).map(i => `${i.name} (${i.fips})`).join(', ');
        lines.push(`- **${key}** — ${items.length}× (${sample}${items.length > 5 ? ', …' : ''})`);
    }
    lines.push('');

    await fs.writeFile(path.join(OUT_DIR, 'repair_report.md'), lines.join('\n'));
    console.log(`wrote ${path.join(OUT_DIR, 'repair_report.md')}`);
}

main().catch(err => { console.error(err); process.exit(1); });
