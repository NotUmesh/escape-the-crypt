import { useId } from 'react';
import type { ChangeEvent, ReactNode } from 'react';
import { DIFFICULTIES, RUN_LENGTHS, RUN_SETUP_COPY } from '@escape-the-crypt/core';
import type { Difficulty, LengthAvailability, RunLength } from '@escape-the-crypt/core';
import { effectiveLength } from './run-choice';
import type { RunChoice } from './run-choice';
import './settings-slot.css';

export interface SettingsSlotProps {
  readonly value: RunChoice;
  readonly onChange: (next: RunChoice) => void;
  /** Which lengths these notes can fill. Null hides the length choice (the sample has a fixed size). */
  readonly availability: LengthAvailability | null;
}

const isLength = (v: string): v is RunLength => (RUN_LENGTHS as readonly string[]).includes(v);
const isDifficulty = (v: string): v is Difficulty => (DIFFICULTIES as readonly string[]).includes(v);

/**
 * The length and difficulty choice. Two native radio groups in fieldsets, so Tab reaches each
 * group once and the arrow keys move within it. Each option's detail is its description. A length
 * the notes clearly cannot fill is disabled, and one line says why. Renders nothing until it is
 * given a value and a change handler, so a screen that does not offer the choice stays as it was.
 */
export function SettingsSlot(props: Partial<SettingsSlotProps>): ReactNode {
  const id = useId();
  const { value, onChange, availability = null } = props;
  if (value === undefined || onChange === undefined) return null;
  const copy = RUN_SETUP_COPY;
  const length = effectiveLength(value, availability);
  const onlyShort = availability !== null && !availability.enabled.standard && !availability.enabled.long;

  const pickLength = (event: ChangeEvent<HTMLInputElement>): void => {
    if (isLength(event.target.value)) onChange({ ...value, length: event.target.value });
  };
  const pickDifficulty = (event: ChangeEvent<HTMLInputElement>): void => {
    if (isDifficulty(event.target.value)) onChange({ ...value, difficulty: event.target.value });
  };

  return (
    <div className="run-settings" data-testid="run-settings">
      {availability === null ? null : (
        <fieldset className="run-settings__group fh-panel" aria-describedby={`${id}-length-note`}>
          <legend className="run-settings__legend">{copy.lengthLegend}</legend>
          {RUN_LENGTHS.map((option) => {
            const disabled = !availability.enabled[option];
            const detailId = `${id}-length-${option}`;
            return (
              <label key={option} className="run-settings__option" data-disabled={disabled || undefined}>
                <input
                  type="radio"
                  name={`${id}-length`}
                  value={option}
                  checked={length === option}
                  disabled={disabled}
                  aria-describedby={detailId}
                  onChange={pickLength}
                />
                <span className="run-settings__label">{copy.lengths[option].label}</span>
                <span className="run-settings__detail" id={detailId}>
                  {copy.lengths[option].detail}
                </span>
              </label>
            );
          })}
          <p className="run-settings__note fh-note" id={`${id}-length-note`}>
            {onlyShort ? copy.onlyShort : copy.lengthNote}
          </p>
        </fieldset>
      )}
      <fieldset className="run-settings__group fh-panel" aria-describedby={`${id}-difficulty-note`}>
        <legend className="run-settings__legend">{copy.difficultyLegend}</legend>
        {DIFFICULTIES.map((option) => {
          const detailId = `${id}-difficulty-${option}`;
          return (
            <label key={option} className="run-settings__option">
              <input
                type="radio"
                name={`${id}-difficulty`}
                value={option}
                checked={value.difficulty === option}
                aria-describedby={detailId}
                onChange={pickDifficulty}
              />
              <span className="run-settings__label">{copy.difficulties[option].label}</span>
              <span className="run-settings__detail" id={detailId}>
                {copy.difficulties[option].detail}
              </span>
            </label>
          );
        })}
        <p className="run-settings__note fh-note" id={`${id}-difficulty-note`}>
          {copy.difficultyNote}
        </p>
      </fieldset>
    </div>
  );
}
