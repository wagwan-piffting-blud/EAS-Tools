import { describe, expect, it } from 'vitest';
import {
    DEFAULT_PROFILE,
    PROFILES,
    formatLocation,
    lookupEvent,
    parseHeader,
    resolveIssueTime,
    translate,
    translateAll,
} from '../assets/js/dasdec-translate.js';

const base = { timeZone: 'America/Chicago', referenceDate: new Date('2026-11-17T00:00:00Z') };
const T = PROFILES['3.1-0_04'].templates;

describe('cases from the eas_decoder disassembly (the captured DASDEC fixtures stay in eas-translate)', () => {
    it.each([
        [
            'subdivision, same-state suffix drop, Louisiana switches to AREAS',
            'ZCZC-WXR-TOR-148113-048439-022071+0045-3212315-KFWD/NWS-',
            { profile: '3.1-0_04', lang: 'en' },
            'THE NATIONAL WEATHER SERVICE HAS ISSUED A TORNADO WARNING FOR THE FOLLOWING AREAS:\n'
                + 'Northwest Dallas;\nTarrant, TX;\nOrleans, LA;\n'
                + 'AT 5:15 PM\nON NOV 17, 2026\nEFFECTIVE UNTIL 6:00 PM.\nMESSAGE FROM KFWD/NWS.\n',
        ],
        [
            'Spanish keeps English subdivision word and two-space AREAS intro',
            'ZCZC-WXR-TOR-148113-048439-022071+0045-3212315-KFWD/NWS-',
            { profile: '2.6-0_a03', lang: 'es' },
            'El Servicio Meteorologico Nacional Ha Publicado UN AVISO DE TORNADO  Para Los Siguientes Areas:\n'
                + 'Northwest Dallas;\nTarrant, TX;\nOrleans, LA;\n'
                + 'En 5:15 PM\nde NOVIEMBRE 17, 2026\nEfectiva hasta 6:00 PM.\nUn mensaje de KFWD/NWS.\n',
        ],
        [
            'EAN with zero purge',
            'ZCZC-PEP-EAN-000000+0000-3211800-WHITEHSE-',
            { profile: '2.6-0_a03', lang: 'en' },
            'THE PRIMARY ENTRY POINT EAS SYSTEM HAS ISSUED AN EMERGENCY ACTION NOTIFICATION FOR :\n'
                + 'United States;\nAT 12:00 PM\nON NOV 17, 2026\n'
                + 'DURATION NOT PROVIDED, EFFECTIVE UNTIL ENDED by NATIONAL EMERGENCY ACTION NOTIFICATION or TERMINATION Alert.\n'
                + 'MESSAGE FROM WHITEHSE.\n',
        ],
        [
            'Spanish expiry on another day uses English month table',
            'ZCZC-WXR-FFW-015001+0330-3240847-KBGX    -',
            { profile: '2.6-0_a03', lang: 'es', timeZone: 'Pacific/Honolulu', referenceDate: new Date('2019-11-20T00:00:00Z') },
            'El Servicio Meteorologico Nacional Ha Publicado UN AVISO DE INUNDACION REPENTINA Para Los Siguientes Condados:\n'
                + 'Hawaii, HI;\nEn 10:47 PM\nde NOVIEMBRE 19, 2019\nEfectiva hasta 2:17 AM\n NOV 20, 2019.\nUn mensaje de KBGX.\n',
        ],
        [
            'unknown event code and blank station',
            'ZCZC-CIV-XYZ-001001-001003-013001+0100-3211800-        -',
            { profile: '3.1-0_04', lang: 'en' },
            'A CIVIL AUTHORITY HAS ISSUED A Special Alert (Code XYZ) FOR THE FOLLOWING COUNTIES OR AREAS:\n'
                + 'Autauga;\nBaldwin, AL;\nAppling, GA;\nAT 12:00 PM\nON NOV 17, 2026\nEFFECTIVE UNTIL 1:00 PM.\nMESSAGE FROM UNKNOWN.\n',
        ],
    ])('%s', (_name, header, opts, expected) => {
        expect(translate(header, { ...base, ...opts }).text).toBe(expected);
    });
});

describe('originator phrases', () => {
    const header = (org) => `ZCZC-${org}-RWT-031055+0100-3211800-KOAX/NWS-`;

    it('picks PEP, a custom name, WXR, CIV and the EAS contexts in English', () => {
        expect(translate(header('PEP'), base).text.startsWith(T.en.orgPEP)).toBe(true);
        expect(translate(header('WXR'), { ...base, originatorName: 'KOAX' }).text.startsWith(T.en.orgCustom.replace('%s', 'KOAX'))).toBe(true);
        expect(translate(header('WXR'), { ...base, originatorName: 'KOAX', context: 'forwarded' }).text.startsWith(T.en.orgCustomForwarded.replace('%s', 'KOAX'))).toBe(true);
        expect(translate(header('WXR'), base).text.startsWith(T.en.orgWXR)).toBe(true);
        expect(translate(header('CIV'), base).text.startsWith(T.en.orgCIV)).toBe(true);
        expect(translate(header('EAS'), { ...base, context: 'decoded' }).text.startsWith(T.en.orgEASDecoded)).toBe(true);
        expect(translate(header('EAS'), { ...base, context: 'forwarded' }).text.startsWith(T.en.orgEASForwarded)).toBe(true);
        expect(translate(header('EAS'), { ...base, context: 'originated' }).text.startsWith(T.en.orgEASOriginated)).toBe(true);
        const anonymous = translate(header('EAS'), { ...base, context: 'anonymous' }).text;
        expect(anonymous.startsWith(T.en.article)).toBe(true);
        expect(anonymous).toContain(T.en.noOriginator);
    });

    it('picks the same phrases in Spanish', () => {
        const es = { ...base, lang: 'es' };
        expect(translate(header('PEP'), es).text.startsWith(T.es.orgPEP)).toBe(true);
        expect(translate(header('WXR'), { ...es, originatorName: 'KOAX' }).text.startsWith(T.es.orgCustom.replace('%s', 'KOAX'))).toBe(true);
        expect(translate(header('WXR'), es).text.startsWith(T.es.orgWXR)).toBe(true);
        expect(translate(header('CIV'), es).text.startsWith(T.es.orgCIV)).toBe(true);
        expect(translate(header('EAS'), es).text.startsWith(T.es.orgEAS)).toBe(true);
        expect(translate(header('EAS'), { ...es, context: 'anonymous' }).text).toContain(T.es.noOriginator);
        expect(translate(header('EAS'), { ...es, context: 'anonymous', testBanner: true }).text).toContain(T.es.orgEAS);
    });
});

