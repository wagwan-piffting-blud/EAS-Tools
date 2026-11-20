import dasdec26 from './dasdec-translate/dasdec-2.6-0_a03.js';
import dasdec31 from './dasdec-translate/dasdec-3.1-0_04.js';

export const PROFILES = Object.freeze({
    '2.6-0_a03': dasdec26,
    '3.1-0_04': dasdec31,
});

export const DEFAULT_PROFILE = '3.1-0_04';

const FLAG_EAS_ANONYMOUS = 0x0002;
const FLAG_EAS_DECODED = 0x0010;
const FLAG_FORWARDED = 0x0020;
const FLAG_NO_STATION = 0x0100;
const FLAG_TEST_BANNER = 0x0800;

const CONTEXT_FLAGS = Object.freeze({
    decoded: FLAG_EAS_DECODED,
    forwarded: FLAG_FORWARDED,
    originated: 0,
    anonymous: FLAG_EAS_ANONYMOUS,
});

const DEFAULTS = Object.freeze({
    lang: 'en',
    profile: DEFAULT_PROFILE,
    timeZone: undefined,
    referenceDate: undefined,
    context: 'decoded',
    originatorName: null,
    includeStation: true,
    testBanner: false,
    locationNames: null,
    faithful: true,
});

const HEADER_RE = /ZCZC-([A-Z]{3})-([A-Z0-9]{3})((?:-[0-9*]{6})*)\+(\d{2})(\d{2})-(\d{3})(\d{2})(\d{2})-([^-]*)-?/i;
const NATIONAL_EVENTS = new Set(['EAN', 'NPT', 'NIC']);
const fmtCache = new Map();

export function parseHeader(raw) {
    const m = HEADER_RE.exec(String(raw));
    if (!m) {
        throw new Error(`Not a SAME header: ${JSON.stringify(String(raw).slice(0, 80))}`);
    }
    const julianDay = Number(m[6]);
    const hour = Number(m[7]);
    const minute = Number(m[8]);
    if (julianDay < 1 || julianDay > 366 || hour > 23 || minute > 59) {
        throw new Error(`Bad issue time in header: ${m[6]}${m[7]}${m[8]}`);
    }
    const purgeHours = Number(m[4]);
    const purgeMinutes = Number(m[5]);
    return {
        raw: m[0],
        originator: m[1].toUpperCase(),
        event: m[2].toUpperCase(),
        locations: m[3] ? m[3].slice(1).split('-') : [],
        purgeHours,
        purgeMinutes,
        purgeSeconds: purgeHours * 3600 + purgeMinutes * 60,
        julianDay,
        hour,
        minute,
        station: m[9],
    };
}

export function resolveIssueTime(header, referenceDate = new Date()) {
    const ref = referenceDate.getTime();
    const y0 = referenceDate.getUTCFullYear();
    let best = null;
    for (const y of [y0 - 1, y0, y0 + 1]) {
        const t = Date.UTC(y, 0, header.julianDay, header.hour, header.minute);
        if (best === null || Math.abs(t - ref) < Math.abs(best - ref)) {
            best = t;
        }
    }
    return new Date(best);
}

export function lookupEvent(code, lang = 'en', profile = DEFAULT_PROFILE) {
    const prof = resolveProfile(profile);
    const text = findEvent(prof.events[lang], code).replace(/^\s+/, '');
    return text || null;
}

export function formatLocation(code, options = {}) {
    const opts = { ...DEFAULTS, ...options };
    const prof = resolveProfile(opts.profile);
    const subdivs = !opts.faithful && opts.lang === 'es' ? prof.subdivisions.es : prof.subdivisions.en;
    return locationName(code, prof, subdivs, opts.locationNames);
}

export function translate(header, options = {}) {
    const opts = { ...DEFAULTS, ...options };
    if (opts.lang !== 'en' && opts.lang !== 'es') {
        throw new Error(`Unsupported lang ${opts.lang}; DASDEC header translation exists only for en and es`);
    }
    if (!(opts.context in CONTEXT_FLAGS)) {
        throw new Error(`Unknown context ${opts.context}; use ${Object.keys(CONTEXT_FLAGS).join(', ')}`);
    }
    const prof = resolveProfile(opts.profile);
    const h = typeof header === 'string' ? parseHeader(header) : header;
    let flags = CONTEXT_FLAGS[opts.context];
    if (opts.testBanner) {
        flags |= FLAG_TEST_BANNER;
    }
    if (!opts.includeStation) {
        flags |= FLAG_NO_STATION;
    }

    const issuedAt = resolveIssueTime(h, opts.referenceDate || new Date());
    const expiresAt = new Date(issuedAt.getTime() + h.purgeSeconds * 1000);
    const text = opts.lang === 'es'
        ? renderEs(h, prof, flags, opts, issuedAt, expiresAt)
        : renderEn(h, prof, flags, opts, issuedAt, expiresAt);

    return {
        text,
        lines: text.split('\n').filter((l) => l !== ''),
        oneLine: text.replace(/\n/g, ' ').trim(),
        lang: opts.lang,
        profile: prof.version,
        header: h,
        issuedAt,
        expiresAt,
    };
}

