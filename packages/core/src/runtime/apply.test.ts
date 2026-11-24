import { describe, expect, it } from 'vitest';
import { buildManifest } from '../test-support/manifest-fixture';
import type { Event } from '../types';
import { apply } from './apply';
import { initial } from './initial';
import { SETTINGS } from '../test-support/run-settings';
import type { State } from './state-types';

const manifest = buildManifest({ rooms: 2, conceptsPerRoom: 3 });
const fresh = (): State => initial(manifest, SETTINGS);
const started = (): State => ({ ...fresh(), status: 'in progress', remainingHints: 3 });
const inRoomOne = (): State => ({ ...started(), currentRoomId: manifest.rooms[0]?.roomId ?? null });
const firstSlotId = manifest.rooms[0]?.lockSlots[0]?.slotId as string;

function kindOf(state: State, event: unknown): string | null {
  const result = apply(state, event as Event);
  return result.ok ? null : result.error.kind;
}

describe('apply guards', () => {
  it('rejects malformed events', () => {
    for (const bad of [null, 5, 'x', [], {}, { kind: 'Nope' }, { kind: 'RoomEntered' }, { kind: 'RoomEntered', roomId: 4 },
      { kind: 'AnswerSubmitted', slotId: 's' }, { kind: 'CryptFinalised', finalRoomCount: -1 },
      { kind: 'CryptShortened', finalRoomCount: 1.5 }, { kind: 'RunLeft', lockType: 'wax-seal' }]) {
      expect(kindOf(started(), bad)).toBe('malformed-event');
    }
  });

  it('rejects most events before RunStarted with run-not-started', () => {
    for (const event of [
      { kind: 'RoomEntered', roomId: 'room-1' },
      { kind: 'LockOpened', slotId: firstSlotId },
      { kind: 'FinalDoorEntered' },
      { kind: 'RunLeft' },
      { kind: 'RunResumed' },
    ]) {
      expect(kindOf(fresh(), event)).toBe('run-not-started');
    }
  });

  it('lets RoomPublished, CryptFinalised and CryptShortened past the not-started guard', () => {
    for (const event of [
      { kind: 'RoomPublished', roomId: 'room-1' },
      { kind: 'CryptFinalised', finalRoomCount: 2 },
      { kind: 'CryptShortened', finalRoomCount: 2 },
    ]) {
      expect(kindOf(fresh(), event)).not.toBe('run-not-started');
    }
  });

  it('rejects everything after escape with run-finished', () => {
    const done: State = { ...started(), status: 'escaped' };
    for (const event of [{ kind: 'RunResumed' }, { kind: 'RunLeft' }, { kind: 'RunStarted', manifestId: 'x' }]) {
      expect(kindOf(done, event)).toBe('run-finished');
    }
  });

  it('rejects learner events while left, except RunResumed', () => {
    const left: State = { ...started(), status: 'left' };
    expect(kindOf(left, { kind: 'LockOpened', slotId: firstSlotId })).toBe('run-left');
    expect(kindOf(left, { kind: 'RunResumed' })).not.toBe('run-left');
  });

  it('rejects unknown rooms and slots with unknown-reference', () => {
    expect(kindOf(started(), { kind: 'RoomEntered', roomId: 'nowhere' })).toBe('unknown-reference');
    expect(kindOf(started(), { kind: 'RoomPublished', roomId: 'nowhere' })).toBe('unknown-reference');
    for (const kind of ['LockOpened', 'HintUsed', 'Skipped', 'Challenged', 'EvidenceContinued']) {
      expect(kindOf(started(), { kind, slotId: 'nowhere' })).toBe('unknown-reference');
    }
  });

  it('rejects an action on a solved or settled slot with lock-already-settled', () => {
    const base = inRoomOne();
    for (const status of ['solved', 'settled', 'challenged'] as const) {
      const state: State = {
        ...base,
        rooms: base.rooms.map((r, i) =>
          i === 0 ? { ...r, lockSlots: r.lockSlots.map((s, j) => (j === 0 ? { ...s, status } : s)) } : r,
        ),
      };
      for (const kind of ['LockOpened', 'HintUsed', 'Skipped', 'Challenged']) {
        expect(kindOf(state, { kind, slotId: firstSlotId })).toBe('lock-already-settled');
      }
      expect(kindOf(state, { kind: 'AnswerSubmitted', slotId: firstSlotId, submission: {} })).toBe('lock-already-settled');
      // EvidenceContinued does not need an open slot.
      expect(kindOf(state, { kind: 'EvidenceContinued', slotId: firstSlotId })).not.toBe('lock-already-settled');
    }
  });

  describe('lock-not-in-room', () => {
    const otherRoomSlotId = manifest.rooms[1]?.lockSlots[0]?.slotId as string;
    const actions = (slotId: string): readonly unknown[] => [
      { kind: 'LockOpened', slotId },
      { kind: 'HintUsed', slotId },
      { kind: 'AnswerSubmitted', slotId, submission: {} },
      { kind: 'Skipped', slotId },
      { kind: 'Challenged', slotId },
    ];

    it.each(actions(otherRoomSlotId))('rejects %j for a slot in another room, State unchanged', (event) => {
      const state = inRoomOne();
      const before = JSON.stringify(state);
      expect(apply(state, event as Event)).toEqual({ ok: false, error: { kind: 'lock-not-in-room' } });
      expect(JSON.stringify(state)).toBe(before);
    });

    it.each(actions(firstSlotId))('rejects %j before any RoomEntered, State unchanged', (event) => {
      const state = started();
      const before = JSON.stringify(state);
      expect(apply(state, event as Event)).toEqual({ ok: false, error: { kind: 'lock-not-in-room' } });
      expect(JSON.stringify(state)).toBe(before);
    });

    it('checks the room before the settled status', () => {
      const base = inRoomOne();
      const state: State = {
        ...base,
        rooms: base.rooms.map((r, i) =>
          i === 1 ? { ...r, lockSlots: r.lockSlots.map((s, j) => (j === 0 ? { ...s, status: 'settled' as const } : s)) } : r,
        ),
      };
      expect(kindOf(state, { kind: 'LockOpened', slotId: otherRoomSlotId })).toBe('lock-not-in-room');
    });

    it('exempts EvidenceContinued', () => {
      expect(kindOf(started(), { kind: 'EvidenceContinued', slotId: firstSlotId })).toBe('no-evidence-open');
    });
  });

  it('does not mutate the input state on success or failure', () => {
    const before = JSON.stringify(fresh());
    const state = fresh();
    apply(state, { kind: 'RunStarted', manifestId: manifest.manifestId });
    apply(state, { kind: 'RunLeft' });
    expect(JSON.stringify(state)).toBe(before);
  });
});
