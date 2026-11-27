import type { ReactNode } from 'react';
import { ENTER_CRYPT_LABEL, ROOM_START_ERROR_COPY } from '@escape-the-crypt/core';
import type { RoomStartErrorKind } from '@escape-the-crypt/core';
import type { RoomAction } from '../../state/room-actions';
import type { StartError } from '../../state/room-binding';

function startErrorKind(error: StartError | null): RoomStartErrorKind {
  if (error !== null && error.kind in ROOM_START_ERROR_COPY) return error.kind as RoomStartErrorKind;
  return 'start-rejected';
}

/** What the learner sees when the run could not start, with a way to try again. */
export function StartFailed({
  error,
  dispatch,
}: {
  readonly error: StartError | null;
  readonly dispatch: (action: RoomAction) => void;
}): ReactNode {
  const copy = ROOM_START_ERROR_COPY[startErrorKind(error)];
  return (
    <section className="crypt-start crypt-start--failed" role="alert" data-testid="start-failed">
      <p>{copy.what}</p>
      <p>{copy.next}</p>
      <button type="button" onClick={() => dispatch({ type: 'startRun' })}>
        {ENTER_CRYPT_LABEL}
      </button>
    </section>
  );
}
