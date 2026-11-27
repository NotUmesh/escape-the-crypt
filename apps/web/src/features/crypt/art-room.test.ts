import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { artRoomForPosition, artRoomForState, currentRoomPosition } from './art-room';

const roomsOf = (ids: readonly string[]) => ids.map((roomId) => ({ roomId }));
type StateLike = Parameters<typeof artRoomForState>[0];
const stateOf = (ids: readonly string[], current: string): StateLike =>
  ({ rooms: roomsOf(ids), currentRoomId: current }) as unknown as StateLike;

describe('artRoomForPosition', () => {
  it('maps positions 1, 2, 3 and nothing else', () => {
    expect(artRoomForPosition(1)).toBe('burial-chamber');
    expect(artRoomForPosition(2)).toBe('library-of-bones');
    expect(artRoomForPosition(3)).toBe('sunken-chapel');
    for (const p of [0, 4, -1, 1.5, Number.NaN]) expect(artRoomForPosition(p)).toBeNull();
  });
});

describe('currentRoomPosition', () => {
  it('is the index in State.rooms plus one, or null when absent', () => {
    expect(currentRoomPosition(stateOf(['a', 'b'], 'b'))).toBe(2);
    expect(currentRoomPosition(stateOf(['a', 'b'], 'zzz'))).toBeNull();
  });
});

describe('Property 2: The Art_Room is chosen by room position only', () => {
  // Validates: Requirements 7.1, 7.2, 24.3
  it('does not change when room ids change', () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(fc.string({ minLength: 1 }), { minLength: 1, maxLength: 6 }),
        fc.uniqueArray(fc.string({ minLength: 1 }), { minLength: 6, maxLength: 6 }),
        fc.nat(5),
        (idsA, idsB, pick) => {
          const i = pick % idsA.length;
          const a = artRoomForState(stateOf(idsA, idsA[i] as string));
          const b = artRoomForState(stateOf(idsB.slice(0, idsA.length), idsB[i] as string));
          expect(a).toBe(b);
          expect(a).toBe(artRoomForPosition(i + 1));
        },
      ),
    );
  });
  it('is non-null exactly for positions 1 to 3', () => {
    fc.assert(
      fc.property(fc.integer({ min: -5, max: 20 }), (p) => {
        expect(artRoomForPosition(p) !== null).toBe(p >= 1 && p <= 3);
      }),
    );
  });
});
