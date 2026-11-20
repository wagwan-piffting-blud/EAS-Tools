export const EASYCAP_SOURCE = 'easycap';
export const EASYCAP_SDI_SOURCE = 'easycap_sdi';
export const EASYCAP_SOURCES = Object.freeze([EASYCAP_SOURCE, EASYCAP_SDI_SOURCE]);
export const EASYCAP_NBSP = ' ';

export const EASYCAP_FONTS = Object.freeze({
    sans: 'Bitstream Vera Sans',
    serif: 'Bitstream Vera Serif',
    mono: 'Bitstream Vera Sans Mono'
});

export const EASYCAP_DISPLAY_MODES = Object.freeze({
    '480i': Object.freeze({ width: 640, height: 480 }),
    '720p': Object.freeze({ width: 1280, height: 720 }),
    '1080i': Object.freeze({ width: 1920, height: 1080 })
});

export const EASYCAP_ANALOG_DIMENSIONS = EASYCAP_DISPLAY_MODES['480i'];

export const EASYCAP_DEFAULTS = Object.freeze({
    title: 'Emergency Alert System',
    showEvent: true,
    pageNumbersBottom: true,
    font: 'sans',
    speed: 12,
    background: '#1010C8',
    displayMode: '1080i',
    crawl: false,
    position: 2,
    sdiSpeed: 4
});

export const EASYCAP_REFERENCE = Object.freeze({
    height: 480,
    margin: 14,
    titleSize: 39,
    bodySize: 35,
    firstBaseline: 48,
    titlePitch: 44,
    bodyGap: 52,
    bodyPitch: 40,
    counterBaseline: 440,
    sdiCpsPerLevel: 3,
    averageAdvanceEm: 0.6
});

const STATEWIDE_CODE = /^\d{3}000$/;
const NATIONAL_NAME = /^All of The United States$/i;
const STATE_SUFFIX = /,\s*([A-Z]{2})$/;

function clampInteger(value, min, max, fallback) {
    const parsed = Math.round(Number(value));
    if (!Number.isFinite(parsed)) {
        return fallback;
    }
    return Math.min(max, Math.max(min, parsed));
}

function hexColor(value, fallback) {
    const text = String(value ?? '').trim();
    return /^#[0-9a-f]{6}$/i.test(text) ? text.toUpperCase() : fallback;
}

export function isEasycapSource(source) {
    return EASYCAP_SOURCES.includes(source);
}

export function normalizeEasycapSettings(raw = {}) {
    const source = raw && typeof raw === 'object' ? raw : {};
    const bool = (value, fallback) => (typeof value === 'boolean' ? value : fallback);
    return {
        title: typeof source.title === 'string' ? source.title.replace(/\s+/g, ' ').trim().slice(0, 80) : EASYCAP_DEFAULTS.title,
        showEvent: bool(source.showEvent, EASYCAP_DEFAULTS.showEvent),
        pageNumbersBottom: bool(source.pageNumbersBottom, EASYCAP_DEFAULTS.pageNumbersBottom),
        font: Object.hasOwn(EASYCAP_FONTS, source.font) ? source.font : EASYCAP_DEFAULTS.font,
        speed: clampInteger(source.speed, 1, 99, EASYCAP_DEFAULTS.speed),
        background: hexColor(source.background, EASYCAP_DEFAULTS.background),
        displayMode: Object.hasOwn(EASYCAP_DISPLAY_MODES, source.displayMode) ? source.displayMode : EASYCAP_DEFAULTS.displayMode,
        crawl: bool(source.crawl, EASYCAP_DEFAULTS.crawl),
        position: clampInteger(source.position, 1, 12, EASYCAP_DEFAULTS.position),
        sdiSpeed: clampInteger(source.sdiSpeed, 1, 10, EASYCAP_DEFAULTS.sdiSpeed)
    };
}

export function easycapDimensions(source, settings) {
    if (source !== EASYCAP_SDI_SOURCE) {
        return { ...EASYCAP_ANALOG_DIMENSIONS };
    }
    return { ...EASYCAP_DISPLAY_MODES[normalizeEasycapSettings(settings).displayMode] };
}

export function easycapCharsPerSecond(source, settings) {
    const normalized = normalizeEasycapSettings(settings);
    return source === EASYCAP_SDI_SOURCE
        ? normalized.sdiSpeed * EASYCAP_REFERENCE.sdiCpsPerLevel
        : normalized.speed;
}

export function easycapCrawlActive(source, settings) {
    return source === EASYCAP_SDI_SOURCE && normalizeEasycapSettings(settings).crawl;
}

