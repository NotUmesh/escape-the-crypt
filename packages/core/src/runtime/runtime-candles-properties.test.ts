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
import { eventArb, manifestArb } from '../test-support/arbitraries';
import { SETTINGS } from '../test-support/run-settings';
import type { Event, LockType } from '../types';
import { apply } from './apply';
import { initial } from './initial';
import type { QuestionSpec } from './manifest-types';
import type { State } from './state-types';

type Intent = 'correct' | 'wrong';

/** A submission for `question` that the judge must mark correct, or never mark correct. */
function submissionFor(question: QuestionSpec, intent: Intent): unknown {
  const type: LockType = question.lockType;
  const p = question.payload;
  const good = intent === 'correct';
  switch (type) {
    case 'rune-cipher':
      return { text: good ? (p as RuneCipherQuestion).answer : 'zzz-not-the-answer' };
    case 'seance-board': {
      const q = p as SeanceBoardQuestion;
      const other = q.optionIds.find((o) => o !== q.keyOptionId) ?? null;
      return { selectedOptionId: good ? q.keyOptionId : other };
    }
    case 'cursed-object': {
      const q = p as CursedObjectQuestion;
      const other = q.optionIds.find((o) => o !== q.oddOneOutId) ?? null;
      return { selectedId: good ? q.oddOneOutId : other };
    }
    case 'bone-ordering': {
      const q = p as BoneOrderingQuestion;
      const order = [...q.keyOrder];
      if (!good) order.reverse();
      return { order };
    }
    case 'bound-threads': {
      const q = p as BoundThreadsQuestion;
      const rights = q.keyPairs.map((pair) => pair[1]);
      const shifted = [...rights.slice(1), ...rights.slice(0, 1)];
      const pairs = good ? q.keyPairs : q.keyPairs.map((pair, i) => [pair[0], shifted[i] ?? pair[1]]);
      return { pairs };
    }
    case 'combination-dial':
      return { rawInput: good ? String((p as CombinationDialQuestion).exactValue) : '999.9' };
  }
}

/** The question a Lock_Slot currently shows, found in the manifest. */
function shownQuestion(state: State, slotId: string, questionId: string): QuestionSpec | null {
  for (const room of state.manifest.rooms) {
    for (const spec of room.lockSlots) {
      if (spec.slotId !== slotId) continue;
      if (spec.primaryQuestion.questionId === questionId) return spec.primaryQuestion;
      if (spec.alternateQuestion?.questionId === questionId) return spec.alternateQuestion;
    }
  }
  return null;
}

interface Step {
  readonly pick: number;
  readonly intent: Intent;
  readonly noise: Event;
}

const stepArb: fc.Arbitrary<Step> = fc.record({
  pick: fc.nat(1000),
  intent: fc.constantFrom<Intent>('correct', 'wrong'),
  noise: eventArb,
});

/** One accepted AnswerSubmitted that was built to be correct counts for one candle. */
interface Chosen {
  readonly event: Event;
  readonly countsAsCandle: boolean;
}

/** Candidate events valid-looking against the live state, plus junk and run-level events. */
function candidates(state: State, step: Step): Chosen[] {
  const out: Chosen[] = [
    { event: { kind: 'RunStarted', manifestId: state.manifestId }, countsAsCandle: false },
    { event: step.noise, countsAsCandle: false },
    { event: { kind: 'RunLeft' }, countsAsCandle: false },
    { event: { kind: 'RunResumed' }, countsAsCandle: false },
    { event: { kind: 'FinalDoorEntered' }, countsAsCandle: false },
  ];
  for (const room of state.rooms) {
    out.push({ event: { kind: 'RoomPublished', roomId: room.roomId }, countsAsCandle: false });
    out.push({ event: { kind: 'RoomEntered', roomId: room.roomId }, countsAsCandle: false });
    for (const slot of room.lockSlots) {
      const slotId = slot.slotId;
      out.push({ event: { kind: 'LockOpened', slotId }, countsAsCandle: false });
      out.push({ event: { kind: 'HintUsed', slotId }, countsAsCandle: false });
      out.push({ event: { kind: 'Skipped', slotId }, countsAsCandle: false });
      out.push({ event: { kind: 'Challenged', slotId }, countsAsCandle: false });
      out.push({ event: { kind: 'EvidenceContinued', slotId }, countsAsCandle: false });
      const q = shownQuestion(state, slotId, slot.currentQuestionId);
      if (q === null) continue;
      // Weight answers up by listing them twice so runs reach candles.
      for (let i = 0; i < 2; i += 1) {
        out.push({
          event: { kind: 'AnswerSubmitted', slotId, submission: submissionFor(q, step.intent) },
          countsAsCandle: step.intent === 'correct',
        });
      }
    }
  }
  return out;
}

