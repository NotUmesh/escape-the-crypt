import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { chunkDocument } from './chunker';
import { MIN_CHUNK_CHARS } from './chunker-merge';
import { MAX_CHUNK_CHARS } from './chunker-split';
import {
  overLongSentenceArb,
  overLongTokenArb,
  pastedTextArb,
  pdfPagesArb,
} from './test-support/arbitraries';
import type { Chunk } from './types';

function unitKey(chunk: Chunk): string {
  const loc = chunk.location;
  return loc.sourceType === 'paste'
    ? `paste:${loc.paragraphNumber}`
    : `pdf:${loc.pdfPageIndex}`;
}

function assertBounds(chunks: Chunk[]): void {
  const perUnit = new Map<string, Chunk[]>();
  for (const chunk of chunks) {
    expect(chunk.text.length).toBeLessThanOrEqual(MAX_CHUNK_CHARS);
    const key = unitKey(chunk);
    perUnit.set(key, [...(perUnit.get(key) ?? []), chunk]);
  }
  for (const group of perUnit.values()) {
    if (group.length > 1) {
      for (const chunk of group) {
        expect(chunk.text.length).toBeGreaterThanOrEqual(MIN_CHUNK_CHARS);
      }
    }
  }
}

const pasteInput = (text: string) => ({ sourceType: 'paste' as const, text, originalText: text });
const pdfInput = (pages: { pdfPageIndex: number; printedPageLabel: string | null; text: string }[]) => ({
  sourceType: 'pdf' as const,
  pages: pages.map((p) => ({ ...p, originalText: p.text })),
});

// Feature: ingestion-and-evidence, Property 12: Chunk size bounds
// **Validates: Requirements 6.11, 6.12, 6.14, 6.15, 6.16, 13.8**
describe('Property 12: Chunk size bounds', () => {
  it('pasted text respects max and min bounds', () => {
    fc.assert(
      fc.property(pastedTextArb, (text) => {
        assertBounds(chunkDocument(pasteInput(text)));
      }),
      { numRuns: 100 },
    );
  });

  it('PDF pages respect max and min bounds', () => {
    fc.assert(
      fc.property(pdfPagesArb, (pages) => {
        assertBounds(chunkDocument(pdfInput(pages)));
      }),
      { numRuns: 100 },
    );
  });

  it('over-long sentences and tokens are split under the max', () => {
    fc.assert(
      fc.property(fc.oneof(overLongSentenceArb(), overLongTokenArb()), (text) => {
        const chunks = chunkDocument(pasteInput(text));
        expect(chunks.length).toBeGreaterThan(1);
        assertBounds(chunks);
      }),
      { numRuns: 50 },
    );
  });

  it('a short lone paragraph is kept as the only chunk', () => {
    const chunks = chunkDocument(pasteInput('Too short.'));
    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.text).toBe('Too short.');
  });
});
