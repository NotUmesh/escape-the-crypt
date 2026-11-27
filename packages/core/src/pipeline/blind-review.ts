import type { AuthoringQuestion } from '../authoring/schema';
import { callWithBudget } from '../budget/call-with-budget';
import type { BudgetLedger } from '../budget/types';
import { CHECK_REGISTRY } from '../checks/registry';
import { runChecks } from '../checks/run-checks';
import { judge } from '../locks/rune-cipher';
import { toModelJsonSchema } from '../provider/model-json-schema';
import type { Provider, ProviderRequest } from '../provider/types';
import {
  BLIND_REVIEW_PROMPT_VERSION,
  BLIND_REVIEW_SYSTEM_PROMPT,
  ReviewResponseSchema,
  buildBlindReviewUserMessage,
  boneDisplayOrder,
  boneItemId,
  cursedDisplayOrder,
  cursedItemId,
  threadsDisplayOrder,
  threadsLeftId,
  threadsRightId,
  buildRetryNote,
  type ReviewResponse,
} from './blind-review-prompt';
import type { ConceptExtractionOptions } from './concept-extraction';
import { toEvidenceContext, type PreparedDocument } from './prepare-input';

export { BLIND_REVIEW_PROMPT_VERSION } from './blind-review-prompt';
export { ReviewResponseSchema } from './blind-review-prompt';

/** Same injected shape as the other stages, minus temperature: review is always run at 0 (Req 11.5). */
export type BlindReviewOptions = Omit<ConceptExtractionOptions, 'temperature'>;

/** Closed set of rejection reasons. Never carries notes, model output or the key. */
export type ReviewRejection =
  | { readonly kind: 'blocking-check' }
  | { readonly kind: 'answer-mismatch' }
  | { readonly kind: 'unknown-label' }
  /** Séance only: the answered option is not `supported`, or another option is not `contradicted`. */
  | { readonly kind: 'label-mismatch' }
  /** The reviewer's reply failed the schema twice (Req 15.8). */
  | { readonly kind: 'schema-rejected' }
  | { readonly kind: 'budget-exhausted' }
  | { readonly kind: 'provider-failed'; readonly retryable: boolean }
  /** A code defect: the model-facing JSON schema could not be built. */
  | { readonly kind: 'schema-not-representable' }
  /** The run was cancelled before this attempt; no reservation was made and no call started. */
  | { readonly kind: 'cancelled' };

export type ReviewVerdict =
  | { readonly verdict: 'passed' }
  | { readonly verdict: 'rejected'; readonly reason: ReviewRejection };

const STAGE = 'review' as const;
const REVIEW_TEMPERATURE = 0;

const ADVISORY_IDS: ReadonlySet<string> = new Set(
  CHECK_REGISTRY.filter((r) => r.severity === 'advisory').map((r) => r.id),
);

function reject(reason: ReviewRejection): ReviewVerdict {
  return { verdict: 'rejected', reason };
}

function keyOf(
  question: Exclude<AuthoringQuestion, { lockType: 'bone-ordering' | 'bound-threads' | 'cursed-object' }>,
): string {
  return question.answer;
}

/**
 * Bone ordering: the reviewer answers with the shown item ids, comma-separated. The reply passes
 * only if it names every shown id exactly once and reproduces the key order exactly.
 */
function boneMatches(steps: readonly string[], answer: string): boolean {
  const display = boneDisplayOrder(steps);
  const stepOfId = new Map(display.map((stepIndex, position) => [boneItemId(position), stepIndex]));
  const submitted = answer.split(',').map((s) => s.trim());
  if (submitted.length !== steps.length) return false;
  return submitted.every((id, i) => stepOfId.get(id) === i);
}

/**
 * Bound threads: the reply is a full matching "L1=R3,L2=R1,...". It passes only if every shown
 * left id appears once, every right id is used once, and each left is joined to the right item
 * the key pairs it with. Partial, repeated, unknown or different pairings are rejected.
 */
