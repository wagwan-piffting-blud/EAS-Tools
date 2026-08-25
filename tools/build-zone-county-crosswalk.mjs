#!/usr/bin/env node
/**
 * Build assets/E2T/include/zone-county.json, mapping every NWS public forecast zone to the
 * SAME FIPS codes it covers.
 *
 *   node tools/build-zone-county-crosswalk.mjs
 *
 * SAME only speaks county FIPS, but a large share of NWS products are zone-based (Special
 * Weather Statement, Significant Weather Advisory, Short Term Forecast, Fire Warning, every
 * winter and heat product). Converting one of those to a ZCZC header means resolving its
 * UGC zones to counties first, and that is a geometry question rather than a lookup.
 *
 * Two passes catch both directions of the many-to-many:
 *   - counties whose centroid lies inside the zone  (a zone spanning several counties)
 *   - the county containing the zone's centroid     (several zones splitting one county)
 *
 * Reads warngen/data/forecast_zones.geojson and warngen/data/us_counties.geojson, both of
 * which are already in the basemap's inset space, so Alaska and Hawaii line up.
 */

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const Intersect = require(path.join(ROOT, 'warngen', 'src', 'geo', 'intersect.js'));

const zones = JSON.parse(fs.readFileSync(
    path.join(ROOT, 'warngen', 'data', 'forecast_zones.geojson'), 'utf8'));
const counties = JSON.parse(fs.readFileSync(
    path.join(ROOT, 'warngen', 'data', 'us_counties.geojson'), 'utf8'));

function outerRings(feature) {
    const polys = feature.geometry.type === 'Polygon'
        ? [feature.geometry.coordinates]
        : feature.geometry.coordinates;
    return polys.map(p => p[0]);
}

function centroid(feature) {
    let x = 0;
    let y = 0;
    let n = 0;
    for (const ring of outerRings(feature)) {
        for (const p of ring) { x += p[0]; y += p[1]; n++; }
    }
    return n ? [x / n, y / n] : null;
}

function bbox(feature) {
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (const ring of outerRings(feature)) {
        for (const [x, y] of ring) {
            if (x < x0) x0 = x;
            if (x > x1) x1 = x;
            if (y < y0) y0 = y;
            if (y > y1) y1 = y;
        }
    }
    return [x0, y0, x1, y1];
}

function bboxHit(a, b) {
    return !(a[2] < b[0] || b[2] < a[0] || a[3] < b[1] || b[3] < a[1]);
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

function pointInFeature(pt, feature) {
    return !!Intersect.findFeatureContaining(pt, { type: 'FeatureCollection', features: [feature] });
}

/** SAME FIPS is a six-digit PSSCCC; the leading digit is 0 for a whole county. */
function sameFips(countyFeature) {
    return '0' + String(countyFeature.properties.fips).padStart(5, '0');
}

const countiesByState = {};
for (const c of counties.features) {
    const st = c.properties.state;
    if (!st) continue;
    (countiesByState[st] = countiesByState[st] || []).push({
        feat: c,
        bbox: bbox(c),
        centroid: centroid(c),
        same: sameFips(c)
    });
}

const out = {};
const counts = { zones: 0, empty: 0, viaCentroidIn: 0, viaContaining: 0, viaNearest: 0, multi: 0 };
const emptyExamples = [];

for (const z of zones.features) {
    const st = z.properties.state;
    const key = st + 'Z' + z.properties.fips;
    const pool = countiesByState[st] || [];
    if (!pool.length) { counts.empty++; if (emptyExamples.length < 8) emptyExamples.push(key); continue; }

    counts.zones++;
    const zb = bbox(z);
    const zc = centroid(z);
    const hits = new Set();

    for (const c of pool) {
        if (!bboxHit(zb, c.bbox)) continue;
        if (c.centroid && pointInFeature(c.centroid, z)) {
            hits.add(c.same);
        }
    }
    if (hits.size) counts.viaCentroidIn++;

    if (zc) {
        for (const c of pool) {
            if (!bboxHit(zb, c.bbox)) continue;
            if (pointInFeature(zc, c.feat)) { hits.add(c.same); counts.viaContaining++; break; }
        }
    }

    // Coastal and island zones can have a centroid over water with no county centroid
    // inside them either. Fall back to whichever county in the state has the nearest edge.
    if (!hits.size && zc) {
        let best = null;
        let bestD = Infinity;
        const kx = Math.cos(zc[1] * Math.PI / 180);
        for (const c of pool) {
            for (const ring of outerRings(c.feat)) {
                for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
                    const d = segDistSq(zc[0], zc[1], ring[j][0], ring[j][1], ring[i][0], ring[i][1], kx);
                    if (d < bestD) { bestD = d; best = c; }
                }
            }
        }
        if (best) { hits.add(best.same); counts.viaNearest++; }
    }

    if (!hits.size) {
        counts.empty++;
        if (emptyExamples.length < 8) emptyExamples.push(key);
        continue;
    }
    if (hits.size > 1) counts.multi++;
    out[key] = [...hits].sort();
}

const dest = path.join(ROOT, 'assets', 'E2T', 'include', 'zone-county.json');
fs.writeFileSync(dest, JSON.stringify(out));

console.log(`zones mapped     : ${Object.keys(out).length} of ${zones.features.length}`);
console.log(`  multi-county   : ${counts.multi}`);
console.log(`  county centroid: ${counts.viaCentroidIn}`);
console.log(`  zone centroid  : ${counts.viaContaining}`);
console.log(`  nearest county : ${counts.viaNearest}`);
console.log(`unmapped         : ${counts.empty}${emptyExamples.length ? '  e.g. ' + emptyExamples.join(' ') : ''}`);
console.log(`output           : ${dest}  (${(fs.statSync(dest).size / 1024).toFixed(0)} KB)`);
