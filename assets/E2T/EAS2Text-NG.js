// This file is part of E2T-NG, a tool to convert EAS messages to text. See the full repository here for more information: https://github.com/wagwan-piffting-blud/E2T-NG

const EAS_REGEX = /^ZCZC-([A-Z]{3})-([A-Z\?]{3})-((?:\d{6}(?:-?)){1,31})\+(\d{4})-(\d{7})-([A-Za-z0-9\/ ]{1,8}?)-$/m;
const RESOURCE_PATHS = {
    sameUS: 'assets/E2T/include/same-us.json',
    sameCA: 'assets/E2T/include/same-ca.json',
    endecModes: 'assets/E2T/include/endec-modes.json'
};
const USER_TIME_ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
const TIME_FORMATTER = new Intl.DateTimeFormat(undefined, { timeStyle: 'short', timeZone: USER_TIME_ZONE });
const ZONED_PARTS_FORMATTER = new Intl.DateTimeFormat('en-US', {
    timeZone: USER_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    weekday: 'short',
    hourCycle: 'h23'
});
const TIMEZONE_NAME_FORMATTER = new Intl.DateTimeFormat('en-US', {
    timeZone: USER_TIME_ZONE,
    hour: '2-digit',
    timeZoneName: 'short'
});
const MONTH_NAMES = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
];
const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTH_ABBR_UPPER = MONTH_ABBR.map((month) => month.toUpperCase());
const WEEKDAY_ABBR = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const WEEKDAY_INDEX = Object.fromEntries(WEEKDAY_ABBR.map((day, index) => [day, index]));
const ZONED_PARTS_CACHE = new Map();
const FIXED_TZ_OFFSET_REGEX = /^([+-])(\d{2}):?(\d{2})$/;
const TZ_OFFSET_FORMATTER_CACHE = new Map();
const STATE_ABBREVIATIONS = {
    'AL': 'Alabama',
    'AK': 'Alaska',
    'AZ': 'Arizona',
    'AR': 'Arkansas',
    'CA': 'California',
    'CO': 'Colorado',
    'CT': 'Connecticut',
    'DE': 'Delaware',
    'FL': 'Florida',
    'GA': 'Georgia',
    'HI': 'Hawaii',
    'ID': 'Idaho',
    'IL': 'Illinois',
    'IN': 'Indiana',
    'IA': 'Iowa',
    'KS': 'Kansas',
    'KY': 'Kentucky',
    'LA': 'Louisiana',
    'ME': 'Maine',
    'MD': 'Maryland',
    'MA': 'Massachusetts',
    'MI': 'Michigan',
    'MN': 'Minnesota',
    'MS': 'Mississippi',
    'MO': 'Missouri',
    'MT': 'Montana',
    'NE': 'Nebraska',
    'NV': 'Nevada',
    'NH': 'New Hampshire',
    'NJ': 'New Jersey',
    'NM': 'New Mexico',
    'NY': 'New York',
    'NC': 'North Carolina',
    'ND': 'North Dakota',
    'OH': 'Ohio',
    'OK': 'Oklahoma',
    'OR': 'Oregon',
    'PA': 'Pennsylvania',
    'RI': 'Rhode Island',
    'SC': 'South Carolina',
    'SD': 'South Dakota',
    'TN': 'Tennessee',
    'TX': 'Texas',
    'UT': 'Utah',
    'VT': 'Vermont',
    'VA': 'Virginia',
    'WA': 'Washington',
    'WV': 'West Virginia',
    'WI': 'Wisconsin',
    'WY': 'Wyoming'
};
const PROVINCE_ABBREVIATIONS = {
    'AB': 'Alberta',
    'BC': 'British Columbia',
    'MB': 'Manitoba',
    'NB': 'New Brunswick',
    'NL': 'Newfoundland and Labrador',
    'NS': 'Nova Scotia',
    'NT': 'Northwest Territories',
    'NU': 'Nunavut',
    'ON': 'Ontario',
    'PE': 'Prince Edward Island',
    'QC': 'Quebec',
    'SK': 'Saskatchewan',
    'YT': 'Yukon'
};
window.RESOURCE_MAP = {};

async function fetchResource(path) {
    try {
        const response = await fetch(path);
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }
        return await response.json();
    } catch (error) {
        console.error(`Fetch failed for ${path}:`, error);
        throw new Error(`Failed to fetch resource: ${path}`);
    }
}

async function loadResources() {
    for (const [key, path] of Object.entries(RESOURCE_PATHS)) {
        try {
            window.RESOURCE_MAP[key] = await fetchResource(path);
        } catch (error) {
            console.error(`Error loading resource ${key}:`, error);
        }
    }
}

