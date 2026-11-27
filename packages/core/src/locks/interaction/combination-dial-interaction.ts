import type { CombinationDialQuestion, CombinationDialSubmission } from '../combination-dial';
import type { InteractionSubmission } from './interaction-result';

/**
 * The typed text is the only stored value. Wheels are a view of it: the integer wheels (at
 * least 3) and, when a stated number has a tenths digit, one tenths wheel.
 */
export interface CombinationDialDraft {
  readonly text: string;
  readonly integerWheels: number;
  readonly hasTenths: boolean;
}
export interface Wheel {
  /** 0 is the leftmost wheel. */
  readonly index: number;
  /** Place value as a power of ten: 2 is hundreds, 1 tens, 0 ones, -1 tenths. */
  readonly exponent: number;
  readonly digit: number;
}
export type WheelDirection = 'up' | 'down';

const MIN_WHEELS = 3;
const TEXT_PATTERN = /^(-?)(\d*)(?:\.(\d*))?$/;

function statedNumbers(payload: CombinationDialQuestion): readonly number[] {
  const raw: readonly (number | undefined)[] =
    payload.kind === 'exact'
      ? [payload.exactValue]
      : payload.kind === 'range'
        ? [payload.min, payload.max]
        : [payload.value, payload.tolerance, (payload.value ?? 0) + (payload.tolerance ?? 0)];
  return raw.filter((n): n is number => typeof n === 'number' && Number.isFinite(n));
}

/** Sizes the wheels from the stated numbers. The draft starts with empty text. */
export function initCombinationDialDraft(payload: CombinationDialQuestion): CombinationDialDraft {
  const numbers = statedNumbers(payload);
  const digits = numbers.reduce((most, n) => Math.max(most, String(Math.floor(Math.abs(n))).length), 1);
  const hasTenths = numbers.some((n) => Math.round(Math.abs(n) * 10) % 10 !== 0);
  return { text: '', integerWheels: Math.min(Math.max(MIN_WHEELS, digits), 12), hasTenths };
}

interface ParsedText {
  readonly negative: boolean;
  readonly integerDigits: readonly number[];
  readonly tenth: number;
}
function parse(draft: CombinationDialDraft): ParsedText {
  const match = TEXT_PATTERN.exec(draft.text.trim());
  const intPart = match?.[2] ?? '';
  const decimal = match?.[3] ?? '';
  const padded = intPart.padStart(draft.integerWheels, '0').slice(-draft.integerWheels);
  return {
    negative: match?.[1] === '-',
    integerDigits: Array.from(padded, Number),
    tenth: Number(decimal[0] ?? '0'),
  };
}
function render(parsed: ParsedText, hasTenths: boolean): string {
  const whole = parsed.integerDigits.join('');
  return `${parsed.negative ? '-' : ''}${whole}${hasTenths ? `.${parsed.tenth}` : ''}`;
}

export function wheelCount(draft: CombinationDialDraft): number {
  return draft.integerWheels + (draft.hasTenths ? 1 : 0);
}

/** The wheels as they read for the current text. Unreadable or empty text reads as all zeros. */
export function wheelsOf(draft: CombinationDialDraft): readonly Wheel[] {
  const parsed = parse(draft);
  const wheels: Wheel[] = parsed.integerDigits.map((digit, index) => ({
    index,
    exponent: draft.integerWheels - 1 - index,
    digit,
  }));
  if (draft.hasTenths) wheels.push({ index: draft.integerWheels, exponent: -1, digit: parsed.tenth });
  return wheels;
}

/** Steps one wheel up or down. It wraps 9 to 0 and 0 to 9 on that wheel only. Unknown wheels change nothing. */
export function stepWheel(draft: CombinationDialDraft, index: number, direction: WheelDirection): CombinationDialDraft {
  if (!Number.isInteger(index) || index < 0 || index >= wheelCount(draft)) return draft;
  const parsed = parse(draft);
  const delta = direction === 'up' ? 1 : 9;
  if (index < draft.integerWheels) {
    const digits = [...parsed.integerDigits];
    digits[index] = ((digits[index] ?? 0) + delta) % 10;
    return { ...draft, text: render({ ...parsed, integerDigits: digits }, draft.hasTenths) };
  }
  return { ...draft, text: render({ ...parsed, tenth: (parsed.tenth + delta) % 10 }, draft.hasTenths) };
}

/** Replaces the text with what was typed. Any string is accepted; the judge decides. */
export function setTypedEntry(draft: CombinationDialDraft, text: string): CombinationDialDraft {
  return { ...draft, text };
}

export function combinationDialSubmission(draft: CombinationDialDraft): InteractionSubmission<CombinationDialSubmission> {
  const rawInput = draft.text.trim();
  if (rawInput === '') return { ready: false, reason: 'empty' };
  return { ready: true, submission: { rawInput } };
}
