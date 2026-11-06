export const NWS_TEXT_STYLE = 'NWS';

export const NWS_MOCK_NOTE = 'Mock NWS/AWIPS-style text built from the SAME header. It is not an official National Weather Service product.';

export const NWS_NOT_WEATHER_NOTE = 'NWS-style text only applies to National Weather Service (WXR) alerts, so the plain wording is shown.';

const SPC_ID = 'SPC';

const SENDER_ALIASES = {
    KWNS: SPC_ID,
    TJSJ: 'SJU',
    NSTU: 'PPG',
};

const STATE_NAMES = {
    AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California',
    CO: 'Colorado', CT: 'Connecticut', DE: 'Delaware', DC: 'District of Columbia',
    FL: 'Florida', GA: 'Georgia', HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois',
    IN: 'Indiana', IA: 'Iowa', KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana',
    ME: 'Maine', MD: 'Maryland', MA: 'Massachusetts', MI: 'Michigan',
    MN: 'Minnesota', MS: 'Mississippi', MO: 'Missouri', MT: 'Montana',
    NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire', NJ: 'New Jersey',
    NM: 'New Mexico', NY: 'New York', NC: 'North Carolina', ND: 'North Dakota',
    OH: 'Ohio', OK: 'Oklahoma', OR: 'Oregon', PA: 'Pennsylvania',
    RI: 'Rhode Island', SC: 'South Carolina', SD: 'South Dakota', TN: 'Tennessee',
    TX: 'Texas', UT: 'Utah', VT: 'Vermont', VA: 'Virginia', WA: 'Washington',
    WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming', PR: 'Puerto Rico',
    VI: 'the U.S. Virgin Islands', GU: 'Guam', AS: 'American Samoa',
    MP: 'the Northern Mariana Islands',
};

const FE_AREA_CODES = {
    BB: 'Big Bend', CP: 'central Panhandle', DS: 'Deep South', EP: 'eastern Panhandle',
    ER: 'east central Upper', EU: 'eastern Upper', MI: 'Middle', NP: 'northern Panhandle',
    NR: 'north central Upper', PA: 'the Panhandle of', PD: 'the Piedmont of',
    SP: 'southern Panhandle', SR: 'south central Upper', UP: 'Upstate',
    WP: 'western Panhandle', WU: 'western Upper',
    NN: 'northern', NE: 'northeastern', EE: 'eastern', SE: 'southeastern', SS: 'southern',
    SW: 'southwestern', WW: 'western', NW: 'northwestern',
    EA: 'east', NO: 'north', SO: 'south', WE: 'west', WS: 'southwest', ES: 'southeast',
    WN: 'northwest', EN: 'northeast',
    NC: 'north central', EC: 'east central', WC: 'west central', SC: 'south central', CC: 'central',
};

export function officeLocation(label) {
    return String(label || '').trim().replace(/\s+[A-Z]{2}$/, '');
}

export function officeFromSender(senderId, offices) {
    const table = offices || {};
    const tokens = String(senderId || '').toUpperCase().split(/[^A-Z0-9]+/).filter(Boolean);
    for (const token of tokens) {
        const alias = SENDER_ALIASES[token] || (token === SPC_ID ? SPC_ID : null);
        if (alias === SPC_ID) return { id: SPC_ID, location: '' };
        const candidates = alias ? [alias] : [];
        if (token.length === 4 && /^[KPT]/.test(token)) candidates.push(token.slice(1));
        if (token.length === 3) candidates.push(token);
        for (const id of candidates) {
            const office = table[id];
            if (typeof office === 'string' && office) return { id, location: office };
            if (office && office.label) return { id, location: officeLocation(office.label) };
        }
    }
    return null;
}

export function isWatchEvent(eventCode) {
    return /^[A-Z]{2}A$/.test(String(eventCode || ''));
}

export function areaPhrase(directions) {
    const set = (Array.isArray(directions) ? directions : []).map((dir) => String(dir).toUpperCase());
    const coded = set.filter((dir) => dir.length === 2 && FE_AREA_CODES[dir]).map((dir) => FE_AREA_CODES[dir]);
    if (coded.length) return joinList(coded);
    const word = (set.includes('NORTH') ? 'north' : '') + (set.includes('SOUTH') ? 'south' : '')
        + (set.includes('EAST') ? 'east' : '') + (set.includes('WEST') ? 'west' : '');
    if (set.includes('CENTRAL')) return word ? word + ' central' : 'central';
    return word ? word + 'ern' : '';
}

export function countyRegionsFromGeoJson(geojson) {
    const regions = {};
    const features = geojson && Array.isArray(geojson.features) ? geojson.features : [];
    for (const feature of features) {
        const props = feature && feature.properties;
        if (props && typeof props.fips === 'string' && Array.isArray(props.partOfParentRegion)) {
            regions[props.fips] = props.partOfParentRegion.slice();
        }
    }
    return regions;
}

function joinList(items) {
    if (items.length < 2) return items.join('');
    return items.slice(0, -1).join(', ') + ' and ' + items[items.length - 1];
}

function capitalize(text) {
    return text ? text.charAt(0).toUpperCase() + text.slice(1) : text;
}

function splitArticle(eventName) {
    const text = String(eventName || '').trim();
    const match = /^(an?|the)\s+(.+)$/i.exec(text);
    if (match) return { article: match[1].toLowerCase(), name: match[2] };
    return { article: /^[aeiou]/i.test(text) ? 'an' : 'a', name: text };
}

