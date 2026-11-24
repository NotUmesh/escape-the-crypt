import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { manifestArb } from '../test-support/arbitraries';
import { buildManifest } from '../test-support/manifest-fixture';
import type { CryptManifest, LockSlotSpec, QuestionSpec, RoomSpec } from './manifest-types';
import { manifestCheck } from './manifest-check';

/** Replace a question's fields. */
function withQuestion(q: QuestionSpec, patch: Partial<QuestionSpec>): QuestionSpec {
  return { ...q, ...patch };
}

function mapSlot(
  m: CryptManifest,
  roomIdx: number,
  slotIdx: number,
  fn: (s: LockSlotSpec) => LockSlotSpec,
): CryptManifest {
  const rooms: RoomSpec[] = m.rooms.map((r, i) =>
    i !== roomIdx ? r : { ...r, lockSlots: r.lockSlots.map((s, j) => (j === slotIdx ? fn(s) : s)) },
  );
  return { ...m, rooms };
}

const base = (): CryptManifest => buildManifest({ rooms: 2, conceptsPerRoom: 3 });

/** Manifest with a second slot in room 1 that repeats the first slot's Station_Type. */
function withRepeatedStation(m: CryptManifest): CryptManifest {
  const first = m.rooms[0]?.lockSlots[0] as LockSlotSpec;
  const rooms = m.rooms.map((r, i) =>
    i === 0 ? { ...r, lockSlots: [...r.lockSlots, { ...first, slotId: 'dup-slot' }] } : r,
  );
  return { ...m, rooms };
}

