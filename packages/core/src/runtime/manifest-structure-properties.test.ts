import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { buildManifest } from '../test-support/manifest-fixture';
import type { CryptManifest, LockSlotSpec, QuestionSpec } from './manifest-types';
import { parseManifest } from './manifest-schema';

/** Valid manifests over rune-cipher and seance-board only, with at least 2 questions. */
const manifestArb = fc
  .record({
    rooms: fc.integer({ min: 1, max: 5 }),
    conceptsPerRoom: fc.integer({ min: 1, max: 2 }),
    alternates: fc.boolean(),
    finalDoorQuestions: fc.integer({ min: 0, max: 4 }),
    seed: fc.option(fc.integer({ min: 0, max: 10_000 }), { nil: undefined }),
  })
  .map((o) => buildManifest({ ...o, lockTypes: ['rune-cipher', 'seance-board'] }))
  .filter((m) => questionsOf(m).length >= 2);

/** Plain-JSON deep copy (manifests are JSON). */
function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function questionsOf(m: CryptManifest): QuestionSpec[] {
  const out: QuestionSpec[] = [];
  for (const room of m.rooms) {
    for (const slot of room.lockSlots) {
      out.push(slot.primaryQuestion);
      if (slot.alternateQuestion) out.push(slot.alternateQuestion);
    }
  }
  for (const slot of m.finalDoor.slots) out.push(slot.question);
  return out;
}

describe('manifest structural rejections (properties)', () => {
  it('generated base manifests are valid', () => {
    fc.assert(
      fc.property(manifestArb, (m) => {
        expect(questionsOf(m).length).toBeGreaterThanOrEqual(2);
        expect(parseManifest(m).ok).toBe(true);
      }),
    );
  });

  // Feature: generation-and-evaluation, Property 3: Manifest_Schema rejects duplicate question IDs
  // **Validates: Requirements 2.6**
  it('Property 3: rejects a manifest where two questions share a questionId', () => {
    fc.assert(
      fc.property(manifestArb, fc.nat(), fc.nat(), (m, a, b) => {
        const copy: CryptManifest = clone(m);
        const qs = questionsOf(copy);
        const i = a % qs.length;
        const j = (i + 1 + (b % (qs.length - 1))) % qs.length;
        const target = qs[j] as { questionId: string };
        target.questionId = (qs[i] as QuestionSpec).questionId;
        const result = parseManifest(copy);
        expect(result.ok).toBe(false);
      }),
    );
  });

  // Feature: generation-and-evaluation, Property 4: Manifest_Schema rejects a second slot of the same Lock_Type in one room
  // **Validates: Requirements 2.7**
  it('Property 4: rejects a room with a second slot of a Lock_Type already in it', () => {
    fc.assert(
      fc.property(manifestArb, fc.nat(), fc.nat(), (m, r, s) => {
        const copy: CryptManifest = clone(m);
        const room = copy.rooms[r % copy.rooms.length];
        if (!room) throw new Error('fixture');
        const source = room.lockSlots[s % room.lockSlots.length];
        if (!source) throw new Error('fixture');
        const extra: LockSlotSpec = {
          ...clone(source),
          slotId: 'extra-slot',
          primaryQuestion: { ...clone(source.primaryQuestion), questionId: 'extra-question' },
          alternateQuestion: null,
        };
        (room.lockSlots as LockSlotSpec[]).push(extra);
        const result = parseManifest(copy);
        expect(result.ok).toBe(false);
      }),
    );
  });
});
