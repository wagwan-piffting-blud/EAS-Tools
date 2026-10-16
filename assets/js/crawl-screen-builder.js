export const SCREEN_FORMAT = 'eas-tools-screen';
export const SCREEN_VERSION = 1;
export const SCREEN_TYPE = 'screen';

const STORE_KEY = 'eas-tools-crawl-screens';
const DEFAULT_SEVERITY_COLORS = Object.freeze({ warning: '#FF2A10', watch: '#FF8000', advisory: '#02D306' });
const SEVERITY_TOKEN = '{SEVERITY_COLOR}';
const COLOR_MARKER = /\{COLOR(?::([^}]*))?\}/gi;
const TOKEN_PATTERN = /\{([A-Z][A-Z0-9_]*)\}/g;
const HEX_COLOR = /^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const OFF_SCREEN = 9999;

export const SCREEN_TOKENS = Object.freeze([
    { name: 'EVENT', description: 'Event name, e.g. Tornado Warning' },
    { name: 'EVENT_CODE', description: 'Three-letter event code, e.g. TOR' },
    { name: 'ARTICLE', description: '"a" or "an", to read naturally before the event name' },
    { name: 'ORIGINATOR', description: 'Who sent it, e.g. National Weather Service' },
    { name: 'ORIGINATOR_CODE', description: 'Three-letter originator code, e.g. WXR' },
    { name: 'LOCATIONS', description: 'The alerted areas, joined into one phrase' },
    { name: 'START', description: 'Issue time' },
    { name: 'END', description: 'Purge time' },
    { name: 'END_DATE', description: 'Purge date' },
    { name: 'UNTIL', description: 'Purge time, plus the date when it is not the same day, or Further Notice' },
    { name: 'SENDER', description: 'Sender ID from the header (or the override)' },
    { name: 'HEADLINE', description: 'EMERGENCY ALERT SYSTEM, or NATIONAL ALERT for EAN/EAT' },
    { name: 'TEXT', description: 'The full crawl text' },
    { name: 'SEVERITY_COLOR', description: 'Warning, watch or advisory color from the Screen settings; works in color fields and inside {COLOR:...}' }
]);

const TEMPLATE_CHOICES = Object.freeze([
    { value: 'blank', label: 'Blank screen' },
    { value: 'atari_800xl', label: 'Atari 800XL Override Screen' },
    { value: 'easyplus', label: 'EASyPLUS' },
    { value: 'easyplus_gray', label: 'EASyPLUS Gray' },
    { value: 'eas_1cg', label: 'Gorman Redlich EAS-1CG (single page)' },
    { value: 'dasdec', label: 'DASDEC (single page)' },
    { value: 'dasdec_black', label: 'DASDEC (black, single page)' },
    { value: 'dasdec_blue', label: 'DASDEC (blue, single page)' }
]);

let elementCounter = 0;

function newElementId() {
    elementCounter += 1;
    return `el${Date.now().toString(36)}${elementCounter.toString(36)}`;
}

function newScreenId() {
    const bytes = new Uint8Array(6);
    crypto.getRandomValues(bytes);
    return 's' + Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function clampNumber(value, min, max, fallback) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) {
        return fallback;
    }
    return Math.min(max, Math.max(min, parsed));
}

function roundTo(value, places = 3) {
    const factor = Math.pow(10, places);
    return Math.round(value * factor) / factor;
}

function evenDimension(value, min, max, fallback) {
    const clamped = clampNumber(value, min, max, fallback);
    return Math.max(min, Math.round(clamped / 2) * 2);
}

function sanitizeColor(value, fallback, { allowNone = false, allowSeverity = true } = {}) {
    if (typeof value !== 'string') {
        return fallback;
    }
    const trimmed = value.trim();
    if (allowNone && trimmed === '') {
        return '';
    }
    if (allowSeverity && trimmed.toUpperCase() === SEVERITY_TOKEN) {
        return SEVERITY_TOKEN;
    }
    return HEX_COLOR.test(trimmed) ? trimmed : fallback;
}

function sanitizeImageSource(value) {
    return typeof value === 'string' && /^data:image\/[a-z0-9.+-]+[;,]/i.test(value) ? value : '';
}

function pickEnum(value, allowed, fallback) {
    return allowed.includes(value) ? value : fallback;
}

function normalizeElement(raw) {
    if (!raw || typeof raw !== 'object') {
        return null;
    }
    const type = pickEnum(raw.type, ['text', 'rect', 'image'], null);
    if (!type) {
        return null;
    }
    const base = {
        id: typeof raw.id === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(raw.id) ? raw.id : newElementId(),
        type,
        x: roundTo(clampNumber(raw.x, -10000, 10000, 0)),
        y: roundTo(clampNumber(raw.y, -10000, 10000, 0)),
        flash: raw.flash === true
    };
    if (type === 'text') {
        const size = roundTo(clampNumber(raw.size, 1, 1000, 32));
        return {
            ...base,
            text: typeof raw.text === 'string' ? raw.text.slice(0, 20000) : '',
            width: roundTo(clampNumber(raw.width, 0, 20000, 400)),
            align: pickEnum(raw.align, ['left', 'center', 'right'], 'left'),
            valign: pickEnum(raw.valign, ['top', 'middle', 'bottom'], 'top'),
            font: typeof raw.font === 'string' && raw.font.trim() ? raw.font.trim().slice(0, 120) : 'Arial',
            size,
            bold: raw.bold === true,
            italic: raw.italic === true,
            color: sanitizeColor(raw.color, '#FFFFFF'),
            outlineColor: sanitizeColor(raw.outlineColor, '#000000', { allowSeverity: false }),
            outlineWidth: roundTo(clampNumber(raw.outlineWidth, 0, 50, 0)),
            outlineJoin: pickEnum(raw.outlineJoin, ['round', 'bevel', 'miter'], 'round'),
            lineHeight: roundTo(clampNumber(raw.lineHeight, 0, 4000, 0)),
            letterSpacing: roundTo(clampNumber(raw.letterSpacing, -100, 1000, 0)),
            wrap: pickEnum(raw.wrap, ['none', 'width', 'columns'], 'width'),
            columns: Math.round(clampNumber(raw.columns, 1, 500, 32)),
            uppercase: raw.uppercase === true
        };
    }
    const box = {
        ...base,
        width: roundTo(clampNumber(raw.width, 0, 20000, 100)),
        height: roundTo(clampNumber(raw.height, 0, 20000, 100))
    };
    if (type === 'rect') {
        return {
            ...box,
            fill: sanitizeColor(raw.fill, '#333333', { allowNone: true }),
            stroke: sanitizeColor(raw.stroke, '#FFFFFF'),
            strokeWidth: roundTo(clampNumber(raw.strokeWidth, 0, 500, 0))
        };
    }
    const src = sanitizeImageSource(raw.src);
    if (!src) {
        return null;
    }
    return { ...box, src };
}

export function normalizeScreen(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        throw new Error('A screen must be a JSON object.');
    }
    if (raw.format !== SCREEN_FORMAT) {
        throw new Error(`This is not an EAS Tools screen file (expected "format": "${SCREEN_FORMAT}").`);
    }
    const version = Number(raw.version);
    if (!Number.isFinite(version) || version < 1 || version > SCREEN_VERSION) {
        throw new Error(`Unsupported screen version ${raw.version}. This page understands version ${SCREEN_VERSION}.`);
    }
    const width = evenDimension(raw.width, 16, 3840, 640);
    const height = evenDimension(raw.height, 16, 2160, 480);
    const background = raw.background && typeof raw.background === 'object' ? raw.background : {};
    const severity = raw.severityColors && typeof raw.severityColors === 'object' ? raw.severityColors : {};
    const crawl = raw.crawl && typeof raw.crawl === 'object' ? raw.crawl : {};
    const elements = (Array.isArray(raw.elements) ? raw.elements : [])
        .slice(0, 200)
        .map(normalizeElement)
        .filter(Boolean);
    const seen = new Set();
    elements.forEach((element) => {
        if (seen.has(element.id)) {
            element.id = newElementId();
        }
        seen.add(element.id);
    });
    return {
        format: SCREEN_FORMAT,
        version: SCREEN_VERSION,
        id: typeof raw.id === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(raw.id) ? raw.id : null,
        name: (typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim() : 'Untitled Screen').slice(0, 80),
        width,
        height,
        background: {
            color: sanitizeColor(background.color, '#000000', { allowSeverity: false }),
            image: sanitizeImageSource(background.image)
        },
        flashIntervalMs: Math.round(clampNumber(raw.flashIntervalMs, 100, 10000, 500)),
        textEndecMode: typeof raw.textEndecMode === 'string' ? raw.textEndecMode.trim().slice(0, 40) : '',
        severityColors: {
            warning: sanitizeColor(severity.warning, DEFAULT_SEVERITY_COLORS.warning, { allowSeverity: false }),
            watch: sanitizeColor(severity.watch, DEFAULT_SEVERITY_COLORS.watch, { allowSeverity: false }),
            advisory: sanitizeColor(severity.advisory, DEFAULT_SEVERITY_COLORS.advisory, { allowSeverity: false })
        },
        crawl: {
            enabled: crawl.enabled !== false,
            y: Math.round(clampNumber(crawl.y, 0, height, Math.round(height * 0.8))),
            inset: Math.round(clampNumber(crawl.inset, 0, 500, 0))
        },
        elements,
        updated: Number.isFinite(Number(raw.updated)) ? Number(raw.updated) : 0
    };
}

export function serializeScreen(layout) {
    const normalized = normalizeScreen(layout);
    return JSON.stringify(normalized, null, 2);
}