describe('manifestCheck', () => {
  it('accepts a built manifest', () => {
    expect(manifestCheck(base())).toEqual({ ok: true });
  });

  it('accepts an empty room list', () => {
    expect(manifestCheck({ ...base(), rooms: [] })).toEqual({ ok: true });
  });

  it('rejects a repeated Station_Type with the exact error shape', () => {
    const m = withRepeatedStation(base());
    const stationType = m.rooms[0]?.lockSlots[0]?.stationType;
    expect(manifestCheck(m)).toEqual({
      ok: false,
      error: { kind: 'invalid-manifest', room: 'room-1', lockType: stationType },
    });
  });

  it('reports the first room and first repeated type', () => {
    let m = withRepeatedStation(base());
    const second = m.rooms[1]?.lockSlots[0] as LockSlotSpec;
    m = { ...m, rooms: m.rooms.map((r, i) => (i === 1 ? { ...r, lockSlots: [...r.lockSlots, second] } : r)) };
    const result = manifestCheck(m);
    expect(result.ok === false && 'room' in result.error ? result.error.room : null).toBe('room-1');
  });

  it('allows the final door to repeat lock types', () => {
    const m = buildManifest({ finalDoorQuestions: 4, lockTypes: ['rune-cipher', 'seance-board'] });
    const types = m.finalDoor.slots.map((s) => s.question.lockType);
    expect(new Set(types).size).toBeLessThan(types.length);
    expect(manifestCheck(m).ok).toBe(true);
  });

  it('rejects a lock type outside LockType, on a station, a question and a reserved question', () => {
    const bad = 'wax-seal' as unknown as QuestionSpec['lockType'];
    const m = base();
    const onStation = mapSlot(m, 0, 0, (s) => ({ ...s, stationType: bad }));
    const onAlternate = mapSlot(m, 0, 0, (s) => ({
      ...s,
      alternateQuestion: withQuestion(s.alternateQuestion as QuestionSpec, { lockType: bad }),
    }));
    const onReserved: CryptManifest = {
      ...m,
      finalDoor: {
        slots: m.finalDoor.slots.map((s, i) =>
          i === 0 ? { ...s, question: withQuestion(s.question, { lockType: bad }) } : s,
        ),
      },
    };
    for (const candidate of [onStation, onAlternate, onReserved]) {
      expect(manifestCheck(candidate)).toEqual({
        ok: false,
        error: { kind: 'invalid-manifest', lockType: 'wax-seal' },
      });
    }
  });

  it('never throws on malformed input', () => {
    for (const junk of [null, undefined, 5, 'x', [], {}, { rooms: 'a' }, { rooms: [null], finalDoor: {} }]) {
      const result = manifestCheck(junk as unknown as CryptManifest);
      expect(result.ok).toBe(false);
    }
  });

  describe('question IDs', () => {
    it.each(['', undefined] as const)('rejects a primary question with id %j', (id) => {
      const m = mapSlot(base(), 0, 1, (s) => ({
        ...s,
        primaryQuestion: withQuestion(s.primaryQuestion, { questionId: id as unknown as string }),
      }));
      expect(manifestCheck(m)).toEqual({
        ok: false,
        error: { kind: 'invalid-manifest', questionId: '', slotId: 'room-1-slot-2' },
      });
    });

    it('rejects an Alternate with an empty id', () => {
      const m = mapSlot(base(), 1, 0, (s) => ({
        ...s,
        alternateQuestion: withQuestion(s.alternateQuestion as QuestionSpec, { questionId: '' }),
      }));
      expect(manifestCheck(m)).toEqual({
        ok: false,
        error: { kind: 'invalid-manifest', questionId: '', slotId: 'room-2-slot-1' },
      });
    });

    it('rejects a reserved final-door question with an empty id', () => {
      const m = base();
      const bad: CryptManifest = {
        ...m,
        finalDoor: {
          slots: m.finalDoor.slots.map((s, i) =>
            i === 1 ? { ...s, question: withQuestion(s.question, { questionId: '' }) } : s,
          ),
        },
      };
      expect(manifestCheck(bad)).toEqual({
        ok: false,
        error: { kind: 'invalid-manifest', questionId: '', slotId: 'final-door-slot-2' },
      });
    });

    it('rejects an id shared by a primary and an Alternate', () => {
      const m = mapSlot(base(), 0, 0, (s) => ({
        ...s,
        alternateQuestion: withQuestion(s.alternateQuestion as QuestionSpec, {
          questionId: s.primaryQuestion.questionId,
        }),
      }));
      expect(manifestCheck(m)).toEqual({
        ok: false,
        error: { kind: 'invalid-manifest', questionId: 'q1' },
      });
    });

    it('rejects an id shared across two rooms, naming the second sighting', () => {
      const first = base().rooms[0]?.lockSlots[0]?.primaryQuestion.questionId as string;
      const m = mapSlot(base(), 1, 0, (s) => ({
        ...s,
        primaryQuestion: withQuestion(s.primaryQuestion, { questionId: first }),
      }));
      expect(manifestCheck(m)).toEqual({
        ok: false,
        error: { kind: 'invalid-manifest', questionId: first },
      });
    });

    it('rejects an id shared by a room question and a reserved question', () => {
      const m = base();
      const roomId = m.rooms[0]?.lockSlots[0]?.primaryQuestion.questionId as string;
      const bad: CryptManifest = {
        ...m,
        finalDoor: {
          slots: m.finalDoor.slots.map((s, i) =>
            i === 0 ? { ...s, question: withQuestion(s.question, { questionId: roomId }) } : s,
          ),
        },
      };
      expect(manifestCheck(bad)).toEqual({
        ok: false,
        error: { kind: 'invalid-manifest', questionId: roomId },
      });
    });

    it('reports a repeated Station_Type before a duplicate id', () => {
      let m = withRepeatedStation(base());
      m = mapSlot(m, 1, 0, (s) => ({
        ...s,
        primaryQuestion: withQuestion(s.primaryQuestion, { questionId: 'q1' }),
      }));
      const result = manifestCheck(m);
      expect(result.ok).toBe(false);
      expect(result.ok === false && 'room' in result.error).toBe(true);
    });
  });
});

