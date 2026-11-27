import { describe, expect, it } from 'vitest';
import { artEffectsFrom, NO_EFFECTS } from './art-effects';

describe('artEffectsFrom', () => {
  it('has no effects without notices', () => {
    expect(artEffectsFrom([])).toBe(NO_EFFECTS);
  });

  it('reads each notice kind', () => {
    const effects = artEffectsFrom([
      { kind: 'candleLit', target: { type: 'slot', slotId: 's1' } },
      { kind: 'candleLit', target: { type: 'spirit', roomId: 'r1' } },
      { kind: 'ghostSpawned', conceptId: 'a' },
      { kind: 'ghostLaidToRest', conceptId: 'b' },
      { kind: 'roomCleared', roomId: 'r1' },
      { kind: 'sealCracked', slotId: 's2' },
      { kind: 'escaped' },
    ]);
    expect([...effects.litSlots]).toEqual(['s1']);
    expect(effects.spiritLit).toBe(1);
    expect([...effects.spawnedConcepts]).toEqual(['a']);
    expect([...effects.laidToRestConcepts]).toEqual(['b']);
    expect([...effects.clearedRooms]).toEqual(['r1']);
  });
});
