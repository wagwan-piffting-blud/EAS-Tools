import { describe, expect, it } from 'vitest';
import {
    NWS_MOCK_NOTE,
    NWS_NOT_WEATHER_NOTE,
    NWS_TEXT_STYLE,
    areaPhrase,
    countyRegionsFromGeoJson,
    formatNwsStyle,
    isWatchEvent,
    nwsUntilText,
    officeFromSender,
    officeLocation,
} from '../assets/js/nws-text-style.js';

const OFFICES = {
    LOT: { label: 'Chicago IL', region: 'CR' },
    DVN: { label: 'Quad Cities Ia IL', region: 'CR' },
    SJU: { label: 'San Juan PR', region: 'SR' },
    PPG: { label: 'Pago Pago AS', region: 'PR' },
    IWX: { label: 'Northern Indiana', region: 'CR' },
    NOLABEL: {},
};

const REGIONS = {
    17031: ['NORTH', 'EAST'],
    17097: ['NORTH', 'EAST'],
    17019: ['EAST', 'CENTRAL'],
    40139: ['PA'],
    51510: ['NORTH'],
    11001: [],
};

const TZ = 'America/Chicago';

function detailed(overrides = {}) {
    const startTime = new Date(Date.UTC(2026, 4, 15, 21, 45));
    const durationHours = overrides.durationHours ?? 0;
    const durationMinutes = overrides.durationMinutes ?? 30;
    const endTime = new Date(startTime.getTime() + durationHours * 3600000 + durationMinutes * 60000);
    return {
        originator: 'WXR',
        originatorName: 'The National Weather Service',
        eventCode: 'TOR',
        eventName: 'a Tornado Warning',
        locations: ['017031'],
        locationNames: [{ code: '017031', subdivision: '', name: 'Cook County, IL' }],
        durationHours,
        durationMinutes,
        indefinite: durationHours === 0 && durationMinutes === 0,
        startTime,
        endTime,
        senderId: 'KLOT/NWS',
        ...overrides,
    };
}

