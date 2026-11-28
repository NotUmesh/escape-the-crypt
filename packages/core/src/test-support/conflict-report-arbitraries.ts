import fc from 'fast-check';
import { AuthoringQuestionSchema, type AuthoringQuestion } from '../authoring/schema';
import { conflictShownId, type ConflictResponse } from '../pipeline/conflict-prompt';
import { prepareDocument, type PreparedDocument } from '../pipeline/prepare-input';
import { makeChunk } from './conflict-code-arbitraries';

/** Paragraph ordinals of the generated document (all are quotable, none is a heading). */
export const TWIN_PARAGRAPH = 4;
export const LONG_PARAGRAPH = 5;
const ORDINALS = ['first', 'second', 'third'] as const;
const LONG_WORDS = (
  'amber basalt cinder dusk ember flint gloam hollow iron jasper kiln lantern marrow nettle ochre ' +
  'pewter quartz raven soot tallow umber vellum wick yarrow zinc ashen bramble cobalt dagger'
).split(' ');

/** The twin sentence appears twice in its paragraph, so any quote inside it is ambiguous. */
export const TWIN_SENTENCE = 'Twin phrase appears right here twice.';
export const LONG_QUOTE = LONG_WORDS.slice(0, 26).join(' ');

export type QuestionKind = 'rune-cipher' | 'combination-dial';

export interface RoomSeed {
  readonly kind: QuestionKind;
  /** Paragraph (1..3) holding this question's own evidence. */
  readonly evidence: number;
}

export interface DocWithRoom {
  readonly doc: PreparedDocument;
  /** The number stated in paragraphs 1..3, index 0 = paragraph 1. All distinct. */
  readonly numbers: readonly [number, number, number];
  readonly seeds: readonly RoomSeed[];
}

export const sentenceOf = (paragraph: number, n: number): string =>
  `The ${ORDINALS[paragraph - 1]} sample lasts about ${n} days in total.`;

const evidenceQuote = (n: number): string => `sample lasts about ${n} days in total`;

/** Builds the question of one seed. A dial key defaults to its own paragraph's number. */
export function questionOf(index: number, seed: RoomSeed, numbers: DocWithRoom['numbers'], key?: number): AuthoringQuestion {
  const own = numbers[seed.evidence - 1]!;
  const common = {
    id: `mq${index}`,
    conceptId: `mc${index}`,
    role: 'primary',
    evidence: [{ paragraph: seed.evidence, quote: evidenceQuote(own) }],
    explanation: '',
  };
  return AuthoringQuestionSchema.parse(
    seed.kind === 'rune-cipher'
      ? {
          ...common,
          lockType: 'rune-cipher',
          prompt: 'According to your notes, the sample lasts about ______ days in total.',
          answer: String(own),
          aliases: [],
          caseSensitive: false,
        }
      : {
          ...common,
          lockType: 'combination-dial',
          prompt: 'According to your notes, how many days does the sample last in total?',
          answer: { kind: 'exact', value: key ?? own },
          units: 'days',
        },
  );
}

/** A document of three numbered paragraphs, a twin paragraph, a long paragraph and a room over them. */
export const docWithRoomArb: fc.Arbitrary<DocWithRoom> = fc
  .record({
    numbers: fc.uniqueArray(fc.integer({ min: 10, max: 99 }), { minLength: 3, maxLength: 3 }),
    seeds: fc.array(
      fc.record({
        kind: fc.constantFrom<QuestionKind>('rune-cipher', 'combination-dial'),
        evidence: fc.integer({ min: 1, max: 3 }),
      }),
      { minLength: 1, maxLength: 4 },
    ),
  })
  .map(({ numbers, seeds }) => {
    const nums = numbers as unknown as DocWithRoom['numbers'];
    const texts = [
      sentenceOf(1, nums[0]),
      sentenceOf(2, nums[1]),
      sentenceOf(3, nums[2]),
      `${TWIN_SENTENCE} ${TWIN_SENTENCE}`,
      LONG_WORDS.join(' ') + '.',
    ];
    const doc = prepareDocument(texts.map((t, i) => makeChunk(`chk_${i + 1}`, i, t)));
    return { doc, numbers: nums, seeds };
  });

export type ReportKind =
  | 'no-conflict'
  | 'resolvable'
  | 'numeric-same'
  | 'self-evidence'
  | 'ambiguous'
  | 'too-short'
  | 'too-long'
  | 'not-found'
  | 'bad-paragraph';

