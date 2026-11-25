import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { citationLabel } from './citation-labeller';
import {
  ANNOUNCEMENT_COPY,
  AUTOPSY_LABELS,
  BANNED_COPY_PHRASES,
  RETURN_LABEL,
  CITATION_COPY,
  ERROR_COPY,
  INGEST_UI_COPY,
  PAGE_FLAG_COPY,
  PRIVACY_NOTICE,
  PRIVACY_NOTICE_TEXT,
  ENTER_CRYPT_LABEL,
  ESCAPE_COPY,
  FINAL_DOOR_BUTTON_TEXT,
  FINAL_DOOR_STATUS_LABELS,
  LOCK_OBJECT_NAMES,
  SLOT_STATUS_WORDS,
  ROOM_ANNOUNCEMENT_COPY,
  ROOM_PLAY_LABELS,
  ROOM_START_ERROR_COPY,
  SAMPLE_CRYPT_LABEL,
  SAMPLE_CRYPT_LINE,
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

describe('Autopsy labels (room-runtime Req 23)', () => {
  /** **Validates: Requirements 23.1, 23.2, 23.3** */
  it('uses the exact label text for each outcome and the Return label', () => {
    expect(AUTOPSY_LABELS).toEqual({
      'first-try-correct': 'First-try correct',
      assisted: 'Assisted',
      retried: 'Retried',
      challenged: 'Challenged: excluded from score',
      'review-due': 'Review due',
    });
    expect(RETURN_LABEL).toBe('Review');
  });

  /** **Validates: Requirements 23.4, 22.10** */
  it('has no banned phrase and no learning-gain claim in any label', () => {
    const gainClaims = [
      /learning gain/i,
      /you (have )?learned/i,
      /improv\w* (your )?(grade|score|retention)/i,
      /retention/i,
    ];
    for (const s of [...collectStrings(AUTOPSY_LABELS), RETURN_LABEL]) {
      expect(findBanned(s), s).toEqual([]);
      for (const re of gainClaims) expect(re.test(s), s).toBe(false);
    }
  });
});

describe('Room-play copy', () => {
  /** **Validates: Requirements 3.6, 3.7** */
  it('has no banned phrase in any room-play string, and every error has what and next', () => {
    const strings = [
      ...collectStrings(ROOM_ANNOUNCEMENT_COPY),
      ...collectStrings(FINAL_DOOR_STATUS_LABELS),
      ...collectStrings(ESCAPE_COPY),
      ...collectStrings(ROOM_START_ERROR_COPY),
      ...collectStrings(ROOM_PLAY_LABELS),
      ...collectStrings(LOCK_OBJECT_NAMES),
      ...collectStrings(SLOT_STATUS_WORDS),
      SAMPLE_CRYPT_LINE,
      SAMPLE_CRYPT_LABEL,
      ENTER_CRYPT_LABEL,
      FINAL_DOOR_BUTTON_TEXT,
      CITATION_COPY.sampleParagraph(1),
      ROOM_PLAY_LABELS.hintsLeft(0),
      ROOM_PLAY_LABELS.hintsLeft(1),
      ROOM_PLAY_LABELS.hintsLeft(3),
      ROOM_PLAY_LABELS.ghostName(2),
      ROOM_PLAY_LABELS.returnSlotName(true),
      ROOM_PLAY_LABELS.returnSlotName(false),
    ];
    for (const s of strings) {
      expect(s.length, s).toBeGreaterThan(0);
      expect(findBanned(s), s).toEqual([]);
    }
    for (const e of Object.values(ROOM_START_ERROR_COPY)) {
      expect(e.what.length).toBeGreaterThan(0);
      expect(e.next.length).toBeGreaterThan(0);
    }
  });

  /** **Validates: Requirements 3.5, 16.3, 19.2, 19.9, 20.9, 20.11** */
  it('uses the exact required wording', () => {
    expect(FINAL_DOOR_STATUS_LABELS).toEqual({
      open: 'Not yet answered',
      solved: 'Solved',
      settled: 'Excluded from score',
      challenged: 'Challenged: excluded from score',
    });
    expect(CITATION_COPY.sampleParagraph(3)).toBe('Paragraph 3 of the sample notes');
    expect(ROOM_PLAY_LABELS.openAutopsy).toBe('Open the Autopsy');
    expect(ROOM_PLAY_LABELS.playAgain).toBe('Play again');
    expect(ROOM_PLAY_LABELS.noHintsLeft).toBe('No hints left');
    expect(ROOM_PLAY_LABELS.excerptMatched).toBe('Source excerpt matched');
    expect(ROOM_PLAY_LABELS.challengedLabel).toBe('Challenged: excluded from score');
    expect(ROOM_PLAY_LABELS.ghostReturnsLater).toBe('This ghost returns later.');
    expect(ROOM_PLAY_LABELS.wrongOpening).toBe("Not this time. Here's what your notes say.");
    expect(Object.keys(ROOM_ANNOUNCEMENT_COPY.notice)).toEqual([
      'candleLit',
      'ghostSpawned',
      'ghostLaidToRest',
      'sealCracked',
      'roomCleared',
      'escaped',
    ]);
  });
});

describe('Property 20: Banned words never appear in labels or copy', () => {
  /** **Validates: Requirements 8.4, 11.2** */
  it('has no banned phrase in any static copy string', () => {
    const strings = [
      ...collectStrings(ERROR_COPY),
      ...collectStrings(PAGE_FLAG_COPY),
      ...collectStrings(PRIVACY_NOTICE),
      ...collectStrings(ANNOUNCEMENT_COPY),
      ...collectStrings(INGEST_UI_COPY),
      ...collectStrings(AUTOPSY_LABELS),
      RETURN_LABEL,
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
  it('has no banned phrase in ingest label templates for any number', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 100000 }), fc.integer({ min: 0, max: 100000 }), (n, m) => {
        const texts = [
          INGEST_UI_COPY.wordCounter(n),
          INGEST_UI_COPY.pageName(n),
          INGEST_UI_COPY.paragraphName(n),
          INGEST_UI_COPY.pagesChosen(n),
          INGEST_UI_COPY.reading(n, m),
          INGEST_UI_COPY.removePageFor(n),
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
          CITATION_COPY.sampleParagraph(para),
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
