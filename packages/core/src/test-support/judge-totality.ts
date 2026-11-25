import fc from 'fast-check';

import type { HintEffectSpec, JudgeResult } from '../types';

export const JUDGE_RESULTS: readonly JudgeResult[] = ['correct', 'wrong', 'invalid'];

const id = fc.oneof(fc.constantFrom('a', 'b', 'c', 'd', 'x', 'y', 'z'), fc.string());

/** Every hint kind, so each judge sees matching and mismatched kinds. */
export const anyHintSpec: fc.Arbitrary<HintEffectSpec> = fc.oneof(
  fc.record({ kind: fc.constant('remove-option' as const), optionId: id }),
  fc.record({ kind: fc.constant('lock-first-bone' as const), boneId: id }),
  fc.record({
    kind: fc.constant('tie-thread' as const),
    pair: fc.tuple(id, id) as fc.Arbitrary<readonly [string, string]>,
  }),
  fc.record({ kind: fc.constant('reveal-digit' as const), position: fc.integer({ min: -2, max: 8 }) }),
  fc.record({
    kind: fc.constant('reveal-first-letter' as const),
    firstLetter: id,
    length: fc.integer({ min: -2, max: 40 }),
  }),
);

/** null, undefined (cast through unknown, as a corrupt caller might pass), or any hint spec. */
export const anyAppliedHint: fc.Arbitrary<HintEffectSpec | null> = fc.oneof(
  fc.constant(null),
  fc.constant(undefined as unknown as null),
  anyHintSpec,
);
