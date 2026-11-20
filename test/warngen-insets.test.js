import fs from 'node:fs';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const insets = require('../warngen/src/geo/insets.js');
const intersect = require('../warngen/src/geo/intersect.js');

const data = (name) => JSON.parse(fs.readFileSync(new URL(`../warngen/data/${name}`, import.meta.url), 'utf8'));
const INSETS = Object.fromEntries(insets.DATA_INSETS.map((t) => [t.name, t]));
const MARINE_CWA = { AFC: 'AK', AFG: 'AK', AJK: 'AK', HFO: 'HI' };

const rawCounties = data('us_counties.geojson');
const counties = insets.toMapFeatures(rawCounties);
const highways = data('us_highways.geojson');

function eachVertex(coords, fn) {
    if (typeof coords[0] === 'number') fn(coords);
    else coords.forEach((c) => eachVertex(c, fn));
}

function boxOf(coords) {
    const b = [Infinity, Infinity, -Infinity, -Infinity];
    eachVertex(coords, (p) => {
        b[0] = Math.min(b[0], p[0]); b[1] = Math.min(b[1], p[1]);
        b[2] = Math.max(b[2], p[0]); b[3] = Math.max(b[3], p[1]);
    });
    return b;
}

const inside = (b, p) => p[0] >= b[0] && p[1] >= b[1] && p[0] <= b[2] && p[1] <= b[3];

/** A real box as the map draws it: east longitudes unwrapped past -180. */
const mapBoxes = (t) => t.realBoxes.map((b) => (b[0] > 0 ? [b[0] - 360, b[1], b[2] - 360, b[3]] : b));
const onMap = (name, p) => mapBoxes(INSETS[name]).some((b) => inside(b, p));

function strays(features, territoryOf) {
    const out = [];
    features.forEach((f) => {
        const name = territoryOf(f);
        if (!name) return;
        eachVertex(f.geometry.coordinates, (p) => {
            if (!onMap(name, p)) out.push(`${f.properties.name} (${name}) at ${p}`);
        });
    });
    return out;
}

const stateAt = (lon, lat) => {
    const f = intersect.findFeatureContaining([lon, lat], counties);
    return f ? f.properties.state : null;
};

const square = (lon, lat, d = 0.05) => [[lon - d, lat - d], [lon + d, lat - d], [lon + d, lat + d], [lon - d, lat + d], [lon - d, lat - d]];
const oldInset = (name, lon, lat) => {
    const t = INSETS[name];
    const x = t.name === 'AK' && lon > 0 ? lon - 360 : lon;
    return [(x - t.src[0]) * t.scaleLon + t.dst[0], (lat - t.src[1]) * t.scaleLat + t.dst[1]];
};
const center = (ring) => {
    const n = ring.length - 1;
    return [ring.slice(0, n).reduce((s, p) => s + p[0], 0) / n, ring.slice(0, n).reduce((s, p) => s + p[1], 0) / n];
};

