import type { AuthoringQuestion } from '../authoring/schema';
import { callWithBudget } from '../budget/call-with-budget';
import type { BudgetLedger } from '../budget/types';
import { toModelJsonSchema } from '../provider/model-json-schema';
import type { Provider, ProviderRequest } from '../provider/types';
import type { Result } from '../types';
import type { ConceptExtractionOptions } from './concept-extraction';
import {
  CONFLICT_CHECK_PROMPT_VERSION,
  CONFLICT_CHECK_SYSTEM_PROMPT,
  ConflictResponseSchema,
  buildConflictUserMessage,
  buildRetryNote,
} from './conflict-prompt';
import { resolveConflictReports, type ConfirmedConflict } from './conflict-report';
import type { AbortSignalLike } from './orchestrator';
import type { PreparedDocument } from './prepare-input';
import type { PipelineStageError } from './stage-error';

export { CONFLICT_CHECK_PROMPT_VERSION } from './conflict-prompt';

/** Same injected shape as the review stage (always temperature 0), with the run's abort signal. */
export type ConflictCheckOptions = Omit<ConceptExtractionOptions, 'temperature' | 'shouldStop'> & {
  /** No reservation or call starts once this is aborted. Calls already in flight are not aborted. */
  readonly signal?: AbortSignalLike;
};

/** What the check learned about one room. Carries no notes text beyond the resolved passages. */
export type RoomConflictOutcome =
  /** The reply was valid. `confirmed` is empty when the room is clean. */
  | {
      readonly status: 'checked';
      readonly confirmed: readonly ConfirmedConflict[];
      readonly conflictReportsIgnored: number;
    }
  /** A provider failure or a second schema failure. Fail closed: the room is not published (D5). */
  | { readonly status: 'unchecked' };

const STAGE = 'conflict-check' as const;
const CONFLICT_TEMPERATURE = 0;

const BAD_IDS_NOTE = [
  'Your previous reply did not hold exactly one entry for each question id shown.',
  'Reply again with JSON that matches the schema, with one entry for each id, no repeated ids and no other ids.',
].join('\n');

/**
 * Conflict check of one provisional room: one call for all its questions (in shown order), plus
 * at most one retry after a schema or id failure, each attempt with its own reservation. A
 * refused reservation makes no call and ends the stage with `budget-exhausted`; an abort ends it
 * with `cancelled`. A provider failure or a second bad reply is an `unchecked` room, not an
 * error. Never throws.
 */
export async function checkRoomForConflicts(
  provider: Provider,
  ledger: BudgetLedger,
  room: readonly AuthoringQuestion[],
  doc: PreparedDocument,
  options: ConflictCheckOptions,
): Promise<Result<RoomConflictOutcome, PipelineStageError>> {
  const schema = toModelJsonSchema(ConflictResponseSchema);
  if (!schema.ok) {
    return { ok: false, error: { kind: 'schema-not-representable', stage: STAGE } };
  }

  const userMessage = buildConflictUserMessage(room, doc);
  const build = (content: string): ProviderRequest => ({
    stage: STAGE,
    promptVersion: CONFLICT_CHECK_PROMPT_VERSION,
    modelId: options.modelId,
    system: CONFLICT_CHECK_SYSTEM_PROMPT,
    messages: [{ role: 'user', content }],
    temperature: CONFLICT_TEMPERATURE,
    maxOutputTokens: options.maxOutputTokens,
    jsonSchema: schema.value,
    timeoutMs: options.timeoutMs,
    retryLimit: options.retryLimit,
  });

  let content = userMessage;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (options.signal?.aborted === true) return { ok: false, error: { kind: 'cancelled' } };
    const called = await callWithBudget(
      ledger,
      provider,
      build(content),
      options.worstCaseUsd,
      options.costOf,
    );
    if (!called.ok) {
      if (called.error.kind === 'budget') return { ok: false, error: { kind: 'budget-exhausted' } };
      return { ok: true, value: { status: 'unchecked' } };
    }
    const parsed = ConflictResponseSchema.safeParse(called.response.json);
    if (parsed.success) {
      const resolved = resolveConflictReports(parsed.data, room, doc);
      if (resolved.ok) {
        return {
          ok: true,
          value: {
            status: 'checked',
            confirmed: resolved.value.confirmed,
            conflictReportsIgnored: resolved.value.conflictReportsIgnored,
          },
        };
      }
      content = `${userMessage}\n\n${BAD_IDS_NOTE}`;
    } else {
      // The note carries Zod paths and messages only; the raw output is not echoed.
      content = `${userMessage}\n\n${buildRetryNote(parsed.error)}`;
    }
  }
  return { ok: true, value: { status: 'unchecked' } };
}
