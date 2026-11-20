import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { bmhSentences, bmhTransform, capitalizeFully, formatTtsReady, removeBullets, sentenceRanges } from '../assets/js/bmh-format.js';

const oracle = JSON.parse(readFileSync(new URL('./fixtures/bmh-transform.json', import.meta.url), 'utf8'));

describe('bmhTransform matches the reference Python BMH MessageTransformer', () => {
    it.each(oracle.map((c) => [c.input, c.output]))('%j', (input, output) => {
        expect(bmhTransform(input)).toBe(output);
    });
});

describe('capitalizeFully', () => {
    it('lowercases, then capitalizes after whitespace only', () => {
        expect(capitalizeFully('TORNADO WARNING...FOR o\'HARE')).toBe('Tornado Warning...for O\'hare');
    });

    it('leaves engine markup untouched and treats it as a word break', () => {
        expect(capitalizeFully('A<vtml_pause time="5"/>BC <X Y="Z">DEF</X>')).toBe('A<vtml_pause time="5"/>Bc <X Y="Z">Def</X>');
    });

    it('keeps a character whose uppercase form is longer', () => {
        expect(capitalizeFully('ß straße')).toBe('ß Straße');
    });

    it('handles empty input', () => {
        expect(capitalizeFully(undefined)).toBe('');
    });
});

describe('removeBullets', () => {
    it('drops leading star, dash and dot bullets on every line', () => {
        expect(removeBullets('* WHAT...Tornado\n  - nested\n• dot\nkeep - this')).toBe('WHAT...Tornado\nnested\ndot\nkeep - this');
    });

    it('keeps a leading negative number', () => {
        expect(removeBullets('-5 degrees')).toBe('-5 degrees');
    });

    it('handles empty input', () => {
        expect(removeBullets(null)).toBe('');
    });
});

describe('sentenceRanges', () => {
    const bound = (start, end) => ({ start, end, bound: true });

    it('joins bound text outside every sentence to the next sentence, else the last one', () => {
        expect(sentenceRanges('... Two.', [bound(0, 3)])).toEqual([[0, 8]]);
        expect(sentenceRanges('One. ...', [bound(5, 8)])).toEqual([[0, 8]]);
        expect(sentenceRanges('...', [bound(0, 3)])).toEqual([[0, 3]]);
    });

    it('merges every sentence a bound span touches', () => {
        expect(sentenceRanges('One. Two. Three.', [bound(2, 7)])).toEqual([[0, 9], [10, 16]]);
    });
});

describe('bmhSentences', () => {
    it('splits on sentence ends and drops punctuation-only text', () => {
        expect(bmhSentences('One. Two!\nThree?')).toEqual(['One.', 'Two!', 'Three?']);
        expect(bmhSentences('... !!')).toEqual([]);
        expect(bmhSentences(undefined)).toEqual([]);
    });
});

describe('formatTtsReady', () => {
    it('removes bullets before the BMH rules', () => {
        expect(formatTtsReady('* WHAT...TORNADO.\n* WHERE...COOK COUNTY.')).toBe('What...tornado. Where...cook County.');
    });

    it('is stable when run twice', () => {
        const once = formatTtsReady(oracle[0].input);
        expect(formatTtsReady(once)).toBe(once);
    });
});
