import fc from 'fast-check';
import type { BoneOrderingQuestion } from '../locks/bone-ordering';
import type { BoundThreadsQuestion } from '../locks/bound-threads';
import type { CombinationDialQuestion } from '../locks/combination-dial';
import type { CursedObjectQuestion } from '../locks/cursed-object';
import type { HintEffectSpec } from '../types';

/** Arbitraries for the four interaction-model payloads. Valid by construction. */
const idPrefix = fc.stringMatching(/^[a-z]{2,5}$/);

export const boneOrderingArb: fc.Arbitrary<{ question: BoneOrderingQuestion; hint: HintEffectSpec | null; seed: string }> =
  fc
    .tuple(idPrefix, fc.integer({ min: 3, max: 6 }), fc.boolean(), fc.nat({ max: 5 }), fc.string())
    .map(([prefix, n, withHint, pinAt, seed]) => {
      const itemIds = Array.from({ length: n }, (_, i) => `${prefix}-b${i}`);
      const keyOrder = [...itemIds];
      const pinned = keyOrder[pinAt % n] ?? keyOrder[0] ?? '';
      return {
        question: { itemIds, keyOrder },
        hint: withHint ? ({ kind: 'lock-first-bone', boneId: pinned } as const) : null,
        seed,
      };
    });

export const boundThreadsArb: fc.Arbitrary<{ question: BoundThreadsQuestion; hint: HintEffectSpec | null; seed: string }> =
  fc
    .tuple(idPrefix, fc.integer({ min: 3, max: 5 }), fc.boolean(), fc.nat({ max: 4 }), fc.string())
    .map(([prefix, n, withHint, hintAt, seed]) => {
      const leftIds = Array.from({ length: n }, (_, i) => `${prefix}-l${i}`);
      const rightIds = Array.from({ length: n }, (_, i) => `${prefix}-r${i}`);
      const keyPairs = leftIds.map((l, i) => [l, rightIds[i] ?? ''] as const);
      const pair = keyPairs[hintAt % n] ?? keyPairs[0] ?? (['', ''] as const);
      return {
        question: { leftIds, rightIds, keyPairs },
        hint: withHint ? ({ kind: 'tie-thread', pair } as const) : null,
        seed,
      };
    });

export const cursedObjectArb: fc.Arbitrary<{ question: CursedObjectQuestion; hint: HintEffectSpec | null; seed: string }> =
  fc
    .tuple(idPrefix, fc.integer({ min: 3, max: 5 }), fc.nat({ max: 4 }), fc.boolean(), fc.nat({ max: 4 }), fc.string())
    .map(([prefix, n, oddAt, withHint, removeAt, seed]) => {
      const optionIds = Array.from({ length: n }, (_, i) => `${prefix}-o${i}`);
      const oddOneOutId = optionIds[oddAt % n] ?? optionIds[0] ?? '';
      const removable = optionIds.filter((id) => id !== oddOneOutId);
      const removed = removable[removeAt % removable.length] ?? '';
      return {
        question: { optionIds, oddOneOutId },
        hint: withHint ? ({ kind: 'remove-option', optionId: removed } as const) : null,
        seed,
      };
    });

const tenthsNumber = fc.integer({ min: 0, max: 9999 }).map((t) => t / 10);
export const combinationDialArb: fc.Arbitrary<CombinationDialQuestion> = fc.oneof(
  tenthsNumber.map((v): CombinationDialQuestion => ({ kind: 'exact', exactValue: v, unit: 'candles' })),
  fc
    .tuple(tenthsNumber, tenthsNumber)
    .map(([a, b]): CombinationDialQuestion => ({ kind: 'range', min: Math.min(a, b), max: Math.max(a, b), unit: 'years' })),
  fc
    .tuple(tenthsNumber, fc.integer({ min: 0, max: 50 }).map((t) => t / 10))
    .map(([value, tolerance]): CombinationDialQuestion => ({ kind: 'tolerance', value, tolerance, unit: 'steps' })),
);
