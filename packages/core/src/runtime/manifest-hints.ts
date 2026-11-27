import type { HintEffectSpec, LockType } from '../types';

/** The slice of Zod's refinement context that `narrowHint` needs. */
export interface IssueSink {
  addIssue(issue: { code: 'custom'; path: (string | number)[]; message: string }): void;
}

/**
 * Narrows which hint kinds a lock type's question may carry (Req 2.4, 2.14 to 2.17).
 * `null` is always accepted. Lock types without a payload schema never reach this function.
 * `payload` must already have passed the lock type's payload schema.
 */
export function narrowHint(
  lockType: LockType,
  payload: unknown,
  hintEffect: HintEffectSpec | null,
  ctx: IssueSink,
): void {
  if (hintEffect === null) return;
  const fail = (message: string): void =>
    ctx.addIssue({ code: 'custom', path: ['hintEffect'], message });

  if (lockType === 'rune-cipher') {
    if (hintEffect.kind !== 'reveal-first-letter') {
      fail(`hint-kind-not-allowed: rune-cipher accepts only reveal-first-letter, got ${hintEffect.kind}`);
    }
    return;
  }
  if (lockType === 'seance-board') {
    if (hintEffect.kind !== 'remove-option') {
      fail(`hint-kind-not-allowed: seance-board accepts only remove-option, got ${hintEffect.kind}`);
      return;
    }
    const { optionIds, keyOptionId } = payload as {
      readonly optionIds: readonly string[];
      readonly keyOptionId: string;
    };
    if (!optionIds.includes(hintEffect.optionId)) {
      fail('hint-option-unknown: remove-option optionId is not in optionIds');
    } else if (hintEffect.optionId === keyOptionId) {
      fail('hint-option-is-key: remove-option must not remove the key option');
    }
    return;
  }
  if (lockType === 'bone-ordering') {
    if (hintEffect.kind !== 'lock-first-bone') {
      fail(`hint-kind-not-allowed: bone-ordering accepts only lock-first-bone, got ${hintEffect.kind}`);
      return;
    }
    const { itemIds } = payload as { readonly itemIds: readonly string[] };
    if (!itemIds.includes(hintEffect.boneId)) {
      fail('hint-bone-unknown: lock-first-bone boneId is not in itemIds');
    }
  }
}
