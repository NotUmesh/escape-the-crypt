import { z } from '@escape-the-crypt/core';

/**
 * Evaluation result file (Req 21.3, 21.4, 21.6): run facts only. No notes text, prompt text,
 * model response or credential. Notes are named by file name; questions by code-assigned IDs.
 */
const nonNegInt = z.number().int().nonnegative();
const usd = z.number().nonnegative();

export const CandidateOutcomeSchema = z.strictObject({
  conceptIndex: nonNegInt,
  conceptId: z.string(),
  role: z.enum(['primary', 'alternate']),
  lockType: z.string().min(1),
  result: z.enum(['accepted', 'code-check-rejected', 'review-rejected', 'not-reviewed']),
  checkIds: z.array(z.string().min(1)),
  reviewReason: z.string().min(1).nullable(),
  /** Added after the first dev-set run; older result files parse with null. */
  mapperReason: z.string().min(1).nullable().default(null),
  placement: z
    .enum(['slot-lead', 'slot-alternate', 'mapper-rejected', 'duplicate-skipped', 'leak-dropped', 'unplaced', 'not-placed'])
    .nullable(),
});

export const NoteRunSchema = z.strictObject({
  note: z.string().regex(/^[a-z0-9][a-z0-9._-]*\.txt$/i),
  ok: z.boolean(),
  /** Pipeline error kind when the run published nothing. */
  errorKind: z.string().min(1).nullable(),
  promptDigests: z.array(z.string().regex(/^[0-9a-f]{64}$/)),
  liveCalls: nonNegInt,
  replayedCalls: nonNegInt,
  stageTimingsMs: z.record(z.string(), z.number().nonnegative()),
  /** Live calls only: a replayed call reports zero usage. */
  tokens: z.strictObject({ inputTokens: nonNegInt, outputTokens: nonNegInt }),
  costUsd: usd,
  concepts: z.array(
    z.strictObject({ conceptIndex: nonNegInt, conceptId: z.string(), generation: z.string().min(1) }),
  ),
  candidates: z.array(CandidateOutcomeSchema),
  codeCheckRejections: z.record(z.string(), nonNegInt),
  room: z
    .strictObject({
      slots: z.array(
        z.strictObject({
          /** Added with multi-room crypts; older result files parse as room-1. */
          roomId: z.string().min(1).default('room-1'),
          stationType: z.string().min(1),
          conceptId: z.string().min(1),
          primaryQuestionId: z.string().min(1),
          alternateQuestionId: z.string().min(1).nullable(),
        }),
      ),
      /** Placed questions that share an answer with another concept's placed question. */
      duplicateAnswers: nonNegInt,
    })
    .nullable(),
});

export const EvaluationResultSchema = z.strictObject({
  schemaVersion: z.literal(1),
  runId: z.string().min(1),
  startedAt: z.string().min(1),
  finishedAt: z.string().min(1),
  set: z.literal('dev'),
  provider: z.string().min(1),
  modelId: z.string().min(1),
  temperature: z.number(),
  checkVersion: z.string().min(1),
  assemblyPolicy: z.strictObject({ promoteAlternates: z.boolean(), dedupeAnswers: z.boolean() }),
  prices: z.strictObject({ inputUsdPerMTok: usd, outputUsdPerMTok: usd }),
  budget: z.strictObject({
    capUsd: usd,
    spentBeforeUsd: usd,
    spentThisRunUsd: usd,
    reservationRefused: z.boolean(),
  }),
  stopped: z.enum(['completed', 'budget-refused']),
  notes: z.array(NoteRunSchema),
});

export type NoteRun = z.infer<typeof NoteRunSchema>;
export type EvaluationResult = z.infer<typeof EvaluationResultSchema>;

export function parseEvaluationResult(raw: unknown): { ok: true; value: EvaluationResult } | { ok: false } {
  const parsed = EvaluationResultSchema.safeParse(raw);
  return parsed.success ? { ok: true, value: parsed.data } : { ok: false };
}

/** `<date>.json`, or `<date>-2.json`, `<date>-3.json` ... when that name is taken. */
export function resultFileName(date: string, exists: (name: string) => boolean): string {
  if (!exists(`${date}.json`)) return `${date}.json`;
  for (let n = 2; ; n += 1) if (!exists(`${date}-${n}.json`)) return `${date}-${n}.json`;
}
