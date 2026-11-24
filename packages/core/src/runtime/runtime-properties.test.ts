import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { buildManifest } from '../test-support/manifest-fixture';
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
