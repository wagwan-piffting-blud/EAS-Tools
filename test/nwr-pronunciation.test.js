import { describe, expect, it } from 'vitest';
import {
    applyPronunciations,
    combineSpeed,
    compileMatcher,
    entryKey,
    escapeXml,
    formatSourceId,
    isEligibleVoice,
    lexiconFromSet,
    matchTokens,
    mergeLayers,
    parseSourceId,
    planRemoteSpeech,
    renderReplacement,
    resolveProsody,
    segmentVtml,
    setIdForSource,
    slugifyMatch,
    summarizePlan,
    describeSpeed,
    validateEntry,
    validatePhonemeString,
    validateProsody,
    validatePronunciationSet,
    validateVtmlMarkup,
    validationRules,
    LIMITS,
} from '../assets/js/nwr-pronunciation.js';

const ph = (id, match, phones, extra = {}) => ({ id, match, replace: { kind: 'phoneme', ph: phones }, ...extra });
const respell = (id, match, text, extra = {}) => ({ id, match, replace: { kind: 'respell', text }, ...extra });
const matcherFor = (entries, layer = 'national') => compileMatcher(mergeLayers([{ layer, entries }]));
const apply = (text, entries) => applyPronunciations(text, matcherFor(entries)).text;

function makeSet(id, entries = [], prosody = undefined) {
    const [type, sid] = id.split('/');
    const scope = type === 'national' ? { type } : type === 'tx' ? { type, id: sid, wfo: 'LMK' } : { type, id: sid };
    const set = { schemaVersion: 1, id, scope, rev: 1, voices: ['paul'], entries };
    if (prosody !== undefined) set.prosody = prosody;
    return set;
}

describe('ids and helpers', () => {
    it('parses and formats source ids', () => {
        expect(parseSourceId('')).toEqual({ type: 'national', id: '' });
        expect(parseSourceId('national')).toEqual({ type: 'national', id: '' });
        expect(parseSourceId('wfo:LOT')).toEqual({ type: 'wfo', id: 'LOT' });
        expect(parseSourceId('tx:WNG570')).toEqual({ type: 'tx', id: 'WNG570' });
        expect(parseSourceId('wfo:lot')).toBeNull();
        expect(parseSourceId('tx:TOOLONG12')).toBeNull();
        expect(formatSourceId('wfo', 'lot')).toBe('wfo:LOT');
        expect(formatSourceId('national')).toBe('');
        expect(formatSourceId('wfo', 'LOTX')).toBeNull();
        expect(setIdForSource('tx:KEC76')).toBe('tx/KEC76');
        expect(setIdForSource('')).toBe('national');
        expect(setIdForSource('bogus')).toBeNull();
    });

    it('slugifies, keys and tokenizes matches', () => {
        expect(slugifyMatch("  D'Hanis  ")).toBe('dhanis');
        expect(slugifyMatch('Santa Fe River')).toBe('santa-fe-river');
        expect(slugifyMatch('!!!')).toBe('entry');
        expect(slugifyMatch('a'.repeat(70))).toHaveLength(64);
        expect(entryKey({ match: 'Inland', caseSensitive: true })).toBe('cs:Inland');
        expect(entryKey({ match: ' Inland  Waters ' })).toBe('inland waters');
        expect(matchTokens('')).toEqual([]);
        expect(escapeXml('a<b>&"')).toBe('a&lt;b&gt;&amp;&quot;');
    });

    it('limits eligibility to VT Paul', () => {
        expect(isEligibleVoice('paul', 'VT')).toBe(true);
        expect(isEligibleVoice('PAUL', 'vt')).toBe(true);
        expect(isEligibleVoice('james', 'VT')).toBe(false);
        expect(isEligibleVoice('VW Violeta', 'VT')).toBe(false);
        expect(isEligibleVoice('paul', 'BAL')).toBe(false);
        expect(isEligibleVoice('', 'VT')).toBe(false);
        expect(isEligibleVoice('james', 'VT', ['james'])).toBe(true);
        expect(isEligibleVoice('paul', 'VT', 'nope')).toBe(true);
    });

    it('exports rules for the server port', () => {
        const rules = validationRules();
        expect(rules.vowels).toContain('AX');
        expect(rules.limits.matchChars).toBe(LIMITS.matchChars);
        expect(new RegExp(rules.setIdPattern).test('wfo/LOT')).toBe(true);
    });
});

