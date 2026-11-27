import { runSettingsFor } from '@escape-the-crypt/core';
import type { Difficulty, LengthAvailability, RunLength, RunSettings } from '@escape-the-crypt/core';

/** What the learner picked on the setup screen. Defaults: Short and Apprentice. */
export interface RunChoice {
  readonly length: RunLength;
  readonly difficulty: Difficulty;
}

export const DEFAULT_RUN_CHOICE: RunChoice = { length: 'short', difficulty: 'apprentice' };

/**
 * The length that is actually used: the chosen one, or the largest offered length when the choice
 * is switched off for these notes. A disabled length can never be sent.
 */
export function effectiveLength(choice: RunChoice, availability: LengthAvailability | null): RunLength {
  if (availability === null || availability.enabled[choice.length]) return choice.length;
  return availability.largest;
}

/**
 * The settings a run starts with. A generated crypt uses the effective length; the sample keeps
 * its fixed size (stored as Short) and takes only the difficulty.
 */
export function settingsForChoice(
  choice: RunChoice,
  availability: LengthAvailability | null,
  kind: 'generated' | 'sample',
): RunSettings {
  const length = kind === 'sample' ? 'short' : effectiveLength(choice, availability);
  return runSettingsFor(length, choice.difficulty);
}