describe('WarnGen real-coordinate map (GH #171)', () => {
    it('wraps and unwraps longitudes across the antimeridian', () => {
        expect(insets.unwrapLon(144.78)).toBeCloseTo(-215.22, 9);
        expect(insets.unwrapLon(-96)).toBe(-96);
        expect(insets.wrapLon(-215.22)).toBeCloseTo(144.78, 9);
        expect(insets.wrapLon(-179.5)).toBe(-179.5);
        expect(insets.wrapLon(insets.unwrapLon(172.9))).toBeCloseTo(172.9, 9);
    });

    it('puts every territory county back where it really is, and leaves the states alone', () => {
        expect(strays(counties.features, (f) => INSETS[f.properties.state] && f.properties.state)).toEqual([]);
        const moved = counties.features.filter((f, i) => !INSETS[f.properties.state]
            && JSON.stringify(f.geometry) !== JSON.stringify(rawCounties.features[i].geometry));
        expect(moved.map((f) => f.properties.name)).toEqual([]);

        const guam = boxOf(counties.features.find((f) => f.properties.fips === '66010').geometry.coordinates);
        expect(insets.wrapLon((guam[0] + guam[2]) / 2)).toBeCloseTo(144.79, 1);
        expect((guam[1] + guam[3]) / 2).toBeCloseTo(13.45, 1);
        const rota = boxOf(counties.features.find((f) => f.properties.fips === '69100').geometry.coordinates);
        expect(insets.wrapLon((rota[0] + rota[2]) / 2)).toBeCloseTo(145.21, 1);
        expect((rota[1] + rota[3]) / 2).toBeCloseTo(14.15, 1);
        const croix = boxOf(counties.features.find((f) => f.properties.fips === '78010').geometry.coordinates);
        expect((croix[1] + croix[3]) / 2).toBeCloseTo(17.73, 1);
    });

    it('keeps the Aleutians continuous across 180', () => {
        const west = counties.features.find((f) => f.properties.state === 'AK' && f.properties.fips === '02016');
        const b = boxOf(west.geometry.coordinates);
        expect(b[0]).toBeLessThan(-185);
        expect(b[2]).toBeLessThan(-160);
        let positive = 0;
        eachVertex(west.geometry.coordinates, (p) => { if (p[0] > 0) positive++; });
        expect(positive).toBe(0);
    });

    it('puts zones, marine zones, cities and outlines back too', () => {
        const zones = insets.toMapFeatures(data('forecast_zones.geojson'));
        const marine = insets.toMapFeatures(data('marine_zones.geojson'));
        expect(strays(zones.features, (f) => INSETS[f.properties.state] && f.properties.state)).toEqual([]);
        expect(strays(marine.features, (f) => MARINE_CWA[f.properties.cwa])).toEqual([]);
        const swains = boxOf(zones.features.find((f) => f.properties.name === 'Swains Island').geometry.coordinates);
        expect(swains[3]).toBeCloseTo(-11.05, 1);

        const cities = data('us_cities.json').cities;
        const placed = insets.toMapPoints(cities.map((c) => ({ ...c })));
        const off = placed.filter((c) => INSETS[c.state] && !onMap(c.state, [c.lon, c.lat]));
        expect(off.map((c) => `${c.name} ${c.state} ${c.lon},${c.lat}`)).toEqual([]);
        const dededo = placed.find((c) => c.name === 'Dededo');
        expect(insets.wrapLon(dededo.lon)).toBeCloseTo(144.85, 1);
        const conus = placed.filter((c, i) => !INSETS[c.state] && cities[i].lon < 0
            && (c.lon !== cities[i].lon || c.lat !== cities[i].lat));
        expect(conus).toEqual([]);

        const stateOf = new Map(cities.map((c) => [String(c.gid), c.state]));
        for (const cwa of ['AFC', 'HFO', 'GUM', 'PPG', 'SJU']) {
            const bad = [];
            Object.entries(data(`places/${cwa}.json`)).forEach(([gid, rings]) => {
                const state = stateOf.get(gid);
                eachVertex(insets.toMapCoordinates(rings, state), (p) => {
                    if (!onMap(state, p)) bad.push(`${cwa} ${gid} ${state} ${p}`);
                });
            });
            expect(bad.slice(0, 5)).toEqual([]);
        }
    });

    it('moves the Alaska basemap pieces out of the old inset and leaves Arizona rivers where they are', () => {
        const rivers = data('basemap/rivers.geojson');
        expect(insets.toMapFeatures(rivers).features[0].geometry.coordinates).toEqual(rivers.features[0].geometry.coordinates);
        for (const name of ['timezones', 'lakes']) {
            const placed = insets.toMapFeatures(data(`basemap/${name}.geojson`));
            const left = [];
            eachVertex(placed.features[0].geometry.coordinates, (p) => {
                ['AK', 'HI', 'PR', 'VI'].forEach((t) => { if (inside(INSETS[t].compositeBbox, p)) left.push(`${name} ${t} ${p}`); });
            });
            expect(left.slice(0, 5)).toEqual([]);
        }
        const lakes = insets.toMapFeatures(data('basemap/lakes.geojson')).features[0].geometry.coordinates;
        expect(lakes.filter((poly) => onMap('AK', poly[0][0])).length).toBeGreaterThan(50);
    });

    it('draws every road inside its own state', () => {
        const box = {};
        counties.features.forEach((f) => {
            const b = boxOf(f.geometry.coordinates);
            const s = box[f.properties.state] || [Infinity, Infinity, -Infinity, -Infinity];
            box[f.properties.state] = [Math.min(s[0], b[0]), Math.min(s[1], b[1]), Math.max(s[2], b[2]), Math.max(s[3], b[3])];
        });
        const placed = insets.toMapFeatures(highways);
        expect(placed.features.map((f) => f.geometry)).toEqual(highways.features.map((f) => f.geometry));
        const pad = (b) => [b[0] - 0.25, b[1] - 0.25, b[2] + 0.25, b[3] + 0.25];
        const states = Object.values(box);
        const wrong = [];
        const roads = { AK: 0, HI: 0 };
        placed.features.forEach((f) => {
            const st = f.properties.state;
            const p0 = f.geometry.coordinates.flat(Infinity).slice(0, 2);
            const own = st || ['AK', 'HI'].find((s) => inside(pad(box[s]), p0));
            let home = false;
            if (own) eachVertex(f.geometry.coordinates, (p) => { home = home || inside(pad(box[own]), p); });
            if (!home) { wrong.push(`${f.properties.displayName} ${st} never enters its state at ${p0}`); return; }
            if (!st) roads[own]++;
            // Natural Earth runs some routes a few miles past a state line, so only unlabelled
            // roads are held to their own state's box.
            eachVertex(f.geometry.coordinates, (p) => {
                const ok = st ? states.some((b) => inside(pad(b), p)) : inside(pad(box[own]), p);
                if (!ok) wrong.push(`${f.properties.displayName} ${own} ${p}`);
                insets.DATA_INSETS.forEach((t) => {
                    if (t.open && inside(t.compositeBbox, p)) wrong.push(`${f.properties.displayName} in the old ${t.name} inset ${p}`);
                });
            });
        });
        expect(wrong.slice(0, 10)).toEqual([]);
        expect(roads.AK).toBeGreaterThan(10);
        expect(roads.HI).toBeGreaterThan(5);
    });

    it('migrates a polygon saved by the old composite map, once', () => {
        const guam = square(...oldInset('GU', 144.78, 13.45));
        const saved = {
            polygon: guam,
            form: { office: 'GUM', centroidLat: String(oldInset('GU', 144.78, 13.45)[1]),
                    centroidLon: String(oldInset('GU', 144.78, 13.45)[0]), lineVerts: '' },
            followupBaseline: { areas: [], ring: guam, drawnRing: guam }
        };
        const out = insets.migrateSavedState(JSON.parse(JSON.stringify(saved)), stateAt);
        const c = center(out.polygon);
        expect(insets.wrapLon(c[0])).toBeCloseTo(144.78, 6);
        expect(c[1]).toBeCloseTo(13.45, 6);
        expect(c[0]).toBeLessThan(-180);
        expect(Number(out.form.centroidLon)).toBeCloseTo(144.78, 2);
        expect(Number(out.form.centroidLat)).toBeCloseTo(13.45, 2);
        expect(center(out.followupBaseline.ring)).toEqual(c);
        expect(out.geo).toBe(1);
        expect(insets.migrateSavedState(JSON.parse(JSON.stringify(out)), stateAt)).toEqual(out);

        const rota = insets.migrateSavedState({ polygon: square(...oldInset('MP', 145.21, 14.15)), form: { office: 'GUM' } }, stateAt);
        expect(insets.wrapLon(center(rota.polygon)[0])).toBeCloseTo(145.21, 6);
        expect(center(rota.polygon)[1]).toBeCloseTo(14.15, 6);

        const anchorage = insets.migrateSavedState({
            polygon: square(...oldInset('AK', -149.95, 61.2)),
            form: { office: '_ALL_US_', lineVerts: oldInset('AK', -149.95, 61.2).reverse().join(' ') + ', 21 -117' }
        }, stateAt);
        expect(center(anchorage.polygon)[0]).toBeCloseTo(-149.95, 6);
        expect(anchorage.form.lineVerts).toBe('61.200 -149.950, 63.000 -152.000');
    });

    it('leaves real polygons where they are, Tucson under the old Guam inset included', () => {
        for (const office of ['TWC', '_ALL_US_']) {
            const tucson = { polygon: square(-110.97, 32.22), form: { office } };
            expect(insets.migrateSavedState(JSON.parse(JSON.stringify(tucson)), stateAt).polygon).toEqual(tucson.polygon);
        }
        const oldGuamSpot = square(...oldInset('GU', 144.78, 13.45));
        expect(insets.migrateSavedState({ polygon: oldGuamSpot, form: { office: 'TWC' } }, stateAt).polygon).toEqual(oldGuamSpot);
        const real = { geo: 1, polygon: oldGuamSpot, form: { office: 'GUM' } };
        expect(insets.migrateSavedState(real, stateAt).polygon).toEqual(oldGuamSpot);
        const honolulu = square(-157.85, 21.33);
        expect(insets.migrateSavedState({ polygon: honolulu, form: { office: 'HFO' } }, stateAt).polygon).toEqual(honolulu);
        expect(insets.migrateSavedState(null, stateAt)).toBe(null);
    });
});
