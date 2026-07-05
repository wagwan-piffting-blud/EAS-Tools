let toARPABET = null;

export function setPhonemize(fn) {
    toARPABET = fn;
}

export const Backend = Object.freeze({
    VTML: "vtml",
    BAL: "bal",
    DT: "dt",
    ALL: "all",
});

export const BAL_SYMBOLS = new Set(["-", "!", "&", ",", ".", "?", "_"]);
export const BAL_STRESS = new Set(["1", "2"]);
export const BAL_PHONES = new Set([
    "aa", "ae", "ah", "ao", "aw", "ax", "ay",
    "b", "ch", "d", "dh",
    "eh", "er", "ey",
    "f", "g", "h",
    "ih", "iy",
    "jh", "k", "l", "m", "n", "ng",
    "ow", "oy", "p", "r", "s", "sh", "t", "th",
    "uh", "uw", "v", "w", "y", "z", "zh",
]);

const VTML_DOC_PHONES = new Set([
    "AA", "AE", "AH", "AO", "AW", "AY",
    "B", "CH", "D", "DH",
    "EH", "ER", "EY",
    "F", "G", "HH",
    "IH", "IY",
    "JH", "K", "L", "M", "N", "NG",
    "OW", "OY", "P", "Q", "R", "S", "SH", "T", "TH",
    "UH", "UW", "V", "W", "Y", "Z", "ZH",
]);

const VTML_SUPPORTED_PHONES = VTML_DOC_PHONES;

const DT_PHONES = new Set([
    "aa", "ae", "ah", "ao", "ar", "aw", "ax", "ay",
    "b", "ch", "d", "dh", "dx", "dz",
    "eh", "el", "en", "ey",
    "f", "g", "hx",
    "ih", "ir", "ix", "iy",
    "jh", "k", "l", "lx", "m", "n", "nx",
    "or", "ow", "oy", "p", "q", "r", "rr", "rx",
    "s", "sh", "t", "th", "tx",
    "uh", "ur", "uw",
    "v", "w", "yu", "yx", "z", "zh",
]);

export const BAL_ALIASES = Object.freeze({
    "hh": "h",
    "dx": "d",
    "el": "l",
    "em": "m",
    "en": "n",
    "ix": "ih",
    "axr": "er",
});


const DT_STRESS_PREFIX = new Set(["'", "`", '"']);
const DT_SYNTACTIC = new Set(["-", "*", "#", "(", ")", ",", ".", "?", "!", "+"]);

const DT_ALIASES = Object.freeze({
    "er": "rr",
});

const CMU_PARSE_ALIASES = Object.freeze({
    AXH: "AH",
    AHR: "AH",
    AOR: "AO",
    SAW: "AX",
    EHR: "EH",
    IHR: "IH",
    UHR: "UH",
    UX: "UW",
    WH: "W",
});

const CMU_EXPANSIONS = Object.freeze({
    UY: ["UW", "IY"],
    TS: ["T", "S"],
    IN: ["IY", "N"],
});

function phoneToken(cmu, stress = null) {
    return { type: "phone", cmu, stress };
}
function symToken(value) {
    return { type: "sym", value };
}

const CMU_VOWELS = new Set([
    "AA", "AE", "AH", "AO", "AW", "AX", "AY",
    "EH", "ER", "EY", "IH", "IY", "OW", "OY",
    "UH", "UW", "IX", "AXR",
]);

const CMU_TO_BAL = {
    AA: "aa", AE: "ae", AH: "ah", AO: "ao", AW: "aw", AX: "ax", AY: "ay",
    EH: "eh", ER: "er", EY: "ey", IH: "ih", IY: "iy", OW: "ow", OY: "oy",
    UH: "uh", UW: "uw",
    B: "b", CH: "ch", D: "d", DH: "dh",
    F: "f", G: "g",
    HH: "h",
    JH: "jh", K: "k", L: "l", M: "m", N: "n", NG: "ng",
    P: "p", R: "r", S: "s", SH: "sh", T: "t", TH: "th",
    V: "v", W: "w", Y: "y", Z: "z", ZH: "zh",
    DX: "d",
    EL: "l", EM: "m", EN: "n",
    IX: "ih",
    AXR: "er",
    WH: "w",
    Q: "k",
};

const BAL_TO_CMU = {
    aa: "AA", ae: "AE", ah: "AH", ao: "AO", aw: "AW", ax: "AX", ay: "AY",
    b: "B", ch: "CH", d: "D", dh: "DH",
    eh: "EH", er: "ER", ey: "EY",
    f: "F", g: "G", h: "HH",
    ih: "IH", iy: "IY",
    jh: "JH", k: "K", l: "L", m: "M", n: "N", ng: "NG",
    ow: "OW", oy: "OY", p: "P", r: "R", s: "S", sh: "SH", t: "T", th: "TH",
    uh: "UH", uw: "UW", v: "V", w: "W", y: "Y", z: "Z", zh: "ZH",
};

