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

describe('citationLabel source variants', () => {
  const paste = chunk({ sourceType: 'paste', paragraphNumber: 3 }, false);
  const pdf = chunk({ sourceType: 'pdf', pdfPageIndex: 4, printedPageLabel: null }, false);
  const pdfPrinted = chunk({ sourceType: 'pdf', pdfPageIndex: 4, printedPageLabel: 'iv' }, false);
  const editedPdf = chunk({ sourceType: 'pdf', pdfPageIndex: 4, printedPageLabel: null }, true);

  it('sample paste uses the sample wording', () => {
    expect(citationLabel(paste, 'sample')).toBe('Paragraph 3 of the sample notes');
  });

  it('notes and default paste keep "of your notes"', () => {
    expect(citationLabel(paste, 'notes')).toBe('Paragraph 3 of your notes');
    expect(citationLabel(paste)).toBe('Paragraph 3 of your notes');
  });

  it('PDF and edited-PDF labels are the same for sample and notes', () => {
    for (const c of [pdf, pdfPrinted, editedPdf]) {
      expect(citationLabel(c, 'sample')).toBe(citationLabel(c, 'notes'));
      expect(citationLabel(c, 'notes')).toBe(citationLabel(c));
    }
    expect(citationLabel(pdfPrinted, 'sample')).toBe('PDF page 5 (printed page iv)');
    expect(citationLabel(editedPdf, 'sample')).toBe(
      'Your edited notes, originally extracted from PDF page 5',
    );
  });
});

describe('Property 8: citationLabel source variants', () => {
  const location = fc.oneof(
    fc.integer({ min: 1, max: 5000 }).map((n): SourceLocation => ({ sourceType: 'paste', paragraphNumber: n })),
    fc
      .tuple(fc.nat(5000), printedLabel)
      .map(([i, l]): SourceLocation => ({ sourceType: 'pdf', pdfPageIndex: i, printedPageLabel: l })),
  );

  /** **Validates: Requirements 3.8, 3.9, 3.10, 3.11, 3.12, 25.12** */
  it('notes/default output is unchanged; sample changes only paste wording', () => {
    fc.assert(
      fc.property(location, fc.boolean(), (loc, edited) => {
        const c = chunk(loc, edited);
        expect(citationLabel(c, 'notes')).toBe(citationLabel(c));
        const sample = citationLabel(c, 'sample');
        expect(sample.endsWith('of your notes')).toBe(false);
        if (loc.sourceType === 'paste') {
          expect(sample).toBe(`Paragraph ${loc.paragraphNumber} of the sample notes`);
        } else {
          expect(sample).toBe(citationLabel(c));
        }
      }),
    );
  });
});