export const resourcesReady = loadResources();
await resourcesReady;

function parseEASTime(timeStr) {
    const dayOfYear = Number(timeStr.slice(0, 3));
    const hours = Number(timeStr.slice(3, 5));
    const minutes = Number(timeStr.slice(5, 7));

    return new Date(Date.UTC(new Date().getUTCFullYear(), 0, dayOfYear, hours, minutes));
}

function parseFixedOffsetMinutes(timeZoneSpec) {
    const match = FIXED_TZ_OFFSET_REGEX.exec(timeZoneSpec);
    if (!match) return null;
    const hours = Number(match[2]);
    const minutes = Number(match[3]);
    if (hours > 23 || minutes > 59) return null;
    const sign = match[1] === '-' ? -1 : 1;
    return sign * (hours * 60 + minutes);
}

function getIanaOffsetFormatter(timeZoneSpec) {
    const cached = TZ_OFFSET_FORMATTER_CACHE.get(timeZoneSpec);
    if (cached) return cached;
    let formatter = null;
    try {
        formatter = new Intl.DateTimeFormat('en-US', {
            timeZone: timeZoneSpec,
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hourCycle: 'h23'
        });
    } catch {
        return null;
    }
    TZ_OFFSET_FORMATTER_CACHE.set(timeZoneSpec, formatter);
    return formatter;
}

function getIanaOffsetMinutes(timestamp, timeZoneSpec) {
    const formatter = getIanaOffsetFormatter(timeZoneSpec);
    if (!formatter) return null;

    let year = 0;
    let month = 0;
    let day = 0;
    let hour = 0;
    let minute = 0;
    let second = 0;
    for (const part of formatter.formatToParts(new Date(timestamp))) {
        switch (part.type) {
            case 'year':
                year = Number(part.value);
                break;
            case 'month':
                month = Number(part.value);
                break;
            case 'day':
                day = Number(part.value);
                break;
            case 'hour':
                hour = Number(part.value) % 24;
                break;
            case 'minute':
                minute = Number(part.value);
                break;
            case 'second':
                second = Number(part.value);
                break;
            default:
                break;
        }
    }

    const zonedAsUTC = Date.UTC(year, month - 1, day, hour, minute, second);
    return Math.round((zonedAsUTC - timestamp) / 60000);
}

function getTimeZoneOffsetMinutes(timestamp, timeZoneSpec) {
    if (typeof timeZoneSpec !== 'string') return null;
    const normalized = timeZoneSpec.trim();
    if (!normalized) return null;

    if (normalized.toLowerCase() === 'local') {
        const localZone = USER_TIME_ZONE || 'UTC';
        return getIanaOffsetMinutes(timestamp, localZone);
    }

    const fixedOffset = parseFixedOffsetMinutes(normalized);
    if (fixedOffset !== null) return fixedOffset;

    return getIanaOffsetMinutes(timestamp, normalized);
}

function reparseStartTimeInTimezone(startTime, timezone_override) {
    const encodedUtcMillis = startTime.getTime();
    const formatterZone = USER_TIME_ZONE || 'UTC';
    const overrideText = typeof timezone_override === 'string' ? timezone_override.trim() : '';
    const candidates = overrideText
        ? [overrideText, formatterZone, 'UTC']
        : [formatterZone, 'UTC'];

    let targetOffset = null;
    for (const zoneSpec of candidates) {
        targetOffset = getTimeZoneOffsetMinutes(encodedUtcMillis, zoneSpec);
        if (targetOffset !== null) break;
    }
    if (targetOffset === null) return new Date(encodedUtcMillis);

    let formatterOffset = getTimeZoneOffsetMinutes(encodedUtcMillis, formatterZone);
    if (formatterOffset === null) formatterOffset = 0;

    let adjustedMillis = encodedUtcMillis + (targetOffset - formatterOffset) * 60000;
    const correctedFormatterOffset = getTimeZoneOffsetMinutes(adjustedMillis, formatterZone);
    if (correctedFormatterOffset !== null && correctedFormatterOffset !== formatterOffset) {
        adjustedMillis = encodedUtcMillis + (targetOffset - correctedFormatterOffset) * 60000;
    }

    return new Date(adjustedMillis);
}

function parseEASDuration(durationStr) {
    return {
        hours: Number(durationStr.slice(0, 2)),
        minutes: Number(durationStr.slice(2, 4))
    };
}

function parseHeaderCore(header) {
    const match = EAS_REGEX.exec(header);
    if (!match) {
        throw new Error('Invalid EAS header format');
    }

    const [, originator, eventCode, locations, duration, startTime, senderid] = match;
    return {
        originator,
        eventCode,
        locations: locations.split('-'),
        startTime: parseEASTime(startTime),
        duration: parseEASDuration(duration),
        senderid
    };
}

