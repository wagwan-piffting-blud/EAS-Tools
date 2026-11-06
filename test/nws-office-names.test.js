import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildOfficeNames, officeLocation } from '../tools/build-nws-office-names.mjs';
import { formatNwsStyle, officeFromSender } from '../assets/js/nws-text-style.js';

const ROOT = path.resolve(import.meta.dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'warngen', 'index.html'), 'utf8');
const shipped = JSON.parse(fs.readFileSync(path.join(ROOT, 'assets', 'nws-office-names.json'), 'utf8'));

describe('NWS office names from WarnGen', () => {
    it('ships exactly what WarnGen would print', () => {
        expect(shipped).toEqual(buildOfficeNames(html));
    });

    it('follows getOfficeMeta: call sign and trailing state dropped', () => {
        expect(officeLocation('KABQ Albuquerque NM')).toBe('Albuquerque');
        expect(officeLocation('KLOT Chicago/Romeoville')).toBe('Chicago/Romeoville');
        expect(officeLocation('Northern Indiana')).toBe('Northern Indiana');
    });

    it('rejects a table WarnGen no longer has', () => {
        expect(() => buildOfficeNames('nothing here')).toThrow(/OFFICE_LABELS not found/);
    });

    it('names offices by sender with the WarnGen names', () => {
        const offices = { LOT: 'Chicago', DVN: 'the Quad Cities', SJU: 'San Juan' };
        expect(officeFromSender('KDVN/NWS', offices)).toEqual({ id: 'DVN', location: 'the Quad Cities' });
        expect(officeFromSender('TJSJ/NWS', offices)).toEqual({ id: 'SJU', location: 'San Juan' });
        const result = formatNwsStyle({
            originator: 'WXR',
            eventCode: 'TOR',
            eventName: 'a Tornado Warning',
            senderId: 'KDVN/NWS',
            locationNames: [{ code: '019163', subdivision: '', name: 'Scott County, IA' }],
            startTime: new Date('2026-05-15T22:00:00Z'),
            endTime: new Date('2026-05-15T22:30:00Z'),
            durationHours: 0,
            durationMinutes: 30,
        }, { offices, timeZone: 'America/Chicago' });
        expect(result.text.startsWith('The National Weather Service in the Quad Cities has issued a')).toBe(true);
    });
});