function threadsMatches(pairs: readonly { left: string; right: string }[], answer: string): boolean {
  const order = threadsDisplayOrder(pairs);
  const keyRightOfLeft = new Map<string, string>();
  order.left.forEach((pairIndex, position) => {
    const rightPosition = order.right.indexOf(pairIndex);
    keyRightOfLeft.set(threadsLeftId(position), threadsRightId(rightPosition));
  });
  const entries = answer.split(',').map((s) => s.trim());
  if (entries.length !== pairs.length) return false;
  const seenLeft = new Set<string>();
  const seenRight = new Set<string>();
  for (const entry of entries) {
    const parts = entry.split('=').map((s) => s.trim());
    if (parts.length !== 2) return false;
    const [l, r] = parts as [string, string];
    if (keyRightOfLeft.get(l) !== r || seenLeft.has(l) || seenRight.has(r)) return false;
    seenLeft.add(l);
    seenRight.add(r);
  }
  return true;
}

/**
 * Cursed object. "Names the same item and rule" means, in code: the reply's `answer` is the shown
 * id of the key item, AND `optionLabels` states the category rule item by item. Each of the other
 * three items is labelled `supported` (the notes say it fits the category the question's prompt
 * states) and the named item is labelled `contradicted` (the notes say it does not fit). The
 * reply schema has no free-text field, and adding one would change every review digest, so the
 * rule is carried by these per-item verdicts. A missing, partial, repeated or unknown-id label
 * set, or any other pattern, fails. (`unknown` labels are rejected earlier as unknown-label.)
 */
function cursedMatches(items: readonly string[], key: string, response: ReviewResponse): boolean {
  const keyIndex = items.indexOf(key);
  if (keyIndex < 0) return false;
  const display = cursedDisplayOrder(items);
  const keyId = cursedItemId(display.indexOf(keyIndex));
  if (response.answer.trim() !== keyId) return false;
  const labels = response.optionLabels;
  if (labels === null || labels.length !== items.length) return false;
  const seen = new Set<string>();
  for (const { optionId, label } of labels) {
    if (seen.has(optionId)) return false;
    seen.add(optionId);
    if (label !== (optionId === keyId ? 'contradicted' : 'supported')) return false;
  }
  return items.every((_, position) => seen.has(cursedItemId(position)));
}

/** Applies the rejection rule (Req 15.5, 15.6) to a validated reply. Pure. */
export function decideReview(question: AuthoringQuestion, response: ReviewResponse): ReviewVerdict {
  const hasUnknownLabel = (response.optionLabels ?? []).some((l) => l.label === 'unknown');
  if (hasUnknownLabel || response.answer.trim().toLowerCase() === 'unknown') {
    return reject({ kind: 'unknown-label' });
  }
  if (question.lockType === 'rune-cipher') {
    // The judge's own normalisation and alias handling, so review and play agree.
    const result = judge(
      { answer: question.answer, aliases: question.aliases, caseSensitive: question.caseSensitive },
      { text: response.answer },
      null,
    );
    return result === 'correct' ? { verdict: 'passed' } : reject({ kind: 'answer-mismatch' });
  }
  if (question.lockType === 'bone-ordering') {
    return boneMatches(question.steps, response.answer)
      ? { verdict: 'passed' }
      : reject({ kind: 'answer-mismatch' });
  }
  if (question.lockType === 'bound-threads') {
    return threadsMatches(question.pairs, response.answer)
      ? { verdict: 'passed' }
      : reject({ kind: 'answer-mismatch' });
  }
  if (question.lockType === 'cursed-object') {
    return cursedMatches(question.items, question.answer, response)
      ? { verdict: 'passed' }
      : reject({ kind: 'answer-mismatch' });
  }
  const answered = response.answer.trim();
  if (answered !== keyOf(question)) return reject({ kind: 'answer-mismatch' });
  const labelsOk = (response.optionLabels ?? []).every((l) =>
    l.optionId === answered ? l.label === 'supported' : l.label === 'contradicted',
  );
  return labelsOk ? { verdict: 'passed' } : reject({ kind: 'label-mismatch' });
}