/** Feature: room-runtime, Property 2: Candles track non-challenged correct answers only */
describe('Property 2: Candles track non-challenged correct answers only', () => {
  /** **Validates: Requirements 13.1, 13.2, 13.3, 13.4** */
  it('candleCount rises by one per accepted correct answer and never otherwise', () => {
    let totalCandles = 0;
    fc.assert(
      fc.property(manifestArb, fc.array(stepArb, { minLength: 10, maxLength: 80 }), (manifest, steps) => {
        // Deterministic prefix: start, publish and enter room 1, so every run can reach answers
        // regardless of what the random steps pick. It adds no candles.
        let state = initial(manifest, SETTINGS);
        const first = manifest.rooms[0];
        if (first === undefined) throw new Error('manifest has no rooms');
        const prefix: Event[] = [
          { kind: 'RunStarted', manifestId: manifest.manifestId },
          ...manifest.rooms.map((r): Event => ({ kind: 'RoomPublished', roomId: r.roomId })),
          { kind: 'RoomEntered', roomId: first.roomId },
        ];
        for (const event of prefix) {
          const started = apply(state, event);
          if (!started.ok) throw new Error(`prefix rejected: ${started.error.kind}`);
          state = started.state;
        }
        let expected = 0;
        for (const step of steps) {
          const list = candidates(state, step);
          const chosen = list[step.pick % list.length];
          if (chosen === undefined) continue;
          const result = apply(state, chosen.event);
          if (!result.ok) {
            expect(result.error.kind).toBeTypeOf('string');
            continue;
          }
          const before = state.candleCount;
          if (chosen.countsAsCandle) expected += 1;
          state = result.state;
          expect(state.candleCount - before).toBe(chosen.countsAsCandle ? 1 : 0);
          expect(state.candleCount).toBe(expected);
        }
        totalCandles += expected;
        // Candles equal the lit lock candles: challenged and settled slots hold none.
        const lit = state.rooms.flatMap((r) => r.lockSlots).filter((s) => s.candleLit);
        expect(lit.length).toBe(state.candleCount);
        for (const slot of state.rooms.flatMap((r) => r.lockSlots)) {
          expect(slot.candleLit).toBe(slot.status === 'solved');
        }
      }),
      { numRuns: 200 },
    );
    expect(totalCandles).toBeGreaterThan(0); // the generator does reach candles
  });

  it('a correct answer in the entered room lights exactly one candle (coverage guard)', () => {
    fc.assert(
      fc.property(manifestArb, (manifest) => {
        let state = initial(manifest, SETTINGS);
        const first = manifest.rooms[0];
        if (first === undefined) throw new Error('manifest has no rooms');
        const setup: Event[] = [
          { kind: 'RunStarted', manifestId: manifest.manifestId },
          ...manifest.rooms.map((r): Event => ({ kind: 'RoomPublished', roomId: r.roomId })),
          { kind: 'RoomEntered', roomId: first.roomId },
        ];
        for (const event of setup) {
          const r = apply(state, event);
          if (!r.ok) throw new Error(`rejected: ${r.error.kind}`);
          state = r.state;
        }
        const slot = state.rooms[0]?.lockSlots[0];
        if (slot === undefined) throw new Error('no slot');
        const q = shownQuestion(state, slot.slotId, slot.currentQuestionId);
        if (q === null) throw new Error('no question');
        const r = apply(state, {
          kind: 'AnswerSubmitted',
          slotId: slot.slotId,
          submission: submissionFor(q, 'correct'),
        });
        expect(r.ok && r.state.candleCount).toBe(1);
      }),
      { numRuns: 50 },
    );
  });
});
