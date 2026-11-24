import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { manifestArb } from '../test-support/arbitraries';
import { SETTINGS } from '../test-support/run-settings';
import {
  answerBeforeStart,
  answerSubmitted,
  challenged,
  doubleSubmit,
  enterUnknownRoom,
  evidenceContinued,
  hintAtZero,
  hintUsed,
  lockOpened,
  roomEntered,
  roomPublished,
  roomPublishedAgain,
  runStarted,
  runStartedAgain,
  skipped,
  staleSlot,
} from '../test-support/runtime-model-commands';
import type { RuntimeCommand } from '../test-support/runtime-model-commands';
import type { Model, Real, TraceEntry } from '../test-support/runtime-model-support';
import { playToEscape } from '../test-support/escape-driver';
import {
  cryptFinalised,
  cryptShortened,
  eventAfterEscape,
  finalDoorEntered,
  learnerWhileLeft,
  nextRoomPublished,
  roomAdvanced,
  runLeft,
  runResumed,
} from '../test-support/runtime-model-escape-commands';
import { playEnteredRoom } from '../test-support/termination-driver';
import { apply } from './apply';
import { initial } from './initial';
import type { CryptManifest } from './manifest-types';
import { NOTICE_ORDER } from './notices';
import type { Outcome_Notice } from './notices';

type Policy = 'all wrong' | 'all skip' | 'all challenge' | 'seeded random';

const pickArb = fc.nat(1000);

/** Setup commands and the deliberately invalid variants, shared by every policy. */
const commonArbs: fc.Arbitrary<RuntimeCommand>[] = [
  fc.constant(null).map(runStarted),
  fc.constant(null).map(roomPublished),
  fc.constant(null).map(roomPublishedAgain),
  fc.constant(null).map(roomEntered),
  fc.constant(null).map(answerBeforeStart),
  fc.constant(null).map(runStartedAgain),
  fc.constant(null).map(staleSlot),
  fc.constant(null).map(enterUnknownRoom),
  pickArb.map(doubleSubmit),
  pickArb.map(hintAtZero),
  pickArb.map(lockOpened),
  pickArb.map(hintUsed),
  pickArb.map(evidenceContinued),
  fc.constant(null).map(nextRoomPublished),
  fc.constant(null).map(roomAdvanced),
  fc.constant(null).map(cryptFinalised),
  pickArb.map(cryptShortened),
  fc.constant(null).map(finalDoorEntered),
  fc.constant(null).map(runLeft),
  fc.constant(null).map(runResumed),
  fc.constant(null).map(learnerWhileLeft),
  fc.constant(null).map(eventAfterEscape),
];

/** Progression commands again, so the escape-leaning run reaches the final door often. */
const progressionArbs: fc.Arbitrary<RuntimeCommand>[] = [
  fc.constant(null).map(nextRoomPublished),
  fc.constant(null).map(roomAdvanced),
  fc.constant(null).map(cryptFinalised),
  fc.constant(null).map(finalDoorEntered),
];

/** The learner's choice of action, by policy. */
function learnerArbs(policy: Policy): fc.Arbitrary<RuntimeCommand>[] {
  switch (policy) {
    case 'all wrong':
      return [pickArb.map((p) => answerSubmitted(p, false))];
    case 'all skip':
      return [pickArb.map(skipped)];
    case 'all challenge':
      return [pickArb.map(challenged)];
    case 'seeded random':
      return [
        pickArb.map((p) => answerSubmitted(p, true)),
        pickArb.map((p) => answerSubmitted(p, false)),
        pickArb.map(skipped),
        pickArb.map(challenged),
      ];
  }
}

interface Coverage {
  returnSlots: number;
  ghostNotices: number;
  replacedBySeal: number;
  escaped: number;
  atDoor: number;
}

