import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { chunkDocument } from './chunker';
import { paragraphArb, pastedTextArb, pdfPagesArb } from './test-support/arbitraries';

const squash = (s: string): string => s.replace(/\s+/g, ' ').trim();

function paragraphsOf(text: string): string[] {
  return text
    .split(/\n[^\S\n]*(?:\n[^\S\n]*)+/)
    .map((p) => squash(p))
    .filter((p) => p.length > 0);
}

describe('Property 11: every chunk has exactly one source location', () => {
  it('paste chunks carry one paragraph number whose paragraph contains the chunk text', () => {
    fc.assert(
      fc.property(pastedTextArb, (text) => {
        const paragraphs = paragraphsOf(text);
        const chunks = chunkDocument({ sourceType: 'paste', text, originalText: text });
        expect(chunks.length).toBeGreaterThan(0);
        for (const chunk of chunks) {
          expect(chunk.location.sourceType).toBe('paste');
          expect(Object.keys(chunk.location).sort()).toEqual(['paragraphNumber', 'sourceType']);
          if (chunk.location.sourceType !== 'paste') continue;
          const n = chunk.location.paragraphNumber;
          expect(Number.isInteger(n)).toBe(true);
          expect(n).toBeGreaterThanOrEqual(1);
          expect(n).toBeLessThanOrEqual(paragraphs.length);
          expect(paragraphs[n - 1]).toContain(squash(chunk.text));
        }
      }),
      { numRuns: 100 },
    );
  });

  it('pdf chunks carry one page index with its own printed label, and text from that page only', () => {
    fc.assert(
      fc.property(pdfPagesArb, (pages) => {
        const chunks = chunkDocument({
          sourceType: 'pdf',
          pages: pages.map((p) => ({ ...p, originalText: p.text })),
        });
        expect(chunks.length).toBeGreaterThan(0);
        for (const chunk of chunks) {
          expect(chunk.location.sourceType).toBe('pdf');
          expect(Object.keys(chunk.location).sort()).toEqual([
            'pdfPageIndex',
            'printedPageLabel',
            'sourceType',
          ]);
          if (chunk.location.sourceType !== 'pdf') continue;
          const { pdfPageIndex, printedPageLabel } = chunk.location;
          const page = pages.find((p) => p.pdfPageIndex === pdfPageIndex);
          expect(page).toBeDefined();
          expect(printedPageLabel).toBe(page?.printedPageLabel);
          expect(squash(page?.text ?? '')).toContain(squash(chunk.text));
        }
      }),
      { numRuns: 100 },
    );
  });

  it('a single paragraph yields only paragraph number 1', () => {
    fc.assert(
      fc.property(paragraphArb, (text) => {
        const chunks = chunkDocument({ sourceType: 'paste', text, originalText: text });
        for (const chunk of chunks) {
          expect(chunk.location).toEqual({ sourceType: 'paste', paragraphNumber: 1 });
        }
      }),
      { numRuns: 50 },
    );
  });
});
