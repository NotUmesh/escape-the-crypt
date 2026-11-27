import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { manifestCheck } from '../runtime/manifest-check';
import type { CryptManifest, QuestionSpec } from '../runtime/manifest-types';
import { LOCK_TYPES } from '../types';
import { manifestArb } from './arbitraries';
import { buildManifest } from './manifest-fixture';

function allQuestions(m: CryptManifest): QuestionSpec[] {
  return [
    ...m.rooms.flatMap((r) =>
      r.lockSlots.flatMap((s) =>
        s.alternateQuestion ? [s.primaryQuestion, s.alternateQuestion] : [s.primaryQuestion],
      ),
    ),
    ...m.finalDoor.slots.map((s) => s.question),
  ];
}

function expectUniqueIds(m: CryptManifest): void {
  const ids = allQuestions(m).map((q) => q.questionId);
  expect(ids.every((id) => id !== '')).toBe(true);
  expect(new Set(ids).size).toBe(ids.length);
}

describe('buildManifest', () => {
  it('builds manifests that pass the manifest check, for a spread of options', () => {
    for (const rooms of [1, 3, 5]) {
      for (const conceptsPerRoom of [1, 4, 6]) {
        for (const alternates of [true, false]) {
          for (const hintEffects of [true, false]) {
            const m = buildManifest({ rooms, conceptsPerRoom, alternates, hintEffects });
            expect(manifestCheck(m).ok).toBe(true);
            expectUniqueIds(m);
            expect(m.rooms).toHaveLength(rooms);
          }
        }
      }
    }
  });

  it('is deterministic with and without a seed', () => {
    expect(buildManifest({ rooms: 3 })).toEqual(buildManifest({ rooms: 3 }));
    expect(buildManifest({ rooms: 3, seed: 7 })).toEqual(buildManifest({ rooms: 3, seed: 7 }));
  });

  it('gives each room distinct primary types, and Alternates that differ from the primary', () => {
    const m = buildManifest({ rooms: 5, conceptsPerRoom: 6, seed: 3 });
    for (const room of m.rooms) {
      const types = room.lockSlots.map((s) => s.primaryQuestion.lockType);
      expect(new Set(types).size).toBe(types.length);
      for (const slot of room.lockSlots) {
        expect(slot.primaryQuestion.lockType).toBe(slot.stationType);
        expect(slot.alternateQuestion).not.toBeNull();
        expect(slot.alternateQuestion?.lockType).not.toBe(slot.stationType);
      }
    }
  });

  it('builds 0 to 4 full reserved final-door slots', () => {
    for (const n of [0, 1, 2, 3, 4, 9]) {
      const m = buildManifest({ finalDoorQuestions: n });
      expect(m.finalDoor.slots.length).toBe(Math.min(4, Math.max(0, n)));
      expect(manifestCheck(m).ok).toBe(true);
      for (const s of m.finalDoor.slots) {
        expect(s.slotId).not.toBe('');
        expect(s.conceptId).not.toBe('');
        expect(s.question.evidenceRefs.length).toBeGreaterThan(0);
      }
    }
  });

  it('caps concepts per room at the lockTypes length and uses only listed types', () => {
    const m = buildManifest({ conceptsPerRoom: 6, lockTypes: ['rune-cipher', 'seance-board'] });
    for (const room of m.rooms) expect(room.lockSlots).toHaveLength(2);
    for (const q of allQuestions(m)) {
      expect(['rune-cipher', 'seance-board']).toContain(q.lockType);
    }
    expect(manifestCheck(m).ok).toBe(true);
  });

  it('builds no Alternates with a single lock type', () => {
    const m = buildManifest({ lockTypes: ['bone-ordering'], conceptsPerRoom: 4 });
    for (const room of m.rooms) {
      expect(room.lockSlots).toHaveLength(1);
      expect(room.lockSlots.every((s) => s.alternateQuestion === null)).toBe(true);
    }
    expectUniqueIds(m);
  });

  it('puts a hint effect on a question only when asked', () => {
    const none = buildManifest({ hintEffects: false });
    expect(allQuestions(none).every((q) => q.hintEffect === null)).toBe(true);
    const all = buildManifest({ hintEffects: true, conceptsPerRoom: 6 });
    // The dial accepts no hint, so its hintEffect stays null; every other type is hinted.
    expect(
      allQuestions(all).every((q) => (q.lockType === 'combination-dial' ? q.hintEffect === null : q.hintEffect !== null)),
    ).toBe(true);
  });

  it('gives rune ciphers a reveal-first-letter hint derived from the answer, and the check accepts it', () => {
    const m = buildManifest({ hintEffects: true, conceptsPerRoom: 6, lockTypes: ['rune-cipher', 'seance-board'] });
    const runes = allQuestions(m).filter((q) => q.lockType === 'rune-cipher');
    expect(runes.length).toBeGreaterThan(0);
    for (const q of runes) {
      const answer = (q.payload as { answer: string }).answer;
      const points = Array.from(answer);
      expect(q.hintEffect).toEqual({
        kind: 'reveal-first-letter',
        firstLetter: points[0],
        length: points.length,
      });
    }
    expect(manifestCheck(m).ok).toBe(true);
  });

  it('produces plain JSON', () => {
    const m = buildManifest({ hintEffects: true, conceptsPerRoom: 6 });
    expect(JSON.parse(JSON.stringify(m))).toEqual(m);
  });
});

describe('manifestArb', () => {
  it('generates manifests that pass the check, with unique question IDs and all six types in use', () => {
    const seen = new Set<string>();
    let largeRoom = false;
    fc.assert(
      fc.property(manifestArb, (m) => {
        expect(manifestCheck(m).ok).toBe(true);
        expectUniqueIds(m);
        for (const q of allQuestions(m)) seen.add(q.lockType);
        if (m.rooms.some((r) => r.lockSlots.length >= 4)) largeRoom = true;
        expect(JSON.parse(JSON.stringify(m))).toEqual(m);
      }),
      { numRuns: 100 },
    );
    expect([...seen].sort()).toEqual([...LOCK_TYPES].sort());
    expect(largeRoom).toBe(true);
  });
});