const CMU_TO_DT = {
    AA: "aa", AE: "ae", AH: "ah", AO: "ao", AW: "aw", AX: "ax", AY: "ay",
    EH: "eh", ER: "rr", EY: "ey", IH: "ih", IY: "iy", OW: "ow", OY: "oy",
    UH: "uh", UW: "uw", IX: "ix", AXR: "rr",

    B: "b", CH: "ch", D: "d", DH: "dh", F: "f", G: "g",
    HH: "hx", JH: "jh", K: "k", L: "l", M: "m", N: "n", NG: "nx",
    P: "p", R: "r", S: "s", SH: "sh", T: "t", TH: "th",
    V: "v", W: "w", Y: "yx", Z: "z", ZH: "zh",
    DX: "dx",
    EL: "el",
    EM: "m",
    EN: "en",
    WH: "w",
    Q: "q",
};

const DT_TO_CMU = {
    aa: "AA", ae: "AE", ah: "AH", ao: "AO", aw: "AW", ax: "AX", ay: "AY",
    eh: "EH", rr: "ER", ey: "EY", ih: "IH", iy: "IY", ow: "OW", oy: "OY",
    uh: "UH", uw: "UW", ix: "IX",

    b: "B", ch: "CH", d: "D", dh: "DH", f: "F", g: "G",
    hx: "HH", jh: "JH", k: "K", l: "L", m: "M", n: "N", nx: "NG",
    p: "P", r: "R", s: "S", sh: "SH", t: "T", th: "TH",
    v: "V", w: "W", yx: "Y", z: "Z", zh: "ZH",
    dx: "DX", el: "EL", en: "EN",

    ar: "AXR", ir: "AXR", or: "AXR", ur: "AXR",
    rx: "R", lx: "EL", yu: "UW",
    q: "T", tx: "T", dz: "Z", tz: "S", cz: "CH", df: "D",
};

const CMU_ORTHO_GUESS = Object.freeze({
    AA: "a", AE: "a", AH: "u", AO: "o", AW: "ow", AX: "a", AXR: "er", AY: "i",
    EH: "e", ER: "er", EY: "a", IH: "i", IX: "i", IY: "ee", OW: "o", OY: "oy",
    UH: "u", UW: "oo",

    B: "b", CH: "ch", D: "d", DH: "th", DX: "d", F: "f", G: "g", HH: "h",
    JH: "j", K: "k", L: "l", M: "m", N: "n", NG: "ng", P: "p", R: "r", S: "s",
    SH: "sh", T: "t", TH: "th", V: "v", W: "w", Y: "y", Z: "z", ZH: "zh",
    EL: "l", EM: "m", EN: "n",
});

const _reverseCache = new WeakMap();

const CMU_NORMALIZE = Object.freeze({
    AX: "AH",
    AXR: "ER",
    IX: "IH",
    DX: "D",
    EL: "L",
    EM: "M",
    EN: "N",
});

const CMU_FUZZY_NORMALIZE = Object.freeze({
    AE: "AH",
});

function normalizeCmuBase(base) {
    return CMU_NORMALIZE[base] ?? base;
}

function normalizeCmuForLookup(base, { fuzzy = false } = {}) {
    const normalized = normalizeCmuBase(base);
    if (!fuzzy) return normalized;
    return CMU_FUZZY_NORMALIZE[normalized] ?? normalized;
}

function normalizePhSeqFromTokens(tokens, { stripStress = true, fuzzy = false } = {}) {
    return tokens
        .filter(t => t.type === "phone")
        .map(t => {
            const cmu = normalizeCmuForLookup(t.cmu, { fuzzy });
            return stripStress ? cmu : `${cmu}${t.stress ?? ""}`;
        })
        .join(" ")
        .trim();
}

function normalizePhSeqString(seq, { stripStress = true, fuzzy = false } = {}) {
    return seq
        .trim()
        .split(/\s+/)
        .map(tok => {
            const m = tok.match(/^([A-Z]+)([012])?$/);
            if (!m) return tok;
            const base = normalizeCmuForLookup(m[1], { fuzzy });
            if (stripStress) return base;
            return `${base}${m[2] ?? ""}`;
        })
        .join(" ");
}

