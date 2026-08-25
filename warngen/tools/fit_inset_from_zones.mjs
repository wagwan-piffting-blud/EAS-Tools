#!/usr/bin/env node
/**
 * Derive a basemap inset transform for a state by matching the NWS zone shapefile (true
 * coordinates) against us_counties.geojson (inset coordinates) on state + area name.
 *
 *   node tools/fit_inset_from_zones.mjs C:/tmp/wgdata/z_16ap26 PR GU AS MP VI
 *
 * Both centroids are computed the same way -- the mean of the outer ring's vertices -- so
 * the two definitions cannot disagree. Prints the per-axis least-squares fit and the worst
 * residual, which is what decides whether a state is safe to place.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readDbf, readShp } from './shapefile.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const args = process.argv.slice(2);
const base = args[0];
const states = args.slice(1);

if (!base || !states.length) {
    console.error('usage: fit_inset_from_zones.mjs <zone-shapefile-basename> <STATE...>');
    process.exit(2);
}

function ringCentroid(rings) {
    let x = 0;
    let y = 0;
    let n = 0;
    for (const ring of rings) {
        for (const p of ring) { x += p[0]; y += p[1]; n++; }
    }
    return n ? [x / n, y / n] : null;
}

function geoCentroid(feature) {
    const polys = feature.geometry.type === 'Polygon'
        ? [feature.geometry.coordinates]
        : feature.geometry.coordinates;
    return ringCentroid(polys.map(p => p[0]));
}

function norm(s) {
    return String(s || '').toLowerCase().replace(/[^a-z]/g, '');
}

function fitAxis(pairs) {
    const n = pairs.length;
    const sx = pairs.reduce((s, p) => s + p[0], 0);
    const sy = pairs.reduce((s, p) => s + p[1], 0);
    const sxx = pairs.reduce((s, p) => s + p[0] * p[0], 0);
    const sxy = pairs.reduce((s, p) => s + p[0] * p[1], 0);
    const denom = n * sxx - sx * sx;
    if (!denom) return null;
    const a = (n * sxy - sx * sy) / denom;
    return [a, (sy - a * sx) / n];
}

const rows = readDbf(base + '.dbf');
const shapes = readShp(base + '.shp');
const counties = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'us_counties.geojson'), 'utf8'));

for (const state of states) {
    const byName = {};
    counties.features
        .filter(f => f.properties.state === state)
        .forEach(f => { byName[norm(f.properties.name)] = geoCentroid(f); });

    const latPairs = [];
    const lonPairs = [];
    const used = [];

    for (let i = 0; i < rows.length; i++) {
        if ((rows[i].STATE || '').toUpperCase() !== state) continue;
        if (!shapes[i] || !shapes[i].length) continue;
        const key = norm(rows[i].NAME || rows[i].SHORTNAME);
        const insetC = byName[key];
        if (!insetC) continue;
        const trueC = ringCentroid(shapes[i]);
        if (!trueC) continue;
        latPairs.push([trueC[1], insetC[1]]);
        lonPairs.push([trueC[0], insetC[0]]);
        used.push(rows[i].NAME);
    }

    console.log('--- ' + state + ' : ' + latPairs.length + ' matched areas');
    if (latPairs.length < 3) {
        console.log('    too few matches to fit\n');
        continue;
    }
    const lat = fitAxis(latPairs);
    const lon = fitAxis(lonPairs);
    if (!lat || !lon) { console.log('    degenerate fit\n'); continue; }

    let maxLat = 0;
    let maxLon = 0;
    latPairs.forEach((p, i) => {
        maxLat = Math.max(maxLat, Math.abs(lat[0] * p[0] + lat[1] - p[1]));
        maxLon = Math.max(maxLon, Math.abs(lon[0] * lonPairs[i][0] + lon[1] - lonPairs[i][1]));
    });

    console.log('    lat: [' + lat[0].toFixed(6) + ', ' + lat[1].toFixed(6) + ']');
    console.log('    lon: [' + lon[0].toFixed(6) + ', ' + lon[1].toFixed(6) + ']');
    console.log('    max residual: lat ' + maxLat.toFixed(4) + '  lon ' + maxLon.toFixed(4));
    console.log('    sample: ' + used.slice(0, 6).join(', ') + '\n');
}