function serializeParsedHeader(parsed) {
    return {
        originator: parsed.originator,
        event_code: parsed.eventCode,
        fips_codes: [...parsed.locations],
        locations: [...parsed.locations],
        duration_hours: parsed.duration.hours,
        duration_minutes: parsed.duration.minutes,
        start_time_utc: parsed.startTime.toISOString(),
        sender_id: parsed.senderid
    };
}

function lookupResource(resourceKey, sectionKey, itemKey) {
    return window.RESOURCE_MAP?.[resourceKey]?.[sectionKey]?.[itemKey];
}

function lookupSame(sectionKey, itemKey, canadian_mode=false) {
    if (canadian_mode) {
        return lookupResource('sameCA', sectionKey, itemKey);
    }
    return lookupResource('sameUS', sectionKey, itemKey)
}

function applyModeTemplate(modeKey, replacements) {
    let template = lookupResource('endecModes', 'TEMPLATES', modeKey);
    if (typeof template !== 'string') return null;
    for (const [key, value] of Object.entries(replacements)) {
        template = template.replaceAll(`__${key}__`, value ?? '');
    }
    return template;
}

export function allEndecModes() {
    const templates = window.RESOURCE_MAP?.endecModes?.TEMPLATES;
    if (!templates || typeof templates !== 'object') {
        return [];
    }
    return Object.keys(templates)
        .filter((mode) => typeof mode === 'string')
        .sort();
}

function ordinalDay(day) {
    const mod100 = day % 100;
    if (mod100 >= 11 && mod100 <= 13) return `${day}th`;
    switch (day % 10) {
        case 1: return `${day}st`;
        case 2: return `${day}nd`;
        case 3: return `${day}rd`;
        default: return `${day}th`;
    }
}

function localeHelper(date) {
    let { monthIndex, day, year } = getZonedParts(date);

    if (monthIndex === 11 && day === 31 && date.getUTCMonth() === 0 && date.getUTCDate() === 1) {
        monthIndex = 0;
        day = 1;
        year = date.getUTCFullYear();
    }

    return `${TIME_FORMATTER.format(date)} on ${MONTH_NAMES[monthIndex]} ${ordinalDay(day)}, ${year}`;
}

function expandStateAbbreviation(name) {
    return name.replace(/[A-Z]{2}$/, (abbr) => STATE_ABBREVIATIONS[abbr] || abbr);
}

function pad2(number) {
    return String(number).padStart(2, '0');
}

function getZonedParts(date) {
    const timestamp = date.getTime();
    const cached = ZONED_PARTS_CACHE.get(timestamp);
    if (cached) return cached;

    let year = 0;
    let month = 0;
    let day = 0;
    let hour24 = 0;
    let minute = 0;
    let weekday = 0;

    for (const part of ZONED_PARTS_FORMATTER.formatToParts(date)) {
        switch (part.type) {
            case 'year':
                year = Number(part.value);
                break;
            case 'month':
                month = Number(part.value);
                break;
            case 'day':
                day = Number(part.value);
                break;
            case 'hour':
                hour24 = Number(part.value) % 24;
                break;
            case 'minute':
                minute = Number(part.value);
                break;
            case 'weekday':
                weekday = WEEKDAY_INDEX[part.value] ?? 0;
                break;
            default:
                break;
        }
    }

    const zoned = {
        year,
        month,
        monthIndex: month - 1,
        day,
        hour24,
        minute,
        weekday,
        dateKey: `${year}-${pad2(month)}-${pad2(day)}`
    };
    ZONED_PARTS_CACHE.set(timestamp, zoned);
    return zoned;
}

function getZonedTimeZoneName(date) {
    for (const part of TIMEZONE_NAME_FORMATTER.formatToParts(date)) {
        if (part.type === 'timeZoneName') return part.value;
    }
    return USER_TIME_ZONE;
}

function isSameLocalDay(startTime, endTime) {
    return getZonedParts(startTime).dateKey === getZonedParts(endTime).dateKey;
}

function formatTime12(date, { padHour = true, lowerMeridiem = false } = {}) {
    const { hour24, minute } = getZonedParts(date);
    const hour12 = hour24 % 12 || 12;
    const hour = padHour ? pad2(hour12) : String(hour12);
    const minuteText = pad2(minute);
    const meridiem = lowerMeridiem
        ? (hour24 >= 12 ? 'pm' : 'am')
        : (hour24 >= 12 ? 'PM' : 'AM');
    return `${hour}:${minuteText} ${meridiem}`;
}