function getReverseLexicon(lexiconObj) {
    let cached = _reverseCache.get(lexiconObj);
    if (cached) return cached;

    const exact = new Map();
    const nostress = new Map();
    const fuzzy = new Map();

    for (const [word, ph] of Object.entries(lexiconObj)) {
        const w = word.toLowerCase();
        const p = String(ph).trim();
        if (!p) continue;

        exact.set(normalizePhSeqString(p, { stripStress: false }), w);
        nostress.set(normalizePhSeqString(p, { stripStress: true }), w);
        fuzzy.set(normalizePhSeqString(p, { stripStress: true, fuzzy: true }), w);
    }

    cached = { exact, nostress, fuzzy };
    _reverseCache.set(lexiconObj, cached);
    return cached;
}

const PHONE_CANDIDATES = Object.freeze({
    AA: ["a", "o"], AE: ["a"], AH: ["u", "o", "a"], AO: ["o", "aw"], AW: ["ow", "ou"],
    AX: ["a", "e", "i", "o", "u"], AY: ["i", "y", "igh", "ie"],
    EH: ["e", "ea"], ER: ["er", "ir", "ur"], EY: ["a", "ay", "ai", "ei"],
    IH: ["i", "e", "y"], IX: ["i", "e"], IY: ["ee", "ea", "ie", "y"],
    OW: ["o", "ow", "oa"], OY: ["oy", "oi"], UH: ["u", "oo"], UW: ["oo", "u", "ew"],
    B: ["b"], CH: ["ch", "tch"], D: ["d"], DH: ["th"], DX: ["d"],
    F: ["f", "ph"], G: ["g", "gh"], HH: ["h"], JH: ["j", "g", "dge"],
    K: ["k", "c", "ck", "q"], L: ["l"], M: ["m"], N: ["n"], NG: ["ng", "n"],
    P: ["p"], R: ["r", "wr"], S: ["s", "c"], SH: ["sh", "ti", "ci"],
    T: ["t"], TH: ["th"], V: ["v"], W: ["w"], Y: ["y"],
    Z: ["z", "s"], ZH: ["zh", "s", "g"],
    EL: ["l"], EM: ["m"], EN: ["n"],
});

const MULTI_PHONE_RULES = [
    { seq: ["S", "K", "AX"], outs: ["ska"], bonus: -5.0 },
    { seq: ["M", "AX", "HH"], outs: ["mah"], bonus: -5.0 },
    { seq: ["AW", "ER"], outs: ["ower"], bonus: -3.5 },
    { seq: ["K", "S"], outs: ["x"], bonus: -3.0 },
    { seq: ["K", "W"], outs: ["qu"], bonus: -1.5 },
];


const COMMON_BIGRAMS = new Set([
    "th", "he", "in", "er", "an", "re", "on", "at", "en", "nd", "ti", "es", "or", "te", "of", "ed", "is", "it", "al", "ar", "st", "to", "nt", "ng", "se", "ha", "as", "ou", "io",
    "me", "ex", "xi", "ic", "co",
    "ca", "ce", "ci", "co", "cu", "ra", "ri", "ro", "ru", "la", "li", "lo", "lu",
]);

function scoreWord(w) {
    let s = 0;

    for (let i = 0; i < w.length; i++) {
        if (w[i] === "q" && w[i + 1] !== "u") s += 6;
    }

    if (/(.)\1\1/.test(w)) s += 4;
    if (/jj|vv|ww/.test(w)) s += 3;

    for (let i = 0; i < w.length - 1; i++) {
        const bi = w.slice(i, i + 2);
        if (!COMMON_BIGRAMS.has(bi)) s += 0.35;
    }

    if (!/[aeiouy]/.test(w)) s += 10;

    return s;
}

