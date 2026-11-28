import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { RUN_LENGTHS, cryptTargetFor, type CryptTarget } from '../run-length';
import {
  conceptsAndDocArb,
  notEnoughConceptsArb,
  type SufficiencyScenario,
} from '../test-support/sufficiency-arbitraries';
import { MIN_CONCEPT_SOURCE_WORDS, conceptsNeeded, splitThinConcepts, sufficiencyNotice } from './sufficiency';

/** Words in the distinct, known chunks a concept cites, from the word counts the document was built with. */
function expectedWords(scenario: SufficiencyScenario, chunkIds: readonly string[]): number {
  let total = 0;
  for (const id of new Set(chunkIds)) {
    const index = scenario.chunkIds.indexOf(id);
    if (index >= 0) total += scenario.wordCounts[index] ?? 0;
  }
  return total;
}

describe('thin-concept filter properties', () => {
  // Feature: generation-and-evaluation, Property 35: The thin-concept filter keeps exactly the concepts with enough source text
  // **Validates: Requirements 17.1**
  it.each([
    ['mixed chunks', conceptsAndDocArb],
    ['thin chunks', notEnoughConceptsArb],
  ] as const)('keeps exactly the concepts with enough source text (%s)', (_name, arb) => {
    fc.assert(
      fc.property(arb, (scenario) => {
        const { kept, thin } = splitThinConcepts(scenario.concepts, scenario.doc);
        const enough = scenario.concepts.filter(
          (c) => expectedWords(scenario, c.chunkIds) >= MIN_CONCEPT_SOURCE_WORDS,
        );
        const rest = scenario.concepts.filter((c) => !enough.includes(c));
        expect(kept).toEqual(enough);
        expect(thin).toEqual(rest);
        expect(kept.length + thin.length).toBe(scenario.concepts.length);
        const ids = [...kept, ...thin].map((c) => c.conceptId).sort();
        expect(ids).toEqual(scenario.concepts.map((c) => c.conceptId).sort());
      }),
    );
  });

  // Feature: generation-and-evaluation, Property 35: The thin-concept filter keeps exactly the concepts with enough source text
  // **Validates: Requirements 17.1**
  it('is idempotent on kept', () => {
    fc.assert(
      fc.property(conceptsAndDocArb, (scenario) => {
        const { kept } = splitThinConcepts(scenario.concepts, scenario.doc);
        const again = splitThinConcepts(kept, scenario.doc);
        expect(again.kept).toEqual(kept);
        expect(again.thin).toEqual([]);
      }),
    );
  });
});

const targetArb: fc.Arbitrary<CryptTarget> = fc.constantFrom(...RUN_LENGTHS).map((l) => cryptTargetFor(l));

describe('sufficiency accounting properties (pure half)', () => {
  // Feature: generation-and-evaluation, Property 36: Sufficiency accounting matches the rooms built
  // **Validates: Requirements 17.1, 17.2**
  it('returns a notice exactly when a target is present and fewer rooms were built', () => {
    fc.assert(
      fc.property(
        fc.nat({ max: 50 }),
        fc.option(targetArb, { nil: undefined }),
        fc.nat({ max: 8 }),
        (good, target, built) => {
          const notice = sufficiencyNotice(good, target, built);
          if (target === undefined || built >= target.rooms) {
            expect(notice).toBeUndefined();
            return;
          }
          expect(notice).toEqual({
            goodConcepts: good,
            conceptsNeeded: target.rooms * target.locksPerRoom,
            requestedRooms: target.rooms,
            builtRooms: built,
          });
        },
      ),
    );
  });

  // Feature: generation-and-evaluation, Property 36: Sufficiency accounting matches the rooms built
  // **Validates: Requirements 17.1, 17.2**
  it('needs rooms * locksPerRoom concepts for every length', () => {
    fc.assert(
      fc.property(targetArb, (target) => {
        expect(conceptsNeeded(target)).toBe(target.rooms * target.locksPerRoom);
      }),
    );
    for (const length of RUN_LENGTHS) {
      const target = cryptTargetFor(length);
      expect(conceptsNeeded(target)).toBe(target.rooms * 2);
    }
  });
});
