import {
  type Span,
  isHyphenBreak,
  spanLength,
  spanText,
  splitSpanToLimit,
  trimSpan,
} from './chunker-split';

const SENTENCE_END = /[.!?]["')\]\u201D\u2019]*$/;
const WHITESPACE = /\s/;

function isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff;
}

/**
 * Re-cuts two adjacent pieces of `source` so that both lie in [min, max]. The
 * cut falls in the window [total - max, total - min] of the range the two
 * pieces cover: a sentence boundary if the window has one, else the word
 * boundary closest to the end of the window, else whitespace inside a
 * line-break hyphen (last resort, see isHyphenBreak), else a hard cut that
 * never splits a surrogate pair. Both results are trimmed slices of `source`, so the
 * original whitespace between and inside them is kept exactly.
 */
export function rebalanceLastTwo(
  source: string,
  first: Span,
  second: Span,
  min: number,
  max: number,
): Span[] {
  const start = first.start;
  const end = second.end;
  const total = end - start;
  const lo = Math.max(min, total - max);
  const hi = total - min;
  if (lo > hi) return [first, second];

  const ok = (span: Span): boolean => spanLength(span) >= min && spanLength(span) <= max;
  const fits = (cut: number): Span[] | null => {
    const head = trimSpan(source, start, cut);
    const tail = trimSpan(source, cut, end);
    return ok(head) && ok(tail) ? [head, tail] : null;
  };

  let wordCut: Span[] | null = null;
  let hyphenCut: Span[] | null = null;
  for (let offset = hi; offset >= lo; offset--) {
    const cut = start + offset;
    if (!WHITESPACE.test(source.charAt(cut))) continue;
    const result = fits(cut);
    if (result === null) continue;
    if (isHyphenBreak(source, cut)) {
      hyphenCut ??= result;
      continue;
    }
    if (SENTENCE_END.test(spanText(source, result[0] as Span))) return result;
    wordCut ??= result;
  }
  if (wordCut !== null) return wordCut;
  if (hyphenCut !== null) return hyphenCut;

  for (let offset = hi; offset >= lo; offset--) {
    const cut = start + offset;
    if (isHighSurrogate(source.charCodeAt(cut - 1))) continue;
    const result = fits(cut);
    if (result !== null) return result;
  }
  return [first, second];
}

/**
 * Splits a span to the limit. If the last piece comes out shorter than `min`
 * and there is a piece before it, the last two pieces are rebalanced so no
 * piece of a multi-piece result is below `min`.
 */
export function splitBalanced(source: string, span: Span, min: number, max: number): Span[] {
  const pieces = splitSpanToLimit(source, span, max);
  const last = pieces[pieces.length - 1];
  if (pieces.length < 2 || last === undefined || spanLength(last) >= min) return pieces;
  const previous = pieces[pieces.length - 2] as Span;
  return [...pieces.slice(0, -2), ...rebalanceLastTwo(source, previous, last, min, max)];
}
