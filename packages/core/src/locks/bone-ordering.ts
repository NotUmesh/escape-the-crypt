import type { HintEffectSpec, JudgeResult } from '../types';

export interface BoneOrderingQuestion {
  readonly itemIds: readonly string[];
  readonly keyOrder: readonly string[];
}

export interface BoneOrderingSubmission {
  readonly order: readonly string[];
}

function isPermutation(items: readonly string[], order: readonly string[]): boolean {
  if (order.length !== items.length) return false;
  const seen = new Set<string>();
  for (const id of order) {
    if (seen.has(id) || !items.includes(id)) return false;
    seen.add(id);
  }
  return true;
}

export interface MappedBoneOrdering {
  readonly payload: BoneOrderingQuestion;
  readonly hintEffect: Extract<HintEffectSpec, { kind: 'lock-first-bone' }>;
}

/**
 * Additive mapper helper. One generated item ID per step (`<questionId>-step-<index>`);
 * `steps` is already the answer order, so `keyOrder` equals `itemIds`. The hint is pinned to
 * `keyOrder[0]`. Pure; assumes at least one step (the schema requires 3 to 5).
 *
 * An authored `hint.boneId` agrees with the derived hint when it names the first step, written
 * either as the generated item ID (`<questionId>-step-0`) or as the first step's text (trimmed).
 * No existing sample or dev question authors this hint, so both spellings are accepted. When
 * the authored value is given (even `undefined`) and disagrees, the result is `null`.
 */
export function mapBoneOrderingPayload(questionId: string, steps: readonly string[]): MappedBoneOrdering;
export function mapBoneOrderingPayload(
  questionId: string,
  steps: readonly string[],
  authoredBoneId: string | undefined,
): MappedBoneOrdering | null;
export function mapBoneOrderingPayload(
  questionId: string,
  steps: readonly string[],
  authoredBoneId?: string,
): MappedBoneOrdering | null {
  const itemIds = steps.map((_, i) => `${questionId}-step-${i}`);
  const keyOrder = [...itemIds];
  if (authoredBoneId !== undefined) {
    const first = steps[0];
    const agrees =
      authoredBoneId === keyOrder[0] || (first !== undefined && authoredBoneId.trim() === first.trim());
    if (!agrees) return null;
  }
  return {
    payload: { itemIds, keyOrder },
    hintEffect: { kind: 'lock-first-bone', boneId: keyOrder[0] ?? '' },
  };
}

/**
 * Pure, never throws. A lock-first-bone hint pins that bone to its key position;
 * a submission that moves it is invalid.
 */
export function judge(
  question: BoneOrderingQuestion,
  submission: BoneOrderingSubmission,
  appliedHint: HintEffectSpec | null,
): JudgeResult {
  const sub: unknown = submission;
  const rawOrder: unknown =
    typeof sub === 'object' && sub !== null && 'order' in sub ? sub.order : undefined;
  if (!Array.isArray(rawOrder) || !rawOrder.every((id): id is string => typeof id === 'string')) {
    return 'invalid';
  }
  const order: readonly string[] = rawOrder;
  if (!isPermutation(question.itemIds, order)) return 'invalid';

  if (appliedHint?.kind === 'lock-first-bone') {
    const pinnedIndex = question.keyOrder.indexOf(appliedHint.boneId);
    if (pinnedIndex >= 0 && order[pinnedIndex] !== appliedHint.boneId) return 'invalid';
  }

  const isKey =
    order.length === question.keyOrder.length && order.every((id, i) => id === question.keyOrder[i]);
  return isKey ? 'correct' : 'wrong';
}
