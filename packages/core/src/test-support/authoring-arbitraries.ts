import fc from 'fast-check';
import type { AuthoringQuestion } from '../authoring/schema';
import { paragraphArb } from './arbitraries';

const idArb = fc.stringMatching(/^[a-z][a-z0-9-]{0,11}$/);
const textArb = fc.stringMatching(/^[A-Za-z][A-Za-z ,]{2,40}$/);
const roleArb = fc.constantFrom('primary' as const, 'alternate' as const);

type EvidenceRef = { paragraph: number; quote: string };

/** Evidence whose quote is an exact, non-empty substring of generated chunk text. */
const evidenceArb: fc.Arbitrary<EvidenceRef> = fc
  .tuple(paragraphArb, fc.integer({ min: 1, max: 20 }))
  .chain(([chunkText, paragraph]) =>
    fc
      .tuple(fc.nat({ max: chunkText.length - 1 }), fc.nat({ max: chunkText.length - 1 }))
      .map(([a, b]) => {
        const start = Math.min(a, b);
        const end = Math.max(a, b) + 1;
        return { paragraph, quote: chunkText.slice(start, end) };
      }),
  );

const runeArb: fc.Arbitrary<AuthoringQuestion> = fc
  .record({
    id: idArb,
    conceptId: idArb,
    role: roleArb,
    lockType: fc.constant('rune-cipher' as const),
    prompt: textArb,
    answer: textArb,
    aliases: fc.array(textArb, { maxLength: 3 }),
    caseSensitive: fc.boolean(),
    evidence: fc.array(evidenceArb, { minLength: 1, maxLength: 3 }),
    explanation: fc.string({ maxLength: 40 }),
  })
  .chain((base) =>
    fc
      .tuple(
        fc.option(fc.integer({ min: 1, max: 30 }), { nil: undefined }),
        fc.option(textArb, { nil: undefined }),
      )
      .map(([hintLength, note]): AuthoringQuestion => {
        const q: AuthoringQuestion = { ...base };
        if (hintLength !== undefined) {
          q.hint = {
            kind: 'first-letter-and-length',
            firstLetter: base.answer.charAt(0),
            length: hintLength,
          };
        }
        if (note !== undefined) q.note = note;
        return q;
      }),
  );

const optionArb = fc.record({
  id: idArb,
  text: textArb,
  label: fc.constantFrom('supported' as const, 'contradicted' as const),
  evidence: evidenceArb,
});

const seanceArb: fc.Arbitrary<AuthoringQuestion> = fc
  .record({
    id: idArb,
    conceptId: idArb,
    role: roleArb,
    lockType: fc.constant('seance-board' as const),
    prompt: textArb,
    options: fc.array(optionArb, { minLength: 3, maxLength: 4 }),
    answer: idArb,
    explanation: fc.string({ maxLength: 40 }),
  })
  .chain((base) =>
    fc.option(textArb, { nil: undefined }).map((note): AuthoringQuestion => {
      const q: AuthoringQuestion = { ...base };
      if (note !== undefined) q.note = note;
      return q;
    }),
  );

/** Rune cipher and séance board authoring questions; quotes are exact substrings of chunk text. */
export const authoringQuestionArb: fc.Arbitrary<AuthoringQuestion> = fc.oneof(runeArb, seanceArb);
