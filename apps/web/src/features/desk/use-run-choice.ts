import { useMemo, useState } from 'react';
import { lengthAvailabilityForNotes } from '@escape-the-crypt/core';
import type { LengthAvailability, RunSettings } from '@escape-the-crypt/core';
import { DEFAULT_RUN_CHOICE, settingsForChoice } from './run-choice';
import type { RunChoice } from './run-choice';

export interface RunChoiceState {
  readonly value: RunChoice;
  readonly onChange: (next: RunChoice) => void;
  /** Null when there is nothing to generate: only the difficulty is offered. */
  readonly availability: LengthAvailability | null;
  /** The settings a run starts with, for a generated crypt or for the sample. */
  readonly settingsFor: (kind: 'generated' | 'sample') => RunSettings;
}

/**
 * The learner's length and difficulty choice for this page visit. Defaults: Short and Apprentice.
 * The length estimate chunks the notes once per notes text.
 */
export function useRunChoice(notesText: string | undefined, canGenerate: boolean): RunChoiceState {
  const [value, setValue] = useState<RunChoice>(DEFAULT_RUN_CHOICE);
  const availability = useMemo(
    () => (canGenerate && notesText !== undefined ? lengthAvailabilityForNotes(notesText) : null),
    [canGenerate, notesText],
  );
  return {
    value,
    onChange: setValue,
    availability,
    settingsFor: (kind) => settingsForChoice(value, availability, kind),
  };
}
