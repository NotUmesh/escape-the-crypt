import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { buildManifest } from '../test-support/manifest-fixture';
import { SETTINGS } from '../test-support/run-settings';
import type { Event } from '../types';
import { apply } from './apply';
import { initial } from './initial';
import type { State } from './state-types';

function mustApply(state: State, event: Event): State {
  const result = apply(state, event);
  if (!result.ok) throw new Error(`rejected: ${result.error.kind}`);
  return result.state;
}

const setupArb = fc.record({
  rooms: fc.integer({ min: 2, max: 4 }),
  conceptsPerRoom: fc.integer({ min: 1, max: 4 }),
  hintEffects: fc.boolean(),
  hintSlots: fc.array(fc.nat(10), { maxLength: 3 }),
  republish: fc.array(fc.nat(10), { minLength: 1, maxLength: 8 }),
});

/** Feature: room-runtime, Property 7: Published rooms are immutable */
describe('Property 7: published rooms are immutable', () => {
  /** **Validates: Requirements 7.2, 7.3** */
  it('a duplicate or late RoomPublished leaves published rooms, option order and hint effects unchanged', () => {
    fc.assert(
      fc.property(setupArb, (setup) => {
        const manifest = buildManifest({
          rooms: setup.rooms,
          conceptsPerRoom: setup.conceptsPerRoom,
          hintEffects: setup.hintEffects,
        });
        const first = manifest.rooms[0];
        if (!first) throw new Error('fixture');
        let state = initial(manifest, SETTINGS);
        const start: Event[] = [
          { kind: 'RunStarted', manifestId: manifest.manifestId },
          { kind: 'RoomPublished', roomId: first.roomId },
          { kind: 'RoomEntered', roomId: first.roomId },
        ];
        for (const event of start) state = mustApply(state, event);
        // Spend hints so applied hint effects exist in State.
        for (const n of setup.hintSlots) {
          const open = state.rooms[0]?.lockSlots.filter((s) => s.status === 'open') ?? [];
          const slot = open[n % Math.max(open.length, 1)];
          if (!slot) continue;
          const result = apply(state, { kind: 'HintUsed', slotId: slot.slotId });
          if (result.ok) state = result.state;
        }

        const manifestBefore = JSON.stringify(state.manifest);
        for (const n of setup.republish) {
          const roomId = manifest.rooms[n % manifest.rooms.length]?.roomId;
          if (roomId === undefined) throw new Error('fixture');
          const before = JSON.parse(JSON.stringify(state)) as State;
          const wasPublished = before.rooms.find((r) => r.roomId === roomId)?.published === true;
          const result = apply(state, { kind: 'RoomPublished', roomId });
          expect(result.ok).toBe(true);
          if (!result.ok) return;
          expect(state).toEqual(before);

          if (wasPublished) {
            expect(result.state).toEqual(before);
            expect(result.notices).toEqual([]);
          } else {
            // Late publish flips only the flag on that room.
            const flipped = before.rooms.map((r) => (r.roomId === roomId ? { ...r, published: true } : r));
            expect(result.state.rooms).toEqual(flipped);
          }
          // Locks, option order and hint effects of every room that was published stay identical.
          for (const room of before.rooms.filter((r) => r.published)) {
            expect(result.state.rooms.find((r) => r.roomId === room.roomId)).toEqual(room);
          }
          expect(JSON.stringify(result.state.manifest)).toBe(manifestBefore);
          state = result.state;
        }
      }),
      { numRuns: 100 },
    );
  });
});
