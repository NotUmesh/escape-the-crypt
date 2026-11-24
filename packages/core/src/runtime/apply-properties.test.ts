import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { eventArb } from '../test-support/arbitraries';
import { buildManifest } from '../test-support/manifest-fixture';
import { SETTINGS } from '../test-support/run-settings';
import type { Event } from '../types';
import { apply } from './apply';
import { isEvent } from './event-guard';
import { initial } from './initial';
import type { State } from './state-types';

const manifest = buildManifest({ rooms: 2, conceptsPerRoom: 3 });
const unstarted: State = initial(manifest, SETTINGS);
const started: State = { ...unstarted, status: 'in progress', remainingHints: 3 };
const left: State = { ...started, status: 'left' };
const escaped: State = { ...started, status: 'escaped' };

const BEFORE_START = ['RunStarted', 'RoomPublished', 'CryptFinalised', 'CryptShortened'];

/** Anything at all, plus records with unknown kinds and a bad lockType, none a valid Event. */
const malformedArb: fc.Arbitrary<unknown> = fc
  .oneof(
    fc.anything(),
    fc.record({ kind: fc.string() }),
    fc.record({ kind: fc.constant('RunLeft'), lockType: fc.string() }),
  )
  .filter((value) => !isEvent(value));

/** Run apply, assert it never throws, and return the result and the state snapshot check. */
function applyAndCheckNoOp(state: State, event: unknown): ReturnType<typeof apply> {
  const before = JSON.parse(JSON.stringify(state)) as State;
  let result: ReturnType<typeof apply> | undefined;
  expect(() => {
    result = apply(state, event as Event);
  }).not.toThrow();
  expect(state).toEqual(before); // input never mutated
  if (result === undefined) throw new Error('unreachable');
  return result;
}

/** Feature: room-runtime, Property 5: Invalid events are no-ops */
describe('Property 5: Invalid events are no-ops', () => {
  /** **Validates: Requirements 3.1, 3.6, 3.7** */
  it('malformed events are rejected as malformed-event against any state', () => {
    fc.assert(
      fc.property(malformedArb, fc.constantFrom(unstarted, started, left, escaped), (event, state) => {
        const result = applyAndCheckNoOp(state, event);
        expect(result).toEqual({ ok: false, error: { kind: 'malformed-event' } });
      }),
      { numRuns: 100 },
    );
  });

  /** **Validates: Requirements 3.1, 3.6, 3.7** */
  it('generated events against an unstarted run are rejected unless they may precede RunStarted', () => {
    fc.assert(
      fc.property(eventArb, (event) => {
        const result = applyAndCheckNoOp(unstarted, event);
        expect(result.ok).toBe(false);
        if (result.ok) return;
        if (!BEFORE_START.includes(event.kind)) expect(result.error.kind).toBe('run-not-started');
      }),
      { numRuns: 100 },
    );
  });

  /** **Validates: Requirements 3.1, 3.4, 3.5, 3.6** */
  it('generated events against started, left and escaped runs are typed rejections that leave State unchanged', () => {
    fc.assert(
      fc.property(eventArb, (event) => {
        const inProgress = applyAndCheckNoOp(started, event);
        expect(inProgress.ok).toBe(false);
        if (!inProgress.ok && event.kind === 'RunStarted') {
          expect(['manifest-mismatch', 'run-already-started']).toContain(inProgress.error.kind);
        }
        const whileLeft = applyAndCheckNoOp(left, event);
        expect(whileLeft.ok).toBe(false);
        const learner = !['RunStarted', 'RoomPublished', 'CryptFinalised', 'CryptShortened', 'RunResumed'].includes(event.kind);
        if (!whileLeft.ok && learner) expect(whileLeft.error.kind).toBe('run-left');
        expect(applyAndCheckNoOp(escaped, event)).toEqual({ ok: false, error: { kind: 'run-finished' } });
      }),
      { numRuns: 100 },
    );
  });

  /** **Validates: Requirements 3.1, 3.6** */
  it('actions on a settled slot are rejected with lock-already-settled', () => {
    const slotId = manifest.rooms[0]?.lockSlots[0]?.slotId as string;
    const settled: State = {
      ...started,
      currentRoomId: manifest.rooms[0]?.roomId ?? null,
      rooms: started.rooms.map((r, i) =>
        i === 0 ? { ...r, lockSlots: r.lockSlots.map((s, j) => (j === 0 ? { ...s, status: 'settled' as const } : s)) } : r,
      ),
    };
    fc.assert(
      fc.property(
        fc.constantFrom('LockOpened', 'HintUsed', 'Skipped', 'Challenged'),
        (kind) => {
          const result = applyAndCheckNoOp(settled, { kind, slotId });
          expect(result).toEqual({ ok: false, error: { kind: 'lock-already-settled' } });
        },
      ),
      { numRuns: 20 },
    );
  });

  /** **Validates: Requirements 3.1, 9.5** */
  it('slot events outside the current room, or before any RoomEntered, are rejected with lock-not-in-room', () => {
    const room1 = manifest.rooms[0];
    const room2 = manifest.rooms[1];
    const inRoomOne: State = { ...started, currentRoomId: room1?.roomId ?? null };
    const slotIds = (room: typeof room1): string[] => room?.lockSlots.map((s) => s.slotId) ?? [];
    const slotEventArb = (slotId: string): fc.Arbitrary<Event> =>
      fc.constantFrom<Event>(
        { kind: 'LockOpened', slotId },
        { kind: 'HintUsed', slotId },
        { kind: 'AnswerSubmitted', slotId, submission: {} } as unknown as Event,
        { kind: 'Skipped', slotId },
        { kind: 'Challenged', slotId },
      );
    fc.assert(
      fc.property(
        fc.constantFrom(...slotIds(room2)).chain(slotEventArb),
        fc.constantFrom(...slotIds(room1)).chain(slotEventArb),
        (otherRoomEvent, earlyEvent) => {
          expect(applyAndCheckNoOp(inRoomOne, otherRoomEvent)).toEqual({ ok: false, error: { kind: 'lock-not-in-room' } });
          expect(applyAndCheckNoOp(started, earlyEvent)).toEqual({ ok: false, error: { kind: 'lock-not-in-room' } });
        },
      ),
      { numRuns: 50 },
    );
  });
});
