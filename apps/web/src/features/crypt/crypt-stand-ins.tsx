import type { ReactNode } from 'react';
import { ESCAPE_COPY, ROOM_PLAY_LABELS } from '@escape-the-crypt/core';
import type { State } from '@escape-the-crypt/core';
import type { RoomAction } from '../../state/room-actions';

/*
 * Minimal stand-ins so crypt-flow can route every case before the real views exist.
 * Task 9.3 replaces FinalDoor, task 9.4 replaces its escaped mode, task 10.2 replaces AutopsyView.
 */

export interface FinalDoorProps {
  readonly state: State;
  readonly dispatch: (action: RoomAction) => void;
  /** The escape view. */
  readonly escaped?: boolean;
  /** Escape view only: asks the flow to show the Autopsy. */
  readonly onOpenAutopsy?: () => void;
}

/** Stand-in for task 9.3 (final door) and task 9.4 (escape view). */
export function FinalDoor({ state, escaped = false, onOpenAutopsy }: FinalDoorProps): ReactNode {
  if (escaped) {
    return (
      <section className="final-door final-door--escaped" data-testid="escape-view">
        <p>{ESCAPE_COPY.message}</p>
        <button type="button" onClick={onOpenAutopsy}>
          {ROOM_PLAY_LABELS.openAutopsy}
        </button>
      </section>
    );
  }
  return (
    <section className="final-door" data-testid="final-door">
      <p>{state.finalDoor.available ? 'The final door is open.' : 'The final door is closed.'}</p>

    </section>
  );
}

export interface AutopsyViewProps {
  readonly state: State;
  readonly dispatch: (action: RoomAction) => void;
}

/** Stand-in for task 10.2. */
export function AutopsyView({ state, dispatch }: AutopsyViewProps): ReactNode {
  return (
    <section className="autopsy-view" data-testid="autopsy-view">
      <p>{state.concepts.length} concepts</p>
      <button type="button" onClick={() => dispatch({ type: 'playAgain' })}>
        {ROOM_PLAY_LABELS.playAgain}
      </button>
    </section>
  );
}
