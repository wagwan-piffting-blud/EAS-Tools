#!/usr/bin/env node
/**
 * Build warngen/data/marine_zones.geojson from the NWS marine zone shapefile.
 *
 * The shapefile ships from https://www.weather.gov/gis/MarineZones as mz<ddmmmyy>.zip.
 * Unzip it somewhere and point this at the basename:
 *
 *   node tools/build_marine_zones.mjs C:/tmp/wgdata/mz16ap26 [--tolerance 0.003]
 *
 * Only the coastal zones (mz) belong here. Offshore (oz) and high seas (hz) are not
 * warned by WarnGen, so they are deliberately not bundled.
 *
 * Output properties mirror us_counties.geojson so featureToArea() handles both:
 *   fips  -- zone number, the last 3 digits of the UGC ("350")
 *   state -- 2-letter marine prefix, the UGC's "state" field ("AN")
 *   name  -- full zone name
 *   cwa   -- owning WFO
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readDbf, readShp, toGeometry } from './shapefile.mjs';
import { insetForCwa, isUnplaceable, applyInset } from './inset.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const args = process.argv.slice(2);
const base = args.find(a => !a.startsWith('--'));
const tolIdx = args.indexOf('--tolerance');
const TOLERANCE = tolIdx === -1 ? 0.003 : parseFloat(args[tolIdx + 1]);

if (!base) {
    console.error('usage: build_marine_zones.mjs <shapefile-basename> [--tolerance 0.003]');
    process.exit(2);
}

const rows = readDbf(base + '.dbf');
const shapes = readShp(base + '.shp');

if (rows.length !== shapes.length) {
    console.error(`dbf/shp record mismatch: ${rows.length} vs ${shapes.length}`);
    process.exit(1);
}

let vertsIn = 0;
let vertsOut = 0;
let skipped = 0;
let insetCount = 0;
let unplaceable = 0;
const features = [];

for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const rings = shapes[i];
    const id = (row.ID || '').toUpperCase();

    if (!/^[A-Z]{2}Z\d{3}$/.test(id) || !rings.length) { skipped++; continue; }

    const cwa = (row.WFO || row.GL_WFO || '').toUpperCase();

    // Puerto Rico, Guam and Samoa are inset on this basemap with no verified transform,
    // so their zones would land in open ocean. Drop them rather than misplace them.
    if (isUnplaceable(cwa)) { unplaceable++; continue; }

    const inset = insetForCwa(cwa);
    if (inset) insetCount++;

    const place = inset
        ? ([x, y]) => {
            const [lat, lon] = applyInset(inset.spec, inset.state, y, x);
            return [lon, lat];
        }
        : null;

    const built = toGeometry(rings, TOLERANCE, place);
    if (!built) { skipped++; continue; }
    vertsIn += built.vertsIn;
    vertsOut += built.vertsOut;

    features.push({
        type: 'Feature',
        properties: {
            fips: id.slice(3),
            name: row.NAME || id,
            state: id.slice(0, 2),
            cwa: cwa,
            marine: true
        },
        geometry: built.geometry
    });
}

const out = path.join(ROOT, 'data', 'marine_zones.geojson');
fs.writeFileSync(out, JSON.stringify({ type: 'FeatureCollection', features }));

const byPrefix = {};
features.forEach(f => {
    byPrefix[f.properties.state] = (byPrefix[f.properties.state] || 0) + 1;
});

console.log(`zones written : ${features.length}  (skipped ${skipped})`);
console.log(`inset-mapped  : ${insetCount}  (AK/HI moved into basemap inset space)`);
console.log(`unplaceable   : ${unplaceable}  (PR/Guam/Samoa -- no verified inset transform)`);
console.log(`vertices      : ${vertsIn} -> ${vertsOut}  (tolerance ${TOLERANCE})`);
console.log(`prefixes      : ${Object.keys(byPrefix).sort().map(k => k + '=' + byPrefix[k]).join(' ')}`);
console.log(`cwas          : ${new Set(features.map(f => f.properties.cwa)).size}`);
console.log(`output        : ${out}  (${(fs.statSync(out).size / 1048576).toFixed(2)} MB)`);
