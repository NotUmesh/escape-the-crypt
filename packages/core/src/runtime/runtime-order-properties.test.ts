import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type {
  BoneOrderingQuestion,
  BoundThreadsQuestion,
  CombinationDialQuestion,
  CursedObjectQuestion,
  RuneCipherQuestion,
  SeanceBoardQuestion,
} from '../locks/judge-registry';
import { buildManifest } from '../test-support/manifest-fixture';
import { SETTINGS } from '../test-support/run-settings';
import type { Event } from '../types';
import { apply } from './apply';
import { initial } from './initial';
import type { QuestionSpec } from './manifest-types';
import type { State } from './state-types';

const manifest = buildManifest({
  rooms: 2,
  conceptsPerRoom: 4,
  alternates: (r, c) => (r + c) % 3 !== 0,
});
const manifestSnapshot = JSON.parse(JSON.stringify(manifest)) as typeof manifest;

const allQuestions: readonly QuestionSpec[] = [
  ...manifestSnapshot.rooms.flatMap((r) =>
    r.lockSlots.flatMap((s) => (s.alternateQuestion ? [s.primaryQuestion, s.alternateQuestion] : [s.primaryQuestion])),
  ),
  ...manifestSnapshot.finalDoor.slots.map((s) => s.question),
];
const questionById = new Map(allQuestions.map((q) => [q.questionId, q] as const));

/** The option order and bone order a question carries, read from its payload. */
function orderOf(question: QuestionSpec): readonly (readonly string[])[] {
  const p = question.payload;
  switch (question.lockType) {
    case 'seance-board':
      return [(p as SeanceBoardQuestion).optionIds];
    case 'cursed-object':
      return [(p as CursedObjectQuestion).optionIds];
    case 'bone-ordering':
      return [(p as BoneOrderingQuestion).itemIds, (p as BoneOrderingQuestion).keyOrder];
    case 'bound-threads':
      return [(p as BoundThreadsQuestion).leftIds, (p as BoundThreadsQuestion).rightIds];
    default:
      return [];
  }
}

function submissionFor(question: QuestionSpec, correct: boolean): unknown {
  const p = question.payload;
  switch (question.lockType) {
    case 'rune-cipher':
      return { text: correct ? (p as RuneCipherQuestion).answer : 'zzz-not-it' };
    case 'seance-board': {
      const q = p as SeanceBoardQuestion;
      return { selectedOptionId: correct ? q.keyOptionId : (q.optionIds.find((o) => o !== q.keyOptionId) ?? '') };
    }
    case 'cursed-object': {
      const q = p as CursedObjectQuestion;
      return { selectedId: correct ? q.oddOneOutId : (q.optionIds.find((o) => o !== q.oddOneOutId) ?? '') };
    }
    case 'bone-ordering': {
      const q = p as BoneOrderingQuestion;
      return { order: correct ? q.keyOrder : q.itemIds };
    }
    case 'bound-threads': {
      const q = p as BoundThreadsQuestion;
      if (correct) return { pairs: q.keyPairs };
      return { pairs: q.leftIds.map((l, i) => [l, q.rightIds[(i + 2) % q.rightIds.length] ?? '']) };
    }
    case 'combination-dial': {
      const q = p as CombinationDialQuestion;
      const value = q.exactValue ?? 0;
      return { rawInput: String(correct ? value : value + 1) };
    }
  }
}

type Step = {
  readonly kind:
    | 'answer'
    | 'skip'
    | 'challenge'
    | 'hint'
    | 'open'
    | 'continue'
    | 'enter-room'
    | 'final-door'
    | 'leave'
    | 'resume';
  readonly pick: number;
  readonly correct: boolean;
};

const stepArb: fc.Arbitrary<Step> = fc.record({
  kind: fc.constantFrom(
    'answer' as const,
    'answer' as const,
    'answer' as const,
    'skip' as const,
    'challenge' as const,
    'hint' as const,
    'open' as const,
    'continue' as const,
    'enter-room' as const,
    'final-door' as const,
    'leave' as const,
    'resume' as const,
  ),
  pick: fc.nat(1000),
  correct: fc.boolean(),
});