/** Count Return_Slots, ghostSpawned notices and sealCracked notices that left the slot open (a replacement). */
function tally(manifest: CryptManifest, real: Real, into: Coverage): void {
  if (real.state.status === 'escaped') into.escaped += 1;
  if (real.state.atFinalDoor) into.atDoor += 1;
  into.returnSlots += real.state.rooms.flatMap((r) => r.dueReturnSlots).length;
  let state = initial(manifest, SETTINGS);
  for (const { event } of real.trace ?? []) {
    const result = apply(state, event);
    if (!result.ok) throw new Error(`replay rejected ${event.kind}`);
    state = result.state;
    for (const n of result.notices) {
      if (n.kind === 'ghostSpawned') into.ghostNotices += 1;
      if (n.kind !== 'sealCracked') continue;
      const slot = state.rooms.flatMap((r) => r.lockSlots).find((s) => s.slotId === n.slotId);
      if (slot?.status === 'open') into.replacedBySeal += 1;
    }
  }
}

function runPolicy(
  policy: Policy,
  inspect?: (manifest: CryptManifest, real: Real) => void,
  leaning = false,
): Coverage {
  const coverage: Coverage = { returnSlots: 0, ghostNotices: 0, replacedBySeal: 0, escaped: 0, atDoor: 0 };
  const arbs = [...commonArbs, ...learnerArbs(policy), ...learnerArbs(policy), ...(leaning ? progressionArbs : [])];
  const commands = fc.commands(arbs, { size: 'large', maxCommands: leaning ? 300 : 120 });
  let reached = 0;
  fc.assert(
    fc.property(manifestArb, commands, (manifest, cmds) => {
      const setup = (): { model: Model; real: Real } => ({
        model: { started: false, published: false, entered: false, candles: 0, judged: 0, hints: 0 },
        real: { state: initial(manifest, SETTINGS), trace: [] },
      });
      const s = setup();
      fc.modelRun(() => s, cmds);
      reached += s.real.state.rooms.flatMap((r) => r.lockSlots).filter((x) => x.status !== 'open').length;
      tally(manifest, s.real, coverage);
      inspect?.(manifest, s.real);
    }),
    { numRuns: 100 },
  );
  // Coverage guard: the generated runs do reach settled slots.
  expect(reached).toBeGreaterThan(0);
  return coverage;
}

/** Replay the accepted events from the start and return each event's notices. */
function replayNotices(manifest: CryptManifest, trace: readonly TraceEntry[]): (readonly Outcome_Notice[])[] {
  let state = initial(manifest, SETTINGS);
  return trace.map(({ event }) => {
    const result = apply(state, event);
    if (!result.ok) throw new Error(`replay rejected ${event.kind}`);
    state = result.state;
    return result.notices;
  });
}

function checkNotices(manifest: CryptManifest, real: Real): void {
  const trace = real.trace ?? [];
  const first = replayNotices(manifest, trace);
  const second = replayNotices(manifest, trace);
  // Replaying twice emits the same notices in the same order, equal to the live run.
  expect(second).toEqual(first);
  expect(first).toEqual(trace.map((t) => t.notices));
  const noticeKinds: readonly string[] = NOTICE_ORDER;
  const cleared = new Set<string>();
  let escapes = 0;
  for (const { event, notices } of trace) {
    // One event's notices follow the fixed order.
    const ranks = notices.map((n) => NOTICE_ORDER.indexOf(n.kind));
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
    // Each notice is emitted once: roomCleared per room, escaped per run.
    for (const n of notices) {
      if (n.kind === 'roomCleared') {
        expect(cleared.has(n.roomId)).toBe(false);
        cleared.add(n.roomId);
      } else if (n.kind === 'escaped') escapes += 1;
    }
    // The event log never contains notices.
    expect(noticeKinds).not.toContain(event.kind);
    expect(Object.keys(event)).not.toContain('notices');
  }
  expect(escapes).toBeLessThanOrEqual(1);
  expect(JSON.stringify(real.state)).not.toContain('"notices"');
}

/**
 * Feature: room-runtime, Property 15: Notices are emitted once, in a fixed order, and identically on replay.
 */
describe('runtime notices (fc.commands)', () => {
  /** **Validates: Requirements 24.5, 24.7, 24.8** */
  it('emits notices once, in the fixed order, identically on replay', () => {
    runPolicy('seeded random', checkNotices);
  });
});

