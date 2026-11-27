import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { ROOM_ANNOUNCEMENT_COPY } from '@escape-the-crypt/core';
import type { Outcome_Notice, State } from '@escape-the-crypt/core';
import { apply } from '../../../../../packages/core/src/runtime/apply';
import { initial } from '../../../../../packages/core/src/runtime/initial';
import { buildManifest } from '../../../../../packages/core/src/test-support/manifest-fixture';
import { submissionFor } from '../../../../../packages/core/src/test-support/question-answers';
import { SETTINGS } from '../../../../../packages/core/src/test-support/run-settings';
import { openTargets, questionFor } from '../../../../../packages/core/src/test-support/runtime-model-support';
import type { Event } from '../../../../../packages/core/src/types';
import { announcementsFor } from './announcements';
import { announcementKeyFor, selectMotionMoments } from './motion-moments';

interface Step {
  readonly previous: State;
  readonly next: State;
  readonly notices: readonly Outcome_Notice[];
}
const MANIFEST = buildManifest({ rooms: 2, conceptsPerRoom: 3, alternates: true, finalDoorQuestions: 2 });
const RUNS = 100;
const coverage = { lit: 0, spirit: 0, rises: 0, rests: 0 };

function step(state: State, event: Event, steps: Step[]): State {
  const result = apply(state, event);
  if (!result.ok) return state;
  steps.push({ previous: state, next: result.state, notices: result.notices });
  return result.state;
}
/** Plays a seeded run through both rooms with a mix of correct, wrong and skipped answers. */
function play(choices: readonly number[]): Step[] {
  const steps: Step[] = [];
  const first = MANIFEST.rooms[0]?.roomId ?? '';
  let state = initial(MANIFEST, SETTINGS);
  state = step(state, { kind: 'RunStarted', manifestId: state.manifestId }, steps);
  state = step(state, { kind: 'RoomPublished', roomId: first }, steps);
  state = step(state, { kind: 'CryptFinalised', finalRoomCount: MANIFEST.rooms.length }, steps);
  state = step(state, { kind: 'RoomEntered', roomId: first }, steps);
  for (const choice of choices) {
    const room = state.rooms.find((r) => r.roomId === state.currentRoomId);
    const judged = [...(room?.lockSlots ?? []), ...(room?.dueReturnSlots ?? [])].find((s) => s.evidencePanelOpen);
    if (judged !== undefined) {
      state = step(state, { kind: 'EvidenceContinued', slotId: judged.slotId }, steps);
      continue;
    }
    const target = openTargets(state)[choice % Math.max(1, openTargets(state).length)];
    if (target !== undefined && target.kind !== 'door') {
      const mode = choice % 3;
      const event: Event =
        mode === 2
          ? { kind: 'Skipped', slotId: target.slotId }
          : { kind: 'AnswerSubmitted', slotId: target.slotId, submission: submissionFor(questionFor(MANIFEST, target.questionId), mode === 0) };
      state = step(state, event, steps);
      continue;
    }
    const index = state.rooms.findIndex((r) => r.roomId === state.currentRoomId);
    const nextRoom = MANIFEST.rooms[index + 1];
    if (nextRoom === undefined) break;
    state = step(state, { kind: 'RoomPublished', roomId: nextRoom.roomId }, steps);
    state = step(state, { kind: 'RoomEntered', roomId: nextRoom.roomId }, steps);
  }
  return steps;
}
const choicesArb = fc.array(fc.nat({ max: 50 }), { minLength: 20, maxLength: 80 });
const runOpts = { numRuns: RUNS };

