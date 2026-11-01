export const SCHEMA_VERSION = 1;

export const DEFAULT_VOICES = Object.freeze(['paul']);

export const LIMITS = Object.freeze({
    matchChars: 80,
    matchTokens: 8,
    respellChars: 120,
    vtmlChars: 300,
    notesChars: 500,
    labelChars: 80,
    variants: 8,
    setEntries: 5000,
    personalEntries: 300,
    submissionEntries: 50,
    evidenceNotesChars: 2000,
    evidenceLinks: 5,
    speedMin: 50,
    speedMax: 200,
    commaPauseMax: 3000,
    periodPauseMax: 5000,
    pauseTimeMax: 5000,
    breakLevelMax: 3,
});

export const CMU_VOWELS = Object.freeze(['AA', 'AE', 'AH', 'AO', 'AW', 'AX', 'AY', 'EH', 'ER', 'EY', 'IH', 'IY', 'OW', 'OY', 'UH', 'UW']);
export const CMU_CONSONANTS = Object.freeze(['B', 'CH', 'D', 'DH', 'F', 'G', 'HH', 'JH', 'K', 'L', 'M', 'N', 'NG', 'P', 'R', 'S', 'SH', 'T', 'TH', 'V', 'W', 'Y', 'Z', 'ZH']);
export const CMU_PHONES = Object.freeze([...CMU_VOWELS, ...CMU_CONSONANTS]);

export const REPLACE_KINDS = Object.freeze(['phoneme', 'respell', 'vtml']);
export const PROSODY_FIELDS = Object.freeze(['speed', 'commaPauseMs', 'periodPauseMs']);
export const PROTECTED_ELEMENTS = Object.freeze(['vtml_phoneme', 'vtml_sub', 'vtml_say_as', 'vtml_partofsp']);
export const SUBMISSION_ACTIONS = Object.freeze(['add', 'change', 'remove', 'prosody']);
export const SUBMISSION_APPS = Object.freeze(['web', 'android', 'ios']);

