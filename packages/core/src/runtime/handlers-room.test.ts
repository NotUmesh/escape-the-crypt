import { describe, expect, it } from 'vitest';
import { buildManifest } from '../test-support/manifest-fixture';
import { SETTINGS } from '../test-support/run-settings';
import { apply } from './apply';
import { initial } from './initial';
import { selectWaitingForNextRoom } from './selectors';
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

function withCleared(state: State, index: number): State {
  return { ...state, rooms: state.rooms.map((r, i) => (i === index ? { ...r, cleared: true } : r)) };
}

describe('RoomEntered progression', () => {
  const cleared = withCleared(entered, 0);
  const both = run(cleared, { kind: 'RoomPublished', roomId: room2.roomId });

  it('rejects room 2 while room 1 is not cleared', () => {
    const open = run(entered, { kind: 'RoomPublished', roomId: room2.roomId });
    expect(apply(open, { kind: 'RoomEntered', roomId: room2.roomId })).toEqual({
      ok: false,
      error: { kind: 'room-not-cleared' },
    });
  });

  it('rejects room 2 when cleared but unpublished', () => {
    expect(apply(cleared, { kind: 'RoomEntered', roomId: room2.roomId })).toEqual({
      ok: false,
      error: { kind: 'room-not-published' },
    });
  });

  it('enters room 2 when room 1 is cleared and room 2 published', () => {
    const result = apply(both, { kind: 'RoomEntered', roomId: room2.roomId });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.state.currentRoomId).toBe(room2.roomId);
  });

  it('rejects skipping, repeating and entering before room 1', () => {
    const m3 = buildManifest({ rooms: 3, conceptsPerRoom: 1 });
    const r = m3.rooms.map((x) => x.roomId);
    let s = run(initial(m3, SETTINGS), { kind: 'RunStarted', manifestId: m3.manifestId });
    for (const id of r) s = run(s, { kind: 'RoomPublished', roomId: id });
    expect(apply(s, { kind: 'RoomEntered', roomId: r[1] ?? '' })).toEqual({ ok: false, error: { kind: 'room-out-of-order' } });
    s = withCleared(run(s, { kind: 'RoomEntered', roomId: r[0] ?? '' }), 0);
    expect(apply(s, { kind: 'RoomEntered', roomId: r[2] ?? '' })).toEqual({ ok: false, error: { kind: 'room-out-of-order' } });
    expect(apply(s, { kind: 'RoomEntered', roomId: r[0] ?? '' })).toEqual({ ok: false, error: { kind: 'room-out-of-order' } });
  });
});

describe('waiting for next room', () => {
  const cleared = withCleared(entered, 0);

  it('is waiting when room 1 is cleared, room 2 unpublished and the count unknown', () => {
    expect(selectWaitingForNextRoom(cleared)).toBe(true);
  });

  it('is not waiting while the room is not cleared, or once the next room is published', () => {
    expect(selectWaitingForNextRoom(entered)).toBe(false);
    expect(selectWaitingForNextRoom(run(cleared, { kind: 'RoomPublished', roomId: room2.roomId }))).toBe(false);
  });

  it('is not waiting when room 1 is the final room', () => {
    expect(selectWaitingForNextRoom({ ...cleared, finalRoomCount: 1 })).toBe(false);
    expect(selectWaitingForNextRoom({ ...cleared, finalRoomCount: 2 })).toBe(true);
  });

  it('keeps a published room unchanged when it is published again', () => {
    const again = apply(cleared, { kind: 'RoomPublished', roomId: room1.roomId });
    expect(again.ok && again.state.rooms[0]).toEqual(cleared.rooms[0]);
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