function formatMonDayYear(date, { upperMonth = false, shortMonth = false, includeYear = true } = {}) {
    const { monthIndex, day, year } = getZonedParts(date);
    const monthName = shortMonth
        ? (upperMonth ? MONTH_ABBR_UPPER[monthIndex] : MONTH_ABBR[monthIndex])
        : (upperMonth ? MONTH_NAMES[monthIndex].toUpperCase() : MONTH_NAMES[monthIndex]);
    const dayText = pad2(day);
    return includeYear ? `${monthName} ${dayText}, ${year}` : `${monthName} ${dayText}`;
}

function formatSlashUTC(date) {
    const { month, day, year, hour24, minute } = getZonedParts(date);
    return `${pad2(month)}/${pad2(day)}/${String(year).slice(-2)} ${pad2(hour24)}:${pad2(minute)}:00 ${getZonedTimeZoneName(date)}`;
}

function formatBaseRangeTimeText(startTime, endTime) {
    const startParts = getZonedParts(startTime);
    const endParts = getZonedParts(endTime);

    if (startParts.dateKey === endParts.dateKey) {
        return {
            start: formatTime12(startTime),
            end: formatTime12(endTime)
        };
    }
    if (startParts.year === endParts.year) {
        return {
            start: `${formatTime12(startTime)} ${formatMonDayYear(startTime, { includeYear: false })}`,
            end: `${formatTime12(endTime)} ${formatMonDayYear(endTime, { includeYear: false })}`
        };
    }
    return {
        start: `${formatTime12(startTime)} ${formatMonDayYear(startTime)}`,
        end: `${formatTime12(endTime)} ${formatMonDayYear(endTime)}`
    };
}

function buildFIPSContext(locationCodes, canadian_mode=false) {
    const sortedCodes = [...new Set(locationCodes)];
    const fipsText = sortedCodes.map((code) => {
        const subdiv = lookupResource('sameUS', 'SUBDIV', code.slice(0, 1)) ?? '';
        const sameName = lookupSame('SAME', code.slice(1, 6), canadian_mode) ?? `FIPS Code ${code}`;
        return `${subdiv ? `${subdiv} ` : ''}${sameName}`;
    });
    const fipsTextWithAnd = fipsText.slice();
    if (fipsTextWithAnd.length > 1) {
        fipsTextWithAnd[fipsTextWithAnd.length - 1] = `and ${fipsTextWithAnd[fipsTextWithAnd.length - 1]}`;
    }
    return {
        codes: sortedCodes,
        fipsText,
        fipsTextWithAnd,
        strFips: `${fipsTextWithAnd.join('; ')};`
    };
}

function splitLocationState(text) {
    const parts = text.split(', ').filter(Boolean);
    if (parts.length <= 1) {
        return { location: parts[0] || text, state: '' };
    }
    return {
        location: parts.slice(0, -1).join(', '),
        state: parts[parts.length - 1]
    };
}

function filterTrilithicLocation(text) {
    let result = text;
    if (result.startsWith('City of')) result = result.replace(/^City of\s*/, '') + ' city';
    if (result.startsWith('State of')) result = result.replace(/^State of/, 'All of');
    if (result.startsWith('District of')) result = result.replace(/^District of/, 'All of District of');
    if (result.includes(' City of')) result = result.replace(/ City of/g, '') + ' city';
    if (result.includes(' State of') && !result.includes('All of')) result = result.replace(/ State of/g, ' All of');
    if (result.includes(' District of') && !result.includes('All of')) result = result.replace(/ District of/g, ' All of District of');
    if (result.includes(' County')) result = result.replace(/ County/g, '');
    if (result.startsWith('and ')) result = result.replace(/^and\s+/, '');
    return result;
}

function filterHollyOrGormanLocation(text, isGorman = false) {
    let result = text;
    if (result.startsWith('City of')) result = result.replace(/^City of\s*/, '') + ' CITY';
    if (result.startsWith('State of')) result = isGorman ? result.replace(/^State of/, 'ALL') : result.replace(/^State of/, '');
    if (result.includes(' City of')) result = result.replace(/ City of/g, '') + ' CITY';
    if (result.includes(' State of') && !result.includes('All of')) result = result.replace(/ State of/g, '');
    if (result.includes(' County')) result = result.replace(/ County/g, '');
    if (result.startsWith('and ')) result = result.replace(/^and\s+/, 'AND ');
    return result;
}

