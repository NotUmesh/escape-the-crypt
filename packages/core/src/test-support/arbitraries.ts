import fc from 'fast-check';

const word = fc.stringMatching(/^[a-z]{2,9}$/);

/** A sentence of 3-12 words ending in a full stop. */
export const sentenceArb: fc.Arbitrary<string> = fc
  .array(word, { minLength: 3, maxLength: 12 })
  .map((ws) => `${ws.join(' ')}.`);

/** A paragraph of 1-4 sentences. */
export const paragraphArb: fc.Arbitrary<string> = fc
  .array(sentenceArb, { minLength: 1, maxLength: 4 })
  .map((ss) => ss.join(' '));

/** Blank-line separator: 1 or more empty lines (possibly with spaces). */
const blankRunArb: fc.Arbitrary<string> = fc
  .tuple(fc.integer({ min: 2, max: 5 }), fc.boolean())
  .map(([n, spaced]) => (spaced ? '\n \t'.repeat(n - 1) + '\n' : '\n'.repeat(n)));

/** Pasted text: paragraphs separated by runs of blank lines. */
export const pastedTextArb: fc.Arbitrary<string> = fc
  .array(fc.tuple(paragraphArb, blankRunArb), { minLength: 1, maxLength: 6 })
  .map((parts) => parts.map(([p, sep]) => p + sep).join(''));

export interface PdfPageArb {
  pdfPageIndex: number;
  printedPageLabel: string | null;
  text: string;
}

/** PDF page list with unique ascending indexes and printed labels or null. */
export const pdfPagesArb: fc.Arbitrary<PdfPageArb[]> = fc
  .array(
    fc.record({
      label: fc.option(fc.stringMatching(/^[ivx]{1,4}$|^[1-9][0-9]{0,2}$/), { nil: null }),
      text: paragraphArb,
    }),
    { minLength: 1, maxLength: 10 },
  )
  .map((pages) =>
    pages.map((p, i) => ({ pdfPageIndex: i, printedPageLabel: p.label, text: p.text })),
  );

/** Text in which the same paragraph appears at least twice. */
export const duplicateParagraphsArb: fc.Arbitrary<string> = fc
  .tuple(paragraphArb, fc.array(paragraphArb, { maxLength: 3 }), fc.integer({ min: 2, max: 4 }))
  .map(([dup, others, times]) => [...Array<string>(times).fill(dup), ...others].join('\n\n'));

/** A single sentence longer than `minChars` (default 1500) made of short words. */
export function overLongSentenceArb(minChars = 1500): fc.Arbitrary<string> {
  return fc
    .array(word, { minLength: Math.ceil(minChars / 4), maxLength: Math.ceil(minChars / 4) + 40 })
    .map((ws) => `${ws.join(' ')}.`)
    .filter((s) => s.length > minChars);
}

/** A single whitespace-free token longer than `minChars` (default 1500). */
export function overLongTokenArb(minChars = 1500): fc.Arbitrary<string> {
  return fc
    .stringMatching(/^[a-z]{20}$/)
    .chain((seed) =>
      fc.integer({ min: minChars + 1, max: minChars + 400 }).map((n) =>
        seed.repeat(Math.ceil(n / seed.length)).slice(0, n),
      ),
    );
}

const LIGATURES = ['\uFB01', '\uFB02', '\uFB00', '\uFB03', '\uFB04'];
const DECOMPOSED = ['e\u0301', 'a\u0300', 'o\u0308', 'n\u0303', 'c\u0327'];

const noisyPieceArb: fc.Arbitrary<string> = fc.oneof(
  { weight: 6, arbitrary: word },
  { weight: 1, arbitrary: fc.constantFrom(...LIGATURES) },
  { weight: 1, arbitrary: fc.constantFrom('\u2018s', '\u2019', '\u201Cquoted\u201D') },
  { weight: 1, arbitrary: fc.constantFrom(...DECOMPOSED) },
  { weight: 1, arbitrary: word.map((w) => `${w}-\n${w}`) },
  { weight: 1, arbitrary: word.map((w) => `${w}-  \n  ${w}`) },
);

/** Chunk text with line-break hyphens, ligatures, curly quotes and decomposed accents. */
export const noisyChunkTextArb: fc.Arbitrary<string> = fc
  .array(noisyPieceArb, { minLength: 12, maxLength: 40 })
  .map((pieces) => pieces.join(' '));

/** A chunk text together with a quote cut from it at random offsets (quote may be short). */
export const chunkAndQuoteArb: fc.Arbitrary<{ chunkText: string; quote: string }> =
  noisyChunkTextArb.chain((chunkText) =>
    fc
      .tuple(
        fc.integer({ min: 0, max: chunkText.length - 1 }),
        fc.integer({ min: 0, max: chunkText.length - 1 }),
      )
      .map(([a, b]) => {
        const start = Math.min(a, b);
        const end = Math.max(a, b) + 1;
        return { chunkText, quote: chunkText.slice(start, end) };
      }),
  );
