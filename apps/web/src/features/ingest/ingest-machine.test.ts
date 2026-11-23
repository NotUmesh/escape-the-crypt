import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { ANNOUNCEMENT_COPY, MAX_EXTRACTED_WORDS, errorMessage } from '@escape-the-crypt/core';
import { INITIAL_INGEST_STATE, canConfirm, ingestReducer } from './ingest-machine';
import type { IngestEvent, IngestState, IngestUnit } from './ingest-machine';

const PROSE =
  'Active recall means producing an answer from memory instead of re-reading the notes. ' +
  'Spaced repetition schedules each review just before the learner would forget the item.';

function run(events: readonly IngestEvent[], from: IngestState = INITIAL_INGEST_STATE): IngestState {
  return events.reduce(ingestReducer, from);
}

function pdfPage(index: number, text = PROSE): IngestEvent {
  return { type: 'EXTRACTION_PAGE', pdfPageIndex: index, printedPageLabel: null, text, flag: 'ok' };
}

function extractedTwoPages(): IngestState {
  return run([
    { type: 'FILE_SELECTED', sizeBytes: 1000, pageCount: 2 },
    { type: 'PAGES_CHOSEN', pageIndexes: [0, 1] },
    pdfPage(0),
    pdfPage(1, `Interleaving mixes related topics. ${PROSE}`),
  ]);
}

const blankText = fc.stringMatching(/^[ \t\r\n]{0,12}$/);

/** A preview state where every unit is excluded or whitespace-only. */
const emptyPreview: fc.Arbitrary<IngestState> = fc
  .array(fc.record({ included: fc.boolean(), blank: blankText, body: fc.string() }), { maxLength: 6 })
  .map((rows) => {
    const units: IngestUnit[] = rows.map((r, i) => {
      // An excluded unit may keep real text; an included unit must be blank.
      const currentText = r.included ? r.blank : r.body;
      return {
        id: `paste-${i + 1}`,
        kind: 'paste',
        paragraphNumber: i + 1,
        originalText: r.body,
        currentText,
        flag: 'ok',
        included: r.included,
      };
    });
    return { ...INITIAL_INGEST_STATE, status: 'preview' as const, units };
  });

describe('Property 7: Confirm is disabled for empty content', () => {
  /** **Validates: Requirements 5.6** */
  it('canConfirm is false and CONFIRM does not confirm when no included unit has text', () => {
    fc.assert(
      fc.property(emptyPreview, (state) => {
        expect(canConfirm(state)).toBe(false);
        const next = ingestReducer(state, { type: 'CONFIRM' });
        expect(next.status).toBe('preview');
        expect(next.chunks).toEqual([]);
        expect(next.error).toEqual({ kind: 'empty' });
      }),
    );
  });

  /** **Validates: Requirements 5.6** */
  it('canConfirm is false after pasting only whitespace', () => {
    fc.assert(
      fc.property(blankText, (text) => {
        const state = run([{ type: 'PASTE_CHANGED', text }]);
        expect(canConfirm(state)).toBe(false);
        expect(ingestReducer(state, { type: 'CONFIRM' }).status).not.toBe('confirmed');
      }),
    );
  });

  /** **Validates: Requirements 5.6** */
  it('canConfirm turns false once every unit is removed or edited to blank', () => {
    const state = run([{ type: 'PASTE_CHANGED', text: `${PROSE}\n\n${PROSE}` }]);
    expect(canConfirm(state)).toBe(true);
    const removed = run([{ type: 'PAGE_REMOVED', unitId: 'paste-1' }], state);
    expect(canConfirm(removed)).toBe(true);
    const blanked = run([{ type: 'TEXT_EDITED', unitId: 'paste-2', text: '  \n ' }], removed);
    expect(canConfirm(blanked)).toBe(false);
  });
});

describe('ingest state machine', () => {
  it('removing a page excludes it, announces it and keeps it out of the chunks', () => {
    const extracted = extractedTwoPages();
    expect(extracted.status).toBe('preview');
    const removed = run([{ type: 'PAGE_REMOVED', unitId: 'pdf-1' }], extracted);
    expect(removed.units.find((u) => u.id === 'pdf-1')?.included).toBe(false);
    expect(removed.units.find((u) => u.id === 'pdf-0')?.included).toBe(true);
    expect(removed.announcement).toBe(ANNOUNCEMENT_COPY.pageRemoved(2));
    expect(canConfirm(removed)).toBe(true);
    const confirmed = run([{ type: 'CONFIRM' }], removed);
    expect(confirmed.status).toBe('confirmed');
    expect(confirmed.announcement).toBe(ANNOUNCEMENT_COPY.confirmed);
    expect(confirmed.chunks.length).toBeGreaterThan(0);
    for (const chunk of confirmed.chunks) {
      expect(chunk.location).toMatchObject({ sourceType: 'pdf', pdfPageIndex: 0 });
    }
  });

  it('removing a pasted paragraph announces the paragraph number', () => {
    const state = run([
      { type: 'PASTE_CHANGED', text: `${PROSE}\n\n${PROSE}` },
      { type: 'PAGE_REMOVED', unitId: 'paste-2' },
    ]);
    expect(state.announcement).toBe(ANNOUNCEMENT_COPY.paragraphRemoved(2));
  });

  it('rejects pasted text over the word limit with the copy message', () => {
    const text = Array.from({ length: MAX_EXTRACTED_WORDS + 1 }, () => 'word').join(' ');
    const state = run([{ type: 'PASTE_CHANGED', text }]);
    expect(state.error).toEqual({ kind: 'word-count', limit: MAX_EXTRACTED_WORDS });
    expect(state.announcement).toBe(errorMessage({ kind: 'word-count', limit: MAX_EXTRACTED_WORDS }));
    expect(state.status).toBe('idle');
    expect(state.units).toEqual([]);
    expect(canConfirm(state)).toBe(false);
  });

  it('accepts pasted text exactly at the word limit', () => {
    const text = Array.from({ length: MAX_EXTRACTED_WORDS }, () => 'word').join(' ');
    const state = run([{ type: 'PASTE_CHANGED', text }]);
    expect(state.error).toBeNull();
    expect(state.status).toBe('preview');
  });

  it('cancel while extracting discards partial results and announces it', () => {
    const partial = run([
      { type: 'FILE_SELECTED', sizeBytes: 1000, pageCount: 3 },
      { type: 'PAGES_CHOSEN', pageIndexes: [0, 1, 2] },
      pdfPage(0),
    ]);
    expect(partial.status).toBe('extracting');
    expect(partial.units).toHaveLength(1);
    const cancelled = run([{ type: 'CANCEL' }], partial);
    expect(cancelled).toEqual({ ...INITIAL_INGEST_STATE, announcement: ANNOUNCEMENT_COPY.stopped });
    expect(canConfirm(cancelled)).toBe(false);
  });

  it('ignores cancel outside extraction', () => {
    const preview = extractedTwoPages();
    expect(ingestReducer(preview, { type: 'CANCEL' })).toBe(preview);
  });
});