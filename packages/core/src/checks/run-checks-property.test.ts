import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { AuthoringQuestion, RuneCipherAuthoringQuestion } from '../authoring/schema';
import { resolveQuote } from '../quote-resolver';
import { authoringQuestionArb } from '../test-support/authoring-arbitraries';
import { paragraphArb } from '../test-support/arbitraries';
import type { Chunk } from '../types';
import { runChecks, runRoomChecks, type EvidenceContext } from './run-checks';

const CHUNK_COUNT = 6;
const chunkId = (paragraph: number): string => `chk_abcdef123456_${paragraph}`;

function buildContext(texts: readonly string[]): EvidenceContext {
  const chunks = new Map<string, Chunk>();
  const paragraphChunkIds = new Map<number, string>();
  texts.forEach((text, i) => {
    const paragraph = i + 1;
    chunks.set(chunkId(paragraph), {
      id: chunkId(paragraph),
      documentDigest: 'a'.repeat(64),
      position: i,
      text,
      location: { sourceType: 'paste', paragraphNumber: paragraph },
      edited: false,
    });
    paragraphChunkIds.set(paragraph, chunkId(paragraph));
  });
  return { chunks, paragraphChunkIds };
}

const chunkTextsArb = fc.array(
  fc.tuple(paragraphArb, paragraphArb).map(([a, b]) => `${a} ${b}`),
  { minLength: CHUNK_COUNT, maxLength: CHUNK_COUNT },
);

const conceptArb = fc.constantFrom('c1', 'c2', 'c3');
const roleArb = fc.constantFrom('primary' as const, 'alternate' as const);

/**
 * A rune cipher candidate whose quote is a run of whole words from one chunk and whose answer
 * is one word of that quote. Some pass every check, some fail (ambiguous quote, answer leak,
 * alias tweaks), so both outcomes are exercised.
 */
function runeCandidateArb(texts: readonly string[]): fc.Arbitrary<RuneCipherAuthoringQuestion> {
  return fc
    .tuple(
      fc.integer({ min: 0, max: texts.length - 1 }),
      fc.nat(),
      fc.integer({ min: 4, max: 25 }),
      fc.nat(),
      conceptArb,
      roleArb,
      fc.boolean(),
    )
    .map(([ci, startSeed, lenSeed, answerSeed, conceptId, role, caseSensitive]) => {
      const words = texts[ci]!.split(' ');
      const len = Math.min(lenSeed, words.length);
      const start = startSeed % (words.length - len + 1);
      const quoteWords = words.slice(start, start + len);
      const answerWord = quoteWords[answerSeed % quoteWords.length]!.replace(/[^A-Za-z]/g, '');
      return {
        id: 'placeholder',
        conceptId,
        role,
        lockType: 'rune-cipher' as const,
        prompt: 'Complete the line from your notes: ___ appears here',
        answer: answerWord === '' ? 'x' : answerWord,
        aliases: [],
        caseSensitive,
        evidence: [{ paragraph: ci + 1, quote: quoteWords.join(' ') }],
        explanation: 'See the quoted line.',
      };
    });
}

/** A room context plus a mixed list of rune candidates and random authoring questions, unique IDs. */
const roomArb: fc.Arbitrary<{ context: EvidenceContext; questions: AuthoringQuestion[] }> =
  chunkTextsArb.chain((texts) =>
    fc
      .array(fc.oneof(runeCandidateArb(texts), authoringQuestionArb), { minLength: 0, maxLength: 8 })
      .map((qs) => ({
        context: buildContext(texts),
        questions: qs.map((q, i) => ({ ...q, id: `q${i}` }) as AuthoringQuestion),
      })),
  );

