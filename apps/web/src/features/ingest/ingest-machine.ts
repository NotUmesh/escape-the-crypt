import {
  ANNOUNCEMENT_COPY,
  capPageSelection,
  checkFileSize,
  checkWordCount,
  chunkDocument,
  countWords,
  errorMessage,
} from '@escape-the-crypt/core';
import type { Chunk, IngestError, PageFlag } from '@escape-the-crypt/core';

export type IngestStatus = 'idle' | 'pdf-chosen' | 'extracting' | 'preview' | 'confirmed';

/** One reviewable piece of the notes: a pasted paragraph or an extracted PDF page. */
export type IngestUnit =
  | {
      readonly id: string;
      readonly kind: 'paste';
      readonly paragraphNumber: number;
      readonly originalText: string;
      readonly currentText: string;
      readonly flag: PageFlag;
      readonly included: boolean;
    }
  | {
      readonly id: string;
      readonly kind: 'pdf';
      readonly pdfPageIndex: number;
      readonly printedPageLabel: string | null;
      readonly originalText: string;
      readonly currentText: string;
      readonly flag: PageFlag;
      readonly included: boolean;
    };

export interface IngestState {
  readonly status: IngestStatus;
  readonly units: readonly IngestUnit[];
  /** Number of PDF pages still expected while extracting. */
  readonly expectedPages: number;
  /** Page count of the chosen PDF, for the page picker. */
  readonly pageCount: number;
  readonly error: IngestError | null;
  /** Latest message for the polite live region. */
  readonly announcement: string;
  /** Set only after a successful CONFIRM. */
  readonly chunks: readonly Chunk[];
}

export type IngestEvent =
  | { readonly type: 'PASTE_CHANGED'; readonly text: string }
  | { readonly type: 'FILE_SELECTED'; readonly sizeBytes: number; readonly pageCount: number }
  | { readonly type: 'PAGES_CHOSEN'; readonly pageIndexes: readonly number[] }
  | {
      readonly type: 'EXTRACTION_PAGE';
      readonly pdfPageIndex: number;
      readonly printedPageLabel: string | null;
      readonly text: string;
      readonly flag: PageFlag;
    }
  | { readonly type: 'EXTRACTION_ERROR'; readonly error: IngestError }
  | { readonly type: 'CANCEL' }
  | { readonly type: 'PAGE_REMOVED'; readonly unitId: string }
  | { readonly type: 'TEXT_EDITED'; readonly unitId: string; readonly text: string }
  | { readonly type: 'CONFIRM' };

export const INITIAL_INGEST_STATE: IngestState = {
  status: 'idle',
  units: [],
  expectedPages: 0,
  pageCount: 0,
  error: null,
  announcement: '',
  chunks: [],
};


const PARAGRAPH_BREAK = /\n[^\S\n]*(?:\n[^\S\n]*)+/;

function splitParagraphs(text: string): string[] {
  return text
    .split(PARAGRAPH_BREAK)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
}

/** True only when at least one included unit has non-whitespace text (5.6). */
export function canConfirm(state: IngestState): boolean {
  return state.units.some((u) => u.included && u.currentText.trim().length > 0);
}

function fail(error: IngestError): IngestState {
  return { ...INITIAL_INGEST_STATE, error, announcement: errorMessage(error) };
}

function flagAnnouncement(unit: IngestUnit): string {
  if (unit.kind !== 'pdf') return '';
  const page = unit.pdfPageIndex + 1;
  if (unit.flag === 'low-text') return ANNOUNCEMENT_COPY.pageLowText(page);
  if (unit.flag === 'suspicious') return ANNOUNCEMENT_COPY.pageSuspicious(page);
  return '';
}

function onPaste(text: string): IngestState {
  if (text.trim().length === 0) return INITIAL_INGEST_STATE;
  const limit = checkWordCount(countWords(text));
  if (!limit.ok) return fail(limit.error);
  const units: IngestUnit[] = splitParagraphs(text).map((p, i) => ({
    id: `paste-${i + 1}`,
    kind: 'paste',
    paragraphNumber: i + 1,
    originalText: p,
    currentText: p,
    flag: 'ok',
    included: true,
  }));
  return { ...INITIAL_INGEST_STATE, status: 'preview', units };
}

function onFile(sizeBytes: number, pageCount: number): IngestState {
  const size = checkFileSize(sizeBytes);
  if (!size.ok) return fail(size.error);
  return { ...INITIAL_INGEST_STATE, status: 'pdf-chosen', pageCount };
}

