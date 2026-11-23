import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { citationLabel } from './citation-labeller';
import type { Chunk, SourceLocation } from './types';

function chunk(location: SourceLocation, edited: boolean): Chunk {
  return { id: 'chk_x_0', documentDigest: 'x', position: 0, text: 't', location, edited };
}

const printedLabel = fc.option(fc.stringMatching(/^[A-Za-z0-9]{1,6}$/), { nil: null });

describe('Property 19: Citation labels follow the chunk metadata', () => {
  /** **Validates: Requirements 8.1, 8.2, 8.3, 8.5, 8.6** */
  it('unedited PDF chunks use PDF page index + 1, with printed label when it differs', () => {
    fc.assert(
      fc.property(fc.nat(5000), printedLabel, (index, label) => {
        const page = index + 1;
        const expected =
          label === null || label === String(page)
            ? `PDF page ${page}`
            : `PDF page ${page} (printed page ${label})`;
        expect(
          citationLabel(chunk({ sourceType: 'pdf', pdfPageIndex: index, printedPageLabel: label }, false)),
        ).toBe(expected);
      }),
    );
  });

  it('paste chunks use the paragraph form regardless of the edited flag', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 5000 }), fc.boolean(), (n, edited) => {
        expect(citationLabel(chunk({ sourceType: 'paste', paragraphNumber: n }, edited))).toBe(
          `Paragraph ${n} of your notes`,
        );
      }),
    );
  });

  it('edited PDF chunks name the original PDF page', () => {
    fc.assert(
      fc.property(fc.nat(5000), printedLabel, (index, label) => {
        const page = index + 1;
        const ref =
          label === null || label === String(page) ? `${page}` : `${page} (printed page ${label})`;
        expect(
          citationLabel(chunk({ sourceType: 'pdf', pdfPageIndex: index, printedPageLabel: label }, true)),
        ).toBe(`Your edited notes, originally extracted from PDF page ${ref}`);
      }),
    );
  });
});
