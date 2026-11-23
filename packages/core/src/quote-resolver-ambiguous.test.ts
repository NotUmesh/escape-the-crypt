import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { resolveQuote } from './quote-resolver';
import { sentenceArb } from './test-support/arbitraries';
import type { Chunk } from './types';

const CHUNK_ID = 'chk_abcdef123456_0';

function chunkOf(text: string): ReadonlyMap<string, Chunk> {
  const chunk: Chunk = {
    id: CHUNK_ID,
    documentDigest: 'd'.repeat(64),
    position: 0,
    text,
    location: { sourceType: 'paste', paragraphNumber: 1 },
    edited: false,
  };
  return new Map([[CHUNK_ID, chunk]]);
}

/** Independent count of occurrences, including overlapping ones. */
function countOverlapping(haystack: string, needle: string): number {
  let n = 0;
  for (let i = 0; i + needle.length <= haystack.length; i++) {
    if (haystack.startsWith(needle, i)) n++;
  }
  return n;
}

// A lowercase word run long enough to satisfy the minimum quote length (4 words, 20 chars).
const quoteWordsArb = fc
  .array(fc.stringMatching(/^[a-z]{3,8}$/), { minLength: 4, maxLength: 8 })
  .filter((ws) => ws.join(' ').length >= 20);

describe('Property 15: Repeated quotes are ambiguous', () => {
  it('rejects a quote repeated in separate places as ambiguous with the full count', () => {
    // **Validates: Requirements 7.6, 13.4**
    fc.assert(
      fc.property(
        quoteWordsArb,
        sentenceArb,
        sentenceArb,
        fc.integer({ min: 2, max: 4 }),
        (words, before, between, times) => {
          const quote = words.join(' ');
          // Separators start and end with a character that cannot extend the quote.
          const text = [before, ...Array<string>(times).fill(quote).flatMap((q) => [q, between])].join(' ');
          const result = resolveQuote(chunkOf(text), CHUNK_ID, quote);
          const expected = countOverlapping(text, quote);
          expect(expected).toBeGreaterThanOrEqual(2);
          expect(result).toEqual({ ok: false, error: { kind: 'ambiguous', count: expected } });
        },
      ),
      { numRuns: 200 },
    );
  });

  it('rejects overlapping occurrences as ambiguous', () => {
    // **Validates: Requirements 7.6, 13.4**
    fc.assert(
      fc.property(
        fc.array(fc.stringMatching(/^[a-z]{3,8}$/), { minLength: 1, maxLength: 4 }),
        fc.integer({ min: 2, max: 4 }),
        fc.integer({ min: 1, max: 3 }),
        (unit, quoteReps, extraReps) => {
          const repeat = (n: number): string => Array<string>(n).fill(unit.join(' ')).join(' ');
          const quote = repeat(quoteReps);
          fc.pre(quote.split(' ').length >= 4 && quote.length >= 20);
          // The text holds more periods than the quote, so the quote starts at several overlapping offsets.
          const text = repeat(quoteReps + extraReps);
          const result = resolveQuote(chunkOf(text), CHUNK_ID, quote);
          const expected = countOverlapping(text, quote);
          expect(expected).toBeGreaterThanOrEqual(extraReps + 1);
          expect(result).toEqual({ ok: false, error: { kind: 'ambiguous', count: expected } });
        },
      ),
      { numRuns: 200 },
    );
  });

  it('treats a quote that overlaps itself in the chunk as ambiguous', () => {
    const result = resolveQuote(
      chunkOf('abcde abcde abcde abcde abcde'),
      CHUNK_ID,
      'abcde abcde abcde abcde',
    );
    expect(result).toEqual({ ok: false, error: { kind: 'ambiguous', count: 2 } });
  });
});
