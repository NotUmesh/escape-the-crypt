import { describe, expect, it } from 'vitest';
import { buildManifest } from '../test-support/manifest-fixture';
import { SETTINGS } from '../test-support/run-settings';
import type { Event } from '../types';
import { apply } from './apply';
import { initial } from './initial';
import type { CryptManifest } from './manifest-types';
import type { LockSlotState, State } from './state-types';

function ok(state: State, event: Event) {
  const result = apply(state, event);
  if (!result.ok) throw new Error(`rejected: ${result.error.kind}`);
  return result;
}

function start(manifest: CryptManifest): State {
  const room = manifest.rooms[0];
  if (!room) throw new Error('fixture');
  let state = initial(manifest, SETTINGS);
  const events: Event[] = [
    { kind: 'RunStarted', manifestId: manifest.manifestId },
    { kind: 'RoomPublished', roomId: room.roomId },
    { kind: 'RoomEntered', roomId: room.roomId },
  ];
  for (const event of events) state = ok(state, event).state;
  return state;
}

const withAlt = buildManifest({
  rooms: 1,
  conceptsPerRoom: 2,
  lockTypes: ['seance-board', 'cursed-object'],
  alternates: true,
  hintEffects: true,
});
const noAlt = buildManifest({ rooms: 1, conceptsPerRoom: 2, lockTypes: ['seance-board', 'cursed-object'], alternates: false });

function slots(manifest: CryptManifest) {
  const specs = manifest.rooms[0]?.lockSlots;
  const [first, second] = specs ?? [];
  if (!first || !second) throw new Error('fixture');
  return { first, second };
}

function slotOf(state: State, id: string): LockSlotState {
  const slot = state.rooms[0]?.lockSlots.find((s) => s.slotId === id);
  if (!slot) throw new Error('slot');
  return slot;
}

describe('Skipped', () => {
  it('settles the slot with no candle, no ghost and no judged answer', () => {
    const { first } = slots(withAlt);
    const before = start(withAlt);
    const { state, notices } = ok(before, { kind: 'Skipped', slotId: first.slotId });
    expect(slotOf(state, first.slotId)).toMatchObject({ status: 'settled', candleLit: false });
    expect(state.candleCount).toBe(0);
    expect(state.judgedAnswerCount).toBe(0);
    expect(state.ghosts).toEqual([]);
    expect(notices).toEqual([]);
  });

  it('emits roomCleared when it settles the last open slot', () => {
    const { first, second } = slots(withAlt);
    const mid = ok(start(withAlt), { kind: 'Skipped', slotId: first.slotId }).state;
    const { state, notices } = ok(mid, { kind: 'Skipped', slotId: second.slotId });
    const roomId = withAlt.rooms[0]?.roomId;
    expect(notices).toEqual([{ kind: 'roomCleared', roomId }]);
    expect(state.rooms[0]?.cleared).toBe(true);
  });

  it('rejects a second skip on a settled slot', () => {
    const { first } = slots(withAlt);
    const mid = ok(start(withAlt), { kind: 'Skipped', slotId: first.slotId }).state;
    expect(apply(mid, { kind: 'Skipped', slotId: first.slotId })).toMatchObject({
      ok: false,
      error: { kind: 'lock-already-settled' },
    });
  });
});

describe('Challenged', () => {
  it('replaces the question in place with the unused Alternate', () => {
    const { first } = slots(withAlt);
    const alt = first.alternateQuestion;
    if (!alt) throw new Error('fixture');
    const hinted = ok(start(withAlt), { kind: 'HintUsed', slotId: first.slotId }).state;
    const { state, notices } = ok(hinted, { kind: 'Challenged', slotId: first.slotId });
    expect(slotOf(state, first.slotId)).toMatchObject({
      status: 'open',
      stationType: first.stationType,
      currentQuestionId: alt.questionId,
      currentQuestionType: alt.lockType,
      appliedHint: null,
      candleLit: false,
    });
    expect(notices).toEqual([{ kind: 'sealCracked', slotId: first.slotId }]);
    expect(state.remainingHints).toBe(hinted.remainingHints);
    expect(state.candleCount).toBe(0);
    expect(state.judgedAnswerCount).toBe(0);
    expect(state.ghosts).toEqual([]);
    const concept = state.concepts.find((c) => c.conceptId === first.conceptId);
    expect(concept).toMatchObject({ alternateUsed: true, firstQuestionResult: 'challenged' });
    expect(concept?.shownQuestionIds).toContain(alt.questionId);
  });

  it('challenges the Alternate: slot becomes challenged', () => {
    const { first } = slots(withAlt);
    const replaced = ok(start(withAlt), { kind: 'Challenged', slotId: first.slotId }).state;
    const { state, notices } = ok(replaced, { kind: 'Challenged', slotId: first.slotId });
    expect(slotOf(state, first.slotId).status).toBe('challenged');
    expect(notices).toEqual([{ kind: 'sealCracked', slotId: first.slotId }]);
    const concept = state.concepts.find((c) => c.conceptId === first.conceptId);
    expect(concept).toMatchObject({ alternateChallenged: true, alternateResult: 'challenged' });
  });

  it('settles as challenged when there is no Alternate', () => {
    const { first } = slots(noAlt);
    const { state } = ok(start(noAlt), { kind: 'Challenged', slotId: first.slotId });
    expect(slotOf(state, first.slotId)).toMatchObject({ status: 'challenged', candleLit: false });
    expect(state.candleCount).toBe(0);
    expect(state.ghosts).toEqual([]);
  });

  it('emits sealCracked then roomCleared when it settles the last slot', () => {
    const { first, second } = slots(noAlt);
    const mid = ok(start(noAlt), { kind: 'Skipped', slotId: first.slotId }).state;
    const { state, notices } = ok(mid, { kind: 'Challenged', slotId: second.slotId });
    expect(notices).toEqual([
      { kind: 'sealCracked', slotId: second.slotId },
      { kind: 'roomCleared', roomId: noAlt.rooms[0]?.roomId },
    ]);
    expect(state.rooms[0]?.cleared).toBe(true);
  });

  it('rejects a challenge on an unknown or settled slot, leaving State unchanged', () => {
    const { first } = slots(noAlt);
    const settled = ok(start(noAlt), { kind: 'Challenged', slotId: first.slotId }).state;
    const snapshot = JSON.stringify(settled);
    expect(apply(settled, { kind: 'Challenged', slotId: first.slotId })).toMatchObject({
      ok: false,
      error: { kind: 'lock-already-settled' },
    });
    expect(apply(settled, { kind: 'Challenged', slotId: 'nope' })).toMatchObject({
      ok: false,
      error: { kind: 'unknown-reference' },
    });
    expect(JSON.stringify(settled)).toBe(snapshot);
  });
});
