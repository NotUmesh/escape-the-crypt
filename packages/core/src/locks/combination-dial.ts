import type { HintEffectSpec, JudgeResult } from '../types';

export interface CombinationDialQuestion {
  readonly kind: 'exact' | 'range' | 'tolerance';
  readonly exactValue?: number;
  readonly min?: number;
  readonly max?: number;
  readonly value?: number;
  readonly tolerance?: number;
  readonly unit: string;
}

export interface CombinationDialSubmission {
  readonly rawInput: string;
}

const NUMBER_PATTERN = /^(-?)(\d+)(?:\.(\d))?$/;

/** Parses a number with at most one decimal place into integer tenths, or null. */
function parseTenths(raw: string): number | null {
  const match = NUMBER_PATTERN.exec(raw.trim());
  if (match === null) return null;
  const tenths = Number(match[2]) * 10 + Number(match[3] ?? '0');
  if (!Number.isSafeInteger(tenths)) return null;
  return match[1] === '-' ? -tenths : tenths;
}

function toTenths(n: number | undefined): number | null {
  if (n === undefined || !Number.isFinite(n)) return null;
  const t = Math.round(n * 10);
  return Number.isSafeInteger(t) ? t : null;
}

/** Pure, never throws. Hints do not affect this lock type. */
export function judge(
  question: CombinationDialQuestion,
  submission: CombinationDialSubmission,
  appliedHint: HintEffectSpec | null,
): JudgeResult {
  void appliedHint;
  const sub: unknown = submission;
  const raw: unknown =
    typeof sub === 'object' && sub !== null && 'rawInput' in sub ? sub.rawInput : undefined;
  if (typeof raw !== 'string') return 'invalid';
  const guess = parseTenths(raw);
  if (guess === null) return 'invalid';

  switch (question.kind) {
    case 'exact': {
      const exact = toTenths(question.exactValue);
      if (exact === null) return 'invalid';
      return guess === exact ? 'correct' : 'wrong';
    }
    case 'range': {
      const min = toTenths(question.min);
      const max = toTenths(question.max);
      if (min === null || max === null) return 'invalid';
      return guess >= min && guess <= max ? 'correct' : 'wrong';
    }
    case 'tolerance': {
      const value = toTenths(question.value);
      const tol = toTenths(question.tolerance);
      if (value === null || tol === null || tol < 0) return 'invalid';
      return guess >= value - tol && guess <= value + tol ? 'correct' : 'wrong';
    }
    default:
      return 'invalid';
  }
}
