import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { buildManifest } from '../test-support/manifest-fixture';
import { SETTINGS } from '../test-support/run-settings';
import type { Event } from '../types';
import { apply } from './apply';
import { initial } from './initial';
import type { CryptManifest } from './manifest-types';
import type { LockSlotState, State } from './state-types';

const manifest: CryptManifest = buildManifest({
  rooms: 1,
  conceptsPerRoom: 2,
  lockTypes: ['seance-board', 'cursed-object'],
  alternates: true,
  hintEffects: true,
});
const room = manifest.rooms[0];
const seanceSpec = room?.lockSlots.find((s) => s.stationType === 'seance-board');
const cursedSpec = room?.lockSlots.find((s) => s.stationType === 'cursed-object');
if (!room || !seanceSpec || !cursedSpec) throw new Error('fixture');

const seanceId = seanceSpec.slotId;
const cursedId = cursedSpec.slotId;
const seancePayload = seanceSpec.primaryQuestion.payload as { optionIds: string[]; keyOptionId: string };
const cursedPayload = cursedSpec.primaryQuestion.payload as { oddOneOutId: string };
const alternatePayload = seanceSpec.alternateQuestion?.payload as { oddOneOutId: string };
const roomId = room.roomId;

function start(hintAllowance: number): State {
  let state = initial(manifest, { ...SETTINGS, hintAllowance });
  const setup: Event[] = [
    { kind: 'RunStarted', manifestId: manifest.manifestId },
    { kind: 'RoomPublished', roomId },
    { kind: 'RoomEntered', roomId },
  ];
  for (const event of setup) {
    const result = apply(state, event);
    if (!result.ok) throw new Error(`setup rejected: ${result.error.kind}`);
    state = result.state;
  }
  return state;
}

function ok(state: State, event: Event): State {
  const result = apply(state, event);
  if (!result.ok) throw new Error(`rejected: ${result.error.kind}`);
  return result.state;
}

function slotOf(state: State, id: string): LockSlotState {
  const slot = state.rooms[0]?.lockSlots.find((s) => s.slotId === id);
  if (!slot) throw new Error('slot');
  return slot;
}

const conceptFlag = (state: State, conceptId: string): boolean | undefined =>
  state.concepts.find((c) => c.conceptId === conceptId)?.hintUsedOnCorrectQuestion;

const hintOn = (slotId: string): Event => ({ kind: 'HintUsed', slotId });
const correctSeance: Event = {
  kind: 'AnswerSubmitted',
  slotId: seanceId,
  submission: { selectedOptionId: seancePayload.keyOptionId },
};
const correctCursed: Event = {
  kind: 'AnswerSubmitted',
  slotId: cursedId,
  submission: { selectedId: cursedPayload.oddOneOutId },
};
const wrongSeance: Event = {
  kind: 'AnswerSubmitted',
  slotId: seanceId,
  submission: { selectedOptionId: seancePayload.optionIds.find((o) => o !== seancePayload.keyOptionId) ?? null },
};
const correctAlternate: Event = {
  kind: 'AnswerSubmitted',
  slotId: seanceId,
  submission: { selectedId: alternatePayload.oddOneOutId },
};

const allowanceArb = fc.integer({ min: 0, max: 4 });

/** Feature: room-runtime, Property 8: Hints stay within allowance and mark answers assisted */
describe('Property 8: Hints stay within allowance and mark answers assisted', () => {
  /** **Validates: Requirements 18.1, 18.2, 18.3, 18.6** */
  it('remaining hints never drop below zero, fall by one per accepted hint and never rise', () => {
    const eventArb = fc.constantFrom<Event>(
      hintOn(seanceId),
      hintOn(cursedId),
      wrongSeance,
      correctSeance,
      correctCursed,
      { kind: 'Skipped', slotId: cursedId },
      { kind: 'Challenged', slotId: seanceId },
    );
    fc.assert(
      fc.property(allowanceArb, fc.array(eventArb, { maxLength: 20 }), (allowance, events) => {
        let state = start(allowance);
        for (const event of events) {
          const result = apply(state, event);
          if (!result.ok) continue;
          const expected = event.kind === 'HintUsed' ? state.remainingHints - 1 : state.remainingHints;
          expect(result.state.remainingHints).toBe(expected);
          expect(result.state.remainingHints).toBeGreaterThanOrEqual(0);
          state = result.state;
        }
      }),
      { numRuns: 100 },
    );
  });

  /** **Validates: Requirements 18.2, 18.3** */
  it('a hint with none left is rejected and leaves State unchanged', () => {
    const state = start(0);
    const before = JSON.stringify(state);
    expect(apply(state, hintOn(seanceId))).toMatchObject({ ok: false, error: { kind: 'no-hints-left' } });
    expect(JSON.stringify(state)).toBe(before);
  });

  /** **Validates: Requirements 18.3, 18.4** */
  it('rejects a second hint on one question and a hint on a solved or settled slot', () => {
    fc.assert(
      fc.property(fc.integer({ min: 2, max: 4 }), (allowance) => {
        const hinted = ok(start(allowance), hintOn(seanceId));
        expect(apply(hinted, hintOn(seanceId))).toMatchObject({ ok: false, error: { kind: 'hint-already-used' } });

        const solved = ok(start(allowance), correctSeance);
        expect(slotOf(solved, seanceId).status).toBe('solved');
        expect(apply(solved, hintOn(seanceId))).toMatchObject({ ok: false, error: { kind: 'lock-already-settled' } });

        const skipped = ok(start(allowance), { kind: 'Skipped', slotId: cursedId });
        expect(slotOf(skipped, cursedId).status).toBe('settled');
        expect(apply(skipped, hintOn(cursedId))).toMatchObject({ ok: false, error: { kind: 'lock-already-settled' } });
      }),
      { numRuns: 20 },
    );
  });

  /** **Validates: Requirements 18.5, 22.7, 22.8** */
  it('a correct answer on a hinted question sets hintUsedOnCorrectQuestion, an unhinted one does not', () => {
    fc.assert(
      fc.property(allowanceArb, fc.boolean(), fc.boolean(), (allowance, useCursed, hinted) => {
        const slotId = useCursed ? cursedId : seanceId;
        const conceptId = (useCursed ? cursedSpec : seanceSpec).conceptId;
        const base = start(allowance);
        const willHint = hinted && allowance > 0;
        const ready = willHint ? ok(base, hintOn(slotId)) : base;
        const answered = ok(ready, useCursed ? correctCursed : correctSeance);
        expect(conceptFlag(answered, conceptId)).toBe(willHint);
      }),
      { numRuns: 50 },
    );
  });

  /** **Validates: Requirements 18.7, 18.8, 22.11** */
  it('challenging a hinted question keeps the spent hint, clears the applied hint and leaves a correct unhinted Alternate unassisted', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 4 }), (allowance) => {
        const hinted = ok(start(allowance), hintOn(seanceId));
        const challenged = ok(hinted, { kind: 'Challenged', slotId: seanceId });
        expect(challenged.remainingHints).toBe(hinted.remainingHints);
        expect(slotOf(challenged, seanceId).appliedHint).toBeNull();
        expect(conceptFlag(challenged, seanceSpec.conceptId)).toBe(false);

        const answered = ok(challenged, correctAlternate);
        expect(slotOf(answered, seanceId).status).toBe('solved');
        expect(conceptFlag(answered, seanceSpec.conceptId)).toBe(false);
      }),
      { numRuns: 20 },
    );
  });
});
