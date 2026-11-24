import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { buildManifest } from '../test-support/manifest-fixture';
import { submissionFor } from '../test-support/question-answers';
import { SETTINGS } from '../test-support/run-settings';
import type { Event } from '../types';
import { apply } from './apply';
import { initial } from './initial';
import type { CryptManifest, QuestionSpec } from './manifest-types';
import type { LockSlotState, State } from './state-types';

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

/** A submission that is well-formed for the question shown and is not the key (may still be judged invalid). */
function wrongSubmission(question: QuestionSpec | undefined): unknown {
  const payload = question?.payload as Record<string, unknown> | undefined;
  if (!payload) return null;
  if (question?.lockType === 'seance-board') {
    const options = payload.optionIds as readonly string[];
    return { selectedOptionId: options.find((o) => o !== payload.keyOptionId) ?? null };
  }
  const options = payload.optionIds as readonly string[];
  return { selectedId: options.find((o) => o !== payload.oddOneOutId) ?? null };
}

type Step = { readonly slot: number; readonly action: 'wrong' | 'skip' | 'challenge' | 'hint' };

function stepEvent(state: State, manifest: CryptManifest, step: Step): Event | null {
  const open = openSlots(state);
  const slot = open[step.slot % Math.max(open.length, 1)];
  if (!slot) return null;
  switch (step.action) {
    case 'wrong':
      return {
        kind: 'AnswerSubmitted',
        slotId: slot.slotId,
        submission: wrongSubmission(questionById(manifest, slot.currentQuestionId)),
      };
    case 'skip':
      return { kind: 'Skipped', slotId: slot.slotId };
    case 'challenge':
      return { kind: 'Challenged', slotId: slot.slotId };
    case 'hint':
      return { kind: 'HintUsed', slotId: slot.slotId };
  }
}

function openSlots(state: State): LockSlotState[] {
  const room = state.rooms.find((r) => r.roomId === state.currentRoomId);
  return room?.lockSlots.filter((s) => s.status === 'open') ?? [];
}

const stepArb: fc.Arbitrary<Step> = fc.record({
  slot: fc.nat(10),
  action: fc.constantFrom('wrong', 'wrong', 'skip', 'challenge', 'hint'),
});

const setupArb = fc.record({
  conceptsPerRoom: fc.integer({ min: 1, max: 4 }),
  alternates: fc.array(fc.boolean(), { minLength: 4, maxLength: 4 }),
  hintEffects: fc.boolean(),
  steps: fc.array(stepArb, { maxLength: 8 }),
  target: fc.nat(10),
});

/** Feature: room-runtime, Property 9: Challenging is free, isolated and follows the outcome precedence (part a) */
describe('Property 9 (a): challenging a Lock_Slot question is free and isolated', () => {
  /** **Validates: Requirements 17.1, 17.2, 17.3, 17.5, 17.7** */
  it('adds no wrong answer, candle or ghost and emits only sealCracked (plus roomCleared)', () => {
    fc.assert(
      fc.property(setupArb, (setup) => {
        const manifest = buildManifest({
          rooms: 1,
          conceptsPerRoom: setup.conceptsPerRoom,
          lockTypes: ['seance-board', 'cursed-object'],
          alternates: (_room, concept) => setup.alternates[concept] ?? true,
          hintEffects: setup.hintEffects,
        });
        let state = startRun(manifest);
        for (const step of setup.steps) {
          const event = stepEvent(state, manifest, step);
          if (event === null) continue;
          const result = apply(state, event);
          if (result.ok) state = result.state;
        }
        const open = openSlots(state);
        const target = open[setup.target % Math.max(open.length, 1)];
        fc.pre(target !== undefined);
        if (!target) return;

        const before = JSON.parse(JSON.stringify(state)) as State;
        const result = mustApply(state, { kind: 'Challenged', slotId: target.slotId });
        expect(state).toEqual(before);
        const after = result.state;

        expect(after.candleCount).toBe(before.candleCount);
        expect(after.judgedAnswerCount).toBe(before.judgedAnswerCount);
        expect(after.ghosts).toEqual(before.ghosts);
        expect(after.remainingHints).toBe(before.remainingHints);

        const slotAfter = after.rooms[0]?.lockSlots.find((s) => s.slotId === target.slotId);
        expect(slotAfter?.candleLit).toBe(false);
        for (const slot of after.rooms[0]?.lockSlots ?? []) {
          if (slot.slotId === target.slotId) continue;
          expect(slot).toEqual(before.rooms[0]?.lockSlots.find((s) => s.slotId === slot.slotId));
        }

        const kinds = result.notices.map((n) => n.kind);
        expect(kinds.filter((k) => k === 'sealCracked')).toHaveLength(1);
        expect(kinds.every((k) => k === 'sealCracked' || k === 'roomCleared')).toBe(true);
        if (kinds.includes('roomCleared')) {
          expect(slotAfter?.status).toBe('challenged');
          expect(openSlots(after)).toHaveLength(0);
        }
      }),
      { numRuns: 100 },
    );
  });
});