function processDASFipsString(strFips, combine_same_state = false) {
    const parts = strFips.split(';').map((part) => part.trim()).filter(Boolean);
    const states = new Map();
    const result = [];
    let onlyParishes = false;

    for (const partRaw of parts) {
        const part = partRaw.replace(/^and\s+/i, '');
        const match = part.match(/^(City of )?(.*?)( County| Parish)?, (\w{2})$/);
        const stateMatch = part.match(/^State of (.+)$/);

        if (match) {
            const [, cityPrefix, name, localityType, state] = match;
            let cleanName = name;

            if (localityType === ' Parish') {
            } else if (cityPrefix) {
                cleanName += ' (city)';
                onlyParishes = false;
            } else {
                onlyParishes = false;
            }

            if (!states.has(state)) {
                states.set(state, []);
            }
            states.get(state).push(cleanName);
        } else if (stateMatch) {
            result.push(stateMatch[1]);
        } else {
            result.push(part);
        }
    }

    for (const [state, entries] of states) {
        const lastIndex = entries.length - 1;
        for (let index = 0; index <= lastIndex; index++) {
            const name = entries[index];
            if (!combine_same_state || index === lastIndex) {
                result.push(`${name}, ${state}`);
            } else {
                result.push(name);
            }
        }
    }

    let finalResult = result.join('; ').replace(/ and /g, ' ');
    finalResult = finalResult.replace(/City of (.*?)( \(city\))?,/g, '$1 (city),');
    if (finalResult == "") {
        finalResult = parts.map((part) => part.replace(/^and\s+/i, '')).join('; ');
    }
    return { strFips: `${finalResult};`, onlyParishes };
}

function formatLocation(locationCode, isLastItem, totalLocations) {
    const subdivisionCode = locationCode.slice(0, 1);
    const sameCode = locationCode.slice(1, 6);
    const locationName = lookupSame('SAME', sameCode) || sameCode;
    const subdivisionName = lookupResource('sameUS', 'SUBDIV', subdivisionCode);

    let describedLocation;
    if (subdivisionName) {
        const baseLocation = isLastItem && totalLocations > 1
            ? expandStateAbbreviation(locationName)
            : locationName;
        describedLocation = `${subdivisionName}ern ${baseLocation}`;
    } else if (locationName.includes('All of') || locationName.includes('State of')) {
        describedLocation = locationName;
    } else {
        describedLocation = expandStateAbbreviation(locationName);
    }

    return isLastItem && totalLocations > 1 ? `and ${describedLocation}` : describedLocation;
}

function toEpoch(date) {
    return Math.floor(date.getTime() / 1000);
}

