import fc from 'fast-check';
/**
 * Generators that imitate PDF text extraction: one paragraph, hard-wrapped at a random width,
 * optionally with words cut by a soft hyphen at the line end. Real compounds ("well-known") and
 * page ranges ("pp. 5-10") appear in the text; a compound is never cut at its own hyphen,
 * because that case cannot be told apart from a soft hyphen (see reflow.ts).
 */
const plainWord = fc.stringMatching(/^[a-z]{1,11}$/);
const compound = fc.constantFrom('well-known', 'self-esteem', 'long-term', 'sleep-deprived');
const pageRange = fc
  .tuple(fc.integer({ min: 1, max: 99 }), fc.integer({ min: 1, max: 99 }))
  .map(([a, b]) => `pp. ${a}-${b}`);
const tokenArb = fc.oneof(
  { weight: 12, arbitrary: plainWord },
  { weight: 1, arbitrary: compound },
  { weight: 1, arbitrary: pageRange },
);
/** A sentence of 3-25 tokens ending in a full stop. */
export const wrapSentenceArb: fc.Arbitrary<string> = fc
  .array(tokenArb, { minLength: 3, maxLength: 25 })
  .map((ts) => `${ts.join(' ')}.`);
/** One unwrapped paragraph: sentences separated by single spaces. */
export const unwrappedParagraphArb = (maxSentences = 8): fc.Arbitrary<string> =>
  fc.array(wrapSentenceArb, { minLength: 1, maxLength: maxSentences }).map((ss) => ss.join(' '));
export interface WrapOptions {
  readonly width: number;
  /** Whether to cut words of 4+ letters with a soft hyphen at the line end. */
  readonly softHyphens: boolean;
  /** Spaces left at line ends, as some PDF producers emit. */
  readonly trailingSpace: boolean;
  /** Random choices, consumed in order; cycled when exhausted. */
  readonly choices: readonly number[];
}
export const wrapOptionsArb: fc.Arbitrary<WrapOptions> = fc.record({
  width: fc.integer({ min: 8, max: 90 }),
  softHyphens: fc.boolean(),
  trailingSpace: fc.boolean(),
  choices: fc.array(fc.nat({ max: 999 }), { minLength: 1, maxLength: 40 }),
});
/** Hard-wraps one paragraph (words separated by single spaces) like a PDF line layout. */
export function wrapParagraph(paragraph: string, options: WrapOptions): string {
  let pick = 0;
  const next = (): number => options.choices[pick++ % options.choices.length] as number;
  const eol = options.trailingSpace ? ' \n' : '\n';
  const lines: string[] = [];
  let line = '';
  for (const word of paragraph.split(' ')) {
    if (line === '') {
      line = word;
      continue;
    }
    if (line.length + 1 + word.length <= options.width) {
      line += ` ${word}`;
      continue;
    }
    const range = /^(\d+-)(\d+)$/.exec(word);
    if (range !== null && next() % 2 === 0) {
      // "pp. 5-\n10": the hyphen is real and must survive.
      lines.push(`${line} ${range[1] as string}`);
      line = range[2] as string;
      continue;
    }
    const letters = /^[a-z]{4,}/.exec(word)?.[0].length ?? 0;
    if (options.softHyphens && letters >= 4 && next() % 2 === 0) {
      const cut = 2 + (next() % (letters - 3));
      lines.push(`${line} ${word.slice(0, cut)}-`);
      line = word.slice(cut);
      continue;
    }
    lines.push(line);
    line = word;
  }
  lines.push(line);
  return lines.join(eol);
}
