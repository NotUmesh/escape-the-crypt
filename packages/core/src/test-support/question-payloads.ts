import type { HintEffectSpec, LockType } from '../types';

/** Plain-JSON question payloads with fictional content, shaped for the six judges. */
export interface BuiltPayload {
  readonly payload: unknown;
  /** A hint effect that suits the payload, or null if none applies. */
  readonly hint: HintEffectSpec | null;
}

/**
 * Build a payload for `lockType`. `n` is the question's counter value; it varies the
 * position of the key so fixtures are not all the same shape. IDs are prefixed with `id`.
 */
export function buildPayload(lockType: LockType, id: string, n: number): BuiltPayload {
  switch (lockType) {
    case 'rune-cipher': {
      const answer = `Glimmerstone ${n}`;
      const codePoints = Array.from(answer);
      return {
        payload: { answer, aliases: [], caseSensitive: false },
        hint: {
          kind: 'reveal-first-letter',
          firstLetter: codePoints[0] ?? '',
          length: codePoints.length,
        },
      };
    }
    case 'seance-board':
    case 'cursed-object': {
      const optionIds = [0, 1, 2, 3].map((i) => `${id}-o${i}`);
      const keyIndex = n % 4;
      const keyId = optionIds[keyIndex] ?? `${id}-o0`;
      const removable = optionIds.find((o) => o !== keyId) ?? `${id}-o1`;
      const payload =
        lockType === 'seance-board'
          ? { optionIds, keyOptionId: keyId }
          : { optionIds, oddOneOutId: keyId };
      return { payload, hint: { kind: 'remove-option', optionId: removable } };
    }
    case 'bone-ordering': {
      const itemIds = [0, 1, 2, 3].map((i) => `${id}-b${i}`);
      const keyOrder = [...itemIds].reverse();
      return {
        payload: { itemIds, keyOrder },
        hint: { kind: 'lock-first-bone', boneId: keyOrder[0] ?? `${id}-b3` },
      };
    }
    case 'bound-threads': {
      const leftIds = [0, 1, 2].map((i) => `${id}-l${i}`);
      const rightIds = [0, 1, 2].map((i) => `${id}-r${i}`);
      const keyPairs: [string, string][] = leftIds.map((l, i) => [
        l,
        rightIds[(i + 1) % 3] ?? `${id}-r0`,
      ]);
      const first = keyPairs[0] ?? [`${id}-l0`, `${id}-r1`];
      return {
        payload: { leftIds, rightIds, keyPairs },
        hint: { kind: 'tie-thread', pair: [first[0], first[1]] },
      };
    }
    case 'combination-dial':
      return {
        payload: { kind: 'exact', exactValue: 10 + (n % 50) + 0.5, unit: 'candles' },
        hint: { kind: 'reveal-digit', position: 0 },
      };
  }
}
