import { countWords } from './limits';
import type { PageFlag } from './types';

/** Pages with fewer words than this are treated as scanned or image-only. */
export const LOW_TEXT_MIN_WORDS = 20;
/** Share of odd characters (among non-space characters) above which a page is suspicious. */
export const GARBLE_MAX_RATIO = 0.05;
/** The short-line rule only applies when a page has at least this many non-empty lines. */
export const SHORT_LINE_MIN_LINES = 8;
/** A median line length below this suggests tables or columns. */
export const SHORT_LINE_MEDIAN_CHARS = 12;

function isOddCodePoint(cp: number): boolean {
  return (
    cp === 0xfffd ||
    cp <= 0x1f ||
    (cp >= 0x7f && cp <= 0x9f) ||
    (cp >= 0xe000 && cp <= 0xf8ff) ||
    (cp >= 0xf0000 && cp <= 0xffffd) ||
    (cp >= 0x100000 && cp <= 0x10fffd)
  );
}

/** Ratio of odd characters to all non-space characters. Whitespace controls (\n, \t) are spaces. */
function oddRatio(text: string): number {
  let odd = 0;
  let total = 0;
  for (const ch of text) {
    if (/\s/u.test(ch)) continue;
    total += 1;
    if (isOddCodePoint(ch.codePointAt(0) ?? 0)) odd += 1;
  }
  return total === 0 ? 0 : odd / total;
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const upper = sorted[mid] ?? 0;
  if (sorted.length % 2 === 1) return upper;
  return ((sorted[mid - 1] ?? 0) + upper) / 2;
}

/** Classifies the extracted text of one page. Rules apply in order. */
export function classifyPage(text: string): PageFlag {
  if (countWords(text) < LOW_TEXT_MIN_WORDS) return 'low-text';
  if (oddRatio(text) > GARBLE_MAX_RATIO) return 'suspicious';

  const lines = text
    .split(/\r\n|\r|\n/u)
    .map((line) => line.trim())
    .filter((line) => line !== '');
  if (lines.length >= SHORT_LINE_MIN_LINES) {
    const lengths = lines.map((line) => Array.from(line).length);
    if (median(lengths) < SHORT_LINE_MEDIAN_CHARS) return 'suspicious';
  }
  return 'ok';
}