function beamSpell(phones, beamWidth = 48) {
    let beams = [{ w: "", score: 0 }];

    for (let i = 0; i < phones.length;) {
        const nextBeams = [];

        let usedMulti = false;
        let matched = [];
        let maxLen = 0;

        for (const rule of MULTI_PHONE_RULES) {
            const { seq } = rule;
            if (i + seq.length <= phones.length && seq.every((p, k) => phones[i + k] === p)) {
                matched.push(rule);
                if (seq.length > maxLen) maxLen = seq.length;
            }
        }

        if (maxLen > 0) {
            matched = matched.filter(r => r.seq.length === maxLen);

            const nextBeams = [];
            for (const r of matched) {
                for (const b of beams) {
                    for (const out of r.outs) {
                        const w2 = b.w + out;
                        nextBeams.push({ w: w2, score: scoreWord(w2) + r.bonus });
                    }
                }
            }

            beams = nextBeams.sort((a, b) => a.score - b.score).slice(0, beamWidth);
            i += maxLen;
            continue;
        }


        if (usedMulti) {
            i += MULTI_PHONE_RULES.find(r => r.seq.every((p, k) => phones[i + k] === p))?.seq.length ?? 1;
            beams = nextBeams.sort((a, b) => a.score - b.score).slice(0, beamWidth);
            continue;
        }

        const ph = phones[i];
        const cands =
            PHONE_CANDIDATES[ph] ??
            [CMU_ORTHO_GUESS[ph] ?? ph.toLowerCase()];

        for (const b of beams) {
            for (const out of cands) {
                let o = out;
                if (ph === "K") {
                    const next = phones[i + 1];
                    if (next === "OW" || next === "AO" || next === "AA" || next === "UH" || next === "UW") {
                        if (out === "c") o = "c";
                    }
                }

                const w2 = b.w + o;
                let sc = scoreWord(w2);

                if (ph === "AX") {
                    const prev = phones[i - 1];
                    const next = phones[i + 1];

                    if (i === 1 && prev === "N") {
                        if (o === "e") sc -= 1.8;
                        if (o === "a") sc += 1.0;
                    }

                    if (next === "HH") {
                        if (o === "a") sc -= 1.6;
                        if (o === "e") sc += 1.0;
                        if (o === "i") sc += 1.0;
                    }
                }

                if (ph === "K" && o === "k") {
                    const next = phones[i + 1];
                    if (next === "OW" || next === "AO" || next === "AA" || next === "UH" || next === "UW") sc += 0.8;
                }

                nextBeams.push({ w: w2, score: sc });
            }
        }

        beams = nextBeams.sort((a, b) => a.score - b.score).slice(0, beamWidth);
        i += 1;
    }

    return beams[0]?.w ?? "";
}

function invertMap(obj) {
    const out = {};
    for (const [k, v] of Object.entries(obj)) {
        out[v] = k;
    }
    return out;
}

function splitCmuToken(tok) {
    const raw = String(tok ?? "").trim().toUpperCase();
    if (!raw) return null;
    const m = raw.match(/^([A-Z]+)([012])?$/);
    if (!m) return null;
    const base = CMU_PARSE_ALIASES[m[1]] ?? m[1];
    const stress = m[2] != null ? Number(m[2]) : null;
    return { base, stress };
}

function backendName(backend) {
    if (backend === Backend.VTML) return "VTML";
    if (backend === Backend.BAL) return "BAL";
    if (backend === Backend.DT) return "DT";
    return String(backend ?? "");
}

function resolveBalPhone(cmu) {
    return (
        CMU_TO_BAL[cmu] ??
        CMU_TO_BAL[normalizeCmuBase(cmu)] ??
        CMU_TO_BAL[CMU_PARSE_ALIASES[cmu] ?? cmu] ??
        null
    );
}

function resolveDtPhone(cmu) {
    return (
        CMU_TO_DT[cmu] ??
        CMU_TO_DT[normalizeCmuBase(cmu)] ??
        CMU_TO_DT[CMU_PARSE_ALIASES[cmu] ?? cmu] ??
        null
    );
}

function resolveVtmlPhone(cmu) {
    const direct = String(CMU_PARSE_ALIASES[cmu] ?? cmu ?? "").toUpperCase();
    if (VTML_SUPPORTED_PHONES.has(direct)) return direct;

    const normalized = String(normalizeCmuBase(direct) ?? "").toUpperCase();
    if (VTML_SUPPORTED_PHONES.has(normalized)) return normalized;

    return null;
}

function canonicalForBackend(tokens, backend) {
    if (backend !== Backend.VTML) return tokens;

    return tokens.map(t => {
        if (t.type !== "phone") return t;
        const mapped = resolveVtmlPhone(t.cmu);
        if (!mapped || mapped === t.cmu) return t;
        return phoneToken(mapped, t.stress);
    });
}

function validateCanonicalForBackend(tokens, backend) {
    const issues = [];

    for (const t of tokens) {
        if (t.type !== "phone") continue;

        if (backend === Backend.VTML) {
            const base = resolveVtmlPhone(t.cmu);
            if (!base) {
                const raw = String(CMU_PARSE_ALIASES[t.cmu] ?? t.cmu ?? "").toUpperCase();
                issues.push(`${t.cmu} (unsupported VTML token ${raw})`);
            }
            continue;
        }

        if (backend === Backend.BAL) {
            const base = resolveBalPhone(t.cmu);
            if (!base) {
                issues.push(`${t.cmu} (no BAL mapping)`);
                continue;
            }
            if (!BAL_PHONES.has(base)) {
                issues.push(`${t.cmu} (maps to unsupported BAL token ${base})`);
            }
            continue;
        }

        if (backend === Backend.DT) {
            const base = resolveDtPhone(t.cmu);
            if (!base) {
                issues.push(`${t.cmu} (no DT mapping)`);
                continue;
            }
            if (!DT_PHONES.has(base)) {
                issues.push(`${t.cmu} (maps to unsupported DT token ${base})`);
            }
        }
    }

    if (issues.length) {
        throw new Error(
            `Unsupported phoneme token(s) for ${backendName(backend)} word output: ${[...new Set(issues)].join(", ")}`
        );
    }
}

