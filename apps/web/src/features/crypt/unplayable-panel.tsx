import type { ReactNode } from 'react';
import { ROOM_PLAY_LABELS } from '@escape-the-crypt/core';
import type { RoomAction } from '../../state/room-actions';

export interface UnplayablePanelProps {
  readonly slotId: string;
  readonly heading: string;
  readonly dispatch: (action: RoomAction) => void;
  /** Called after Skip is dispatched, so the caller closes the panel. */
  readonly onClose: () => void;
}

/** For a slot whose question type has no panel: says so and offers only Skip. */
export function UnplayablePanel({ slotId, heading, dispatch, onClose }: UnplayablePanelProps): ReactNode {
  return (
    <section className="question-panel unplayable-panel" data-side="right" aria-labelledby={`unplayable-${slotId}`}>
      <h3 id={`unplayable-${slotId}`} className="question-panel__heading">
        {heading}
      </h3>
      <p className="question-panel__unplayable">{ROOM_PLAY_LABELS.unplayableType}</p>
      <button
        type="button"
        onClick={() => {
          dispatch({ type: 'skip', slotId });
          onClose();
        }}
      >
        {ROOM_PLAY_LABELS.skip}
      </button>
    </section>
  );
}
