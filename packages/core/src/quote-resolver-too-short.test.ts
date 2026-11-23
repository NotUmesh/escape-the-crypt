import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { resolveQuote } from './quote-resolver';
import { noisyChunkTextArb } from './test-support/arbitraries';
import type { Chunk } from './types';

function makeChunk(text: string): Chunk {
  return {
    id: 'chk_abcdef123456_0',
    documentDigest: 'abcdef123456'.padEnd(64, '0'),
    position: 0,
    text,
    location: { sourceType: 'paste', paragraphNumber: 1 },
    edited: false,
  };
}

const pad = fc.constantFrom('', ' ', '\n', '  \t');

/** 1-3 long words: fewer than 4 words, but possibly 20+ characters. */
const fewWordsArb: fc.Arbitrary<string> = fc
  .tuple(
    pad,
    fc.array(fc.stringMatching(/^[a-z]{7,30}$/), { minLength: 1, maxLength: 3 }),
    pad,
  )
  .map(([l, ws, r]) => `${l}${ws.join(' ')}${r}`);

/** 4+ words that total fewer than 20 characters after normalisation. */
const fewCharsArb: fc.Arbitrary<string> = fc
  .array(fc.stringMatching(/^[a-z]{1,3}$/), { minLength: 4, maxLength: 5 })
  .map((ws) => ws.join(' '))
  .filter((s) => s.length < 20);

/** Short strings of any shape, including empty and whitespace only. */
const tinyArb: fc.Arbitrary<string> = fc.string({ maxLength: 6 });

/** A short slice cut from the chunk itself, so a search would otherwise find it. */
function shortSliceArb(text: string): fc.Arbitrary<string> {
  return fc
    .tuple(fc.integer({ min: 0, max: text.length - 1 }), fc.integer({ min: 1, max: 6 }))
    .map(([start, len]) => text.slice(start, start + len));
}

describe('Property 16: Short quotes are rejected without searching', () => {
  it('returns too-short for any short quote, whatever the chunk ID', () => {
    const arb = noisyChunkTextArb.chain((text) =>
      fc.record({
        text: fc.constant(text),
        quote: fc.oneof(fewWordsArb, fewCharsArb, tinyArb, shortSliceArb(text)),
        useKnownId: fc.boolean(),
        otherId: fc.string({ maxLength: 20 }),
      }),
    );

    fc.assert(
      fc.property(arb, ({ text, quote, useKnownId, otherId }) => {
        const chunk = makeChunk(text);
        const chunks = new Map([[chunk.id, chunk]]);
        const chunkId = useKnownId ? chunk.id : otherId;

        const result = resolveQuote(chunks, chunkId, quote);

        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.error).toEqual({ kind: 'too-short' });
      }),
      { numRuns: 200 },
    );
  });

  it('never reads the chunk map for a short quote', () => {
    fc.assert(
      fc.property(fc.oneof(fewWordsArb, fewCharsArb, tinyArb), (quote) => {
        const reads: string[] = [];
        const spy = new Proxy(new Map<string, Chunk>(), {
          get(target, prop) {
            reads.push(String(prop));
            const v = Reflect.get(target, prop, target) as unknown;
            return typeof v === 'function' ? (v as () => unknown).bind(target) : v;
          },
        });

        const result = resolveQuote(spy, 'any-id', quote);

        expect(result).toEqual({ ok: false, error: { kind: 'too-short' } });
        expect(reads).toEqual([]);
      }),
      { numRuns: 100 },
    );
  });
});
