import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { countWords } from './limits';
import {
  GARBLE_MAX_RATIO,
  LOW_TEXT_MIN_WORDS,
  SHORT_LINE_MEDIAN_CHARS,
  SHORT_LINE_MIN_LINES,
  classifyPage,
} from './page-checker';

const FLAGS = ['ok', 'low-text', 'suspicious'];
const word = fc.stringMatching(/^[a-z]{4,8}$/);
/** A line of 6 to 10 plain words, always at least 29 characters long. */
const proseLine = fc.array(word, { minLength: 6, maxLength: 10 }).map((w) => w.join(' '));
/** Well-formed prose with at least the low-text minimum of words. */
const prose = fc
  .array(proseLine, { minLength: 4, maxLength: 12 })
  .map((lines) => lines.join('\n'));

describe('Property 6: Page classification', () => {
  // **Validates: Requirements 4.1, 4.2, 4.3**
  it('always returns exactly one known flag', () => {
    fc.assert(
      fc.property(fc.string({ unit: 'binary' }), (text) => {
        expect(FLAGS).toContain(classifyPage(text));
      }),
    );
  });

  it('flags text with fewer words than the minimum as low-text, whatever its content', () => {
    fc.assert(
      fc.property(
        fc.array(fc.oneof(word, fc.constant('\uFFFD\uFFFD\uFFFD')), {
          maxLength: LOW_TEXT_MIN_WORDS - 1,
        }),
        fc.constantFrom(' ', '\n'),
        (words, sep) => {
          const text = words.join(sep);
          expect(countWords(text)).toBeLessThan(LOW_TEXT_MIN_WORDS);
          expect(classifyPage(text)).toBe('low-text');
        },
      ),
    );
  });

  it('classifies well-formed prose as ok', () => {
    fc.assert(
      fc.property(prose, (text) => {
        expect(countWords(text)).toBeGreaterThanOrEqual(LOW_TEXT_MIN_WORDS);
        expect(classifyPage(text)).toBe('ok');
      }),
    );
  });

  it('flags prose with an odd-character ratio above the threshold as suspicious', () => {
    fc.assert(
      fc.property(prose, fc.constantFrom('\uFFFD', '\u0001', '\uE000'), (text, odd) => {
        const letters = text.replace(/\s/gu, '').length;
        // Enough odd characters to push the ratio strictly above the threshold.
        const count = Math.floor((GARBLE_MAX_RATIO * letters) / (1 - GARBLE_MAX_RATIO)) + 2;
        expect(classifyPage(`${odd.repeat(count)}${text}`)).toBe('suspicious');
      }),
    );
  });

  it('flags many very short lines as suspicious', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: SHORT_LINE_MIN_LINES, max: 30 }),
        fc.integer({ min: 1, max: SHORT_LINE_MEDIAN_CHARS - 1 }),
        (lineCount, len) => {
          // Each line is one word, so the page needs enough lines to reach the word minimum.
          const n = Math.max(lineCount, LOW_TEXT_MIN_WORDS);
          const text = Array<string>(n).fill('a'.repeat(len)).join('\n');
          expect(classifyPage(text)).toBe('suspicious');
        },
      ),
    );
  });

  describe('rule order and threshold boundaries', () => {
    const words = (n: number, len = 4): string => Array<string>(n).fill('a'.repeat(len)).join(' ');

    it('low-text boundary: 19 words is low-text, 20 words is ok', () => {
      expect(classifyPage(words(LOW_TEXT_MIN_WORDS - 1))).toBe('low-text');
      expect(classifyPage(words(LOW_TEXT_MIN_WORDS))).toBe('ok');
    });

    it('low-text wins over the garble rule', () => {
      const garbled = Array<string>(LOW_TEXT_MIN_WORDS - 1).fill('\uFFFD').join(' ');
      expect(classifyPage(garbled)).toBe('low-text');
      expect(classifyPage('')).toBe('low-text');
    });

    it('garble boundary: a ratio exactly at the threshold is ok, just above is suspicious', () => {
      // 20 words with 95 letters in total, plus 5 odd characters = exactly 5 of 100.
      const base = [...Array<string>(15).fill('aaaaa'), ...Array<string>(5).fill('aaaa')];
      const atThreshold = [`${base[0]}${'\uFFFD'.repeat(5)}`, ...base.slice(1)].join(' ');
      expect(5 / 100).toBe(GARBLE_MAX_RATIO);
      expect(classifyPage(atThreshold)).toBe('ok');
      const above = [`${base[0]}${'\uFFFD'.repeat(6)}`, ...base.slice(1)].join(' ');
      expect(classifyPage(above)).toBe('suspicious');
    });

    it('garble wins over the short-line rule and short-line rule applies after it', () => {
      const shortLines = (odd: string): string =>
        Array<string>(SHORT_LINE_MIN_LINES * 3).fill(`a${odd}`).join('\n');
      expect(classifyPage(shortLines(''))).toBe('suspicious');
      expect(classifyPage(shortLines('\uFFFD'))).toBe('suspicious');
    });

    it('short-line count boundary: 7 short lines is ok, 8 is suspicious', () => {
      const lines = (n: number): string => Array<string>(n).fill('a b c').join('\n');
      // 7 lines x 3 words = 21 words (enough); 8 lines = 24 words.
      expect(classifyPage(lines(SHORT_LINE_MIN_LINES - 1))).toBe('ok');
      expect(classifyPage(lines(SHORT_LINE_MIN_LINES))).toBe('suspicious');
    });

    it('median boundary: median 11 is suspicious, median 12 is ok', () => {
      const lines = (len: number): string =>
        Array<string>(LOW_TEXT_MIN_WORDS).fill('a'.repeat(len)).join('\n');
      expect(classifyPage(lines(SHORT_LINE_MEDIAN_CHARS - 1))).toBe('suspicious');
      expect(classifyPage(lines(SHORT_LINE_MEDIAN_CHARS))).toBe('ok');
    });

    it('uses the median, so a few long lines do not hide a short-line page', () => {
      const short = Array<string>(10).fill('abc def');
      const long = Array<string>(2).fill('w'.repeat(200));
      expect(classifyPage([...short, ...long].join('\n'))).toBe('suspicious');
    });
  });
});
