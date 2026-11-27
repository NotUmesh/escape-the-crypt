import type { CombinationDialAuthoringQuestion } from '../authoring/schema';
import type { HintEffectSpec, JudgeResult } from '../types';
import { computeTemplate } from './combination-dial-checks';

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

/** The two payload shapes the mapper can produce. A `tolerance` payload is never produced. */
export type MappedCombinationDialPayload =
  | { readonly kind: 'exact'; readonly exactValue: number; readonly unit: string }
  | { readonly kind: 'range'; readonly min: number; readonly max: number; readonly unit: string };

/**
 * Maps an authoring dial answer to the judge's question shape. Pure, additive; the judge is unchanged.
 * - exact -> `exact` with the stated value.
 * - range -> `range` with the stated endpoints (min must not exceed max).
 * - template -> `exact` with the value COMPUTED BY CODE via `computeTemplate`; the authored `value` is ignored.
 * `tolerance` is never produced from model output: a dial is solved by an exact value or a stated
 * range, so the judge's tolerance kind stays unused by generation. `hintEffect` is always null
 * (`reveal-digit` is unreachable). Returns null when the answer cannot be mapped (blank unit,
 * non-finite or unrepresentable number, reversed range, template that cannot be computed).
 */
export function mapCombinationDialPayload(
  answer: CombinationDialAuthoringQuestion['answer'],
  units: string,
): { readonly payload: MappedCombinationDialPayload; readonly hintEffect: null } | null {
  if (typeof units !== 'string' || units.trim() === '') return null;
  const usable = (n: unknown): n is number => typeof n === 'number' && toTenths(n) !== null;
  switch (answer.kind) {
    case 'exact':
      return usable(answer.value)
        ? { payload: { kind: 'exact', exactValue: answer.value, unit: units }, hintEffect: null }
        : null;
    case 'range':
      return usable(answer.min) && usable(answer.max) && answer.min <= answer.max
        ? { payload: { kind: 'range', min: answer.min, max: answer.max, unit: units }, hintEffect: null }
        : null;
    case 'template': {
      const computed = computeTemplate(answer.template, answer.inputs);
      return computed !== null && usable(computed)
        ? { payload: { kind: 'exact', exactValue: computed, unit: units }, hintEffect: null }
        : null;
    }
    default:
      return null;
  }
}