describe('Property 13: One lock per type per room, unique question IDs', () => {
  const allQuestions = (m: CryptManifest): QuestionSpec[] => [
    ...m.rooms.flatMap((r) =>
      r.lockSlots.flatMap((s) => (s.alternateQuestion ? [s.primaryQuestion, s.alternateQuestion] : [s.primaryQuestion])),
    ),
    ...m.finalDoor.slots.map((s) => s.question),
  ];

  /** **Validates: Requirements 25.12, 25.13, 28.1, 28.3, 28.8, 28.9, 28.10** */
  it('accepted manifests hold one slot per type per room and unique non-empty ids', () => {
    fc.assert(
      fc.property(manifestArb, (m) => {
        expect(manifestCheck(m).ok).toBe(true);
        for (const room of m.rooms) {
          const types = room.lockSlots.map((s) => s.stationType);
          expect(new Set(types).size).toBe(types.length);
        }
        const ids = allQuestions(m).map((q) => q.questionId);
        expect(ids.every((id) => id.length > 0)).toBe(true);
        expect(new Set(ids).size).toBe(ids.length);
      }),
      { numRuns: 100 },
    );
  });

  /** **Validates: Requirements 28.3, 28.10** */
  it('rejects a repeated Station_Type naming the room and type, even when an id is also duplicated', () => {
    fc.assert(
      fc.property(manifestArb, fc.boolean(), (m, alsoDuplicateId) => {
        const roomIdx = m.rooms.findIndex((r) => r.lockSlots.length > 0);
        fc.pre(roomIdx >= 0);
        const room = m.rooms[roomIdx] as RoomSpec;
        const first = room.lockSlots[0] as LockSlotSpec;
        const copy: LockSlotSpec = alsoDuplicateId
          ? { ...first, slotId: 'dup' }
          : {
              ...first,
              slotId: 'dup',
              primaryQuestion: withQuestion(first.primaryQuestion, { questionId: 'fresh-p' }),
              alternateQuestion: first.alternateQuestion
                ? withQuestion(first.alternateQuestion, { questionId: 'fresh-a' })
                : null,
            };
        const bad: CryptManifest = {
          ...m,
          rooms: m.rooms.map((r, i) => (i === roomIdx ? { ...r, lockSlots: [...r.lockSlots, copy] } : r)),
        };
        expect(manifestCheck(bad)).toEqual({
          ok: false,
          error: { kind: 'invalid-manifest', room: room.roomId, lockType: first.stationType },
        });
      }),
      { numRuns: 100 },
    );
  });

  /** **Validates: Requirements 28.8, 28.9** */
  it('rejects a missing or duplicated questionId with invalid-manifest carrying it', () => {
    fc.assert(
      fc.property(manifestArb, fc.nat(), fc.nat(), (m, a, b) => {
        const ids = allQuestions(m).map((q) => q.questionId);
        const i = a % ids.length;
        const j = b % ids.length;
        const rewrite = (fn: (q: QuestionSpec, index: number) => QuestionSpec): CryptManifest => {
          let n = 0;
          const next = (q: QuestionSpec): QuestionSpec => fn(q, n++);
          return {
            ...m,
            rooms: m.rooms.map((r) => ({
              ...r,
              lockSlots: r.lockSlots.map((s) => ({
                ...s,
                primaryQuestion: next(s.primaryQuestion),
                alternateQuestion: s.alternateQuestion ? next(s.alternateQuestion) : null,
              })),
            })),
            finalDoor: { slots: m.finalDoor.slots.map((s) => ({ ...s, question: next(s.question) })) },
          };
        };
        const missing = rewrite((q, k) => (k === i ? { ...q, questionId: '' } : q));
        const missingResult = manifestCheck(missing);
        expect(missingResult.ok === false && 'questionId' in missingResult.error).toBe(true);
        expect(missingResult.ok === false && 'questionId' in missingResult.error ? missingResult.error.questionId : null).toBe('');

        fc.pre(i !== j);
        const lo = Math.min(i, j);
        const hi = Math.max(i, j);
        const dup = rewrite((q, k) => (k === hi ? { ...q, questionId: ids[lo] as string } : q));
        expect(manifestCheck(dup)).toEqual({
          ok: false,
          error: { kind: 'invalid-manifest', questionId: ids[lo] },
        });
      }),
      { numRuns: 100 },
    );
  });
});