export function translateAll(header, options = {}) {
    return {
        en: translate(header, { ...options, lang: 'en' }),
        es: translate(header, { ...options, lang: 'es' }),
    };
}

function renderEn(h, prof, flags, opts, issuedAt, expiresAt) {
    const T = prof.templates.en;
    const months = prof.months.en;
    const eventText = findEvent(prof.events.en, h.event).replace(/^\s+/, '') || sprintf(T.specialAlert, h.event);
    let t = '';

    if (flags & FLAG_TEST_BANNER) {
        t += T.testPrefix;
    }

    let hasOrg = true;
    if (h.originator === 'PEP') {
        t += T.orgPEP;
    } else if (opts.originatorName) {
        t += sprintf(flags & FLAG_FORWARDED ? T.orgCustomForwarded : T.orgCustom, opts.originatorName);
    } else if (h.originator === 'WXR') {
        t += T.orgWXR;
    } else if (h.originator === 'CIV') {
        t += T.orgCIV;
    } else if (h.originator === 'EAS' && !(flags & FLAG_EAS_ANONYMOUS)) {
        if (flags & FLAG_EAS_DECODED) {
            t += T.orgEASDecoded;
        } else if (flags & FLAG_FORWARDED) {
            t += T.orgEASForwarded;
        } else {
            t += T.orgEASOriginated;
        }
    } else {
        hasOrg = false;
    }

    t += 'AEIOU'.includes(eventText[0]) ? T.articleVowel : T.article;
    t += eventText;
    if (!hasOrg) {
        t += T.noOriginator;
    }

    t += locationSection(h, prof, T, prof.subdivisions.en, opts);
    t += timeSection(h, T, months, months, issuedAt, expiresAt, opts.timeZone);
    t += stationSection(h, T, flags);

    if (flags & FLAG_TEST_BANNER) {
        t += T.testSuffix;
    }
    return t;
}

function renderEs(h, prof, flags, opts, issuedAt, expiresAt) {
    const T = prof.templates.es;
    const eventText = findEvent(prof.events.es, h.event).replace(/^\s+/, '') || sprintf(T.specialAlert, h.event);
    const subdivs = opts.faithful ? prof.subdivisions.en : prof.subdivisions.es;
    const untilMonths = opts.faithful ? prof.months.en : prof.months.es;
    let t = '';

    if (flags & FLAG_TEST_BANNER) {
        t += T.testPrefix;
    }

    let hasOrg = true;
    if (h.originator === 'PEP') {
        t += T.orgPEP;
    } else if (opts.originatorName) {
        t += sprintf(T.orgCustom, opts.originatorName);
    } else if (h.originator === 'WXR') {
        t += T.orgWXR;
    } else if (h.originator === 'CIV') {
        t += T.orgCIV;
    } else if (h.originator === 'EAS' && flags !== FLAG_EAS_ANONYMOUS) {
        t += T.orgEAS;
    } else {
        hasOrg = false;
    }

    t += eventText;
    if (!hasOrg) {
        t += T.noOriginator;
    }

    t += locationSection(h, prof, T, subdivs, opts);
    t += timeSection(h, T, prof.months.es, untilMonths, issuedAt, expiresAt, opts.timeZone);
    t += stationSection(h, T, flags);

    if (flags & FLAG_TEST_BANNER) {
        t += T.testSuffix;
    }
    return t;
}

function locationSection(h, prof, T, subdivs, opts) {
    const codes = h.locations;
    if (codes.length === 0) {
        return NATIONAL_EVENTS.has(h.event) ? T.forNational : T.noLocations;
    }
    let t;
    if (h.event === 'EAN') {
        t = T.forEAN;
    } else if (codes.some((c) => c.slice(1, 3) === '22')) {
        t = T.forAreas;
    } else {
        t = T.forCounties;
    }

    const names = codes.map((c) => locationName(c, prof, subdivs, opts.locationNames));
    for (let i = 0; i < names.length; i++) {
        let name = names[i];
        if (i + 1 < names.length) {
            const a = abbrAfterComma(name);
            const b = abbrAfterComma(names[i + 1]);
            if (a !== null && b !== null && a.slice(0, 2) === b.slice(0, 2)
                    && codes[i].slice(1, 3) === codes[i + 1].slice(1, 3)) {
                name = name.slice(0, name.indexOf(','));
            }
        }
        t += `${name};\n`;
    }
    return t;
}