export type Expected = 'none' | 'confirmed' | 'ignored';

export interface ConflictReplyCase {
  readonly reply: ConflictResponse;
  /** The room to resolve over; a `numeric-same` report changes its question's dial key. */
  readonly room: readonly AuthoringQuestion[];
  readonly kinds: readonly ReportKind[];
  readonly expected: readonly Expected[];
  /** For each confirmed report, the passage code must report as the other one. */
  readonly otherQuote: readonly (string | null)[];
}

const EXPECTED: Record<ReportKind, Expected> = {
  'no-conflict': 'none',
  resolvable: 'confirmed',
  'numeric-same': 'ignored',
  'self-evidence': 'ignored',
  ambiguous: 'ignored',
  'too-short': 'ignored',
  'too-long': 'ignored',
  'not-found': 'ignored',
  'bad-paragraph': 'ignored',
};

const BASE_KINDS: readonly ReportKind[] = [
  'no-conflict',
  'resolvable',
  'self-evidence',
  'ambiguous',
  'too-short',
  'too-long',
  'not-found',
  'bad-paragraph',
];

/** Another paragraph (1..3) than the question's own, chosen by `pick`. */
const otherParagraph = (own: number, pick: number): number => {
  const options = [1, 2, 3].filter((p) => p !== own);
  return options[pick % options.length]!;
};

/**
 * One report per question of the fixture, each of a generated kind: resolvable, ambiguous,
 * too short, too long, not found, self-evidence, a numeric dial key with and without a
 * differing number, or not a conflict at all. Each kind carries its expected outcome.
 */
export function conflictReplyArb(fixture: DocWithRoom): fc.Arbitrary<ConflictReplyCase> {
  const perQuestion = fixture.seeds.map((seed) =>
    fc.record({
      kind: fc.constantFrom<ReportKind>(
        ...(seed.kind === 'combination-dial' ? [...BASE_KINDS, 'numeric-same' as const] : BASE_KINDS),
      ),
      pick: fc.nat(5),
      badParagraph: fc.constantFrom<number | null>(null, 0, 99, -1),
    }),
  );
  return fc.tuple(...perQuestion).map((picks) => {
    const { numbers } = fixture;
    const results: ConflictResponse['results'] = [];
    const kinds: ReportKind[] = [];
    const otherQuote: (string | null)[] = [];
    const room: AuthoringQuestion[] = [];
    picks.forEach(({ kind, pick, badParagraph }, i) => {
      const seed = fixture.seeds[i]!;
      const other = otherParagraph(seed.evidence, pick);
      const otherN = numbers[other - 1]!;
      const questionId = conflictShownId(i);
      const quoteOther = sentenceOf(other, otherN);
      room.push(questionOf(i, seed, numbers, kind === 'numeric-same' ? otherN : undefined));
      let entry: ConflictResponse['results'][number];
      switch (kind) {
        case 'resolvable':
          entry = { questionId, conflict: true, paragraph: other, quote: quoteOther };
          break;
        case 'numeric-same':
          entry = { questionId, conflict: true, paragraph: other, quote: quoteOther };
          break;
        case 'self-evidence':
          entry = {
            questionId,
            conflict: true,
            paragraph: seed.evidence,
            quote: `lasts about ${numbers[seed.evidence - 1]} days in total`,
          };
          break;
        case 'ambiguous':
          entry = { questionId, conflict: true, paragraph: TWIN_PARAGRAPH, quote: TWIN_SENTENCE };
          break;
        case 'too-short':
          entry = { questionId, conflict: true, paragraph: other, quote: 'lasts about' };
          break;
        case 'too-long':
          entry = { questionId, conflict: true, paragraph: LONG_PARAGRAPH, quote: LONG_QUOTE };
          break;
        case 'not-found':
          entry = { questionId, conflict: true, paragraph: other, quote: 'Nothing like this was ever written down.' };
          break;
        case 'bad-paragraph':
          entry = { questionId, conflict: true, paragraph: badParagraph, quote: quoteOther };
          break;
        case 'no-conflict':
          entry = { questionId, conflict: false, paragraph: other, quote: quoteOther };
          break;
      }
      results.push(entry);
      kinds.push(kind);
      otherQuote.push(kind === 'resolvable' ? quoteOther : null);
    });
    return { reply: { results }, room, kinds, expected: kinds.map((k) => EXPECTED[k]), otherQuote };
  });
}