describe('validation', () => {
    it('checks CMU phoneme strings', () => {
        expect(validatePhonemeString('TH AH1 N D ER0 S T OW0 R M')).toEqual([]);
        expect(validatePhonemeString('D UW1 # N AA1 T')).toEqual([]);
        expect(validatePhonemeString('P AA1 T AX W AA T')).toEqual([]);
        expect(validatePhonemeString('TH AH2 N D ER S T AR2 R M')).toEqual(['unknown phone AR2']);
        expect(validatePhonemeString('K1 AE')).toEqual(['consonant K1 cannot carry stress']);
        expect(validatePhonemeString('QQ')).toEqual(['unknown phone QQ']);
        expect(validatePhonemeString('  ')).toEqual(['phoneme string is empty']);
        expect(validatePhonemeString('AA '.repeat(120))[0]).toMatch(/longer than/);
    });

    it('whitelists VTML markup', () => {
        expect(validateVtmlMarkup('{{match}}<vtml_pause time="0"/>')).toEqual([]);
        expect(validateVtmlMarkup('D <vtml_phoneme alphabet="x-cmu" ph="HH AE1 N IH Z"></vtml_phoneme>')).toEqual([]);
        expect(validateVtmlMarkup('pet<vtml_break level="0"/>toskey')).toEqual([]);
        expect(validateVtmlMarkup('<vtml_phoneme alphabet="x-CMU" ph="AA1"/>')).toEqual([]);
        expect(validateVtmlMarkup('')).toEqual(['markup is empty']);
        expect(validateVtmlMarkup('<script>x</script>')[0]).toMatch(/not allowed/);
        expect(validateVtmlMarkup('<vtml_pause time="9000"/>')[0]).toMatch(/time=/);
        expect(validateVtmlMarkup('<vtml_pause time="10">')).toContain('vtml_pause must be self-closing');
        expect(validateVtmlMarkup('<vtml_break level="5"/>')[0]).toMatch(/level=/);
        expect(validateVtmlMarkup('<vtml_break level="1">')).toContain('vtml_break must be self-closing');
        expect(validateVtmlMarkup('<vtml_phoneme alphabet="ipa" ph="AA">x</vtml_phoneme>')[0]).toMatch(/x-cmu/);
        expect(validateVtmlMarkup('<vtml_phoneme alphabet="x-cmu" ph="AR2">x</vtml_phoneme>')).toContain('vtml_phoneme: unknown phone AR2');
        expect(validateVtmlMarkup('<vtml_phoneme alphabet="x-cmu" ph="AA">x')).toContain('unclosed <vtml_phoneme>');
        expect(validateVtmlMarkup('x</vtml_phoneme>')).toContain('unbalanced </vtml_phoneme>');
        expect(validateVtmlMarkup('</vtml_phoneme x="1">')).toContain('malformed closing tag </vtml_phoneme x="1">');
        expect(validateVtmlMarkup('a > b')).toContain('stray >');
        expect(validateVtmlMarkup('a & b')[0]).toMatch(/may not contain/);
        expect(validateVtmlMarkup('<vtml_pause time=0/>')[0]).toMatch(/unreadable attributes/);
        expect(validateVtmlMarkup('<vtml_pause time="1" time="2"/>')[0]).toMatch(/unreadable attributes/);
        expect(validateVtmlMarkup('<1bad>')[0]).toMatch(/unreadable tag/);
        expect(validateVtmlMarkup('x'.repeat(301))[0]).toMatch(/longer than/);
    });

    it('validates entries', () => {
        expect(validateEntry(ph('illinois', 'Illinois', 'IH1 L IH0 N OY1'))).toEqual([]);
        expect(validateEntry(ph('wind-down', 'wind down', 'W AY2 N D', { replace: { kind: 'phoneme', ph: 'W AY2 N D', on: 'wind' } }))).toEqual([]);
        expect(validateEntry({ id: 'x', match: 'wind down', replace: { kind: 'phoneme', ph: 'W', on: 'up' } })[0].problem).toMatch(/on must be/);
        expect(validateEntry(null)).toEqual([{ path: 'entry', problem: 'entry must be an object' }]);
        const bad = validateEntry({ id: 'Bad Id', match: ' x  y', caseSensitive: 'yes', verified: 1, replace: { kind: 'other' }, notes: 5, sources: 'p3' });
        const paths = bad.map((p) => p.path);
        expect(paths).toEqual(expect.arrayContaining(['entry.id', 'entry.match', 'entry.caseSensitive', 'entry.verified', 'entry.replace.kind', 'entry.notes', 'entry.sources']));
        expect(validateEntry({ id: 'x', match: '', replace: { kind: 'respell', text: 'a' } })[0].problem).toBe('match is empty');
        expect(validateEntry({ id: 'x', match: 'a '.repeat(9).trim(), replace: { kind: 'respell', text: 'a' } })[0].problem).toMatch(/more than 8/);
        expect(validateEntry({ id: 'x', match: 'x'.repeat(81), replace: { kind: 'respell', text: 'a' } })[0].problem).toMatch(/longer than/);
        expect(validateEntry({ id: 'x', match: '-bad', replace: { kind: 'respell', text: 'a' } })[0].problem).toMatch(/start and end/);
        expect(validateEntry({ id: 'x', match: 'ok', replace: null })[0].problem).toBe('replace must be an object');
        expect(validateEntry({ id: 'x', match: 'ok', replace: { kind: 'respell', text: ' ' } })[0].problem).toBe('respelling is empty');
        expect(validateEntry({ id: 'x', match: 'ok', replace: { kind: 'respell', text: '<b>' } })[0].problem).toMatch(/may not contain/);
        expect(validateEntry({ id: 'x', match: 'ok', replace: { kind: 'respell', text: 'a'.repeat(121) } })[0].problem).toMatch(/longer than/);
        expect(validateEntry({ id: 'x', match: 'ok', replace: { kind: 'vtml', markup: '<b/>' } })[0].path).toBe('entry.replace.markup');
        expect(validateEntry({ id: 'x', match: 'ok', disabled: true }, 'entry', { personal: true })).toEqual([]);
        expect(validateEntry({ id: 'x', match: 'ok', disabled: true, replace: { kind: 'zzz' } }, 'entry', { personal: true })).toHaveLength(1);
    });

    it('validates variants', () => {
        const base = respell('illinois', 'Illinois', 'Illynois');
        expect(validateEntry({ ...base, variants: [{ id: 'phoneme', label: 'Phoneme', context: 'various', replace: { kind: 'phoneme', ph: 'IH1 L IH N OY1' } }] })).toEqual([]);
        expect(validateEntry({ ...base, variants: 'x' })[0].path).toBe('entry.variants');
        expect(validateEntry({ ...base, variants: new Array(9).fill({}) })[0].path).toBe('entry.variants');
        expect(validateEntry({ ...base, variants: [null] })[0].problem).toBe('variant must be an object');
        const problems = validateEntry({ ...base, variants: [{ id: 'X', label: 'x'.repeat(81), replace: { kind: 'respell', text: '' } }] });
        expect(problems.map((p) => p.path)).toEqual(['entry.variants[0].id', 'entry.variants[0].label', 'entry.variants[0].replace.text']);
    });

    it('validates prosody', () => {
        expect(validateProsody(null)).toEqual([]);
        expect(validateProsody({ speed: { value: 113, verified: true }, commaPauseMs: { value: 200 }, periodPauseMs: null })).toEqual([]);
        expect(validateProsody('fast')[0].problem).toBe('prosody must be an object');
        expect(validateProsody({ tempo: 1 })[0].problem).toBe('unknown prosody field');
        expect(validateProsody({ speed: 113 })[0].problem).toBe('must be an object or null');
        expect(validateProsody({ speed: { value: 300 } })[0].problem).toMatch(/50 to 200/);
        expect(validateProsody({ commaPauseMs: { value: 4000 } })[0].problem).toMatch(/0 to 3000/);
        expect(validateProsody({ periodPauseMs: { value: 9000 } })[0].problem).toMatch(/0 to 5000/);
        expect(validateProsody({ speed: { value: 100, verified: 'no' } })[0].path).toBe('prosody.speed.verified');
        expect(validateProsody({ speed: { value: 100, variants: [{ value: 90, label: 'Early 2016 BMH' }] } })).toEqual([]);
        expect(validateProsody({ speed: { value: 100, variants: 'x' } })[0].problem).toBe('variants must be a list');
        expect(validateProsody({ speed: { value: 100, variants: [null, { value: 1 }] } }).map((p) => p.path)).toEqual(['prosody.speed.variants[0]', 'prosody.speed.variants[1].value']);
    });

    it('validates whole sets', () => {
        expect(validatePronunciationSet(makeSet('wfo/LOT', [respell('illinois', 'Illinois', 'Illynois')]))).toEqual({ ok: true, problems: [] });
        expect(validatePronunciationSet(null).ok).toBe(false);
        const offices = { LOT: {} };
        const transmitters = { WNG570: { wfo: 'LMK' }, KEC76: { wfo: 'LOT' } };
        expect(validatePronunciationSet(makeSet('wfo/LMK'), { offices }).problems[0].problem).toBe('unknown office LMK');
        expect(validatePronunciationSet(makeSet('tx/WNG570'), { offices, transmitters }).ok).toBe(true);
        expect(validatePronunciationSet(makeSet('tx/KEC76'), { transmitters }).problems[0].problem).toBe('KEC76 belongs to LOT');
        expect(validatePronunciationSet(makeSet('tx/ZZZ99'), { transmitters }).problems[0].problem).toBe('unknown transmitter ZZZ99');
        const noWfo = makeSet('tx/WNG570');
        noWfo.scope = { type: 'tx', id: 'WNG570' };
        expect(validatePronunciationSet(noWfo).problems[0].path).toBe('scope.wfo');
        const broken = { schemaVersion: 2, id: 'wfo/lot', scope: 'x', rev: 0, voices: [1], style: [], entries: 'x', prosody: { speed: { value: 1 } } };
        const paths = validatePronunciationSet(broken).problems.map((p) => p.path);
        expect(paths).toEqual(expect.arrayContaining(['schemaVersion', 'id', 'scope', 'rev', 'voices', 'style', 'entries', 'prosody.speed.value']));
        const mismatch = makeSet('wfo/LOT');
        mismatch.scope = { type: 'wfo', id: 'IND' };
        expect(validatePronunciationSet(mismatch).problems[0].problem).toBe('scope must match id');
        const dupes = makeSet('national', [respell('a', 'Alpha', 'x'), respell('a', 'alpha', 'y'), null]);
        const dp = validatePronunciationSet(dupes).problems.map((p) => p.problem);
        expect(dp).toEqual(expect.arrayContaining(['duplicate id a', 'duplicate match alpha', 'entry must be an object']));
        const big = makeSet('national', new Array(LIMITS.setEntries + 1).fill(0).map((_, i) => respell('e' + i, 'w' + i, 'x')));
        expect(validatePronunciationSet(big).problems[0].problem).toMatch(/more than/);
    });
});

