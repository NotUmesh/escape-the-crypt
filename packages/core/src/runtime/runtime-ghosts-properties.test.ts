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
import type { Event } from '../types';
import { apply } from './apply';
import { initial } from './initial';
import type { CryptManifest, QuestionSpec } from './manifest-types';
import type { State } from './state-types';

type Intent = 'correct' | 'wrong';

/** A submission for `question` that the judge marks correct, or never marks correct. */
function submissionFor(question: QuestionSpec, intent: Intent): unknown {
  const p = question.payload;
  const good = intent === 'correct';
  switch (question.lockType) {
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

function questionById(manifest: CryptManifest, questionId: string): QuestionSpec | null {
  for (const room of manifest.rooms) {
    for (const spec of room.lockSlots) {
      if (spec.primaryQuestion.questionId === questionId) return spec.primaryQuestion;
      if (spec.alternateQuestion?.questionId === questionId) return spec.alternateQuestion;
    }
  }
  for (const slot of manifest.finalDoor.slots) {
    if (slot.question.questionId === questionId) return slot.question;
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
  // Mostly wrong, so ghosts and returns happen often.
  intent: fc.constantFrom<Intent>('wrong', 'wrong', 'wrong', 'correct'),
  noise: eventArb,
});

interface OpenSlot {
  readonly slotId: string;
  readonly questionId: string;
}

function openSlots(state: State): OpenSlot[] {
  const out: OpenSlot[] = [];
  for (const room of state.rooms) {
    for (const s of room.lockSlots) out.push({ slotId: s.slotId, questionId: s.currentQuestionId });
    for (const s of room.dueReturnSlots) out.push({ slotId: s.slotId, questionId: s.currentQuestionId });
  }
  for (const s of state.finalDoor.slots) out.push({ slotId: s.slotId, questionId: s.currentQuestionId });
  return out;
}

function candidates(state: State, step: Step): Event[] {
  const out: Event[] = [
    step.noise,
    { kind: 'FinalDoorEntered' },
    { kind: 'RunStarted', manifestId: state.manifestId },
  ];
  for (const room of state.rooms) {
    out.push({ kind: 'RoomPublished', roomId: room.roomId });
    for (let i = 0; i < 6; i += 1) out.push({ kind: 'RoomEntered', roomId: room.roomId });
  }
  for (const { slotId, questionId } of openSlots(state)) {
    out.push({ kind: 'LockOpened', slotId });
    out.push({ kind: 'HintUsed', slotId });
    out.push({ kind: 'Skipped', slotId });
    out.push({ kind: 'Challenged', slotId });
    out.push({ kind: 'EvidenceContinued', slotId });
    const q = questionById(state.manifest, questionId);
    if (q === null) continue;
    // Weight answers up so runs reach ghosts and returns.
    for (let i = 0; i < 12; i += 1) {
      out.push({ kind: 'AnswerSubmitted', slotId, submission: submissionFor(q, step.intent) });
    }
  }
  return out;
}

function checkInvariant(state: State): void {
  const seen = new Set<string>();
  for (const g of state.ghosts) {
    expect(seen.has(g.conceptId)).toBe(false);
    seen.add(g.conceptId);
    expect([1, 2]).toContain(g.returnNumber);
  }
  const openReturns = new Set<string>();
  for (const room of state.rooms) {
    for (const r of room.dueReturnSlots) {
      expect([1, 2]).toContain(r.returnNumber);
      if (r.status !== 'open') continue;
      expect(openReturns.has(r.conceptId)).toBe(false);
      openReturns.add(r.conceptId);
    }
  }
}

/** Feature: room-runtime, Property 3: At most one pending ghost per concept, capped at return 2 */
describe('Property 3: At most one pending ghost per concept, capped at return 2', () => {
  /** **Validates: Requirements 14.7, 14.8** */
  it('holds in every intermediate state of random runs', () => {
    let ghostsSeen = 0;
    let returnsSeen = 0;
    fc.assert(
      fc.property(manifestArb, fc.array(stepArb, { minLength: 10, maxLength: 100 }), (manifest, steps) => {
        let state = initial(manifest, SETTINGS);
        checkInvariant(state);
        const first = manifest.rooms[0];
        const prefix: Event[] = [
          { kind: 'RunStarted', manifestId: manifest.manifestId },
          ...manifest.rooms.map((r): Event => ({ kind: 'RoomPublished', roomId: r.roomId })),
          ...(first === undefined ? [] : [{ kind: 'RoomEntered', roomId: first.roomId } as const]),
        ];
        for (const event of prefix) {
          const result = apply(state, event);
          if (result.ok) state = result.state;
        }
        checkInvariant(state);
        for (const step of steps) {
          const list = candidates(state, step);
          const event = list[step.pick % list.length];
          if (event === undefined) continue;
          const result = apply(state, event);
          if (!result.ok) continue;
          state = result.state;
          ghostsSeen += state.ghosts.length;
          returnsSeen += state.rooms.reduce((n, r) => n + r.dueReturnSlots.length, 0);
          checkInvariant(state);
        }
      }),
      { numRuns: 200 },
    );
    expect(ghostsSeen).toBeGreaterThan(0); // the generator does reach ghosts
    expect(returnsSeen).toBeGreaterThan(0);
  });
});
