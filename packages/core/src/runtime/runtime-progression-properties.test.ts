import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { playToEscape } from '../test-support/escape-driver';
import { buildManifest } from '../test-support/manifest-fixture';
import { SETTINGS } from '../test-support/run-settings';
import { clearRoomCorrectly, step } from '../test-support/sequence-support';
import type { TerminationPolicy } from '../test-support/termination-driver';
import { apply } from './apply';
import { initial } from './initial';
import type { State } from './state-types';

type Op =
  | { readonly op: 'publish'; readonly room: number }
  | { readonly op: 'enter'; readonly room: number }
  | { readonly op: 'clear' };

const opArb: fc.Arbitrary<Op> = fc.oneof(
  fc.record({ op: fc.constant('publish' as const), room: fc.nat(5) }),
  fc.record({ op: fc.constant('enter' as const), room: fc.nat(5) }),
  fc.constant<Op>({ op: 'clear' }),
);

const policyArb: fc.Arbitrary<TerminationPolicy> = fc.constantFrom(
  'all wrong',
  'all skip',
  'all challenge',
  'seeded random',
);

/** Feature: room-runtime, Property 11: Room progression and crypt shortening */
describe('Property 11: room progression and crypt shortening', () => {
  /** **Validates: Requirements 8.1, 8.2, 8.3, 8.4, 8.5** */
  it('RoomEntered(k+1) is accepted only when room k is Cleared and room k+1 is published', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 2, max: 5 }),
        fc.integer({ min: 1, max: 3 }),
        fc.array(opArb, { minLength: 1, maxLength: 25 }),
        (roomCount, conceptsPerRoom, ops) => {
          const manifest = buildManifest({ rooms: roomCount, conceptsPerRoom });
          let state: State = step(initial(manifest, SETTINGS), {
            kind: 'RunStarted',
            manifestId: manifest.manifestId,
          }).state;
          // Independent model: which rooms are published and cleared, and the entered index.
          const published = new Set<number>();
          const cleared = new Set<number>();
          let current = -1;
          for (const op of ops) {
            const room = op.op === 'clear' ? 0 : op.room % roomCount;
            const roomId = manifest.rooms[room]?.roomId ?? '';
            if (op.op === 'publish') {
              state = step(state, { kind: 'RoomPublished', roomId }).state;
              published.add(room);
            } else if (op.op === 'clear') {
              if (current < 0 || cleared.has(current)) continue;
              state = clearRoomCorrectly(manifest, state, current);
              cleared.add(current);
            } else {
              const before = JSON.parse(JSON.stringify(state)) as State;
              const result = apply(state, { kind: 'RoomEntered', roomId });
              const inOrder = room === current + 1;
              const accepted = inOrder && (current < 0 || cleared.has(current)) && published.has(room);
              expect(result.ok).toBe(accepted);
              if (result.ok) {
                current = room;
                state = result.state;
                expect(state.currentRoomId).toBe(roomId);
              } else {
                expect(result.error.kind).toBe(
                  !inOrder ? 'room-out-of-order' : !published.has(room) && current < 0
                    ? 'room-not-published'
                    : current >= 0 && !cleared.has(current)
                      ? 'room-not-cleared'
                      : 'room-not-published',
                );
                expect(state).toEqual(before);
              }
            }
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  /** **Validates: Requirements 7.5, 7.7, 8.1, 8.2, 8.3, 8.4, 8.5** */
  it('a shortened crypt still reaches an available Final_Door and escapes', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 5 }),
        fc.integer({ min: 1, max: 4 }),
        policyArb,
        fc.integer({ min: 0, max: 0xffff }),
        (rooms, conceptsPerRoom, policy, seed) => {
          const manifest = buildManifest({ rooms, conceptsPerRoom, finalDoorQuestions: 2 });
          const result = playToEscape(manifest, policy, seed);
          expect(result.exhausted).toBe(false);
          expect(result.state.status).toBe('escaped');
          expect(result.state.finalDoor.available).toBe(true);
          const count = result.state.finalRoomCount ?? rooms;
          expect(count).toBeLessThanOrEqual(rooms);
          // Every room up to the final count was Cleared; none beyond it was entered.
          for (const [i, room] of result.state.rooms.entries()) {
            if (i < count) expect(room.cleared).toBe(true);
            else expect(room.cleared).toBe(false);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
