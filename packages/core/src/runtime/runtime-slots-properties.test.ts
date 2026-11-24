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
import { selectFinalDoor, selectRooms } from './selectors';
import type { SlotStatus, State } from './state-types';

const manifest = buildManifest({
  rooms: 2,
  conceptsPerRoom: 4,
  alternates: (r, c) => (r + c) % 3 !== 0,
});
const slotIds = manifest.rooms.flatMap((r) => r.lockSlots.map((s) => s.slotId));
const specs = manifest.rooms.flatMap((r) => r.lockSlots);

function questionById(questionId: string): QuestionSpec {
  for (const spec of specs) {
    if (spec.primaryQuestion.questionId === questionId) return spec.primaryQuestion;
    if (spec.alternateQuestion?.questionId === questionId) return spec.alternateQuestion;
  }
  throw new Error(`unknown question ${questionId}`);
}

/** A submission the judge marks correct, or one it marks wrong, for the question shown. */
function submissionFor(question: QuestionSpec, correct: boolean): unknown {
  const p = question.payload;
  switch (question.lockType) {
    case 'rune-cipher':
      return { text: correct ? (p as RuneCipherQuestion).answer : 'zzz-not-it' };
    case 'seance-board': {
      const q = p as SeanceBoardQuestion;
      const wrong = q.optionIds.find((o) => o !== q.keyOptionId) ?? '';
      return { selectedOptionId: correct ? q.keyOptionId : wrong };
    }
    case 'cursed-object': {
      const q = p as CursedObjectQuestion;
      const wrong = q.optionIds.find((o) => o !== q.oddOneOutId) ?? '';
      return { selectedId: correct ? q.oddOneOutId : wrong };
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

type Step =
  | { readonly kind: 'answer'; readonly slot: number; readonly correct: boolean }
  | { readonly kind: 'skip' | 'challenge' | 'hint' | 'open' | 'continue'; readonly slot: number };

const stepArb: fc.Arbitrary<Step> = fc.oneof(
  fc.record({
    kind: fc.constant('answer' as const),
    slot: fc.nat(slotIds.length - 1),
    correct: fc.boolean(),
  }),
  fc.record({
    kind: fc.constantFrom('skip' as const, 'challenge' as const, 'hint' as const, 'open' as const, 'continue' as const),
    slot: fc.nat(slotIds.length - 1),
  }),
);

const roomIds = manifest.rooms.map((r) => r.roomId);
const setupEvents: Event[] = [
  { kind: 'RunStarted', manifestId: manifest.manifestId },
  ...roomIds.map((roomId): Event => ({ kind: 'RoomPublished', roomId })),
  ...(roomIds[0] === undefined ? [] : [{ kind: 'RoomEntered', roomId: roomIds[0] } as Event]),
];

function startState(): State {
  let state = initial(manifest, SETTINGS);
  for (const event of setupEvents) {
    const result = apply(state, event);
    if (!result.ok) throw new Error(`setup rejected: ${result.error.kind}`);
    state = result.state;
  }
  return state;
}

function eventFor(state: State, step: Step): Event | null {
  const slotId = slotIds[step.slot];
  if (slotId === undefined) return null;
  switch (step.kind) {
    case 'answer': {
      const slot = state.rooms.flatMap((r) => r.lockSlots).find((s) => s.slotId === slotId);
      if (slot === undefined) return null;
      const submission = submissionFor(questionById(slot.currentQuestionId), step.correct);
      return { kind: 'AnswerSubmitted', slotId, submission };
    }
    case 'skip':
      return { kind: 'Skipped', slotId };
    case 'challenge':
      return { kind: 'Challenged', slotId };
    case 'hint':
      return { kind: 'HintUsed', slotId };
    case 'open':
      return { kind: 'LockOpened', slotId };
    case 'continue':
      return { kind: 'EvidenceContinued', slotId };
  }
}

function assertCandleFlags(state: State): void {
  const views = [
    ...selectRooms(state).flatMap((r) => [...r.lockSlots, ...r.returnSlots]),
    ...selectFinalDoor(state).slots,
  ];
  for (const view of views) {
    expect(view.candleLit).toBe(view.status === 'solved');
  }
}

/** Feature: room-runtime, Property 14: Slot status and candle flag follow judged history */
describe('Property 14: Slot status and candle flag follow judged history', () => {
  /** **Validates: Requirements 31.2, 31.3, 31.4, 31.5, 31.6** */
  it('status follows the judged history and candleLit is true iff solved', () => {
    fc.assert(
      fc.property(fc.array(stepArb, { maxLength: 40 }), (steps) => {
        let state = startState();
        // Independent model of each Lock_Slot's status and whether its primary was challenged.
        const expected = new Map<string, SlotStatus>(slotIds.map((id) => [id, 'open']));
        const replaced = new Set<string>();
        assertCandleFlags(state);
        for (const step of steps) {
          const event = eventFor(state, step);
          if (event === null) continue;
          const before = state;
          const result = apply(state, event);
          if (!result.ok) {
            expect(state).toBe(before);
          } else {
            state = result.state;
            if (event.kind === 'AnswerSubmitted' && step.kind === 'answer') {
              expected.set(event.slotId, step.correct ? 'solved' : 'settled');
            } else if (event.kind === 'Skipped') {
              expected.set(event.slotId, 'settled');
            } else if (event.kind === 'Challenged') {
              const spec = specs.find((s) => s.slotId === event.slotId);
              const canReplace = spec?.alternateQuestion != null && !replaced.has(event.slotId);
              if (canReplace) replaced.add(event.slotId);
              expected.set(event.slotId, canReplace ? 'open' : 'challenged');
            }
          }
          const actual = new Map(
            state.rooms.flatMap((r) => r.lockSlots).map((s) => [s.slotId, s.status] as const),
          );
          expect(actual).toEqual(expected);
          assertCandleFlags(state);
        }
      }),
      { numRuns: 100 },
    );
  });
});
