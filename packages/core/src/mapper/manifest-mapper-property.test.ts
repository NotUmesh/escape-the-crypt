import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type {
  RuneCipherAuthoringQuestion,
  SeanceBoardAuthoringQuestion,
} from '../authoring/schema';
import { buildDocumentChunkMaps, mapAuthoringQuestionToSpec, type DocumentChunkMaps } from './manifest-mapper';

/**
 * Documents are paragraphs of unique single-word tokens (no punctuation), so every chunk is
 * one paragraph and every run of whole words resolves to exactly one place. Some tokens carry
 * a non-BMP character so code point counting differs from UTF-16 length.
 */
interface Doc {
  readonly maps: DocumentChunkMaps;
  /** Words of each paragraph, index 0 = paragraph 1. */
  readonly paragraphs: readonly (readonly string[])[];
}

const letters3 = (n: number): string =>
  String.fromCharCode(97 + (n % 26), 97 + (Math.floor(n / 26) % 26), 97 + (Math.floor(n / 676) % 26));

const tokenPartsArb = fc.tuple(
  fc.constantFrom('', '', '', '\u{1D518}', '\u{1F600}', '\u{1D4B3}'),
  fc.stringMatching(/^[a-z]{3,6}$/),
);

const docArb: fc.Arbitrary<Doc> = fc
  .array(fc.array(tokenPartsArb, { minLength: 15, maxLength: 30 }), { minLength: 3, maxLength: 5 })
  .map((paragraphParts) => {
    let index = 0;
    const paragraphs = paragraphParts.map((parts) =>
      parts.map(([mark, stem]) => `${letters3(index++)}${mark}${stem}`),
    );
    const maps = buildDocumentChunkMaps(paragraphs.map((p) => p.join(' ')).join('\n\n'));
    return { maps, paragraphs };
  });

interface Span {
  readonly paragraph: number;
  readonly words: readonly string[];
}

/** A run of 5 to 12 whole words from one paragraph. */
const spanArb = (doc: Doc): fc.Arbitrary<Span> =>
  fc
    .tuple(fc.integer({ min: 0, max: doc.paragraphs.length - 1 }), fc.nat(), fc.integer({ min: 5, max: 12 }))
    .map(([pi, startSeed, len]) => {
      const words = doc.paragraphs[pi]!;
      const start = startSeed % (words.length - len + 1);
      return { paragraph: pi + 1, words: words.slice(start, start + len) };
    });

type RuneHint = NonNullable<RuneCipherAuthoringQuestion['hint']>;

interface RuneCase {
  readonly doc: Doc;
  readonly question: RuneCipherAuthoringQuestion;
  /** The answer's code points, first to last. */
  readonly codePoints: readonly string[];
}

const runeBaseArb: fc.Arbitrary<RuneCase> = docArb.chain((doc) =>
  fc
    .tuple(spanArb(doc), fc.nat(), fc.integer({ min: 1, max: 2 }), fc.boolean())
    .map(([span, offsetSeed, answerWords, caseSensitive]) => {
      const take = Math.min(answerWords, span.words.length);
      const at = offsetSeed % (span.words.length - take + 1);
      const answer = span.words.slice(at, at + take).join(' ');
      const question: RuneCipherAuthoringQuestion = {
        id: 'r1',
        conceptId: 'c1',
        role: 'primary',
        lockType: 'rune-cipher',
        prompt: 'Complete the line from your notes: ___ appears here',
        answer,
        aliases: [],
        caseSensitive,
        evidence: [{ paragraph: span.paragraph, quote: span.words.join(' ') }],
        explanation: 'See the quoted line.',
      };
      return { doc, question, codePoints: Array.from(answer) };
    }),
);

const matchingHint = (c: RuneCase): RuneHint => ({
  kind: 'first-letter-and-length',
  firstLetter: c.codePoints[0]!,
  length: c.codePoints.length,
});

/** A hint that disagrees with the code-computed one in first letter, length, or UTF-16 length. */
const mismatchingHintArb = (c: RuneCase): fc.Arbitrary<RuneHint> => {
  const good = matchingHint(c);
  const utf16 = c.question.answer.length;
  const options: fc.Arbitrary<RuneHint>[] = [
    fc.constantFrom('#', '\u03A9', '\u00DF').map((firstLetter) => ({ ...good, firstLetter })),
    fc.integer({ min: 1, max: 5 }).map((delta) => ({ ...good, length: good.length + delta })),
  ];
  if (utf16 !== good.length) options.push(fc.constant({ ...good, length: utf16 }));
  return fc.oneof(...options);
};

