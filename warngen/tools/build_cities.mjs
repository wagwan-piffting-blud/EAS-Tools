#!/usr/bin/env node
/**
 * Build warngen/data/us_cities.json and warngen/data/places/<CWA>.json from WarnGen's own
 * point source, the AWIPS mapdata.warngenloc table, as dumped from Unidata's public EDEX
 * by fetch_warngenloc.py.
 *
 *   C:/tmp/awenv/Scripts/python warngen/tools/fetch_warngenloc.py
 *   node warngen/tools/build_cities.mjs
 *
 * Keeps only what some geospatialConfig pointSource/pathcastConfig can select: WARNGENLEV
 * 1-4 and LANDWATER L/LW/LC. Each point keeps the schema the app already reads
 * (name, state, lat, lon, pop, fips) plus cwa, lev (WARNGENLEV), lw (LANDWATER), gid, and
 * ud/sd (USEDIRS/SUPDIRS) where set.
 *
 * fips is the county the point falls in, resolved with the app's own point-in-polygon
 * after moving AK/HI/territories into the basemap's inset space, because the app filters
 * the list to an office by county.
 *
 * The place outlines are too heavy to ship nationally, so they are split per office by
 * county ownership and keyed by gid; the app loads one file when an office is picked.
 */

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { INSETS, TERRITORY_INSETS, applyInset } from './inset.mjs';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const Intersect = require(path.join(ROOT, 'src', 'geo', 'intersect.js'));

const srcPath = process.argv[2] || path.join(__dirname, 'output', 'warngenloc.json');
const src = JSON.parse(fs.readFileSync(srcPath, 'utf8'));

const LEVELS = new Set([1, 2, 3, 4]);
// Land sets for the county and zone configs, W and C for the marine one.
const LANDWATER = new Set(['L', 'LW', 'LC', 'W', 'C']);

const counties = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'us_counties.geojson'), 'utf8'));
const cwaCountyIndex = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'cwa_county_index.json'), 'utf8'));

const cwasByFips = {};
for (const [cwa, list] of Object.entries(cwaCountyIndex)) {
    if (!Array.isArray(list)) continue;
    for (const fips of list) (cwasByFips[fips] = cwasByFips[fips] || []).push(cwa);
}

const outlines = counties.features.filter(f => f.properties.cwa).map(f => {
    const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
    const rings = polys.map(p => p[0]);
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const ring of rings) {
        for (const [x, y] of ring) {
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
        }
    }
    return { feat: f, state: f.properties.state, rings, minX, minY, maxX, maxY };
});

const one = { type: 'FeatureCollection', features: [null] };

function countyContaining(lat, lon) {
    for (const o of outlines) {
        if (lon < o.minX || lon > o.maxX || lat < o.minY || lat > o.maxY) continue;
        one.features[0] = o.feat;
        if (Intersect.findFeatureContaining([lon, lat], one)) return o.feat;
    }
    return null;
}

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

/** Same-state nearest edge, as in build_airports.mjs: shoreline points miss the simplified outlines. */
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

function round4(v) {
    return Math.round(v * 1e4) / 1e4;
}

const counts = { rows: 0, filtered: 0, noState: 0, inset: 0, nearest: 0, noCounty: 0, kept: 0, outlines: 0 };
const knownStates = new Set(outlines.map(o => o.state));
const cities = [];
const placesByCwa = {};