describe('segmentVtml', () => {
    it('splits text, tags, entities and protected spans', () => {
        expect(segmentVtml('a <vtml_speed value="110">b</vtml_speed> &amp; c')).toEqual([
            { kind: 'text', value: 'a ' },
            { kind: 'tag', value: '<vtml_speed value="110">' },
            { kind: 'text', value: 'b' },
            { kind: 'tag', value: '</vtml_speed>' },
            { kind: 'text', value: ' ' },
            { kind: 'tag', value: '&amp;' },
            { kind: 'text', value: ' c' },
        ]);
        expect(segmentVtml('x <vtml_phoneme alphabet="x-cmu" ph="AA">Wind</vtml_phoneme> y')[1]).toEqual({ kind: 'protected', value: '<vtml_phoneme alphabet="x-cmu" ph="AA">Wind</vtml_phoneme>' });
        expect(segmentVtml('<vtml_sub alias="a"><vtml_sub alias="b">x</vtml_sub></vtml_sub>z')).toEqual([
            { kind: 'protected', value: '<vtml_sub alias="a"><vtml_sub alias="b">x</vtml_sub></vtml_sub>' },
            { kind: 'text', value: 'z' },
        ]);
        expect(segmentVtml('a<vtml_phoneme ph="AA"/>b').map((s) => s.kind)).toEqual(['text', 'tag', 'text']);
        expect(segmentVtml('a <!-- wind --> b')[1]).toEqual({ kind: 'tag', value: '<!-- wind -->' });
        expect(segmentVtml('a <!-- wind')[1]).toEqual({ kind: 'protected', value: '<!-- wind' });
        expect(segmentVtml('a < b wind')[1]).toEqual({ kind: 'protected', value: '< b wind' });
        expect(segmentVtml('a <x <y>')[1]).toEqual({ kind: 'protected', value: '<x <y>' });
        expect(segmentVtml('<vtml_phoneme ph="AA">open wind')).toEqual([{ kind: 'protected', value: '<vtml_phoneme ph="AA">open wind' }]);
        expect(segmentVtml('AT&T winds')).toEqual([{ kind: 'text', value: 'AT&T winds' }]);
        expect(segmentVtml('')).toEqual([]);
        expect(segmentVtml(null)).toEqual([]);
    });
});

