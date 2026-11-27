import { callWithBudget } from '../budget/call-with-budget';
import type { BudgetLedger } from '../budget/types';
import { MAX_EXTRACTED_WORDS } from '../limits';
import { toModelJsonSchema } from '../provider/model-json-schema';
import type { Provider, ProviderRequest, ProviderUsage } from '../provider/types';
import { resolveQuote } from '../quote-resolver';
import type { Result } from '../types';
import {
  CONCEPT_EXTRACTION_PROMPT_VERSION,
  CONCEPT_EXTRACTION_SYSTEM_PROMPT,
  ConceptExtractionResponseSchema,
  buildConceptExtractionUserMessage,
  buildRetryNote,
  type ConceptExtractionResponse,
} from './concept-extraction-prompt';
import type { PreparedDocument } from './prepare-input';
import type { PipelineStageError } from './stage-error';

export { CONCEPT_EXTRACTION_PROMPT_VERSION } from './concept-extraction-prompt';

export interface ExtractedConcept {
  /** Assigned by code: `concept-1`, `concept-2`, ... in model order, after filtering. */
  readonly conceptId: string;
  readonly label: string;
  /** Chunk IDs the model cited; every one is a quotable chunk of this document. */
  readonly chunkIds: readonly string[];
  /** Only quotes that resolved uniquely in exactly one cited chunk. */
  readonly quotes: readonly string[];
}

/** Injected by the caller; this module holds no prices or model names. */
export interface ConceptExtractionOptions {
  readonly modelId: string;
  readonly temperature: number;
  readonly maxOutputTokens: number;
  readonly timeoutMs: number;
  readonly retryLimit: number;
  /** Worst-case cost of one call, reserved before each attempt. */
  readonly worstCaseUsd: number;
  readonly costOf: (usage: ProviderUsage) => number;
}

const STAGE = 'concept-extraction' as const;

function countWords(text: string): number {
  const trimmed = text.trim();
  return trimmed === '' ? 0 : trimmed.split(/\s+/).length;
}

function documentWordCount(doc: PreparedDocument): number {
  let total = 0;
  for (const chunk of doc.chunks.values()) total += countWords(chunk.text);
  return total;
}

/** A quote is kept only when exactly one cited chunk resolves it uniquely. */
function quoteResolvesOnce(
  doc: PreparedDocument,
  chunkIds: readonly string[],
  quote: string,
): boolean {
  let hits = 0;
  for (const chunkId of new Set(chunkIds)) {
    if (resolveQuote(doc.chunks, chunkId, quote).ok) hits += 1;
  }
  return hits === 1;
}

/** Applies Req 13.4 and 13.5 to a validated response. Pure. */
export function filterConcepts(
  doc: PreparedDocument,
  response: ConceptExtractionResponse,
): readonly ExtractedConcept[] {
  const out: ExtractedConcept[] = [];
  for (const concept of response.concepts) {
    // 13.5: any ID code did not assign as a quotable chunk rejects the whole concept.
    if (concept.chunkIds.some((id) => !doc.ordinalByChunkId.has(id))) continue;
    const quotes = concept.quotes.filter((q) => quoteResolvesOnce(doc, concept.chunkIds, q));
    if (quotes.length === 0) continue; // 13.4
    out.push({
      conceptId: `concept-${out.length + 1}`,
      label: concept.label,
      chunkIds: [...new Set(concept.chunkIds)],
      quotes,
    });
  }
  return out;
}

/**
 * One concept-extraction call per document, plus at most one retry after a schema failure.
 * Each attempt reserves its own budget through `callWithBudget`. Never throws. Errors carry no
 * notes text, prompt or model output.
 */
export async function extractConcepts(
  provider: Provider,
  ledger: BudgetLedger,
  doc: PreparedDocument,
  options: ConceptExtractionOptions,
): Promise<Result<readonly ExtractedConcept[], PipelineStageError>> {
  if (documentWordCount(doc) > MAX_EXTRACTED_WORDS) {
    return { ok: false, error: { kind: 'input-too-long', limit: MAX_EXTRACTED_WORDS } };
  }

  const schema = toModelJsonSchema(ConceptExtractionResponseSchema);
  if (!schema.ok) {
    return { ok: false, error: { kind: 'schema-not-representable', stage: STAGE } };
  }

  const userMessage = buildConceptExtractionUserMessage(doc);
  const build = (content: string): ProviderRequest => ({
    stage: STAGE,
    promptVersion: CONCEPT_EXTRACTION_PROMPT_VERSION,
    modelId: options.modelId,
    system: CONCEPT_EXTRACTION_SYSTEM_PROMPT,
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
    const parsed = ConceptExtractionResponseSchema.safeParse(called.response.json);
    if (parsed.success) return { ok: true, value: filterConcepts(doc, parsed.data) };
    // Retry note carries Zod paths and messages only; the raw output is not echoed.
    content = `${userMessage}\n\n${buildRetryNote(parsed.error)}`;
  }
  return { ok: false, error: { kind: 'schema-invalid', stage: STAGE } };
}