for (const r of src.rows) {
    counts.rows++;
    if (!LEVELS.has(r.warngenlev) || !LANDWATER.has(r.landwater) || !r.name) { counts.filtered++; continue; }
    if (!knownStates.has(r.st) || r.lat == null || r.lon == null) { counts.noState++; continue; }

    const inset = INSETS[r.st] || TERRITORY_INSETS[r.st];
    const unwrapState = INSETS[r.st] ? r.st : '';
    let lat = r.lat;
    let lon = r.lon;
    if (inset) {
        [lat, lon] = applyInset(inset, unwrapState, lat, lon);
        counts.inset++;
    }

    let county = countyContaining(lat, lon);
    if (county && county.properties.state !== r.st) county = null;
    if (!county) {
        county = nearestCounty(lat, lon, r.st);
        if (county) counts.nearest++;
    }
    if (!county) { counts.noCounty++; continue; }

    const city = {
        name: r.name,
        state: r.st,
        lat: round4(lat),
        lon: round4(lon),
        pop: r.population,
        fips: county.properties.fips,
        cwa: r.cwa,
        lev: r.warngenlev,
        lw: r.landwater,
        gid: r.gid
    };
    if (r.usedirs) city.ud = 1;
    if (r.supdirs) city.sd = r.supdirs.toLowerCase();
    cities.push(city);
    counts.kept++;

    if (r.rings) {
        const rings = r.rings.map(ring => ring.map(([x, y]) => {
            if (!inset) return [x, y];
            const [ty, tx] = applyInset(inset, unwrapState, y, x);
            return [round4(tx), round4(ty)];
        }));
        for (const cwa of cwasByFips[city.fips] || [county.properties.cwa]) {
            (placesByCwa[cwa] = placesByCwa[cwa] || {})[r.gid] = rings;
        }
        counts.outlines++;
    }
}

cities.sort((a, b) => a.state.localeCompare(b.state) || a.lev - b.lev || b.pop - a.pop || a.name.localeCompare(b.name));

const out = path.join(ROOT, 'data', 'us_cities.json');
fs.writeFileSync(out, JSON.stringify({
    _comment: [
        'WarnGen point source (AWIPS mapdata.warngenloc), filtered to WARNGENLEV 1-4 and LANDWATER L/LW/LC.',
        'Source: ' + src.source + ', fetched ' + src.fetched + '.',
        'Built by warngen/tools/build_cities.mjs. lat/lon are basemap coordinates (AK/HI/territories inset).',
        'lev = WARNGENLEV, lw = LANDWATER, fips = containing county, ud/sd = USEDIRS/SUPDIRS.',
        'Place outlines live in data/places/<CWA>.json, keyed by gid.'
    ],
    cities
}));

const placesDir = path.join(ROOT, 'data', 'places');
fs.rmSync(placesDir, { recursive: true, force: true });
fs.mkdirSync(placesDir, { recursive: true });
let placesBytes = 0, placesMax = 0;
for (const [cwa, byGid] of Object.entries(placesByCwa)) {
    const file = path.join(placesDir, cwa + '.json');
    fs.writeFileSync(file, JSON.stringify(byGid));
    const size = fs.statSync(file).size;
    placesBytes += size;
    if (size > placesMax) placesMax = size;
}

const byState = {};
cities.forEach(c => { byState[c.state] = (byState[c.state] || 0) + 1; });
const byLev = {};
cities.forEach(c => { byLev[c.lev] = (byLev[c.lev] || 0) + 1; });
console.log(`source rows     : ${counts.rows}  (${src.source}, ${src.fetched})`);
console.log(`points kept     : ${counts.kept}  by lev ${JSON.stringify(byLev)}`);
console.log(`  lev/lw filter : ${counts.filtered}`);
console.log(`  no basemap    : ${counts.noState}  (state not on the basemap)`);
console.log(`  inset-mapped  : ${counts.inset}`);
console.log(`  via nearest   : ${counts.nearest}`);
console.log(`  no county     : ${counts.noCounty}`);
console.log(`states          : ${Object.keys(byState).length}`);
console.log(`output          : ${out}  (${(fs.statSync(out).size / 1048576).toFixed(2)} MB)`);
console.log(`outlines        : ${counts.outlines} in ${Object.keys(placesByCwa).length} office files, `
    + `${(placesBytes / 1048576).toFixed(2)} MB total, largest ${(placesMax / 1048576).toFixed(2)} MB`);
