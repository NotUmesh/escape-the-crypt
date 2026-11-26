import { useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { ESCAPE_COPY, FINAL_DOOR_STATUS_LABELS, ROOM_PLAY_LABELS, selectFinalDoor } from '@escape-the-crypt/core';
import type { Event, State, Typed_Rejection } from '@escape-the-crypt/core';
import type { RoomAction } from '../../state/room-actions';
import type { RoomAssets } from '../../state/room-assets';
import { doorButtonName, sealName } from './accessible-names';
import { LOCK_PANELS } from './lock-panel-registry';
import { RoomPanel } from './room-panel';
import { UnplayablePanel } from './unplayable-panel';
import './final-door.css';

export interface EscapedFinalDoorProps {
  readonly escaped: true;
  /** Asks the flow to show the Autopsy. */
  readonly onOpenAutopsy: () => void;
}

export interface PlayingFinalDoorProps {
  readonly escaped?: false;
  readonly state: State;
  readonly dispatch: (action: RoomAction) => void;
  readonly assets: RoomAssets | null;
  readonly rejection: Typed_Rejection | null;
  readonly eventLog: readonly Event[];
}

export type FinalDoorProps = EscapedFinalDoorProps | PlayingFinalDoorProps;

const CLOSED_TEXT = 'The final door is closed.';
const OPEN_TEXT = 'The final door is open.';

/** The final door: closed until available, then one seal per slot. Adds no game rule. */
export function FinalDoor(props: FinalDoorProps): ReactNode {
  if (props.escaped === true) return <EscapedDoor onOpenAutopsy={props.onOpenAutopsy} />;
  return <PlayingDoor {...props} />;
}

/** The escape view: the escape message and one button. No slots, panel or help controls. */
function EscapedDoor({ onOpenAutopsy }: { readonly onOpenAutopsy: () => void }): ReactNode {
  return (
    <section className="final-door final-door--escaped" data-testid="escape-view">
      <p>{ESCAPE_COPY.message}</p>
      <button type="button" className="final-door__button" onClick={onOpenAutopsy}>
        {ROOM_PLAY_LABELS.openAutopsy}
      </button>
    </section>
  );
}

function PlayingDoor({ state, dispatch, assets, rejection, eventLog }: PlayingFinalDoorProps): ReactNode {
  const [openSlotId, setOpenSlotId] = useState<string | null>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const door = selectFinalDoor(state);
  const playing = state.status === 'in progress';

  function close(): void {
    setOpenSlotId(null);
    const opener = openerRef.current;
    if (opener !== null && opener.isConnected) opener.focus();
    else document.querySelector<HTMLElement>('.final-door__seal-button')?.focus();
  }

  if (!door.available) {
    return (
      <section className="final-door" data-testid="final-door">
        <p>{CLOSED_TEXT}</p>
      </section>
    );
  }

  if (!state.atFinalDoor) {
    return (
      <section className="final-door" data-testid="final-door">
        <p>{OPEN_TEXT}</p>
        {playing ? (
          <button
            type="button"
            className="final-door__button"
            aria-label={doorButtonName()}
            onClick={() => dispatch({ type: 'enterFinalDoor' })}
          >
            {doorButtonName()}
          </button>
        ) : null}
      </section>
    );
  }

  const openSlot = state.finalDoor.slots.find(
    (s) => s.slotId === openSlotId && (s.status === 'open' || s.evidencePanelOpen),
  );

  return (
    <section className="final-door" data-testid="final-door">
      <p>{OPEN_TEXT}</p>
      <ul className="final-door__seals" data-testid="final-door-seals">
        {door.slots.map((slot, index) => {
          const name = sealName(index + 1, slot.status);
          const broken = slot.status !== 'open';
          return (
            <li key={slot.slotId} className="final-door__seal" data-status={slot.status}>
              {slot.status === 'open' && playing ? (
                <button
                  type="button"
                  className="final-door__seal-button"
                  aria-label={name}
                  onClick={(event) => {
                    openerRef.current = event.currentTarget;
                    dispatch({ type: 'openLock', slotId: slot.slotId });
                    setOpenSlotId(slot.slotId);
                  }}
                >
                  <SealGraphic broken={false} />
                </button>
              ) : (
                <span role="img" aria-label={name}>
                  <SealGraphic broken={broken} />
                </span>
              )}
              <span className="final-door__seal-label">{FINAL_DOOR_STATUS_LABELS[slot.status]}</span>
            </li>
          );
        })}
      </ul>
      <div className="final-door__panel-slot" data-testid="panel-slot">
        {openSlot === undefined || assets === null ? null : LOCK_PANELS[openSlot.currentQuestionType] === undefined ? (
          <UnplayablePanel
            slotId={openSlot.slotId}
            heading={sealName(state.finalDoor.slots.indexOf(openSlot) + 1, openSlot.status)}
            dispatch={dispatch}
            onClose={close}
          />
        ) : (
          <RoomPanel
            slot={openSlot}
            state={state}
            side="right"
            heading={sealName(state.finalDoor.slots.indexOf(openSlot) + 1, openSlot.status)}
            assets={assets}
            rejection={rejection}
            eventLog={eventLog}
            dispatch={dispatch}
            openerRef={openerRef}
            onClose={close}
          />
        )}
      </div>
    </section>
  );
}

function SealGraphic({ broken }: { readonly broken: boolean }): ReactNode {
  return (
    <svg width="44" height="44" viewBox="0 0 44 44" aria-hidden="true" focusable="false" data-broken={broken}>
      <circle cx="22" cy="22" r="18" fill="none" stroke="currentColor" strokeWidth="3" />
      {broken ? <path d="M22 4 L18 22 L26 30 L22 40" fill="none" stroke="currentColor" strokeWidth="3" /> : null}
    </svg>
  );
}
