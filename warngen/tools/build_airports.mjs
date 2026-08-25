#!/usr/bin/env node
/**
 * Build warngen/data/us_airports.json from the OurAirports database (public domain).
 *
 *   curl -o airports.csv https://davidmegginson.github.io/ourairports-data/airports.csv
 *   node tools/build_airports.mjs C:/tmp/wgdata/airports.csv
 *
 * Keeps US airports an office would actually warn on: every large and medium field, plus
 * small fields with scheduled service. Heliports, seaplane bases, balloonports and closed
 * fields are dropped.
 *
 * Each airport carries the CWA that owns the county it sits in, resolved with the app's
 * own point-in-polygon, and a warning box roughly 5 NM around the field -- the radius the
 * AWW template's lightning threat already speaks in.
 */

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { INSETS, isUnplaceable, applyInset } from './inset.mjs';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const Intersect = require(path.join(ROOT, 'src', 'geo', 'intersect.js'));

const csvPath = process.argv[2];
if (!csvPath) {
    console.error('usage: build_airports.mjs <airports.csv>');
    process.exit(2);
}

const BOX_NM = 5;
const NM_PER_DEG_LAT = 60;

function parseCsvLine(line) {
    const out = [];
    let cur = '';
    let q = false;
    for (let i = 0; i < line.length; i++) {
        const c = line[i];
        if (q) {
            if (c === '"') {
                if (line[i + 1] === '"') { cur += '"'; i++; } else { q = false; }
            } else cur += c;
        } else if (c === '"') q = true;
        else if (c === ',') { out.push(cur); cur = ''; }
        else cur += c;
    }
    out.push(cur);
    return out;
}

/**
 * AWIPS builds the AWW PIL as AWW + a three-character site id, so prefer the codes that
 * are actually three characters before falling back to trimming an ICAO K-prefix.
 */
function siteIdFor(row) {
    const cands = [row.iata_code, row.local_code, row.gps_code, row.icao_code, row.ident];
    for (const c of cands) {
        if (c && /^[A-Z0-9]{3}$/i.test(c)) return c.toUpperCase();
    }
    for (const c of cands) {
        if (c && /^K[A-Z0-9]{3}$/i.test(c)) return c.slice(1).toUpperCase();
    }
    return null;
}

function boxAround(lat, lon) {
    const dLat = BOX_NM / NM_PER_DEG_LAT;
    const dLon = dLat / Math.max(0.1, Math.cos(lat * Math.PI / 180));
    return [
        [lat + dLat, lon - dLon],
        [lat + dLat, lon + dLon],
        [lat - dLat, lon + dLon],
        [lat - dLat, lon - dLon]
    ];
}

/** LAT...LON encoding: hundredths of a degree, latitude first, longitude positive-west. */
function toLatLonCoords(box) {
    return 'LAT...LON ' + box
        .map(([lat, lon]) => Math.round(lat * 100) + ' ' + Math.round(-lon * 100))
        .join(' ');
}

const counties = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'us_counties.geojson'), 'utf8'));

/**
 * Alaska boroughs and a handful of shoreline fields sit outside the simplified county
 * outlines. Fall back to the nearest county centroid, but only within the airport's own
 * state -- Alaska boroughs are large enough that a distance cap either misses them all or
 * lets a genuinely offshore point borrow someone else's CWA.
 */
// Valdez-Cordova (a retired FIPS) and Kalawao carry no CWA, so they can never answer the
// question this lookup is asking.
const outlines = counties.features.filter(f => f.properties.cwa).map(f => {
    const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
    return { feat: f, state: f.properties.state, rings: polys.map(p => p[0]) };
});

function segDistSq(px, py, ax, ay, bx, by, kx) {
    const dx = (bx - ax) * kx;
    const dy = by - ay;
    const wx = (px - ax) * kx;
    const wy = py - ay;
    const len = dx * dx + dy * dy;
    const t = len === 0 ? 0 : Math.max(0, Math.min(1, (wx * dx + wy * dy) / len));
    const ex = wx - t * dx;
    const ey = wy - t * dy;
    return ex * ex + ey * ey;
}

/**
 * Distance to the nearest polygon edge, not to a centroid: Alaska's boroughs are large
 * and irregular enough that the nearest centroid is routinely the wrong borough.
 */
function nearestCounty(lat, lon, state) {
    const kx = Math.cos(lat * Math.PI / 180);
    let best = null;
    let bestD = Infinity;
    for (const o of outlines) {
        if (o.state !== state) continue;
        for (const ring of o.rings) {
            for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
                const d = segDistSq(lon, lat, ring[j][0], ring[j][1], ring[i][0], ring[i][1], kx);
                if (d < bestD) { bestD = d; best = o.feat; }
            }
        }
    }
    return best;
}