export function easycapGeometry(width, height) {
    const scale = height / EASYCAP_REFERENCE.height;
    const at = (value) => value * scale;
    const margin = at(EASYCAP_REFERENCE.margin);
    return {
        width,
        height,
        scale,
        margin,
        wrapWidth: Math.max(1, width - margin * 2),
        titleSize: at(EASYCAP_REFERENCE.titleSize),
        bodySize: at(EASYCAP_REFERENCE.bodySize),
        firstBaseline: at(EASYCAP_REFERENCE.firstBaseline),
        titlePitch: at(EASYCAP_REFERENCE.titlePitch),
        bodyGap: at(EASYCAP_REFERENCE.bodyGap),
        bodyPitch: at(EASYCAP_REFERENCE.bodyPitch),
        counterBaseline: at(EASYCAP_REFERENCE.counterBaseline)
    };
}

function unbreakable(text) {
    return String(text).trim().replace(/\s+/g, EASYCAP_NBSP);
}

function joinParts(parts) {
    if (parts.length <= 1) {
        return parts[0] || '';
    }
    return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

function countyName(name) {
    let result = String(name).replace(STATE_SUFFIX, '').trim();
    if (/^City of\s+/i.test(result)) {
        result = `${result.replace(/^City of\s+/i, '')} city`;
    }
    return result.replace(/\s+County$/i, '').trim();
}

export function easycapAreaText(locationNames, stateName = () => '') {
    const entries = Array.isArray(locationNames) ? locationNames : [];
    const seen = new Set();
    const statewide = [];
    const groups = new Map();
    const others = [];

    for (const entry of entries) {
        const code = String((entry && entry.code) || '');
        const name = String((entry && entry.name) || '').trim();
        if (!name || (code && seen.has(code))) {
            continue;
        }
        if (code) {
            seen.add(code);
        }
        if (NATIONAL_NAME.test(name)) {
            return 'the United States';
        }
        const state = stateName(code) || '';
        if ((STATEWIDE_CODE.test(code) && state) || /^State of\s+/i.test(name)) {
            statewide.push(unbreakable(`All of ${state || name.replace(/^State of\s+/i, '').replace(STATE_SUFFIX, '')}`));
            continue;
        }
        if (!state || !STATE_SUFFIX.test(name)) {
            others.push(unbreakable(name));
            continue;
        }
        const subdivision = String((entry && entry.subdivision) || '').trim();
        const county = unbreakable(subdivision ? `${subdivision} ${countyName(name)}` : countyName(name));
        if (!groups.has(state)) {
            groups.set(state, []);
        }
        groups.get(state).push(county);
    }

    const parts = [...statewide];
    groups.forEach((counties, state) => {
        parts.push(`the following ${state} counties: ${counties.join(', ')}`);
    });
    others.forEach((name) => parts.push(name));
    return parts.length ? joinParts(parts) : 'your area';
}

export function easycapUntilText(date, timeZone, zoneName = '') {
    const when = date instanceof Date ? date : new Date(date);
    if (!Number.isFinite(when.getTime())) {
        return '';
    }
    const parts = {};
    new Intl.DateTimeFormat('en-US', {
        timeZone: timeZone || 'UTC',
        month: 'long',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hour12: true
    }).formatToParts(when).forEach((part) => {
        parts[part.type] = part.value;
    });
    const meridiem = String(parts.dayPeriod || '').toUpperCase();
    const text = `${parts.month} ${parts.day}, ${parts.hour}:${parts.minute} ${meridiem}`;
    return zoneName ? `${text} ${zoneName}` : text;
}

export function easycapZoneName(date, timeZone) {
    try {
        const zone = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'short' })
            .formatToParts(date instanceof Date ? date : new Date(date))
            .find((part) => part.type === 'timeZoneName');
        return zone ? zone.value : '';
    } catch (err) {
        return String(timeZone || '').trim();
    }
}

export function easycapEventName(eventName) {
    return String(eventName || '').replace(/^(?:a|an|the)\s+/i, '').replace(/\s+/g, ' ').trim();
}

export function easycapMessage({ originatorCode = '', originatorName = '', eventName = '', areaText = '', untilText = '', sender = '' } = {}) {
    const civil = String(originatorCode).toUpperCase() === 'CIV';
    const issuer = civil ? 'The Civil Authorities' : (String(originatorName).trim() || 'An EAS Participant');
    const event = easycapEventName(eventName);
    const article = /^(?:a|an|the)\s/i.test(String(eventName).trim())
        ? String(eventName).trim().split(/\s+/)[0]
        : (/^[AEIOU]/i.test(event) ? 'an' : 'a');
    const until = untilText ? ` Effective until ${untilText}.` : '';
    const senderText = String(sender || '').trim();
    return `${issuer} ${civil ? 'have' : 'has'} issued ${article} ${event} for ${areaText || 'your area'}.${until}${senderText ? ` ${senderText}` : ''}`;
}

export function easycapPlainText(text) {
    return String(text ?? '').split(EASYCAP_NBSP).join(' ');
}

