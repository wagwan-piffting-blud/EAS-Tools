const MARKUP_RE = /<[^<>]+>/g;
const NEWLINE_RE = /[\r\n|]/g;
const SENTENCE_RE = /[^.!?\s][^.!?]*(?:[.!?](?!['"]?\s|$)[^.!?]*)*[.!?]?['"]?(?=\s|$)/g;
const WHITESPACE_RE = /\s+/g;
const SPACE_BEFORE_PUNCT_RE = /\s+(?=[,.;:!?])/g;
const BULLET_RE = /^[ \t]*(?:[*•◦▪‣⁃]|-(?!\d))[ \t]*/gm;

function capitalizeRun(text, capitalizeNext) {
    let out = '';
    let next = capitalizeNext;
    for (const ch of text.toLowerCase()) {
        if (/\s/.test(ch)) {
            next = true;
            out += ch;
        } else if (next) {
            const upper = ch.toUpperCase();
            out += [...upper].length === 1 ? upper : ch;
            next = false;
        } else {
            out += ch;
        }
    }
    return out;
}

export function capitalizeFully(text) {
    const value = String(text ?? '');
    let out = '';
    let pos = 0;
    let next = true;
    for (const match of value.matchAll(MARKUP_RE)) {
        out += capitalizeRun(value.slice(pos, match.index), next);
        out += match[0];
        next = true;
        pos = match.index + match[0].length;
    }
    return out + capitalizeRun(value.slice(pos), next);
}

export function removeBullets(text) {
    return String(text ?? '').replace(BULLET_RE, '');
}

function markupSpans(text) {
    const spans = [];
    let pos = 0;
    for (const match of text.matchAll(MARKUP_RE)) {
        if (match.index > pos) spans.push({ start: pos, end: match.index, bound: false });
        spans.push({ start: match.index, end: match.index + match[0].length, bound: true });
        pos = match.index + match[0].length;
    }
    if (pos < text.length) spans.push({ start: pos, end: text.length, bound: false });
    return spans;
}

export function sentenceRanges(text, spans) {
    const ranges = [...text.matchAll(SENTENCE_RE)].map((m) => [m.index, m.index + m[0].length]);
    for (const span of spans) {
        if (!span.bound) continue;
        const hits = ranges.filter((r) => r[0] < span.end && span.start < r[1]);
        if (hits.length) {
            const first = hits[0];
            const last = hits[hits.length - 1];
            first[0] = Math.min(first[0], span.start);
            first[1] = Math.max(last[1], span.end);
            for (const r of hits.slice(1)) ranges.splice(ranges.indexOf(r), 1);
            continue;
        }
        const following = ranges.find((r) => r[0] >= span.end);
        if (following) following[0] = span.start;
        else if (ranges.length) ranges[ranges.length - 1][1] = span.end;
        else ranges.push([span.start, span.end]);
    }
    return ranges;
}

export function bmhSentences(text) {
    const clean = String(text ?? '').replace(NEWLINE_RE, ' ').trim();
    const spans = markupSpans(clean);
    const sentences = [];
    for (const [start, end] of sentenceRanges(clean, spans)) {
        let joined = '';
        for (const span of spans) {
            if (span.end <= start || span.start >= end) continue;
            joined += span.bound
                ? clean.slice(span.start, span.end)
                : clean.slice(Math.max(start, span.start), Math.min(end, span.end));
        }
        const sentence = joined.replace(WHITESPACE_RE, ' ').replace(SPACE_BEFORE_PUNCT_RE, '').trim();
        if (sentence) sentences.push(sentence);
    }
    return sentences;
}

export function bmhTransform(text) {
    return bmhSentences(capitalizeFully(String(text ?? '').trim())).join(' ');
}

export function formatTtsReady(text) {
    return bmhTransform(removeBullets(text));
}