describe('options', () => {
    const header = 'ZCZC-WXR-SVR-031055+0100-3210000-KOAX/NWS-';

    it('wraps a test banner and drops the station line', () => {
        const en = translate(header, { ...base, testBanner: true, includeStation: false }).text;
        expect(en.startsWith(T.en.testPrefix)).toBe(true);
        expect(en.endsWith(T.en.testSuffix)).toBe(true);
        expect(en).not.toContain('KOAX');
        const es = translate(header, { ...base, lang: 'es', testBanner: true }).text;
        expect(es.startsWith(T.es.testPrefix)).toBe(true);
        expect(es.endsWith(T.es.testSuffix)).toBe(true);
    });

    it('prints midnight as 12 AM and returns times and a one-line form', () => {
        const out = translate(header, base);
        expect(out.text).toContain('AT 6:00 PM');
        expect(translate('ZCZC-WXR-SVR-031055+0100-3210600-KOAX/NWS-', base).text).toContain('AT 12:00 AM');
        expect(out.oneLine).not.toContain('\n');
        expect(out.lines.length).toBeGreaterThan(4);
        expect(out.expiresAt.getTime() - out.issuedAt.getTime()).toBe(3600000);
        expect(out.profile).toBe(DEFAULT_PROFILE);
    });

    it('uses custom location names, state-wide and any-location codes', () => {
        const out = translate('ZCZC-WXR-SVR-031055-031000-031***-099001+0100-3211800-KOAX/NWS-', {
            ...base,
            locationNames: { '031055': 'Omaha Metro' },
        });
        expect(out.text).toContain('Omaha Metro;\nNebraska;\nNebraska any location;\n;\n');
    });

    it('handles national events and alerts with no locations', () => {
        expect(translate('ZCZC-PEP-NPT+0100-3211800-WHITEHSE-', base).text).toContain(T.en.forNational);
        expect(translate('ZCZC-WXR-SVR+0100-3211800-KOAX/NWS-', base).text).toContain(T.en.noLocations);
    });

    it('fixes the Spanish quirks when faithful is off', () => {
        const header = 'ZCZC-WXR-TOR-148113+0330-3240847-KFWD/NWS-';
        const opts = { lang: 'es', timeZone: 'America/Chicago', referenceDate: new Date('2026-11-20T00:00:00Z') };
        expect(translate(header, opts).text).toContain('Northwest Dallas');
        expect(translate(header, { ...opts, faithful: false }).text).toContain(PROFILES['3.1-0_04'].subdivisions.es[1]);
    });

    it('accepts a parsed header and a profile object', () => {
        const parsed = parseHeader(header);
        expect(translate(parsed, { ...base, profile: PROFILES['2.6-0_a03'] }).profile).toBe('2.6-0_a03');
        const both = translateAll(header, base);
        expect(both.en.lang).toBe('en');
        expect(both.es.lang).toBe('es');
    });

    it('rejects bad options and headers', () => {
        expect(() => translate(header, { lang: 'fr' })).toThrow(/Unsupported lang/);
        expect(() => translate(header, { context: 'nope' })).toThrow(/Unknown context/);
        expect(() => translate(header, { profile: '9.9' })).toThrow(/Unknown profile/);
        expect(() => parseHeader('hello')).toThrow(/Not a SAME header/);
        expect(() => parseHeader('ZCZC-WXR-SVR-031055+0100-3672500-KOAX/NWS-')).toThrow(/Bad issue time/);
    });
});

describe('helpers', () => {
    it('parses a header found inside other text', () => {
        const h = parseHeader('noise ZCZC-CIV-RMT-015000+0130-0912114-KAGB    - more');
        expect(h).toMatchObject({ originator: 'CIV', event: 'RMT', locations: ['015000'], purgeSeconds: 5400, julianDay: 91, station: 'KAGB    ' });
    });

    it('picks the year that puts the issue time closest to the reference date', () => {
        const h = parseHeader('ZCZC-WXR-SVR-031055+0100-3652300-KOAX/NWS-');
        expect(resolveIssueTime(h, new Date('2027-01-01T05:00:00Z')).toISOString()).toBe('2026-12-31T23:00:00.000Z');
    });

    it('looks up events and formats locations', () => {
        expect(lookupEvent('TOR')).toBe('TORNADO WARNING');
        expect(lookupEvent('ZZZ', 'es')).toBeNull();
        expect(formatLocation('148113')).toBe('Northwest Dallas, TX');
        expect(formatLocation('148113', { lang: 'es', faithful: false })).toContain(PROFILES['3.1-0_04'].subdivisions.es[1]);
    });
});
