import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { AuthoringQuestion } from '../authoring/schema';
import { leakScanRoom, type LeakScanRoomEntry } from '../checks/leak-scan';
import { visibleTextOf } from '../checks/run-checks';
import { assembleRoom } from './room-assembly';
import { buildRoom, roomPlanArb } from '../test-support/room-assembly-fixtures';

// Feature: generation-and-evaluation, Property 16: Pipeline-assembled rooms have no cross-concept rune leak unless injected (G-P3, extended)
// **Validates: Requirements 16.2, 24.4**

describe('Property 16: pipeline-assembled room leak scanning', () => {
  it('assembled rooms are leak-free, distinct, one slot per type, with an empty final door', () => {
    fc.assert(
      fc.property(roomPlanArb, (plan) => {
        const room = buildRoom(plan);
        const result = assembleRoom({
          manifestId: 'm-1',
          document: room.document,
          concepts: room.concepts,
        });

        if (!result.ok) {
          // Only an empty room is a legitimate refusal for mapper-valid input.
          expect(result.error.kind).toBe('empty-room');
          return;
        }
        const { manifest, unplacedAccepted, leakDroppedConceptIds } = result.value;
        const slots = manifest.rooms.flatMap((r) => r.lockSlots);
        expect(slots.length).toBeGreaterThan(0);

        // Entries are built from the full authoring questions, as runRoomChecks does.
        const byId = new Map<string, AuthoringQuestion>();
        for (const c of room.concepts) {
          for (const q of [c.primary, c.alternate]) if (q !== null) byId.set(q.id, q);
        }
        const entries: LeakScanRoomEntry[] = [];
        for (const slot of slots) {
          for (const spec of [slot.primaryQuestion, slot.alternateQuestion]) {
            if (spec === null) continue;
            const q = byId.get(`${slot.conceptId}-${spec.questionId.endsWith('alternate') ? 'alternate' : 'primary'}`);
            expect(q).toBeDefined();
            if (q === undefined) continue;
            entries.push({ conceptId: slot.conceptId, question: q, visibleText: visibleTextOf(q) });
          }
        }
        expect(leakScanRoom(entries)).toEqual([]);

        const conceptIds = slots.map((s) => s.conceptId);
        expect(new Set(conceptIds).size).toBe(conceptIds.length);
        const types = slots.map((s) => s.stationType);
        expect(new Set(types).size).toBe(types.length);
        expect(manifest.finalDoor.slots).toEqual([]);

        for (const id of leakDroppedConceptIds) {
          expect(conceptIds).not.toContain(id);
          expect(unplacedAccepted.map((u) => u.conceptId)).not.toContain(id);
        }
        if (!room.injected) expect(leakDroppedConceptIds).toEqual([]);
      }),
      { numRuns: 200 },
    );
  });

  it('exercises both leak paths (sanity: some runs drop a leaking concept, some place 2 slots)', () => {
    let runsWithLeakDrop = 0;
    let runsWithCleanPlacement = 0;
    let runsWithTwoSlots = 0;
    fc.assert(
      fc.property(roomPlanArb, (plan) => {
        const room = buildRoom(plan);
        const result = assembleRoom({
          manifestId: 'm-3',
          document: room.document,
          concepts: room.concepts,
        });
        if (!result.ok) return;
        const { manifest, leakDroppedConceptIds } = result.value;
        if (leakDroppedConceptIds.length > 0) runsWithLeakDrop += 1;
        else runsWithCleanPlacement += 1;
        if (manifest.rooms.flatMap((r) => r.lockSlots).length === 2) runsWithTwoSlots += 1;
      }),
      { numRuns: 200 },
    );
    expect(runsWithLeakDrop).toBeGreaterThan(0);
    expect(runsWithCleanPlacement).toBeGreaterThan(0);
    expect(runsWithTwoSlots).toBeGreaterThan(0);
  });

  it('never reports empty-room or a drop for a clean room, and never throws', () => {
    fc.assert(
      fc.property(roomPlanArb, (plan) => {
        const room = buildRoom({ ...plan, injection: null });
        const result = assembleRoom({
          manifestId: 'm-2',
          document: room.document,
          concepts: room.concepts,
        });
        expect(result.ok).toBe(true);
        if (result.ok) expect(result.value.leakDroppedConceptIds).toEqual([]);
      }),
      { numRuns: 100 },
    );
  });
});