/**
 * Feature: room-runtime, Property 1: Termination (room play; the escape part follows below).
 * Later rooms cannot be entered before 6.1, so the entered room (room 1) is the room played.
 */
describe('runtime termination (room play)', () => {
  const policies: Policy[] = ['all wrong', 'all skip', 'all challenge', 'seeded random'];
  for (const policy of policies) {
    /** **Validates: Requirements 19.1, 19.2, 20.7** */
    it(`clears the entered room within totalConcepts x 4 prompts: ${policy}`, () => {
      fc.assert(
        fc.property(manifestArb, fc.nat(), (manifest, seed) => {
          const concepts = manifest.rooms[0]?.lockSlots.length ?? 0;
          const budget = concepts * 4;
          const result = playEnteredRoom(manifest, policy, seed, budget);
          expect(result.exhausted).toBe(false);
          expect(result.prompts).toBeLessThanOrEqual(budget);
          expect(result.state.rooms[0]?.cleared).toBe(true);
        }),
        { numRuns: 100 },
      );
    });
  }
});

/**
 * Feature: room-runtime, model-based harness over the handled event kinds.
 * Property 5 (invalid events are no-ops), with Properties 2, 3, 8 and 14 as invariants
 * checked after every command.
 */
describe('runtime model (fc.commands)', () => {
  const policies: Policy[] = ['all wrong', 'all skip', 'all challenge', 'seeded random'];
  for (const policy of policies) {
    /** **Validates: Requirements 3.1, 3.6, 3.7, 13.4, 14.7, 14.8, 18.4, 31.6** */
    it(`keeps every invariant and rejects invalid events as no-ops: ${policy}`, () => {
      const coverage = runPolicy(policy);
      // Coverage guards: the policies exercise the paths they are named for.
      if (policy === 'all wrong') {
        expect(coverage.returnSlots).toBeGreaterThan(0);
        expect(coverage.ghostNotices).toBeGreaterThan(0);
      }
      if (policy === 'all challenge') expect(coverage.replacedBySeal).toBeGreaterThan(0);
    });
  }
});

/**
 * Feature: room-runtime, Property 1: Termination (escape).
 * A whole run, with rooms published one at a time, an optional shortening and leave/resume,
 * escapes within (totalConcepts x 4) + reservedFinalDoorQuestionCount prompts.
 */
describe('runtime termination (escape)', () => {
  const policies: Policy[] = ['all wrong', 'all skip', 'all challenge', 'seeded random'];
  for (const policy of policies) {
    /** **Validates: Requirements 20.5, 20.7, 20.8, 20.9** */
    it(`escapes within (totalConcepts x 4) + reserved door questions: ${policy}`, () => {
      let shortenedRuns = 0;
      let leftRuns = 0;
      fc.assert(
        fc.property(manifestArb, fc.nat(), (manifest, seed) => {
          const result = playToEscape(manifest, policy, seed);
          expect(result.exhausted).toBe(false);
          expect(result.state.status).toBe('escaped');
          expect(result.prompts).toBeLessThanOrEqual(result.budget);
          // Every slot at the door is closed, and nothing is still waiting to return.
          expect(result.state.finalDoor.slots.every((s) => s.status !== 'open')).toBe(true);
          expect(result.state.ghosts).toEqual([]);
          if (result.shortened) shortenedRuns += 1;
          if (result.leaves > 0) leftRuns += 1;
        }),
        { numRuns: 100 },
      );
      // Coverage guards: shortening and leave/resume are exercised.
      expect(shortenedRuns).toBeGreaterThan(0);
      expect(leftRuns).toBeGreaterThan(0);
    });
  }

  for (const policy of policies) {
    /** **Validates: Requirements 20.5, 20.7, 20.8, 20.9** */
    it(`keeps every invariant through progression, the final door, leave and resume: ${policy}`, () => {
      const c = runPolicy(policy, undefined, true);
      expect(c.atDoor).toBeGreaterThan(0);
      // Skips and challenges settle fastest, so those runs reach the escape within the command budget.
      if (policy === 'all skip' || policy === 'all challenge') expect(c.escaped).toBeGreaterThan(0);
    }, 60_000);
  }
});