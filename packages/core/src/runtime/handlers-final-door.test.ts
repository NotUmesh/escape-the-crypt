import { describe, expect, it } from 'vitest';
import type { Event } from '../types';
import { buildManifest } from '../test-support/manifest-fixture';
import { submissionFor } from '../test-support/question-answers';
import { SETTINGS } from '../test-support/run-settings';
import { apply } from './apply';
import { initial } from './initial';
import type { State } from './state-types';

const manifest = buildManifest({ rooms: 1, conceptsPerRoom: 2, alternates: false, finalDoorQuestions: 3 });
const room = manifest.rooms[0];
const reserved = manifest.finalDoor.slots;
const specA = room?.lockSlots[0];
const specB = room?.lockSlots[1];
if (!room || !specA || !specB) throw new Error('fixture');
const specs = { a: specA, b: specB };

function run(state: State, ...events: Event[]): State {
  let current = state;
  for (const event of events) {
    const result = apply(current, event);
    if (!result.ok) throw new Error(`setup rejected ${event.kind}: ${result.error.kind}`);
    current = result.state;
  }
  return current;
}

const started = (): State =>
  run(
    initial(manifest, { ...SETTINGS, hintAllowance: 2 }),
    { kind: 'RunStarted', manifestId: manifest.manifestId },
    { kind: 'RoomPublished', roomId: room.roomId },
    { kind: 'CryptFinalised', finalRoomCount: 1 },
    { kind: 'RoomEntered', roomId: room.roomId },
  );

const answer = (slotId: string, spec: { primaryQuestion: Parameters<typeof submissionFor>[0] }, correct: boolean): Event => ({
  kind: 'AnswerSubmitted',
  slotId,
  submission: submissionFor(spec.primaryQuestion, correct),
});

/** Room cleared with both locks solved; the door is available but not entered. */
function atDoorGate(): State {
  return run(started(), answer(specs.a.slotId, specs.a, true), answer(specs.b.slotId, specs.b, true));
}

const reservedAnswer = (i: number, correct: boolean): Event => ({
  kind: 'AnswerSubmitted',
  slotId: reserved[i]!.slotId,
  submission: submissionFor(reserved[i]!.question, correct),
});

describe('final door', () => {
  it('rejects FinalDoorEntered while the door is unavailable', () => {
    const state = started();
    const result = apply(state, { kind: 'FinalDoorEntered' });
    expect(result).toMatchObject({ ok: false, error: { kind: 'final-door-unavailable' } });
  });

  it('keeps reserved slots out of play until FinalDoorEntered (lock-not-in-room, State unchanged)', () => {
    const state = atDoorGate();
    expect(state.finalDoor.available).toBe(true);
    expect(state.atFinalDoor).toBe(false);
    const before = JSON.stringify(state);
    const result = apply(state, reservedAnswer(0, true));
    expect(result).toMatchObject({ ok: false, error: { kind: 'lock-not-in-room' } });
    expect(JSON.stringify(state)).toBe(before);
  });

  it('opens exactly the manifest reserved questions and escapes once when all are solved or settled', () => {
    let state = run(atDoorGate(), { kind: 'FinalDoorEntered' });
    expect(state.atFinalDoor).toBe(true);
    expect(state.finalDoor.slots.map((s) => s.slotId)).toEqual(reserved.map((s) => s.slotId));
    const candlesBefore = state.candleCount;
    const concepts = state.concepts;

    state = run(state, reservedAnswer(0, true), reservedAnswer(1, false));
    expect(state.status).toBe('in progress');
    const last = apply(state, { kind: 'Skipped', slotId: reserved[2]!.slotId });
    expect(last.ok).toBe(true);
    if (!last.ok) return;
    expect(last.state.status).toBe('escaped');
    expect(last.notices.filter((n) => n.kind === 'escaped')).toHaveLength(1);
    expect(last.state.candleCount).toBe(candlesBefore + 1);
    expect(last.state.concepts).toEqual(concepts);
    expect(last.state.ghosts).toEqual([]);
    expect(apply(last.state, { kind: 'FinalDoorEntered' })).toMatchObject({ error: { kind: 'run-finished' } });
  });

  it('settles a challenged reserved question without touching concepts', () => {
    const state = run(atDoorGate(), { kind: 'FinalDoorEntered' });
    const result = apply(state, { kind: 'Challenged', slotId: reserved[0]!.slotId });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.finalDoor.slots[0]?.status).toBe('challenged');
    expect(result.notices).toEqual([{ kind: 'sealCracked', slotId: reserved[0]!.slotId }]);
    expect(result.state.concepts).toEqual(state.concepts);
    expect(result.state.candleCount).toBe(state.candleCount);
  });

  it('accepts a hint on a reserved slot', () => {
    const state = run(atDoorGate(), { kind: 'FinalDoorEntered' });
    const result = apply(state, { kind: 'HintUsed', slotId: reserved[0]!.slotId });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.state.remainingHints).toBe(state.remainingHints - 1);
  });

  it('waives GHOST_DELAY: a pending ghost returns at once and a wrong return 1 spawns a due return 2', () => {
    // Miss A, then solve B and clear the room: only one judged answer since the ghost spawned.
    const gate = run(started(), answer(specs.a.slotId, specs.a, false), answer(specs.b.slotId, specs.b, true));
    expect(gate.ghosts).toHaveLength(1);
    expect(gate.finalDoor.available).toBe(true);

    let state = run(gate, { kind: 'FinalDoorEntered' });
    const r1 = `return-${specs.a.conceptId}-1`;
    const r2 = `return-${specs.a.conceptId}-2`;
    expect(state.ghosts).toEqual([]);
    expect(state.finalDoor.slots.map((s) => s.slotId)).toContain(r1);

    state = run(state, answer(r1, specs.a, false));
    expect(state.finalDoor.slots.find((s) => s.slotId === r2)).toMatchObject({ origin: 'return', status: 'open', label: 'review' });
    state = run(state, answer(r2, specs.a, false));
    expect(state.concepts.find((c) => c.conceptId === specs.a.conceptId)).toMatchObject({
      isLingeringSpirit: true,
      reviewDueFlag: true,
    });
    expect(state.status).toBe('in progress');
    state = run(state, { kind: 'Skipped', slotId: reserved[0]!.slotId }, { kind: 'Skipped', slotId: reserved[1]!.slotId });
    const done = apply(state, { kind: 'Skipped', slotId: reserved[2]!.slotId });
    expect(done.ok && done.state.status).toBe('escaped');
  });

  it('lights a Spirit_Candle at the door for a correct return', () => {
    const gate = run(started(), answer(specs.a.slotId, specs.a, false), answer(specs.b.slotId, specs.b, true));
    const state = run(gate, { kind: 'FinalDoorEntered' });
    const result = apply(state, answer(`return-${specs.a.conceptId}-1`, specs.a, true));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.finalDoor.spiritCandles).toHaveLength(1);
    expect(result.notices.map((n) => n.kind)).toEqual(['candleLit', 'ghostLaidToRest']);
  });
});
