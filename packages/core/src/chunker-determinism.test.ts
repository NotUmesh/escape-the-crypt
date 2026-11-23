import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { chunkDocument } from './chunker';
import { pastedTextArb, pdfPagesArb } from './test-support/arbitraries';

describe('Property 9: Chunking is deterministic', () => {
  /** **Validates: Requirements 6.8, 13.1** */
  it('chunking pasted text twice gives identical IDs, digests and texts', () => {
    fc.assert(
      fc.property(pastedTextArb, pastedTextArb, (text, original) => {
        const input = { sourceType: 'paste', text, originalText: original } as const;
        const a = chunkDocument(input);
        const b = chunkDocument({ ...input });
        expect(b).toEqual(a);
        expect(b.map((c) => [c.id, c.documentDigest, c.text])).toEqual(
          a.map((c) => [c.id, c.documentDigest, c.text]),
        );
      }),
      { numRuns: 100 },
    );
  });

  /** **Validates: Requirements 6.8, 13.1** */
  it('chunking PDF pages twice gives identical IDs, digests and texts', () => {
    fc.assert(
      fc.property(pdfPagesArb, (pages) => {
        const build = () => ({
          sourceType: 'pdf' as const,
          pages: pages.map((p) => ({ ...p, originalText: p.text })),
        });
        const a = chunkDocument(build());
        const b = chunkDocument(build());
        expect(b).toEqual(a);
        expect(b.map((c) => [c.id, c.documentDigest, c.text])).toEqual(
          a.map((c) => [c.id, c.documentDigest, c.text]),
        );
      }),
      { numRuns: 100 },
    );
  });
});
