import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const load = (name) => JSON.parse(readFileSync(new URL(`../assets/E2T/include/${name}`, import.meta.url), 'utf8'));

const marine = load('same-marine.json');
const us = load('same-us.json');
const prefixes = load('marine-same.json').prefixes;

describe('same-marine.json', () => {
    it('lists the 15 NWS marine areas with an area-wide code each', () => {
        const fields = Object.keys(marine.AREAS);
        expect(fields).toHaveLength(15);
        for (const field of fields) {
            expect(marine.SAME[field + '000']).toBe(marine.AREAS[field].name);
        }
    });

    it('keeps every zone inside the field of its UGC prefix', () => {
        const fieldByPrefix = Object.fromEntries(Object.entries(marine.AREAS).map(([field, area]) => [area.prefix, field]));
        const zones = Object.entries(marine.SAME).filter(([code]) => !code.endsWith('000'));
        expect(zones.length).toBeGreaterThan(700);
        for (const [code, name] of zones) {
            expect(code).toMatch(/^\d{5}$/);
            const prefix = /, ([A-Z]{2})$/.exec(name)?.[1];
            expect(fieldByPrefix[prefix], `${code} ${name}`).toBe(code.slice(0, 2));
        }
    });

    it('is the only source of marine codes', () => {
        const marineFields = new Set(Object.keys(marine.AREAS));
        const leftovers = Object.keys(us.SAME).filter((code) => marineFields.has(code.slice(0, 2)));
        expect(leftovers).toEqual([]);
        expect(us.SAME['48453']).toBe('Travis County, TX');
    });

    it('agrees with the marine prefix map used for UGC conversion', () => {
        for (const [field, area] of Object.entries(marine.AREAS)) {
            expect(prefixes[area.prefix]).toBe(field);
        }
    });
});