describe('applyPronunciations', () => {
    const national = [
        ph('thunderstorm', 'thunderstorm', 'TH AH1 N D ER0 S T OW0 R M'),
        ph('thunderstorms', 'thunderstorms', 'TH AH1 N D ER0 S T OW0 R M Z'),
        ph('wind', 'wind', 'W IH1 N D'),
        { id: 'wind-down', match: 'wind down', replace: { kind: 'phoneme', ph: 'W AY2 N D', on: 'wind' } },
        respell('illinois', 'Illinois', 'Illynois'),
        respell('content', 'content', 'CONTENT'),
        { id: 'beach', match: 'beach', replace: { kind: 'vtml', markup: '{{match}}<vtml_pause time="0"/>' } },
        respell('dont', "Don't", 'dont'),
        respell('n3017', '30.17', '30 point 17'),
        respell('inland-cs', 'Inland', 'INLAND', { caseSensitive: true }),
    ];

    it('wraps phonemes around the original text', () => {
        expect(apply('Thunderstorms possible.', national)).toBe('<vtml_phoneme alphabet="x-cmu" ph="TH AH1 N D ER0 S T OW0 R M Z">Thunderstorms</vtml_phoneme> possible.');
    });

    it('prefers the longest phrase and keeps unwrapped words', () => {
        expect(apply('winds will wind down tonight', national)).toBe('winds will <vtml_phoneme alphabet="x-cmu" ph="W AY2 N D">wind</vtml_phoneme> down tonight');
        expect(apply('Wind  Down', national)).toBe('<vtml_phoneme alphabet="x-cmu" ph="W AY2 N D">Wind</vtml_phoneme>  Down');
    });

    it('respects word boundaries and inner punctuation', () => {
        expect(apply('windy windward wind-driven', national)).toBe('windy windward <vtml_phoneme alphabet="x-cmu" ph="W IH1 N D">wind</vtml_phoneme>-driven');
        expect(apply('Don’t worry, don\'t.', national)).toBe('dont worry, dont.');
        expect(apply('pressure 30.17 inches, 30.175', national)).toBe('pressure 30 point 17 inches, 30.175');
        expect(apply('re-Illinois', national)).toBe('re-Illynois');
        expect(apply("O'Illinois", national)).toBe("O'Illinois");
    });

    it('applies case rules', () => {
        expect(apply('Inland inland', national)).toBe('INLAND inland');
        expect(apply('Content is CONTENT', national)).toBe('CONTENT is CONTENT');
    });

    it('inserts VTML markup with the original text', () => {
        expect(apply('Beach hazards', national)).toBe('Beach<vtml_pause time="0"/> hazards');
    });

    it('leaves markup and protected spans alone and is idempotent for phonemes', () => {
        const input = '<vtml_speed value="110">Wind</vtml_speed> <vtml_phoneme alphabet="x-cmu" ph="W IH2 N D">wind</vtml_phoneme> <vtml_pause time="200"/>';
        const once = apply(input, national);
        expect(once).toBe('<vtml_speed value="110"><vtml_phoneme alphabet="x-cmu" ph="W IH1 N D">Wind</vtml_phoneme></vtml_speed> <vtml_phoneme alphabet="x-cmu" ph="W IH2 N D">wind</vtml_phoneme> <vtml_pause time="200"/>');
        expect(apply(once, national)).toBe(once);
    });

    it('reports hits with offsets and layers', () => {
        const result = applyPronunciations('a <b>Illinois</b>', matcherFor(national, 'wfo'));
        expect(result.hits).toEqual([{ start: 5, end: 13, entryId: 'illinois', layer: 'wfo', match: 'Illinois' }]);
    });

    it('handles empty matchers and inputs', () => {
        expect(applyPronunciations('wind', null)).toEqual({ text: 'wind', hits: [] });
        expect(applyPronunciations(undefined, matcherFor(national)).text).toBe('');
        expect(compileMatcher([null, { entry: { match: '' , replace: { kind: 'respell', text: 'x' } } }, { entry: { match: '...', replace: { kind: 'respell', text: 'x' } } }]).size).toBe(0);
    });

    it('renders replacements directly', () => {
        expect(renderReplacement({ kind: 'phoneme', ph: ' AA  B ' }, 'ab')).toBe('<vtml_phoneme alphabet="x-cmu" ph="AA B">ab</vtml_phoneme>');
        expect(renderReplacement({ kind: 'phoneme', ph: 'AA', on: 'zzz' }, 'a b')).toBe('<vtml_phoneme alphabet="x-cmu" ph="AA">a b</vtml_phoneme>');
        expect(renderReplacement({ kind: 'respell', text: 'A&B' }, 'x')).toBe('A&amp;B');
    });

    it('scans a long product quickly', () => {
        const many = Array.from({ length: 2000 }, (_, i) => respell('w' + i, 'word' + i, 'x' + i));
        const matcher = matcherFor([...many, ...national]);
        const text = 'Thunderstorms with damaging wind over Illinois. '.repeat(400);
        const started = Date.now();
        const result = applyPronunciations(text, matcher);
        expect(result.hits.length).toBe(1200);
        expect(Date.now() - started).toBeLessThan(1000);
    });
});

