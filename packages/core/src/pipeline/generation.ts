import type { AuthoringQuestion } from '../authoring/schema';
import { callWithBudget } from '../budget/call-with-budget';
import type { BudgetLedger } from '../budget/types';
import { toModelJsonSchema } from '../provider/model-json-schema';
import type { Provider, ProviderRequest } from '../provider/types';
import type { LockType, Result } from '../types';
import type { ConceptExtractionOptions, ExtractedConcept } from './concept-extraction';
import {
  DEFAULT_ALLOWED_LOCK_TYPES,
  GENERATION_PROMPT_VERSION,
  buildGenerationSystemPrompt,
  buildGenerationUserMessage,
  buildRetryNote,
} from './generation-prompt';
import { GenerationResponseSchema, toAuthoringQuestion } from './generation-schema';
import type { PreparedDocument } from './prepare-input';
import type { PipelineStageError } from './stage-error';

export { GENERATION_PROMPT_VERSION } from './generation-prompt';

/** Same injected shape as concept extraction, plus the lock types the caller allows (Req 14.9). */
export interface GenerationOptions extends ConceptExtractionOptions {
  /** Defaults to rune cipher and séance board. */
  readonly allowedLockTypes?: readonly LockType[];
}

export interface GeneratedConceptQuestions {
  readonly primary: AuthoringQuestion;
  readonly alternate: AuthoringQuestion | null;
}

const STAGE = 'generation' as const;

/**
 * One generation call per concept, plus at most one retry after a schema failure. Each attempt
 * reserves its own budget. Returns:
 * - `Ok(null)` when the model chose no lock (`primary: null`); a deliberate skip, not a failure;
 * - `Ok({ primary, alternate })` with real AuthoringQuestions (`alternate` may be null);
 * - an error when the concept's question must be set aside: `schema-rejected` after two schema
 *   failures, `pipeline-unknown-chunk` when the primary cites an unassigned chunk ID (the model
 *   is not asked again), `lock-type-not-allowed`, or a provider or budget failure.
 * A bad alternate is dropped to `null`, never replaced with another type. Never throws. Errors
 * carry no notes, prompt or model text.
 */
export async function generateForConcept(
  provider: Provider,
  ledger: BudgetLedger,
  concept: ExtractedConcept,
  doc: PreparedDocument,
  options: GenerationOptions,
): Promise<Result<GeneratedConceptQuestions | null, PipelineStageError>> {
  const allowed = options.allowedLockTypes ?? DEFAULT_ALLOWED_LOCK_TYPES;
  if (allowed.length === 0) return { ok: true, value: null };

  const schema = toModelJsonSchema(GenerationResponseSchema);
  if (!schema.ok) {
    return { ok: false, error: { kind: 'schema-not-representable', stage: STAGE } };
  }

  const system = buildGenerationSystemPrompt(allowed);
  const userMessage = buildGenerationUserMessage(concept, doc);
  const build = (content: string): ProviderRequest => ({
    stage: STAGE,
    promptVersion: GENERATION_PROMPT_VERSION,
    modelId: options.modelId,
    system,
    messages: [{ role: 'user', content }],
    temperature: options.temperature,
    maxOutputTokens: options.maxOutputTokens,
    jsonSchema: schema.value,
    timeoutMs: options.timeoutMs,
    retryLimit: options.retryLimit,
  });

  let content = userMessage;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const called = await callWithBudget(
      ledger,
      provider,
      build(content),
      options.worstCaseUsd,
      options.costOf,
    );
    if (!called.ok) {
      if (called.error.kind === 'budget') return { ok: false, error: { kind: 'budget-exhausted' } };
      const { retryable } = called.error.failure.error;
      return { ok: false, error: { kind: 'provider-failed', stage: STAGE, retryable } };
    }
    const parsed = GenerationResponseSchema.safeParse(called.response.json);
    if (!parsed.success) {
      // Retry note carries Zod paths and messages only; the raw output is not echoed.
      content = `${userMessage}\n\n${buildRetryNote(parsed.error)}`;
      continue;
    }

    const { primary, alternate } = parsed.data;
    if (primary === null) return { ok: true, value: null };
    if (!allowed.includes(primary.lockType)) {
      return { ok: false, error: { kind: 'lock-type-not-allowed' } };
    }
    const primaryQuestion = toAuthoringQuestion(
      primary,
      { id: `${concept.conceptId}-primary`, conceptId: concept.conceptId, role: 'primary' },
      doc,
    );
    if (!primaryQuestion.ok) return primaryQuestion;

    let alternateQuestion: AuthoringQuestion | null = null;
    if (
      alternate !== null &&
      alternate.lockType !== primary.lockType &&
      allowed.includes(alternate.lockType)
    ) {
      const mapped = toAuthoringQuestion(
        alternate,
        { id: `${concept.conceptId}-alternate`, conceptId: concept.conceptId, role: 'alternate' },
        doc,
      );
      if (mapped.ok) alternateQuestion = mapped.value;
    }
    return { ok: true, value: { primary: primaryQuestion.value, alternate: alternateQuestion } };
  }
  return { ok: false, error: { kind: 'schema-rejected', stage: STAGE } };
}