function humanizeEAS(eas, endec_emulation_mode=null, canadian_mode=false, timezone_override=null) {
    const { originator, eventCode, locations, duration, startTime: parsedStartTime, senderid } = eas;
    const sender = senderid.trim();
    const startTime = reparseStartTimeInTimezone(parsedStartTime, timezone_override);

    let normalOriginator = lookupSame('ORGS', originator) || originator;
    const normalEventCode = lookupSame('EVENTS', eventCode) || eventCode;
    const fipsContext = buildFIPSContext(locations, canadian_mode);

    let locationStr = locations
        .map((loc, idx) => formatLocation(loc, idx === locations.length - 1, locations.length))
        .join('; ');

    const endTime = new Date(startTime.getTime() + duration.hours * 3600000 + duration.minutes * 60000);
    const startTimeStr = localeHelper(startTime);
    const endTimeStr = localeHelper(endTime);
    const baseRangeTime = formatBaseRangeTimeText(startTime, endTime);
    const mode = typeof endec_emulation_mode === 'string' ? endec_emulation_mode.toUpperCase() : '';

    if (mode === 'ALL') {
        const fullOutput = allEndecModes()
            .filter((modeName) => modeName !== 'ALL')
            .map((modeName) => `${modeName}: ${humanizeEAS(eas, modeName, canadian_mode, timezone_override)}\n`)
            .join('\n');
        return fullOutput.startsWith('ALL: ') ? fullOutput.slice(5) : fullOutput;
    }

    const removeCountyWord = (text) => (
        text.includes('County') ? text.replace(/\s*County\b/g, '') : text
    );
    locationStr = removeCountyWord(locationStr);
    fipsContext.fipsText = fipsContext.fipsText.map(removeCountyWord);
    fipsContext.fipsTextWithAnd = fipsContext.fipsTextWithAnd.map(removeCountyWord);
    fipsContext.strFips = removeCountyWord(fipsContext.strFips);

    if (canadian_mode && originator === 'WXR') {
        normalOriginator = 'Environment Canada';
    }

    switch(mode) {
        case 'TFT': {
            const strFips = fipsContext.strFips
                .slice(0, -1)
                .replace(/,/g, '')
                .replace(/;/g, ',')
                .replace(/FIPS Code/g, 'AREA')
                .replace(/State of /g, '')
                .replace(/All of The United States/gi, 'UNITED STATES');
            const tftStart = `${formatTime12(startTime)} ON ${formatMonDayYear(startTime, { shortMonth: true, upperMonth: true })}`;
            const tftEnd = isSameLocalDay(startTime, endTime)
                ? formatTime12(endTime)
                : `${formatTime12(endTime)} ON ${formatMonDayYear(endTime, { shortMonth: true, upperMonth: true })}`;
            const prefix = (originator === 'EAS' || eventCode === 'NPT' || eventCode === 'EAN')
                ? `${normalEventCode} has been issued`
                : `${normalOriginator} has issued ${normalEventCode}`;
            const output = applyModeTemplate('TFT', {
                PREFIX: prefix,
                FIPS: strFips,
                START: tftStart.replace(/([A-Z]{3}) 0(\d)/g, '$1 $2').replace(/0(\d\:\d\d [AP]M)/, '$1'),
                END: tftEnd.replace(/([A-Z]{3}) 0(\d)/g, '$1 $2').replace(/0(\d\:\d\d [AP]M)/, '$1'),
                SENDER: sender
            });
            return output.toUpperCase();
        }
        case 'SAGE': {
            let orgText = normalOriginator;
            if (originator === 'CIV') orgText = 'The Civil Authorities';
            if (originator === 'EAS') orgText = 'An EAS Participant';
            const startParts = getZonedParts(startTime);
            const endParts = getZonedParts(endTime);
            const sameDay = startParts.dateKey === endParts.dateKey;
            const sageStart = `${formatTime12(startTime, { lowerMeridiem: true })}${sameDay ? '' : ` ${WEEKDAY_ABBR[startParts.weekday]} ${MONTH_ABBR[startParts.monthIndex]} ${pad2(startParts.day)}`}`;
            const sageEnd = `${formatTime12(endTime, { lowerMeridiem: true })}${sameDay ? '' : ` ${WEEKDAY_ABBR[endParts.weekday]} ${MONTH_ABBR[endParts.monthIndex]} ${pad2(endParts.day)}`}`;
            const strFips = fipsContext.strFips.slice(0, -1).replace(/;/g, ',').replace(/All of The United States/gi, 'all of the United States');
            const output = applyModeTemplate('SAGE', {
                ORG: orgText,
                HAVEHAS: originator === 'CIV' ? 'have' : 'has',
                EVENTCODE: normalEventCode,
                FIPS: strFips.replace(/City of (.*?), ([A-Z]{2})/gi, '$1 city, $2').replace(/State of (.*?)/gi, 'all of $1'),
                START: sageStart,
                END: sageEnd,
                SENDER: sender
            });
            return output;
        }
        case 'TRILITHIC6': {
            const BANNED_CHARS = /[\(\)\,\!]/g;
            let orgText = normalOriginator;
            if (originator === 'CIV') orgText = 'Civil Authorities';
            const trilithicLocations = fipsContext.fipsTextWithAnd.map((entry) => {
                const { location, state } = splitLocationState(entry);
                const clean = filterTrilithicLocation(location);
                return state ? `${clean} ${state}` : clean;
            }).join(' - ');
            const output = applyModeTemplate('TRILITHIC6', {
                ORG: orgText,
                HAVEHAS: originator === 'CIV' ? 'have' : 'has',
                EVENTCODE: normalEventCode,
                FIPS: trilithicLocations.match("All of The United States") ? "the United States" : "the following counties: " + trilithicLocations,
                END: formatSlashUTC(endTime)
            });
            return output.replace(BANNED_CHARS, ' ');
        }
        case 'TRILITHIC8PLUS': {
            const BANNED_CHARS = /[\(\)\,\!]/g;
            let orgText = normalOriginator;
            if (originator === 'CIV') orgText = 'The Civil Authorities';
            const trilithicLocations = fipsContext.fipsTextWithAnd.map((entry) => {
                const { location, state } = splitLocationState(entry);
                const clean = filterTrilithicLocation(location);
                return state ? `${clean} ${state}` : clean;
            }).join(' - ');
            const output = applyModeTemplate('TRILITHIC8PLUS', {
                ORG: orgText,
                HAVEHAS: originator === 'CIV' ? 'have' : 'has',
                EVENTCODE: normalEventCode,
                FIPS: trilithicLocations.match("All of The United States") ? "the United States" : "the following counties: " + trilithicLocations,
                END: formatSlashUTC(endTime),
                SENDER: sender
            });
            return output.replace(BANNED_CHARS, ' ');
        }
        case 'BURK': {
            let orgText = normalOriginator;
            if (originator === 'EAS') orgText = 'A Broadcast station or cable system';
            else if (originator === 'CIV') orgText = 'The Civil Authorities';
            const strFips = fipsContext.strFips.slice(0, -1).replace(/,/g, '').replace(/;/g, ',');
            const eventText = normalEventCode.split(' ').slice(1).join(' ').toUpperCase();
            const burkStart = `${formatMonDayYear(startTime, { upperMonth: true })} at ${formatTime12(startTime)}`;
            const burkEnd = `${formatTime12(endTime)}, ${formatMonDayYear(endTime, { upperMonth: true })}`.toUpperCase();
            const output = applyModeTemplate('BURK', {
                ORG: orgText,
                HAVEHAS: originator === 'CIV' ? 'have' : 'has',
                EVENTTEXT: eventText,
                FIPS: strFips.match("All of The United States") ? "the United States" : "for the following counties/areas: " + strFips,
                START: burkStart,
                END: burkEnd
            });
            return output;
        }
        case 'DAS1': {
            let orgText = normalOriginator;
            if (originator === 'EAS') orgText = 'A broadcast or cable system';
            else if (originator === 'CIV') orgText = 'A civil authority';
            else if (originator === 'PEP') orgText = 'THE PRIMARY ENTRY POINT EAS SYSTEM';
            const das = processDASFipsString(fipsContext.strFips, false);
            const dasFips = das.strFips.replace(/All of the United States/gi, 'United States');
            const dasStart = `${formatTime12(startTime, { padHour: false }).toUpperCase()} ON ${formatMonDayYear(startTime, { shortMonth: true, upperMonth: true })}`;
            const dasEnd = isSameLocalDay(startTime, endTime)
                ? formatTime12(endTime, { padHour: false }).toUpperCase()
                : `${formatTime12(endTime, { padHour: false }).toUpperCase()} ${formatMonDayYear(endTime, { shortMonth: true, upperMonth: true })}`;
            const output = applyModeTemplate('DAS1', {
                ORG: orgText.toUpperCase(),
                EVENTCODE: normalEventCode.toUpperCase(),
                FIPS: dasFips,
                START: dasStart,
                END: dasEnd,
                SENDER: sender.toUpperCase()
            });
            return output.toUpperCase();
        }
        case 'DAS2PLUS': {
            let orgText = normalOriginator;
            if (originator === 'EAS') orgText = 'A broadcast or cable system';
            else if (originator === 'CIV') orgText = 'A civil authority';
            else if (originator === 'PEP') orgText = 'THE PRIMARY ENTRY POINT EAS SYSTEM';
            const das = processDASFipsString(fipsContext.strFips, true);
            const dasFips = das.strFips.replace(/All of the United States/gi, 'United States');
            const dasStart = `${formatTime12(startTime, { padHour: false }).toUpperCase()} on ${formatMonDayYear(startTime, { shortMonth: true, upperMonth: true })}`;
            const dasEnd = isSameLocalDay(startTime, endTime)
                ? formatTime12(endTime, { padHour: false }).toUpperCase()
                : `${formatTime12(endTime, { padHour: false }).toUpperCase()} ${formatMonDayYear(endTime, { shortMonth: true, upperMonth: true })}`;
            const output = applyModeTemplate('DAS2PLUS', {
                ORG: orgText,
                EVENTCODE: normalEventCode.toUpperCase(),
                FIPS: dasFips,
                START: dasStart.replace(/([A-Z]{3}) 0(\d)/, '$1 $2'),
                END: dasEnd.replace(/([A-Z]{3}) 0(\d)/, '$1 $2'),
                SENDER: sender
            });
            return output;
        }
        case 'HOLLYANNE': {
            let orgText = normalOriginator;
            if (originator === 'EAS') orgText = 'THE CABLE/BROADCAST SYSTEM';
            else if (originator === 'CIV') orgText = 'THE AUTHORITIES';

            const states = new Set(
                fipsContext.fipsTextWithAnd
                    .map((entry) => splitLocationState(entry).state)
                    .filter(Boolean)
            );
            const hollyLocations = fipsContext.fipsTextWithAnd.map((entry) => {
                const { location, state } = splitLocationState(entry);
                const clean = filterHollyOrGormanLocation(location, false).toUpperCase();
                if (state && states.size !== 1) {
                    return `${clean} ${state.toUpperCase()}`;
                }
                return clean.trim();
            }).join(', ').replace(', AND ', ' AND ').trim();

            const output = applyModeTemplate('HOLLYANNE', {
                ORG: orgText,
                EVENTCODE: normalEventCode.toUpperCase(),
                FIPS: hollyLocations.match(/All of the United States/gi) ? "For all of the United States" : "FOR THE FOLLOWING COUNTIES: " + hollyLocations,
                START: baseRangeTime.start.toUpperCase(),
                END: baseRangeTime.end.toUpperCase(),
                SENDER: sender
            });
            return output.toUpperCase();
        }
        case 'GORMAN': {
            const gormanStart = `${formatTime12(startTime, { padHour: false }).toUpperCase()} ON ${formatMonDayYear(startTime, { upperMonth: true, shortMonth: true, includeYear: true })}`.replace(/([A-Z]{3}) 0(\d)/, '$1 $2');
            const gormanEnd = isSameLocalDay(startTime, endTime)
                ? formatTime12(endTime, { padHour: false }).toUpperCase()
                : `${formatTime12(endTime, { padHour: false }).toUpperCase()} ON ${formatMonDayYear(endTime, { upperMonth: true, shortMonth: true, includeYear: true })}`.replace(/([A-Z]{3}) 0(\d)/, '$1 $2');
            const gormanLocations = fipsContext.fipsTextWithAnd.map((entry) => {
                const { location, state } = splitLocationState(entry);
                const clean = filterHollyOrGormanLocation(location, true).toUpperCase();
                return state ? `${clean} ${state.toUpperCase()}` : clean;
            }).join(', ').replace(', AND ', ' AND ').trim();
            const output = applyModeTemplate('GORMAN', {
                EVENTCODE: normalEventCode.toUpperCase(),
                FIPS: gormanLocations.match(/All of the United States/gi) ? "UNITED STATES" : gormanLocations,
                START: gormanStart,
                END: gormanEnd,
                SENDER: sender
            });
            return output.toUpperCase();
        }
        case 'JSON': {
            return JSON.stringify({
                event_code: normalEventCode,
                originator: normalOriginator,
                fips_codes: fipsContext.codes,
                start_time: toEpoch(startTime),
                end_time: toEpoch(endTime),
                sender: sender
            });
        }
        default:
            var locs = fipsContext.strFips.slice(0, -1);
            var locsarr = locs.match(/(.*?), ([A-Z]{2})/g);
            locs = locsarr ? locsarr.map((code) => `${code.split(',')[0].trim()}, ${canadian_mode ? PROVINCE_ABBREVIATIONS[code.split(',')[1].trim()] : STATE_ABBREVIATIONS[code.split(',')[1].trim()]}`) : locs;
            return `${normalOriginator} has issued ${normalEventCode} for ${locsarr ? locs.join('') : locs}; beginning at ${startTimeStr} and ending at ${endTimeStr}. Message from ${sender}.`;
    }
}

