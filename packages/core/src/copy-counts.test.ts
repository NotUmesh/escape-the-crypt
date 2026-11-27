import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { ANNOUNCEMENT_COPY, CITATION_COPY, INGEST_UI_COPY } from './copy';
import { ROOM_PLAY_LABELS } from './copy-room-play';

const count = fc.integer({ min: 0, max: 10_000 });

/** Number tokens in a string, with thousands separators kept: "1,234 of 50,000" gives ["1,234", "50,000"]. */
function numberTokens(text: string): string[] {
  return text.match(/\d+(?:,\d{3})*/g) ?? [];
}

function expectCleanSpacing(text: string): void {
  expect(text).toBe(text.trim());
  expect(text).not.toMatch(/ {2}/);
  expect(text.length).toBeGreaterThan(0);
}

/** The output holds `formatted` as a whole token (never inside a longer number). */
function expectToken(text: string, formatted: string): void {
  expectCleanSpacing(text);
  expect(numberTokens(text)).toContain(formatted);
}

interface CountCase {
  readonly name: string;
  readonly render: (n: number) => string;
  /** Number as it should appear; defaults to String(n). */
  readonly format?: (n: number) => string;
}

const labels = [null, 'iv'] as const;
const SINGLE_NUMBER_CASES: readonly CountCase[] = [
  { name: 'INGEST_UI_COPY.chunkCount', render: INGEST_UI_COPY.chunkCount },
  { name: 'INGEST_UI_COPY.wordCounter', render: INGEST_UI_COPY.wordCounter, format: (n) => n.toLocaleString('en-US') },
  { name: 'INGEST_UI_COPY.pagesChosen', render: INGEST_UI_COPY.pagesChosen },
  { name: 'INGEST_UI_COPY.paragraphName', render: INGEST_UI_COPY.paragraphName },
  { name: 'INGEST_UI_COPY.pageName', render: (n) => INGEST_UI_COPY.pageName(n) },
  { name: 'INGEST_UI_COPY.pageName (label)', render: (n) => INGEST_UI_COPY.pageName(n, 'iv') },
  { name: 'INGEST_UI_COPY.removePageFor', render: INGEST_UI_COPY.removePageFor },
  { name: 'ANNOUNCEMENT_COPY.pageRemoved', render: ANNOUNCEMENT_COPY.pageRemoved },
  { name: 'ANNOUNCEMENT_COPY.paragraphRemoved', render: ANNOUNCEMENT_COPY.paragraphRemoved },
  { name: 'ANNOUNCEMENT_COPY.pageLowText', render: ANNOUNCEMENT_COPY.pageLowText },
  { name: 'ANNOUNCEMENT_COPY.pageSuspicious', render: ANNOUNCEMENT_COPY.pageSuspicious },
  { name: 'CITATION_COPY.pasteParagraph', render: CITATION_COPY.pasteParagraph },
  { name: 'CITATION_COPY.sampleParagraph', render: CITATION_COPY.sampleParagraph },
  ...labels.flatMap((label): CountCase[] => [
    { name: `CITATION_COPY.pdfPage (${String(label)})`, render: (n) => CITATION_COPY.pdfPage(n, label) },
    { name: `CITATION_COPY.editedPdf (${String(label)})`, render: (n) => CITATION_COPY.editedPdf(n, label) },
  ]),
  { name: 'ROOM_PLAY_LABELS.hintsLeft', render: ROOM_PLAY_LABELS.hintsLeft },
  { name: 'ROOM_PLAY_LABELS.ghostName', render: ROOM_PLAY_LABELS.ghostName },
];