describe('Property 14: Mapper hint rules', () => {
  // Feature: generation-and-evaluation, Property 14: Mapper hint rules
  // **Validates: Requirements 8.4, 8.8, 8.9, 8.10, 8.11**

  it('rune cipher always gets reveal-first-letter with first code point and code point length', () => {
    let nonBmp = 0;
    fc.assert(
      fc.property(
        runeBaseArb.chain((c) =>
          fc.constantFrom(undefined, matchingHint(c)).map((hint) => ({
            ...c,
            question: hint ? { ...c.question, hint } : c.question,
          })),
        ),
        (c) => {
          const result = mapAuthoringQuestionToSpec(c.question, c.doc.maps, 'q1');
          expect(result.ok).toBe(true);
          if (!result.ok) return;
          expect(result.value.hintEffect).toEqual({
            kind: 'reveal-first-letter',
            firstLetter: c.codePoints[0],
            length: c.codePoints.length,
          });
          if (c.question.answer.length !== c.codePoints.length) nonBmp++;
        },
      ),
      { numRuns: 100 },
    );
    // Non-vacuity: some answers contain non-BMP characters.
    expect(nonBmp).toBeGreaterThan(0);
  });

  it('a mismatching authoring hint gives hint-mismatch and no QuestionSpec', () => {
    fc.assert(
      fc.property(
        runeBaseArb.chain((c) =>
          mismatchingHintArb(c).map((hint) => ({ ...c, question: { ...c.question, hint } })),
        ),
        (c) => {
          const result = mapAuthoringQuestionToSpec(c.question, c.doc.maps, 'q1');
          expect(result).toEqual({ ok: false, error: { kind: 'hint-mismatch', questionId: 'q1' } });
        },
      ),
      { numRuns: 100 },
    );
  });
});

interface SeanceCase {
  readonly doc: Doc;
  readonly question: SeanceBoardAuthoringQuestion;
}

/** 3 or 4 options with unique IDs; exactly one supported at a random position. */
const seanceArb: fc.Arbitrary<SeanceCase> = docArb.chain((doc) =>
  fc
    .tuple(
      fc.integer({ min: 3, max: 4 }),
      fc.nat(),
      fc.uniqueArray(fc.stringMatching(/^[a-z][a-z0-9]{0,5}$/), { minLength: 4, maxLength: 4 }),
      fc.array(spanArb(doc), { minLength: 4, maxLength: 4 }),
    )
    .map(([count, supportedSeed, ids, spans]) => {
      const supportedAt = supportedSeed % count;
      const options = Array.from({ length: count }, (_, i) => ({
        id: ids[i]!,
        text: `Claim number ${i + 1} about the topic`,
        label: i === supportedAt ? ('supported' as const) : ('contradicted' as const),
        evidence: { paragraph: spans[i]!.paragraph, quote: spans[i]!.words.join(' ') },
      }));
      const question: SeanceBoardAuthoringQuestion = {
        id: 's1',
        conceptId: 'c1',
        role: 'primary',
        lockType: 'seance-board',
        prompt: 'According to your notes, which claim is stated?',
        options,
        answer: ids[supportedAt]!,
        explanation: 'See the quoted lines.',
      };
      return { doc, question };
    }),
);

describe('Property 9: Manifest_Mapper preserves séance-board option order', () => {
  // Feature: generation-and-evaluation, Property 9: Manifest_Mapper preserves séance-board option order
  // **Validates: Requirements 6.8**

  it('payload optionIds equal the authoring option IDs in the same order', () => {
    let mapped = 0;
    fc.assert(
      fc.property(seanceArb, ({ doc, question }) => {
        const result = mapAuthoringQuestionToSpec(question, doc.maps, 's1');
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        mapped++;
        expect(result.value.lockType).toBe('seance-board');
        expect(result.value.payload).toEqual({
          optionIds: question.options.map((o) => o.id),
          keyOptionId: question.answer,
        });
      }),
      { numRuns: 100 },
    );
    expect(mapped).toBe(100);
  });
});

describe('Property 14: Mapper hint rules (séance board)', () => {
  // Feature: generation-and-evaluation, Property 14: Mapper hint rules
  // **Validates: Requirements 8.4, 8.8, 8.9, 8.10, 8.11**

  it('hint is remove-option for the first contradicted option in authoring order', () => {
    const positions = new Set<number>();
    fc.assert(
      fc.property(seanceArb, ({ doc, question }) => {
        const result = mapAuthoringQuestionToSpec(question, doc.maps, 's1');
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        const first = question.options.find((o) => o.label === 'contradicted');
        expect(first).toBeDefined();
        expect(result.value.hintEffect).toEqual({ kind: 'remove-option', optionId: first?.id });
        positions.add(question.options.findIndex((o) => o === first));
      }),
      { numRuns: 100 },
    );
    // Non-vacuity: the first contradicted option is not always the first option.
    expect(positions.has(0)).toBe(true);
    expect(positions.has(1)).toBe(true);
  });
});