export function parseVTML(input) {
    let ph = input;
    const m = input.match(/ph\s*=\s*"([^"]+)"/i);
    if (m) ph = m[1];

    const tokens = ph.trim().split(/\s+/).filter(Boolean);
    const out = [];
    for (const t of tokens) {
        if (BAL_SYMBOLS.has(t)) {
            out.push(symToken(t));
            continue;
        }
        const parsed = splitCmuToken(t);
        if (!parsed) continue;
        const { base, stress } = parsed;

        const expansion = CMU_EXPANSIONS[base];
        if (expansion) {
            let vowelSeen = false;
            for (const expBase of expansion) {
                if (CMU_VOWELS.has(expBase)) {
                    out.push(phoneToken(expBase, vowelSeen ? 0 : (stress ?? 0)));
                    vowelSeen = true;
                } else {
                    out.push(phoneToken(expBase, null));
                }
            }
            continue;
        }

        out.push(phoneToken(base, CMU_VOWELS.has(base) ? (stress ?? 0) : null));
    }
    return out;
}

export function parseBalabolka(input) {
    let body = input;
    const m = input.match(/sym\s*=\s*["']([^"']+)["']/i);
    if (m) body = m[1];

    const tokens = body.trim().split(/\s+/).filter(Boolean);
    const out = [];
    let pendingStress = null;

    for (const raw of tokens) {
        if (BAL_SYMBOLS.has(raw)) {
            out.push(symToken(raw));
            continue;
        }

        if (BAL_STRESS.has(raw)) {
            const stressNum = Number(raw);
            const prev = out[out.length - 1];
            if (prev?.type === "phone" && CMU_VOWELS.has(prev.cmu)) {
                prev.stress = stressNum;
            } else {
                pendingStress = stressNum;
            }
            continue;
        }

        const m = raw.match(/^([a-z]+)([12])$/);
        let base = raw;
        let stress = null;
        if (m) {
            base = m[1];
            stress = Number(m[2]);
        }

        base = BAL_ALIASES[base] ?? base;

        if (!BAL_PHONES.has(base)) {
            out.push(symToken(raw));
            continue;
        }

        const cmu = BAL_TO_CMU[base] ?? base.toUpperCase();
        const isVowel = CMU_VOWELS.has(cmu);
        const finalStress =
            isVowel ? (stress ?? pendingStress ?? 0) : null;

        out.push(phoneToken(cmu, finalStress));
        pendingStress = null;
    }

    return out;
}

export function parseDectalk(input) {
    let body = input;
    const groups = [...input.matchAll(/\[([^\]]+)\]/g)].map(m => m[1]);
    if (groups.length) body = groups[groups.length - 1];

    const tokens = body.trim().split(/\s+/).filter(Boolean);
    const out = [];
    let pendingStress = null;

    for (let tok of tokens) {
        if (DT_SYNTACTIC.has(tok)) {
            out.push(symToken(tok));
            continue;
        }

        while (tok.length && DT_STRESS_PREFIX.has(tok[0])) {
            const ch = tok[0];
            if (ch === "'") pendingStress = 1;
            else if (ch === "`") pendingStress = 2;
            tok = tok.slice(1);
        }

        const dt = tok.toLowerCase();
        const dtNorm = DT_ALIASES[dt] ?? dt;
        const cmu = DT_TO_CMU[dtNorm];

        if (!cmu) {
            out.push(symToken(tok));
            pendingStress = null;
            continue;
        }

        const isVowel = CMU_VOWELS.has(cmu);
        out.push(phoneToken(cmu, isVowel ? (pendingStress ?? 0) : null));
        pendingStress = null;
    }

    return out;
}

export function emitVTML(tokens, { wrapTag = false, text = "" } = {}) {
    const ph = tokens
        .filter(t => t.type === "phone")
        .map(t => {
            if (t.type !== "phone") return "";
            if (t.stress == null) return t.cmu;
            return `${t.cmu}${t.stress}`;
        })
        .join(" ");

    if (!wrapTag) return ph;
    return `<vtml_phoneme alphabet="x-cmu" ph="${ph}">${escapeXml(text)}</vtml_phoneme>`;
}