describe('layers and prosody', () => {
    it('merges with precedence and personal disables', () => {
        const merged = mergeLayers([
            { layer: 'national', entries: [respell('a', 'severe', 'national'), respell('b', 'wind', 'n-wind'), respell('c', 'Hail', 'cs', { caseSensitive: true })] },
            { layer: 'wfo', entries: [respell('a', 'Severe', 'wfo')] },
            { layer: 'tx', entries: [respell('d', 'calm', 'tx')] },
            { layer: 'personal', entries: [{ id: 'b', match: 'wind', disabled: true }, { id: 'c', match: 'hail', disabled: true }, { id: 'e', match: 'x' }, null] },
            null,
            { layer: 'empty' },
        ]);
        expect(merged.map((m) => [m.key, m.layer, m.entry.replace.text])).toEqual([
            ['severe', 'wfo', 'wfo'],
            ['calm', 'tx', 'tx'],
        ]);
        expect(mergeLayers()).toEqual([]);
        expect(mergeLayers([{ entries: [respell('z', 'zed', 'z')] }])[0].layer).toBe('unknown');
    });

    it('resolves prosody from the most specific set', () => {
        const national = makeSet('national', [], { speed: null, commaPauseMs: { value: 200 }, periodPauseMs: { value: 900 } });
        const wfo = makeSet('wfo/LMK', [], { speed: { value: 105, notes: 'Normal' }, commaPauseMs: null });
        const tx = makeSet('tx/WNG570', [], { speed: { value: 93, verified: false } });
        const resolved = resolveProsody({ national, wfo, tx });
        expect(resolved.speed).toEqual({ value: 93, verified: false, notes: '', from: 'tx', setId: 'tx/WNG570' });
        expect(resolved.commaPauseMs.from).toBe('national');
        expect(resolveProsody({ national, wfo }).speed).toEqual({ value: 105, verified: true, notes: 'Normal', from: 'wfo', setId: 'wfo/LMK' });
        expect(resolveProsody().speed).toBeNull();
        expect(resolveProsody({ wfo: { prosody: { speed: { value: 100 } } } }).speed.setId).toBe('wfo');
    });

    it('combines office speed with the slider multiplicatively', () => {
        expect(combineSpeed(113, 0)).toBe(113);
        expect(combineSpeed(113, 1)).toBe(124);
        expect(combineSpeed(113, -2)).toBe(90);
        expect(combineSpeed(121, 10)).toBe(200);
        expect(combineSpeed(90, -10)).toBe(50);
        expect(combineSpeed(100, 'x')).toBe(100);
        expect(combineSpeed(100)).toBe(100);
    });
});