/** Every slot currently in State, with the question it shows. */
function liveSlots(state: State): readonly { slotId: string; questionId: string }[] {
  return [
    ...state.rooms.flatMap((r) => [...r.lockSlots, ...r.dueReturnSlots]),
    ...state.finalDoor.slots,
  ].map((s) => ({ slotId: s.slotId, questionId: s.currentQuestionId }));
}

function eventFor(state: State, step: Step): Event | null {
  const slots = liveSlots(state);
  const slot = slots[step.pick % Math.max(slots.length, 1)];
  const room = manifest.rooms[step.pick % manifest.rooms.length];
  switch (step.kind) {
    case 'enter-room':
      return room === undefined ? null : { kind: 'RoomEntered', roomId: room.roomId };
    case 'final-door':
      return { kind: 'FinalDoorEntered' };
    case 'leave':
      return { kind: 'RunLeft' };
    case 'resume':
      return { kind: 'RunResumed' };
    default:
  }
  if (slot === undefined) return null;
  const { slotId } = slot;
  switch (step.kind) {
    case 'answer': {
      const question = questionById.get(slot.questionId);
      return question === undefined
        ? null
        : { kind: 'AnswerSubmitted', slotId, submission: submissionFor(question, step.correct) };
    }
    case 'skip':
      return { kind: 'Skipped', slotId };
    case 'challenge':
      return { kind: 'Challenged', slotId };
    case 'hint':
      return { kind: 'HintUsed', slotId };
    case 'open':
      return { kind: 'LockOpened', slotId };
    default:
      return { kind: 'EvidenceContinued', slotId };
  }
}

function startState(): State {
  let state = initial(manifest, SETTINGS);
  const setup: Event[] = [
    { kind: 'RunStarted', manifestId: manifest.manifestId },
    ...manifest.rooms.map((r): Event => ({ kind: 'RoomPublished', roomId: r.roomId })),
  ];
  const first = manifest.rooms[0];
  if (first !== undefined) setup.push({ kind: 'RoomEntered', roomId: first.roomId });
  for (const event of setup) {
    const result = apply(state, event);
    if (!result.ok) throw new Error(`setup rejected: ${result.error.kind}`);
    state = result.state;
  }
  return state;
}

function assertOrderFixed(state: State): void {
  // The manifest held in State is the original, in its original order.
  expect(state.manifest).toEqual(manifestSnapshot);
  // Every question shown by any slot has the manifest's option and bone order.
  for (const { questionId } of liveSlots(state)) {
    const expected = questionById.get(questionId);
    expect(expected).toBeDefined();
    const shown = [...state.manifest.rooms.flatMap((r) => r.lockSlots.flatMap((s) => [s.primaryQuestion, s.alternateQuestion])),
      ...state.manifest.finalDoor.slots.map((s) => s.question)].find((q) => q?.questionId === questionId);
    expect(shown).toBeDefined();
    if (expected !== undefined && shown != null) {
      expect(orderOf(shown)).toEqual(orderOf(expected));
    }
  }
}

/** Feature: room-runtime, Property 12: Order fixed by the manifest */
describe('Property 12: Order fixed by the manifest', () => {
  /** **Validates: Requirements 6.1, 6.2, 6.3** */
  it('option order and bone order equal the manifest after every event', () => {
    fc.assert(
      fc.property(fc.array(stepArb, { maxLength: 40 }), (steps) => {
        let state = startState();
        assertOrderFixed(state);
        for (const step of steps) {
          const event = eventFor(state, step);
          if (event === null) continue;
          const result = apply(state, event);
          if (result.ok) state = result.state;
          assertOrderFixed(state);
        }
      }),
      { numRuns: 100 },
    );
  });
});
