import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { resolveQuote } from './quote-resolver';
import type { Chunk } from './types';

function makeChunk(id: string, text: string): Chunk {
  return {
    id,
    documentDigest: '0'.repeat(64),
    position: 0,
    text,
    location: { sourceType: 'paste', paragraphNumber: 1 },
    edited: false,
  };
}

const KINDS = ['not-found', 'ambiguous', 'unknown-chunk', 'too-short'];

const textArb = fc.oneof(
  fc.string({ maxLength: 200 }),
  fc.string({ unit: 'binary', maxLength: 200 }),
  fc.string({ unit: 'grapheme', maxLength: 100 }),
  fc.string({ minLength: 3000, maxLength: 6000 }),
  fc.constant(''),
);

const idArb = fc.oneof(fc.string({ maxLength: 30 }), fc.constant('chk_a'), fc.constant(''));

describe('Property 18: The Quote Resolver returns typed errors and never throws', () => {
  /** **Validates: Requirements 7.7, 7.9** */
  it('returns a resolved location or a known error kind for arbitrary inputs', () => {
    fc.assert(
      fc.property(
        fc.array(fc.tuple(idArb, textArb), { maxLength: 4 }),
        idArb,
        textArb,
        (entries, chunkId, quote) => {
          const map = new Map(entries.map(([id, text]) => [id, makeChunk(id, text)]));
          const result = resolveQuote(map, chunkId, quote);
          if (result.ok) {
            expect(result.value.chunkId).toBe(chunkId);
            expect(Number.isInteger(result.value.start)).toBe(true);
            expect(result.value.end).toBeGreaterThan(result.value.start);
          } else {
            expect(KINDS).toContain(result.error.kind);
            if (result.error.kind === 'ambiguous') {
              expect(result.error.count).toBeGreaterThan(1);
            }
          }
        },
      ),
    );
  });

  /** **Validates: Requirements 7.7, 7.9** */
  it('returns unknown-chunk for an absent chunk ID with a long enough quote', () => {
    fc.assert(
      fc.property(textArb, (text) => {
        const map = new Map([['chk_a', makeChunk('chk_a', text)]]);
        const result = resolveQuote(map, 'missing', 'alpha beta gamma delta epsilon');
        expect(result).toEqual({ ok: false, error: { kind: 'unknown-chunk' } });
      }),
    );
  });

  it('handles empty map, empty quote and lone surrogates without throwing', () => {
    expect(resolveQuote(new Map(), '', '')).toEqual({ ok: false, error: { kind: 'too-short' } });
    expect(() => resolveQuote(new Map(), 'x', '\ud800 \udc00 \ud800 \udc00 \ud800 \udc00')).not.toThrow();
  });
});
