import type { RunLength } from './run-length';
import type { RunSettings } from './runtime/manifest-types';

export const DIFFICULTIES = ['apprentice', 'gravedigger', 'lich'] as const;
export type Difficulty = RunSettings['difficulty'];

/**
 * Difficulty changes play only: how many hints a run starts with and whether the rune tablet shows
 * the answer's letter count. It never changes generation or cost. Ghost rules, challenge and the
 * guarantee that escape is possible are the same for every difficulty (the runtime never reads it).
 */
const HINT_ALLOWANCE: Readonly<Record<Difficulty, number>> = { apprentice: 3, gravedigger: 2, lich: 0 };

export function runSettingsFor(length: RunLength, difficulty: Difficulty): RunSettings {
  return { length, difficulty, hintAllowance: HINT_ALLOWANCE[difficulty] };
}

/** Apprentice and Gravedigger see "N letters" on a rune tablet from the start; Lich does not. */
export function showsRuneLetterCount(difficulty: Difficulty): boolean {
  return difficulty !== 'lich';
}