export function parseScreenJson(text) {
    let parsed;
    try {
        parsed = JSON.parse(text);
    } catch (err) {
        throw new Error('That file is not valid JSON.');
    }
    return normalizeScreen(parsed);
}

function cloneScreen(layout) {
    return JSON.parse(JSON.stringify(layout));
}

function readStore() {
    try {
        const raw = JSON.parse(localStorage.getItem(STORE_KEY) || '[]');
        if (!Array.isArray(raw)) {
            return [];
        }
        const screens = [];
        raw.forEach((entry) => {
            try {
                const screen = normalizeScreen(entry);
                if (screen.id) {
                    screens.push(screen);
                }
            } catch (err) { }
        });
        return screens;
    } catch (err) {
        return [];
    }
}

function writeStore(screens) {
    localStorage.setItem(STORE_KEY, JSON.stringify(screens));
}

export function listScreens() {
    return readStore().map((screen) => ({ id: screen.id, name: screen.name, updated: screen.updated }));
}

export function getScreen(id) {
    if (!id) {
        return null;
    }
    return readStore().find((screen) => screen.id === id) || null;
}

export function saveScreen(layout) {
    const screen = normalizeScreen(layout);
    if (!screen.id) {
        screen.id = newScreenId();
    }
    screen.updated = Math.max(Date.now(), (screen.updated || 0) + 1);
    const screens = readStore();
    const index = screens.findIndex((entry) => entry.id === screen.id);
    if (index >= 0) {
        screens[index] = screen;
    } else {
        screens.push(screen);
    }
    writeStore(screens);
    return screen;
}

export function adoptScreen(layout) {
    const screen = normalizeScreen(layout);
    if (!screen.id) {
        return null;
    }
    const existing = getScreen(screen.id);
    if (existing) {
        return existing;
    }
    const screens = readStore();
    screens.push(screen);
    writeStore(screens);
    return screen;
}

export function deleteScreen(id) {
    const screens = readStore().filter((screen) => screen.id !== id);
    writeStore(screens);
}

export function screenTopLeft(layout) {
    if (!layout || !layout.crawl || !layout.crawl.enabled) {
        return { x: OFF_SCREEN, y: OFF_SCREEN };
    }
    return { x: 0, y: layout.crawl.y };
}

function quoteFamily(family) {
    return /[^a-zA-Z0-9_-]/.test(family) ? `"${family.replace(/(["\\])/g, '\\$1')}"` : family;
}

function fontString(element) {
    return `${element.italic ? 'italic ' : ''}${element.bold ? 'bold ' : ''}${element.size}px ${quoteFamily(element.font)}`;
}

function resolveTokens(layout, tokens) {
    const source = tokens && typeof tokens === 'object' ? tokens : {};
    const severity = pickEnum(source.SEVERITY, ['warning', 'watch', 'advisory'], 'advisory');
    const colors = (layout && layout.severityColors) || DEFAULT_SEVERITY_COLORS;
    return { ...source, SEVERITY_COLOR: colors[severity] || DEFAULT_SEVERITY_COLORS.advisory };
}

function substituteTokens(text, resolved, showTokens) {
    const source = String(text ?? '');
    if (showTokens) {
        return source;
    }
    return source.replace(TOKEN_PATTERN, (match, name) => {
        if (name === 'COLOR' || !Object.prototype.hasOwnProperty.call(resolved, name)) {
            return match;
        }
        const value = resolved[name];
        return value === undefined || value === null ? '' : String(value);
    });
}

function resolveColorValue(value, resolved, fallback) {
    if (typeof value !== 'string' || !value) {
        return fallback;
    }
    const substituted = value.toUpperCase() === SEVERITY_TOKEN ? resolved.SEVERITY_COLOR : value.trim();
    return HEX_COLOR.test(substituted) ? substituted : fallback;
}

function parseRuns(paragraph, baseColor, resolved, uppercase) {
    const runs = [];
    let color = baseColor;
    let last = 0;
    COLOR_MARKER.lastIndex = 0;
    let match;
    while ((match = COLOR_MARKER.exec(paragraph)) !== null) {
        if (match.index > last) {
            runs.push({ text: paragraph.slice(last, match.index), color });
        }
        color = match[1] === undefined ? baseColor : resolveColorValue(match[1], resolved, baseColor);
        last = match.index + match[0].length;
    }
    if (last < paragraph.length) {
        runs.push({ text: paragraph.slice(last), color });
    }
    return runs.map((run) => ({ text: uppercase ? run.text.toUpperCase() : run.text, color: run.color }));
}

function glyphsFromRuns(runs) {
    const glyphs = [];
    runs.forEach((run) => {
        for (const ch of run.text) {
            glyphs.push({ ch, color: run.color });
        }
    });
    return glyphs;
}

function glyphText(glyphs) {
    return glyphs.map((glyph) => glyph.ch).join('');
}

function splitWords(glyphs) {
    const words = [];
    let current = [];
    glyphs.forEach((glyph) => {
        if (glyph.ch === ' ' || glyph.ch === '\t') {
            if (current.length) {
                words.push(current);
                current = [];
            }
            return;
        }
        current.push(glyph);
    });
    if (current.length) {
        words.push(current);
    }
    return words;
}

function wrapGlyphs(glyphs, element, measure) {
    if (element.wrap === 'none') {
        return [glyphs];
    }
    const words = splitWords(glyphs);
    if (!words.length) {
        return [[]];
    }
    const byColumns = element.wrap === 'columns';
    const limit = byColumns ? element.columns : element.width;
    const fits = (line) => (byColumns ? line.length <= limit : measure(glyphText(line)) <= limit);
    const lines = [];
    let current = [];
    words.forEach((word) => {
        let remaining = word;
        if (byColumns) {
            while (remaining.length > limit) {
                if (current.length) {
                    lines.push(current);
                    current = [];
                }
                lines.push(remaining.slice(0, limit));
                remaining = remaining.slice(limit);
            }
            if (!remaining.length) {
                return;
            }
        }
        if (!current.length) {
            current = remaining.slice();
            return;
        }
        const candidate = current.concat([{ ch: ' ', color: current[current.length - 1].color }], remaining);
        if (fits(candidate)) {
            current = candidate;
        } else {
            lines.push(current);
            current = remaining.slice();
        }
    });
    if (current.length) {
        lines.push(current);
    }
    return lines;
}

function segmentsFromGlyphs(glyphs) {
    const segments = [];
    glyphs.forEach((glyph) => {
        const last = segments[segments.length - 1];
        if (last && last.color === glyph.color) {
            last.text += glyph.ch;
        } else {
            segments.push({ text: glyph.ch, color: glyph.color });
        }
    });
    return segments;
}

function glyphCount(text) {
    return Array.from(text).length;
}

function resetLetterSpacing(ctx) {
    if ('letterSpacing' in ctx) {
        ctx.letterSpacing = '0px';
    }
}

function measureSpaced(ctx, text, spacing) {
    const count = glyphCount(text);
    return count ? ctx.measureText(text).width + spacing * (count - 1) : 0;
}

function drawSpacedSegment(ctx, text, x, y, spacing, outline) {
    if (!spacing) {
        if (outline) {
            ctx.strokeText(text, x, y);
        }
        ctx.fillText(text, x, y);
        return x + ctx.measureText(text).width;
    }
    if ('letterSpacing' in ctx) {
        const advance = ctx.measureText(text).width + spacing * glyphCount(text);
        ctx.letterSpacing = `${spacing}px`;
        if (outline) {
            ctx.strokeText(text, x, y);
        }
        ctx.fillText(text, x, y);
        ctx.letterSpacing = '0px';
        return x + advance;
    }
    let cursor = x;
    for (const glyph of text) {
        if (outline) {
            ctx.strokeText(glyph, cursor, y);
        }
        ctx.fillText(glyph, cursor, y);
        cursor += ctx.measureText(glyph).width + spacing;
    }
    return cursor;
}

function layoutText(ctx, element, resolved, showTokens) {
    ctx.font = fontString(element);
    resetLetterSpacing(ctx);
    const spacing = element.letterSpacing || 0;
    const measure = (text) => measureSpaced(ctx, text, spacing);
    const baseColor = resolveColorValue(element.color, resolved, '#FFFFFF');
    const content = substituteTokens(element.text, resolved, showTokens).replace(/\r/g, '');
    const lines = [];
    content.split('\n').forEach((paragraph) => {
        const glyphs = glyphsFromRuns(parseRuns(paragraph, baseColor, resolved, element.uppercase));
        wrapGlyphs(glyphs, element, measure).forEach((line) => lines.push(segmentsFromGlyphs(line)));
    });
    const lineHeight = element.lineHeight > 0 ? element.lineHeight : element.size * 1.2;
    const count = Math.max(1, lines.length);
    let firstCenter;
    if (element.valign === 'middle') {
        firstCenter = element.y - ((count - 1) * lineHeight) / 2;
    } else if (element.valign === 'bottom') {
        firstCenter = element.y - lineHeight / 2 - (count - 1) * lineHeight;
    } else {
        firstCenter = element.y + lineHeight / 2;
    }
    const widths = lines.map((segments) => {
        const natural = segments.reduce((sum, segment) => sum + ctx.measureText(segment.text).width, 0);
        const count = segments.reduce((sum, segment) => sum + glyphCount(segment.text), 0);
        return count ? natural + spacing * (count - 1) : 0;
    });
    const widest = widths.reduce((max, width) => Math.max(max, width), 0);
    const boxWidth = Math.max(element.width, element.wrap === 'none' ? widest : 0);
    let boxLeft = element.x;
    if (element.wrap === 'none' && widest > element.width) {
        if (element.align === 'center') {
            boxLeft = element.x + element.width / 2 - widest / 2;
        } else if (element.align === 'right') {
            boxLeft = element.x + element.width - widest;
        }
    }
    return {
        lines,
        widths,
        lineHeight,
        spacing,
        firstCenter,
        bounds: {
            x: boxLeft,
            y: firstCenter - lineHeight / 2,
            width: Math.max(4, boxWidth),
            height: count * lineHeight
        }
    };
}