describe('planRemoteSpeech', () => {
    const national = makeSet('national', [respell('illinois', 'Illinois', 'Illynois')], { commaPauseMs: { value: 200 }, periodPauseMs: { value: 900 } });
    const lot = makeSet('wfo/LOT', [], { speed: { value: 113 } });
    const context = (overrides = {}) => ({
        enabled: true,
        source: 'wfo:LOT',
        label: 'LOT (Chicago IL)',
        voices: ['paul'],
        officeSelected: true,
        matcher: matcherFor(national.entries),
        prosody: resolveProsody({ national, wfo: lot }),
        ...overrides,
    });
    const features = { vtProsody: { voices: ['paul'], fields: ['vtSpeed', 'vtCommaPauseMs', 'vtPeriodPauseMs'] } };

    it('applies pronunciations and backend fields', () => {
        const plan = planRemoteSpeech({ text: 'Illinois', voice: 'paul', backend: 'VT', prosody: { rate: 1, pitch: 2 }, context: context(), features });
        expect(plan.text).toBe('Illynois');
        expect(plan.fields).toEqual({ vtSpeed: 124, vtCommaPauseMs: 200, vtPeriodPauseMs: 900 });
        expect(plan.prosody).toEqual({ rate: 0, pitch: 2 });
        expect(plan.summary.speed).toEqual({ value: 124, base: 113, verified: true, from: 'wfo', applied: 'field' });
        expect(summarizePlan(plan.summary)).toBe('LOT (Chicago IL): 1 replacement · speed 124 · comma 200 ms · period 900 ms');
    });

    it('falls back to speed markup when the server cannot set speed', () => {
        const plan = planRemoteSpeech({ text: 'Illinois', voice: 'paul', backend: 'VT', prosody: { rate: 0 }, context: context(), features: null });
        expect(plan.text).toBe('<vtml_speed value="113">Illynois</vtml_speed>');
        expect(plan.fields).toEqual({});
        expect(plan.summary.unsupported).toEqual(['vtSpeed', 'vtCommaPauseMs', 'vtPeriodPauseMs']);
        expect(summarizePlan(plan.summary)).toMatch(/cannot set vtSpeed/);
    });

    it('sends no pauses for national-only and keeps the slider', () => {
        const ctx = context({ source: '', label: 'National', officeSelected: false, prosody: resolveProsody({ national }) });
        const plan = planRemoteSpeech({ text: 'Illinois Illinois', voice: 'paul', backend: 'VT', prosody: { rate: 3 }, context: ctx, features });
        expect(plan.fields).toEqual({});
        expect(plan.prosody.rate).toBe(3);
        expect(summarizePlan(plan.summary)).toBe('National: 2 replacements');
    });

    it('does nothing for other voices or when disabled', () => {
        const input = { text: 'Illinois', backend: 'VT', prosody: { rate: 2 }, features };
        expect(planRemoteSpeech({ ...input, voice: 'james', context: context() })).toEqual({ text: 'Illinois', prosody: { rate: 2 }, fields: {}, summary: null, applied: false });
        expect(planRemoteSpeech({ ...input, voice: 'paul', context: context({ enabled: false }) }).applied).toBe(false);
        expect(planRemoteSpeech({ ...input, voice: 'paul', context: null }).applied).toBe(false);
        expect(planRemoteSpeech().text).toBe('');
        expect(planRemoteSpeech({ text: 'x', voice: 'paul', backend: 'VT', prosody: null, context: context({ voices: ['paul'] }), features: { vtProsody: { voices: ['james'], fields: ['vtSpeed'] } } }).summary.speed.applied).toBe('markup');
        expect(planRemoteSpeech({ text: 'x', voice: 'paul', backend: 'VT', context: context(), features: { vtProsody: { fields: ['vtSpeed'] } } }).fields).toEqual({});
    });

    it('describes unverified speeds', () => {
        expect(describeSpeed({ speed: { value: 104, verified: false } })).toBe('speed 104 (not speed-tested)');
        expect(describeSpeed(null)).toBe('');
        expect(summarizePlan(null)).toBe('');
        const ctx = context({ prosody: { speed: null, commaPauseMs: null, periodPauseMs: null } });
        expect(planRemoteSpeech({ text: 'Illinois', voice: 'paul', backend: 'VT', context: ctx, features }).fields).toEqual({});
    });
});

describe('lexiconFromSet', () => {
    it('builds the converter lexicon from phoneme entries only', () => {
        const set = makeSet('national', [
            ph('wind-down', 'Wind Down', ' W  AY2 N D ', { replace: { kind: 'phoneme', ph: ' W  AY2 N D ', on: 'Wind' } }),
            respell('illinois', 'Illinois', 'Illynois'),
            null,
        ]);
        expect(lexiconFromSet(set)).toEqual({ 'wind down': 'W AY2 N D' });
        expect(lexiconFromSet(null)).toEqual({});
    });
});
