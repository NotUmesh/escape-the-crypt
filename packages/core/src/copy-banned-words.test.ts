import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { citationLabel } from './citation-labeller';
import {
  ANNOUNCEMENT_COPY,
  BANNED_COPY_PHRASES,
  CITATION_COPY,
  ERROR_COPY,
  PAGE_FLAG_COPY,
  PRIVACY_NOTICE,
  PRIVACY_NOTICE_TEXT,
} from './copy';
import type { Chunk, SourceLocation } from './types';

/** Collects every string reachable from a catalogue value. */
function collectStrings(value: unknown, out: string[] = []): string[] {
  if (typeof value === 'string') out.push(value);
  else if (value !== null && typeof value === 'object') {
    for (const v of Object.values(value)) collectStrings(v, out);
  }
  return out;
}

function findBanned(text: string): string[] {
  const lower = text.toLowerCase();
  return BANNED_COPY_PHRASES.filter((p) => lower.includes(p.toLowerCase()));
}

const printedLabel = fc.oneof(
  fc.constant(null),
  fc.constantFrom('i', 'ii', 'iv', 'xii', 'A-1'),
  fc.stringMatching(/^[0-9a-z]{1,4}$/),
);

const location: fc.Arbitrary<SourceLocation> = fc.oneof(
  fc.record({
    sourceType: fc.constant('pdf' as const),
    pdfPageIndex: fc.nat({ max: 999 }),
    printedPageLabel: printedLabel,
  }),
  fc.record({
    sourceType: fc.constant('paste' as const),
    paragraphNumber: fc.integer({ min: 1, max: 5000 }),
  }),
);

const chunk: fc.Arbitrary<Chunk> = fc.record({
  id: fc.constant('chk_000000000000_0'),
  documentDigest: fc.constant('0'.repeat(64)),
  position: fc.nat({ max: 999 }),
  text: fc.string(),
  location,
  edited: fc.boolean(),
});

describe('Property 20: Banned words never appear in labels or copy', () => {
  /** **Validates: Requirements 8.4, 11.2** */
  it('has no banned phrase in any static copy string', () => {
    const strings = [
      ...collectStrings(ERROR_COPY),
      ...collectStrings(PAGE_FLAG_COPY),
      ...collectStrings(PRIVACY_NOTICE),
      ...collectStrings(ANNOUNCEMENT_COPY),
      PRIVACY_NOTICE_TEXT,
    ];
    expect(strings.length).toBeGreaterThan(0);
    for (const s of strings) expect(findBanned(s), s).toEqual([]);
  });

  /** **Validates: Requirements 8.4, 11.2** */
  it('has no banned phrase in announcement templates for any number', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 100000 }), (n) => {
        const texts = [
          ANNOUNCEMENT_COPY.pageRemoved(n),
          ANNOUNCEMENT_COPY.paragraphRemoved(n),
          ANNOUNCEMENT_COPY.pageLowText(n),
          ANNOUNCEMENT_COPY.pageSuspicious(n),
        ];
        for (const t of texts) expect(findBanned(t), t).toEqual([]);
      }),
    );
  });
  /** **Validates: Requirements 8.4, 11.2** */
  it('has no banned phrase in citation templates for any input', () => {
    fc.assert(
      fc.property(fc.nat({ max: 999 }), printedLabel, fc.integer({ min: 1, max: 5000 }), (page, label, para) => {
        const texts = [
          CITATION_COPY.pdfPage(page, label),
          CITATION_COPY.editedPdf(page, label),
          CITATION_COPY.pasteParagraph(para),
        ];
        for (const t of texts) expect(findBanned(t), t).toEqual([]);
      }),
    );
  });

  /** **Validates: Requirements 8.4, 11.2** */
  it('has no banned phrase in citationLabel output for any chunk', () => {
    fc.assert(
      fc.property(chunk, (c) => {
        const label = citationLabel(c);
        expect(findBanned(label), label).toEqual([]);
      }),
    );
  });
});