function drawText(ctx, element, resolved, showTokens) {
    const laid = layoutText(ctx, element, resolved, showTokens);
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.lineJoin = element.outlineJoin || 'round';
    const outline = element.outlineWidth > 0 ? resolveColorValue(element.outlineColor, resolved, '') : '';
    if (outline) {
        ctx.strokeStyle = outline;
        ctx.lineWidth = element.outlineWidth;
    }
    laid.lines.forEach((segments, index) => {
        const total = laid.widths[index];
        let x = element.x;
        if (element.align === 'center') {
            x = element.x + element.width / 2 - total / 2;
        } else if (element.align === 'right') {
            x = element.x + element.width - total;
        }
        const y = laid.firstCenter + index * laid.lineHeight;
        segments.forEach((segment) => {
            ctx.fillStyle = segment.color;
            x = drawSpacedSegment(ctx, segment.text, x, y, laid.spacing, outline);
        });
    });
    return laid;
}

const imageCache = new Map();

function loadImage(src) {
    if (!src) {
        return Promise.resolve(null);
    }
    if (!imageCache.has(src)) {
        imageCache.set(src, new Promise((resolve) => {
            const img = new Image();
            img.onload = () => resolve(img);
            img.onerror = () => resolve(null);
            img.src = src;
        }));
    }
    return imageCache.get(src);
}

async function prepareScreenAssets(layout) {
    const fonts = new Set();
    const images = [];
    layout.elements.forEach((element) => {
        if (element.type === 'text') {
            fonts.add(fontString(element));
        } else if (element.type === 'image') {
            images.push(element.src);
        }
    });
    if (layout.background.image) {
        images.push(layout.background.image);
    }
    await Promise.all([
        ...Array.from(fonts, (font) => document.fonts.load(font).catch(() => null)),
        ...images.map(loadImage)
    ]);
    const loaded = new Map();
    for (const src of images) {
        loaded.set(src, await loadImage(src));
    }
    return loaded;
}

export async function renderScreenCanvas(layout, tokens, options = {}) {
    const screen = normalizeScreen(layout);
    const canvas = options.canvas || document.createElement('canvas');
    canvas.width = screen.width;
    canvas.height = screen.height;
    const ctx = canvas.getContext('2d');
    const images = await prepareScreenAssets(screen);
    const resolved = resolveTokens(screen, tokens);
    const showTokens = options.showTokens === true;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, screen.width, screen.height);
    ctx.fillStyle = screen.background.color;
    ctx.fillRect(0, 0, screen.width, screen.height);
    const bgImage = images.get(screen.background.image);
    if (bgImage) {
        ctx.drawImage(bgImage, 0, 0, screen.width, screen.height);
    }
    screen.elements.forEach((element) => {
        if (options.hideFlashing && element.flash) {
            return;
        }
        ctx.save();
        if (element.type === 'text') {
            drawText(ctx, element, resolved, showTokens);
        } else if (element.type === 'rect') {
            const fill = element.fill ? resolveColorValue(element.fill, resolved, '') : '';
            if (fill) {
                ctx.fillStyle = fill;
                ctx.fillRect(element.x, element.y, element.width, element.height);
            }
            if (element.strokeWidth > 0) {
                ctx.strokeStyle = resolveColorValue(element.stroke, resolved, '#FFFFFF');
                ctx.lineWidth = element.strokeWidth;
                ctx.strokeRect(element.x, element.y, element.width, element.height);
            }
        } else if (element.type === 'image') {
            const img = images.get(element.src);
            if (img) {
                ctx.drawImage(img, element.x, element.y, element.width, element.height);
            }
        }
        ctx.restore();
    });
    return canvas;
}

function canvasToImage(canvas) {
    return new Promise((resolve) => {
        const img = new Image();
        img.width = canvas.width;
        img.height = canvas.height;
        img.onload = () => resolve(img);
        img.onerror = () => resolve(img);
        img.src = canvas.toDataURL('image/png');
    });
}

export function screenHasFlashing(layout) {
    return Boolean(layout && Array.isArray(layout.elements) && layout.elements.some((element) => element.flash));
}

export async function renderScreenFrames(layout, tokens) {
    const screen = normalizeScreen(layout);
    const frames = [await canvasToImage(await renderScreenCanvas(screen, tokens))];
    if (screenHasFlashing(screen)) {
        frames.push(await canvasToImage(await renderScreenCanvas(screen, tokens, { hideFlashing: true })));
    }
    return {
        frames,
        width: screen.width,
        height: screen.height,
        flashIntervalMs: screen.flashIntervalMs,
        topLeft: screenTopLeft(screen)
    };
}

export async function screenTextLines(layout, tokens) {
    const screen = normalizeScreen(layout);
    await prepareScreenAssets(screen);
    const ctx = document.createElement('canvas').getContext('2d');
    const resolved = resolveTokens(screen, tokens);
    const out = [];
    screen.elements.forEach((element) => {
        if (element.type !== 'text') {
            return;
        }
        const laid = layoutText(ctx, element, resolved, false);
        laid.lines.forEach((segments) => out.push(segments.map((segment) => segment.text).join('')));
    });
    return out;
}

async function columnsFontSize(family, columns, targetWidth) {
    const probe = `normal 100px ${quoteFamily(family)}`;
    try {
        await document.fonts.load(probe);
    } catch (err) { }
    const ctx = document.createElement('canvas').getContext('2d');
    ctx.font = probe;
    const width = ctx.measureText('M'.repeat(columns)).width;
    return width > 0 ? 100 * (targetWidth / width) : targetWidth / columns;
}

function textElement(props) {
    return {
        id: newElementId(),
        type: 'text',
        x: 0,
        y: 0,
        width: 400,
        align: 'center',
        valign: 'middle',
        font: 'Arial',
        size: 32,
        bold: false,
        italic: false,
        color: '#FFFFFF',
        outlineColor: '#000000',
        outlineWidth: 0,
        outlineJoin: 'round',
        lineHeight: 0,
        letterSpacing: 0,
        wrap: 'none',
        columns: 32,
        uppercase: false,
        flash: false,
        text: '',
        ...props
    };
}

function baseScreen(props) {
    return {
        format: SCREEN_FORMAT,
        version: SCREEN_VERSION,
        id: null,
        name: 'Untitled Screen',
        width: 640,
        height: 480,
        background: { color: '#000000', image: '' },
        flashIntervalMs: 500,
        textEndecMode: '',
        severityColors: { ...DEFAULT_SEVERITY_COLORS },
        crawl: { enabled: true, y: 384, inset: 0 },
        elements: [],
        updated: 0,
        ...props
    };
}

async function atariTemplate() {
    const width = 640;
    const height = 480;
    const font = 'Atari 800XL';
    const size = roundTo(await columnsFontSize(font, 24, width * 0.85));
    const spacing = roundTo(height * 0.0684);
    const common = { x: 0, width, align: 'center', valign: 'middle', font, size, lineHeight: spacing, wrap: 'columns', columns: 24, uppercase: true };
    return baseScreen({
        name: 'My Atari 800XL Screen',
        width,
        height,
        background: { color: '#000000', image: '' },
        flashIntervalMs: 500,
        crawl: { enabled: false, y: 384, inset: 0 },
        elements: [
            textElement({ ...common, text: 'EMERGENCY ALERT SYSTEM', y: roundTo(height * 0.1175), color: '#A57E42', wrap: 'none' }),
            textElement({ ...common, text: '{EVENT}', y: roundTo(height * 0.3867), color: SEVERITY_TOKEN, flash: true }),
            textElement({ ...common, text: 'FOR {LOCATIONS}\nUNTIL {COLOR:#A57E42}{UNTIL}.', y: roundTo(height * 0.6433), color: '#FFFFFF' }),
            textElement({ ...common, text: '{SENDER}', y: roundTo(height * 0.8339), color: '#A57E42', wrap: 'none' })
        ]
    });
}

function easyplusTemplate(gray) {
    const width = 1920;
    const height = 1080;
    const scale = 84 / 36;
    const center = height / 2;
    const offsets = gray
        ? { headline: -173, originator: -100, issued: -30, linesStart: 40 }
        : { headline: -173, originator: -70, issued: -3, linesStart: 60 };
    const common = {
        x: 0,
        width,
        align: 'center',
        valign: 'middle',
        font: 'VCREAS_4.5',
        size: 84,
        lineHeight: 120,
        wrap: 'none',
        color: gray ? '#FFFFFF' : '#ABABAB',
        outlineColor: '#000000',
        outlineWidth: gray ? 5 : 0,
        outlineJoin: 'miter'
    };
    return baseScreen({
        name: gray ? 'My EASyPLUS Gray Screen' : 'My EASyPLUS Screen',
        width,
        height,
        background: { color: gray ? '#ABABAB' : '#000000', image: '' },
        crawl: { enabled: true, y: gray ? 720 : 175, inset: 0 },
        elements: [
            textElement({ ...common, text: '{HEADLINE}', y: roundTo(center + offsets.headline * scale) }),
            textElement({ ...common, text: '{ORIGINATOR}', y: roundTo(center + offsets.originator * scale) }),
            textElement({ ...common, text: 'Issued {ARTICLE}', y: roundTo(center + offsets.issued * scale) }),
            textElement({
                ...common,
                text: '{EVENT}',
                x: width / 4 - 75,
                width: width / 2 + 150,
                valign: 'top',
                wrap: 'width',
                y: roundTo(center + offsets.linesStart * scale - 60)
            })
        ]
    });
}