export function emitBalabolka(tokens, { stressStyle = "separate" } = {}) {
    const out = [];
    for (const t of tokens) {
        if (t.type === "sym") {
            out.push(t.value);
            continue;
        }
        const base =
            resolveBalPhone(t.cmu);
        if (!base) {
            out.push(String(t.cmu ?? "").toLowerCase());
            continue;
        }

        if (t.stress != null && t.stress !== 0) {
            if (stressStyle === "suffix") out.push(`${base}${t.stress}`);
            else { out.push(base); out.push(String(t.stress)); }
        } else {
            out.push(base);
        }
    }
    const body = out.join(" ").replace(/\s+/g, " ").trim();
    return `<pron sym="${body}" />`;
}

export function emitDectalk(tokens, { wrapBrackets = true } = {}) {
    const out = [];
    for (const t of tokens) {
        if (t.type === "sym") {
            out.push(t.value);
            continue;
        }
        const base =
            resolveDtPhone(t.cmu);
        if (!base) {
            out.push(String(t.cmu ?? "").toLowerCase());
            continue;
        }

        if (t.stress === 1) out.push(`'${base}`);
        else if (t.stress === 2) out.push("`" + base);
        else out.push(base);
    }

    const body = out.join(" ").replace(/\s+/g, " ").trim();
    return wrapBrackets ? `[:phoneme on] [${body}]` : body;
}

function parseByBackend(input, backend) {
    if (backend === Backend.VTML) return parseVTML(input);
    if (backend === Backend.BAL) return parseBalabolka(input);
    if (backend === Backend.DT) return parseDectalk(input);
    if (backend === Backend.ALL) {
        let output = "";
        try {
            output += parseVTML(input);
        } catch { /* ignore */ }
        try {
            output += parseBalabolka(input);
        } catch { /* ignore */ }
        try {
            output += parseBalabolka(input);
        } catch { /* ignore */ }
        try {
            output += parseDectalk(input);
        } catch { /* ignore */ }
        return output.trim();
    }
    throw new Error(`Unknown source backend: ${backend}`);
}

function normalizeBackend(backend) {
    const value = String(backend ?? "").trim().toLowerCase();
    if (value === Backend.VTML || value === "cmu" || value === "x-cmu" || value === "arpabet") return Backend.VTML;
    if (value === Backend.BAL || value === "balabolka") return Backend.BAL;
    if (value === Backend.DT || value === "dectalk" || value === "dec-talk") return Backend.DT;
    if (value === Backend.ALL || value === "*") return Backend.ALL;
    return value;
}

const PUNC_KEEP = new Set([",", ".", "?", "!", "-", "&", "_"]);

