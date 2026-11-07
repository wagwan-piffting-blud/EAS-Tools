import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
    EVENT_CODE_SEVERITY,
    SEVERITY_LEVELS,
    eventSeverity,
    screenSeverity,
    severityFromEventCode,
    severityFromText
} from '../assets/js/event-severity.js';

const sameUs = JSON.parse(readFileSync(new URL('../assets/E2T/include/same-us.json', import.meta.url), 'utf8'));
const sameCa = JSON.parse(readFileSync(new URL('../assets/E2T/include/same-ca.json', import.meta.url), 'utf8'));

describe('severityFromText', () => {
    it.each([
        ['a Tornado Warning', 'Warning'],
        ['a Child Abduction Emergency', 'Warning'],
        ['an Evacuation Immediate', 'Warning'],
        ['a Practice/Demo Warning', 'Information'],
        ['a Tornado Watch', 'Watch'],
        ['a Power Outage Advisory', 'Advisory'],
        ['a Special Weather Statement', 'Statement'],
        ['a Required Weekly Test', 'Information'],
        ['the National Information Center', 'Information'],
        ['a Blue Alert', ''],
        ['', ''],
        [null, '']
    ])('%s -> %s', (text, expected) => {
        expect(severityFromText(text)).toBe(expected);
    });
});

describe('severityFromEventCode', () => {
    it('maps the GH #167 codes', () => {
        expect(severityFromEventCode('BLU')).toBe('Warning');
        expect(severityFromEventCode('mep')).toBe('Warning');
        for (const code of ['NMN', 'TXB', 'TXF', 'TXO', 'TXP', 'ADR', 'ADM', 'TOM']) {
            expect(severityFromEventCode(code)).toBe('Advisory');
        }
    });

    it('returns nothing for unmapped or prototype keys', () => {
        expect(severityFromEventCode('TOR')).toBe('');
        expect(severityFromEventCode('toString')).toBe('');
        expect(severityFromEventCode(undefined)).toBe('');
    });

    it('only uses known levels', () => {
        for (const level of Object.values(EVENT_CODE_SEVERITY)) {
            expect(SEVERITY_LEVELS).toContain(level);
        }
    });
});

describe('eventSeverity', () => {
    it('prefers a severity word in the text', () => {
        expect(eventSeverity('a Blue Alert Warning', 'BLU')).toBe('Warning');
        expect(eventSeverity('a Tornado Watch', 'MEP')).toBe('Watch');
    });

    it('falls back to the event code when the text has no severity word', () => {
        expect(eventSeverity('The Sheriff has issued a Blue Alert for Union, NJ.', 'BLU')).toBe('Warning');
        expect(eventSeverity('', 'TXO')).toBe('Advisory');
    });

    it('lets the event code beat incidental test/information wording', () => {
        expect(eventSeverity('a Blue Alert for Testerville', 'BLU')).toBe('Warning');
        expect(eventSeverity('a Required Monthly Test', 'RMT')).toBe('Information');
    });

    it('returns nothing when neither source knows', () => {
        expect(eventSeverity('a Something Else', 'ZZZ')).toBe('');
    });

    it('gives every shipped US and Canadian event a severity', () => {
        const missing = [];
        for (const table of [sameUs.EVENTS, sameCa.EVENTS]) {
            for (const [code, name] of Object.entries(table)) {
                if (!eventSeverity(name, code)) missing.push(`${code} ${name}`);
            }
        }
        expect(missing).toEqual([]);
    });
});

describe('screenSeverity', () => {
    it.each([
        ['a Tornado Warning', 'TOR', 'warning'],
        ['a Blue Alert', 'BLU', 'warning'],
        ['a Tornado Watch', 'TOA', 'watch'],
        ['a Network Message Notification', 'NMN', 'advisory'],
        ['a Special Weather Statement', 'SPS', 'advisory'],
        ['a Required Weekly Test', 'RWT', 'advisory'],
        ['', '', 'advisory']
    ])('%s (%s) -> %s', (text, code, expected) => {
        expect(screenSeverity(text, code)).toBe(expected);
    });
});
