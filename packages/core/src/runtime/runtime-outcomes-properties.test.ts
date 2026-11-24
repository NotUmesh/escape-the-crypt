import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { playToEscape } from '../test-support/escape-driver';
import { manifestArb } from '../test-support/arbitraries';
import type { TerminationPolicy } from '../test-support/termination-driver';
import { selectAutopsy } from './autopsy-selector';
import { deriveAllOutcomes } from './outcomes';

const OUTCOMES = ['first-try-correct', 'assisted', 'retried', 'challenged', 'review-due'] as const;

/**
 * Feature: room-runtime, Property 10: Exactly one outcome per concept, outcomes sum to the concept count
 */
describe('Property 10: exactly one outcome per concept', () => {
  const policies: TerminationPolicy[] = ['all wrong', 'all skip', 'all challenge', 'seeded random'];
  for (const policy of policies) {
    /** **Validates: Requirements 22.1, 22.9, 20.11** */
    it(`gives each concept one outcome and the counts sum to the concept count: ${policy}`, () => {
      fc.assert(
        fc.property(manifestArb, fc.nat(), (manifest, seed) => {
          const result = playToEscape(manifest, policy, seed);
          expect(result.state.status).toBe('escaped');
          const conceptIds = new Set(manifest.rooms.flatMap((r) => r.lockSlots.map((s) => s.conceptId)));

          const outcomes = deriveAllOutcomes(result.state);
          expect(Object.keys(outcomes).sort()).toEqual([...conceptIds].sort());
          for (const outcome of Object.values(outcomes)) expect(OUTCOMES).toContain(outcome);

          const autopsy = selectAutopsy(result.state);
          if (!autopsy.available) throw new Error('autopsy unavailable at escape');
          expect(autopsy.entries.map((e) => e.conceptId).sort()).toEqual([...conceptIds].sort());
          const total = OUTCOMES.reduce((n, o) => n + autopsy.counts[o], 0);
          expect(total).toBe(conceptIds.size);
          for (const entry of autopsy.entries) expect(entry.outcome).toBe(outcomes[entry.conceptId]);
        }),
        { numRuns: 100 },
      );
    });
  }
});
