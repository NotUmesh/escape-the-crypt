import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { ROOM_PLAY_LABELS, roomDisplayName } from '@escape-the-crypt/core';
import type { State } from '@escape-the-crypt/core';
import { restoreRun } from '../../state/storage/restore-run';
import type { RestoreDeps } from '../../state/storage/restore-run';
import { lockName } from '../crypt/accessible-names';
import { GhostList } from '../crypt/ghost-list';

export const READ_ONLY_TITLE = 'This crypt is open in another tab';
export const TAKE_OVER_LABEL = 'Take over here';
export const READ_ONLY_HINT = 'This tab shows the crypt as it was at the last saved step. Nothing here can be changed.';
export const READ_ONLY_RESTORE_FAILED = 'The saved crypt could not be shown here. You can still take over.';
const FINAL_DOOR_TEXT = 'The crypt is at the final door.';
const ESCAPED_TEXT = 'The crypt has been escaped.';

export interface ReadOnlyScreenProps {
  /** The run as restored from the database at its last stored event. Null while loading or if it could not be restored. */
  readonly state: State | null;
  readonly onTakeOver: () => void;
  /** True when restoring the run failed. */
  readonly restoreFailed?: boolean;
}

/** The crypt as plain text: no buttons, no click handlers, so no lock can be opened (Req 9.9). */
function StaticCrypt({ state }: { readonly state: State }): ReactNode {
  const roomIndex = state.rooms.findIndex((r) => r.roomId === state.currentRoomId);
  const room = roomIndex < 0 ? undefined : state.rooms[roomIndex];
  const spiritCandleCount =
    (room?.spiritCandles.length ?? 0) + (state.atFinalDoor ? state.finalDoor.spiritCandles.length : 0);
  let body: ReactNode;
  if (state.status === 'escaped') body = <p>{ESCAPED_TEXT}</p>;
  else if (state.atFinalDoor) body = <p>{FINAL_DOOR_TEXT}</p>;
  else
    body = (
      <>
        <h3 className="read-only-screen__room">{room === undefined ? '' : roomDisplayName(roomIndex)}</h3>
        <ul className="read-only-screen__locks" data-testid="read-only-locks">
          {(room?.lockSlots ?? []).map((slot) => (
            <li key={slot.slotId} className="read-only-screen__lock" data-status={slot.status}>
              {lockName(slot.stationType, slot.status)}
              {slot.status === 'challenged' ? ` (${ROOM_PLAY_LABELS.challengedLabel})` : ''}
            </li>
          ))}
        </ul>
      </>
    );
  return (
    <div className="read-only-screen__crypt" data-testid="read-only-crypt">
      {body}
      <GhostList ghosts={state.ghosts} spiritCandleCount={spiritCandleCount} />
    </div>
  );
}

/** Shown while another tab holds the run. Focus goes to "Take over here" on mount (Req 9.8). */
export function ReadOnlyScreen({ state, onTakeOver, restoreFailed = false }: ReadOnlyScreenProps): ReactNode {
  const buttonRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    buttonRef.current?.focus();
  }, []);
  return (
    <section className="read-only-screen" aria-labelledby="read-only-title" data-testid="read-only-screen">
      <h2 id="read-only-title">{READ_ONLY_TITLE}</h2>
      <p>{READ_ONLY_HINT}</p>
      <button type="button" ref={buttonRef} className="read-only-screen__take-over" onClick={onTakeOver}>
        {TAKE_OVER_LABEL}
      </button>
      {restoreFailed ? <p role="status">{READ_ONLY_RESTORE_FAILED}</p> : null}
      {state === null ? null : <StaticCrypt state={state} />}
    </section>
  );
}

export interface ReadOnlyScreenContainerProps {
  readonly deps: RestoreDeps;
  readonly runId: string;
  readonly onTakeOver: () => void;
}

/** Restores the run from the database (not from the other tab's memory) and shows it read-only. */
export function ReadOnlyScreenContainer({ deps, runId, onTakeOver }: ReadOnlyScreenContainerProps): ReactNode {
  const [state, setState] = useState<State | null>(null);
  const [failed, setFailed] = useState(false);
  const { factory, notesStore, buildSample } = deps;
  useEffect(() => {
    let live = true;
    void restoreRun({ factory, notesStore, buildSample }, runId).then((result) => {
      if (!live) return;
      if (result.ok) setState(result.value.model.state);
      else setFailed(true);
    });
    return () => {
      live = false;
    };
  }, [factory, notesStore, buildSample, runId]);
  return <ReadOnlyScreen state={state} onTakeOver={onTakeOver} restoreFailed={failed} />;
}
