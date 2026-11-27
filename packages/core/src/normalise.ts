export interface NormalisedText {
  readonly text: string;
  /** originalRange[i] = [start, end) in the original text for normalised char i */
  readonly originalRange: ReadonlyArray<readonly [number, number]>;
}

const LIGATURES: Readonly<Record<string, string>> = {
  '\uFB00': 'ff',
  '\uFB01': 'fi',
  '\uFB02': 'fl',
  '\uFB03': 'ffi',
  '\uFB04': 'ffl',
  '\uFB05': 'st',
  '\uFB06': 'st',
};

const QUOTES: Readonly<Record<string, string>> = {
  '\u2018': "'",
  '\u2019': "'",
  '\u201C': '"',
  '\u201D': '"',
};

/**
 * A hyphen at a line break: `-`, optional spaces/tabs, a newline, optional
 * spaces/tabs, then a letter (not consumed). Matches the chunker's
 * isHyphenBreak rule: `pages 5-\n10` keeps its hyphen, `exam-\nple` joins.
 */
export const LINE_BREAK_HYPHEN_SOURCE = String.raw`-[ \t]*(?:\r\n|\r|\n)[ \t]*(?=\p{L})`;
const LINE_BREAK_HYPHEN = new RegExp(LINE_BREAK_HYPHEN_SOURCE, 'uy');
const COMBINING_MARK = /^\p{M}$/u;
const WHITESPACE = /^\s$/u;

interface Entry {
  readonly ch: string;
  readonly start: number;
  readonly end: number;
}

/** Length of the cluster at `i`: one code point plus any following combining marks. */
function clusterEnd(s: string, i: number): number {
  let j = i + (s.codePointAt(i)! > 0xffff ? 2 : 1);
  while (j < s.length) {
    const cp = String.fromCodePoint(s.codePointAt(j)!);
    if (!COMBINING_MARK.test(cp)) break;
    j += cp.length;
  }
  return j;
}

function foldChars(text: string): string {
  let out = '';
  for (const ch of text) out += LIGATURES[ch] ?? QUOTES[ch] ?? ch;
  return out;
}

/**
 * Normalises text for quote matching: NFC, ligature expansion, curly quotes
 * folded to straight, line-break hyphens before a letter removed (in-word
 * hyphens and hyphens before a digit or symbol kept),
 * whitespace runs collapsed to one space, and the result trimmed.
 * Each output character maps to the original range it came from.
 */
export function normaliseWithMap(original: string): NormalisedText {
  const entries: Entry[] = [];
  let i = 0;
  while (i < original.length) {
    if (original[i] === '-') {
      LINE_BREAK_HYPHEN.lastIndex = i;
      const m = LINE_BREAK_HYPHEN.exec(original);
      if (m) {
        i += m[0].length;
        continue;
      }
    }
    const end = clusterEnd(original, i);
    const folded = foldChars(original.slice(i, end).normalize('NFC'));
    for (const unit of folded) {
      // Iterating by code point; split into UTF-16 units so indices line up with `text`.
      for (let k = 0; k < unit.length; k++) {
        entries.push({ ch: unit[k]!, start: i, end });
      }
    }
    i = end;
  }

  const text: string[] = [];
  const originalRange: Array<readonly [number, number]> = [];
  for (const e of entries) {
    if (WHITESPACE.test(e.ch)) {
      const last = originalRange.length - 1;
      if (last >= 0 && text[last] === ' ') {
        originalRange[last] = [originalRange[last]![0], e.end];
      } else {
        text.push(' ');
        originalRange.push([e.start, e.end]);
      }
    } else {
      text.push(e.ch);
      originalRange.push([e.start, e.end]);
    }
  }

  while (text.length > 0 && text[text.length - 1] === ' ') {
    text.pop();
    originalRange.pop();
  }
  let lead = 0;
  while (lead < text.length && text[lead] === ' ') lead++;

  return {
    text: text.slice(lead).join(''),
    originalRange: originalRange.slice(lead),
  };
}
