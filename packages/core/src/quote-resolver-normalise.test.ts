import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { resolveQuote } from './quote-resolver';
import { noisyChunkTextArb } from './test-support/arbitraries';
import type { Chunk } from './types';

/**
 * Feature: ingestion-and-evidence, Property 17: Normalisation equivalences
 * **Validates: Requirements 7.1, 7.2, 7.3**
 */

function chunkOf(text: string): ReadonlyMap<string, Chunk> {
  const chunk: Chunk = {
    id: 'chk_000000000000_0',
    documentDigest: '0'.repeat(64),
    position: 0,
    text,
    location: { sourceType: 'paste', paragraphNumber: 1 },
    edited: false,
  };
  return new Map([[chunk.id, chunk]]);
}

const ID = 'chk_000000000000_0';

/** Distinct lowercase words, so any multi-word quote occurs exactly once. */
const uniqueWordsArb = fc.uniqueArray(fc.stringMatching(/^[a-z]{5,9}$/), {
  minLength: 8,
  maxLength: 20,
});

/** A base text of unique words plus a contiguous run of 4+ of them used as the quote. */
const baseArb = uniqueWordsArb.chain((words) =>
  fc
    .tuple(fc.integer({ min: 0, max: words.length - 4 }), fc.integer({ min: 4, max: 8 }))
    .map(([start, len]) => ({ words, quoteWords: words.slice(start, start + len) })),
);

const wsRunArb = fc
  .array(fc.constantFrom(' ', '\t', '\n', '\r\n', '\u00A0', '\u2003'), { minLength: 1, maxLength: 4 })
  .map((a) => a.join(''));

const expectResolves = (chunkText: string, quote: string) => {
  const r = resolveQuote(chunkOf(chunkText), ID, quote);
  expect(r.ok).toBe(true);
};

