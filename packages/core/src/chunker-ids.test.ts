import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { chunkDocument, type ChunkInput } from './chunker';
import { documentDigest } from './digest';
import { duplicateParagraphsArb, pastedTextArb, pdfPagesArb } from './test-support/arbitraries';

function pasteInput(text: string): ChunkInput {
  return { sourceType: 'paste', text, originalText: text };
}

function expectedPasteDigest(text: string): string {
  const paragraphs = text
    .split(/\n[^\S\n]*(?:\n[^\S\n]*)+/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
  return documentDigest(paragraphs, 'paste');
}

function checkIdsAndDigest(
  chunks: ReturnType<typeof chunkDocument>,
  expectedDigest: string,
): void {
  expect(chunks.length).toBeGreaterThan(0);
  expect(new Set(chunks.map((c) => c.id)).size).toBe(chunks.length);
  for (const c of chunks) {
    expect(c.documentDigest).toBe(expectedDigest);
    expect(c.id).toContain(expectedDigest.slice(0, 12));
  }
}

describe('Property 10: Chunk IDs are distinct and carry the document digest', () => {
  /** **Validates: Requirements 6.2, 6.3, 6.9, 13.7** */
  it('holds for pasted text', () => {
    fc.assert(
      fc.property(pastedTextArb, (text) => {
        checkIdsAndDigest(chunkDocument(pasteInput(text)), expectedPasteDigest(text));
      }),
      { numRuns: 100 },
    );
  });

  it('holds for documents with identical paragraphs', () => {
    fc.assert(
      fc.property(duplicateParagraphsArb, (text) => {
        checkIdsAndDigest(chunkDocument(pasteInput(text)), expectedPasteDigest(text));
      }),
      { numRuns: 100 },
    );
  });

  it('holds for PDF pages, including identical pages', () => {
    fc.assert(
      fc.property(pdfPagesArb, fc.boolean(), (pages, duplicate) => {
        const all = duplicate
          ? [...pages, ...pages.map((p, i) => ({ ...p, pdfPageIndex: pages.length + i }))]
          : pages;
        const input: ChunkInput = {
          sourceType: 'pdf',
          pages: all.map((p) => ({ ...p, originalText: p.text })),
        };
        const digest = documentDigest(
          all.filter((p) => p.text.trim().length > 0).map((p) => p.text),
          'pdf',
        );
        checkIdsAndDigest(chunkDocument(input), digest);
      }),
      { numRuns: 100 },
    );
  });
});
