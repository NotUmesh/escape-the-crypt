import type { Outcome_Notice } from '@escape-the-crypt/core';

/** What the latest notices ask the art to animate. A drawing from State alone has none of these. */
export interface ArtEffects {
  /** Slots whose candle was just lit. */
  readonly litSlots: ReadonlySet<string>;
  /** How many Spirit_Candles were just lit. */
  readonly spiritLit: number;
  readonly spawnedConcepts: ReadonlySet<string>;
  readonly laidToRestConcepts: ReadonlySet<string>;
  readonly clearedRooms: ReadonlySet<string>;
}

export const NO_EFFECTS: ArtEffects = {
  litSlots: new Set(),
  spiritLit: 0,
  spawnedConcepts: new Set(),
  laidToRestConcepts: new Set(),
  clearedRooms: new Set(),
};

/** Reads the notices of one accepted dispatch. Pure: the same notices always give the same effects. */
export function artEffectsFrom(notices: readonly Outcome_Notice[]): ArtEffects {
  if (notices.length === 0) return NO_EFFECTS;
  const litSlots = new Set<string>();
  const spawnedConcepts = new Set<string>();
  const laidToRestConcepts = new Set<string>();
  const clearedRooms = new Set<string>();
  let spiritLit = 0;
  for (const notice of notices) {
    switch (notice.kind) {
      case 'candleLit':
        if (notice.target.type === 'slot') litSlots.add(notice.target.slotId);
        else spiritLit += 1;
        break;
      case 'ghostSpawned':
        spawnedConcepts.add(notice.conceptId);
        break;
      case 'ghostLaidToRest':
        laidToRestConcepts.add(notice.conceptId);
        break;
      case 'roomCleared':
        clearedRooms.add(notice.roomId);
        break;
      default:
        break;
    }
  }
  return { litSlots, spiritLit, spawnedConcepts, laidToRestConcepts, clearedRooms };
}
