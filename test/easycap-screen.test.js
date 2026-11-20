import { describe, expect, it } from 'vitest';
import {
    EASYCAP_DEFAULTS,
    EASYCAP_FONTS,
    EASYCAP_NBSP,
    EASYCAP_SDI_SOURCE,
    EASYCAP_SOURCE,
    easycapAreaText,
    easycapCharsPerSecond,
    easycapCrawlActive,
    easycapCrawlHeaderTop,
    easycapCrawlRow,
    easycapCrawlSpeed,
    easycapDimensions,
    easycapEventName,
    easycapGeometry,
    easycapHeaderLines,
    easycapMessage,
    easycapPageCounter,
    easycapPageDelayMs,
    easycapPageLayout,
    easycapPlainText,
    easycapUntilText,
    easycapZoneName,
    isEasycapSource,
    normalizeEasycapSettings,
    paginateEasycapLines,
    wrapEasycapText
} from '../assets/js/easycap-screen.js';

const STATES = { '24': 'Maryland', '42': 'Pennsylvania', '34': 'New Jersey', '11': 'District of Columbia' };
const stateName = (code) => STATES[String(code).slice(1, 3)] || '';
const charMeasure = (text) => text.length;

describe('normalizeEasycapSettings', () => {
    it('fills the manual defaults', () => {
        expect(normalizeEasycapSettings()).toEqual({ ...EASYCAP_DEFAULTS });
        expect(normalizeEasycapSettings(null)).toEqual({ ...EASYCAP_DEFAULTS });
    });

    it('clamps and validates every field', () => {
        expect(normalizeEasycapSettings({
            title: '  Alerta   de  Emergencia ',
            showEvent: false,
            pageNumbersBottom: false,
            font: 'mono',
            speed: 250,
            background: '#00ff00',
            displayMode: '720p',
            crawl: true,
            position: 0,
            sdiSpeed: 11.6
        })).toEqual({
            title: 'Alerta de Emergencia',
            showEvent: false,
            pageNumbersBottom: false,
            font: 'mono',
            speed: 99,
            background: '#00FF00',
            displayMode: '720p',
            crawl: true,
            position: 1,
            sdiSpeed: 10
        });
        const fallback = normalizeEasycapSettings({ font: 'comic', background: 'blue', displayMode: '4k', speed: 'fast', showEvent: 'yes' });
        expect(fallback.font).toBe('sans');
        expect(fallback.background).toBe('#1010C8');
        expect(fallback.displayMode).toBe('1080i');
        expect(fallback.speed).toBe(12);
        expect(fallback.showEvent).toBe(true);
        expect(normalizeEasycapSettings({ title: '' }).title).toBe('');
    });
});

describe('sources and output sizes', () => {
    it('recognises both EASyCAP screens', () => {
        expect(isEasycapSource(EASYCAP_SOURCE)).toBe(true);
        expect(isEasycapSource(EASYCAP_SDI_SOURCE)).toBe(true);
        expect(isEasycapSource('psc_902')).toBe(false);
        expect(Object.keys(EASYCAP_FONTS)).toEqual(['sans', 'serif', 'mono']);
    });

    it('sizes analog at 640x480 and SDI by display mode', () => {
        expect(easycapDimensions(EASYCAP_SOURCE, { displayMode: '720p' })).toEqual({ width: 640, height: 480 });
        expect(easycapDimensions(EASYCAP_SDI_SOURCE, {})).toEqual({ width: 1920, height: 1080 });
        expect(easycapDimensions(EASYCAP_SDI_SOURCE, { displayMode: '480i' })).toEqual({ width: 640, height: 480 });
    });

    it('uses characters per second on analog and 3 cps per SDI speed step', () => {
        expect(easycapCharsPerSecond(EASYCAP_SOURCE, {})).toBe(12);
        expect(easycapCharsPerSecond(EASYCAP_SOURCE, { speed: 20 })).toBe(20);
        expect(easycapCharsPerSecond(EASYCAP_SDI_SOURCE, {})).toBe(12);
        expect(easycapCharsPerSecond(EASYCAP_SDI_SOURCE, { sdiSpeed: 10 })).toBe(30);
    });

    it('only crawls on the SDI screen with the crawl enabled', () => {
        expect(easycapCrawlActive(EASYCAP_SDI_SOURCE, { crawl: true })).toBe(true);
        expect(easycapCrawlActive(EASYCAP_SDI_SOURCE, { crawl: false })).toBe(false);
        expect(easycapCrawlActive(EASYCAP_SOURCE, { crawl: true })).toBe(false);
    });
});

