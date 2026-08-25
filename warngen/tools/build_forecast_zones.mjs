#!/usr/bin/env node
/**
 * Build warngen/data/forecast_zones.geojson from the NWS public forecast zone shapefile.
 *
 * Ships from https://www.weather.gov/gis/PublicZones as z_<ddmmmyy>.zip:
 *
 *   node tools/build_forecast_zones.mjs C:/tmp/wgdata/z_16ap26 [--tolerance 0.003]
 *
 * Zone-based templates (Special Weather Statement, Significant Weather Advisory, Short Term
 * Forecast, Fire Warning) hatch these rather than counties, and their UGC line is Z-format
 * with the zone number -- not the county FIPS the app used to substitute.
 *
 * Output properties mirror us_counties.geojson so featureToArea() handles both:
 *   fips               -- zone number, the UGC's last 3 digits ("019")
 *   state              -- 2-letter state, the UGC's state field ("AL")
 *   partOfParentRegion -- the shapefile's FE_AREA code, which #areaFormat already speaks
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readDbf, readShp, toGeometry } from './shapefile.mjs';
import { insetForCwa, isUnplaceable, applyInset, INSETS } from './inset.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const args = process.argv.slice(2);
const base = args.find(a => !a.startsWith('--'));
const tolIdx = args.indexOf('--tolerance');
const TOLERANCE = tolIdx === -1 ? 0.003 : parseFloat(args[tolIdx + 1]);

if (!base) {
    console.error('usage: build_forecast_zones.mjs <shapefile-basename> [--tolerance 0.003]');
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
let merged = 0;
const features = [];
const byKey = {};

for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const rings = shapes[i];
    const state = (row.STATE || '').toUpperCase();
    const zone = (row.ZONE || '').trim();
    const cwa = (row.CWA || '').toUpperCase();

    if (!/^[A-Z]{2}$/.test(state) || !/^\d{3}$/.test(zone) || !rings.length) { skipped++; continue; }
    if (isUnplaceable(cwa)) { unplaceable++; continue; }

    // Alaska and Hawaii are laid out as insets on this basemap; move their zones to match.
    const inset = INSETS[state] ? { state, spec: INSETS[state] } : insetForCwa(cwa);
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

    const fe = (row.FE_AREA || '').trim().toUpperCase();
    const key = state + 'Z' + zone;

    // A zone with disjoint pieces (islands, a split county) ships as several shapefile
    // records sharing one STATE_ZONE. They are one zone, so merge rather than emit twins.
    const existing = byKey[key];
    if (existing) {
        merged++;
        const into = existing.geometry;
        const add = built.geometry;
        const parts = (into.type === 'Polygon') ? [into.coordinates] : into.coordinates;
        const more = (add.type === 'Polygon') ? [add.coordinates] : add.coordinates;
        existing.geometry = { type: 'MultiPolygon', coordinates: parts.concat(more) };
        if (fe && existing.properties.partOfParentRegion.indexOf(fe) === -1) {
            existing.properties.partOfParentRegion.push(fe);
        }
        continue;
    }

    const feature = {
        type: 'Feature',
        properties: {
            fips: zone,
            name: row.NAME || row.SHORTNAME || key,
            state: state,
            cwa: cwa,
            partOfParentRegion: fe ? [fe] : [],
            zone: true
        },
        geometry: built.geometry
    };
    byKey[key] = feature;
    features.push(feature);
}

const out = path.join(ROOT, 'data', 'forecast_zones.geojson');
fs.writeFileSync(out, JSON.stringify({ type: 'FeatureCollection', features }));

console.log(`zones written : ${features.length}  (skipped ${skipped})`);
console.log(`parts merged  : ${merged}  (disjoint pieces folded into their zone)`);
console.log(`inset-mapped  : ${insetCount}  (AK/HI moved into basemap inset space)`);
console.log(`unplaceable   : ${unplaceable}  (PR/Guam/Samoa -- no verified inset transform)`);
console.log(`vertices      : ${vertsIn} -> ${vertsOut}  (tolerance ${TOLERANCE})`);
console.log(`states        : ${new Set(features.map(f => f.properties.state)).size}`);
console.log(`cwas          : ${new Set(features.map(f => f.properties.cwa)).size}`);
console.log(`output        : ${out}  (${(fs.statSync(out).size / 1048576).toFixed(2)} MB)`);