/**
 * Post-parse check of the label set (Req 15.4). Rune cipher: `optionLabels` must be null.
 * Séance: exactly one label per shown option id, no unknown ids, no duplicates. Pure.
 */
export function hasCompleteLabels(question: AuthoringQuestion, response: ReviewResponse): boolean {
  if (question.lockType === 'cursed-object') {
    if (response.optionLabels === null) return false;
    const shownIds = new Set(question.items.map((_, p) => cursedItemId(p)));
    const seenIds = new Set<string>();
    for (const { optionId } of response.optionLabels) {
      if (!shownIds.has(optionId) || seenIds.has(optionId)) return false;
      seenIds.add(optionId);
    }
    return seenIds.size === shownIds.size;
  }
  // Rune cipher, bone ordering and bound threads have no options to label.
  if (question.lockType !== 'seance-board') return response.optionLabels === null;
  if (response.optionLabels === null) return false;
  const shown = new Set(question.options.map((o) => o.id));
  const seen = new Set<string>();
  for (const { optionId } of response.optionLabels) {
    if (!shown.has(optionId) || seen.has(optionId)) return false;
    seen.add(optionId);
  }
  return seen.size === shown.size;
}

const INCOMPLETE_LABELS_NOTE = [
  'Your previous reply did not match the required label rules.',
  'For a multiple-choice question, optionLabels must have exactly one entry for each option id shown, with no unknown or repeated ids.',
  'For a fill-in-the-blank question, optionLabels must be null.',
  'Reply again with JSON that matches the schema exactly.',
].join('\n');

/**
 * Blind review of one question. Runs Code_Checks first and makes no call for a question with a
 * blocking failure. Otherwise at most two reviewer calls (one retry after a schema failure), each
 * with its own budget reservation, at temperature 0. The reviewer is never shown the key, a
 * label, the explanation, the aliases, the hint or the generator's justification.
 * Every outcome is a verdict; never throws. Reasons carry kinds only.
 */
export async function blindReview(
  provider: Provider,
  ledger: BudgetLedger,
  question: AuthoringQuestion,
  doc: PreparedDocument,
  options: BlindReviewOptions,
): Promise<ReviewVerdict> {
  const failures = runChecks({ question, ...toEvidenceContext(doc) });
  if (failures.some((f) => !ADVISORY_IDS.has(f.checkId))) return reject({ kind: 'blocking-check' });

  const schema = toModelJsonSchema(ReviewResponseSchema);
  if (!schema.ok) return reject({ kind: 'schema-not-representable' });

  const userMessage = buildBlindReviewUserMessage(question, doc);
  const build = (content: string): ProviderRequest => ({
    stage: STAGE,
    promptVersion: BLIND_REVIEW_PROMPT_VERSION,
    modelId: options.modelId,
    system: BLIND_REVIEW_SYSTEM_PROMPT,
    messages: [{ role: 'user', content }],
    temperature: REVIEW_TEMPERATURE,
    maxOutputTokens: options.maxOutputTokens,
    jsonSchema: schema.value,
    timeoutMs: options.timeoutMs,
    retryLimit: options.retryLimit,
  });

  let content = userMessage;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (options.shouldStop?.() === true) return reject({ kind: 'cancelled' });
    const called = await callWithBudget(
      ledger,
      provider,
      build(content),
      options.worstCaseUsd,
      options.costOf,
    );
    if (!called.ok) {
      if (called.error.kind === 'budget') return reject({ kind: 'budget-exhausted' });
      return reject({
        kind: 'provider-failed',
        retryable: called.error.failure.error.retryable,
      });
    }
    const parsed = ReviewResponseSchema.safeParse(called.response.json);
    if (parsed.success && hasCompleteLabels(question, parsed.data)) {
      return decideReview(question, parsed.data);
    }
    const note = parsed.success ? INCOMPLETE_LABELS_NOTE : buildRetryNote(parsed.error);
    content = `${userMessage}\n\n${note}`;
  }
  return reject({ kind: 'schema-rejected' });
}
