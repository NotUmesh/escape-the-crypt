import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { buildManifest } from '../test-support/manifest-fixture';
import { submissionFor } from '../test-support/question-answers';
import { SETTINGS } from '../test-support/run-settings';
import type { Event } from '../types';
import { apply } from './apply';
import { initial } from './initial';
import type { CryptManifest, QuestionSpec } from './manifest-types';
import type { ReturnSlotState, State } from './state-types';

function mustApply(state: State, event: Event) {
  const result = apply(state, event);
  if (!result.ok) throw new Error(`rejected: ${result.error.kind}`);
  return result;
}

function startRun(manifest: CryptManifest): State {
  let state = initial(manifest, SETTINGS);
  const first = manifest.rooms[0];
  if (!first) throw new Error('fixture');
  const events: Event[] = [
    { kind: 'RunStarted', manifestId: manifest.manifestId },
    ...manifest.rooms.map((r): Event => ({ kind: 'RoomPublished', roomId: r.roomId })),
    { kind: 'RoomEntered', roomId: first.roomId },
  ];
  for (const event of events) state = mustApply(state, event).state;
  return state;
}

function questionById(manifest: CryptManifest, id: string): QuestionSpec | undefined {
  for (const slot of manifest.rooms.flatMap((r) => r.lockSlots)) {
    if (slot.primaryQuestion.questionId === id) return slot.primaryQuestion;
    if (slot.alternateQuestion?.questionId === id) return slot.alternateQuestion;
  }
  return undefined;
}

function openReturn(state: State): ReturnSlotState | undefined {
  const room = state.rooms.find((r) => r.roomId === state.currentRoomId);
  return room?.dueReturnSlots.find((s) => s.status === 'open');
}

type Action = 'wrong' | 'skip' | 'correct';

/** Drive the run until a Return_Slot is open; wrong answers always spawn ghosts, so this ends quickly. */
function driveToOpenReturn(manifest: CryptManifest, plan: readonly Action[]): State | null {
  let state = startRun(manifest);
  for (let i = 0; i < 40; i += 1) {
    if (openReturn(state) !== undefined) return state;
    const room = state.rooms.find((r) => r.roomId === state.currentRoomId);
    const slot = room?.lockSlots.find((s) => s.status === 'open');
    if (slot === undefined) return null;
    const action = plan[i] ?? 'wrong';
    const question = questionById(manifest, slot.currentQuestionId);
    if (question === undefined) return null;
    const event: Event =
      action === 'skip'
        ? { kind: 'Skipped', slotId: slot.slotId }
        : {
            kind: 'AnswerSubmitted',
            slotId: slot.slotId,
            submission: submissionFor(question, action === 'correct'),
          };
    state = mustApply(state, event).state;
  }
  return null;
}

const setupArb = fc.record({
  conceptsPerRoom: fc.integer({ min: 4, max: 6 }),
  alternates: fc.array(fc.boolean(), { minLength: 6, maxLength: 6 }),
  plan: fc.array(fc.constantFrom<Action>('wrong', 'wrong', 'skip', 'correct'), { maxLength: 3 }),
});

/** Feature: room-runtime, Property 9: Challenging is free, isolated and follows the outcome precedence (part a, Return_Slots) */
describe('Property 9 (a): challenging a Return_Slot question is free and isolated', () => {
  /** **Validates: Requirements 17.4, 17.5, 17.7** */
  it('adds no wrong answer, candle or ghost and emits only sealCracked (plus roomCleared)', () => {
    let reached = 0;
    fc.assert(
      fc.property(setupArb, (setup) => {
        const manifest = buildManifest({
          rooms: 1,
          conceptsPerRoom: setup.conceptsPerRoom,
          alternates: (_room, concept) => setup.alternates[concept] ?? true,
        });
        const state = driveToOpenReturn(manifest, setup.plan);
        fc.pre(state !== null);
        if (state === null) return;
        const target = openReturn(state);
        if (target === undefined) throw new Error('no open return');
        reached += 1;

        const before = JSON.parse(JSON.stringify(state)) as State;
        const result = mustApply(state, { kind: 'Challenged', slotId: target.slotId });
        expect(state).toEqual(before);
        const after = result.state;

        expect(after.candleCount).toBe(before.candleCount);
        expect(after.judgedAnswerCount).toBe(before.judgedAnswerCount);
        expect(after.remainingHints).toBe(before.remainingHints);

        // No ghost is spawned; due ghosts may only move into Return_Slots.
        expect(after.ghosts.length).toBeLessThanOrEqual(before.ghosts.length);
        for (const ghost of after.ghosts) expect(before.ghosts).toContainEqual(ghost);

        const room = after.rooms.find((r) => r.roomId === after.currentRoomId);
        const slotAfter = room?.dueReturnSlots.find((s) => s.slotId === target.slotId);
        expect(slotAfter?.status).toBe('challenged');
        expect(slotAfter?.candleLit).toBe(false);
        expect(room?.spiritCandles.length).toBe(
          before.rooms.find((r) => r.roomId === before.currentRoomId)?.spiritCandles.length,
        );
        expect(after.rooms.flatMap((r) => r.lockSlots)).toEqual(
          before.rooms.flatMap((r) => r.lockSlots),
        );

        // Recorded results: a challenge adds no wrong answer for any concept.
        for (const record of after.concepts) {
          const prior = before.concepts.find((c) => c.conceptId === record.conceptId);
          if (record.conceptId !== target.conceptId) expect(record).toEqual(prior);
          else {
            expect(record.firstQuestionResult).toBe(prior?.firstQuestionResult);
            expect(record.alternateResult).toBe(prior?.alternateResult);
          }
        }

        const kinds = result.notices.map((n) => n.kind);
        expect(kinds.filter((k) => k === 'sealCracked')).toHaveLength(1);
        expect(kinds.every((k) => k === 'sealCracked' || k === 'roomCleared')).toBe(true);
      }),
      { numRuns: 100 },
    );
    expect(reached).toBeGreaterThan(0);
  });
});