function wrapWords(words, measure, maxWidth) {
    const lines = [];
    let current = '';
    for (const word of words) {
        if (!word) {
            continue;
        }
        const candidate = current ? `${current} ${word}` : word;
        if (!current || measure(easycapPlainText(candidate)) <= maxWidth) {
            current = candidate;
            continue;
        }
        lines.push(current);
        current = word;
    }
    if (current) {
        lines.push(current);
    }
    return lines;
}

export function wrapEasycapText(text, measure, maxWidth) {
    const paragraphs = String(text ?? '').replace(/\r\n?/g, '\n').split('\n');
    const lines = [];
    for (const paragraph of paragraphs) {
        const tokens = paragraph.split(/[ \t]+/).filter(Boolean);
        const expanded = [];
        for (const token of tokens) {
            if (token.includes(EASYCAP_NBSP) && measure(easycapPlainText(token)) > maxWidth) {
                expanded.push(...token.split(EASYCAP_NBSP));
            } else {
                expanded.push(token);
            }
        }
        wrapWords(expanded, measure, maxWidth).forEach((line) => lines.push(easycapPlainText(line)));
    }
    return lines;
}

export function easycapHeaderLines({ title = '', eventText = '', showEvent = true } = {}, measureTitle, maxWidth) {
    const lines = [];
    if (String(title).trim()) {
        lines.push(...wrapEasycapText(String(title).trim(), measureTitle, maxWidth));
    }
    if (showEvent && String(eventText).trim()) {
        lines.push(...wrapEasycapText(String(eventText).trim(), measureTitle, maxWidth));
    }
    return lines;
}

export function easycapPageLayout(geometry, headerLineCount, { counterAtTop = false } = {}) {
    const top = geometry.firstBaseline + (counterAtTop ? geometry.titlePitch : 0);
    const headerBaselines = Array.from({ length: headerLineCount }, (_, index) => top + index * geometry.titlePitch);
    const bodyStart = headerLineCount
        ? headerBaselines[headerLineCount - 1] + geometry.bodyGap
        : top + geometry.bodyGap - geometry.titlePitch;
    const bodyLimit = counterAtTop
        ? geometry.counterBaseline
        : geometry.counterBaseline - geometry.bodyGap;
    const linesPerPage = Math.max(1, Math.floor((bodyLimit - bodyStart) / geometry.bodyPitch + 1e-9) + 1);
    return {
        headerBaselines,
        bodyStart,
        linesPerPage,
        counterBaseline: counterAtTop ? geometry.firstBaseline : geometry.counterBaseline
    };
}

export function paginateEasycapLines(lines, linesPerPage) {
    const perPage = Math.max(1, Math.round(Number(linesPerPage) || 1));
    const source = Array.isArray(lines) && lines.length ? lines : [''];
    const pages = [];
    for (let index = 0; index < source.length; index += perPage) {
        pages.push(source.slice(index, index + perPage));
    }
    return pages;
}

export function easycapPageCounter(pageIndex, pageCount) {
    return pageCount > 1 ? `- ${pageIndex + 1} of ${pageCount} -` : '';
}

export function easycapPageDelayMs(pageLines, charsPerSecond) {
    const cps = Math.max(1, Number(charsPerSecond) || EASYCAP_DEFAULTS.speed);
    const chars = (Array.isArray(pageLines) ? pageLines : [pageLines]).join(' ').trim().length;
    return Math.max(1, Math.round(chars / cps)) * 1000;
}

export function easycapCrawlRow(position, height, fontSize) {
    const row = Math.min(12, Math.max(1, Math.round(Number(position) || EASYCAP_DEFAULTS.position)));
    const rowHeight = height / 12;
    const center = (row - 0.5) * rowHeight;
    return {
        row,
        center,
        top: Math.round(center - (fontSize + 10) / 2)
    };
}

export function easycapCrawlHeaderTop(geometry, headerLineCount, crawlRow) {
    if (!headerLineCount) {
        return geometry.firstBaseline;
    }
    const blockTop = geometry.firstBaseline - geometry.titleSize;
    const blockBottom = geometry.firstBaseline + (headerLineCount - 1) * geometry.titlePitch + geometry.titleSize * 0.3;
    const rowHalf = geometry.height / 24;
    const overlaps = crawlRow.center + rowHalf > blockTop && crawlRow.center - rowHalf < blockBottom;
    if (!overlaps) {
        return geometry.firstBaseline;
    }
    const blockHeight = blockBottom - blockTop;
    return geometry.height / 2 - blockHeight / 2 + geometry.titleSize;
}

export function easycapCrawlSpeed(charsPerSecond, fontSize, framesPerSecond = 60) {
    const pxPerSecond = Math.max(1, Number(charsPerSecond) || 1) * Math.max(1, Number(fontSize) || 1) * EASYCAP_REFERENCE.averageAdvanceEm;
    return Math.min(20, Math.max(1, Math.round(pxPerSecond / framesPerSecond)));
}
