import { describe, expect, it } from 'vitest';
import { buildManifest } from '../test-support/manifest-fixture';
import { SETTINGS } from '../test-support/run-settings';
import { apply } from './apply';
import { initial } from './initial';
import type { State } from './state-types';

const manifest = buildManifest({ rooms: 2, conceptsPerRoom: 2 });
const room1 = manifest.rooms[0];
const room2 = manifest.rooms[1];
if (!room1 || !room2) throw new Error('fixture');
const slot1 = room1.lockSlots[0]?.slotId ?? '';
const slot2 = room2.lockSlots[0]?.slotId ?? '';

function run(state: State, ...events: Parameters<typeof apply>[1][]): State {
  let current = state;
  for (const event of events) {
    const result = apply(current, event);
    if (!result.ok) throw new Error(`setup rejected: ${result.error.kind}`);
    current = result.state;
  }
  return current;
}

const started = run(initial(manifest, SETTINGS), { kind: 'RunStarted', manifestId: manifest.manifestId });
const published = run(started, { kind: 'RoomPublished', roomId: room1.roomId });
const entered = run(published, { kind: 'RoomEntered', roomId: room1.roomId });

describe('RoomPublished', () => {
  it('marks the room published and leaves other rooms alone', () => {
    expect(published.rooms[0]?.published).toBe(true);
    expect(published.rooms[1]?.published).toBe(false);
  });

  it('is an idempotent no-op on a duplicate', () => {
    const again = apply(published, { kind: 'RoomPublished', roomId: room1.roomId });
    expect(again).toEqual({ ok: true, state: published, notices: [] });
  });
});

describe('RoomEntered', () => {
  it('sets room 1 as the current room', () => {
    expect(entered.currentRoomId).toBe(room1.roomId);
  });

  it('rejects an unpublished room with room-not-published', () => {
    expect(apply(started, { kind: 'RoomEntered', roomId: room1.roomId })).toEqual({
      ok: false,
      error: { kind: 'room-not-published' },
    });
  });
});

describe('LockOpened', () => {
  it('records the focused lock for a slot in the current room', () => {
    const result = apply(entered, { kind: 'LockOpened', slotId: slot1 });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.state.focusedSlotId).toBe(slot1);
  });

  it('rejects a slot outside the current room with lock-not-in-room', () => {
    expect(apply(entered, { kind: 'LockOpened', slotId: slot2 })).toEqual({
      ok: false,
      error: { kind: 'lock-not-in-room' },
    });
  });

  it('rejects any slot before a room is entered', () => {
    expect(apply(published, { kind: 'LockOpened', slotId: slot1 })).toEqual({
      ok: false,
      error: { kind: 'lock-not-in-room' },
    });
  });

  it('rejects a settled slot with lock-already-settled and leaves state unchanged', () => {
    const settled: State = {
      ...entered,
      rooms: entered.rooms.map((room, i) =>
        i === 0
          ? { ...room, lockSlots: room.lockSlots.map((s) => ({ ...s, status: 'settled' as const })) }
          : room,
      ),
    };
    const before = JSON.stringify(settled);
    expect(apply(settled, { kind: 'LockOpened', slotId: slot1 })).toEqual({
      ok: false,
      error: { kind: 'lock-already-settled' },
    });
    expect(JSON.stringify(settled)).toBe(before);
  });
});