const lines = fs.readFileSync(csvPath, 'utf8').split(/\r?\n/);
const header = parseCsvLine(lines[0]);
const col = Object.fromEntries(header.map((h, i) => [h.replace(/^"|"$/g, ''), i]));

const KEEP = new Set(['large_airport', 'medium_airport']);
const airports = [];
const counts = { rows: 0, us: 0, kept: 0, noSite: 0, noCwa: 0, dupSite: 0, nearest: 0, inset: 0, unplaceable: 0 };
const seen = new Set();

for (let i = 1; i < lines.length; i++) {
    if (!lines[i]) continue;
    counts.rows++;
    const r = parseCsvLine(lines[i]);
    if (r[col.iso_country] !== 'US') continue;
    counts.us++;

    const type = r[col.type];
    const scheduled = r[col.scheduled_service] === 'yes';
    if (!KEEP.has(type) && !(type === 'small_airport' && scheduled)) continue;

    let lat = parseFloat(r[col.latitude_deg]);
    let lon = parseFloat(r[col.longitude_deg]);
    if (!isFinite(lat) || !isFinite(lon)) continue;

    // Alaska and Hawaii live at inset coordinates on this basemap, so move them before
    // the county lookup -- otherwise every one of them misses and lands in the wrong CWA.
    const region = (r[col.iso_region] || '').replace(/^US-/, '');
    if (INSETS[region]) {
        [lat, lon] = applyInset(INSETS[region], region, lat, lon);
        counts.inset++;
    }

    const row = {
        ident: r[col.ident], iata_code: r[col.iata_code], local_code: r[col.local_code],
        gps_code: r[col.gps_code], icao_code: r[col.icao_code]
    };
    const site = siteIdFor(row);
    if (!site) { counts.noSite++; continue; }

    let county = Intersect.findFeatureContaining([lon, lat], counties);
    if (county && !county.properties.cwa) county = null;
    if (!county) {
        county = nearestCounty(lat, lon, region);
        if (county) counts.nearest++;
    }
    if (!county) { counts.noCwa++; continue; }

    if (isUnplaceable(county.properties.cwa)) { counts.unplaceable++; continue; }

    const key = county.properties.cwa + '/' + site;
    if (seen.has(key)) { counts.dupSite++; continue; }
    seen.add(key);

    airports.push({
        site: site,
        name: r[col.name],
        city: r[col.municipality] || '',
        state: region,
        cwa: county.properties.cwa,
        lat: Math.round(lat * 1e4) / 1e4,
        lon: Math.round(lon * 1e4) / 1e4,
        coords: toLatLonCoords(boxAround(lat, lon))
    });
    counts.kept++;
}

airports.sort((a, b) => (a.cwa + a.site).localeCompare(b.cwa + b.site));

const byCwa = {};
airports.forEach(a => { (byCwa[a.cwa] = byCwa[a.cwa] || []).push(a); });

const out = path.join(ROOT, 'data', 'us_airports.json');
fs.writeFileSync(out, JSON.stringify({
    _comment: [
        'US airports an NWS office may issue an Airport Weather Warning for, grouped by CWA.',
        'Source: OurAirports (public domain), https://davidmegginson.github.io/ourairports-data/',
        'Built by warngen/tools/build_airports.mjs. coords is the LAT...LON encoded warning',
        'box, roughly 5 NM around the field, matching the AWW template lightning radius.'
    ],
    airports: byCwa
}));

const sizes = Object.entries(byCwa).map(([, v]) => v.length);
console.log(`csv rows        : ${counts.rows}  (US ${counts.us})`);
console.log(`airports kept   : ${counts.kept}`);
console.log(`  no 3-char id  : ${counts.noSite}`);
console.log(`  inset-mapped  : ${counts.inset}  (AK/HI moved into basemap inset space)`);
console.log(`  via nearest   : ${counts.nearest}`);
console.log(`  unplaceable   : ${counts.unplaceable}  (CWA has no verified inset transform)`);
console.log(`  outside county: ${counts.noCwa}`);
console.log(`  dup per CWA   : ${counts.dupSite}`);
console.log(`cwas covered    : ${Object.keys(byCwa).length}  (min ${Math.min(...sizes)}, max ${Math.max(...sizes)} per CWA)`);
console.log(`output          : ${out}  (${(fs.statSync(out).size / 1048576).toFixed(2)} MB)`);
