export const MAX_CHUNK_CHARS = 1200;

/** A heading line is at most this many characters long. */
export const HEADING_MAX_CHARS = 80;

/**
 * A half-open range [start, end) into one unit's original text. Chunk text is
 * always a slice of the original, so its whitespace is kept exactly.
 */
export interface Span {
  readonly start: number;
  readonly end: number;
}

const WHITESPACE = /\s/;
const TERMINAL_PUNCTUATION = /[.!?:;,]$/;
const SENTENCE_PIECES = /[\s\S]*?[.!?]+["')\]\u201D\u2019]*(?:\s+|$)|[\s\S]+$/g;

export const spanLength = (span: Span): number => span.end - span.start;

export const spanText = (source: string, span: Span): string => source.slice(span.start, span.end);

/** Shrinks [start, end) so it neither starts nor ends with whitespace. */
export function trimSpan(source: string, start: number, end: number): Span {
  let s = start;
  let e = end;
  while (s < e && WHITESPACE.test(source.charAt(s))) s++;
  while (e > s && WHITESPACE.test(source.charAt(e - 1))) e--;
  return { start: s, end: e };
}

export function isAllCapsHeading(line: string): boolean {
  const trimmed = line.trim();
  return (
    trimmed.length > 0 &&
    trimmed.length <= HEADING_MAX_CHARS &&
    !TERMINAL_PUNCTUATION.test(trimmed) &&
    /\p{L}/u.test(trimmed) &&
    trimmed === trimmed.toUpperCase() &&
    trimmed !== trimmed.toLowerCase()
  );
}

/**
 * Candidate chunks of one unit: blocks separated by blank lines, and heading
 * lines (short, no terminal punctuation, all caps) on their own. Spans are
 * trimmed and never empty.
 */
export function candidateSpans(source: string): Span[] {
  const out: Span[] = [];
  let pendingStart = -1;
  let pendingEnd = -1;
  const flush = (): void => {
    if (pendingStart >= 0) {
      const span = trimSpan(source, pendingStart, pendingEnd);
      if (spanLength(span) > 0) out.push(span);
    }
    pendingStart = -1;
  };
  let lineStart = 0;
  while (lineStart <= source.length) {
    const newline = source.indexOf('\n', lineStart);
    const lineEnd = newline < 0 ? source.length : newline;
    const line = source.slice(lineStart, lineEnd);
    if (line.trim().length === 0) {
      flush();
    } else if (isAllCapsHeading(line)) {
      flush();
      out.push(trimSpan(source, lineStart, lineEnd));
    } else {
      if (pendingStart < 0) pendingStart = lineStart;
      pendingEnd = lineEnd;
    }
    lineStart = lineEnd + 1;
  }
  flush();
  return out;
}

const LETTER = /\p{L}/u;

/**
 * True when the whitespace at `index` belongs to a line-break hyphen: a
 * whitespace run that contains a newline, directly follows "-" and directly
 * precedes a letter ("exam-\nple", also "exam- \n ple"). Cutting there would
 * put "exam-" and "ple" in different chunks, so a quote spanning the break
 * could never resolve. Splitters use such a cut only as a last resort before
 * a hard cut.
 */
export function isHyphenBreak(source: string, index: number): boolean {
  if (!WHITESPACE.test(source.charAt(index))) return false;
  let start = index;
  while (start > 0 && WHITESPACE.test(source.charAt(start - 1))) start--;
  let end = index + 1;
  while (end < source.length && WHITESPACE.test(source.charAt(end))) end++;
  if (source.charAt(start - 1) !== '-') return false;
  const next = source.codePointAt(end);
  if (next === undefined || !LETTER.test(String.fromCodePoint(next))) return false;
  return source.slice(start, end).includes('\n');
}

/** Moves a hard cut back by one so it never splits a surrogate pair. */
function safeCut(source: string, start: number, cut: number): number {
  const code = source.charCodeAt(cut - 1);
  return cut - start > 1 && code >= 0xd800 && code <= 0xdbff ? cut - 1 : cut;
}

/**
 * Splits one over-long sentence at the last word boundary at or before the
 * limit. Whitespace inside a line-break hyphen is used only when no other
 * word boundary fits; a run with no usable whitespace is cut hard at the limit.
 */
function splitAtWords(source: string, start: number, end: number, max: number): Span[] {
  const parts: Span[] = [];
  const trimmed = trimSpan(source, start, end);
  const b = trimmed.end;
  let a = trimmed.start;
  while (b - a > max) {
    let cut = -1;
    let hyphenCut = -1;
    for (let i = a + max; i > a; i--) {
      if (!WHITESPACE.test(source.charAt(i))) continue;
      if (isHyphenBreak(source, i)) {
        if (hyphenCut < 0) hyphenCut = i;
        continue;
      }
      cut = i;
      break;
    }
    if (cut < 0) cut = hyphenCut;
    if (cut < 0) cut = safeCut(source, a, a + max);
    parts.push(trimSpan(source, a, cut));
    a = trimSpan(source, cut, b).start;
  }
  if (b > a) parts.push({ start: a, end: b });
  return parts;
}

function trimmedEndLength(source: string, start: number, end: number): number {
  let e = end;
  while (e > start && WHITESPACE.test(source.charAt(e - 1))) e--;
  return e - start;
}

/**
 * Splits a span into pieces of at most `max` characters. Sentences are packed
 * greedily; a sentence longer than the limit is split at word boundaries, and
 * a token with no whitespace is hard-split. A span within the limit is
 * returned as one trimmed piece.
 */
export function splitSpanToLimit(source: string, span: Span, max: number = MAX_CHUNK_CHARS): Span[] {
  const trimmed = trimSpan(source, span.start, span.end);
  if (spanLength(trimmed) === 0) return [];
  if (spanLength(trimmed) <= max) return [trimmed];

  const out: Span[] = [];
  let currentStart = -1;
  let currentEnd = -1;
  const flush = (): void => {
    if (currentStart >= 0) {
      const piece = trimSpan(source, currentStart, currentEnd);
      if (spanLength(piece) > 0) out.push(piece);
    }
    currentStart = -1;
  };
  for (const match of spanText(source, trimmed).matchAll(SENTENCE_PIECES)) {
    const pieceStart = trimmed.start + match.index;
    const pieceEnd = pieceStart + match[0].length;
    if (trimmedEndLength(source, pieceStart, pieceEnd) > max) {
      flush();
      out.push(...splitAtWords(source, pieceStart, pieceEnd, max));
    } else if (currentStart < 0) {
      currentStart = pieceStart;
      currentEnd = pieceEnd;
    } else if (trimmedEndLength(source, currentStart, pieceEnd) <= max) {
      currentEnd = pieceEnd;
    } else {
      flush();
      currentStart = pieceStart;
      currentEnd = pieceEnd;
    }
  }
  flush();
  return out;
}

/** String form of `splitSpanToLimit` over the whole text. */
export function splitToLimit(text: string, max: number = MAX_CHUNK_CHARS): string[] {
  return splitSpanToLimit(text, { start: 0, end: text.length }, max).map((s) => spanText(text, s));
}
