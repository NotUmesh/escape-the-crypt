import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { buildManifest } from '../test-support/manifest-fixture';
import { submissionFor } from '../test-support/question-answers';
import { SETTINGS } from '../test-support/run-settings';
import { questionFor } from '../test-support/runtime-model-support';
import { LOCK_TYPES } from '../types';
import type { Event, LockType } from '../types';
import { apply } from './apply';
import { initial } from './initial';
import type { CryptManifest } from './manifest-types';
import { deriveAllOutcomes } from './outcomes';
import type { ConceptOutcome, State } from './state-types';

type Action = 'correct' | 'wrong' | 'skip' | 'challenge';
const ACTIONS: readonly Action[] = ['correct', 'wrong', 'wrong', 'skip', 'challenge', 'challenge'];

/** One accepted act on a concept's question, recorded by the driver (never read from State). */
interface LogEntry {
  readonly conceptId: string;
  readonly act: Action;
}

interface Target {
  readonly slotId: string;
  readonly conceptId: string | null; // null: a reserved Final_Door question
  readonly returnNumber: number; // 0: first asked in a Lock_Slot (primary or in-place Alternate)
  readonly questionId: string;
  readonly questionType: LockType;
}

function step(state: State, event: Event): State {
  const result = apply(state, event);
  if (!result.ok) throw new Error(`${event.kind} rejected: ${result.error.kind}`);
  return result.state;
}

function conceptOfLockSlot(manifest: CryptManifest, slotId: string): string {
  const spec = manifest.rooms.flatMap((r) => r.lockSlots).find((s) => s.slotId === slotId);
  if (spec === undefined) throw new Error(`no spec for ${slotId}`);
  return spec.conceptId;
}

function nextTarget(state: State): Target | undefined {
  if (state.atFinalDoor) {
    const slot = state.finalDoor.slots.find((s) => s.status === 'open');
    if (slot === undefined) return undefined;
    return {
      slotId: slot.slotId,
      conceptId: slot.origin === 'reserved' ? null : slot.conceptId,
      returnNumber: slot.returnNumber ?? 0,
      questionId: slot.currentQuestionId,
      questionType: slot.currentQuestionType,
    };
  }
  const room = state.rooms.find((r) => r.roomId === state.currentRoomId);
  const lock = room?.lockSlots.find((s) => s.status === 'open');
  if (lock !== undefined) {
    return {
      slotId: lock.slotId,
      conceptId: conceptOfLockSlot(state.manifest, lock.slotId),
      returnNumber: 0,
      questionId: lock.currentQuestionId,
      questionType: lock.currentQuestionType,
    };
  }
  const ret = room?.dueReturnSlots.find((s) => s.status === 'open');
  if (ret === undefined) return undefined;
  return {
    slotId: ret.slotId,
    conceptId: ret.conceptId,
    returnNumber: ret.returnNumber,
    questionId: ret.currentQuestionId,
    questionType: ret.currentQuestionType,
  };
}

/** The policy table: an action per (concept, return number, lock type). */
function tableAction(actions: readonly Action[], conceptIndex: number, returnNumber: number, type: LockType): Action {
  const index = (conceptIndex * 3 + returnNumber) * LOCK_TYPES.length + LOCK_TYPES.indexOf(type);
  return actions[index % actions.length] ?? 'wrong';
}

interface Plan {
  readonly table: readonly Action[];
  readonly reserved: readonly Action[];
  /** What the first question shown for the focus concept gets. */
  readonly focus: string;
  readonly focusFirst: 'challenge' | 'skip';
}

interface Played {
  readonly state: State;
  readonly log: readonly LogEntry[];
}