async function eas1cgTemplate() {
    const width = 640;
    const height = 480;
    const font = 'EAS-1CG Neue';
    const safeLeft = width * 0.1;
    const safeTop = height * 0.1;
    const safeWidth = width - safeLeft * 2;
    const size = roundTo(await columnsFontSize(font, 31, safeWidth));
    return baseScreen({
        name: 'My EAS-1CG Screen',
        width,
        height,
        textEndecMode: 'GORMAN',
        background: { color: '#545454', image: '' },
        crawl: { enabled: false, y: 384, inset: 0 },
        elements: [
            textElement({
                text: '***EMERGENCY DETAILS Page 1***\n{TEXT}',
                x: safeLeft,
                y: safeTop,
                width: safeWidth,
                align: 'left',
                valign: 'top',
                font,
                size,
                lineHeight: (height - safeTop * 2) / 8,
                wrap: 'columns',
                columns: 31,
                color: '#FFFFFF',
                outlineColor: '#000000',
                outlineWidth: 2
            })
        ]
    });
}

const DASDEC_BACKGROUND_URL = new URL('../screens/dasdec.png', import.meta.url).href;
const DASDEC_SAFE_MARGIN = 16;
const DASDEC_TITLE = 'Emergency Alert System';

async function assetDataUrl(url) {
    try {
        const response = await fetch(url);
        if (!response.ok) {
            return '';
        }
        return sanitizeImageSource(await readFileAsDataUrl(await response.blob()));
    } catch (err) {
        return '';
    }
}

async function dasdecTemplate() {
    const width = 640;
    const height = 480;
    const size = 25;
    const textWidth = 576;
    return baseScreen({
        name: 'My DASDEC Screen',
        width,
        height,
        textEndecMode: 'DAS2PLUS',
        background: { color: '#454563', image: await assetDataUrl(DASDEC_BACKGROUND_URL) },
        crawl: { enabled: false, y: 384, inset: 0 },
        elements: [
            textElement({
                text: '{TEXT}',
                x: (width - textWidth) / 2,
                y: 53,
                width: textWidth,
                align: 'center',
                valign: 'top',
                font: 'Luxi Mono',
                size,
                letterSpacing: 0,
                lineHeight: 34,
                wrap: 'width'
            })
        ]
    });
}

function dasdecVariantTemplate(blue) {
    const width = 640;
    const height = 480;
    const font = blue ? 'Arial Bold' : 'Luxi Mono';
    const lineHeight = blue ? 31 : 30;
    const common = { x: 0, width, align: 'center', valign: 'middle', font, size: 25, wrap: 'none' };
    const body = blue
        ? { x: 32, width: 576, wrap: 'width' }
        : { x: DASDEC_SAFE_MARGIN, width: width - DASDEC_SAFE_MARGIN * 2, wrap: 'columns', columns: 36 };
    return baseScreen({
        name: blue ? 'My DASDEC (Blue) Screen' : 'My DASDEC (Black) Screen',
        width,
        height,
        textEndecMode: 'DAS2PLUS',
        background: { color: blue ? '#0000FF' : '#000000', image: '' },
        crawl: { enabled: false, y: 384, inset: 0 },
        elements: [
            textElement({ ...common, text: DASDEC_TITLE, y: blue ? 33 : 77 }),
            textElement({ ...common, ...body, text: '{TEXT}', valign: 'top', lineHeight, y: (blue ? 77 : 112) - lineHeight / 2 }),
            textElement({ ...common, text: '1/1', y: blue ? 453 : 450 })
        ]
    });
}

export async function createScreenTemplate(kind) {
    let layout;
    if (kind === 'atari_800xl') {
        layout = await atariTemplate();
    } else if (kind === 'easyplus' || kind === 'easyplus_gray') {
        layout = easyplusTemplate(kind === 'easyplus_gray');
    } else if (kind === 'eas_1cg') {
        layout = await eas1cgTemplate();
    } else if (kind === 'dasdec') {
        layout = await dasdecTemplate();
    } else if (kind === 'dasdec_black' || kind === 'dasdec_blue') {
        layout = dasdecVariantTemplate(kind === 'dasdec_blue');
    } else {
        layout = baseScreen({
            name: 'My Screen',
            elements: [
                textElement({ text: 'EMERGENCY ALERT SYSTEM', x: 0, y: 60, width: 640, size: 36, color: '#FFFFFF' }),
                textElement({ text: '{EVENT}', x: 0, y: 200, width: 640, size: 40, color: SEVERITY_TOKEN, wrap: 'width', uppercase: true, flash: true })
            ]
        });
    }
    return normalizeScreen(layout);
}

export function templateChoices() {
    return TEMPLATE_CHOICES.slice();
}

function elementLabel(element, index) {
    const position = `${index + 1}.`;
    if (element.type === 'text') {
        const preview = element.text.replace(/\s+/g, ' ').trim().slice(0, 32) || '(empty)';
        return `${position} Text: ${preview}${element.flash ? ' (flashing)' : ''}`;
    }
    if (element.type === 'rect') {
        return `${position} Box ${Math.round(element.width)}x${Math.round(element.height)} at ${Math.round(element.x)}, ${Math.round(element.y)}${element.flash ? ' (flashing)' : ''}`;
    }
    return `${position} Image ${Math.round(element.width)}x${Math.round(element.height)} at ${Math.round(element.x)}, ${Math.round(element.y)}${element.flash ? ' (flashing)' : ''}`;
}

function readFileAsDataUrl(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ''));
        reader.onerror = () => reject(reader.error || new Error('Could not read the file.'));
        reader.readAsDataURL(file);
    });
}

function readFileAsText(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ''));
        reader.onerror = () => reject(reader.error || new Error('Could not read the file.'));
        reader.readAsText(file);
    });
}

function ensureStylesheet() {
    if (document.getElementById('sb-stylesheet')) {
        return;
    }
    const link = document.createElement('link');
    link.id = 'sb-stylesheet';
    link.rel = 'stylesheet';
    link.href = new URL('../css/crawl-screen-builder.css', import.meta.url).href;
    document.head.appendChild(link);
}

function el(tag, attrs = {}, children = []) {
    const node = document.createElement(tag);
    Object.entries(attrs).forEach(([key, value]) => {
        if (value === undefined || value === null || value === false) {
            return;
        }
        if (key === 'text') {
            node.textContent = value;
        } else if (key === 'className') {
            node.className = value;
        } else if (value === true) {
            node.setAttribute(key, '');
        } else {
            node.setAttribute(key, String(value));
        }
    });
    children.forEach((child) => {
        if (child) {
            node.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
        }
    });
    return node;
}

function slugify(name) {
    return String(name || 'screen').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'screen';
}

let builderInstance = null;

