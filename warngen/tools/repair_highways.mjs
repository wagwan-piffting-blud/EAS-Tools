/**
 * Applies highway_fixes.json to data/us_highways.geojson.
 *
 *   node warngen/tools/repair_highways.mjs [--dry-run]
 *
 * Natural Earth tags many US and state freeways as interstates under their own number
 * ("Interstate 101"), and a few interstate segments carry a neighbouring route's number.
 * The fixes were found with audit_highways.py and checked by hand. A relabelled segment's
 * mmOffset belonged to the wrong route, so it is re-derived from a segment of the new route
 * it touches end to end, flipping the segment when it runs against that route's mileage.
 *
 * Also drops stateless stubs of 1 km or less: junction connectors whose missing state and
 * mmOffset gave the bulletin a second "near mile marker 0" line for the same route; and
 * carries mileage across places where a road switches between the US and state classes,
 * which both print as "Highway N" but were numbered from separate zeros.
 *
 * The file before the first run is kept at tools/output/us_highways.pre-repair.json, and
 * reruns always start from it, so the fixes table is the single source of truth.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT      = path.resolve(__dirname, '..');
const GEOJSON   = path.join(ROOT, 'data', 'us_highways.geojson');
const FIXES     = path.join(__dirname, 'highway_fixes.json');
const OUT_DIR   = path.join(__dirname, 'output');
const PRISTINE  = path.join(OUT_DIR, 'us_highways.pre-repair.json');
const DRY_RUN   = process.argv.includes('--dry-run');
const MAX_GAP_DEG = 0.5;

function haversineMiles(a, b) {
    const R = 3958.8;
    const lat1 = a[1] * Math.PI / 180;
    const lat2 = b[1] * Math.PI / 180;
    const dLat = (b[1] - a[1]) * Math.PI / 180;
    const dLon = (b[0] - a[0]) * Math.PI / 180;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
}

function linesOf(f) {
    return f.geometry.type === 'LineString' ? [f.geometry.coordinates] : f.geometry.coordinates;
}

function ends(f) {
    const lines = linesOf(f);
    const last = lines[lines.length - 1];
    return [lines[0][0], last[last.length - 1]];
}

function featureKey(f) {
    const [a, b] = ends(f);
    const p = f.properties;
    return [p.cls, p.num, a[0].toFixed(3), a[1].toFixed(3), b[0].toFixed(3), b[1].toFixed(3)].join(':');
}

// highways.js measures each LineString on its own from mmOffset, so a MultiLineString's
// mileage runs off its first part.
function lengthMiles(f) {
    const line = linesOf(f)[0];
    let miles = 0;
    for (let i = 1; i < line.length; i++) miles += haversineMiles(line[i - 1], line[i]);
    return miles;
}

function reverse(f) {
    if (f.geometry.type === 'LineString') {
        f.geometry.coordinates.reverse();
    } else {
        f.geometry.coordinates.reverse();
        f.geometry.coordinates.forEach((l) => l.reverse());
    }
}

/**
 * mmOffset for f from the nearest vertex of a same-route neighbour. The two datasets split
 * routes at different junctions, so f often meets a neighbour mid-line, or across a short
 * gap where Natural Earth dropped a piece; the gap is added to the mileage.
 */
function offsetFrom(f, neighbours) {
    const fEnds = ends(f);
    let best = null;
    for (const nb of neighbours) {
        const line = linesOf(nb)[0];
        let along = 0;
        for (let i = 0; i < line.length; i++) {
            if (i) along += haversineMiles(line[i - 1], line[i]);
            for (let e = 0; e < 2; e++) {
                const deg = Math.hypot(fEnds[e][0] - line[i][0], fEnds[e][1] - line[i][1]);
                if (deg > MAX_GAP_DEG || (best && deg >= best.deg)) continue;
                best = { deg, end: e, atStart: i === 0, mm: nb.properties.mmOffset + along, gap: haversineMiles(fEnds[e], line[i]) };
            }
        }
    }
    if (!best) return null;
    const len = lengthMiles(f);
    // Meeting a neighbour's first vertex means f comes before it, unless that would put f
    // below mile 0; then the neighbour's own offset is the suspect one and f follows it.
    if (best.atStart && best.mm - best.gap - len >= 0) {
        return { mm: best.mm - best.gap - len, flip: best.end === 0, gapMiles: best.gap };
    }
    return { mm: best.mm + best.gap, flip: best.end === 1, gapMiles: best.gap };
}

const source = existsSync(PRISTINE) ? PRISTINE : GEOJSON;
const doc = JSON.parse(readFileSync(source, 'utf8'));
const { fixes } = JSON.parse(readFileSync(FIXES, 'utf8'));

const byKey = new Map();
doc.features.forEach((f) => {
    const k = featureKey(f);
    byKey.set(k, (byKey.get(k) || []).concat([f]));
});

const problems = [];
const dropped = new Set();
const pending = [];
const counts = { relabel: 0, reclass: 0, drop: 0, stubs: 0 };

