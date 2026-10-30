import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const highways = require('../warngen/src/geo/highways.js');

const ring = [[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]];
const feature = (coordinates, properties = {}, type = 'LineString') => ({
    type: 'Feature',
    properties: { cls: 'state', num: '1', state: 'NE', displayName: 'Highway 1', ...properties },
    geometry: { type, coordinates },
});

describe('WarnGen highway bullets', () => {
    it('measures great-circle distances', () => {
        expect(highways.haversineMiles([0, 0], [0, 0])).toBe(0);
        expect(highways.haversineMiles([0, 0], [1, 0])).toBeCloseTo(69.09, 1);
    });

    it('returns no routes for absent and malformed inputs', () => {
        expect(highways.findHighwaysInPolygon()).toEqual([]);
        expect(highways.findHighwaysInPolygon([[0, 0]], { features: [] })).toEqual([]);
        expect(highways.findHighwaysInPolygon(ring, {})).toEqual([]);
        expect(highways.findHighwaysInPolygon(ring, { features: [
            { geometry: null }, feature([[0, 0]]), feature([[3, 3], [4, 4]]),
        ] })).toEqual([]);
    });

    it('finds, offsets, groups, ranks, and rounds intersecting route segments', () => {
        const crossing = [[-0.2, 0.5], [0.2, 0.5], [0.8, 0.5], [1.2, 0.5]];
        const edge = [[-0.01, 0.2], [0, 0.5], [-0.01, 0.8]];
        const db = { features: [
            feature(crossing, { cls: 'state', num: '10', displayName: 'Highway 10', mmOffset: 5 }),
            feature(crossing, { cls: 'us', num: '10', displayName: 'Highway 10' }),
            feature([crossing, [[2, 2], [3, 3]]], { cls: 'interstate', num: '80', displayName: 'Interstate 80', state: 'IA' }, 'MultiLineString'),
            feature(edge, { cls: 'state', num: '2', displayName: 'Highway 2' }),
            feature([[0.3, 0.3], [0.4, 0.4]], { cls: 'state', num: '3', displayName: 'Highway 3', mmOffset: 20 }),
        ] };
        const anchorKey = '-0.200:0.500';
        const hits = highways.findHighwaysInPolygon(ring, db, { anchors: { anchors: {
            [`state:10:${anchorKey}`]: { mm: -100 },
        } } });

        expect(hits.map((hit) => hit.displayName)).toEqual(['Interstate 80', 'Highway 10', 'Highway 2', 'Highway 3']);
        expect(hits[1]).toMatchObject({ cls: 'us', anchored: true, strict: true, mileStart: 0 });
        expect(hits[0].state).toBe('IA');
        expect(hits[2].mileEnd).toBeGreaterThanOrEqual(hits[2].mileStart);
        expect(hits[3].mileStart).toBe(20);
    });

    it('accepts the short anchor form and handles wholly contained lines', () => {
        const line = [[0.2, 0.2], [0.8, 0.8]];
        const key = 'state:1:0.200:0.200';
        const [hit] = highways.findHighwaysInPolygon(ring, { features: [feature(line)] }, { anchors: { [key]: { mm: 10 } } });
        expect(hit.anchored).toBe(true);
        expect(hit.mileStart).toBe(10);
        expect(hit.mileEnd).toBeGreaterThan(10);

        const duplicateVertexRing = [[0, 0], [0, 0], [1, 0], [1, 1], [0, 1], [0, 0]];
        expect(highways.findHighwaysInPolygon(duplicateVertexRing, {
            features: [feature([[-0.005, 0], [0, 0]])],
        })).toHaveLength(1);
    });

    it('formats default and custom bullets for approximate, point, and ranged hits', () => {
        expect(highways.formatHighwayBullet()).toBeNull();
        const hits = [
            { displayName: 'Highway 5', state: 'NE', mileStart: 1, mileEnd: 9, strict: false },
            { displayName: 'Highway 5', state: 'IA', mileStart: 2, mileEnd: 3, strict: true },
            { displayName: 'Interstate 80', state: 'NE', mileStart: 10, mileEnd: 20, strict: true },
            { displayName: 'Route X', state: 'XX', mileStart: 4, mileEnd: 8, strict: true },
        ];
        expect(highways.formatHighwayBullet(hits)).toBe([
            'This includes the following highways...',
            ' Highway 5 in Nebraska near mile marker 5.',
            ' Highway 5 in Iowa near mile marker 3.',
            ' Interstate 80 between mile markers 10 and 20.',
            ' Route X between mile markers 4 and 8.',
        ].join('\n'));
        expect(highways.formatHighwayBullet([hits[2]], 'Roads affected...')).toContain('Roads affected...');
    });
});
