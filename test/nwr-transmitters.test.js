import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { OFFICE_BY_LABEL, buildTransmitters, formatTransmitters, parseCcl } from '../tools/build-nwr-transmitters.mjs';

const civil = JSON.parse(readFileSync(new URL('../warngen/data/civil_sites.json', import.meta.url), 'utf8')).sites;
const shipped = JSON.parse(readFileSync(new URL('../assets/nwr-pronunciation/transmitters.json', import.meta.url), 'utf8'));

const CIVIL = {
    AFC: { wfoCityState: 'Anchorage AK', region: 'AR' },
    BOU: { wfoCityState: 'Denver  CO', region: 'CR' },
    LMK: { wfoCityState: 'Louisville KY', region: 'CR' },
    LOT: { wfoCityState: 'Chicago IL' },
};

function row(i, fields) {
    return Object.entries(fields).map(([k, v]) => `${k}[${i}] = "${v}";`).join('\n');
}

const SAMPLE = [
    'var CALLSIGN = [];',
    row(0, { ST: 'KY', CALLSIGN: 'WNG570', WFO: 'Louisville|KY', SITENAME: 'Horse Cave', SITELOC: 'Horse Cave', SITESTATE: 'KY', FREQ: '162.500', STATUS: 'NORMAL' }),
    row(1, { CALLSIGN: 'WNG570', WFO: 'Louisville|KY', SITENAME: 'Horse Cave', SITESTATE: 'KY', FREQ: '162.500', STATUS: 'NORMAL' }),
    row(2, { CALLSIGN: '', WFO: '', SITENAME: '---No  NWR Coverage---', FREQ: '' }),
    row(3, { CALLSIGN: 'KEC76', WFO: 'Boulder|CO', SITENAME: 'Denver', SITESTATE: 'CO', FREQ: '162.550', STATUS: 'NORMAL' }),
    row(4, { CALLSIGN: 'KJY73', WFO: 'Kodiak|AK (WSO)', SITENAME: '', SITELOC: 'Saint  Paul', SITESTATE: 'AK', FREQ: '162.525', STATUS: 'OUT OF SERVICE' }),
    'junk line',
    row(5, { CALLSIGN: 'WXK99', WFO: 'Esc \\"Quoted\\"|ZZ', SITENAME: 'x', FREQ: '162.400' }),
].join('\n');

describe('parseCcl', () => {
    it('reads the parallel arrays as text', () => {
        const rows = parseCcl(SAMPLE);
        expect(rows).toHaveLength(6);
        expect(rows[0]).toEqual({ CALLSIGN: 'WNG570', WFO: 'Louisville|KY', SITENAME: 'Horse Cave', SITELOC: 'Horse Cave', SITESTATE: 'KY', FREQ: '162.500', STATUS: 'NORMAL' });
        expect(rows[4].SITELOC).toBe('Saint Paul');
        expect(rows[5].WFO).toBe('Esc "Quoted"|ZZ');
    });
});

describe('buildTransmitters', () => {
    it('maps labels to offices and dedupes county rows', () => {
        const rows = parseCcl(SAMPLE).slice(0, 5);
        const built = buildTransmitters(rows, CIVIL);
        expect(built.problems).toEqual([]);
        expect(built.transmitters).toEqual({
            KEC76: { wfo: 'BOU', site: 'Denver', state: 'CO', freq: '162.550', status: 'NORMAL' },
            KJY73: { wfo: 'AFC', site: 'Saint Paul', state: 'AK', freq: '162.525', status: 'OUT OF SERVICE' },
            WNG570: { wfo: 'LMK', site: 'Horse Cave', state: 'KY', freq: '162.500', status: 'NORMAL' },
        });
        expect(built.offices.BOU).toEqual({ label: 'Denver CO', region: 'CR' });
        expect(built.offices.LOT).toEqual({ label: 'Chicago IL', region: '' });
    });

    it('refuses unknown labels, bad callsigns, conflicts and odd frequencies', () => {
        const problems = buildTransmitters([
            ...parseCcl(SAMPLE),
            { CALLSIGN: 'WNG570', WFO: 'Louisville|KY', SITENAME: 'Elsewhere', SITESTATE: 'KY', FREQ: '162.500', STATUS: 'NORMAL' },
            { CALLSIGN: 'BAD SIGN', WFO: 'Chicago|IL', SITENAME: 'x', FREQ: '162.550' },
            { CALLSIGN: 'WXK98', WFO: 'Chicago|IL', SITENAME: 'x', FREQ: '88.1' },
        ], CIVIL).problems;
        expect(problems).toEqual([
            'WXK99: no office for WFO label "Esc "Quoted"|ZZ"',
            'WNG570: site "Horse Cave" vs "Elsewhere"',
            'bad callsign "BAD SIGN"',
            'WXK98: odd frequency "88.1"',
        ]);
        expect(buildTransmitters([{ CALLSIGN: 'WXK97', WFO: 'Chicago|IL', SITENAME: 'x', FREQ: '162.550' }], { BOU: { wfoCityState: 'Denver CO' } }).problems).toEqual(['WXK97: office LOT is not in civil_sites.json']);
    });

    it('maps every label to a civil_sites office', () => {
        for (const office of Object.values(OFFICE_BY_LABEL)) expect(civil[office], office).toBeTruthy();
    });

    it('formats one record per line as valid JSON', () => {
        const text = formatTransmitters({ _comment: ['a'], offices: { LOT: { label: 'Chicago IL', region: 'CR' } }, transmitters: { KEC76: { wfo: 'BOU' } } });
        expect(JSON.parse(text).transmitters.KEC76.wfo).toBe('BOU');
        expect(text).toContain('        "KEC76": {"wfo":"BOU"}');
    });
});

describe('shipped transmitters.json', () => {
    it('covers every office, and every transmitter belongs to one', () => {
        expect(Object.keys(shipped.offices)).toEqual(Object.keys(civil).sort());
        const calls = Object.keys(shipped.transmitters);
        expect(calls.length).toBeGreaterThan(0);
        expect(calls).toEqual([...calls].sort());
        for (const [call, tx] of Object.entries(shipped.transmitters)) {
            expect(call).toMatch(/^[A-Z0-9]{3,7}$/);
            expect(shipped.offices[tx.wfo], call).toBeTruthy();
        }
    });

    it('agrees with the office each transmitter pronunciation set names', () => {
        const dir = new URL('../assets/nwr-pronunciation/tx/', import.meta.url);
        for (const name of readdirSync(dir).filter((n) => n.endsWith('.json'))) {
            const set = JSON.parse(readFileSync(new URL(name, dir), 'utf8'));
            const call = name.slice(0, -5);
            expect(shipped.transmitters[call]?.wfo, call).toBe(set.scope.wfo);
        }
    });
});
