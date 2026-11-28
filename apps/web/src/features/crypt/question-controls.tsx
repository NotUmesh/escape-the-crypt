import type { ReactNode } from 'react';
import { ROOM_PLAY_LABELS } from '@escape-the-crypt/core';
import type { RoomAction } from '../../state/room-actions';
import { CandleIcon } from '../costume/ornaments';

export interface QuestionControlsProps {
  readonly slotId: string;
  /** Hints left in the run (State.remainingHints). */
  readonly remainingHints: number;
  /** True while the slot's current question already has an Applied_Hint. */
  readonly hintApplied: boolean;
  /** The run's hint allowance. A run with none (Lich) shows no hint control at all. Defaults to 1. */
  readonly hintAllowance?: number;
  readonly dispatch: (action: RoomAction) => void;
  /** Called after Skip is dispatched, so the room screen closes the panel. */
  readonly onClose: () => void;
}

/** Hint, Skip and Challenge for an open slot. Everything stays on this device. */
export function QuestionControls({
  slotId,
  remainingHints,
  hintApplied,
  hintAllowance = 1,
  dispatch,
  onClose,
}: QuestionControlsProps): ReactNode {
  const noHints = remainingHints <= 0;
  const countText = noHints ? ROOM_PLAY_LABELS.noHintsLeft : ROOM_PLAY_LABELS.hintsLeft(remainingHints);
  const countId = `question-controls-hints-${slotId}`;

  return (
    <div className="question-controls">
      <div className="question-controls__buttons">
        {hintAllowance > 0 ? (
          <>
            <button
              type="button"
              disabled={noHints || hintApplied}
              aria-disabled={noHints || hintApplied || undefined}
              aria-describedby={countId}
              onClick={() => dispatch({ type: 'useHint', slotId })}
            >
              <CandleIcon lit={!noHints} />{ROOM_PLAY_LABELS.hint}
            </button>
            <span id={countId} className="question-controls__count">
              <CandleIcon lit={!noHints} />{countText}
            </span>
          </>
        ) : null}
        <button
          type="button"
          onClick={() => {
            dispatch({ type: 'skip', slotId });
            onClose();
          }}
        >
          {ROOM_PLAY_LABELS.skip}
        </button>
        <button type="button" onClick={() => dispatch({ type: 'challenge', slotId })}>
          {ROOM_PLAY_LABELS.challenge}
        </button>
      </div>
      <p className="question-controls__note">{ROOM_PLAY_LABELS.noPenalty}</p>
    </div>
  );
}
