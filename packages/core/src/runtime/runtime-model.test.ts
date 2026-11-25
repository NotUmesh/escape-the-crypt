import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { manifestArb } from '../test-support/arbitraries';
import { SETTINGS } from '../test-support/run-settings';
import type { Real, TraceEntry } from '../test-support/runtime-model-support';
import { playToEscape } from '../test-support/escape-driver';
import { playEnteredRoom } from '../test-support/termination-driver';
import { apply } from './apply';
import { initial } from './initial';
import type { CryptManifest } from './manifest-types';
import { NOTICE_ORDER } from './notices';
import type { Outcome_Notice } from './notices';
import { POLICIES, emptyCoverage, runPolicy } from '../test-support/runtime-model-harness';

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
    runPolicy('seeded random', { inspect: checkNotices });
  });
});

/**
 * Feature: room-runtime, Property 1: Termination (room play; the escape part follows below).
 * Later rooms cannot be entered before 6.1, so the entered room (room 1) is the room played.
 */
describe('runtime termination (room play)', () => {
  for (const policy of POLICIES) {
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
  for (const policy of POLICIES) {
    /** **Validates: Requirements 3.1, 3.6, 3.7, 13.4, 14.7, 14.8, 18.4, 31.6** */
    it(`keeps every invariant and rejects invalid events as no-ops: ${policy}`, () => {
      // Invariant run: random seed.
      runPolicy(policy);
    });

    // Coverage guards: a separate run with a fixed seed, so the counters are reproducible.
    it(`reaches the paths it is named for under the pinned coverage run: ${policy}`, () => {
      const coverage = emptyCoverage();
      runPolicy(policy, { coverage });
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
  /** Pinned run for the escape coverage guards. */
  const ESCAPE_COVERAGE_RUN = { seed: 424242, numRuns: 300 } as const;

  /** Assert the escape property over a run and return how often shortening and leaving occurred. */
  function assertEscapes(policy: (typeof POLICIES)[number], params: fc.Parameters<unknown>) {
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
      params,
    );
    return { shortenedRuns, leftRuns };
  }

  for (const policy of POLICIES) {
    /** **Validates: Requirements 20.5, 20.7, 20.8, 20.9** */
    it(`escapes within (totalConcepts x 4) + reserved door questions: ${policy}`, () => {
      // Invariant run: random seed.
      assertEscapes(policy, { numRuns: 100 });
    });

    // Coverage guards: a separate run with a fixed seed, so the counters are reproducible.
    it(`shortens and leaves under the pinned escape coverage run: ${policy}`, () => {
      const counts = assertEscapes(policy, ESCAPE_COVERAGE_RUN);
      expect(counts.shortenedRuns).toBeGreaterThan(0);
      expect(counts.leftRuns).toBeGreaterThan(0);
    });
  }

  for (const policy of POLICIES) {
    /** **Validates: Requirements 20.5, 20.7, 20.8, 20.9** */
    it(`keeps every invariant through progression, the final door, leave and resume: ${policy}`, () => {
      runPolicy(policy, { leaning: true });
    }, 60_000);

    // Coverage guards: a separate run with a fixed seed.
    it(`reaches the final door under the pinned coverage run: ${policy}`, () => {
      const c = emptyCoverage();
      runPolicy(policy, { leaning: true, coverage: c });
      expect(c.atDoor).toBeGreaterThan(0);
      // Skips and challenges settle fastest, so those runs reach the escape within the command budget.
      if (policy === 'all skip' || policy === 'all challenge') expect(c.escaped).toBeGreaterThan(0);
    }, 60_000);
  }
});
