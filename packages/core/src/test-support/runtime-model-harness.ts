import fc from 'fast-check';
import { expect } from 'vitest';
import { manifestArb } from './arbitraries';
import { SETTINGS } from './run-settings';
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
} from './runtime-model-commands';
import type { RuntimeCommand } from './runtime-model-commands';
import type { Model, Real } from './runtime-model-support';
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
} from './runtime-model-escape-commands';
import { apply } from '../runtime/apply';
import { initial } from '../runtime/initial';
import type { CryptManifest } from '../runtime/manifest-types';

export type Policy = 'all wrong' | 'all skip' | 'all challenge' | 'seeded random';

export const POLICIES: Policy[] = ['all wrong', 'all skip', 'all challenge', 'seeded random'];

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

export interface Coverage {
  returnSlots: number;
  ghostNotices: number;
  replacedBySeal: number;
  escaped: number;
  atDoor: number;
}

export function emptyCoverage(): Coverage {
  return { returnSlots: 0, ghostNotices: 0, replacedBySeal: 0, escaped: 0, atDoor: 0 };
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

/**
 * Pinned run for the coverage guards. With this seed and run count every policy reaches
 * return slots, ghostSpawned notices, replacing sealCracked notices, the final door and (skip/challenge) escape.
 */
export const COVERAGE_RUN = { seed: 424242, numRuns: 100 } as const;

export interface PolicyOptions {
  inspect?: (manifest: CryptManifest, real: Real) => void;
  leaning?: boolean;
  /** When set, the run uses this fixed seed and collects coverage counters into `coverage`. */
  coverage?: Coverage;
}

/**
 * Run the model-based property for a policy. Without `coverage` the seed is random (invariant run);
 * with `coverage` the seed is fixed so the counters are reproducible.
 */
export function runPolicy(policy: Policy, options: PolicyOptions = {}): void {
  const { inspect, leaning = false, coverage } = options;
  // Learner commands are weighted so that a run reaches the later paths (return slots, replacements)
  // in nearly every batch.
  const learner = learnerArbs(policy);
  const arbs = [...commonArbs, ...learner, ...learner, ...learner, ...learner, ...(leaning ? progressionArbs : [])];
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
      if (coverage) tally(manifest, s.real, coverage);
      inspect?.(manifest, s.real);
    }),
    coverage ? { numRuns: COVERAGE_RUN.numRuns, seed: COVERAGE_RUN.seed } : { numRuns: 100 },
  );
  // Coverage guard: the generated runs do reach settled slots.
  expect(reached).toBeGreaterThan(0);
}