function onPagesChosen(state: IngestState, pageIndexes: readonly number[]): IngestState {
  if (state.status !== 'pdf-chosen') return state;
  const { kept, capped } = capPageSelection(pageIndexes);
  if (kept.length === 0) return fail({ kind: 'empty' });
  const error: IngestError | null = capped
    ? { kind: 'page-count', limit: kept.length }
    : null;
  return {
    ...state,
    status: 'extracting',
    units: [],
    expectedPages: kept.length,
    error,
    announcement: error === null ? '' : errorMessage(error),
  };
}

function onExtractionPage(
  state: IngestState,
  event: Extract<IngestEvent, { type: 'EXTRACTION_PAGE' }>,
): IngestState {
  if (state.status !== 'extracting') return state;
  const unit: IngestUnit = {
    id: `pdf-${event.pdfPageIndex}`,
    kind: 'pdf',
    pdfPageIndex: event.pdfPageIndex,
    printedPageLabel: event.printedPageLabel,
    originalText: event.text,
    currentText: event.text,
    flag: event.flag,
    included: true,
  };
  const units = [...state.units.filter((u) => u.id !== unit.id), unit];
  const done = units.length >= state.expectedPages;
  return {
    ...state,
    status: done ? 'preview' : 'extracting',
    units,
    announcement: flagAnnouncement(unit),
  };
}

function onPageRemoved(state: IngestState, unitId: string): IngestState {
  if (state.status !== 'preview') return state;
  const target = state.units.find((u) => u.id === unitId);
  if (target === undefined || !target.included) return state;
  return {
    ...state,
    units: state.units.map((u) => (u.id === unitId ? { ...u, included: false } : u)),
    announcement:
      target.kind === 'pdf'
        ? ANNOUNCEMENT_COPY.pageRemoved(target.pdfPageIndex + 1)
        : ANNOUNCEMENT_COPY.paragraphRemoved(target.paragraphNumber),
  };
}

function onTextEdited(state: IngestState, unitId: string, text: string): IngestState {
  if (state.status !== 'preview') return state;
  if (!state.units.some((u) => u.id === unitId)) return state;
  return {
    ...state,
    units: state.units.map((u) => (u.id === unitId ? { ...u, currentText: text } : u)),
    announcement: ANNOUNCEMENT_COPY.edited,
  };
}

function onConfirm(state: IngestState): IngestState {
  if (state.status !== 'preview') return state;
  if (!canConfirm(state)) {
    const error: IngestError = { kind: 'empty' };
    return { ...state, error, announcement: errorMessage(error) };
  }
  const included = state.units.filter((u) => u.included && u.currentText.trim().length > 0);
  const first = included[0];
  const chunks =
    first?.kind === 'paste'
      ? chunkDocument({
          sourceType: 'paste',
          text: included.map((u) => u.currentText).join('\n\n'),
          originalText: included.map((u) => u.originalText).join('\n\n'),
        })
      : chunkDocument({
          sourceType: 'pdf',
          pages: included.flatMap((u) =>
            u.kind === 'pdf'
              ? [
                  {
                    pdfPageIndex: u.pdfPageIndex,
                    printedPageLabel: u.printedPageLabel,
                    text: u.currentText,
                    originalText: u.originalText,
                  },
                ]
              : [],
          ),
        });
  if (chunks.length === 0) {
    const error: IngestError = { kind: 'empty' };
    return { ...state, error, announcement: errorMessage(error) };
  }
  return { ...state, status: 'confirmed', error: null, chunks, announcement: ANNOUNCEMENT_COPY.confirmed };
}

/** Pure reducer. The UI dispatches events and renders the state; it never mutates it. */
export function ingestReducer(state: IngestState, event: IngestEvent): IngestState {
  switch (event.type) {
    case 'PASTE_CHANGED':
      return state.status === 'confirmed' ? state : onPaste(event.text);
    case 'FILE_SELECTED':
      return state.status === 'confirmed' ? state : onFile(event.sizeBytes, event.pageCount);
    case 'PAGES_CHOSEN':
      return onPagesChosen(state, event.pageIndexes);
    case 'EXTRACTION_PAGE':
      return onExtractionPage(state, event);
    case 'EXTRACTION_ERROR':
      return state.status === 'extracting' ? fail(event.error) : state;
    case 'CANCEL':
      // Partial results are discarded (2.6).
      return state.status === 'extracting'
        ? { ...INITIAL_INGEST_STATE, announcement: ANNOUNCEMENT_COPY.stopped }
        : state;
    case 'PAGE_REMOVED':
      return onPageRemoved(state, event.unitId);
    case 'TEXT_EDITED':
      return onTextEdited(state, event.unitId, event.text);
    case 'CONFIRM':
      return onConfirm(state);
  }
}
