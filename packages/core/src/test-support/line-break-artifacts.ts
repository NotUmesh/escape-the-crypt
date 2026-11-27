/** Counts of PDF line-break leftovers in one piece of text. */
export interface LineBreakArtifacts {
  /** A hyphen followed by whitespace and a letter: "exam-\nple", "hetero- sexual". */
  readonly hyphenArtifacts: number;
  /** A line that ends in "letter-" and continues in lowercase: a word cut by the line break. */
  readonly midWordBreaks: number;
  /** A single line break between two non-blank lines, after a line with no closing punctuation. */
  readonly midSentenceBreaks: number;
}
const HYPHEN_ARTIFACT = /\p{L}-\s+\p{L}/gu;
const MID_WORD_BREAK = /\p{L}-[ \t]*\r?\n[ \t]*\p{Ll}/gu;
const SENTENCE_END = /[.!?:;]["')\]\u201D\u2019]*$/;
export function countLineBreakArtifacts(text: string): LineBreakArtifacts {
  const lines = text.split(/\r?\n/);
  let midSentenceBreaks = 0;
  for (let i = 0; i + 1 < lines.length; i++) {
    const here = (lines[i] as string).trim();
    const next = (lines[i + 1] as string).trim();
    if (here !== '' && next !== '' && !SENTENCE_END.test(here)) midSentenceBreaks++;
  }
  return {
    hyphenArtifacts: text.match(HYPHEN_ARTIFACT)?.length ?? 0,
    midWordBreaks: text.match(MID_WORD_BREAK)?.length ?? 0,
    midSentenceBreaks,
  };
}
export const NO_ARTIFACTS: LineBreakArtifacts = {
  hyphenArtifacts: 0,
  midWordBreaks: 0,
  midSentenceBreaks: 0,
};
export function addArtifacts(a: LineBreakArtifacts, b: LineBreakArtifacts): LineBreakArtifacts {
  return {
    hyphenArtifacts: a.hyphenArtifacts + b.hyphenArtifacts,
    midWordBreaks: a.midWordBreaks + b.midWordBreaks,
    midSentenceBreaks: a.midSentenceBreaks + b.midSentenceBreaks,
  };
}
/** Every string reachable inside a JSON-like value. */
export function collectStrings(value: unknown, out: string[] = []): string[] {
  if (typeof value === 'string') out.push(value);
  else if (Array.isArray(value)) for (const v of value) collectStrings(v, out);
  else if (typeof value === 'object' && value !== null) {
    for (const v of Object.values(value)) collectStrings(v, out);
  }
  return out;
}
