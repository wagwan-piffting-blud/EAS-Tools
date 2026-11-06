export const CUSTOM_LOCATIONS_KEY = 'eas-tools-custom-locations';
export const CUSTOM_LOCATIONS_CHANGE = 'eas:custom-locations-change';
export const MAX_CUSTOM_LOCATIONS = 100;
export const MAX_CUSTOM_LOCATION_NAME = 60;

const defaultStorage = () => {
    try {
        return globalThis.localStorage || null;
    } catch {
        return null;
    }
};

export function isLocationCode(code) {
    return typeof code === 'string' && /^\d{5}$/.test(code);
}

export function locationKey(rawCode) {
    const digits = String(rawCode ?? '').trim();
    if (/^\d{5}$/.test(digits)) return digits;
    if (/^\d{6}$/.test(digits)) return digits.slice(1);
    return '';
}

export function readCustomLocations(storage = defaultStorage()) {
    let raw;
    try {
        raw = JSON.parse(storage?.getItem(CUSTOM_LOCATIONS_KEY) || '{}');
    } catch {
        return {};
    }
    const out = {};
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
    for (const [code, name] of Object.entries(raw)) {
        if (isLocationCode(code) && typeof name === 'string' && name.trim()) {
            out[code] = name.trim().slice(0, MAX_CUSTOM_LOCATION_NAME);
        }
    }
    return out;
}

export function customLocationName(rawCode, storage = defaultStorage()) {
    const key = locationKey(rawCode);
    return key ? readCustomLocations(storage)[key] || null : null;
}

function writeCustomLocations(locations, storage, target) {
    const sorted = {};
    for (const code of Object.keys(locations).sort()) sorted[code] = locations[code];
    storage.setItem(CUSTOM_LOCATIONS_KEY, JSON.stringify(sorted));
    if (target && typeof target.dispatchEvent === 'function' && typeof CustomEvent === 'function') {
        target.dispatchEvent(new CustomEvent(CUSTOM_LOCATIONS_CHANGE, { detail: { locations: { ...sorted } } }));
    }
    return sorted;
}

export function addCustomLocation(rawCode, rawName, { isReserved = () => false, storage = defaultStorage(), target = globalThis } = {}) {
    const code = locationKey(rawCode);
    const name = String(rawName || '').replace(/\s+/g, ' ').trim();
    if (!storage) return { ok: false, error: 'This browser is not letting the page save settings.' };
    if (!code) return { ok: false, error: 'A location code is 5 digits: 2 for the state and 3 for the county, such as 17999.' };
    if (isReserved(code)) return { ok: false, error: code + ' is already a standard location code.' };
    if (!name) return { ok: false, error: 'Give the code a name, such as "Springfield Township, IL".' };
    if (name.length > MAX_CUSTOM_LOCATION_NAME) return { ok: false, error: 'Keep the name to ' + MAX_CUSTOM_LOCATION_NAME + ' characters or fewer.' };
    const locations = readCustomLocations(storage);
    const replacing = code in locations;
    if (!replacing && Object.keys(locations).length >= MAX_CUSTOM_LOCATIONS) {
        return { ok: false, error: 'You can keep up to ' + MAX_CUSTOM_LOCATIONS + ' custom location codes.' };
    }
    locations[code] = name;
    return { ok: true, code, name, replaced: replacing, locations: writeCustomLocations(locations, storage, target) };
}

export function removeCustomLocation(rawCode, { storage = defaultStorage(), target = globalThis } = {}) {
    const code = locationKey(rawCode);
    const locations = readCustomLocations(storage);
    if (!storage || !(code in locations)) return { ok: false, locations };
    delete locations[code];
    return { ok: true, code, locations: writeCustomLocations(locations, storage, target) };
}

export function onCustomLocationsChange(handler, target = globalThis) {
    if (!target || typeof target.addEventListener !== 'function') return () => { };
    const local = () => handler(readCustomLocations());
    const remote = (event) => {
        if (event.key === CUSTOM_LOCATIONS_KEY || event.key === null) handler(readCustomLocations());
    };
    target.addEventListener(CUSTOM_LOCATIONS_CHANGE, local);
    target.addEventListener('storage', remote);
    return () => {
        target.removeEventListener(CUSTOM_LOCATIONS_CHANGE, local);
        target.removeEventListener('storage', remote);
    };
}