describe('easycapGeometry', () => {
    it('keeps the measured 640x480 layout', () => {
        expect(easycapGeometry(640, 480)).toMatchObject({
            scale: 1,
            margin: 14,
            wrapWidth: 612,
            titleSize: 39,
            bodySize: 35,
            firstBaseline: 48,
            titlePitch: 44,
            bodyGap: 52,
            bodyPitch: 40,
            counterBaseline: 440
        });
    });

    it('scales by height and widens the wrap on 16:9', () => {
        const geometry = easycapGeometry(1920, 1080);
        expect(geometry.scale).toBe(2.25);
        expect(geometry.bodySize).toBeCloseTo(78.75);
        expect(geometry.wrapWidth).toBeCloseTo(1857);
    });
});

describe('easycapAreaText', () => {
    const loc = (code, name, subdivision = '') => ({ code, name, subdivision });

    it('reads a whole state the way the RWT photo does', () => {
        expect(easycapAreaText([loc('024000', 'State of Maryland')], stateName)).toBe(`All${EASYCAP_NBSP}of${EASYCAP_NBSP}Maryland`);
    });

    it('groups counties by state', () => {
        expect(easycapAreaText([
            loc('042017', 'Bucks County, PA'),
            loc('042091', 'Montgomery County, PA'),
            loc('034021', 'Mercer County, NJ'),
            loc('042017', 'Bucks County, PA')
        ], stateName)).toBe('the following Pennsylvania counties: Bucks, Montgomery and the following New Jersey counties: Mercer');
    });

    it('keeps multi-word places together and handles cities and subdivisions', () => {
        const text = easycapAreaText([
            loc('124510', 'City of Baltimore, MD', 'Northwest'),
            loc('024033', "Prince George's County, MD"),
            loc('011000', 'District of Columbia, DC')
        ], (code) => (code.slice(1, 3) === '24' ? 'Maryland' : stateName(code)));
        expect(easycapPlainText(text)).toBe("All of District of Columbia and the following Maryland counties: Northwest Baltimore city, Prince George's");
        expect(text).toContain(`Prince${EASYCAP_NBSP}George's`);
    });

    it('lists the nation, unknown places and empty input plainly', () => {
        expect(easycapAreaText([loc('024000', 'State of Maryland'), loc('000000', 'All of The United States')], stateName)).toBe('the United States');
        expect(easycapPlainText(easycapAreaText([loc('075650', 'Coastal waters from X to Y, AM'), loc('099999', 'FIPS Code 099999')]))).toBe('Coastal waters from X to Y, AM and FIPS Code 099999');
        expect(easycapAreaText([loc('057000', 'Eastern North Pacific Ocean')])).toBe(`Eastern${EASYCAP_NBSP}North${EASYCAP_NBSP}Pacific${EASYCAP_NBSP}Ocean`);
        expect(easycapAreaText([], stateName)).toBe('your area');
        expect(easycapAreaText(null)).toBe('your area');
        expect(easycapAreaText([null, loc('', ''), loc('', 'Somewhere, ZZ')])).toBe('Somewhere, ZZ');
    });
});

describe('time and message wording', () => {
    const july10 = new Date(Date.UTC(2025, 6, 10, 7, 15));

    it('formats the purge time like the RWT photo', () => {
        expect(easycapUntilText(july10, 'America/New_York', 'EDT')).toBe('July 10, 03:15 AM EDT');
        expect(easycapUntilText(new Date(Date.UTC(2025, 0, 5, 18, 0)), 'America/Chicago')).toBe('January 05, 12:00 PM');
        expect(easycapUntilText('not a date', 'UTC')).toBe('');
        expect(easycapUntilText(july10.getTime())).toBe('July 10, 07:15 AM');
    });

    it('names the time zone, or falls back to the given zone', () => {
        expect(easycapZoneName(july10, 'America/New_York')).toBe('EDT');
        expect(easycapZoneName(july10.getTime(), 'UTC')).toBe('UTC');
        expect(easycapZoneName(july10, 'Not/AZone')).toBe('Not/AZone');
    });

    it('builds the RWT sentence', () => {
        expect(easycapPlainText(easycapMessage({
            originatorCode: 'EAS',
            originatorName: 'An EAS Participant',
            eventName: 'a Required Weekly Test',
            areaText: easycapAreaText([{ code: '024000', name: 'State of Maryland' }], stateName),
            untilText: 'July 10, 03:15 AM EDT'
        }))).toBe('An EAS Participant has issued a Required Weekly Test for All of Maryland. Effective until July 10, 03:15 AM EDT.');
    });

    it('adds the sender and the civil-authority wording', () => {
        expect(easycapMessage({
            originatorCode: 'CIV',
            originatorName: 'A Civil Authority',
            eventName: 'Evacuation Immediate',
            areaText: 'X',
            untilText: 'May 01, 01:00 PM CDT',
            sender: ' Comcast '
        })).toBe('The Civil Authorities have issued an Evacuation Immediate for X. Effective until May 01, 01:00 PM CDT. Comcast');
        expect(easycapMessage({ eventName: 'Blue Alert' })).toBe('An EAS Participant has issued a Blue Alert for your area.');
        expect(easycapMessage()).toBe('An EAS Participant has issued a  for your area.');
    });

    it('strips the article for the event line', () => {
        expect(easycapEventName('a  Required Weekly Test')).toBe('Required Weekly Test');
        expect(easycapEventName(null)).toBe('');
    });
});