/** Plays a whole run to the escape. Every answer is keyed by concept, never by position. */
function play(manifest: CryptManifest, plan: Plan): Played {
  const conceptIds = manifest.rooms.flatMap((r) => r.lockSlots.map((s) => s.conceptId));
  let state = initial(manifest, SETTINGS);
  state = step(state, { kind: 'RunStarted', manifestId: manifest.manifestId });
  for (const room of manifest.rooms) state = step(state, { kind: 'RoomPublished', roomId: room.roomId });
  state = step(state, { kind: 'CryptFinalised', finalRoomCount: manifest.rooms.length });
  const first = manifest.rooms[0];
  if (first === undefined) throw new Error('fixture');
  state = step(state, { kind: 'RoomEntered', roomId: first.roomId });

  const log: LogEntry[] = [];
  let reservedSeen = 0;
  for (let guard = 0; guard < 500 && state.status !== 'escaped'; guard += 1) {
    const target = nextTarget(state);
    if (target === undefined) {
      if (state.atFinalDoor) throw new Error('door closed without escape');
      if (state.finalDoor.available) {
        state = step(state, { kind: 'FinalDoorEntered' });
        continue;
      }
      const index = state.rooms.findIndex((r) => r.roomId === state.currentRoomId);
      const next = manifest.rooms[index + 1];
      if (next === undefined) throw new Error('stuck: no next room');
      state = step(state, { kind: 'RoomEntered', roomId: next.roomId });
      continue;
    }
    let act: Action;
    if (target.conceptId === null) {
      act = plan.reserved[reservedSeen % plan.reserved.length] ?? 'wrong';
      reservedSeen += 1;
    } else if (target.conceptId === plan.focus && !log.some((e) => e.conceptId === plan.focus)) {
      act = plan.focusFirst;
    } else {
      act = tableAction(plan.table, conceptIds.indexOf(target.conceptId), target.returnNumber, target.questionType);
    }
    const event: Event =
      act === 'skip'
        ? { kind: 'Skipped', slotId: target.slotId }
        : act === 'challenge'
          ? { kind: 'Challenged', slotId: target.slotId }
          : {
              kind: 'AnswerSubmitted',
              slotId: target.slotId,
              submission: submissionFor(questionFor(manifest, target.questionId), act === 'correct'),
            };
    state = step(state, event);
    if (target.conceptId !== null) log.push({ conceptId: target.conceptId, act });
  }
  if (state.status !== 'escaped') throw new Error('did not escape');
  return { state, log };
}

/**
 * Independent oracle from the driver's own log (Req 22.2 to 22.4, 17.4). Every act on a concept
 * is a challenge: Challenged. No correct answer at all: Review due. Otherwise a correct answer
 * preceded by a wrong answer or skip is Retried, else First-try correct (no hints are used).
 */
function oracle(log: readonly LogEntry[], conceptId: string): ConceptOutcome {
  const acts = log.filter((e) => e.conceptId === conceptId).map((e) => e.act);
  if (acts.every((a) => a === 'challenge')) return 'challenged';
  const firstCorrect = acts.indexOf('correct');
  if (firstCorrect < 0) return 'review-due';
  const before = acts.slice(0, firstCorrect);
  return before.some((a) => a === 'wrong' || a === 'skip') ? 'retried' : 'first-try-correct';
}

const planArb = fc.record({
  rooms: fc.integer({ min: 1, max: 3 }),
  conceptsPerRoom: fc.integer({ min: 1, max: 4 }),
  alternates: fc.array(fc.boolean(), { minLength: 4, maxLength: 4 }),
  table: fc.array(fc.constantFrom(...ACTIONS), { minLength: 216, maxLength: 216 }),
  reserved: fc.array(fc.constantFrom(...ACTIONS), { minLength: 1, maxLength: 4 }),
  focusPick: fc.nat(20),
});

/** Feature: room-runtime, Property 9: Challenging is free, isolated and follows the outcome precedence (parts b and c) */
describe('Property 9 (b, c): paired runs, challenge versus skip on the first question of one concept', () => {
  /** **Validates: Requirements 17.5, 22.2, 22.3, 22.4** */
  it('leaves other concepts unchanged and gives the focus concept the oracle outcome', () => {
    let armsDiffered = 0;
    fc.assert(
      fc.property(planArb, (setup) => {
        const manifest = buildManifest({
          rooms: setup.rooms,
          conceptsPerRoom: setup.conceptsPerRoom,
          alternates: (_room, concept) => setup.alternates[concept] ?? true,
        });
        const conceptIds = manifest.rooms.flatMap((r) => r.lockSlots.map((s) => s.conceptId));
        const focus = conceptIds[setup.focusPick % conceptIds.length] ?? '';
        const base = { table: setup.table, reserved: setup.reserved, focus };
        const a = play(manifest, { ...base, focusFirst: 'challenge' });
        const b = play(manifest, { ...base, focusFirst: 'skip' });

        const outA = deriveAllOutcomes(a.state);
        const outB = deriveAllOutcomes(b.state);
        // (b) Every other concept ends the same, outcome and record, whatever the pacing.
        for (const id of conceptIds.filter((c) => c !== focus)) {
          expect(outA[id]).toBe(outB[id]);
          expect(a.state.concepts.find((c) => c.conceptId === id)).toEqual(
            b.state.concepts.find((c) => c.conceptId === id),
          );
          expect(outA[id]).toBe(oracle(a.log, id));
        }
        if (outA[focus] !== outB[focus]) armsDiffered += 1;
        // (c) The focus concept follows the precedence, in both arms.
        for (const [arm, outcomes] of [[a, outA], [b, outB]] as const) {
          expect(outcomes[focus]).toBe(oracle(arm.log, focus));
        }
      }),
      { numRuns: 150 },
    );
    expect(armsDiffered).toBeGreaterThan(0); // the pair is not vacuous
  });
});