type ReturnAction = 'correct' | 'wrong' | 'skip' | 'challenge';

const returnSetupArb = fc.record({
  conceptsPerRoom: fc.integer({ min: 1, max: 6 }),
  alternates: fc.array(fc.boolean(), { minLength: 6, maxLength: 6 }),
  actions: fc.array(
    fc.record({
      slot: fc.nat(20),
      action: fc.constantFrom<ReturnAction>('correct', 'wrong', 'wrong', 'correct', 'skip', 'challenge'),
    }),
    { minLength: 4, maxLength: 40 },
  ),
});

function openSlotIds(state: State): string[] {
  const room = state.rooms.find((r) => r.roomId === state.currentRoomId);
  if (!room) return [];
  return [
    ...room.lockSlots.filter((s) => s.status === 'open').map((s) => s.slotId),
    ...room.dueReturnSlots.filter((s) => s.status === 'open').map((s) => s.slotId),
  ];
}

function shownQuestionId(state: State, slotId: string): string {
  const room = state.rooms.find((r) => r.roomId === state.currentRoomId);
  return (
    room?.lockSlots.find((s) => s.slotId === slotId)?.currentQuestionId ??
    room?.dueReturnSlots.find((s) => s.slotId === slotId)?.currentQuestionId ??
    ''
  );
}

/** Feature: room-runtime, Property 4: Return question choice and Review label follow show history */
describe('Property 4: return question choice and Review label follow show history', () => {
  /** **Validates: Requirements 14.2, 14.3, 14.4, 14.9, 14.10** */
  it('picks the unused Alternate or the primary, and labels Review iff already shown', () => {
    let returnsSeen = 0;
    fc.assert(
      fc.property(returnSetupArb, (setup) => {
        const manifest = buildManifest({
          rooms: 1,
          conceptsPerRoom: setup.conceptsPerRoom,
          alternates: (_room, concept) => setup.alternates[concept] ?? true,
        });
        let state = startRun(manifest);
        for (const { slot, action } of setup.actions) {
          const open = openSlotIds(state);
          const slotId = open[slot % Math.max(open.length, 1)];
          if (slotId === undefined) break;
          let event: Event;
          if (action === 'skip') event = { kind: 'Skipped', slotId };
          else if (action === 'challenge') event = { kind: 'Challenged', slotId };
          else {
            const question = questionById(manifest, shownQuestionId(state, slotId));
            if (!question) throw new Error('unknown question');
            event = {
              kind: 'AnswerSubmitted',
              slotId,
              submission: submissionFor(question, action === 'correct'),
            };
          }
          const before = state;
          const result = apply(state, event);
          if (!result.ok) continue;
          state = result.state;

          const knownBefore = new Set(
            before.rooms.flatMap((r) => r.dueReturnSlots.map((s) => s.slotId)),
          );
          for (const ret of state.rooms.flatMap((r) => r.dueReturnSlots)) {
            if (knownBefore.has(ret.slotId)) continue;
            returnsSeen += 1;
            const spec = manifest.rooms
              .flatMap((r) => r.lockSlots)
              .find((s) => s.conceptId === ret.conceptId);
            const record = before.concepts.find((c) => c.conceptId === ret.conceptId);
            if (!spec || !record) throw new Error('missing concept');
            const alternate = spec.alternateQuestion;
            const expected =
              ret.returnNumber === 1 && alternate !== null && !record.alternateUsed
                ? alternate
                : spec.primaryQuestion;
            expect(ret.currentQuestionId).toBe(expected.questionId);
            // Req 14.11: a Return never shows a challenged question.
            const priorResult =
              expected === spec.primaryQuestion ? record.firstQuestionResult : record.alternateResult;
            expect(priorResult).not.toBe('challenged');
            expect(ret.currentQuestionType).toBe(expected.lockType);
            expect(ret.label).toBe(
              record.shownQuestionIds.includes(expected.questionId) ? 'review' : null,
            );
            if (ret.returnNumber === 2) expect(ret.label).toBe('review');
            if (expected !== spec.primaryQuestion) {
              expect(expected.lockType).not.toBe(spec.primaryQuestion.lockType);
            }
            const after = state.concepts.find((c) => c.conceptId === ret.conceptId);
            expect(after?.shownQuestionIds).toContain(expected.questionId);
          }
        }
      }),
      { numRuns: 200 },
    );
    expect(returnsSeen).toBeGreaterThan(0);
  });
});
