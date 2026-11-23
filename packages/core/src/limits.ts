import type { LimitError, Result } from './types';

export const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024;
export const MAX_SELECTED_PAGES = 10;
export const MAX_EXTRACTED_WORDS = 6000;
export const MAX_EXTRACTION_MS = 20_000;

const OK: Result<true, LimitError> = { ok: true, value: true };

/** A size equal to the limit passes. */
export function checkFileSize(bytes: number): Result<true, LimitError> {
  if (bytes > MAX_FILE_SIZE_BYTES) {
    return { ok: false, error: { kind: 'file-size', limitBytes: MAX_FILE_SIZE_BYTES } };
  }
  return OK;
}

/** Keeps the first MAX_SELECTED_PAGES entries; `capped` is true only if some were dropped. */
export function capPageSelection(pageIndexes: readonly number[]): {
  kept: number[];
  capped: boolean;
} {
  return {
    kept: pageIndexes.slice(0, MAX_SELECTED_PAGES),
    capped: pageIndexes.length > MAX_SELECTED_PAGES,
  };
}

/** Counts whitespace-separated words. */
export function countWords(text: string): number {
  const trimmed = text.trim();
  return trimmed === '' ? 0 : trimmed.split(/\s+/u).length;
}

/** A running total equal to the limit passes. */
export function checkWordCount(runningTotal: number): Result<true, LimitError> {
  if (runningTotal > MAX_EXTRACTED_WORDS) {
    return { ok: false, error: { kind: 'word-count', limit: MAX_EXTRACTED_WORDS } };
  }
  return OK;
}

/** An elapsed time equal to the limit passes. Both timestamps come from an injected clock. */
export function checkElapsed(startedAtMs: number, nowMs: number): Result<true, LimitError> {
  if (nowMs - startedAtMs > MAX_EXTRACTION_MS) {
    return { ok: false, error: { kind: 'time', limitMs: MAX_EXTRACTION_MS } };
  }
  return OK;
}
