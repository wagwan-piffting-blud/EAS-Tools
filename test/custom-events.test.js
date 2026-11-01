import { describe, expect, it } from 'vitest';
import {
    CUSTOM_EVENTS_CHANGE,
    CUSTOM_EVENTS_KEY,
    MAX_CUSTOM_EVENTS,
    addCustomEvent,
    customEventTable,
    eventDisplayName,
    isEventCode,
    onCustomEventsChange,
    readCustomEvents,
    removeCustomEvent,
    stripArticle,
    unrecognizedEventName,
    withArticle,
} from '../assets/js/custom-events.js';

function memoryStorage(initial = {}) {
    const data = new Map(Object.entries(initial));
    return {
        getItem: (key) => (data.has(key) ? data.get(key) : null),
        setItem: (key, value) => data.set(key, String(value)),
    };
}

describe('custom event codes', () => {
    it('validates codes and articles', () => {
        expect(isEventCode('WCN')).toBe(true);
        expect(isEventCode('wcn')).toBe(false);
        expect(isEventCode('WC')).toBe(false);
        expect(isEventCode(null)).toBe(false);
        expect(withArticle('Ice Warning')).toBe('an Ice Warning');
        expect(withArticle('Weather Watch')).toBe('a Weather Watch');
        expect(stripArticle('an Unrecognized Watch')).toBe('Unrecognized Watch');
        expect(stripArticle(undefined)).toBe('');
    });

    it('names unrecognized codes by their last letter, as ENDECs do', () => {
        expect(unrecognizedEventName('XYW')).toBe('an Unrecognized Warning');
        expect(unrecognizedEventName('XYA')).toBe('an Unrecognized Watch');
        expect(unrecognizedEventName('XYS')).toBe('an Unrecognized Statement');
        expect(unrecognizedEventName('XYE')).toBe('an Unrecognized Emergency');
        expect(unrecognizedEventName('WCN')).toBe('an Unrecognized Message');
        expect(unrecognizedEventName('')).toBe('an Unrecognized Message');
    });

    it('reads only well-formed entries', () => {
        const storage = memoryStorage({ [CUSTOM_EVENTS_KEY]: JSON.stringify({ WCN: ' Weather Watch ', bad: 'x', ABC: '', XYZ: 7 }) });
        expect(readCustomEvents(storage)).toEqual({ WCN: 'Weather Watch' });
        expect(readCustomEvents(memoryStorage({ [CUSTOM_EVENTS_KEY]: '{not json' }))).toEqual({});
        expect(readCustomEvents(memoryStorage({ [CUSTOM_EVENTS_KEY]: '[1,2]' }))).toEqual({});
        expect(readCustomEvents(null)).toEqual({});
        expect(readCustomEvents()).toEqual({});
    });

    it('adds, replaces and removes codes and announces each change', () => {
        const storage = memoryStorage();
        const target = new EventTarget();
        const seen = [];
        target.addEventListener(CUSTOM_EVENTS_CHANGE, (event) => seen.push(event.detail.events));

        const added = addCustomEvent(' wcn ', 'a  Weather   Watch', { storage, target });
        expect(added).toMatchObject({ ok: true, code: 'WCN', name: 'Weather Watch', replaced: false });
        expect(addCustomEvent('BMW', 'Biological Microbe Warning', { storage, target }).ok).toBe(true);
        expect(addCustomEvent('WCN', 'Weather Watch (AZ)', { storage, target })).toMatchObject({ ok: true, replaced: true });
        expect(Object.keys(JSON.parse(storage.getItem(CUSTOM_EVENTS_KEY)))).toEqual(['BMW', 'WCN']);
        expect(customEventTable(storage)).toEqual({ BMW: 'a Biological Microbe Warning', WCN: 'a Weather Watch (AZ)' });

        expect(removeCustomEvent('bmw', { storage, target })).toMatchObject({ ok: true, code: 'BMW' });
        expect(removeCustomEvent('BMW', { storage, target }).ok).toBe(false);
        expect(readCustomEvents(storage)).toEqual({ WCN: 'Weather Watch (AZ)' });
        expect(seen).toHaveLength(4);
        expect(seen[3]).toEqual({ WCN: 'Weather Watch (AZ)' });
    });

    it('refuses bad input with a reason', () => {
        const storage = memoryStorage();
        const reserved = new Set(['TOR']);
        expect(addCustomEvent('WC1', 'x', { storage }).error).toMatch(/three letters/);
        expect(addCustomEvent('TOR', 'Twister', { storage, reserved }).error).toMatch(/standard event code/);
        expect(addCustomEvent('WCN', '   ', { storage }).error).toMatch(/Give the code a name/);
        expect(addCustomEvent('WCN', 'x'.repeat(61), { storage }).error).toMatch(/60 characters/);
        expect(addCustomEvent('WCN', 'Weather Watch', { storage: null }).error).toMatch(/not letting the page save/);
        expect(storage.getItem(CUSTOM_EVENTS_KEY)).toBeNull();
    });

    it('caps the number of codes but still allows replacing one', () => {
        const full = {};
        for (let i = 0; i < MAX_CUSTOM_EVENTS; i++) full['Q' + String.fromCharCode(65 + Math.floor(i / 26)) + String.fromCharCode(65 + (i % 26))] = 'Code ' + i;
        const storage = memoryStorage({ [CUSTOM_EVENTS_KEY]: JSON.stringify(full) });
        expect(addCustomEvent('ZZZ', 'One too many', { storage, target: null }).error).toMatch(/up to 50/);
        expect(addCustomEvent('QAA', 'Renamed', { storage, target: null }).ok).toBe(true);
    });

    it('prefers the official name, then the custom one, then the unrecognized fallback', () => {
        const storage = memoryStorage({ [CUSTOM_EVENTS_KEY]: JSON.stringify({ WCN: 'Weather Watch' }) });
        expect(eventDisplayName('TOR', 'a Tornado Warning', storage)).toBe('a Tornado Warning');
        expect(eventDisplayName('WCN', undefined, storage)).toBe('a Weather Watch');
        expect(eventDisplayName('XYW', undefined, storage)).toBe('an Unrecognized Warning');
        expect(eventDisplayName('XYZ')).toBe('an Unrecognized Message');
    });

    it('notifies on local changes and on storage events from other documents', () => {
        const target = new EventTarget();
        const calls = [];
        const stop = onCustomEventsChange((events) => calls.push(events), target);
        target.dispatchEvent(new Event(CUSTOM_EVENTS_CHANGE));
        const storageEvent = (key) => Object.assign(new Event('storage'), { key });
        target.dispatchEvent(storageEvent(CUSTOM_EVENTS_KEY));
        target.dispatchEvent(storageEvent(null));
        target.dispatchEvent(storageEvent('something-else'));
        expect(calls).toHaveLength(3);
        stop();
        target.dispatchEvent(new Event(CUSTOM_EVENTS_CHANGE));
        expect(calls).toHaveLength(3);
        expect(typeof onCustomEventsChange(() => { }, null)).toBe('function');
    });
});
