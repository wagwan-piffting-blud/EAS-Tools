import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const locking = require('../warngen/src/engine/locking.js');
const parser = require('../warngen/src/engine/parser.js');
const qc = require('../warngen/src/engine/qc.js');
const utils = require('../warngen/src/engine/utils.js');

const bulletin = `WUUS53 KOAX 010100
SVROAX
NEC001-010200-
/O.NEW.KOAX.SV.W.0001.261101T0100Z-261101T0200Z/
Severe Thunderstorm Warning
National Weather Service Omaha/Valley Nebraska
800 PM CDT Sat Oct 31 2026

The National Weather Service in Omaha has issued a

* Severe Thunderstorm Warning for...
Douglas County in east central Nebraska...

* Until 900 PM CDT.

* At 800 PM CDT, a severe thunderstorm was located near Omaha.

HAZARD...60 mph wind gusts and quarter size hail.
SOURCE...Radar indicated.
IMPACT...Hail damage to vehicles is expected.

LAT...LON 4100 09600 4110 09610 4100 09600
TIME...MOT...LOC 0100Z 090DEG 30KT 4100 09600 4110 09610

$$`;

describe('WarnGen utility compatibility layer', () => {
    it('formats every supported date token and literal syntax', () => {
        const date = new Date('2026-01-02T15:04:05Z');
        expect(utils._formatDate(date, "yyyy yy MMM MM M EEEE EEE dd d HH H hh h mm ss a A z 'literal'", 'UTC', false))
            .toBe('2026 26 Jan 01 1 Friday Fri 02 2 15 15 03 3 04 05 PM PM UTC literal');
        expect(utils._formatDate(date, "'unterminated", 'UNKNOWN', false)).toBe('unterminated');
        expect(utils._formatDate(date.toISOString(), 'HHmm', 'Z', false)).toBe('1504');
        expect(utils._formatDate(date, 'HHmm z', 'C', false)).toBe('0904 CST');
        expect(utils._formatDate(date, 'HHmm z', undefined, false)).toBe('1504 UTC');
        for (const [year, expected] of [[5, '0005'], [50, '0050'], [500, '0500']]) {
            const ancient = new Date(0);
            ancient.setUTCFullYear(year);
            expect(utils._formatDate(ancient, 'yyyy', 'UTC', false)).toBe(expected);
        }
    });

    it('handles DST boundaries, zone letters, and fixed zones', () => {
        const winter = new Date('2026-01-15T12:00:00Z');
        const summer = new Date('2026-07-15T12:00:00Z');
        expect(utils._isUsDst(winter)).toBe(false);
        expect(utils._isUsDst(summer)).toBe(true);
        expect(utils._effectiveZone('CST', summer, false)).toBe('CDT');
        expect(utils._effectiveZone('CST', summer, true)).toBe('CST');
        expect(utils._effectiveZone('HST', summer, false)).toBe('HST');
        expect(utils._effectiveZone('BOGUS', summer, false)).toBe('BOGUS');
        expect(utils._zoneOffsetMinutes('C', summer, false)).toBe(-300);
        expect(utils._zoneOffsetMinutes('m', summer, false)).toBe(-420);
        expect(utils._zoneOffsetMinutes('BOGUS', summer, false)).toBe(0);
    });

    it('rounds dates and supports DateUtil overloads and noon names', () => {
        const date = new Date('2026-01-01T12:08:00Z');
        expect(utils.roundDate(date, 15).toISOString()).toBe('2026-01-01T12:15:00.000Z');
        expect(utils.roundDate(new Date('2026-01-01T12:07:30Z'), 15).toISOString()).toBe('2026-01-01T12:00:00.000Z');
        expect(utils.roundDateTo15(date).getUTCMinutes()).toBe(15);
        const du = utils.makeDateUtil({ CST: true });
        expect(du.format(date, 'HHmm z', 'CST')).toBe('0608 CST');
        expect(du.format(date, 'HHmm z', '15', 'UTC')).toBe('1215 UTC');
        expect(du.formatUseNoonMidnight(new Date('2026-01-01T00:00:00Z'), 'hhmm a', 0, 'UTC')).toBe('midnight');
        expect(du.formatUseNoonMidnight(new Date('2026-01-01T12:00:00Z'), 'hhmm a', 0, 'UTC')).toBe('noon');
        expect(utils.makeDateUtil().format(date, 'HHmm')).toBe('1208');
        expect(du.formatUseNoonMidnight(date, 'HHmm', 0, 'UTC')).toBe('1208');
    });

    it('implements list, math, and Java-style prototype helpers', () => {
        expect(utils.list.contains([1, 2], 2)).toBe(true);
        expect(utils.list.contains(null, 2)).toBe(false);
        expect(utils.list.contains({}, 2)).toBe(false);
        expect(utils.list.size('abc')).toBe(3);
        expect(utils.list.size({})).toBe(0);
        expect(utils.list.size(null)).toBe(0);
        expect(utils.list.get([1], 0)).toBe(1);
        expect(utils.list.get([1], 2)).toBeNull();
        expect(utils.list.get(null, 0)).toBeNull();
        expect(utils.list.get({}, 0)).toBeNull();
        expect(utils.mathUtil.round('1.6')).toBe(2);
        expect(utils.mathUtil.abs(-2)).toBe(2);
        expect(utils.mathUtil.roundTo5(12)).toBe(10);
        expect(utils.mathUtil.roundAndPad(-1)).toBe('000');
        expect(utils.mathUtil.roundAndPad(9)).toBe('009');
        expect(utils.mathUtil.roundAndPad(99)).toBe('099');
        expect(utils.mathUtil.roundAndPad(100)).toBe('100');
        utils.installJavaShims();
        expect([1, 2].contains(2)).toBe(true);
        expect([].isEmpty()).toBe(true);
        expect([1].equals([1])).toBe(true);
        expect('Test'.equalsIgnoreCase('test')).toBe(true);
        expect('abc'.contains('b')).toBe(true);
        expect(''.isEmpty()).toBe(true);
        expect('abc'.equals('abc')).toBe(true);
        expect('abc'.matches('a.*')).toBe(true);
        expect('a'.compareTo('b')).toBe(-1);
        expect('B'.compareToIgnoreCase('a')).toBe(1);
        expect((2).intValue()).toBe(2);
        expect((2).doubleValue()).toBe(2);
        expect((2).compareTo(2)).toBe(0);
    });
});

