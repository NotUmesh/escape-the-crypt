import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { EvaluationResultSchema, parseEvaluationResult, resultFileName, type EvaluationResult } from './result-file';

const id = fc.stringMatching(/^[a-z0-9-]{1,12}$/);
const digest = fc.stringMatching(/^[0-9a-f]{64}$/);
const nat = fc.nat({ max: 10_000 });
const usd = fc.double({ min: 0, max: 5, noNaN: true, noDefaultInfinity: true });

const candidateArb = fc.record({
  conceptIndex: fc.nat({ max: 20 }),
  conceptId: id,
  role: fc.constantFrom('primary' as const, 'alternate' as const),
  lockType: fc.constantFrom('rune-cipher', 'seance-board'),
  result: fc.constantFrom('accepted' as const, 'code-check-rejected' as const, 'review-rejected' as const, 'not-reviewed' as const),
  checkIds: fc.array(fc.constantFrom('quote-not-found', 'duplicate-options', 'negative-question'), { maxLength: 3 }),
  reviewReason: fc.option(fc.constantFrom('unknown-label', 'label-mismatch', 'answer-mismatch'), { nil: null }),
  mapperReason: fc.option(fc.constantFrom('hint-mismatch', 'check-failed:quote-too-long'), { nil: null }),
  placement: fc.option(fc.constantFrom('slot-lead' as const, 'unplaced' as const, 'duplicate-skipped' as const), { nil: null }),
});

const noteArb = fc.record({
  note: fc.stringMatching(/^dev-[0-9]{2}-[a-z]{1,10}\.txt$/),
  ok: fc.boolean(),
  errorKind: fc.option(fc.constantFrom('budget-exhausted', 'empty-room'), { nil: null }),
  promptDigests: fc.array(digest, { maxLength: 4 }),
  liveCalls: nat,
  replayedCalls: nat,
  stageTimingsMs: fc.dictionary(fc.constantFrom('prepare', 'generation', 'review'), fc.nat({ max: 60_000 })),
  tokens: fc.record({ inputTokens: nat, outputTokens: nat }),
  costUsd: usd,
  concepts: fc.array(fc.record({ conceptIndex: fc.nat({ max: 20 }), conceptId: id, generation: fc.constantFrom('questions', 'no-lock', 'schema-rejected') }), { maxLength: 4 }),
  candidates: fc.array(candidateArb, { maxLength: 6 }),
  codeCheckRejections: fc.dictionary(fc.constantFrom('quote-not-found', 'option-count'), nat),
  room: fc.option(
    fc.record({
      slots: fc.array(
        fc.record({
          roomId: fc.constantFrom('room-1', 'room-2'),
          stationType: fc.constantFrom('rune-cipher', 'seance-board'),
          conceptId: id,
          primaryQuestionId: id,
          alternateQuestionId: fc.option(id, { nil: null }),
        }),
        { maxLength: 2 },
      ),
      duplicateAnswers: fc.nat({ max: 4 }),
    }),
    { nil: null },
  ),
});

const resultArb: fc.Arbitrary<EvaluationResult> = fc.record({
  schemaVersion: fc.constant(1 as const),
  runId: id,
  startedAt: fc.constant('2026-11-27T10:00:00.000Z'),
  finishedAt: fc.constant('2026-11-27T10:05:00.000Z'),
  set: fc.constant('dev' as const),
  provider: fc.constant('openai'),
  modelId: fc.constantFrom('gpt-5.4-mini', 'synthetic'),
  temperature: fc.constantFrom(0, 0.2),
  checkVersion: fc.constant('2026-11-27.1'),
  assemblyPolicy: fc.record({ promoteAlternates: fc.boolean(), dedupeAnswers: fc.boolean() }),
  prices: fc.record({ inputUsdPerMTok: usd, outputUsdPerMTok: usd }),
  budget: fc.record({ capUsd: usd, spentBeforeUsd: usd, spentThisRunUsd: usd, reservationRefused: fc.boolean() }),
  stopped: fc.constantFrom('completed' as const, 'budget-refused' as const),
  notes: fc.array(noteArb, { maxLength: 3 }),
});

// Feature: generation-and-evaluation, Requirement 21.6: result file round-trip
describe('Property: evaluation result files round-trip', () => {
  it('serialising then parsing any valid result gives an equal object', () => {
    fc.assert(
      fc.property(resultArb, (result) => {
        expect(EvaluationResultSchema.safeParse(result).success).toBe(true);
        const back = parseEvaluationResult(JSON.parse(JSON.stringify(result)));
        expect(back).toEqual({ ok: true, value: result });
      }),
      { numRuns: 200 },
    );
  });

  it('rejects unknown fields, so text cannot ride along unnoticed', () => {
    fc.assert(
      fc.property(resultArb, (result) => {
        expect(parseEvaluationResult({ ...result, notesText: 'x' }).ok).toBe(false);
      }),
      { numRuns: 20 },
    );
  });
});

describe('resultFileName', () => {
  it('uses <date>.json, then -2, -3 when taken', () => {
    expect(resultFileName('2026-11-27', () => false)).toBe('2026-11-27.json');
    const taken = new Set(['2026-11-27.json', '2026-11-27-2.json']);
    expect(resultFileName('2026-11-27', (n) => taken.has(n))).toBe('2026-11-27-3.json');
  });
});
