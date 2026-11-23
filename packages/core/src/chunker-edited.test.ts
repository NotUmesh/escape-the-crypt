import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { chunkDocument } from './chunker';
import { paragraphArb, pdfPagesArb } from './test-support/arbitraries';

// Paragraphs of at least 40 characters never merge with a neighbour, so an
// edit to one paragraph cannot change the chunks of the others.
const longParagraphArb = paragraphArb.filter((p) => p.length >= 40);

const page = (text: string, originalText: string) => ({
  pdfPageIndex: 0,
  printedPageLabel: null,
  text,
  originalText,
});

const chunkTexts = (text: string): string[] =>
  chunkDocument({ sourceType: 'pdf', pages: [page(text, text)] }).map((c) => c.text);

/** **Validates: Requirements 5.3, 5.4, 6.7** */
describe('Property 8: edited flag reflects a per-chunk difference', () => {
  it('chunking unedited text yields no edited chunks', () => {
    fc.assert(
      fc.property(pdfPagesArb, fc.string(), (pages, pasted) => {
        const pdf = chunkDocument({
          sourceType: 'pdf',
          pages: pages.map((p) => ({ ...p, originalText: p.text })),
        });
        expect(pdf.every((c) => !c.edited)).toBe(true);
        const paste = chunkDocument({ sourceType: 'paste', text: pasted, originalText: pasted });
        expect(paste.every((c) => !c.edited)).toBe(true);
      }),
      { numRuns: 100 },
    );
  });

  it('edited is false exactly when the text equals an original chunk of the same unit', () => {
    fc.assert(
      fc.property(
        fc.array(paragraphArb, { minLength: 1, maxLength: 6 }),
        fc.array(paragraphArb, { minLength: 0, maxLength: 4 }),
        fc.nat(5),
        fc.constantFrom('replace', 'delete', 'append'),
        (paragraphs, replacement, at, mode) => {
          const index = at % paragraphs.length;
          const edited = [...paragraphs];
          if (mode === 'replace') edited.splice(index, 1, ...replacement);
          else if (mode === 'delete') edited.splice(index, 1);
          else edited[index] = `${edited[index]} ${replacement[0] ?? 'extra words here.'}`;
          const originalText = paragraphs.join('\n\n');
          const text = edited.join('\n\n');

          const originals = new Set(chunkTexts(originalText));
          const chunks = chunkDocument({ sourceType: 'pdf', pages: [page(text, originalText)] });
          for (const chunk of chunks) {
            expect(chunk.edited).toBe(!originals.has(chunk.text));
          }
        },
      ),
      { numRuns: 200 },
    );
  });

  it('compares within each unit only, never against other pages', () => {
    fc.assert(
      fc.property(pdfPagesArb, (pages) => {
        // Page 0 keeps its text; every other page is "edited" to the text of page 0.
        const first = pages[0]?.text ?? '';
        const chunks = chunkDocument({
          sourceType: 'pdf',
          pages: pages.map((p, i) => ({ ...p, text: first, originalText: i === 0 ? first : p.text })),
        });
        const firstOriginals = new Set(chunkTexts(first));
        chunks.forEach((chunk, i) => {
          if (chunk.location.sourceType !== 'pdf') return;
          const idx = chunk.location.pdfPageIndex;
          const original = pages[idx]?.text ?? '';
          expect(chunk.edited).toBe(!new Set(chunkTexts(idx === 0 ? first : original)).has(chunk.text));
          if (idx === 0) expect(firstOriginals.has(chunk.text)).toBe(true);
          expect(i).toBe(chunk.position);
        });
      }),
      { numRuns: 100 },
    );
  });

  it('an edit that changes the chunk count leaves untouched chunks unflagged', () => {
    fc.assert(
      fc.property(
        fc.array(longParagraphArb, { minLength: 2, maxLength: 6 }),
        fc.array(longParagraphArb, { minLength: 2, maxLength: 4 }),
        fc.nat(5),
        (paragraphs, replacement, at) => {
          const index = at % paragraphs.length;
          const edited = [...paragraphs];
          edited.splice(index, 1, ...replacement);
          const originalText = paragraphs.join('\n\n');
          const chunks = chunkDocument({
            sourceType: 'pdf',
            pages: [page(edited.join('\n\n'), originalText)],
          });
          expect(chunks.length).not.toBe(paragraphs.length);
          const untouched = new Set(paragraphs.filter((_, i) => i !== index));
          const replaced = new Set(replacement);
          for (const chunk of chunks) {
            // A replacement that equals an original paragraph is legitimately unflagged.
            if (untouched.has(chunk.text) || paragraphs.includes(chunk.text)) {
              expect(chunk.edited).toBe(false);
            } else if (replaced.has(chunk.text)) {
              expect(chunk.edited).toBe(true);
            }
          }
          // Every untouched original paragraph is still present and unflagged.
          for (const p of untouched) {
            expect(chunks.some((c) => c.text === p && !c.edited)).toBe(true);
          }
        },
      ),
      { numRuns: 200 },
    );
  });
});
