export const CUSTOM_EVENTS_KEY = 'eas-tools-custom-events';
export const CUSTOM_EVENTS_CHANGE = 'eas:custom-events-change';
export const MAX_CUSTOM_EVENTS = 50;
export const MAX_CUSTOM_EVENT_NAME = 60;

const UNRECOGNIZED = {
    W: 'an Unrecognized Warning',
    A: 'an Unrecognized Watch',
    S: 'an Unrecognized Statement',
    E: 'an Unrecognized Emergency',
};

const defaultStorage = () => {
    try {
        return globalThis.localStorage || null;
    } catch {
        return null;
    }
};

export function isEventCode(code) {
    return typeof code === 'string' && /^[A-Z]{3}$/.test(code);
}

export function withArticle(name) {
    const text = String(name || '').trim();
    return (/^[aeiou]/i.test(text) ? 'an ' : 'a ') + text;
}

export function stripArticle(text) {
    return String(text || '').replace(/^(?:a|an|the)\s+/i, '').trim();
}

export function unrecognizedEventName(code) {
    return UNRECOGNIZED[String(code || '').slice(-1).toUpperCase()] || 'an Unrecognized Message';
}

export function readCustomEvents(storage = defaultStorage()) {
    let raw;
    try {
        raw = JSON.parse(storage?.getItem(CUSTOM_EVENTS_KEY) || '{}');
    } catch {
        return {};
    }
    const out = {};
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
    for (const [code, name] of Object.entries(raw)) {
        if (isEventCode(code) && typeof name === 'string' && name.trim()) {
            out[code] = name.trim().slice(0, MAX_CUSTOM_EVENT_NAME);
        }
    }
    return out;
}

export function customEventTable(storage = defaultStorage()) {
    const table = {};
    for (const [code, name] of Object.entries(readCustomEvents(storage))) table[code] = withArticle(name);
    return table;
}

export function eventDisplayName(code, officialName, storage = defaultStorage()) {
    if (officialName) return officialName;
    const custom = readCustomEvents(storage)[code];
    return custom ? withArticle(custom) : unrecognizedEventName(code);
}

function writeCustomEvents(events, storage, target) {
    const sorted = {};
    for (const code of Object.keys(events).sort()) sorted[code] = events[code];
    storage.setItem(CUSTOM_EVENTS_KEY, JSON.stringify(sorted));
    if (target && typeof target.dispatchEvent === 'function' && typeof CustomEvent === 'function') {
        target.dispatchEvent(new CustomEvent(CUSTOM_EVENTS_CHANGE, { detail: { events: { ...sorted } } }));
    }
    return sorted;
}

export function addCustomEvent(rawCode, rawName, { reserved = new Set(), storage = defaultStorage(), target = globalThis } = {}) {
    const code = String(rawCode || '').trim().toUpperCase();
    const name = stripArticle(String(rawName || '').replace(/\s+/g, ' '));
    if (!storage) return { ok: false, error: 'This browser is not letting the page save settings.' };
    if (!isEventCode(code)) return { ok: false, error: 'An event code is exactly three letters, A to Z.' };
    if (reserved.has(code)) return { ok: false, error: code + ' is already a standard event code.' };
    if (!name) return { ok: false, error: 'Give the code a name, such as "Biological Microbe Warning".' };
    if (name.length > MAX_CUSTOM_EVENT_NAME) return { ok: false, error: 'Keep the name to ' + MAX_CUSTOM_EVENT_NAME + ' characters or fewer.' };
    const events = readCustomEvents(storage);
    const replacing = code in events;
    if (!replacing && Object.keys(events).length >= MAX_CUSTOM_EVENTS) {
        return { ok: false, error: 'You can keep up to ' + MAX_CUSTOM_EVENTS + ' custom event codes.' };
    }
    events[code] = name;
    return { ok: true, code, name, replaced: replacing, events: writeCustomEvents(events, storage, target) };
}

export function removeCustomEvent(rawCode, { storage = defaultStorage(), target = globalThis } = {}) {
    const code = String(rawCode || '').trim().toUpperCase();
    const events = readCustomEvents(storage);
    if (!storage || !(code in events)) return { ok: false, events };
    delete events[code];
    return { ok: true, code, events: writeCustomEvents(events, storage, target) };
}

export function onCustomEventsChange(handler, target = globalThis) {
    if (!target || typeof target.addEventListener !== 'function') return () => { };
    const local = () => handler(readCustomEvents());
    const remote = (event) => {
        if (event.key === CUSTOM_EVENTS_KEY || event.key === null) handler(readCustomEvents());
    };
    target.addEventListener(CUSTOM_EVENTS_CHANGE, local);
    target.addEventListener('storage', remote);
    return () => {
        target.removeEventListener(CUSTOM_EVENTS_CHANGE, local);
        target.removeEventListener('storage', remote);
    };
}