describe('copy that takes a count', () => {
  for (const c of SINGLE_NUMBER_CASES) {
    it(`${c.name} shows the number as a whole token for every n in 0..10000`, () => {
      fc.assert(
        fc.property(count, (n) => {
          const text = c.render(n);
          const formatted = c.format?.(n) ?? String(n);
          expectToken(text, formatted);
          // The count leads the first number, or follows a fixed word; it is never swallowed by another number.
          expect(numberTokens(text).filter((t) => t === formatted).length).toBeGreaterThan(0);
        }),
      );
    });
  }

  it('ROOM_PLAY_LABELS.spiritCandlesLit shows the number for every n except 1', () => {
    fc.assert(
      fc.property(count, (n) => {
        fc.pre(n !== 1);
        expectToken(ROOM_PLAY_LABELS.spiritCandlesLit(n), String(n));
      }),
    );
  });

  it('INGEST_UI_COPY.reading shows both numbers in order', () => {
    fc.assert(
      fc.property(count, count, (done, total) => {
        const text = INGEST_UI_COPY.reading(done, total);
        expectCleanSpacing(text);
        expect(text).toBe(`Reading page ${done} of ${total}`);
        expect(numberTokens(text)).toEqual([String(done), String(total)]);
      }),
    );
  });

  it('wordCounter shows the count first, with thousands separators', () => {
    fc.assert(
      fc.property(count, (n) => {
        expect(numberTokens(INGEST_UI_COPY.wordCounter(n))[0]).toBe(n.toLocaleString('en-US'));
      }),
    );
    expect(INGEST_UI_COPY.wordCounter(1234)).toMatch(/^1,234 of /);
  });

  it('pagesChosen puts the chosen count before the limit', () => {
    fc.assert(
      fc.property(count, (n) => {
        expect(INGEST_UI_COPY.pagesChosen(n)).toMatch(new RegExp(`^${n} of \\d+ pages chosen$`));
      }),
    );
  });
});

interface PluralCase {
  readonly name: string;
  readonly render: (n: number) => string;
  readonly singular: string;
  readonly plural: (n: number) => string;
  /** Text that must appear in the singular form only, and its plural counterpart. */
  readonly singularWord: RegExp;
  readonly pluralWord: RegExp;
}

const PLURAL_CASES: readonly PluralCase[] = [
  {
    name: 'INGEST_UI_COPY.chunkCount',
    render: INGEST_UI_COPY.chunkCount,
    singular: '1 piece of your notes',
    plural: (n) => `${n} pieces of your notes`,
    singularWord: /\bpiece\b/,
    pluralWord: /\bpieces\b/,
  },
  {
    name: 'ROOM_PLAY_LABELS.hintsLeft',
    render: ROOM_PLAY_LABELS.hintsLeft,
    singular: '1 hint left',
    plural: (n) => `${n} hints left`,
    singularWord: /\bhint\b/,
    pluralWord: /\bhints\b/,
  },
];

describe('plural-aware copy', () => {
  for (const c of PLURAL_CASES) {
    describe(c.name, () => {
      it('uses the singular for 1 and no plural form', () => {
        expect(c.render(1)).toBe(c.singular);
        expect(c.render(1)).toMatch(c.singularWord);
        expect(c.render(1)).not.toMatch(c.pluralWord);
      });
      it('uses the plural for every other n in 0..10000, and no singular form', () => {
        fc.assert(
          fc.property(count, (n) => {
            fc.pre(n !== 1);
            const text = c.render(n);
            expect(text).toBe(c.plural(n));
            expect(text).toMatch(c.pluralWord);
            expect(text).not.toMatch(c.singularWord);
          }),
        );
      });
      it('has exact examples for 0, 1, 2 and a large value', () => {
        expect(c.render(0)).toBe(c.plural(0));
        expect(c.render(1)).toBe(c.singular);
        expect(c.render(2)).toBe(c.plural(2));
        expect(c.render(10_000)).toBe(c.plural(10_000));
      });
    });
  }

  describe('ROOM_PLAY_LABELS.spiritCandlesLit', () => {
    // Approved exception: for exactly one candle the copy is the singular sentence with no number.
    it('reads exactly "Spirit candle lit" for 1 (approved copy, no number)', () => {
      expect(ROOM_PLAY_LABELS.spiritCandlesLit(1)).toBe('Spirit candle lit');
    });
    it('uses the plural form for every other n', () => {
      fc.assert(
        fc.property(count, (n) => {
          fc.pre(n !== 1);
          const text = ROOM_PLAY_LABELS.spiritCandlesLit(n);
          expect(text).toBe(`Spirit candles lit: ${n}`);
          expect(text).not.toMatch(/\bcandle\b/);
        }),
      );
    });
    it('has exact examples for 0, 2 and a large value', () => {
      expect(ROOM_PLAY_LABELS.spiritCandlesLit(0)).toBe('Spirit candles lit: 0');
      expect(ROOM_PLAY_LABELS.spiritCandlesLit(2)).toBe('Spirit candles lit: 2');
      expect(ROOM_PLAY_LABELS.spiritCandlesLit(10_000)).toBe('Spirit candles lit: 10000');
    });
  });
});
