import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const intersect = require('../warngen/src/geo/intersect.js');
const ugc = require('../warngen/src/engine/ugc.js');

const square = (x0 = 0, y0 = 0, x1 = 10, y1 = 10) => [
    [x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0],
];
const polygon = (outer = square(), holes = [], properties = {}) => ({
    type: 'Feature', properties, geometry: { type: 'Polygon', coordinates: [outer, ...holes] },
});
const multiPolygon = (...rings) => ({
    type: 'Feature', properties: {}, geometry: { type: 'MultiPolygon', coordinates: rings.map((ring) => [ring]) },
});

describe('WarnGen UGC', () => {
    it('collapses only runs of three or more codes', () => {
        expect(ugc.collapseRanges([1, 2, 3, 5, 6, 8])).toEqual(['001>003', '005', '006', '008']);
        expect(ugc.collapseRanges([])).toEqual([]);
    });

    it('wraps long UGC lines at dashes and leaves short lines alone', () => {
        expect(ugc.wrapUGC('NEC001-003-', 64)).toBe('NEC001-003-');
        expect(ugc.wrapUGC('NEC001-003-005-007-', 10)).toBe('NEC001-003-\n005-007-');
        expect(ugc.wrapUGC('ABCDEFGHIJK', 5)).toBe('ABCDEF\nGHIJK');
        expect(ugc.wrapUGC('A'.repeat(65))).toBe('A'.repeat(65));
    });

    it('builds ordered, deduplicated county and zone UGC lines', () => {
        const expires = new Date('2026-01-05T03:07:00Z');
        const areas = [
            { state: 'ne', fips: '031001' }, { state: 'NE', fips: '031002' },
            { state: 'NE', fips: '031003' }, { state: 'NE', fips: '031003' },
            { state: 'IA', fips: '019005' }, { state: 'IA', fips: 'bad' },
        ];
        expect(ugc.build(areas, expires)).toBe('NEC001>003-IAC005-050307-');
        expect(ugc.build(areas, expires, 'Z')).toBe('NEZ001>003-IAZ005-050307-');
        expect(ugc.build([{ state: 'TX', fips: '010' }, { state: 'TX', fips: '100' }], new Date('2026-12-15T13:17:00Z')))
            .toBe('TXC010-100-151317-');
    });
});