function subdivisionWord(subdivision) {
    const text = String(subdivision || '').trim();
    if (!text) return '';
    return /central/i.test(text) ? text : text + 'ern';
}

function describeLocation(location, regions) {
    const raw = String(location.name || location.code || '').trim();
    const match = /^(.*), ([A-Z]{2})$/.exec(raw);
    const subdivision = subdivisionWord(location.subdivision);
    if (!match || !STATE_NAMES[match[2]]) {
        return { line: (subdivision ? capitalize(subdivision) + ' ' : '') + raw, state: '', region: '' };
    }
    const [, place, abbr] = match;
    const state = STATE_NAMES[abbr];
    const fips = String(location.code || '').slice(1);
    const region = regions && Object.prototype.hasOwnProperty.call(regions, fips) ? areaPhrase(regions[fips]) : '';
    if (abbr === 'DC') {
        return { line: 'The ' + (subdivision ? subdivision.toLowerCase() + ' ' : '') + 'District of Columbia', state, region };
    }
    let name;
    if (/^City of /.test(place)) {
        name = 'The ' + (subdivision ? subdivision.toLowerCase() + ' ' : '') + place;
    } else {
        name = (subdivision ? capitalize(subdivision) + ' ' : '') + place;
    }
    return { line: name + ' in ' + (region ? region + ' ' : '') + state, state, region };
}

function zonedParts(date, timeZone) {
    const options = {
        timeZone,
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
        timeZoneName: 'short',
        weekday: 'long',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    };
    let formatter;
    try {
        formatter = new Intl.DateTimeFormat('en-US', options);
    } catch {
        formatter = new Intl.DateTimeFormat('en-US', { ...options, timeZone: undefined });
    }
    const parts = {};
    for (const part of formatter.formatToParts(date)) parts[part.type] = part.value;
    const hour = parts.hour;
    const minute = parts.minute;
    const period = String(parts.dayPeriod || '').toUpperCase();
    let clock = hour + minute + ' ' + period;
    if (hour === '12' && minute === '00') clock = period === 'PM' ? 'noon' : 'midnight';
    return {
        clock,
        zone: parts.timeZoneName || '',
        weekday: parts.weekday || '',
        dateKey: parts.year + '-' + parts.month + '-' + parts.day,
    };
}

export function nwsUntilText(endTime, { timeZone, longDuration = false } = {}) {
    const end = zonedParts(endTime, timeZone);
    return end.clock + ' ' + end.zone + (longDuration ? ' ' + end.weekday : '');
}

function effectiveText(startTime, endTime, timeZone) {
    const start = zonedParts(startTime, timeZone);
    const end = zonedParts(endTime, timeZone);
    if (start.dateKey === end.dateKey) {
        return 'from ' + start.clock + ' until ' + end.clock + ' ' + end.zone;
    }
    return 'from ' + start.clock + ' ' + start.zone + ' ' + start.weekday
        + ' until ' + end.clock + ' ' + end.zone + ' ' + end.weekday;
}

function uniqueLocations(locationNames) {
    const seen = new Set();
    const result = [];
    for (const location of Array.isArray(locationNames) ? locationNames : []) {
        const key = location && location.code;
        if (!location || seen.has(key)) continue;
        seen.add(key);
        result.push(location);
    }
    return result;
}

export function formatNwsStyle(detailed, { offices = null, regions = null, timeZone } = {}) {
    if (!detailed || detailed.originator !== 'WXR') {
        return { ok: false, text: '', note: NWS_NOT_WEATHER_NOTE };
    }
    const { article, name } = splitArticle(detailed.eventName || detailed.eventCode);
    const watch = isWatchEvent(detailed.eventCode);
    const office = officeFromSender(detailed.senderId, offices);
    const spc = watch && (!office || office.id === SPC_ID);
    let issuer;
    if (spc) {
        issuer = 'The NWS Storm Prediction Center';
    } else if (office && office.id !== SPC_ID) {
        issuer = 'The National Weather Service in ' + office.location;
    } else {
        issuer = 'The National Weather Service';
    }

    const described = uniqueLocations(detailed.locationNames).map((location) => describeLocation(location, regions));
    const lines = [issuer + ' has issued ' + article, ''];
    if (spc) {
        const areas = [];
        for (const entry of described) {
            const area = entry.state ? capitalize((entry.region ? entry.region + ' ' : '') + entry.state) : entry.line;
            if (!areas.includes(area)) areas.push(area);
        }
        lines.push('* ' + name + ' for portions of');
        areas.forEach((area) => lines.push('  ' + area));
    } else {
        lines.push('* ' + name + ' for...');
        described.forEach((entry) => lines.push('  ' + entry.line + '...'));
    }
    lines.push('');

    if (detailed.indefinite) {
        lines.push(spc ? '* Effective until further notice.' : '* Until further notice.');
    } else if (spc) {
        lines.push('* Effective ' + effectiveText(detailed.startTime, detailed.endTime, timeZone) + '.');
    } else {
        const minutes = (Number(detailed.durationHours) || 0) * 60 + (Number(detailed.durationMinutes) || 0);
        lines.push('* Until ' + nwsUntilText(detailed.endTime, { timeZone, longDuration: minutes >= 360 }) + '.');
    }

    return { ok: true, text: lines.join('\n'), note: NWS_MOCK_NOTE };
}
