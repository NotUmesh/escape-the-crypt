import {
  assemblePageText,
  checkElapsed,
  checkWordCount,
  classifyPage,
  countWords,
} from '@escape-the-crypt/core';
import type { IngestError, PageFlag, TextItemData } from '@escape-the-crypt/core';

/** Injected time source so the 20-second limit is testable without a slow fixture. */
export interface Clock {
  now(): number;
}

/** The slice of a pdf.js text item the worker reads. Marked-content entries lack `str`. */
export interface PdfTextItemLike {
  /** Present on marked-content entries; text items leave it unset. */
  readonly type?: string;
  readonly str?: string;
  readonly transform?: readonly number[];
  readonly height?: number;
  readonly hasEOL?: boolean;
}

export interface PdfPageLike {
  getTextContent(): Promise<{ readonly items: readonly PdfTextItemLike[] }>;
  cleanup?(): unknown;
}

/** The slice of a pdf.js document the worker uses. Page numbers are 1-based, as in pdf.js. */
export interface PdfDocumentLike {
  readonly numPages: number;
  getPage(pageNumber: number): Promise<PdfPageLike>;
  getPageLabels(): Promise<readonly string[] | null>;
}

export type ExtractionMessageIn =
  | {
      readonly type: 'start';
      readonly fileBuffer: ArrayBuffer;
      /** 0-based page indexes, in the order to extract. */
      readonly pageIndexes: readonly number[];
      readonly startedAtMs: number;
    }
  | {
      readonly type: 'count';
      readonly fileBuffer: ArrayBuffer;
    }
  | { readonly type: 'cancel' };

export type ExtractionMessageOut =
  | { readonly type: 'progress'; readonly page: number; readonly total: number }
  | {
      readonly type: 'page';
      readonly pdfPageIndex: number;
      readonly printedPageLabel: string | null;
      readonly text: string;
      readonly flag: PageFlag;
    }
  | {
      readonly type: 'counted';
      readonly pageCount: number;
      /** Printed page labels, one per page; null where the PDF has none. */
      readonly labels: readonly (string | null)[];
    }
  | { readonly type: 'error'; readonly error: IngestError }
  | { readonly type: 'done' };

/** Maps a pdf.js failure to a typed error. Never inspects or logs message text. */
export function mapPdfError(err: unknown): IngestError {
  const name = typeof err === 'object' && err !== null ? (err as { name?: unknown }).name : undefined;
  return name === 'PasswordException' ? { kind: 'encrypted' } : { kind: 'unreadable' };
}

/** Maps pdf.js items to plain data. Items without a string (marked content) are skipped. */
export function toTextItemData(items: readonly PdfTextItemLike[]): TextItemData[] {
  const out: TextItemData[] = [];
  for (const item of items) {
    if (typeof item.str !== 'string') continue;
    out.push({
      str: item.str,
      y: item.transform?.[5] ?? 0,
      height: item.height ?? 0,
      hasEOL: item.hasEOL === true,
    });
  }
  return out;
}

export interface ExtractionRun {
  readonly doc: PdfDocumentLike;
  readonly pageIndexes: readonly number[];
  readonly startedAtMs: number;
  readonly clock: Clock;
  readonly post: (message: ExtractionMessageOut) => void;
  readonly isCancelled: () => boolean;
}

/**
 * Extracts the chosen pages in order. Posts progress, page, error or done.
 * Stops at the first limit or read error, or when cancelled (no message then).
 */
export async function runExtraction(run: ExtractionRun): Promise<void> {
  const { doc, pageIndexes, startedAtMs, clock, post, isCancelled } = run;
  const total = pageIndexes.length;
  let words = 0;
  let labels: readonly string[] | null = null;
  try {
    labels = await doc.getPageLabels();
  } catch {
    labels = null;
  }
  for (let i = 0; i < total; i += 1) {
    if (isCancelled()) return;
    const index = pageIndexes[i] as number;
    const before = checkElapsed(startedAtMs, clock.now());
    if (!before.ok) return post({ type: 'error', error: before.error });
    post({ type: 'progress', page: i + 1, total });
    let text: string;
    try {
      const page = await doc.getPage(index + 1);
      const content = await page.getTextContent();
      text = assemblePageText(toTextItemData(content.items));
      page.cleanup?.();
    } catch (err) {
      return post({ type: 'error', error: mapPdfError(err) });
    }
    if (isCancelled()) return;
    const after = checkElapsed(startedAtMs, clock.now());
    if (!after.ok) return post({ type: 'error', error: after.error });
    words += countWords(text);
    const limit = checkWordCount(words);
    if (!limit.ok) return post({ type: 'error', error: limit.error });
    const label = labels?.[index];
    post({
      type: 'page',
      pdfPageIndex: index,
      printedPageLabel: label === undefined || label === '' ? null : label,
      text,
      flag: classifyPage(text),
    });
  }
  post({ type: 'done' });
}

export interface CountRun {
  /** Opens the document; a password or parse failure rejects. The caller destroys it. */
  readonly open: () => Promise<PdfDocumentLike>;
  readonly post: (message: ExtractionMessageOut) => void;
  readonly isCancelled: () => boolean;
}

/**
 * Opens the document and reports its page count and printed page labels.
 * Posts `counted` or `error`; posts nothing when cancelled.
 */
export async function runCount(run: CountRun): Promise<void> {
  const { open, post, isCancelled } = run;
  try {
    const doc = await open();
    let labels: readonly string[] | null = null;
    try {
      labels = await doc.getPageLabels();
    } catch {
      labels = null;
    }
    if (isCancelled()) return;
    post({
      type: 'counted',
      pageCount: doc.numPages,
      labels: Array.from({ length: doc.numPages }, (_, i) => {
        const label = labels?.[i];
        return label === undefined || label === '' ? null : label;
      }),
    });
  } catch (err) {
    if (!isCancelled()) post({ type: 'error', error: mapPdfError(err) });
  }
}