export function E2T(header, endec_emulation_mode=null, canadian_mode=false, timezone_override=null) {
    const parsed = parseHeaderCore(header);
    return humanizeEAS(parsed, endec_emulation_mode, canadian_mode, timezone_override);
}

export function parseHeader(header) {
    return serializeParsedHeader(parseHeaderCore(header));
}

// Structured counterpart to E2T() for callers that lay out their own screen instead of
// consuming prose. The timezone correction is the same one humanizeEAS() applies, so the
// times here always agree with the text E2T would have produced for the same header.
export function parseHeaderDetailed(header, timezone_override=null, canadian_mode=false) {
    const parsed = parseHeaderCore(header);
    const startTime = reparseStartTimeInTimezone(parsed.startTime, timezone_override);
    const endTime = new Date(startTime.getTime() + parsed.duration.hours * 3600000 + parsed.duration.minutes * 60000);

    return {
        originator: parsed.originator,
        originatorName: lookupSame('ORGS', parsed.originator, canadian_mode) || parsed.originator,
        eventCode: parsed.eventCode,
        eventName: lookupSame('EVENTS', parsed.eventCode, canadian_mode) || parsed.eventCode,
        locations: [...parsed.locations],
        locationNames: parsed.locations.map((code) => ({
            code,
            subdivision: lookupResource(canadian_mode ? 'sameCA' : 'sameUS', 'SUBDIV', code.slice(0, 1)) ?? '',
            name: lookupSame('SAME', code.slice(1, 6), canadian_mode) ?? `FIPS Code ${code}`
        })),
        durationHours: parsed.duration.hours,
        durationMinutes: parsed.duration.minutes,
        indefinite: parsed.duration.hours === 0 && parsed.duration.minutes === 0,
        startTime,
        endTime,
        startTimeText: formatTime12(startTime),
        endTimeText: formatTime12(endTime),
        endDateText: formatMonDayYear(endTime, { shortMonth: true, upperMonth: true, includeYear: false }),
        endsOnStartDay: isSameLocalDay(startTime, endTime),
        senderId: parsed.senderid.trim()
    };
}

export function parseHeaderJson(header) {
    return JSON.stringify(parseHeader(header));
}

export function parseHeaderPrettyJson(header) {
    return JSON.stringify(parseHeader(header), null, 2);
}
