import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { normaliseWithMap } from './normalise';
import { MIN_QUOTE_CHARS, MIN_QUOTE_WORDS, resolveQuote } from './quote-resolver';
import { chunkAndQuoteArb } from './test-support/arbitraries';
import type { Chunk } from './types';

function makeChunk(text: string): Chunk {
  return {
    id: 'chk_000000000000_0',
    documentDigest: '0'.repeat(64),
    position: 0,
    text,
    location: { sourceType: 'paste', paragraphNumber: 1 },
    edited: false,
  };
}

const norm = (s: string): string => normaliseWithMap(s).text;

function occurrences(haystack: string, needle: string): number {
  let count = 0;
  for (let at = haystack.indexOf(needle); at !== -1; at = haystack.indexOf(needle, at + 1)) count++;
  return count;
}

const NUM_RUNS = 300;
/**
 * fast-check does not count cases rejected by fc.pre toward numRuns, so the
 * number of exercised runs is always NUM_RUNS and says nothing on its own.
 * What can silently collapse is the share of generated cases that pass the
 * filters (unique quote, minimum size). Measured 0.59-0.69 across seeds 1-20;
 * requiring 0.4 catches a generator or filter change that makes most cases
 * skips while leaving margin for random variation.
 */
const MIN_ACCEPTED_RATIO = 0.4;

describe('Property 13: unique quotes resolve to correct offsets', () => {
  /**
   * **Validates: Requirements 7.4, 7.10, 13.5**
   */
  it('offsets applied to the original chunk text select text that normalises to the quote', () => {
    let attempts = 0;
    let exercised = 0;
    fc.assert(
      fc.property(chunkAndQuoteArb, ({ chunkText, quote }) => {
        attempts++;
        const q = norm(quote);
        const words = q === '' ? 0 : q.split(' ').length;
        fc.pre(words >= MIN_QUOTE_WORDS && q.length >= MIN_QUOTE_CHARS);
        fc.pre(occurrences(norm(chunkText), q) === 1);
        exercised++;

        const chunk = makeChunk(chunkText);
        const result = resolveQuote(new Map([[chunk.id, chunk]]), chunk.id, quote);

        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.value.chunkId).toBe(chunk.id);
        const { start, end } = result.value;
        expect(start).toBeGreaterThanOrEqual(0);
        expect(end).toBeLessThanOrEqual(chunkText.length);
        expect(start).toBeLessThan(end);
        expect(norm(chunkText.slice(start, end))).toBe(q);
      }),
      { numRuns: NUM_RUNS },
    );
    expect(exercised).toBe(NUM_RUNS);
    expect(exercised / attempts).toBeGreaterThanOrEqual(MIN_ACCEPTED_RATIO);
  });

  it('resolves a plain unique quote to its exact offsets', () => {
    const text = 'alpha beta gamma delta epsilon zeta eta theta';
    const chunk = makeChunk(text);
    const quote = 'gamma delta epsilon zeta';
    const result = resolveQuote(new Map([[chunk.id, chunk]]), chunk.id, quote);
    expect(result).toEqual({
      ok: true,
      value: { chunkId: chunk.id, start: text.indexOf(quote), end: text.indexOf(quote) + quote.length },
    });
  });
});
