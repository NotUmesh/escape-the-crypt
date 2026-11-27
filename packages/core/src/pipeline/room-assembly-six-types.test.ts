import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { validateManifestForPublish } from '../runtime/publish-manifest';
import { sixTypeConceptsArb } from '../test-support/six-type-concept-arbitraries';
import { assembleRoom, type RoomAssembly } from './room-assembly';
import { heart } from './room-assembly-heart-fixtures';
import type { AssemblyConcept } from './room-assembly';

function assemble(concepts: readonly AssemblyConcept[]): RoomAssembly {
  const result = assembleRoom({ manifestId: 'm-six', document: heart, concepts });
  if (!result.ok) throw new Error(`assembly failed: ${result.error.kind}`);
  return result.value;
}

const slotsOf = (a: RoomAssembly) => a.manifest.rooms.flatMap((r) => r.lockSlots);

// Feature: generation-and-evaluation, Property 4: Manifest_Schema rejects a second slot of the same Lock_Type in one room
describe('six-type room assembly: Property 4', () => {
  it('assembles at most one slot per Lock_Type, publishable, and rejects a second slot of any placed type', () => {
    fc.assert(
      fc.property(sixTypeConceptsArb, (concepts) => {
        const assembly = assemble(concepts);
        const slots = slotsOf(assembly);
        const types = slots.map((s) => s.stationType);
        expect(new Set(types).size).toBe(types.length);
        expect(validateManifestForPublish(assembly.manifest).ok).toBe(true);

        const room = assembly.manifest.rooms[0]!;
        for (const slot of slots) {
          const twin = {
            ...slot,
            slotId: `${slot.slotId}-twin`,
            primaryQuestion: { ...slot.primaryQuestion, questionId: `${slot.primaryQuestion.questionId}-twin` },
            alternateQuestion: null,
          };
          const withSecond = {
            ...assembly.manifest,
            rooms: [{ ...room, lockSlots: [...room.lockSlots, twin] }],
          };
          expect(validateManifestForPublish(withSecond).ok).toBe(false);
        }
      }),
      { numRuns: 100 },
    );
  });
});

// Feature: generation-and-evaluation, Property 28: Manifest_Schema validates every six-Lock_Type payload; alternate type differs from primary
describe('six-type room assembly: Property 28 (alternate differs)', () => {
  it('never gives an alternate its primary slot type, and every slot primary matches its station', () => {
    fc.assert(
      fc.property(sixTypeConceptsArb, (concepts) => {
        const assembly = assemble(concepts);
        for (const s of slotsOf(assembly)) {
          expect(s.primaryQuestion.lockType).toBe(s.stationType);
          if (s.alternateQuestion !== null) {
            expect(s.alternateQuestion.lockType).not.toBe(s.primaryQuestion.lockType);
          }
        }
        expect(validateManifestForPublish(assembly.manifest).ok).toBe(true);
      }),
      { numRuns: 100 },
    );
  });
});