describe('Property 5: Code_Checks are order-independent', () => {
  // Feature: generation-and-evaluation, Property 5: Code_Checks are order-independent
  // **Validates: Requirements 3.9**
  it('runRoomChecks returns the same verdicts for any permutation of the room', () => {
    fc.assert(
      fc.property(
        roomArb.chain((room) =>
          fc
            .shuffledSubarray(room.questions, {
              minLength: room.questions.length,
              maxLength: room.questions.length,
            })
            .map((permuted) => ({ ...room, permuted })),
        ),
        ({ context, questions, permuted }) => {
          expect(runRoomChecks(permuted, context)).toEqual(runRoomChecks(questions, context));
        },
      ),
      { numRuns: 100 },
    );
  });
});

describe('Property 6: Code_Checks are idempotent', () => {
  // Feature: generation-and-evaluation, Property 6: Code_Checks are idempotent
  // **Validates: Requirements 3.10**
  it('running runChecks twice on the same input gives equal results', () => {
    fc.assert(
      fc.property(roomArb, ({ context, questions }) => {
        for (const question of questions) {
          const siblings = questions.filter((q) => q !== question);
          const input = { question, siblings, ...context };
          expect(runChecks(input)).toEqual(runChecks(input));
        }
        expect(runRoomChecks(questions, context)).toEqual(runRoomChecks(questions, context));
      }),
      { numRuns: 100 },
    );
  });
});

describe('Property 8: Accepted rune-cipher candidates resolve uniquely', () => {
  // Feature: generation-and-evaluation, Property 8: Accepted rune-cipher candidates resolve uniquely
  // **Validates: Requirements 5.7**
  const candidatesArb = chunkTextsArb.chain((texts) =>
    fc
      .array(runeCandidateArb(texts), { minLength: 1, maxLength: 6 })
      .map((qs) => ({
        context: buildContext(texts),
        candidates: qs.map((q, i) => ({ ...q, id: `r${i}` })),
      })),
  );

  const acceptedOf = (context: EvidenceContext, candidates: RuneCipherAuthoringQuestion[]) =>
    candidates.filter((question) => runChecks({ question, ...context }).length === 0);

  it('every evidence quote of an accepted candidate resolves to exactly one location', () => {
    fc.assert(
      fc.property(candidatesArb, ({ context, candidates }) => {
        for (const q of acceptedOf(context, candidates)) {
          for (const e of q.evidence) {
            const result = resolveQuote(context.chunks, context.paragraphChunkIds.get(e.paragraph)!, e.quote);
            expect(result.ok).toBe(true);
          }
        }
      }),
      { numRuns: 100 },
    );
  });

  it('the generator produces accepted candidates (the property is not vacuous)', () => {
    const samples = fc.sample(candidatesArb, { numRuns: 50, seed: 42 });
    const accepted = samples.reduce(
      (n, { context, candidates }) => n + acceptedOf(context, candidates).length,
      0,
    );
    expect(accepted).toBeGreaterThan(0);
  });
});

describe('Regression: alternate checks with several primaries in one concept', () => {
  const context = buildContext(['alpha beta gamma delta epsilon zeta eta theta']);
  const rune = (
    id: string,
    role: 'primary' | 'alternate',
    quote: string,
    answer: string,
  ): RuneCipherAuthoringQuestion => ({
    id,
    conceptId: 'c1',
    role,
    lockType: 'rune-cipher',
    prompt: 'Complete the line from your notes: ___ appears here',
    answer,
    aliases: [],
    caseSensitive: false,
    evidence: [{ paragraph: 1, quote }],
    explanation: 'See the quoted line.',
  });
  const alternate = rune('q9', 'alternate', 'alpha beta gamma delta', 'gamma');
  const onConceptPrimary = rune('q1', 'primary', 'alpha beta gamma delta', 'beta');
  const offConceptPrimary = rune('q0', 'primary', 'epsilon zeta eta theta', 'zeta');

  it('gives the same failures for the alternate whatever the sibling order', () => {
    const a = runChecks({ question: alternate, siblings: [onConceptPrimary, offConceptPrimary], ...context });
    const b = runChecks({ question: alternate, siblings: [offConceptPrimary, onConceptPrimary], ...context });
    expect(a).toEqual(b);
  });
});