function timeSection(h, T, onMonths, untilMonths, issuedAt, expiresAt, timeZone) {
    const s = localParts(issuedAt, timeZone);
    let t = sprintf(T.at, hour12(s.hour), s.minute, s.hour > 11 ? 'PM' : 'AM');
    t += sprintf(T.on, onMonths[s.month], s.day, s.year);

    const e = localParts(expiresAt, timeZone);
    if (h.purgeSeconds === 0 && h.event === 'EAN') {
        t += T.untilEAN;
    } else if (e.month !== s.month || e.day !== s.day || e.year !== s.year) {
        t += sprintf(T.untilOtherDay, hour12(e.hour), e.minute, e.hour > 11 ? 'PM' : 'AM',
            untilMonths[e.month], e.day, e.year, '');
    } else {
        t += sprintf(T.untilSameDay, hour12(e.hour), e.minute, e.hour > 11 ? 'PM' : 'AM', '');
    }
    return t;
}

function stationSection(h, T, flags) {
    if (flags & FLAG_NO_STATION) {
        return '';
    }
    const lead = T.messageFrom.slice(0, T.messageFrom.indexOf('%s'));
    const station = sprintf(T.messageFrom, h.station).slice(lead.length).replace(/\s+$/, '');
    return lead + station + (station ? T.stationEnd : T.stationUnknown);
}

function locationName(code, prof, subdivs, overrides) {
    if (overrides && Object.prototype.hasOwnProperty.call(overrides, code)) {
        return overrides[code];
    }
    const state = prof.states[code.slice(1, 3)];
    if (!state) {
        return '';
    }
    const [abbr, stateName, counties] = state;
    const ccc = code.slice(3, 6);
    const p = /[0-9]/.test(code[0]) ? Number(code[0]) : 0;
    const prefix = subdivs[p] || '';
    const sp = prefix ? ' ' : '';
    const county = counties[ccc];
    if (county && ccc !== '000' && abbr) {
        return `${prefix}${sp}${county}, ${abbr}`;
    }
    return `${prefix}${sp}${stateName}${ccc === '***' ? ' any location' : ''}`;
}

function abbrAfterComma(name) {
    const i = name.indexOf(',');
    return i < 0 ? null : name.slice(i + 2);
}

function findEvent(table, code) {
    const upper = code.toUpperCase();
    for (const [c, text] of table) {
        if (upper.startsWith(c.toUpperCase())) {
            return text;
        }
    }
    return '';
}

function resolveProfile(profile) {
    if (profile && typeof profile === 'object') {
        return profile;
    }
    const p = PROFILES[profile];
    if (!p) {
        throw new Error(`Unknown profile ${profile}; known: ${Object.keys(PROFILES).join(', ')}`);
    }
    return p;
}

function localParts(date, timeZone) {
    const key = timeZone || '';
    let fmt = fmtCache.get(key);
    if (!fmt) {
        fmt = new Intl.DateTimeFormat('en-US', {
            timeZone,
            hourCycle: 'h23',
            year: 'numeric',
            month: 'numeric',
            day: 'numeric',
            hour: 'numeric',
            minute: 'numeric',
        });
        fmtCache.set(key, fmt);
    }
    const parts = {};
    for (const p of fmt.formatToParts(date)) {
        parts[p.type] = p.value;
    }
    return {
        year: Number(parts.year),
        month: Number(parts.month) - 1,
        day: Number(parts.day),
        hour: Number(parts.hour) % 24,
        minute: Number(parts.minute),
    };
}

function hour12(h) {
    if (h > 12) {
        return h - 12;
    }
    return h === 0 ? 12 : h;
}

function sprintf(fmt, ...args) {
    let i = 0;
    return fmt.replace(/%(0?)(\d*)([sdc%])/g, (all, zero, width, conv) => {
        if (conv === '%') {
            return '%';
        }
        const v = args[i++];
        if (conv !== 'd') {
            return String(v ?? '');
        }
        const s = String(Math.trunc(Number(v)));
        return width ? s.padStart(Number(width), zero ? '0' : ' ') : s;
    });
}
