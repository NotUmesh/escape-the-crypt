import type { HintEffectSpec, JudgeResult } from '../types';

export interface CursedObjectQuestion {
  readonly optionIds: readonly string[];
  readonly oddOneOutId: string;
}

export interface CursedObjectSubmission {
  readonly selectedId: string | null;
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
