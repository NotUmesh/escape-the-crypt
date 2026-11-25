import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { buildManifest } from '../test-support/manifest-fixture';
import type { HintEffectSpec, LockType } from '../types';
import type { CryptManifest, QuestionSpec } from './manifest-types';
import { parseManifest } from './manifest-schema';

// Feature: generation-and-evaluation, Property 13: Manifest_Schema narrows hints per lock type
// **Validates: Requirements 2.4, 2.14, 2.15, 2.16, 2.17**

const TYPES: readonly LockType[] = ['rune-cipher', 'seance-board'];

/** Every question in the manifest, in a stable order. */
function questionsOf(manifest: CryptManifest): QuestionSpec[] {
  const out: QuestionSpec[] = [];
  for (const room of manifest.rooms) {
    for (const slot of room.lockSlots) {
      out.push(slot.primaryQuestion);
      if (slot.alternateQuestion !== null) out.push(slot.alternateQuestion);
    }
  }
  for (const slot of manifest.finalDoor.slots) out.push(slot.question);
  return out;
}

interface Target {
  readonly manifest: CryptManifest;
  readonly question: QuestionSpec;
}

/** Fresh manifest (rune cipher and séance board only) with one chosen question of the wanted type. */
function targetArb(lockType: LockType): fc.Arbitrary<Target> {
  return fc
    .record({
      rooms: fc.integer({ min: 1, max: 3 }),
      alternates: fc.boolean(),
      finalDoorQuestions: fc.integer({ min: 0, max: 4 }),
      pick: fc.nat(),
    })
    .map(({ rooms, alternates, finalDoorQuestions, pick }) => {
      const manifest = JSON.parse(
        JSON.stringify(buildManifest({ rooms, alternates, finalDoorQuestions, lockTypes: TYPES })),
      ) as CryptManifest;
      const matching = questionsOf(manifest).filter((q) => q.lockType === lockType);
      return { manifest, question: matching[pick % matching.length] as QuestionSpec };
    });
}

function withHint(target: Target, hint: HintEffectSpec | null): unknown {
  (target.question as { hintEffect: HintEffectSpec | null }).hintEffect = hint;
  return JSON.parse(JSON.stringify(target.manifest)) as unknown;
}

const letter = fc.string({ minLength: 1, maxLength: 1 });
const posInt = fc.integer({ min: 1, max: 100 });

const runeValid: fc.Arbitrary<HintEffectSpec | null> = fc.oneof(
  fc.constant(null),
  fc.record({
    kind: fc.constant('reveal-first-letter' as const),
    firstLetter: letter,
    length: posInt,
  }),
);

const runeInvalid: fc.Arbitrary<HintEffectSpec> = fc.oneof(
  fc.string().map((optionId) => ({ kind: 'remove-option' as const, optionId })),
  fc.string().map((boneId) => ({ kind: 'lock-first-bone' as const, boneId })),
  fc.nat(9).map((position) => ({ kind: 'reveal-digit' as const, position })),
  fc.tuple(fc.string(), fc.string()).map((pair) => ({ kind: 'tie-thread' as const, pair })),
  // Right kind, wrong shape: firstLetter not one character, length not positive.
  fc
    .record({
      firstLetter: fc.oneof(fc.constant(''), fc.string({ minLength: 2, maxLength: 5 })),
      length: posInt,
    })
    .map((v) => ({ kind: 'reveal-first-letter' as const, ...v })),
  fc
    .record({ firstLetter: letter, length: fc.integer({ min: -100, max: 0 }) })
    .map((v) => ({ kind: 'reveal-first-letter' as const, ...v })),
);

function payloadIds(question: QuestionSpec): { optionIds: string[]; keyOptionId: string } {
  return question.payload as { optionIds: string[]; keyOptionId: string };
}

describe('Property 13: Manifest_Schema narrows hints per lock type', () => {
  it('rune cipher accepts reveal-first-letter (1 char, positive length) or null', () => {
    fc.assert(
      fc.property(targetArb('rune-cipher'), runeValid, (target, hint) => {
        expect(parseManifest(withHint(target, hint)).ok).toBe(true);
      }),
    );
  });

  it('rune cipher rejects every other hint kind and malformed reveal-first-letter', () => {
    fc.assert(
      fc.property(targetArb('rune-cipher'), runeInvalid, (target, hint) => {
        expect(parseManifest(withHint(target, hint)).ok).toBe(false);
      }),
    );
  });

  it('séance board accepts null or remove-option of a non-key listed option', () => {
    fc.assert(
      fc.property(targetArb('seance-board'), fc.nat(), (target, n) => {
        const { optionIds, keyOptionId } = payloadIds(target.question);
        const removable = optionIds.filter((id) => id !== keyOptionId);
        const hint: HintEffectSpec | null =
          n % (removable.length + 1) === removable.length
            ? null
            : { kind: 'remove-option', optionId: removable[n % (removable.length + 1)] as string };
        expect(parseManifest(withHint(target, hint)).ok).toBe(true);
      }),
    );
  });

  it('séance board rejects reveal-first-letter, unknown option ids and the key id', () => {
    const invalid = (question: QuestionSpec): fc.Arbitrary<HintEffectSpec> => {
      const { optionIds, keyOptionId } = payloadIds(question);
      return fc.oneof(
        fc.record({
          kind: fc.constant('reveal-first-letter' as const),
          firstLetter: letter,
          length: posInt,
        }),
        fc
          .string()
          .filter((id) => !optionIds.includes(id))
          .map((optionId) => ({ kind: 'remove-option' as const, optionId })),
        fc.constant({ kind: 'remove-option' as const, optionId: keyOptionId }),
      );
    };
    fc.assert(
      fc.property(
        targetArb('seance-board').chain((target) =>
          invalid(target.question).map((hint) => ({ target, hint })),
        ),
        ({ target, hint }) => {
          expect(parseManifest(withHint(target, hint)).ok).toBe(false);
        },
      ),
    );
  });
});