describe('WarnGen locking', () => {
    it('locks structural fields and strips them without changing text', () => {
        const locked = locking.lock(bulletin, {
            areas: [{ name: 'Douglas', areaNotation: 'County', parentRegion: 'Nebraska' }],
        });
        expect(locked).toContain('<L>NEC001-010200-');
        expect(locked).toContain('/O.NEW.KOAX.SV.W.0001.261101T0100Z-261101T0200Z/');
        expect(locked).toContain('Douglas County</L>');
        expect(locking.strip(locked)).toBe(bulletin.trimEnd());
    });

    it('locks follow-up headlines, marine products, and immediate causes', () => {
        const followup = `WHUS53 KLOT 010100\nSMWLOT\nLMZ740-010200-\n/O.CON.KLOT.MA.W.0001.261101T0100Z-261101T0200Z/\nNational Weather Service Chicago\n...THE SPECIAL MARINE WARNING REMAINS IN EFFECT UNTIL 900 PM CDT...\n`;
        expect(locking.lock(followup, { followup: true })).toContain('<L>...THE SPECIAL MARINE WARNING');
        const cause = bulletin.replace('Douglas County in east central Nebraska...', 'A DAM BREAK caused flooding...');
        const causeLocked = locking.lock(cause, { immediateCause: 'DM \\ DAM BREAK' });
        expect(causeLocked).toContain('A DAM BREAK caused flooding...');
        expect(locking.strip(causeLocked)).toBe(cause.trimEnd());
    });

    it('marks corrected products and cleans lock-only whitespace', () => {
        expect(locking.markCorrected('TORNADO WARNING\nNATIONAL WEATHER SERVICE')).toContain('WARNING...CORRECTED');
        expect(locking.markCorrected('NATIONAL WEATHER SERVICE')).toBe('NATIONAL WEATHER SERVICE');
        expect(locking.markCorrected('TORNADO WARNING...CORRECTED\nNATIONAL WEATHER SERVICE')).toContain('...CORRECTED');
        expect(locking.clean('a\n\n<L>   </L>\n\nb\r\n')).toBe('a\n\nb');
        expect(locking.strip(null)).toBe('null');
    });
});

