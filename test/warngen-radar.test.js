import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const palette = require('../warngen/src/radar/palette.js');

describe('WarnGen radar color tables', () => {
    it('parses metadata, RGB/RGBA stops, comments, and range-folded colors', () => {
        const table = palette.parse(`
            ; comment
            Product: vel
            Units: mph # trailing comment
            ignored line
            RF: 1, 2, 3
            Color: 10 10 20 30 40 50 60
            Color4: 0 1 2 3 4 5 6 7 8
            Color: invalid values
            Color: 20 70 80 90
        `);

        expect(table.product).toBe('VEL');
        expect(table.units).toBe('MPH');
        expect(table.rangeFolded).toEqual([1, 2, 3, 255]);
        expect(table.entries).toEqual([
            { value: 0, from: [1, 2, 3, 4], to: [5, 6, 7, 8] },
            { value: 10, from: [10, 20, 30, 255], to: [40, 50, 60, 255] },
            { value: 20, from: [70, 80, 90, 255], to: null },
        ]);
    });

    it('rejects tables without usable color entries', () => {
        expect(() => palette.parse()).toThrow('No Color: lines');
        expect(() => palette.parse('Color4: 1 2 3')).toThrow('No Color: lines');
    });

    it('interpolates explicit and implicit gradients and handles bounds', () => {
        const explicit = palette.parse('Color: 0 0 0 0 100 200 50\nColor: 10 255 255 255');
        const implicit = palette.parse('Color: 0 0 0 0\nColor: 10 100 200 50');

        expect(palette.colorAt(explicit, -1)).toBeNull();
        expect(palette.colorAt(explicit, 5)).toEqual([50, 100, 25, 255]);
        expect(palette.colorAt(implicit, 5)).toEqual([50, 100, 25, 255]);
        expect(palette.colorAt(explicit, 100)).toEqual([255, 255, 255, 255]);
    });

    it('converts velocity units while leaving other moments and units alone', () => {
        expect(palette.toTableUnits({ units: 'KTS' }, 'VEL', 10)).toBeCloseTo(19.438445);
        expect(palette.toTableUnits({ units: 'KT' }, 'SW', 10)).toBeCloseTo(19.438445);
        expect(palette.toTableUnits({ units: 'KNOTS' }, 'VEL', 10)).toBeCloseTo(19.438445);
        expect(palette.toTableUnits({ units: 'MPH' }, 'VEL', 10)).toBeCloseTo(22.369363);
        expect(palette.toTableUnits({ units: 'M/S' }, 'VEL', 10)).toBe(10);
        expect(palette.toTableUnits({ units: 'KTS' }, 'REF', 10)).toBe(10);
    });

    it('packs colors, formats CSS alpha, and supplies every default table', () => {
        const opaque = palette.pack([1, 2, 3, 255]);
        const translucent = palette.pack([4, 5, 6, 128]);
        expect(palette.pack(null)).toBe(0);
        expect(palette.cssColor(opaque)).toBe('rgb(1,2,3)');
        expect(palette.cssColor(translucent)).toBe('rgba(4,5,6,0.502)');

        for (const moment of Object.keys(palette.DEFAULT_TABLES)) {
            expect(palette.defaultTable(moment).entries.length).toBeGreaterThan(0);
        }
        expect(palette.defaultTable('unknown').product).toBe('BR');
    });
});