describe('NWS-style decoder text', () => {
    it('renders a WarnGen-style short-fused warning headline', () => {
        const result = formatNwsStyle(detailed(), { offices: OFFICES, regions: REGIONS, timeZone: TZ });
        expect(result.ok).toBe(true);
        expect(result.note).toBe(NWS_MOCK_NOTE);
        expect(result.text).toBe([
            'The National Weather Service in Chicago has issued a',
            '',
            '* Tornado Warning for...',
            '  Cook County in northeastern Illinois...',
            '',
            '* Until 515 PM CDT.',
        ].join('\n'));
        expect(NWS_TEXT_STYLE).toBe('NWS');
    });

    it('falls back to the bare state when no area-of-state data is loaded', () => {
        const result = formatNwsStyle(detailed(), { offices: OFFICES, timeZone: TZ });
        expect(result.text).toContain('  Cook County in Illinois...');
        const missing = formatNwsStyle(detailed({
            locationNames: [{ code: '017043', subdivision: '', name: 'DuPage County, IL' }],
        }), { offices: OFFICES, regions: REGIONS, timeZone: TZ });
        expect(missing.text).toContain('  DuPage County in Illinois...');
    });

    it('declines non-weather originators so the caller keeps the plain wording', () => {
        expect(formatNwsStyle(detailed({ originator: 'CIV' }), { offices: OFFICES })).toEqual({
            ok: false,
            text: '',
            note: NWS_NOT_WEATHER_NOTE,
        });
        expect(formatNwsStyle(null).ok).toBe(false);
    });

    it('lists every area once, with subdivisions, independent cities, DC and unmapped names', () => {
        const result = formatNwsStyle(detailed({
            eventCode: 'SVR',
            eventName: 'a Severe Thunderstorm Warning',
            locationNames: [
                { code: '217031', subdivision: 'Northwest', name: 'Cook County, IL' },
                { code: '217031', subdivision: 'Northwest', name: 'Cook County, IL' },
                { code: '517019', subdivision: 'Central', name: 'Champaign County, IL' },
                { code: '051510', subdivision: '', name: 'City of Alexandria, VA' },
                { code: '951510', subdivision: 'Southeast', name: 'City of Alexandria, VA' },
                { code: '011001', subdivision: '', name: 'Washington, DC' },
                { code: '311001', subdivision: 'Northeast', name: 'Washington, DC' },
                { code: '040139', subdivision: '', name: 'Texas County, OK' },
                { code: '092741', subdivision: '', name: 'Lake Michigan from Wilmette Harbor to Northerly Island IL' },
                { code: '692741', subdivision: 'East', name: 'Lake Michigan nearshore' },
                { code: '099999', subdivision: '', name: 'Somewhere, ZZ' },
            ],
        }), { offices: OFFICES, regions: REGIONS, timeZone: TZ });
        expect(result.text.split('\n').slice(2, 14)).toEqual([
            '* Severe Thunderstorm Warning for...',
            '  Northwestern Cook County in northeastern Illinois...',
            '  Central Champaign County in east central Illinois...',
            '  The City of Alexandria in northern Virginia...',
            '  The southeastern City of Alexandria in northern Virginia...',
            '  The District of Columbia...',
            '  The northeastern District of Columbia...',
            '  Texas County in the Panhandle of Oklahoma...',
            '  Lake Michigan from Wilmette Harbor to Northerly Island IL...',
            '  Eastern Lake Michigan nearshore...',
            '  Somewhere, ZZ...',
            '',
        ]);
    });

    it('uses "an" for vowel events and supplies an article when the name has none', () => {
        const ewx = formatNwsStyle(detailed({ eventCode: 'EWW', eventName: 'an Extreme Wind Warning' }), { offices: OFFICES, timeZone: TZ });
        expect(ewx.text.split('\n')[0]).toBe('The National Weather Service in Chicago has issued an');
        const bare = formatNwsStyle(detailed({ eventCode: 'XYW', eventName: 'Ice Warning' }), { offices: OFFICES, timeZone: TZ });
        expect(bare.text).toContain('has issued an\n\n* Ice Warning for...');
        const plain = formatNwsStyle(detailed({ eventCode: 'XYW', eventName: 'Hail Warning' }), { offices: OFFICES, timeZone: TZ });
        expect(plain.text).toContain('has issued a\n\n* Hail Warning for...');
        const empty = formatNwsStyle(detailed({ eventName: undefined, locationNames: undefined }), { timeZone: TZ });
        expect(empty.text).toBe('The National Weather Service has issued a\n\n* TOR for...\n\n* Until 515 PM CDT.');
    });

    it('drops the office when the sender maps to none', () => {
        const result = formatNwsStyle(detailed({ senderId: 'WXL57' }), { offices: OFFICES, timeZone: TZ });
        expect(result.text.split('\n')[0]).toBe('The National Weather Service has issued a');
        const spcWarning = formatNwsStyle(detailed({ senderId: 'KWNS/NWS' }), { offices: OFFICES, timeZone: TZ });
        expect(spcWarning.text.split('\n')[0]).toBe('The National Weather Service has issued a');
    });

    it('names the issuing office for a watch the WFO relays', () => {
        const result = formatNwsStyle(detailed({ eventCode: 'TOA', eventName: 'a Tornado Watch' }), {
            offices: OFFICES,
            regions: REGIONS,
            timeZone: TZ,
        });
        expect(result.text).toBe([
            'The National Weather Service in Chicago has issued a',
            '',
            '* Tornado Watch for...',
            '  Cook County in northeastern Illinois...',
            '',
            '* Until 515 PM CDT.',
        ].join('\n'));
    });

    it('uses the Storm Prediction Center for national or unmapped watches', () => {
        const watch = detailed({
            eventCode: 'SVA',
            eventName: 'a Severe Thunderstorm Watch',
            durationHours: 6,
            durationMinutes: 0,
            senderId: 'KWNS/NWS',
            locationNames: [
                { code: '017031', subdivision: '', name: 'Cook County, IL' },
                { code: '017097', subdivision: '', name: 'Lake County, IL' },
                { code: '017019', subdivision: '', name: 'Champaign County, IL' },
                { code: '092741', subdivision: '', name: 'Lake Michigan nearshore' },
            ],
        });
        const result = formatNwsStyle(watch, { offices: OFFICES, regions: REGIONS, timeZone: TZ });
        expect(result.text).toBe([
            'The NWS Storm Prediction Center has issued a',
            '',
            '* Severe Thunderstorm Watch for portions of',
            '  Northeastern Illinois',
            '  East central Illinois',
            '  Lake Michigan nearshore',
            '',
            '* Effective from 445 PM until 1045 PM CDT.',
        ].join('\n'));

        const unmapped = formatNwsStyle({ ...watch, senderId: 'SPC' }, { offices: OFFICES, timeZone: TZ });
        expect(unmapped.text).toContain('The NWS Storm Prediction Center has issued a');
        expect(unmapped.text).toContain('  Illinois\n  Lake Michigan nearshore');
        const noOffice = formatNwsStyle({ ...watch, senderId: 'WXL57' }, { offices: OFFICES, timeZone: TZ });
        expect(noOffice.text.split('\n')[0]).toBe('The NWS Storm Prediction Center has issued a');
    });

    it('spells out both days when a watch runs past midnight', () => {
        const result = formatNwsStyle(detailed({
            eventCode: 'TOA',
            eventName: 'a Tornado Watch',
            durationHours: 8,
            durationMinutes: 0,
            senderId: 'KWNS',
        }), { offices: OFFICES, timeZone: TZ });
        expect(result.text.split('\n').pop()).toBe('* Effective from 445 PM CDT Friday until 1245 AM CDT Saturday.');
    });

    it('handles indefinite durations', () => {
        const warning = formatNwsStyle(detailed({ durationHours: 0, durationMinutes: 0 }), { offices: OFFICES, timeZone: TZ });
        expect(warning.text.split('\n').pop()).toBe('* Until further notice.');
        const watch = formatNwsStyle(detailed({ eventCode: 'TOA', durationHours: 0, durationMinutes: 0, senderId: 'KWNS' }), { timeZone: TZ });
        expect(watch.text.split('\n').pop()).toBe('* Effective until further notice.');
    });

    it('adds the weekday for long durations and treats missing duration fields as zero', () => {
        const long = formatNwsStyle(detailed({ eventCode: 'FFW', eventName: 'a Flash Flood Warning', durationHours: 6, durationMinutes: 0 }), {
            offices: OFFICES,
            timeZone: TZ,
        });
        expect(long.text.split('\n').pop()).toBe('* Until 1045 PM CDT Friday.');
        const odd = formatNwsStyle({ ...detailed(), durationHours: undefined, durationMinutes: undefined, indefinite: false }, {
            offices: OFFICES,
            timeZone: TZ,
        });
        expect(odd.text.split('\n').pop()).toBe('* Until 515 PM CDT.');
    });
});

