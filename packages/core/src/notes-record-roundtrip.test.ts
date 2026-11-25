import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { chunkDocument } from './chunker';
import { makeNotesRecord, parseNotesRecord } from './notes-record';
import { pastedTextArb, pdfPagesArb } from './test-support/arbitraries';
import type { Chunk } from './types';

/** Chunk sets produced by the real Chunker from generated paste and PDF documents. */
const chunkSetArb: fc.Arbitrary<Chunk[]> = fc.oneof(
  pastedTextArb.map((text) => chunkDocument({ sourceType: 'paste', text, originalText: text })),
  pdfPagesArb.map((pages) =>
    chunkDocument({
      sourceType: 'pdf',
      pages: pages.map((p) => ({ ...p, originalText: p.text })),
    }),
  ),
);

describe('Property 11: NotesRecord round-trip through the migrated parser', () => {
  /**
   * **Validates: Requirements 10.3**
   */
  it('parseNotesRecord returns the original record, directly and after a JSON round-trip', () => {
    fc.assert(
      fc.property(chunkSetArb, (chunks) => {
        const record = makeNotesRecord(chunks);
        expect(parseNotesRecord(record)).toEqual({ ok: true, value: record });
        expect(parseNotesRecord(JSON.parse(JSON.stringify(record)))).toEqual({
          ok: true,
          value: record,
        });
      }),
      { numRuns: 100 },
    );
  });
});
