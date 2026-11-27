import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { buildManifest } from '../test-support/manifest-fixture';
import { buildPayload } from '../test-support/question-payloads';
import { LOCK_TYPES } from '../types';
import type { HintEffectSpec, LockType } from '../types';
import { CryptManifestSchema, QuestionSpecSchema } from './manifest-schema';
import type { QuestionSpec } from './manifest-types';

// Feature: manifest-schema, Property 28: The Manifest_Schema validates every six-Lock_Type
// payload and hint shape, and rejects every mismatch.

const lockTypeArb = fc.constantFrom<LockType>(...LOCK_TYPES);
const seedArb = fc.integer({ min: 1, max: 500 });

function question(lockType: LockType, n: number, hint: boolean): QuestionSpec {
  const id = `q${n}`;
  const built = buildPayload(lockType, id, n);
  return {
    questionId: id,
    lockType,
    payload: built.payload,
    evidenceRefs: ['chk_1'],
    hintEffect: hint ? built.hint : null,
  };
}

/** A hint that names things the payload does not contain, or the wrong kind, per type. */
function badHints(lockType: LockType): HintEffectSpec[] {
  const wrongKind: HintEffectSpec = { kind: 'reveal-digit', position: 0 };
  switch (lockType) {
    case 'rune-cipher':
      return [{ kind: 'remove-option', optionId: 'nope' }, { kind: 'lock-first-bone', boneId: 'nope' }];
    case 'seance-board':
    case 'cursed-object':
      return [{ kind: 'remove-option', optionId: 'not-an-option' }, wrongKind];
    case 'bone-ordering':
      return [{ kind: 'lock-first-bone', boneId: 'not-a-bone' }, wrongKind];
    case 'bound-threads':
      return [{ kind: 'tie-thread', pair: ['x-left', 'x-right'] }, wrongKind];
    case 'combination-dial':
      return [
        { kind: 'reveal-digit', position: 0 },
        { kind: 'reveal-first-letter', firstLetter: 'a', length: 1 },
        { kind: 'remove-option', optionId: 'nope' },
      ];
  }
}

describe('Manifest_Schema over all six Lock_Types', () => {
  it('round-trips a manifest holding every Lock_Type through JSON', () => {
    const manifest = buildManifest({
      rooms: 2,
      conceptsPerRoom: 6,
      finalDoorQuestions: 4,
      hintEffects: true,
    });
    const all = [
      ...manifest.rooms.flatMap((r) =>
        r.lockSlots.flatMap((s) => [s.primaryQuestion, s.alternateQuestion]),
      ),
      ...manifest.finalDoor.slots.map((s) => s.question),
    ];
    const seen = new Set(all.filter((q) => q !== null).map((q) => q.lockType));
    expect([...seen].sort()).toEqual([...LOCK_TYPES].sort());

    const parsed = CryptManifestSchema.safeParse(JSON.parse(JSON.stringify(manifest)));
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data).toEqual(manifest);
  });

  it('accepts buildManifest({ hintEffects: true }) over all six types, dial hints null', () => {
    const manifest = buildManifest({ rooms: 2, conceptsPerRoom: 6, finalDoorQuestions: 4, hintEffects: true });
    expect(CryptManifestSchema.safeParse(manifest).success).toBe(true);
    const all = [
      ...manifest.rooms.flatMap((r) => r.lockSlots.flatMap((s) => [s.primaryQuestion, s.alternateQuestion])),
      ...manifest.finalDoor.slots.map((s) => s.question),
    ].filter((q) => q !== null);
    const dials = all.filter((q) => q.lockType === 'combination-dial');
    expect(dials.length).toBeGreaterThan(0);
    expect(dials.every((q) => q.hintEffect === null)).toBe(true);
  });

  it('accepts a range dial payload and the matching hint-free question', () => {
    const q: QuestionSpec = {
      questionId: 'r1',
      lockType: 'combination-dial',
      payload: { kind: 'range', min: 1, max: 4, unit: 'moons' },
      evidenceRefs: ['chk_1'],
      hintEffect: null,
    };
    expect(QuestionSpecSchema.safeParse(q).success).toBe(true);
  });

  it('Property 28: every seeded six-type manifest round-trips', () => {
    fc.assert(
      fc.property(seedArb, (seed) => {
        const manifest = buildManifest({
          seed,
          rooms: 3,
          conceptsPerRoom: 6,
          finalDoorQuestions: 4,
        });
        const parsed = CryptManifestSchema.safeParse(JSON.parse(JSON.stringify(manifest)));
        return parsed.success && JSON.stringify(parsed.data) === JSON.stringify(manifest);
      }),
      { numRuns: 50 },
    );
  });

  it('Property 28: accepts each type with its own payload and hint', () => {
    fc.assert(
      fc.property(lockTypeArb, fc.integer({ min: 1, max: 200 }), (type, n) => {
        return QuestionSpecSchema.safeParse(question(type, n, true)).success;
      }),
      { numRuns: 100 },
    );
  });

  it('Property 28: rejects a payload that belongs to another Lock_Type', () => {
    fc.assert(
      fc.property(lockTypeArb, lockTypeArb, fc.integer({ min: 1, max: 200 }), (type, other, n) => {
        fc.pre(type !== other);
        const q = { ...question(type, n, false), payload: buildPayload(other, `q${n}`, n).payload };
        return !QuestionSpecSchema.safeParse(q).success;
      }),
      { numRuns: 150 },
    );
  });

  it('Property 28: rejects a payload with any one field missing', () => {
    fc.assert(
      fc.property(lockTypeArb, fc.integer({ min: 1, max: 200 }), (type, n) => {
        const base = question(type, n, false);
        const payload = base.payload as Record<string, unknown>;
        return Object.keys(payload).every((key) => {
          const rest = Object.fromEntries(Object.entries(payload).filter(([k]) => k !== key));
          return !QuestionSpecSchema.safeParse({ ...base, payload: rest }).success;
        });
      }),
      { numRuns: 100 },
    );
  });

  it('Property 28: rejects a hint that does not reference its payload', () => {
    fc.assert(
      fc.property(lockTypeArb, fc.integer({ min: 1, max: 200 }), (type, n) => {
        const base = question(type, n, false);
        return badHints(type).every(
          (hint) => !QuestionSpecSchema.safeParse({ ...base, hintEffect: hint }).success,
        );
      }),
      { numRuns: 100 },
    );
  });

  it('rejects any non-null hint on a combination dial and accepts null', () => {
    const dial = question('combination-dial', 3, false);
    expect(QuestionSpecSchema.safeParse(dial).success).toBe(true);
    for (const hint of badHints('combination-dial')) {
      expect(QuestionSpecSchema.safeParse({ ...dial, hintEffect: hint }).success).toBe(false);
    }
  });

  it('rejects a bad question when it sits inside a whole manifest', () => {
    const manifest = buildManifest({ rooms: 1, conceptsPerRoom: 6, finalDoorQuestions: 0 });
    const copy = JSON.parse(JSON.stringify(manifest)) as {
      rooms: { lockSlots: { primaryQuestion: { payload: Record<string, unknown> } }[] }[];
    };
    const slot = copy.rooms[0]?.lockSlots[0];
    if (slot === undefined) throw new Error('fixture has no slot');
    slot.primaryQuestion.payload = {};
    expect(CryptManifestSchema.safeParse(copy).success).toBe(false);
  });
});