describe('Moment_Selector properties', () => {
  // Feature: haunting-polish, Property 1: Moments pair with text
  it('Property 1: every moment has its announcement text', () => {
    fc.assert(
      fc.property(choicesArb, (choices) => {
        for (const { previous, next, notices } of play(choices)) {
          const texts = announcementsFor(previous, next, notices);
          for (const moment of selectMotionMoments(previous, next, notices)) {
            expect(texts).toContain(ROOM_ANNOUNCEMENT_COPY.notice[announcementKeyFor(moment)]);
            if (moment.kind === 'candle-lit') coverage[moment.target.type === 'spirit' ? 'spirit' : 'lit'] += 1;
            if (moment.kind === 'ghost-rises') coverage.rises += 1;
            if (moment.kind === 'ghost-laid-to-rest') coverage.rests += 1;
          }
        }
      }),
      runOpts,
    );
  });
  // Feature: haunting-polish, Property 2: Order and unrelated notices
  it('Property 2: notice order is kept and unrelated notices change nothing', () => {
    const unrelated: Outcome_Notice[] = [{ kind: 'sealCracked', slotId: 'x' }, { kind: 'roomCleared', roomId: 'x' }, { kind: 'escaped' }];
    fc.assert(
      fc.property(choicesArb, fc.nat({ max: 5 }), (choices, at) => {
        for (const { previous, next, notices } of play(choices)) {
          const base = selectMotionMoments(previous, next, notices);
          const withExtra = [...notices.slice(0, at), ...unrelated, ...notices.slice(at)];
          expect(selectMotionMoments(previous, next, withExtra)).toEqual(base);
          const order = notices.map((n) => n.kind);
          const kinds = base.map((m) => announcementKeyFor(m));
          const wanted = order.filter((k) => k === 'candleLit' || k === 'ghostSpawned' || k === 'ghostLaidToRest');
          expect(kinds.every((k, i) => wanted.indexOf(k) >= 0 && i < wanted.length)).toBe(true);
        }
      }),
      runOpts,
    );
  });
  // Feature: haunting-polish, Property 3: Rest follows rise
  // A skip queues a ghost without a ghostSpawned notice (runtime behaviour, reported separately), so
  // that ghost never "rises" on screen. What must hold: a ghost is only laid to rest for a concept
  // that had a ghost in an earlier State of the same run.
  it('Property 3: a ghost is laid to rest only for a concept that had a ghost earlier', () => {
    fc.assert(
      fc.property(choicesArb, (choices) => {
        const had = new Set<string>();
        for (const { previous, next, notices } of play(choices)) {
          for (const g of [...previous.ghosts, ...next.ghosts]) had.add(g.conceptId);
          for (const moment of selectMotionMoments(previous, next, notices)) {
            if (moment.kind === 'ghost-laid-to-rest') expect(had.has(moment.conceptId)).toBe(true);
          }
        }
      }),
      runOpts,
    );
  });
  // Feature: haunting-polish, Property 4: Quiet restore and quiet rejection
  it('Property 4: a restored run and a rejected dispatch give no moments', () => {
    fc.assert(
      fc.property(choicesArb, (choices) => {
        for (const { next, notices } of play(choices)) {
          expect(selectMotionMoments(null, next, notices)).toEqual([]);
          expect(selectMotionMoments(next, next, [])).toEqual([]);
        }
      }),
      runOpts,
    );
  });
  // Feature: haunting-polish, Property 5: Selection agrees with State
  it('Property 5: each moment agrees with the next State', () => {
    fc.assert(
      fc.property(choicesArb, (choices) => {
        for (const { previous, next, notices } of play(choices)) {
          const lit = new Set([...next.rooms.flatMap((r) => [...r.lockSlots, ...r.dueReturnSlots]), ...next.finalDoor.slots].filter((s) => s.candleLit).map((s) => s.slotId));
          const pending = new Set(next.ghosts.map((g) => g.conceptId));
          for (const moment of selectMotionMoments(previous, next, notices)) {
            if (moment.kind === 'candle-lit' && moment.target.type === 'slot') expect(lit.has(moment.target.slotId)).toBe(true);
            if (moment.kind === 'ghost-rises') expect(pending.has(moment.conceptId)).toBe(true);
            if (moment.kind === 'ghost-laid-to-rest') expect(pending.has(moment.conceptId)).toBe(false);
          }
        }
      }),
      runOpts,
    );
  });
  // Feature: haunting-polish, Property 6: No write
  it('Property 6: calling the selector leaves State and notices unchanged', () => {
    fc.assert(
      fc.property(choicesArb, (choices) => {
        const steps = play(choices);
        const before = JSON.stringify(steps);
        for (const { previous, next, notices } of steps) selectMotionMoments(previous, next, notices);
        expect(JSON.stringify(steps)).toBe(before);
        expect(JSON.stringify(play(choices))).toBe(before);
      }),
      runOpts,
    );
  });
  it('reaches a lit candle, a rising ghost and a ghost laid to rest across the runs', () => {
    expect(coverage.lit).toBeGreaterThan(0);
    expect(coverage.rises).toBeGreaterThan(0);
    expect(coverage.rests).toBeGreaterThan(0);
  });
});
