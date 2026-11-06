import { describe, expect, it } from 'vitest';
import {
    CUSTOM_LOCATIONS_CHANGE,
    CUSTOM_LOCATIONS_KEY,
    MAX_CUSTOM_LOCATIONS,
    MAX_CUSTOM_LOCATION_NAME,
    addCustomLocation,
    customLocationName,
    isLocationCode,
    locationKey,
    onCustomLocationsChange,
    readCustomLocations,
    removeCustomLocation,
} from '../assets/js/custom-locations.js';

function memoryStorage(initial = {}) {
    const data = new Map(Object.entries(initial));
    return {
        getItem: (key) => (data.has(key) ? data.get(key) : null),
        setItem: (key, value) => data.set(key, String(value)),
    };
}

describe('custom location codes', () => {
    it('validates codes and drops the part-of-county digit', () => {
        expect(isLocationCode('17999')).toBe(true);
        expect(isLocationCode('017999')).toBe(false);
        expect(isLocationCode(17999)).toBe(false);
        expect(locationKey('17999')).toBe('17999');
        expect(locationKey(' 317999 ')).toBe('17999');
        expect(locationKey('1799')).toBe('');
        expect(locationKey('17A99')).toBe('');
        expect(locationKey(null)).toBe('');
    });

    it('reads only well-formed entries', () => {
        const storage = memoryStorage({ [CUSTOM_LOCATIONS_KEY]: JSON.stringify({ 17999: ' Springfield Township, IL ', 1799: 'x', 18999: '', 19999: 7 }) });
        expect(readCustomLocations(storage)).toEqual({ 17999: 'Springfield Township, IL' });
        expect(readCustomLocations(memoryStorage({ [CUSTOM_LOCATIONS_KEY]: '{not json' }))).toEqual({});
        expect(readCustomLocations(memoryStorage({ [CUSTOM_LOCATIONS_KEY]: '[1,2]' }))).toEqual({});
        expect(readCustomLocations(null)).toEqual({});
        expect(readCustomLocations()).toEqual({});
    });

    it('names a header code with or without its subdivision digit', () => {
        const storage = memoryStorage({ [CUSTOM_LOCATIONS_KEY]: JSON.stringify({ 17999: 'Springfield Township, IL' }) });
        expect(customLocationName('017999', storage)).toBe('Springfield Township, IL');
        expect(customLocationName('917999', storage)).toBe('Springfield Township, IL');
        expect(customLocationName('17999', storage)).toBe('Springfield Township, IL');
        expect(customLocationName('017998', storage)).toBeNull();
        expect(customLocationName('bad', storage)).toBeNull();
    });

    it('adds, replaces and removes codes and announces each change', () => {
        const storage = memoryStorage();
        const target = new EventTarget();
        const seen = [];
        target.addEventListener(CUSTOM_LOCATIONS_CHANGE, (event) => seen.push(event.detail.locations));

        const added = addCustomLocation('317999', '  Springfield   Township, IL ', { storage, target });
        expect(added).toMatchObject({ ok: true, code: '17999', name: 'Springfield Township, IL', replaced: false });
        expect(JSON.parse(storage.getItem(CUSTOM_LOCATIONS_KEY))).toEqual({ 17999: 'Springfield Township, IL' });

        addCustomLocation('12999', 'Key Largo Reef, FL', { storage, target });
        expect(Object.keys(JSON.parse(storage.getItem(CUSTOM_LOCATIONS_KEY)))).toEqual(['12999', '17999']);

        const replaced = addCustomLocation('17999', 'Springfield, IL', { storage, target });
        expect(replaced).toMatchObject({ ok: true, replaced: true });

        expect(removeCustomLocation('017999', { storage, target })).toMatchObject({ ok: true, code: '17999' });
        expect(removeCustomLocation('17999', { storage, target }).ok).toBe(false);
        expect(readCustomLocations(storage)).toEqual({ 12999: 'Key Largo Reef, FL' });
        expect(seen).toHaveLength(4);
    });

    it('explains every rejected entry', () => {
        const storage = memoryStorage();
        const reserved = (code) => code === '17031';
        expect(addCustomLocation('17999', 'x', { storage: null }).error).toMatch(/not letting/);
        expect(addCustomLocation('1799', 'x', { storage }).error).toMatch(/5 digits/);
        expect(addCustomLocation('017031', 'Cook', { storage, isReserved: reserved }).error).toBe('17031 is already a standard location code.');
        expect(addCustomLocation('17999', '   ', { storage }).error).toMatch(/Give the code a name/);
        expect(addCustomLocation('17999', 'x'.repeat(MAX_CUSTOM_LOCATION_NAME + 1), { storage }).error).toMatch(/characters or fewer/);
        expect(readCustomLocations(storage)).toEqual({});
    });

    it('caps how many codes are kept but still allows replacing one', () => {
        const full = {};
        for (let i = 0; i < MAX_CUSTOM_LOCATIONS; i++) full[String(10000 + i)] = 'Place ' + i;
        const storage = memoryStorage({ [CUSTOM_LOCATIONS_KEY]: JSON.stringify(full) });
        expect(addCustomLocation('99999', 'One too many', { storage }).error).toMatch(/up to 100/);
        expect(addCustomLocation('10000', 'Renamed', { storage }).ok).toBe(true);
    });

    it('notifies on same-page and cross-tab changes until unsubscribed', () => {
        const target = new EventTarget();
        const calls = [];
        const stop = onCustomLocationsChange((locations) => calls.push(locations), target);
        target.dispatchEvent(new Event(CUSTOM_LOCATIONS_CHANGE));
        const storageEvent = new Event('storage');
        storageEvent.key = CUSTOM_LOCATIONS_KEY;
        target.dispatchEvent(storageEvent);
        const other = new Event('storage');
        other.key = 'something-else';
        target.dispatchEvent(other);
        const cleared = new Event('storage');
        cleared.key = null;
        target.dispatchEvent(cleared);
        expect(calls).toHaveLength(3);
        stop();
        target.dispatchEvent(new Event(CUSTOM_LOCATIONS_CHANGE));
        expect(calls).toHaveLength(3);
        expect(onCustomLocationsChange(() => { }, null)()).toBeUndefined();
    });
});