describe('time phrasing', () => {
    it('formats NWS clock times with noon and midnight', () => {
        expect(nwsUntilText(new Date(Date.UTC(2026, 0, 6, 18, 0)), { timeZone: TZ })).toBe('noon CST');
        expect(nwsUntilText(new Date(Date.UTC(2026, 0, 6, 6, 0)), { timeZone: TZ })).toBe('midnight CST');
        expect(nwsUntilText(new Date(Date.UTC(2026, 0, 6, 6, 5)), { timeZone: TZ, longDuration: true })).toBe('1205 AM CST Tuesday');
        expect(nwsUntilText(new Date(Date.UTC(2026, 6, 4, 3, 30)), { timeZone: 'America/New_York' })).toBe('1130 PM EDT');
    });

    it('falls back to the runtime zone when the zone is not valid', () => {
        const text = nwsUntilText(new Date(Date.UTC(2026, 0, 6, 18, 0)), { timeZone: 'Not/AZone' });
        expect(text).toMatch(/^(?:\d{3,4} [AP]M|noon|midnight) \S+$/);
        expect(nwsUntilText(new Date(Date.UTC(2026, 0, 6, 18, 0)))).toMatch(/^(?:\d{3,4} [AP]M|noon|midnight) \S+$/);
    });
});

describe('lookups', () => {
    it('maps sender IDs to forecast offices', () => {
        expect(officeFromSender('KLOT/NWS', OFFICES)).toEqual({ id: 'LOT', location: 'Chicago' });
        expect(officeFromSender('klot nws', OFFICES)).toEqual({ id: 'LOT', location: 'Chicago' });
        expect(officeFromSender('KDVN/NWS', OFFICES)).toEqual({ id: 'DVN', location: 'Quad Cities Ia' });
        expect(officeFromSender('TJSJ/NWS', OFFICES)).toEqual({ id: 'SJU', location: 'San Juan' });
        expect(officeFromSender('NSTU/NWS', OFFICES)).toEqual({ id: 'PPG', location: 'Pago Pago' });
        expect(officeFromSender('IWX', OFFICES)).toEqual({ id: 'IWX', location: 'Northern Indiana' });
        expect(officeFromSender('NWS/KIWX', OFFICES)).toEqual({ id: 'IWX', location: 'Northern Indiana' });
        expect(officeFromSender('KWNS/NWS', OFFICES)).toEqual({ id: 'SPC', location: '' });
        expect(officeFromSender('SPC', null)).toEqual({ id: 'SPC', location: '' });
        expect(officeFromSender('KNOLABEL', OFFICES)).toBeNull();
        expect(officeFromSender('KXYZ/NWS', OFFICES)).toBeNull();
        expect(officeFromSender('TJSJ/NWS', null)).toBeNull();
        expect(officeFromSender(undefined, OFFICES)).toBeNull();
    });

    it('trims the state from office labels like WarnGen does', () => {
        expect(officeLocation('Chicago IL')).toBe('Chicago');
        expect(officeLocation('Baltimore MD/Washington DC')).toBe('Baltimore MD/Washington');
        expect(officeLocation('Northern Indiana')).toBe('Northern Indiana');
        expect(officeLocation(null)).toBe('');
    });

    it('recognizes watch event codes', () => {
        expect(isWatchEvent('TOA')).toBe(true);
        expect(isWatchEvent('SVA')).toBe(true);
        expect(isWatchEvent('FFA')).toBe(true);
        expect(isWatchEvent('TOR')).toBe(false);
        expect(isWatchEvent('A')).toBe(false);
        expect(isWatchEvent(null)).toBe(false);
    });

    it('phrases area-of-state codes the way #areaFormat does', () => {
        expect(areaPhrase(['NORTH', 'EAST'])).toBe('northeastern');
        expect(areaPhrase(['SOUTH', 'WEST'])).toBe('southwestern');
        expect(areaPhrase(['WEST'])).toBe('western');
        expect(areaPhrase(['north', 'central'])).toBe('north central');
        expect(areaPhrase(['CENTRAL'])).toBe('central');
        expect(areaPhrase(['PA'])).toBe('the Panhandle of');
        expect(areaPhrase(['UP'])).toBe('Upstate');
        expect(areaPhrase(['EA'])).toBe('east');
        expect(areaPhrase(['NE', 'SE'])).toBe('northeastern and southeastern');
        expect(areaPhrase(['NE', 'SE', 'CC'])).toBe('northeastern, southeastern and central');
        expect(areaPhrase(['ZZ'])).toBe('');
        expect(areaPhrase([])).toBe('');
        expect(areaPhrase(undefined)).toBe('');
    });

    it('indexes county area-of-state data from the WarnGen county GeoJSON', () => {
        const geojson = {
            type: 'FeatureCollection',
            features: [
                { properties: { fips: '17031', partOfParentRegion: ['NORTH', 'EAST'] } },
                { properties: { fips: '72127', partOfParentRegion: [] } },
                { properties: { fips: 17043, partOfParentRegion: ['NORTH'] } },
                { properties: { fips: '17097' } },
                { properties: null },
                null,
            ],
        };
        expect(countyRegionsFromGeoJson(geojson)).toEqual({ 17031: ['NORTH', 'EAST'], 72127: [] });
        expect(countyRegionsFromGeoJson(null)).toEqual({});
        expect(countyRegionsFromGeoJson({ features: 'nope' })).toEqual({});
    });
});
