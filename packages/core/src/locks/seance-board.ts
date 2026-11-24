import type { HintEffectSpec, JudgeResult } from '../types';

export interface SeanceBoardQuestion {
  readonly optionIds: readonly string[];
  readonly keyOptionId: string;
}

export interface SeanceBoardSubmission {
  readonly selectedOptionId: string | null;
}

/** Pure, never throws. Only a remove-option hint affects judging. */
export function judge(
  question: SeanceBoardQuestion,
  submission: SeanceBoardSubmission,
  appliedHint: HintEffectSpec | null,
): JudgeResult {
  const sub: unknown = submission;
  const selected: unknown =
    typeof sub === 'object' && sub !== null && 'selectedOptionId' in sub ? sub.selectedOptionId : null;
  if (typeof selected !== 'string' || !question.optionIds.includes(selected)) return 'invalid';
  if (appliedHint?.kind === 'remove-option' && appliedHint.optionId === selected) {
    return 'invalid';
  }
  return selected === question.keyOptionId ? 'correct' : 'wrong';
}