function tokenizeText(input) {
    const s = String(input ?? "");
    const out = [];

    try {
        const re = /(\p{L}+(?:[’']\p{L}+)*)|(\p{N}+)|([^\s])/gu;
        for (const m of s.matchAll(re)) {
            if (m[1]) out.push({ kind: "word", value: m[1] });
            else if (m[2]) out.push({ kind: "word", value: m[2] });
            else if (m[3]) out.push({ kind: "punc", value: m[3] });
        }
        return out;
    } catch {
        const re = /([A-Za-z0-9]+(?:[’'][A-Za-z0-9]+)*)|([^\s])/g;
        for (const m of s.matchAll(re)) {
            if (m[1]) out.push({ kind: "word", value: m[1] });
            else if (m[2]) out.push({ kind: "punc", value: m[2] });
        }
        return out;
    }
}

function tailMatchesPhones(tokens, bases) {
    if (tokens.length < bases.length) return false;
    const start = tokens.length - bases.length;
    for (let i = 0; i < bases.length; i++) {
        const tok = tokens[start + i];
        if (!tok || tok.type !== "phone" || tok.cmu !== bases[i]) return false;
    }
    return true;
}

function fixWordCanonBySpelling(word, tokens) {
    const lower = String(word ?? "").toLowerCase();
    if (!tokens?.length) return tokens;

    const out = tokens.map(t => ({ ...t }));

    const replaceTail = (len, replacement) => {
        out.splice(out.length - len, len, ...replacement);
    };

    if (lower.endsWith("holic")) {
        if (tailMatchesPhones(out, ["HH", "OW", "L", "IY", "S", "IY"]) ||
            tailMatchesPhones(out, ["HH", "AA", "L", "IY", "S", "IY"]) ||
            tailMatchesPhones(out, ["HH", "AH", "L", "IY", "S", "IY"])) {
            const suffixVowel = out[out.length - 5];
            const holicStress = suffixVowel?.stress ?? 0;
            replaceTail(6, [
                phoneToken("HH", null),
                phoneToken("AA", holicStress),
                phoneToken("L", null),
                phoneToken("IH", 0),
                phoneToken("K", null),
            ]);
        } else if (tailMatchesPhones(out, ["L", "IY", "S", "IY"])) {
            const suffixVowel = out[out.length - 3];
            const licStress = suffixVowel?.stress ?? 0;
            replaceTail(4, [
                phoneToken("L", null),
                phoneToken("IH", licStress),
                phoneToken("K", null),
            ]);
        }

        if (tailMatchesPhones(out, ["HH", "OW", "L", "IH", "K"]) ||
            tailMatchesPhones(out, ["HH", "AH", "L", "IH", "K"])) {
            const hhVowel = out[out.length - 4];
            out[out.length - 4] = phoneToken("AA", hhVowel?.stress ?? 0);
        }
    }

    if (lower.endsWith("ic")) {
        if (tailMatchesPhones(out, ["L", "IY", "S", "IY"])) {
            const suffixVowel = out[out.length - 3];
            const licStress = suffixVowel?.stress ?? 0;
            replaceTail(4, [
                phoneToken("L", null),
                phoneToken("IH", licStress),
                phoneToken("K", null),
            ]);
        } else if (tailMatchesPhones(out, ["IY", "S", "IY"])) {
            const suffixVowel = out[out.length - 3];
            const icStress = suffixVowel?.stress ?? 0;
            replaceTail(3, [
                phoneToken("IH", icStress),
                phoneToken("K", null),
            ]);
        }
    }

    return out;
}

function phraseToCanonical(rawText, overrides) {
    const toks = tokenizeText(rawText);

    const canonical = [];
    for (const t of toks) {
        if (t.kind === "word") {
            const key = t.value.toLowerCase();
            let arpabet = overrides?.[key];

            if (!arpabet) {
                if (!toARPABET) {
                    throw new Error("phonemize not set. Call setPhonemize(toARPABET) first, or pass an override.");
                }
                arpabet = toARPABET(t.value, { stripStress: false });
            }

            const wordCanon = fixWordCanonBySpelling(t.value, parseVTML(arpabet));
            canonical.push(...wordCanon);
            continue;
        }

        if (PUNC_KEEP.has(t.value)) {
            canonical.push(symToken(t.value));
        } else if (t.value === ";" || t.value === ":") {
            canonical.push(symToken(","));
        }
    }

    return canonical;
}

export function convertPhonemes(input, {
    lexicon = null,
    beamWidth = 48,
} = {}) {
    const backends = [Backend.VTML, Backend.BAL, Backend.DT];

    const candidates = [];
    for (const backend of backends) {
        try {
            const tokens = parseByBackend(input, backend);
            const phones = tokens.filter(t => t.type === "phone");
            if (!phones.length) continue;
            candidates.push({
                backend,
                tokens,
                phoneCount: phones.length,
                tokenCount: tokens.length,
            });
        } catch { /* ignore */ }
    }

    if (!candidates.length) return "";

    candidates.sort((a, b) => (
        b.phoneCount - a.phoneCount ||
        b.tokenCount - a.tokenCount
    ));

    for (const candidate of candidates) {
        const tokens = candidate.tokens;

        if (lexicon) {
            const rev = getReverseLexicon(lexicon);
            const withStress = normalizePhSeqFromTokens(tokens, { stripStress: false });
            const noStress = normalizePhSeqFromTokens(tokens, { stripStress: true });
            const fuzzyNoStress = normalizePhSeqFromTokens(tokens, { stripStress: true, fuzzy: true });

            const hit =
                rev.exact.get(withStress) ??
                rev.nostress.get(noStress) ??
                rev.fuzzy.get(fuzzyNoStress);

            if (hit) return hit;
        }

        const phones = tokens
            .filter(t => t.type === "phone")
            .map(t => normalizeCmuBase(t.cmu));

        if (!phones.length) continue;

        const guess = beamSpell(phones, beamWidth);
        if (guess) return guess;
    }

    return "";
}

export function wordToBackend(word, backend, {
    overrides = {},
    ...emitOpts
} = {}) {
    const raw = String(word ?? "").trim();
    if (!raw) return "";

    const phraseKey = raw.toLowerCase();
    let canonical;

    if (overrides[phraseKey]) {
        canonical = parseVTML(overrides[phraseKey]);
    } else {
        canonical = phraseToCanonical(raw, overrides);
    }

    if (backend === Backend.VTML) {
        const prepared = canonicalForBackend(canonical, Backend.VTML);
        validateCanonicalForBackend(prepared, Backend.VTML);
        return emitVTML(prepared, { wrapTag: true, text: raw, ...emitOpts });
    }
    if (backend === Backend.BAL) {
        validateCanonicalForBackend(canonical, Backend.BAL);
        return emitBalabolka(canonical, emitOpts);
    }
    if (backend === Backend.DT) {
        validateCanonicalForBackend(canonical, Backend.DT);
        return emitDectalk(canonical, emitOpts);
    }
    if (backend === Backend.ALL) {
        const lines = [];

        try {
            const vtmlCanonical = canonicalForBackend(canonical, Backend.VTML);
            validateCanonicalForBackend(vtmlCanonical, Backend.VTML);
            lines.push("VTML: " + emitVTML(vtmlCanonical, { wrapTag: true, text: raw, ...emitOpts }));
        } catch (err) {
            lines.push(`VTML: [ERROR] ${err.message}`);
        }

        try {
            validateCanonicalForBackend(canonical, Backend.BAL);
            lines.push("BAL:  " + emitBalabolka(canonical, emitOpts));
        } catch (err) {
            lines.push(`BAL:  [ERROR] ${err.message}`);
        }

        try {
            validateCanonicalForBackend(canonical, Backend.DT);
            lines.push("DT:   " + emitDectalk(canonical, emitOpts));
        } catch (err) {
            lines.push(`DT:   [ERROR] ${err.message}`);
        }

        return lines.join("\n\n").trim();
    }
    throw new Error(`Unknown backend: ${backend}`);
}

export function crossPhonemes(input, fromBackend, toBackend, emitOpts = {}) {
    const raw = String(input ?? "").trim();
    if (!raw) return "";

    const from = normalizeBackend(fromBackend);
    const to = normalizeBackend(toBackend);

    const validBackends = new Set([Backend.VTML, Backend.BAL, Backend.DT]);
    if (from !== Backend.ALL && !validBackends.has(from)) {
        throw new Error(`Unknown source backend: ${fromBackend}`);
    }
    if (to !== Backend.ALL && !validBackends.has(to)) {
        throw new Error(`Unknown target backend: ${toBackend}`);
    }

    const parseCandidates = [];
    const fromCandidates = from === Backend.ALL
        ? [Backend.VTML, Backend.BAL, Backend.DT]
        : [from];

    for (const candidate of fromCandidates) {
        try {
            const tokens = parseByBackend(raw, candidate);
            const phoneCount = tokens.filter(t => t.type === "phone").length;
            if (phoneCount > 0) {
                parseCandidates.push({ tokens, phoneCount, tokenCount: tokens.length });
            }
        } catch (err) {
            if (from !== Backend.ALL) throw err;
        }
    }

    if (!parseCandidates.length) {
        throw new Error(`No recognizable phonemes found for source backend: ${fromBackend}`);
    }

    parseCandidates.sort((a, b) => (
        b.phoneCount - a.phoneCount ||
        b.tokenCount - a.tokenCount
    ));
    const canonical = parseCandidates[0].tokens;

    function emitTo(backend) {
        if (backend === Backend.VTML) {
            const prepared = canonicalForBackend(canonical, Backend.VTML);
            validateCanonicalForBackend(prepared, Backend.VTML);
            const wrapTag = emitOpts.wrapTag ?? true;
            if (!wrapTag) return emitVTML(prepared, emitOpts);

            let text = String(emitOpts.text ?? "").trim();
            if (!text) {
                try {
                    text = convertPhonemes(raw, {
                        lexicon: emitOpts.lexicon ?? null,
                        beamWidth: emitOpts.beamWidth ?? 48,
                    });
                } catch {
                    text = "";
                }
            }

            return emitVTML(prepared, { ...emitOpts, wrapTag: true, text });
        }
        if (backend === Backend.BAL) return emitBalabolka(canonical, emitOpts);
        if (backend === Backend.DT) return emitDectalk(canonical, emitOpts);
        throw new Error(`Unknown target backend: ${backend}`);
    }

    if (to === Backend.ALL) {
        let output = "";
        output += "VTML: " + emitTo(Backend.VTML) + "\n\n";
        output += "BAL:  " + emitTo(Backend.BAL) + "\n\n";
        output += "DT:   " + emitTo(Backend.DT);
        return output.trim();
    }

    return emitTo(to);
}

function escapeXml(s) {
    return String(s)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&apos;");
}