const VOWEL_SET = new Set(CMU_VOWELS);
const CONSONANT_SET = new Set(CMU_CONSONANTS);
const PROTECTED_SET = new Set(PROTECTED_ELEMENTS);
const SET_ID_RE = /^(?:national|wfo\/[A-Z]{3}|tx\/[A-Z0-9]{3,7})$/;
const SOURCE_ID_RE = /^(?:wfo:[A-Z]{3}|tx:[A-Z0-9]{3,7})$/;
const ENTRY_ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
const MATCH_TOKEN_RE = /^[A-Za-z0-9](?:[A-Za-z0-9'’.:-]*[A-Za-z0-9])?$/;
const WORD_START_RE = /[A-Za-z0-9]/;
const WORD_CHAR_RE = /[A-Za-z0-9'’]/;
const ALNUM_RUN_RE = /^[A-Za-z0-9]+/;
const PLACEHOLDER = '{{match}}';

const isObject = (value) => !!value && typeof value === 'object' && !Array.isArray(value);
const isInt = (value) => Number.isInteger(value);

export function escapeXml(text) {
    return String(text ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function normalizeMatch(match) {
    return String(match ?? '').trim().replace(/\s+/g, ' ');
}

export function matchTokens(match) {
    const text = normalizeMatch(match);
    return text ? text.split(' ') : [];
}

export function entryKey(entry) {
    const match = normalizeMatch(entry?.match);
    return entry?.caseSensitive ? 'cs:' + match : match.toLowerCase();
}

export function slugifyMatch(match) {
    const slug = normalizeMatch(match).toLowerCase().replace(/['’]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    return (slug || 'entry').slice(0, 64).replace(/-+$/, '') || 'entry';
}

export function setIdForSource(source) {
    const parsed = parseSourceId(source);
    if (!parsed) return null;
    return parsed.type === 'national' ? 'national' : parsed.type + '/' + parsed.id;
}

export function parseSourceId(source) {
    const text = String(source ?? '').trim();
    if (!text || text === 'national') return { type: 'national', id: '' };
    if (!SOURCE_ID_RE.test(text)) return null;
    const [type, id] = text.split(':');
    return { type, id };
}

export function formatSourceId(type, id) {
    if (type === 'national' || !type) return '';
    const source = type + ':' + String(id ?? '').toUpperCase();
    return SOURCE_ID_RE.test(source) ? source : null;
}

export function isSetId(id) {
    return typeof id === 'string' && SET_ID_RE.test(id);
}

export function isEligibleVoice(voice, backend, voices = DEFAULT_VOICES) {
    if (!String(backend ?? '').toLowerCase().includes('vt')) return false;
    const id = String(voice ?? '').toLowerCase();
    return !!id && (Array.isArray(voices) ? voices : DEFAULT_VOICES).some((v) => String(v).toLowerCase() === id);
}

export function validatePhonemeString(ph) {
    const problems = [];
    const text = String(ph ?? '').trim();
    if (!text) return ['phoneme string is empty'];
    if (text.length > LIMITS.vtmlChars) problems.push('phoneme string is longer than ' + LIMITS.vtmlChars + ' characters');
    for (const token of text.split(/\s+/)) {
        if (token === '#') continue;
        const m = /^([A-Z]{1,2})([0-2])?$/.exec(token);
        if (!m) {
            problems.push('unknown phone ' + token);
        } else if (VOWEL_SET.has(m[1])) {
            continue;
        } else if (CONSONANT_SET.has(m[1])) {
            if (m[2] !== undefined) problems.push('consonant ' + token + ' cannot carry stress');
        } else {
            problems.push('unknown phone ' + token);
        }
    }
    return problems;
}

function parseAttributes(source) {
    const attrs = {};
    const re = /\s*([A-Za-z_][\w:-]*)\s*=\s*"([^"]*)"\s*/y;
    let pos = 0;
    while (pos < source.length) {
        re.lastIndex = pos;
        const m = re.exec(source);
        if (!m) return null;
        const name = m[1].toLowerCase();
        if (name in attrs) return null;
        attrs[name] = m[2];
        pos = re.lastIndex;
    }
    return attrs;
}

export function validateVtmlMarkup(markup) {
    const problems = [];
    const text = String(markup ?? '');
    if (!text.trim()) return ['markup is empty'];
    if (text.length > LIMITS.vtmlChars) problems.push('markup is longer than ' + LIMITS.vtmlChars + ' characters');
    const stack = [];
    const re = /<[^<>]*>|[^<>]+|[<>]/g;
    let m;
    while ((m = re.exec(text))) {
        const piece = m[0];
        if (piece === '<' || piece === '>') {
            problems.push('stray ' + piece);
            continue;
        }
        if (piece[0] !== '<') {
            const bare = piece.split(PLACEHOLDER).join('');
            if (/[&{}]/.test(bare)) problems.push('text may not contain &, { or } outside ' + PLACEHOLDER);
            continue;
        }
        const tag = /^<(\/?)([A-Za-z_][\w:-]*)([^]*?)(\/?)>$/.exec(piece);
        if (!tag) {
            problems.push('unreadable tag ' + piece);
            continue;
        }
        const [, closing, rawName, rawAttrs, selfClosing] = tag;
        const name = rawName.toLowerCase();
        if (closing) {
            if (rawAttrs.trim() || selfClosing) problems.push('malformed closing tag ' + piece);
            if (stack.pop() !== name) problems.push('unbalanced </' + name + '>');
            continue;
        }
        const attrs = parseAttributes(rawAttrs);
        if (!attrs) {
            problems.push('unreadable attributes in ' + piece);
            continue;
        }
        if (name === 'vtml_pause') {
            const time = Number(attrs.time);
            if (!selfClosing) problems.push('vtml_pause must be self-closing');
            if (Object.keys(attrs).some((k) => k !== 'time') || !/^\d+$/.test(attrs.time ?? '') || time > LIMITS.pauseTimeMax) {
                problems.push('vtml_pause needs time="0".."' + LIMITS.pauseTimeMax + '" only');
            }
        } else if (name === 'vtml_break') {
            if (!selfClosing) problems.push('vtml_break must be self-closing');
            if (Object.keys(attrs).some((k) => k !== 'level') || !/^[0-3]$/.test(attrs.level ?? '')) {
                problems.push('vtml_break needs level="0".."' + LIMITS.breakLevelMax + '" only');
            }
        } else if (name === 'vtml_phoneme') {
            if (Object.keys(attrs).some((k) => k !== 'alphabet' && k !== 'ph') || String(attrs.alphabet ?? '').toLowerCase() !== 'x-cmu') {
                problems.push('vtml_phoneme needs alphabet="x-cmu" and ph only');
            }
            for (const p of validatePhonemeString(attrs.ph)) problems.push('vtml_phoneme: ' + p);
            if (!selfClosing) stack.push(name);
        } else {
            problems.push('tag <' + name + '> is not allowed');
        }
    }
    if (stack.length) problems.push('unclosed <' + stack[stack.length - 1] + '>');
    return problems;
}

function findSubsequence(tokens, sub) {
    const lower = tokens.map((t) => t.toLowerCase());
    const target = sub.map((t) => t.toLowerCase());
    for (let i = 0; i + target.length <= lower.length; i++) {
        if (target.every((t, j) => lower[i + j] === t)) return i;
    }
    return -1;
}

function validateReplace(replace, match, path, problems) {
    if (!isObject(replace)) {
        problems.push({ path, problem: 'replace must be an object' });
        return;
    }
    if (!REPLACE_KINDS.includes(replace.kind)) {
        problems.push({ path: path + '.kind', problem: 'kind must be one of ' + REPLACE_KINDS.join(', ') });
        return;
    }
    if (replace.kind === 'phoneme') {
        for (const p of validatePhonemeString(replace.ph)) problems.push({ path: path + '.ph', problem: p });
        if (replace.on !== undefined) {
            const on = matchTokens(replace.on);
            if (!on.length || findSubsequence(matchTokens(match), on) < 0) {
                problems.push({ path: path + '.on', problem: 'on must be whole words taken from match' });
            }
        }
    } else if (replace.kind === 'respell') {
        const text = String(replace.text ?? '');
        if (!text.trim()) problems.push({ path: path + '.text', problem: 'respelling is empty' });
        if (text.length > LIMITS.respellChars) problems.push({ path: path + '.text', problem: 'respelling is longer than ' + LIMITS.respellChars + ' characters' });
        if (/[<>{}]/.test(text)) problems.push({ path: path + '.text', problem: 'respelling may not contain <, >, { or }' });
    } else {
        for (const p of validateVtmlMarkup(replace.markup)) problems.push({ path: path + '.markup', problem: p });
    }
}

function validateNotes(value, path, problems, limit = LIMITS.notesChars) {
    if (value === undefined) return;
    if (typeof value !== 'string' || value.length > limit) problems.push({ path, problem: 'must be text of ' + limit + ' characters or fewer' });
}

export function validateEntry(entry, path = 'entry', { personal = false } = {}) {
    const problems = [];
    if (!isObject(entry)) return [{ path, problem: 'entry must be an object' }];
    if (!ENTRY_ID_RE.test(String(entry.id ?? ''))) problems.push({ path: path + '.id', problem: 'id must be lowercase letters, digits and dashes' });
    const match = String(entry.match ?? '');
    const tokens = matchTokens(match);
    if (match !== normalizeMatch(match)) problems.push({ path: path + '.match', problem: 'match must use single spaces with no leading or trailing space' });
    if (!tokens.length) {
        problems.push({ path: path + '.match', problem: 'match is empty' });
    } else {
        if (match.length > LIMITS.matchChars) problems.push({ path: path + '.match', problem: 'match is longer than ' + LIMITS.matchChars + ' characters' });
        if (tokens.length > LIMITS.matchTokens) problems.push({ path: path + '.match', problem: 'match has more than ' + LIMITS.matchTokens + ' words' });
        const bad = tokens.find((t) => !MATCH_TOKEN_RE.test(t));
        if (bad) problems.push({ path: path + '.match', problem: 'word "' + bad + '" must start and end with a letter or digit' });
    }
    if (entry.caseSensitive !== undefined && typeof entry.caseSensitive !== 'boolean') problems.push({ path: path + '.caseSensitive', problem: 'must be true or false' });
    if (entry.verified !== undefined && typeof entry.verified !== 'boolean') problems.push({ path: path + '.verified', problem: 'must be true or false' });
    if (personal && entry.disabled === true) {
        if (entry.replace !== undefined) validateReplace(entry.replace, match, path + '.replace', problems);
    } else {
        validateReplace(entry.replace, match, path + '.replace', problems);
    }
    if (entry.variants !== undefined) {
        if (!Array.isArray(entry.variants) || entry.variants.length > LIMITS.variants) {
            problems.push({ path: path + '.variants', problem: 'variants must be a list of at most ' + LIMITS.variants });
        } else {
            entry.variants.forEach((variant, i) => {
                const vp = path + '.variants[' + i + ']';
                if (!isObject(variant)) {
                    problems.push({ path: vp, problem: 'variant must be an object' });
                    return;
                }
                if (!ENTRY_ID_RE.test(String(variant.id ?? ''))) problems.push({ path: vp + '.id', problem: 'id must be lowercase letters, digits and dashes' });
                validateNotes(variant.label, vp + '.label', problems, LIMITS.labelChars);
                validateNotes(variant.context, vp + '.context', problems);
                validateNotes(variant.notes, vp + '.notes', problems);
                validateReplace(variant.replace, match, vp + '.replace', problems);
            });
        }
    }
    validateNotes(entry.notes, path + '.notes', problems);
    if (entry.sources !== undefined && !Array.isArray(entry.sources)) problems.push({ path: path + '.sources', problem: 'sources must be a list' });
    return problems;
}

function validateProsodyField(name, field, path, problems) {
    if (field === null || field === undefined) return;
    if (!isObject(field)) {
        problems.push({ path, problem: 'must be an object or null' });
        return;
    }
    const range = name === 'speed'
        ? [LIMITS.speedMin, LIMITS.speedMax]
        : [0, name === 'commaPauseMs' ? LIMITS.commaPauseMax : LIMITS.periodPauseMax];
    const check = (value, at) => {
        if (!isInt(value) || value < range[0] || value > range[1]) problems.push({ path: at, problem: 'must be a whole number from ' + range[0] + ' to ' + range[1] });
    };
    check(field.value, path + '.value');
    if (field.verified !== undefined && typeof field.verified !== 'boolean') problems.push({ path: path + '.verified', problem: 'must be true or false' });
    validateNotes(field.notes, path + '.notes', problems);
    if (field.variants !== undefined) {
        if (!Array.isArray(field.variants)) {
            problems.push({ path: path + '.variants', problem: 'variants must be a list' });
        } else {
            field.variants.forEach((variant, i) => {
                if (!isObject(variant)) {
                    problems.push({ path: path + '.variants[' + i + ']', problem: 'variant must be an object' });
                    return;
                }
                check(variant.value, path + '.variants[' + i + '].value');
                validateNotes(variant.label, path + '.variants[' + i + '].label', problems, LIMITS.labelChars);
            });
        }
    }
}

export function validateProsody(prosody, path = 'prosody') {
    const problems = [];
    if (prosody === undefined || prosody === null) return problems;
    if (!isObject(prosody)) return [{ path, problem: 'prosody must be an object' }];
    for (const key of Object.keys(prosody)) {
        if (!PROSODY_FIELDS.includes(key)) problems.push({ path: path + '.' + key, problem: 'unknown prosody field' });
    }
    for (const name of PROSODY_FIELDS) validateProsodyField(name, prosody[name], path + '.' + name, problems);
    return problems;
}

export function validatePronunciationSet(set, { offices = null, transmitters = null } = {}) {
    const problems = [];
    if (!isObject(set)) return { ok: false, problems: [{ path: '', problem: 'set must be an object' }] };
    if (set.schemaVersion !== SCHEMA_VERSION) problems.push({ path: 'schemaVersion', problem: 'schemaVersion must be ' + SCHEMA_VERSION });
    if (!isSetId(set.id)) problems.push({ path: 'id', problem: 'id must be national, wfo/XXX or tx/CALLSIGN' });
    const scope = set.scope;
    if (!isObject(scope)) {
        problems.push({ path: 'scope', problem: 'scope must be an object' });
    } else if (isSetId(set.id)) {
        const [type, id = ''] = set.id.split('/');
        if (scope.type !== type || (type !== 'national' && scope.id !== id)) problems.push({ path: 'scope', problem: 'scope must match id' });
        if (type === 'wfo' && offices && !offices[id]) problems.push({ path: 'scope.id', problem: 'unknown office ' + id });
        if (type === 'tx') {
            if (!/^[A-Z]{3}$/.test(String(scope.wfo ?? ''))) problems.push({ path: 'scope.wfo', problem: 'transmitter sets name their office' });
            const known = transmitters?.[id];
            if (transmitters && !known) problems.push({ path: 'scope.id', problem: 'unknown transmitter ' + id });
            if (known && known.wfo !== scope.wfo) problems.push({ path: 'scope.wfo', problem: id + ' belongs to ' + known.wfo });
        }
    }
    if (!isInt(set.rev) || set.rev < 1) problems.push({ path: 'rev', problem: 'rev must be a positive whole number' });
    if (set.voices !== undefined && (!Array.isArray(set.voices) || !set.voices.every((v) => typeof v === 'string' && v))) {
        problems.push({ path: 'voices', problem: 'voices must be a list of voice ids' });
    }
    problems.push(...validateProsody(set.prosody));
    if (set.style !== undefined && !isObject(set.style)) problems.push({ path: 'style', problem: 'style must be an object' });
    if (!Array.isArray(set.entries)) {
        problems.push({ path: 'entries', problem: 'entries must be a list' });
    } else {
        if (set.entries.length > LIMITS.setEntries) problems.push({ path: 'entries', problem: 'more than ' + LIMITS.setEntries + ' entries' });
        const ids = new Set();
        const keys = new Set();
        set.entries.forEach((entry, i) => {
            const path = 'entries[' + i + ']';
            problems.push(...validateEntry(entry, path));
            if (!isObject(entry)) return;
            if (ids.has(entry.id)) problems.push({ path: path + '.id', problem: 'duplicate id ' + entry.id });
            ids.add(entry.id);
            const key = entryKey(entry);
            if (keys.has(key)) problems.push({ path: path + '.match', problem: 'duplicate match ' + entry.match });
            keys.add(key);
        });
    }
    return { ok: problems.length === 0, problems };
}

export function segmentVtml(text) {
    const source = String(text ?? '');
    const segments = [];
    const push = (kind, value) => {
        if (!value) return;
        const last = segments[segments.length - 1];
        if (last && last.kind === kind && kind !== 'tag') last.value += value;
        else segments.push({ kind, value });
    };
    let pos = 0;
    while (pos < source.length) {
        const lt = source.indexOf('<', pos);
        const amp = source.indexOf('&', pos);
        const next = [lt, amp].filter((i) => i >= 0).reduce((a, b) => Math.min(a, b), Infinity);
        if (next === Infinity) {
            push('text', source.slice(pos));
            break;
        }
        push('text', source.slice(pos, next));
        if (next === amp) {
            const ent = /^&(?:#\d+|#x[0-9a-fA-F]+|[A-Za-z][A-Za-z0-9]*);/.exec(source.slice(amp, amp + 16));
            if (ent) {
                push('tag', ent[0]);
                pos = amp + ent[0].length;
            } else {
                push('text', '&');
                pos = amp + 1;
            }
            continue;
        }
        if (source.startsWith('<!--', lt)) {
            const end = source.indexOf('-->', lt + 4);
            if (end < 0) {
                push('protected', source.slice(lt));
                break;
            }
            push('tag', source.slice(lt, end + 3));
            pos = end + 3;
            continue;
        }
        const gt = source.indexOf('>', lt + 1);
        const nextLt = source.indexOf('<', lt + 1);
        if (gt < 0 || (nextLt >= 0 && nextLt < gt)) {
            push('protected', source.slice(lt));
            break;
        }
        const tag = source.slice(lt, gt + 1);
        const nameMatch = /^<(\/?)([A-Za-z_][\w:.-]*)/.exec(tag);
        const name = nameMatch ? nameMatch[2].toLowerCase() : '';
        if (nameMatch && !nameMatch[1] && !tag.endsWith('/>') && PROTECTED_SET.has(name)) {
            const re = new RegExp('<(/?)' + name + '(?=[\\s/>])[^<>]*>', 'gi');
            re.lastIndex = gt + 1;
            let depth = 1;
            let m;
            let end = -1;
            while ((m = re.exec(source))) {
                if (m[0].endsWith('/>')) continue;
                depth += m[1] ? -1 : 1;
                if (depth === 0) {
                    end = re.lastIndex;
                    break;
                }
            }
            if (end < 0) {
                push('protected', source.slice(lt));
                break;
            }
            push('protected', source.slice(lt, end));
            pos = end;
            continue;
        }
        push('tag', tag);
        pos = gt + 1;
    }
    return segments;
}

function escapeRegExp(text) {
    return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function tokenPattern(token) {
    return token.split(/['’]/).map(escapeRegExp).join("['’]");
}

function firstRunKey(match) {
    const m = ALNUM_RUN_RE.exec(matchTokens(match)[0] || '');
    return m ? m[0].toLowerCase() : '';
}

export function mergeLayers(layers = []) {
    const merged = new Map();
    for (const layer of layers) {
        if (!layer || !Array.isArray(layer.entries)) continue;
        for (const entry of layer.entries) {
            if (!isObject(entry) || !normalizeMatch(entry.match)) continue;
            const key = entryKey(entry);
            if (entry.disabled === true) {
                merged.delete(key);
                if (!entry.caseSensitive) {
                    for (const other of [...merged.keys()]) {
                        if (other.startsWith('cs:') && other.slice(3).toLowerCase() === key) merged.delete(other);
                    }
                }
                continue;
            }
            if (!isObject(entry.replace)) continue;
            merged.delete(key);
            merged.set(key, { key, entry, layer: layer.layer || 'unknown' });
        }
    }
    return [...merged.values()];
}

export function compileMatcher(items = []) {
    const index = new Map();
    let size = 0;
    for (const item of items) {
        const entry = item?.entry;
        if (!entry || !isObject(entry.replace)) continue;
        const tokens = matchTokens(entry.match);
        const key = firstRunKey(entry.match);
        if (!tokens.length || !key) continue;
        const source = tokens.map(tokenPattern).join('\\s+') + "(?![A-Za-z0-9'’])";
        const candidate = {
            entry,
            layer: item.layer,
            tokens: tokens.length,
            length: tokens.join(' ').length,
            caseSensitive: !!entry.caseSensitive,
            re: new RegExp(source, entry.caseSensitive ? 'y' : 'iy'),
        };
        if (!index.has(key)) index.set(key, []);
        index.get(key).push(candidate);
        size++;
    }
    for (const list of index.values()) {
        list.sort((a, b) => (b.tokens - a.tokens) || (b.length - a.length) || (Number(b.caseSensitive) - Number(a.caseSensitive)));
    }
    return { index, size };
}

function emitPhoneme(ph, original) {
    return '<vtml_phoneme alphabet="x-cmu" ph="' + ph + '">' + escapeXml(original) + '</vtml_phoneme>';
}

export function renderReplacement(replace, original) {
    if (replace.kind === 'respell') return escapeXml(replace.text);
    if (replace.kind === 'vtml') return String(replace.markup).split(PLACEHOLDER).join(escapeXml(original));
    const ph = String(replace.ph).trim().replace(/\s+/g, ' ');
    if (!replace.on) return emitPhoneme(ph, original);
    const parts = [];
    const re = /\S+/g;
    let m;
    while ((m = re.exec(original))) parts.push({ text: m[0], start: m.index, end: m.index + m[0].length });
    const at = findSubsequence(parts.map((p) => p.text), matchTokens(replace.on));
    if (at < 0) return emitPhoneme(ph, original);
    const from = parts[at].start;
    const to = parts[at + matchTokens(replace.on).length - 1].end;
    return original.slice(0, from) + emitPhoneme(ph, original.slice(from, to)) + original.slice(to);
}

function applyToText(text, matcher, hits, offset) {
    let out = '';
    let pos = 0;
    let i = 0;
    while (i < text.length) {
        const ch = text[i];
        if (!WORD_START_RE.test(ch) || (i > 0 && WORD_CHAR_RE.test(text[i - 1]))) {
            i++;
            continue;
        }
        const run = ALNUM_RUN_RE.exec(text.slice(i, i + 64));
        const candidates = matcher.index.get(run[0].toLowerCase());
        let hit = null;
        if (candidates) {
            for (const candidate of candidates) {
                candidate.re.lastIndex = i;
                const m = candidate.re.exec(text);
                if (m) {
                    hit = { candidate, original: m[0] };
                    break;
                }
            }
        }
        if (!hit) {
            i += run[0].length;
            continue;
        }
        out += text.slice(pos, i) + renderReplacement(hit.candidate.entry.replace, hit.original);
        hits.push({ start: offset + i, end: offset + i + hit.original.length, entryId: hit.candidate.entry.id, layer: hit.candidate.layer, match: hit.original });
        i += hit.original.length;
        pos = i;
    }
    return out + text.slice(pos);
}

export function applyPronunciations(text, matcher) {
    const source = String(text ?? '');
    const hits = [];
    if (!matcher || !matcher.size) return { text: source, hits };
    let out = '';
    let offset = 0;
    for (const segment of segmentVtml(source)) {
        out += segment.kind === 'text' ? applyToText(segment.value, matcher, hits, offset) : segment.value;
        offset += segment.value.length;
    }
    return { text: out, hits };
}

export function resolveProsody({ national = null, wfo = null, tx = null } = {}) {
    const resolved = {};
    for (const name of PROSODY_FIELDS) {
        resolved[name] = null;
        for (const [from, set] of [['tx', tx], ['wfo', wfo], ['national', national]]) {
            const field = set?.prosody?.[name];
            if (isObject(field) && isInt(field.value)) {
                resolved[name] = { value: field.value, verified: field.verified !== false, notes: field.notes || '', from, setId: set.id || from };
                break;
            }
        }
    }
    return resolved;
}

export function combineSpeed(base, slider = 0) {
    const notch = Number(slider);
    const factor = 100 + 10 * (Number.isFinite(notch) ? notch : 0);
    return Math.min(LIMITS.speedMax, Math.max(LIMITS.speedMin, Math.round(Number(base) * factor / 100)));
}

function supportedFields(features, voice) {
    const vt = features?.vtProsody;
    if (!isObject(vt) || !Array.isArray(vt.fields)) return new Set();
    const voices = Array.isArray(vt.voices) ? vt.voices.map((v) => String(v).toLowerCase()) : [];
    if (!voices.includes(String(voice ?? '').toLowerCase())) return new Set();
    return new Set(vt.fields);
}

export function planRemoteSpeech({ text, voice, backend, prosody = {}, context = null, features = null } = {}) {
    const input = String(text ?? '');
    const baseProsody = { ...(prosody || {}) };
    const unchanged = { text: input, prosody: baseProsody, fields: {}, summary: null, applied: false };
    if (!context || !context.enabled || !isEligibleVoice(voice, backend, context.voices)) return unchanged;

    const { text: replaced, hits } = applyPronunciations(input, context.matcher);
    const supported = supportedFields(features, voice);
    const fields = {};
    const outProsody = { ...baseProsody };
    const resolved = context.prosody || {};
    const summary = {
        source: context.source || '',
        label: context.label || 'National',
        hits: hits.length,
        speed: null,
        commaPauseMs: null,
        periodPauseMs: null,
        unsupported: [],
    };
    let out = replaced;

    if (resolved.speed) {
        const speed = combineSpeed(resolved.speed.value, baseProsody.rate);
        summary.speed = { value: speed, base: resolved.speed.value, verified: resolved.speed.verified, from: resolved.speed.from, applied: 'markup' };
        if (supported.has('vtSpeed')) {
            fields.vtSpeed = speed;
            summary.speed.applied = 'field';
        } else {
            out = '<vtml_speed value="' + speed + '">' + out + '</vtml_speed>';
            summary.unsupported.push('vtSpeed');
        }
        outProsody.rate = 0;
    }

    if (context.officeSelected) {
        for (const [name, field] of [['commaPauseMs', 'vtCommaPauseMs'], ['periodPauseMs', 'vtPeriodPauseMs']]) {
            const value = resolved[name];
            if (!value) continue;
            summary[name] = { value: value.value, verified: value.verified, from: value.from, applied: supported.has(field) };
            if (supported.has(field)) fields[field] = value.value;
            else summary.unsupported.push(field);
        }
    }

    return { text: out, prosody: outProsody, fields, summary, applied: true, hits };
}

export function lexiconFromSet(set) {
    const lexicon = {};
    for (const entry of Array.isArray(set?.entries) ? set.entries : []) {
        if (entry?.replace?.kind !== 'phoneme') continue;
        lexicon[normalizeMatch(entry.match).toLowerCase()] = String(entry.replace.ph).trim().replace(/\s+/g, ' ');
    }
    return lexicon;
}

export function describeSpeed(summary) {
    if (!summary?.speed) return '';
    const s = summary.speed;
    return 'speed ' + s.value + (s.verified ? '' : ' (not speed-tested)');
}

export function summarizePlan(summary) {
    if (!summary) return '';
    const parts = [summary.label + ': ' + summary.hits + (summary.hits === 1 ? ' replacement' : ' replacements')];
    const speed = describeSpeed(summary);
    if (speed) parts.push(speed);
    if (summary.commaPauseMs) parts.push('comma ' + summary.commaPauseMs.value + ' ms');
    if (summary.periodPauseMs) parts.push('period ' + summary.periodPauseMs.value + ' ms');
    if (summary.unsupported.length) parts.push('the TTS server cannot set ' + summary.unsupported.join(', ') + ' yet');
    return parts.join(' · ');
}

export function validationRules() {
    return {
        schemaVersion: SCHEMA_VERSION,
        limits: { ...LIMITS },
        vowels: [...CMU_VOWELS],
        consonants: [...CMU_CONSONANTS],
        replaceKinds: [...REPLACE_KINDS],
        prosodyFields: [...PROSODY_FIELDS],
        submissionActions: [...SUBMISSION_ACTIONS],
        submissionApps: [...SUBMISSION_APPS],
        setIdPattern: SET_ID_RE.source,
        sourceIdPattern: SOURCE_ID_RE.source,
        entryIdPattern: ENTRY_ID_RE.source,
        matchTokenPattern: MATCH_TOKEN_RE.source,
    };
}
