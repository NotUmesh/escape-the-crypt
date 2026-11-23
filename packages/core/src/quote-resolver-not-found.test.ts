import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { normaliseWithMap } from './normalise';
import { resolveQuote } from './quote-resolver';
import type { Chunk } from './types';
import { chunkAndQuoteArb, noisyChunkTextArb } from './test-support/arbitraries';

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

function expectNotFound(chunkText: string, quote: string): void {
  const chunk = makeChunk(chunkText);
  const result = resolveQuote(new Map([[chunk.id, chunk]]), chunk.id, quote);
  expect(result).toEqual({ ok: false, error: { kind: 'not-found' } });
}

// Chunk words are letters and punctuation only, so digit words never occur in them.
const digitQuoteArb = fc
  .array(fc.stringMatching(/^[0-9]{3,6}$/), { minLength: 4, maxLength: 10 })
  .map((ws) => ws.join(' '))
  .filter((q) => q.length >= 20);

describe('Property 14: Absent quotes never resolve', () => {
  /** **Validates: Requirements 7.5, 13.3** */
  it('returns not-found for a long quote made of words not in the chunk', () => {
    fc.assert(
      fc.property(noisyChunkTextArb, digitQuoteArb, (chunkText, quote) => {
        expectNotFound(chunkText, quote);
      }),
    );
  });

  /** **Validates: Requirements 7.5, 13.3** */
  it('returns not-found for a real excerpt altered so it no longer occurs', () => {
    fc.assert(
      fc.property(
        chunkAndQuoteArb,
        fc.integer({ min: 0, max: 1000 }),
        ({ chunkText, quote }, at) => {
          const q = normaliseWithMap(quote).text;
          // Insert a digit run in the middle of a long excerpt, then pad to stay long enough.
          const i = at % (q.length + 1);
          const altered = `${q.slice(0, i)}7531${q.slice(i)} one two three four five six`;
          fc.pre(!normaliseWithMap(chunkText).text.includes(normaliseWithMap(altered).text));
          expectNotFound(chunkText, altered);
        },
      ),
    );
  });

  /** **Validates: Requirements 7.5, 13.3** */
  it('returns not-found for case-changed quotes (matching is case-sensitive)', () => {
    fc.assert(
      fc.property(noisyChunkTextArb, (chunkText) => {
        const upper = normaliseWithMap(chunkText).text.toUpperCase();
        fc.pre(upper !== normaliseWithMap(chunkText).text);
        fc.pre(!normaliseWithMap(chunkText).text.includes(upper));
        fc.pre(upper.split(' ').length >= 4 && upper.length >= 20);
        expectNotFound(chunkText, upper);
      }),
    );
  });
});
