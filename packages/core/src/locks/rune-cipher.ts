import type { HintEffectSpec, JudgeResult } from '../types';

export interface RuneCipherQuestion {
  readonly answer: string;
  readonly aliases: readonly string[];
  readonly caseSensitive: boolean;
}

export interface RuneCipherSubmission {
  readonly text: string;
}

function collapse(text: string): string {
  return text.trim().replace(/\s+/g, ' ');
}

/**
 * Judges a typed answer. Pure and total: never throws, never calls a model.
 * Rune cipher has no hint effect, so `appliedHint` does not change the result.
 */
export function judge(
  question: RuneCipherQuestion,
  submission: RuneCipherSubmission,
  appliedHint: HintEffectSpec | null,
): JudgeResult {
  void appliedHint;
  const sub: unknown = submission;
  const text: unknown = typeof sub === 'object' && sub !== null && 'text' in sub ? sub.text : '';
  const raw = typeof text === 'string' ? text : '';
  const typed = collapse(raw);
  if (typed === '') return 'invalid';

  const fold = (value: string): string => (question.caseSensitive ? value : value.toLowerCase());
  const target = fold(typed);
  const accepted = [question.answer, ...question.aliases];
  for (const candidate of accepted) {
    if (typeof candidate === 'string' && fold(collapse(candidate)) === target) {
      return 'correct';
    }
  }
  return 'wrong';
}