function createBuilder() {
    ensureStylesheet();
    const state = {
        layout: null,
        selectedId: null,
        options: {},
        tokens: {},
        tokenCache: new Map(),
        renderToken: 0,
        renderScheduled: false,
        returnFocus: null,
        drag: null,
        deleteArmed: false,
        offscreen: document.createElement('canvas'),
        lastLayout: new Map()
    };

    const backdrop = el('div', { className: 'sb-backdrop', hidden: true });
    const modal = el('div', {
        className: 'sb-modal',
        role: 'dialog',
        'aria-modal': 'true',
        'aria-labelledby': 'sb-title',
        'aria-describedby': 'sb-intro'
    });
    const title = el('h3', { id: 'sb-title', text: 'EAS Screen Builder' });
    const intro = el('p', {
        id: 'sb-intro',
        className: 'sb-intro',
        text: 'Design a full alert screen, with or without the scrolling crawl. Text can use tokens such as {EVENT} or {LOCATIONS}, which are filled from the EAS header when the screen is used. Screens are saved in this browser and can be exported as .json.'
    });

    const nameInput = el('input', { id: 'sb-name', type: 'text', maxlength: '80', autocomplete: 'off' });
    const startSelect = el('select', { id: 'sb-start' });
    const startButton = el('button', { type: 'button', id: 'sb-start-btn', text: 'Start From This' });
    const importButton = el('button', { type: 'button', id: 'sb-import', text: 'Import .json' });
    const importFile = el('input', { type: 'file', id: 'sb-import-file', accept: '.json,application/json', hidden: true, tabindex: '-1', 'aria-hidden': 'true' });
    const exportButton = el('button', { type: 'button', id: 'sb-export', text: 'Export .json' });
    const toolbar = el('div', { className: 'sb-toolbar' }, [
        el('span', { className: 'sb-field' }, [el('label', { for: 'sb-name', text: 'Screen name:' }), nameInput]),
        el('span', { className: 'sb-field' }, [el('label', { for: 'sb-start', text: 'Start from:' }), startSelect, startButton]),
        el('span', { className: 'sb-field' }, [importButton, importFile, exportButton])
    ]);

    const canvas = el('canvas', {
        id: 'sb-canvas',
        className: 'sb-canvas',
        tabindex: '0',
        role: 'application',
        'aria-roledescription': 'screen layout',
        'aria-label': 'Screen preview. Click or tap an element to select it and drag to move it. With this focused, the arrow keys move the selected element one pixel, or ten with Shift.',
        'aria-describedby': 'sb-selection-note'
    });
    const selectionNote = el('p', { id: 'sb-selection-note', className: 'sb-note', 'aria-live': 'polite' });
    const showTokens = el('input', { type: 'checkbox', id: 'sb-show-tokens' });
    const showFlashOff = el('input', { type: 'checkbox', id: 'sb-show-flash-off' });
    const showCrawl = el('input', { type: 'checkbox', id: 'sb-show-crawl', checked: true });
    const stage = el('div', { className: 'sb-stage' }, [
        el('div', { className: 'sb-canvas-wrap' }, [canvas]),
        selectionNote,
        el('div', { className: 'sb-stage-options' }, [
            el('span', {}, [showTokens, el('label', { for: 'sb-show-tokens', text: ' Show token names' })]),
            el('span', {}, [showFlashOff, el('label', { for: 'sb-show-flash-off', text: ' Show the flash-off frame' })]),
            el('span', {}, [showCrawl, el('label', { for: 'sb-show-crawl', text: ' Outline the crawl area' })])
        ])
    ]);

    const elementList = el('select', { id: 'sb-element-list', size: '8' });
    const addTextButton = el('button', { type: 'button', id: 'sb-add-text', text: 'Add Text' });
    const addBoxButton = el('button', { type: 'button', id: 'sb-add-box', text: 'Add Box' });
    const addImageButton = el('button', { type: 'button', id: 'sb-add-image', text: 'Add Image' });
    const addImageFile = el('input', { type: 'file', id: 'sb-add-image-file', accept: 'image/*', hidden: true, tabindex: '-1', 'aria-hidden': 'true' });
    const duplicateButton = el('button', { type: 'button', id: 'sb-duplicate', text: 'Duplicate' });
    const upButton = el('button', { type: 'button', id: 'sb-move-up', text: 'Move Up' });
    const downButton = el('button', { type: 'button', id: 'sb-move-down', text: 'Move Down' });
    const deleteElementButton = el('button', { type: 'button', id: 'sb-delete-element', text: 'Delete' });
    const elementsField = el('fieldset', { className: 'sb-fieldset' }, [
        el('legend', { text: 'Elements' }),
        el('label', { for: 'sb-element-list', text: 'Drawn first to last; later elements sit on top:' }),
        elementList,
        el('div', { className: 'sb-buttons' }, [addTextButton, addBoxButton, addImageButton, addImageFile, duplicateButton, upButton, downButton, deleteElementButton])
    ]);

    const propsBody = el('div', { id: 'sb-props-body', className: 'sb-grid' });
    const propsField = el('fieldset', { className: 'sb-fieldset', id: 'sb-props' }, [
        el('legend', { id: 'sb-props-legend', text: 'Selected element' }),
        propsBody
    ]);

    const screenBody = el('div', { className: 'sb-grid' });
    const screenField = el('fieldset', { className: 'sb-fieldset' }, [el('legend', { text: 'Screen' }), screenBody]);
    const crawlBody = el('div', { className: 'sb-grid' });
    const crawlField = el('fieldset', { className: 'sb-fieldset' }, [el('legend', { text: 'Scrolling crawl' }), crawlBody]);

    const tokenList = el('ul', { className: 'sb-token-list' });
    SCREEN_TOKENS.forEach((token) => {
        tokenList.appendChild(el('li', {}, [el('code', { text: `{${token.name}}` }), ` ${token.description}`]));
    });
    tokenList.appendChild(el('li', {}, [el('code', { text: '{COLOR:#RRGGBB}' }), ' switches the text color until the end of the line; ', el('code', { text: '{COLOR}' }), ' switches back']));
    const tokenHelp = el('details', { className: 'sb-tokens' }, [el('summary', { text: 'Tokens you can use in text' }), tokenList]);

    const side = el('div', { className: 'sb-side' }, [elementsField, propsField, screenField, crawlField, tokenHelp]);
    const body = el('div', { className: 'sb-body' }, [stage, side]);

    const status = el('span', { id: 'sb-status', className: 'sb-status', role: 'status', 'aria-live': 'polite' });
    const useButton = el('button', { type: 'button', id: 'sb-use', text: 'Use This Screen' });
    const saveButton = el('button', { type: 'button', id: 'sb-save', text: 'Save' });
    const deleteScreenButton = el('button', { type: 'button', id: 'sb-delete-screen', text: 'Delete Saved Screen' });
    const closeButton = el('button', { type: 'button', id: 'sb-close', text: 'Close' });
    const actions = el('div', { className: 'sb-actions' }, [status, useButton, saveButton, deleteScreenButton, closeButton]);

    modal.appendChild(title);
    modal.appendChild(intro);
    modal.appendChild(toolbar);
    modal.appendChild(body);
    modal.appendChild(actions);
    backdrop.appendChild(modal);
    document.body.appendChild(backdrop);

    const setStatus = (message) => {
        status.textContent = message || '';
    };

    const selected = () => (state.layout ? state.layout.elements.find((element) => element.id === state.selectedId) || null : null);

    const markEdited = () => {
        state.deleteArmed = false;
        deleteScreenButton.textContent = 'Delete Saved Screen';
    };

    function populateStartSelect() {
        const current = startSelect.value;
        startSelect.textContent = '';
        const builtIn = el('optgroup', { label: 'Templates' });
        TEMPLATE_CHOICES.forEach((choice) => builtIn.appendChild(new Option(choice.label, `template:${choice.value}`)));
        startSelect.appendChild(builtIn);
        const saved = listScreens();
        if (saved.length) {
            const group = el('optgroup', { label: 'Saved screens' });
            saved.forEach((entry) => group.appendChild(new Option(entry.name, `saved:${entry.id}`)));
            startSelect.appendChild(group);
        }
        if (Array.from(startSelect.options).some((option) => option.value === current)) {
            startSelect.value = current;
        }
    }

    function refreshElementList() {
        const layout = state.layout;
        elementList.textContent = '';
        layout.elements.forEach((element, index) => {
            const option = new Option(elementLabel(element, index), element.id);
            elementList.appendChild(option);
        });
        if (state.selectedId && layout.elements.some((element) => element.id === state.selectedId)) {
            elementList.value = state.selectedId;
        } else {
            state.selectedId = null;
            elementList.selectedIndex = -1;
        }
        const index = layout.elements.findIndex((element) => element.id === state.selectedId);
        duplicateButton.disabled = index < 0;
        deleteElementButton.disabled = index < 0;
        upButton.disabled = index <= 0;
        downButton.disabled = index < 0 || index >= layout.elements.length - 1;
    }

    function updateSelectedOptionLabel() {
        const index = state.layout.elements.findIndex((element) => element.id === state.selectedId);
        if (index >= 0 && elementList.options[index]) {
            elementList.options[index].text = elementLabel(state.layout.elements[index], index);
        }
    }

    function describeSelection() {
        const element = selected();
        if (!element) {
            selectionNote.textContent = 'No element selected.';
            return;
        }
        const index = state.layout.elements.indexOf(element);
        selectionNote.textContent = `${elementLabel(element, index)}, at X ${Math.round(element.x)}, Y ${Math.round(element.y)}.`;
    }

    function field(id, labelText, input) {
        input.id = id;
        return [el('label', { for: id, text: labelText }), input];
    }

    function numberInput(value, { min, max, step = 1 } = {}) {
        return el('input', { type: 'number', value: String(value), min, max, step: String(step) });
    }

    function checkInput(value) {
        const input = el('input', { type: 'checkbox' });
        input.checked = Boolean(value);
        return input;
    }

    function selectInput(value, choices) {
        const select = el('select');
        choices.forEach(([optionValue, label]) => select.appendChild(new Option(label, optionValue)));
        if (Array.from(select.options).some((option) => option.value === value)) {
            select.value = value;
        } else {
            select.appendChild(new Option(value, value));
            select.value = value;
        }
        return select;
    }

    function colorInput(value) {
        const input = el('input', { type: 'color' });
        input.value = HEX_COLOR.test(value || '') && /^#[0-9a-f]{6}$/i.test(value) ? value.toLowerCase() : '#ffffff';
        return input;
    }

    function bindNumber(input, target, key, { min = -Infinity, max = Infinity, after } = {}) {
        input.addEventListener('input', () => {
            const parsed = Number(input.value);
            if (!Number.isFinite(parsed)) {
                return;
            }
            target[key] = Math.min(max, Math.max(min, parsed));
            if (after) after();
            changed();
        });
    }

    function bindCheck(input, target, key, after) {
        input.addEventListener('change', () => {
            target[key] = input.checked;
            if (after) after();
            changed();
        });
    }

    function bindValue(input, target, key, after) {
        const handler = () => {
            target[key] = input.value;
            if (after) after();
            changed();
        };
        input.addEventListener('input', handler);
        input.addEventListener('change', handler);
    }

    function fontChoices() {
        const fonts = (state.options.fonts || []).map((font) => [font.value, font.label || font.value]);
        if (!fonts.length) {
            return [['Arial', 'Arial']];
        }
        return fonts;
    }

    function colorWithSeverity(prefix, labelText, target, key, { allowNone = false } = {}) {
        const nodes = [];
        const picker = colorInput(target[key] && target[key] !== SEVERITY_TOKEN ? target[key] : '#ffffff');
        const severity = checkInput(target[key] === SEVERITY_TOKEN);
        const none = allowNone ? checkInput(target[key] === '') : null;
        const sync = () => {
            picker.disabled = severity.checked || Boolean(none && none.checked);
            severity.disabled = Boolean(none && none.checked);
        };
        const apply = () => {
            if (none && none.checked) {
                target[key] = '';
            } else if (severity.checked) {
                target[key] = SEVERITY_TOKEN;
            } else {
                target[key] = picker.value.toUpperCase();
            }
            sync();
            changed();
        };
        picker.addEventListener('input', apply);
        severity.addEventListener('change', apply);
        if (none) none.addEventListener('change', apply);
        sync();
        nodes.push(...field(`${prefix}`, labelText, picker));
        const extra = el('span', { className: 'sb-inline' });
        severity.id = `${prefix}-severity`;
        extra.appendChild(severity);
        extra.appendChild(el('label', { for: severity.id, text: ' Color by severity' }));
        if (none) {
            none.id = `${prefix}-none`;
            extra.appendChild(none);
            extra.appendChild(el('label', { for: none.id, text: ' None' }));
        }
        nodes.push(el('span', { className: 'sb-spacer' }), extra);
        return nodes;
    }

    function renderProps() {
        propsBody.textContent = '';
        const element = selected();
        const legend = document.getElementById('sb-props-legend');
        if (!element) {
            legend.textContent = 'Selected element';
            propsBody.appendChild(el('p', { className: 'sb-note', text: 'Select an element in the list or on the preview to edit it.' }));
            return;
        }
        legend.textContent = element.type === 'text' ? 'Selected text' : (element.type === 'rect' ? 'Selected box' : 'Selected image');
        const add = (nodes) => nodes.forEach((node) => propsBody.appendChild(node));
        const relabel = () => {
            updateSelectedOptionLabel();
            describeSelection();
        };

        if (element.type === 'text') {
            const textArea = el('textarea', { rows: '3' });
            textArea.value = element.text;
            bindValue(textArea, element, 'text', relabel);
            add(field('sb-prop-text', 'Text:', textArea));
        }

        const xInput = numberInput(roundTo(element.x, 2), { min: -10000, max: 10000 });
        bindNumber(xInput, element, 'x', { min: -10000, max: 10000, after: describeSelection });
        add(field('sb-prop-x', 'X:', xInput));
        const yInput = numberInput(roundTo(element.y, 2), { min: -10000, max: 10000 });
        bindNumber(yInput, element, 'y', { min: -10000, max: 10000, after: describeSelection });
        add(field('sb-prop-y', element.type === 'text' ? 'Y (see vertical anchor):' : 'Y:', yInput));
        const widthInput = numberInput(roundTo(element.width, 2), { min: 0, max: 20000 });
        bindNumber(widthInput, element, 'width', { min: 0, max: 20000, after: relabel });
        add(field('sb-prop-width', element.type === 'text' ? 'Box width (for alignment and wrapping):' : 'Width:', widthInput));

        if (element.type !== 'text') {
            const heightInput = numberInput(roundTo(element.height, 2), { min: 0, max: 20000 });
            bindNumber(heightInput, element, 'height', { min: 0, max: 20000, after: relabel });
            add(field('sb-prop-height', 'Height:', heightInput));
        }

        if (element.type === 'text') {
            add(field('sb-prop-align', 'Horizontal alignment:', (() => {
                const select = selectInput(element.align, [['left', 'Left'], ['center', 'Center'], ['right', 'Right']]);
                bindValue(select, element, 'align');
                return select;
            })()));
            add(field('sb-prop-valign', 'Vertical anchor (what Y points at):', (() => {
                const select = selectInput(element.valign, [['top', 'Top of the text'], ['middle', 'Middle of the text'], ['bottom', 'Bottom of the text']]);
                bindValue(select, element, 'valign');
                return select;
            })()));
            add(field('sb-prop-font', 'Font:', (() => {
                const select = selectInput(element.font, fontChoices());
                bindValue(select, element, 'font');
                return select;
            })()));
            const sizeInput = numberInput(roundTo(element.size, 2), { min: 1, max: 1000, step: 'any' });
            bindNumber(sizeInput, element, 'size', { min: 1, max: 1000 });
            add(field('sb-prop-size', 'Size (pixels):', sizeInput));
            const lineInput = numberInput(roundTo(element.lineHeight, 2), { min: 0, max: 4000, step: 'any' });
            bindNumber(lineInput, element, 'lineHeight', { min: 0, max: 4000 });
            add(field('sb-prop-line-height', 'Line spacing (pixels, 0 = automatic):', lineInput));
            const letterInput = numberInput(roundTo(element.letterSpacing || 0, 2), { min: -100, max: 1000, step: 'any' });
            bindNumber(letterInput, element, 'letterSpacing', { min: -100, max: 1000 });
            add(field('sb-prop-letter-spacing', 'Letter spacing (extra pixels between characters):', letterInput));
            const bold = checkInput(element.bold);
            bindCheck(bold, element, 'bold');
            add(field('sb-prop-bold', 'Bold:', bold));
            const italic = checkInput(element.italic);
            bindCheck(italic, element, 'italic');
            add(field('sb-prop-italic', 'Italic:', italic));
            const upper = checkInput(element.uppercase);
            bindCheck(upper, element, 'uppercase');
            add(field('sb-prop-uppercase', 'All capitals:', upper));
            add(colorWithSeverity('sb-prop-color', 'Color:', element, 'color'));
            const outlineColor = colorInput(element.outlineColor);
            outlineColor.addEventListener('input', () => {
                element.outlineColor = outlineColor.value.toUpperCase();
                changed();
            });
            add(field('sb-prop-outline-color', 'Outline color:', outlineColor));
            const outlineWidth = numberInput(element.outlineWidth, { min: 0, max: 50, step: 'any' });
            bindNumber(outlineWidth, element, 'outlineWidth', { min: 0, max: 50 });
            add(field('sb-prop-outline-width', 'Outline width (pixels):', outlineWidth));
            add(field('sb-prop-outline-join', 'Outline corners:', (() => {
                const select = selectInput(element.outlineJoin, [['round', 'Round'], ['bevel', 'Bevel'], ['miter', 'Miter (sharp)']]);
                bindValue(select, element, 'outlineJoin');
                return select;
            })()));
            const columnsInput = numberInput(element.columns, { min: 1, max: 500 });
            const wrapSelect = selectInput(element.wrap, [['none', 'Do not wrap'], ['width', 'Wrap at the box width'], ['columns', 'Wrap at a number of characters']]);
            const syncColumns = () => {
                columnsInput.disabled = element.wrap !== 'columns';
            };
            bindValue(wrapSelect, element, 'wrap', syncColumns);
            bindNumber(columnsInput, element, 'columns', { min: 1, max: 500 });
            add(field('sb-prop-wrap', 'Wrapping:', wrapSelect));
            add(field('sb-prop-columns', 'Characters per line:', columnsInput));
            syncColumns();
        }

        if (element.type === 'rect') {
            add(colorWithSeverity('sb-prop-fill', 'Fill:', element, 'fill', { allowNone: true }));
            const stroke = colorInput(element.stroke);
            stroke.addEventListener('input', () => {
                element.stroke = stroke.value.toUpperCase();
                changed();
            });
            add(field('sb-prop-stroke', 'Border color:', stroke));
            const strokeWidth = numberInput(element.strokeWidth, { min: 0, max: 500, step: 'any' });
            bindNumber(strokeWidth, element, 'strokeWidth', { min: 0, max: 500 });
            add(field('sb-prop-stroke-width', 'Border width (pixels, 0 = none):', strokeWidth));
        }

        if (element.type === 'image') {
            const replace = el('button', { type: 'button', text: 'Replace Image' });
            replace.addEventListener('click', () => {
                addImageFile.dataset.mode = 'replace';
                addImageFile.value = '';
                addImageFile.click();
            });
            add(field('sb-prop-replace', 'Image file:', replace));
        }

        const flash = checkInput(element.flash);
        bindCheck(flash, element, 'flash', relabel);
        add(field('sb-prop-flash', 'Flash on and off:', flash));
    }

    function renderScreenFields() {
        screenBody.textContent = '';
        crawlBody.textContent = '';
        const layout = state.layout;
        const add = (target, nodes) => nodes.forEach((node) => target.appendChild(node));
        const widthInput = numberInput(layout.width, { min: 16, max: 3840, step: 2 });
        widthInput.addEventListener('change', () => {
            layout.width = evenDimension(widthInput.value, 16, 3840, layout.width);
            widthInput.value = String(layout.width);
            changed();
        });
        add(screenBody, field('sb-screen-width', 'Width (pixels):', widthInput));
        const heightInput = numberInput(layout.height, { min: 16, max: 2160, step: 2 });
        heightInput.addEventListener('change', () => {
            layout.height = evenDimension(heightInput.value, 16, 2160, layout.height);
            heightInput.value = String(layout.height);
            changed();
        });
        add(screenBody, field('sb-screen-height', 'Height (pixels):', heightInput));
        const bgColor = colorInput(layout.background.color);
        bgColor.addEventListener('input', () => {
            layout.background.color = bgColor.value.toUpperCase();
            changed();
        });
        add(screenBody, field('sb-screen-bg', 'Background color:', bgColor));
        const bgImageButton = el('button', { type: 'button', text: layout.background.image ? 'Replace Image' : 'Choose Image' });
        bgImageButton.addEventListener('click', () => {
            addImageFile.dataset.mode = 'background';
            addImageFile.value = '';
            addImageFile.click();
        });
        const bgClear = el('button', { type: 'button', id: 'sb-screen-bg-clear', text: 'Remove Image', disabled: !layout.background.image });
        bgClear.addEventListener('click', () => {
            layout.background.image = '';
            renderScreenFields();
            changed();
            bgImageButton.focus();
        });
        add(screenBody, field('sb-screen-bg-image', 'Background image (stretched to fit):', bgImageButton));
        add(screenBody, [el('span', { className: 'sb-spacer' }), bgClear]);
        const flashInput = numberInput(layout.flashIntervalMs, { min: 100, max: 10000, step: 50 });
        bindNumber(flashInput, layout, 'flashIntervalMs', { min: 100, max: 10000 });
        add(screenBody, field('sb-screen-flash', 'Flash interval (milliseconds):', flashInput));
        const modes = (state.options.endecModes || []).map((mode) => [mode, mode]);
        const textMode = selectInput(layout.textEndecMode || '', [['', 'Same as the crawl'], ...modes]);
        bindValue(textMode, layout, 'textEndecMode');
        add(screenBody, field('sb-screen-text-mode', 'ENDEC wording for {TEXT}:', textMode));
        [['warning', 'Warning color:'], ['watch', 'Watch color:'], ['advisory', 'Advisory/other color:']].forEach(([key, label]) => {
            const input = colorInput(layout.severityColors[key]);
            input.addEventListener('input', () => {
                layout.severityColors[key] = input.value.toUpperCase();
                changed();
            });
            add(screenBody, field(`sb-screen-severity-${key}`, label, input));
        });

        const enabled = checkInput(layout.crawl.enabled);
        const crawlY = numberInput(layout.crawl.y, { min: 0, max: layout.height });
        const inset = numberInput(layout.crawl.inset, { min: 0, max: 500 });
        const syncCrawl = () => {
            crawlY.disabled = !layout.crawl.enabled;
            inset.disabled = !layout.crawl.enabled;
        };
        bindCheck(enabled, layout.crawl, 'enabled', syncCrawl);
        bindNumber(crawlY, layout.crawl, 'y', { min: 0, max: 2160 });
        bindNumber(inset, layout.crawl, 'inset', { min: 0, max: 500 });
        add(crawlBody, field('sb-crawl-enabled', 'Show the scrolling crawl on this screen:', enabled));
        add(crawlBody, field('sb-crawl-y', 'Crawl top (Y, pixels):', crawlY));
        add(crawlBody, field('sb-crawl-inset', 'Crawl side inset (pixels):', inset));
        crawlBody.appendChild(el('p', { className: 'sb-note sb-wide', text: 'The crawl keeps the font, color and speed from the main crawl settings.' }));
        syncCrawl();
    }

    function changed() {
        markEdited();
        scheduleRender();
    }

    async function tokensFor(mode) {
        const key = mode || '';
        if (!state.tokenCache.has(key)) {
            let tokens = {};
            try {
                tokens = state.options.getPreviewTokens ? await state.options.getPreviewTokens({ textEndecMode: key }) : {};
            } catch (err) {
                tokens = {};
            }
            state.tokenCache.set(key, tokens || {});
        }
        state.tokens = state.tokenCache.get(key);
        return state.tokens;
    }

    function scheduleRender() {
        if (state.renderScheduled) {
            return;
        }
        state.renderScheduled = true;
        requestAnimationFrame(() => {
            state.renderScheduled = false;
            renderPreview();
        });
    }

    async function renderPreview() {
        if (!state.layout) {
            return;
        }
        const token = ++state.renderToken;
        let screen;
        try {
            screen = normalizeScreen(state.layout);
        } catch (err) {
            setStatus(err.message);
            return;
        }
        await tokensFor(screen.textEndecMode);
        if (token !== state.renderToken) {
            return;
        }
        const offscreen = await renderScreenCanvas(screen, state.tokens, {
            canvas: state.offscreen,
            showTokens: showTokens.checked,
            hideFlashing: showFlashOff.checked
        });
        if (token !== state.renderToken) {
            return;
        }
        const ctx = canvas.getContext('2d');
        if (canvas.width !== screen.width || canvas.height !== screen.height) {
            canvas.width = screen.width;
            canvas.height = screen.height;
        }
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(offscreen, 0, 0);
        const scale = Math.max(1, screen.width / Math.max(1, canvas.clientWidth || screen.width));
        if (showCrawl.checked && screen.crawl.enabled) {
            const bandHeight = Math.max(4, Number(state.options.crawlBandHeight ? state.options.crawlBandHeight() : 34) || 34);
            ctx.save();
            ctx.fillStyle = 'rgba(255, 120, 0, 0.18)';
            ctx.fillRect(screen.crawl.inset, screen.crawl.y, screen.width - screen.crawl.inset * 2, bandHeight);
            ctx.strokeStyle = 'rgba(255, 120, 0, 0.9)';
            ctx.lineWidth = scale;
            ctx.setLineDash([6 * scale, 4 * scale]);
            ctx.strokeRect(screen.crawl.inset, screen.crawl.y, screen.width - screen.crawl.inset * 2, bandHeight);
            ctx.fillStyle = 'rgba(255, 120, 0, 0.95)';
            ctx.font = `${12 * scale}px sans-serif`;
            ctx.textBaseline = 'top';
            ctx.fillText('CRAWL', screen.crawl.inset + 4 * scale, screen.crawl.y + 2 * scale);
            ctx.restore();
        }
        const element = selected();
        if (element) {
            const box = elementBounds(screen, element.id);
            if (box) {
                ctx.save();
                ctx.strokeStyle = '#00E5FF';
                ctx.lineWidth = 2 * scale;
                ctx.setLineDash([5 * scale, 3 * scale]);
                ctx.strokeRect(box.x, box.y, box.width, box.height);
                ctx.restore();
            }
        }
    }

    function elementBounds(screen, id) {
        const element = screen.elements.find((entry) => entry.id === id);
        if (!element) {
            return null;
        }
        if (element.type !== 'text') {
            return { x: element.x, y: element.y, width: Math.max(4, element.width), height: Math.max(4, element.height) };
        }
        const ctx = state.offscreen.getContext('2d');
        ctx.save();
        const laid = layoutText(ctx, element, resolveTokens(screen, state.tokens), showTokens.checked);
        ctx.restore();
        return laid.bounds;
    }

    function hitTest(x, y) {
        const screen = normalizeScreen(state.layout);
        for (let i = screen.elements.length - 1; i >= 0; i--) {
            const box = elementBounds(screen, screen.elements[i].id);
            if (box && x >= box.x && x <= box.x + box.width && y >= box.y && y <= box.y + box.height) {
                return screen.elements[i].id;
            }
        }
        return null;
    }

    function selectElement(id, { focusList = false } = {}) {
        state.selectedId = id;
        refreshElementList();
        renderProps();
        describeSelection();
        scheduleRender();
        if (focusList) {
            elementList.focus();
        }
    }

    function syncPositionFields(element) {
        const xInput = document.getElementById('sb-prop-x');
        const yInput = document.getElementById('sb-prop-y');
        if (xInput) xInput.value = String(roundTo(element.x, 2));
        if (yInput) yInput.value = String(roundTo(element.y, 2));
        updateSelectedOptionLabel();
    }

    function canvasPoint(event) {
        const rect = canvas.getBoundingClientRect();
        const sx = canvas.width / Math.max(1, rect.width);
        const sy = canvas.height / Math.max(1, rect.height);
        return { x: (event.clientX - rect.left) * sx, y: (event.clientY - rect.top) * sy };
    }

    canvas.addEventListener('pointerdown', (event) => {
        if (!state.layout) return;
        canvas.focus();
        const point = canvasPoint(event);
        const id = hitTest(point.x, point.y);
        selectElement(id);
        const element = selected();
        if (!element) return;
        state.drag = { id, startX: point.x, startY: point.y, originX: element.x, originY: element.y, pointerId: event.pointerId };
        try {
            canvas.setPointerCapture(event.pointerId);
        } catch (err) { }
        event.preventDefault();
    });

    canvas.addEventListener('pointermove', (event) => {
        if (!state.drag) return;
        const element = selected();
        if (!element || element.id !== state.drag.id) return;
        const point = canvasPoint(event);
        element.x = Math.round(state.drag.originX + point.x - state.drag.startX);
        element.y = Math.round(state.drag.originY + point.y - state.drag.startY);
        syncPositionFields(element);
        changed();
    });

    const endDrag = () => {
        if (!state.drag) return;
        state.drag = null;
        describeSelection();
    };
    canvas.addEventListener('pointerup', endDrag);
    canvas.addEventListener('pointercancel', endDrag);

    canvas.addEventListener('keydown', (event) => {
        const element = selected();
        const moves = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
        if (!moves[event.key]) return;
        event.preventDefault();
        if (!element) {
            selectionNote.textContent = 'Select an element in the Elements list first.';
            return;
        }
        const step = event.shiftKey ? 10 : 1;
        element.x = Math.round(element.x + moves[event.key][0] * step);
        element.y = Math.round(element.y + moves[event.key][1] * step);
        syncPositionFields(element);
        describeSelection();
        changed();
    });

    elementList.addEventListener('change', () => {
        selectElement(elementList.value || null);
    });

    function insertElement(element) {
        const index = state.layout.elements.findIndex((entry) => entry.id === state.selectedId);
        if (index >= 0) {
            state.layout.elements.splice(index + 1, 0, element);
        } else {
            state.layout.elements.push(element);
        }
        changed();
        selectElement(element.id);
    }

    addTextButton.addEventListener('click', () => {
        const layout = state.layout;
        insertElement(normalizeElement(textElement({
            text: 'New text',
            x: Math.round(layout.width * 0.1),
            y: Math.round(layout.height / 2),
            width: Math.round(layout.width * 0.8),
            size: Math.max(12, Math.round(layout.height / 16)),
            wrap: 'width'
        })));
        setStatus('Added a text element.');
        document.getElementById('sb-prop-text')?.focus();
    });

    addBoxButton.addEventListener('click', () => {
        const layout = state.layout;
        insertElement(normalizeElement({
            type: 'rect',
            x: Math.round(layout.width * 0.25),
            y: Math.round(layout.height * 0.25),
            width: Math.round(layout.width * 0.5),
            height: Math.round(layout.height * 0.2),
            fill: '#333333',
            stroke: '#FFFFFF',
            strokeWidth: 0
        }));
        setStatus('Added a box.');
        document.getElementById('sb-prop-x')?.focus();
    });

    addImageButton.addEventListener('click', () => {
        addImageFile.dataset.mode = 'add';
        addImageFile.value = '';
        addImageFile.click();
    });

    addImageFile.addEventListener('change', async () => {
        const file = addImageFile.files && addImageFile.files[0];
        if (!file) return;
        let src;
        try {
            src = sanitizeImageSource(await readFileAsDataUrl(file));
        } catch (err) {
            src = '';
        }
        const img = src ? await loadImage(src) : null;
        if (!img) {
            setStatus('That file could not be read as an image.');
            return;
        }
        const mode = addImageFile.dataset.mode;
        if (mode === 'background') {
            state.layout.background.image = src;
            renderScreenFields();
            changed();
            setStatus('Background image set.');
            return;
        }
        if (mode === 'replace') {
            const element = selected();
            if (element && element.type === 'image') {
                element.src = src;
                changed();
                setStatus('Image replaced.');
            }
            return;
        }
        const layout = state.layout;
        const fit = Math.min(1, (layout.width * 0.5) / img.naturalWidth, (layout.height * 0.5) / img.naturalHeight);
        insertElement(normalizeElement({
            type: 'image',
            src,
            x: Math.round((layout.width - img.naturalWidth * fit) / 2),
            y: Math.round((layout.height - img.naturalHeight * fit) / 2),
            width: Math.round(img.naturalWidth * fit),
            height: Math.round(img.naturalHeight * fit)
        }));
        setStatus('Added an image.');
        addImageButton.focus();
    });

    duplicateButton.addEventListener('click', () => {
        const element = selected();
        if (!element) return;
        const copy = normalizeElement({ ...cloneScreen(element), id: newElementId(), x: element.x + 10, y: element.y + 10 });
        insertElement(copy);
        setStatus('Duplicated the element.');
        duplicateButton.focus();
    });

    const moveSelected = (delta, button) => {
        const elements = state.layout.elements;
        const index = elements.findIndex((entry) => entry.id === state.selectedId);
        const target = index + delta;
        if (index < 0 || target < 0 || target >= elements.length) return;
        const [element] = elements.splice(index, 1);
        elements.splice(target, 0, element);
        changed();
        selectElement(element.id);
        setStatus(`Moved to position ${target + 1} of ${elements.length}.`);
        if (button.disabled) {
            elementList.focus();
        } else {
            button.focus();
        }
    };
    upButton.addEventListener('click', () => moveSelected(-1, upButton));
    downButton.addEventListener('click', () => moveSelected(1, downButton));

    deleteElementButton.addEventListener('click', () => {
        const elements = state.layout.elements;
        const index = elements.findIndex((entry) => entry.id === state.selectedId);
        if (index < 0) return;
        elements.splice(index, 1);
        changed();
        const next = elements[Math.min(index, elements.length - 1)];
        selectElement(next ? next.id : null);
        setStatus('Deleted the element.');
        if (next) {
            elementList.focus();
        } else {
            addTextButton.focus();
        }
    });

    nameInput.addEventListener('input', () => {
        state.layout.name = nameInput.value;
        markEdited();
    });

    [showTokens, showFlashOff, showCrawl].forEach((input) => input.addEventListener('change', scheduleRender));

    function loadLayout(layout, message) {
        state.layout = cloneScreen(normalizeScreen(layout));
        state.selectedId = state.layout.elements.length ? state.layout.elements[0].id : null;
        nameInput.value = state.layout.name;
        refreshElementList();
        renderProps();
        renderScreenFields();
        describeSelection();
        markEdited();
        scheduleRender();
        if (message) setStatus(message);
    }

    startButton.addEventListener('click', async () => {
        const value = startSelect.value || 'template:blank';
        if (value.startsWith('saved:')) {
            const screen = getScreen(value.slice(6));
            if (screen) {
                loadLayout(screen, `Opened the saved screen "${screen.name}".`);
            }
            return;
        }
        const kind = value.replace(/^template:/, '');
        const layout = await createScreenTemplate(kind);
        const choice = TEMPLATE_CHOICES.find((entry) => entry.value === kind);
        loadLayout(layout, `Started a new screen from the ${choice ? choice.label : 'blank'} template.`);
    });

    importButton.addEventListener('click', () => {
        importFile.value = '';
        importFile.click();
    });

    importFile.addEventListener('change', async () => {
        const file = importFile.files && importFile.files[0];
        if (!file) return;
        try {
            const layout = parseScreenJson(await readFileAsText(file));
            loadLayout(layout, `Imported "${layout.name}". Save or use it to keep it in this browser.`);
        } catch (err) {
            setStatus(err.message || 'That file could not be imported.');
        }
        importButton.focus();
    });

    exportButton.addEventListener('click', async () => {
        try {
            const payload = serializeScreen(state.layout);
            await state.options.saveFile(`eas-screen-${slugify(state.layout.name)}.json`, payload, 'application/json');
            setStatus('Exported the screen as .json.');
        } catch (err) {
            setStatus(`Could not export the screen: ${err.message || err}`);
        }
    });

    function persist() {
        state.layout.name = nameInput.value.trim() || 'Untitled Screen';
        const saved = saveScreen(state.layout);
        state.layout.id = saved.id;
        state.layout.updated = saved.updated;
        populateStartSelect();
        if (state.options.onSave) {
            state.options.onSave(saved);
        }
        return saved;
    }

    saveButton.addEventListener('click', () => {
        try {
            const saved = persist();
            setStatus(`Saved "${saved.name}" in this browser.`);
        } catch (err) {
            setStatus(`Could not save: ${err.message || err}`);
        }
    });

    useButton.addEventListener('click', async () => {
        let saved;
        try {
            saved = persist();
        } catch (err) {
            setStatus(`Could not save: ${err.message || err}`);
            return;
        }
        close();
        if (state.options.onUse) {
            await state.options.onUse(saved);
        }
    });

    deleteScreenButton.addEventListener('click', () => {
        const id = state.layout && state.layout.id;
        if (!id || !getScreen(id)) {
            setStatus('This screen has not been saved, so there is nothing to delete.');
            return;
        }
        if (!state.deleteArmed) {
            state.deleteArmed = true;
            deleteScreenButton.textContent = 'Press Again to Delete';
            setStatus(`Press Delete again to remove "${state.layout.name}" from this browser.`);
            return;
        }
        deleteScreen(id);
        state.layout.id = null;
        markEdited();
        populateStartSelect();
        if (state.options.onDelete) {
            state.options.onDelete(id);
        }
        setStatus('Deleted the saved screen. It stays open here until you close the builder.');
    });

    closeButton.addEventListener('click', () => close());

    backdrop.addEventListener('mousedown', (event) => {
        if (event.target === backdrop) close();
    });

    function focusables() {
        return Array.from(modal.querySelectorAll('button, input, select, textarea, summary, canvas[tabindex], [tabindex]:not([tabindex="-1"])'))
            .filter((node) => !node.disabled && !node.hidden && node.getAttribute('tabindex') !== '-1' && node.getClientRects().length > 0);
    }

    modal.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            close();
            return;
        }
        if (event.key !== 'Tab') return;
        const list = focusables();
        if (!list.length) return;
        const first = list[0];
        const last = list[list.length - 1];
        if (event.shiftKey && (document.activeElement === first || !modal.contains(document.activeElement))) {
            event.preventDefault();
            last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first.focus();
        }
    });

    let resizeObserver = null;
    if (typeof ResizeObserver === 'function') {
        resizeObserver = new ResizeObserver(() => {
            if (!backdrop.hidden) scheduleRender();
        });
        resizeObserver.observe(canvas);
    }

    function close() {
        if (backdrop.hidden) return;
        backdrop.hidden = true;
        state.drag = null;
        document.documentElement.classList.remove('sb-open');
        const target = state.returnFocus;
        state.returnFocus = null;
        if (target && typeof target.focus === 'function' && target.isConnected) {
            target.focus();
        }
        if (state.options.onClose) {
            state.options.onClose();
        }
    }

    async function open(options = {}) {
        state.options = { saveFile: async () => { }, ...options };
        state.returnFocus = options.returnFocus || document.activeElement;
        populateStartSelect();
        state.tokenCache = new Map();
        state.tokens = {};
        let layout = options.initialLayout || null;
        if (!layout) {
            layout = await createScreenTemplate(options.initialTemplate || 'blank');
        }
        await tokensFor(layout.textEndecMode || '');
        loadLayout(layout, options.message || '');
        if (options.initialTemplate && !options.initialLayout) {
            startSelect.value = `template:${options.initialTemplate}`;
        } else if (state.layout.id && getScreen(state.layout.id)) {
            startSelect.value = `saved:${state.layout.id}`;
        }
        backdrop.hidden = false;
        document.documentElement.classList.add('sb-open');
        nameInput.focus();
        scheduleRender();
    }

    return {
        open,
        close,
        isOpen: () => !backdrop.hidden,
        getLayout: () => (state.layout ? normalizeScreen(state.layout) : null),
        setLayout: (layout) => loadLayout(layout, ''),
        exportJson: () => serializeScreen(state.layout)
    };
}

export function getScreenBuilder() {
    if (!builderInstance) {
        builderInstance = createBuilder();
    }
    return builderInstance;
}

export async function openScreenBuilder(options = {}) {
    const builder = getScreenBuilder();
    await builder.open(options);
    return builder;
}