describe('Property 17: normalisation equivalences', () => {
  it('whitespace runs in the quote or chunk do not affect resolution', () => {
    fc.assert(
      fc.property(
        baseArb,
        fc.array(wsRunArb, { minLength: 20, maxLength: 20 }),
        fc.array(wsRunArb, { minLength: 20, maxLength: 20 }),
        ({ words, quoteWords }, chunkSeps, quoteSeps) => {
          const chunkText = words.map((w, i) => w + (chunkSeps[i] ?? ' ')).join('');
          const quote = quoteWords.map((w, i) => (i === 0 ? w : (quoteSeps[i] ?? ' ') + w)).join('');
          const r = resolveQuote(chunkOf(chunkText), ID, quote);
          expect(r.ok).toBe(true);
          if (r.ok) {
            expect(chunkText.slice(r.value.start, r.value.end).startsWith(quoteWords[0]!)).toBe(true);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('curly and straight quotation marks are equivalent in either direction', () => {
    const toCurly = (s: string) =>
      s.replace(/'/g, '\u2019').replace(/"([^"]*)"/g, '\u201C$1\u201D');
    fc.assert(
      fc.property(baseArb, fc.boolean(), ({ words, quoteWords }, curlyInChunk) => {
        // Put straight quotes inside the text of the first quoted word.
        const decorate = (ws: string[]) =>
          ws.map((w, i) => (i % 3 === 0 ? `"${w}"` : i % 3 === 1 ? `${w}'s` : w));
        const straight = (ws: string[]) => decorate(ws).join(' ');
        const decoratedChunkWords = words.map((w) => w);
        const idx = words.indexOf(quoteWords[0]!);
        const chunkWords = decoratedChunkWords.map((w, i) => {
          const k = i - idx;
          if (k < 0 || k >= quoteWords.length) return w;
          return decorate(quoteWords)[k]!;
        });
        const chunkStraight = chunkWords.join(' ');
        const quoteStraight = straight(quoteWords);
        if (curlyInChunk) expectResolves(toCurly(chunkStraight), quoteStraight);
        else expectResolves(chunkStraight, toCurly(quoteStraight));
      }),
      { numRuns: 100 },
    );
  });

  it('ligatures in either side match their expanded letters', () => {
    const pairs: ReadonlyArray<readonly [string, string]> = [
      ['\uFB00', 'ff'],
      ['\uFB01', 'fi'],
      ['\uFB02', 'fl'],
      ['\uFB03', 'ffi'],
      ['\uFB04', 'ffl'],
    ];
    fc.assert(
      fc.property(
        baseArb,
        fc.constantFrom(...pairs),
        fc.boolean(),
        ({ words, quoteWords }, [lig, plain], ligInChunk) => {
          const withPlain = quoteWords.map((w, i) => (i === 1 ? `${w}${plain}${w}` : w));
          const withLig = quoteWords.map((w, i) => (i === 1 ? `${w}${lig}${w}` : w));
          const idx = words.indexOf(quoteWords[0]!);
          const build = (replacement: string[]) =>
            [...words.slice(0, idx), ...replacement, ...words.slice(idx + quoteWords.length)].join(' ');
          if (ligInChunk) expectResolves(build(withLig), withPlain.join(' '));
          else expectResolves(build(withPlain), withLig.join(' '));
        },
      ),
      { numRuns: 100 },
    );
  });

  it('NFC and decomposed accents are equivalent in either direction', () => {
    const accents: ReadonlyArray<readonly [string, string]> = [
      ['\u00E9', 'e\u0301'],
      ['\u00E0', 'a\u0300'],
      ['\u00F6', 'o\u0308'],
      ['\u00F1', 'n\u0303'],
      ['\u00E7', 'c\u0327'],
    ];
    fc.assert(
      fc.property(
        baseArb,
        fc.constantFrom(...accents),
        fc.boolean(),
        ({ words, quoteWords }, [composed, decomposed], decomposedInChunk) => {
          const mk = (a: string) => quoteWords.map((w, i) => (i === 1 ? `${w}${a}${w}` : w));
          const idx = words.indexOf(quoteWords[0]!);
          const build = (replacement: string[]) =>
            [...words.slice(0, idx), ...replacement, ...words.slice(idx + quoteWords.length)].join(' ');
          if (decomposedInChunk) expectResolves(build(mk(decomposed)), mk(composed).join(' '));
          else expectResolves(build(mk(composed)), mk(decomposed).join(' '));
        },
      ),
      { numRuns: 100 },
    );
  });

  it('a line-break hyphen inserted inside a word does not prevent resolution', () => {
    fc.assert(
      fc.property(
        baseArb,
        fc.constantFrom('-\n', '-\r\n', '- \n  ', '-\t\n'),
        fc.nat(),
        fc.boolean(),
        ({ words, quoteWords }, brk, pick, inChunk) => {
          const wi = pick % quoteWords.length;
          const w = quoteWords[wi]!;
          const cut = 1 + (pick % (w.length - 1));
          const broken = `${w.slice(0, cut)}${brk}${w.slice(cut)}`;
          const brokenQuoteWords = quoteWords.map((x, i) => (i === wi ? broken : x));
          const idx = words.indexOf(quoteWords[0]!);
          const build = (replacement: string[]) =>
            [...words.slice(0, idx), ...replacement, ...words.slice(idx + quoteWords.length)].join(' ');
          if (inChunk) expectResolves(build(brokenQuoteWords), quoteWords.join(' '));
          else expectResolves(build(quoteWords), brokenQuoteWords.join(' '));
        },
      ),
      { numRuns: 100 },
    );
  });

  it('a quote differing only in letter case does not resolve', () => {
    fc.assert(
      fc.property(baseArb, ({ words, quoteWords }) => {
        const r = resolveQuote(chunkOf(words.join(' ')), ID, quoteWords.join(' ').toUpperCase());
        expect(r).toEqual({ ok: false, error: { kind: 'not-found' } });
      }),
      { numRuns: 100 },
    );
  });

  it('an in-word hyphen is preserved, so dropping it makes the quote fail', () => {
    fc.assert(
      fc.property(baseArb, fc.nat(), ({ words, quoteWords }, pick) => {
        const wi = pick % quoteWords.length;
        const w = quoteWords[wi]!;
        const cut = 1 + (pick % (w.length - 1));
        const hyphenated = quoteWords.map((x, i) => (i === wi ? `${w.slice(0, cut)}-${w.slice(cut)}` : x));
        const idx = words.indexOf(quoteWords[0]!);
        const chunkText = [
          ...words.slice(0, idx),
          ...hyphenated,
          ...words.slice(idx + quoteWords.length),
        ].join(' ');
        expectResolves(chunkText, hyphenated.join(' '));
        const dropped = resolveQuote(chunkOf(chunkText), ID, quoteWords.join(' '));
        expect(dropped).toEqual({ ok: false, error: { kind: 'not-found' } });
      }),
      { numRuns: 100 },
    );
  });

  it('noisy chunk text resolves against a hand-normalised copy of itself', () => {
    fc.assert(
      fc.property(noisyChunkTextArb, (text) => {
        const plain = text
          .normalize('NFC')
          .replace(/\uFB03/g, 'ffi')
          .replace(/\uFB04/g, 'ffl')
          .replace(/\uFB00/g, 'ff')
          .replace(/\uFB01/g, 'fi')
          .replace(/\uFB02/g, 'fl')
          .replace(/[\u2018\u2019]/g, "'")
          .replace(/[\u201C\u201D]/g, '"')
          .replace(/-[ \t]*\r?\n[ \t]*/g, '')
          .replace(/\s+/g, ' ')
          .trim();
        const r = resolveQuote(chunkOf(text), ID, plain);
        // Repeated words can legitimately make the full text ambiguous; never not-found.
        if (!r.ok) expect(r.error.kind).not.toBe('not-found');
      }),
      { numRuns: 100 },
    );
  });
});
