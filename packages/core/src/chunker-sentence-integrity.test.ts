import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { chunkDocument } from './chunker';
import { MIN_CHUNK_CHARS } from './chunker-merge';
import { MAX_CHUNK_CHARS } from './chunker-split';
import { wrapOptionsArb, wrapParagraph } from './test-support/wrap-arbitraries';
import type { Chunk } from './types';
// A sentence is the quotable unit: a chunk boundary inside one would make a quote of that
// sentence impossible to cite whole. The splitter packs whole sentences and the rebalance step
// prefers a sentence boundary, so a cut can land inside a sentence only when no sentence
// boundary leaves both pieces within [MIN_CHUNK_CHARS, MAX_CHUNK_CHARS]. With sentences up to
// SENTENCE_LIMIT characters such a boundary always exists, so no sentence is ever split.
const SENTENCE_LIMIT = MAX_CHUNK_CHARS - 2 * MIN_CHUNK_CHARS - 2;
const word = fc.stringMatching(/^[a-z]{1,11}$/);
const compound = fc.constantFrom('well-known', 'self-esteem', 'long-term');
const sentenceArb = fc
  .array(fc.oneof({ weight: 10, arbitrary: word }, { weight: 1, arbitrary: compound }), {
    minLength: 3,
    maxLength: 150,
  })
  .map((ws) => `${ws.join(' ')}.`)
  .filter((s) => s.length <= SENTENCE_LIMIT);
/** Sentences of one paragraph, long enough in total to need several chunks. */
const longParagraphArb = fc.array(sentenceArb, { minLength: 2, maxLength: 40 });
/** Start offsets of the chunks inside `source`, found in order. */
function chunkStarts(source: string, chunks: readonly Chunk[]): number[] {
  const starts: number[] = [];
  let cursor = 0;
  for (const chunk of chunks) {
    const at = source.indexOf(chunk.text, cursor);
    expect(at).toBeGreaterThanOrEqual(cursor);
    starts.push(at);
    cursor = at + chunk.text.length;
  }
  return starts;
}
function sentenceStarts(sentences: readonly string[]): Set<number> {
  const starts = new Set<number>();
  let at = 0;
  for (const s of sentences) {
    starts.add(at);
    at += s.length + 1;
  }
  return starts;
}
// Feature: generation-and-evaluation, chunk boundaries fall between sentences
describe('Property: the chunker never splits a sentence it can keep whole', () => {
  it('every chunk of a pasted paragraph starts at a sentence start', () => {
    fc.assert(
      fc.property(longParagraphArb, (sentences) => {
        const text = sentences.join(' ');
        const chunks = chunkDocument({ sourceType: 'paste', text, originalText: text });
        const allowed = sentenceStarts(sentences);
        for (const start of chunkStarts(text, chunks)) expect(allowed.has(start)).toBe(true);
      }),
      { numRuns: 150 },
    );
  });
  it('the same holds for a hard-wrapped PDF page with soft hyphens', () => {
    fc.assert(
      fc.property(longParagraphArb, wrapOptionsArb, (sentences, options) => {
        const text = sentences.join(' ');
        const page = wrapParagraph(text, options);
        const chunks = chunkDocument({
          sourceType: 'pdf',
          pages: [{ pdfPageIndex: 0, printedPageLabel: null, text: page, originalText: page }],
        });
        const allowed = sentenceStarts(sentences);
        for (const start of chunkStarts(text, chunks)) expect(allowed.has(start)).toBe(true);
      }),
      { numRuns: 150 },
    );
  });
  it('the generator does produce multi-chunk paragraphs', () => {
    const sentence = `${'lorem ipsum dolor sit amet '.repeat(10).trim()}.`;
    const text = Array.from({ length: 12 }, () => sentence).join(' ');
    const chunks = chunkDocument({ sourceType: 'paste', text, originalText: text });
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) expect(chunk.text.endsWith('.')).toBe(true);
  });
});