describe('WarnGen geometry', () => {
    it('calculates bounding boxes and point containment', () => {
        expect(intersect.bbox(square(-2, -1, 3, 4))).toEqual([-2, -1, 3, 4]);
        expect(intersect.pointInRing([5, 5], square())).toBe(true);
        expect(intersect.pointInRing([15, 5], square())).toBe(false);
        expect(intersect.bbox([[3, 4]])).toEqual([3, 4, 3, 4]);
    });

    it('detects containment, crossing, and disjoint rings', () => {
        expect(intersect.ringsIntersect(square(2, 2, 4, 4), square())).toBe(true);
        expect(intersect.ringsIntersect(square(-2, 4, 12, 6), square())).toBe(true);
        expect(intersect.ringsIntersect(square(20, 20, 30, 30), square())).toBe(false);
        expect(intersect.ringsIntersect(square(), square(10, 0, 20, 10))).toBe(true);
    });

    it('estimates overlap for polygons, multipolygons, holes, and invalid geometry', () => {
        expect(intersect.overlapRatio(square(), { geometry: null })).toBe(0);
        expect(intersect.overlapRatio(square(), polygon(), 10)).toBe(1);
        expect(intersect.overlapRatio(square(0, 0, 5, 10), polygon(), 20)).toBeCloseTo(0.5, 1);
        expect(intersect.overlapRatio(square(), polygon(square(), [square(4, 4, 6, 6)]), 20)).toBe(1);
        expect(intersect.overlapRatio(square(), multiPolygon(square(), square(20, 20, 30, 30)), 10)).toBeCloseTo(0.5, 1);
        expect(intersect.overlapRatio(square(), polygon([[0, 0], [0, 0], [0, 0]]), 10)).toBe(0);
    });

    it('describes directional and point subdivisions', () => {
        const feature = polygon();
        expect(intersect.directionalSubdivision(square(), feature, { N: 10 })).toEqual([]);
        expect(intersect.directionalSubdivision(square(7, 3, 10, 7), feature, { N: 20 })).toContain('EAST');
        expect(intersect.directionalSubdivision(square(3, 7, 7, 10), feature, { N: 20 })).toEqual(['NORTH']);
        expect(intersect.directionalSubdivision(square(4, 4, 6, 6), feature, { N: 20 })).toEqual(['CENTRAL']);
        expect(intersect.directionalSubdivision(square(), { geometry: null })).toEqual([]);
        expect(intersect.directionalSubdivision(square(), polygon([[0, 0], [0, 0], [0, 0]]))).toEqual([]);
        expect(intersect.directionalSubdivision(square(42, 42, 44, 44), multiPolygon(square(), square(40, 40, 50, 50)), { N: 10 }))
            .toEqual(['EXTREME', 'NORTH', 'EAST']);
        expect(intersect.directionalSubdivision(square(4, 4, 6, 6), polygon(square(), [square(4, 4, 6, 6)]), { N: 10 })).toEqual([]);
        expect(intersect.pointSubdivision([5, 5], feature)).toEqual(['CENTRAL']);
        expect(intersect.pointSubdivision([10, 10], feature)).toEqual(['EXTREME', 'NORTH', 'EAST']);
        expect(intersect.pointSubdivision([0, 0], feature)).toEqual(['EXTREME', 'SOUTH', 'WEST']);
        expect(intersect.pointSubdivision([1, 1], { geometry: null })).toEqual([]);
        expect(intersect.pointSubdivision([0, 0], polygon([[0, 0], [0, 0], [0, 0]]))).toEqual([]);
        expect(intersect.pointSubdivision([45, 45], multiPolygon(square(), square(40, 40, 50, 50)))).toEqual(['EXTREME', 'NORTH', 'EAST']);
    });

    it('computes feature area and inclusion policies', () => {
        const whole = intersect.featureAreaKm2(polygon());
        const holed = intersect.featureAreaKm2(polygon(square(), [square(4, 4, 6, 6)]));
        const multiple = intersect.featureAreaKm2(multiPolygon(square(), square(20, 20, 30, 30)));
        expect(whole).toBeGreaterThan(1000000);
        expect(holed).toBeLessThan(whole);
        expect(multiple).toBeGreaterThan(whole);
        expect(intersect.passesInclusion(0.5, polygon(), { percent: 40, area: 1, andOr: 'AND' })).toBe(true);
        expect(intersect.passesInclusion(0.1, polygon(), { percent: 40, area: 1e9, andOr: 'OR' })).toBe(false);
        expect(intersect.passesInclusion(0.5, polygon(), { percent: 60, area: 1, andOr: 'AND' })).toBe(false);
        expect(intersect.passesInclusion(0.5, polygon(), { percent: 60, area: 1, andOr: 'OR' })).toBe(true);
    });

    it('checks meaningful overlap beyond a polygon edge', () => {
        expect(intersect.overlapsBeyond(square(), polygon(square(2, 2, 4, 4)), 0.1)).toBe(true);
        expect(intersect.overlapsBeyond(square(), polygon(square(20, 20, 30, 30)), 0.1)).toBe(false);
        expect(intersect.overlapsBeyond(square(), polygon(square(9.99, 2, 10.01, 4)), 0.1)).toBe(false);
        expect(intersect.overlapsBeyond(square(), multiPolygon(square(20, 20, 30, 30), square(2, 2, 3, 3)), 0.1)).toBe(true);
        expect(intersect.overlapsBeyond(square(), polygon(square(), [square(1, 1, 9, 9)]), 2)).toBe(false);
    });

    it('finds intersecting features with fraction and AWIPS inclusion rules', () => {
        const inside = polygon(square(1, 1, 4, 4), [], { id: 'inside' });
        const partial = polygon(square(8, 8, 12, 12), [], { id: 'partial' });
        const far = polygon(square(20, 20, 30, 30), [], { id: 'far' });
        const multi = multiPolygon(square(30, 30, 35, 35), square(2, 2, 3, 3));
        multi.properties.id = 'multi';
        const missing = { type: 'Feature', properties: { id: 'missing' }, geometry: null };
        const collection = { type: 'FeatureCollection', features: [inside, partial, far, multi, missing] };
        expect(intersect.findIntersectingFeatures(square(), null)).toEqual([]);
        expect(intersect.findIntersectingFeatures(square(), collection, 0).map((f) => f.properties.id)).toEqual(['inside', 'partial', 'multi']);
        expect(intersect.findIntersectingFeatures(square(), collection, 0.6).map((f) => f.properties.id)).toEqual(['inside']);
        expect(intersect.findIntersectingFeatures(square(), collection, { percent: 20, area: 1, andOr: 'OR' }).map((f) => f.properties.id)).toContain('inside');
        const pointOnly = { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [5, 5] } }] };
        expect(intersect.findIntersectingFeatures(square(), pointOnly, 0)).toEqual([]);
    });

    it('finds containing polygon and multipolygon features while respecting holes', () => {
        const withHole = polygon(square(), [square(4, 4, 6, 6)], { id: 'hole' });
        const multi = multiPolygon(square(20, 20, 30, 30), square(40, 40, 50, 50));
        multi.properties.id = 'multi';
        const missing = { type: 'Feature', properties: {}, geometry: null };
        const collection = { type: 'FeatureCollection', features: [missing, withHole, multi] };
        expect(intersect.findFeatureContaining([2, 2], collection)?.properties.id).toBe('hole');
        expect(intersect.findFeatureContaining([5, 5], collection)).toBeNull();
        expect(intersect.findFeatureContaining([45, 45], collection)?.properties.id).toBe('multi');
        const multiWithHole = {
            type: 'Feature', properties: { id: 'multi-hole' },
            geometry: { type: 'MultiPolygon', coordinates: [[square(), square(4, 4, 6, 6)]] },
        };
        expect(intersect.findFeatureContaining([5, 5], { type: 'FeatureCollection', features: [multiWithHole] })).toBeNull();
        expect(intersect.findFeatureContaining([0, 0], null)).toBeNull();
        expect(intersect.findFeatureContaining([5, 5], { type: 'FeatureCollection', features: [{ geometry: { type: 'Point', coordinates: [5, 5] } }] })).toBeNull();
    });
});