for (const [key, fix] of Object.entries(fixes)) {
    const hits = byKey.get(key) || [];
    if (hits.length !== 1) {
        problems.push(`${key}: matches ${hits.length} features`);
        continue;
    }
    const f = hits[0];
    const p = f.properties;
    counts[fix.action]++;
    if (fix.action === 'drop') {
        dropped.add(f);
        continue;
    }
    if (fix.num) p.num = fix.num;
    p.cls = fix.cls;
    p.displayName = (fix.cls === 'interstate' ? 'Interstate ' : 'Highway ') + p.num;
    if (fix.action === 'relabel') pending.push(f);
}

doc.features.forEach((f) => {
    if (!f.properties.state && f.properties.length_km <= 1 && !dropped.has(f)) {
        dropped.add(f);
        counts.stubs++;
    }
});

const resolved = new Map();
let progress = true;
while (progress) {
    progress = false;
    for (const f of pending) {
        if (resolved.has(f)) continue;
        const p = f.properties;
        const neighbours = doc.features.filter((nb) => nb !== f && !dropped.has(nb)
            && nb.properties.cls === 'interstate' && nb.properties.num === p.num && nb.properties.state === p.state
            && typeof nb.properties.mmOffset === 'number'
            && (!pending.includes(nb) || resolved.has(nb)));
        const hit = offsetFrom(f, neighbours);
        if (!hit) continue;
        if (hit.flip) reverse(f);
        p.mmOffset = Math.round(hit.mm);
        resolved.set(f, hit.gapMiles);
        progress = true;
    }
}

const unresolved = pending.filter((f) => !resolved.has(f));
doc.features = doc.features.filter((f) => !dropped.has(f));

/**
 * US and state routes both print "Highway N", and Natural Earth sometimes files a road
 * under one class for part of its length and the other for the rest. The build numbered
 * each class in a state from its own 0, so the mileage restarted at the switch (US 81 at
 * York, NE). When one class's lowest-mileage end meets the other class, that whole class
 * is shifted to carry on from the mileage there.
 */
const JOIN_GAP_DEG = 0.05;
const byRouteNum = new Map();
doc.features.forEach((f) => {
    const p = f.properties;
    if ((p.cls !== 'us' && p.cls !== 'state') || !p.state || typeof p.mmOffset !== 'number') return;
    const k = p.state + ':' + p.num;
    byRouteNum.set(k, (byRouteNum.get(k) || []).concat([f]));
});
const joined = [];
byRouteNum.forEach((features) => {
    const runs = ['us', 'state'].map((cls) => features.filter((f) => f.properties.cls === cls)).filter((r) => r.length);
    if (runs.length < 2) return;
    const shifted = new Set();
    let moved = true;
    while (moved) {
        moved = false;
        for (const run of runs) {
            if (shifted.has(run)) continue;
            const low = run.reduce((m, f) => (f.properties.mmOffset < m.properties.mmOffset ? f : m));
            const others = runs.filter((r) => r !== run && r[0].properties.cls !== run[0].properties.cls).flat();
            const hit = offsetFrom({ geometry: { type: 'LineString', coordinates: [ends(low)[0], ends(low)[0]] } }, others);
            if (!hit || hit.gapMiles > JOIN_GAP_DEG * 69 || hit.mm <= low.properties.mmOffset + 1) continue;
            const delta = Math.round(hit.mm - low.properties.mmOffset);
            run.forEach((f) => { f.properties.mmOffset += delta; });
            shifted.add(run);
            joined.push(`${low.properties.state} ${low.properties.displayName} (${low.properties.cls}, ${run.length} segments) +${delta}`);
            moved = true;
        }
    }
});

console.log(`source: ${path.relative(ROOT, source)}`);
console.log(`relabelled ${counts.relabel}, reclassified ${counts.reclass}, dropped ${counts.drop} + ${counts.stubs} stateless stubs`);
console.log(`mile markers re-derived for ${resolved.size} of ${pending.length} relabelled segments`);
resolved.forEach((gap, f) => {
    const p = f.properties;
    if (gap >= 1) console.log(`  across a ${gap.toFixed(1)} mi gap: ${p.state} ${p.displayName} -> mmOffset ${p.mmOffset}`);
});
unresolved.forEach((f) => {
    const p = f.properties;
    console.log(`  no segment of the route with known mileage: ${p.state} ${p.displayName}, ${p.length_km} km, mmOffset kept at ${p.mmOffset}`);
});
console.log(`mileage carried across ${joined.length} US/state class switches`);
if (process.argv.includes('--list')) joined.forEach((j) => console.log(`  ${j}`));
problems.forEach((m) => console.log(`  PROBLEM ${m}`));
if (problems.length) process.exit(1);

if (process.argv.includes('--list')) {
    pending.forEach((f) => {
        const p = f.properties;
        const [a, b] = ends(f);
        console.log(`  ${p.state} ${p.displayName}: mm ${p.mmOffset}-${Math.round(p.mmOffset + lengthMiles(f))} from ${a[1].toFixed(2)},${a[0].toFixed(2)} to ${b[1].toFixed(2)},${b[0].toFixed(2)}${resolved.has(f) ? '' : ' (kept)'}`);
    });
}

if (!DRY_RUN) {
    mkdirSync(OUT_DIR, { recursive: true });
    if (!existsSync(PRISTINE)) writeFileSync(PRISTINE, readFileSync(GEOJSON));
    writeFileSync(GEOJSON, JSON.stringify(doc));
    console.log(`wrote ${path.relative(ROOT, GEOJSON)} (${doc.features.length} features)`);
}
