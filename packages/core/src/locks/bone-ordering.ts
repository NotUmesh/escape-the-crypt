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