describe('wrapping and pages', () => {
    it('breaks between words and never inside a place name', () => {
        const text = `alpha beta for All${EASYCAP_NBSP}of${EASYCAP_NBSP}Maryland. gamma`;
        expect(wrapEasycapText(text, charMeasure, 16)).toEqual(['alpha beta for', 'All of Maryland.', 'gamma']);
    });

    it('splits a place name only when it cannot fit on a line', () => {
        const text = `x ${['One', 'Two', 'Three', 'Four'].join(EASYCAP_NBSP)}`;
        expect(wrapEasycapText(text, charMeasure, 9)).toEqual(['x One Two', 'Three', 'Four']);
        expect(wrapEasycapText('abcdefghijklmnop', charMeasure, 4)).toEqual(['abcdefghijklmnop']);
    });

    it('keeps line breaks and drops extra spaces', () => {
        expect(wrapEasycapText('one  two\r\nthree\n\nfour', charMeasure, 20)).toEqual(['one two', 'three', 'four']);
        expect(wrapEasycapText(null, charMeasure, 20)).toEqual([]);
    });

    it('stacks the title and the event name', () => {
        expect(easycapHeaderLines({ title: 'Emergency Alert System', eventText: 'Required Weekly Test' }, charMeasure, 30))
            .toEqual(['Emergency Alert System', 'Required Weekly Test']);
        expect(easycapHeaderLines({ title: ' ', eventText: 'Tornado Warning', showEvent: false }, charMeasure, 30)).toEqual([]);
        expect(easycapHeaderLines({}, charMeasure, 30)).toEqual([]);
    });

    it('fits seven body lines under the title block on 640x480', () => {
        const geometry = easycapGeometry(640, 480);
        expect(easycapPageLayout(geometry, 2)).toEqual({ headerBaselines: [48, 92], bodyStart: 144, linesPerPage: 7, counterBaseline: 440 });
        expect(easycapPageLayout(geometry, 2, { counterAtTop: true })).toEqual({ headerBaselines: [92, 136], bodyStart: 188, linesPerPage: 7, counterBaseline: 48 });
        expect(easycapPageLayout(geometry, 0)).toMatchObject({ headerBaselines: [], bodyStart: 56, linesPerPage: 9 });
    });

    it('pages lines and counts pages like the NPT capture', () => {
        const lines = Array.from({ length: 15 }, (_, index) => `line ${index}`);
        const pages = paginateEasycapLines(lines, 7);
        expect(pages.map((page) => page.length)).toEqual([7, 7, 1]);
        expect(paginateEasycapLines([], 0)).toEqual([['']]);
        expect(easycapPageCounter(3, 4)).toBe('- 4 of 4 -');
        expect(easycapPageCounter(0, 1)).toBe('');
    });

    it('holds each page for its characters at the set speed', () => {
        expect(easycapPageDelayMs(['x'.repeat(120)], 12)).toBe(10000);
        expect(easycapPageDelayMs('short', 12)).toBe(1000);
        expect(easycapPageDelayMs(['a'.repeat(30), 'b'.repeat(29)], 0)).toBe(5000);
    });
});

describe('SDI crawl', () => {
    it('puts the crawl on one of twelve rows', () => {
        expect(easycapCrawlRow(2, 1080, 79)).toEqual({ row: 2, center: 135, top: 91 });
        expect(easycapCrawlRow(99, 480, 35)).toMatchObject({ row: 12, center: 460 });
        expect(easycapCrawlRow('x', 480, 35).row).toBe(2);
    });

    it('moves the title block to the middle only when the crawl would cover it', () => {
        const geometry = easycapGeometry(1920, 1080);
        expect(easycapCrawlHeaderTop(geometry, 2, easycapCrawlRow(2, 1080, 79))).toBeCloseTo(540 - (99 + 87.75 + 26.325) / 2 + 87.75);
        expect(easycapCrawlHeaderTop(geometry, 2, easycapCrawlRow(10, 1080, 79))).toBe(geometry.firstBaseline);
        expect(easycapCrawlHeaderTop(geometry, 0, easycapCrawlRow(1, 1080, 79))).toBe(geometry.firstBaseline);
    });

    it('turns characters per second into crawl pixels per frame', () => {
        expect(easycapCrawlSpeed(12, 79)).toBe(9);
        expect(easycapCrawlSpeed(30, 79, 30)).toBe(20);
        expect(easycapCrawlSpeed(0, 0)).toBe(1);
    });
});