describe('WarnGen bulletin parsing and QC', () => {
    it('parses a complete warning and retains the last result', () => {
        const parsed = parser.parseBulletin(bulletin);
        expect(parsed).toMatchObject({ valid: true, product: 'SVR', siteId: 'OAX', phenomenon: 'SV', significance: 'W', action: 'NEW', impactBased: true });
        expect(parsed.polygon).toHaveLength(3);
        expect(parsed.motion).toMatchObject({ bearingFrom: 90, speedKt: 30 });
        expect(parsed.areas[0]).toEqual({ state: 'NE', kind: 'C', code: '001' });
        expect(parser.last).toBe(parsed);
    });

    it('parses helper formats and rejects incomplete products', () => {
        expect(parser._parseVtecDate('261101T0100Z')?.toISOString()).toBe('2026-11-01T01:00:00.000Z');
        expect(parser._parseVtecDate('bad')).toBeNull();
        expect(parser._parseUgc('NEC001-003>005-010200-')).toHaveLength(4);
        expect(parser._parsePolygon(['LAT...LON 4100 09600 4110 09610 4100 09600'], 0)).toHaveLength(3);
        expect(parser._parsePolygon(['LAT...LON 4100'], 0)).toBeNull();
        expect(parser._parseTML('TIME...MOT...LOC 0100Z 090DEG 30KT 4100 09600')).toMatchObject({ hour: 1, minute: 0 });
        expect(parser._parseTML('bad')).toBeNull();
        expect(parser._parseTags('TORNADO...RADAR INDICATED\nMAX HAIL SIZE...1.00 IN')).toMatchObject({ TORNADO: 'RADAR INDICATED', 'MAX HAIL SIZE': '1.00 IN' });
        expect(parser.parseBulletin('')).toBeNull();
        expect(parser.parseBulletin('no header')).toBeNull();
    });

    it('selects bullets and recovers fill-ins by accepted text', () => {
        const bullets = [
            { name: 'a', group: 'g', default: true, parseString: '"ALPHA"' },
            { name: 'b', group: 'g', parseString: '"BETA","-GAMMA"' },
            { name: 'title', type: 'title', default: true },
        ];
        expect(parser.selectBulletsFromText(bullets, 'beta', {})).toEqual(['b']);
        expect(parser.selectBulletsFromText(bullets, 'alpha', { action: 'COR' })).toEqual(['a']);
        expect(parser._parseStringMatches('"ALPHA","-BETA"', 'alpha only')).toBe(true);
        expect(parser._parseStringMatches('', 'alpha')).toBe(false);
        expect(parser.recoverFillIns('Before !** DETAIL **! after.', 'Before recovered value after.')).toEqual([{ label: 'DETAIL', ordinal: 0, value: 'recovered value' }]);
        expect(parser.recoverFillIns('Signed !** NAME/INITIALS **!\n$$', 'Text\n$$\nABC')).toEqual([{ label: 'NAME/INITIALS', ordinal: 0, value: 'ABC' }]);
    });

    it('parses VTEC and reports the first QC failure', () => {
        expect(qc.parseVtec(bulletin)).toMatchObject({ action: 'NEW', phensig: 'SV.W' });
        expect(qc.parseVtec('none')).toBeNull();
        expect(qc.check(bulletin, 'XXX', new Date())).toBeNull();
        expect(qc.check('', 'SVR', new Date())).toMatchObject({ ok: false, check: 'wmo-header' });
        expect(qc.check('WUUS53 KOAX 010100\nSVROAX\n${BAD}', 'SVR', new Date())).toMatchObject({ ok: false });
    });
});
