import type { HintEffectSpec, JudgeResult } from '../types';

export interface CursedObjectQuestion {
  readonly optionIds: readonly string[];
  readonly oddOneOutId: string;
}

export interface CursedObjectSubmission {
  readonly selectedId: string | null;
}

export interface MappedCursedObject {
  readonly payload: CursedObjectQuestion;
  readonly hintEffect: Extract<HintEffectSpec, { kind: 'remove-option' }>;
}

/**
 * Additive mapper helper. One generated item ID per item (`<questionId>-item-<i>`), in `items`
 * order. `oddOneOutId` is the first item whose text equals `answer`. The hint removes the first
 * non-odd item, chosen in code. No matching item, or no non-odd item, returns `null`.
 * Pure, never throws.
 */
export function mapCursedObjectPayload(
  questionId: string,
  items: readonly string[],
  answer: string,
): MappedCursedObject | null {
  const optionIds = items.map((_, i) => `${questionId}-item-${i}`);
  const oddIndex = items.indexOf(answer);
  const oddOneOutId = optionIds[oddIndex];
  const removed = optionIds.find((_, i) => i !== oddIndex);
  if (oddOneOutId === undefined || removed === undefined) return null;
  return {
    payload: { optionIds, oddOneOutId },
    hintEffect: { kind: 'remove-option', optionId: removed },
  };
}

/** Pure, never throws. Only a remove-option hint affects judging. */
export function judge(
  question: CursedObjectQuestion,
  submission: CursedObjectSubmission,
  appliedHint: HintEffectSpec | null,
): JudgeResult {
  const sub: unknown = submission;
  const selected: unknown =
    typeof sub === 'object' && sub !== null && 'selectedId' in sub ? sub.selectedId : null;
  if (typeof selected !== 'string' || !question.optionIds.includes(selected)) return 'invalid';
  if (appliedHint?.kind === 'remove-option' && appliedHint.optionId === selected) {
    return 'invalid';
  }
  return selected === question.oddOneOutId ? 'correct' : 'wrong';
}
