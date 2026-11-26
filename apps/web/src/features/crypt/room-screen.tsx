import { useEffect, useRef, useState } from 'react';
import type { ReactNode, RefObject } from 'react';
import {
  ROOM_PLAY_LABELS,
  SAMPLE_CRYPT_LABEL,
  SLOT_STATUS_WORDS,
  roomDisplayName,
  selectFinalDoor,
} from '@escape-the-crypt/core';
import type { LockSlotState, Outcome_Notice, ReturnSlotState, State } from '@escape-the-crypt/core';
import type { RoomAction } from '../../state/room-actions';
import { doorButtonName, lockName, returnSlotName } from './accessible-names';
import { GhostList } from './ghost-list';
import './room-screen.css';

const NO_NOTICES: readonly Outcome_Notice[] = [];

/** What the room screen hands the panel: the opener to refocus and a close that sends no Event. */
export interface PanelControls {
  readonly openerRef: RefObject<HTMLElement | null>;
  readonly onClose: () => void;
}

export interface RoomScreenProps {
  readonly state: State;
  readonly dispatch: (action: RoomAction) => void;
  /** Fills the panel slot for the opened lock. Later tasks pass the Question_Panel here. */
  /** Notices from the latest accepted dispatch (Room_Binding). */
  readonly notices?: readonly Outcome_Notice[];
  readonly renderPanel?: (slot: LockSlotState | ReturnSlotState, controls: PanelControls) => ReactNode;
}

/** The current room as one native button per Lock_Slot, in slot order (Requirements 10.1, 10.2, 10.3). */
export function RoomScreen({ state, dispatch, notices = NO_NOTICES, renderPanel }: RoomScreenProps): ReactNode {
  const [openSlotId, setOpenSlotId] = useState<string | null>(null);
  const [statusText, setStatusText] = useState<string>('');
  const openerRef = useRef<HTMLElement | null>(null);

  const room = state.rooms.find((r) => r.roomId === state.currentRoomId);
  const roomIndex = state.rooms.findIndex((r) => r.roomId === state.currentRoomId);
  const slots = room?.lockSlots ?? [];
  // A judged slot is no longer `open`, but its panel stays until the learner continues from the evidence.
  const returnSlots = room?.dueReturnSlots ?? [];
  const openSlot: LockSlotState | ReturnSlotState | undefined = [...slots, ...returnSlots].find(
    (s) => s.slotId === openSlotId && (s.status === 'open' || s.evidencePanelOpen),
  );

  // A cracked seal on a challenged slot closes its panel (Req 16.9). On an open slot the panel stays,
  // and its key change shows the Alternate with a fresh draft and focus on the heading (Req 16.8).
  useEffect(() => {
    const cracked = notices.filter((n) => n.kind === 'sealCracked').map((n) => n.slotId);
    if (cracked.length === 0) return;
    const challenged = slots.find((s) => s.slotId === openSlotId && s.status === 'challenged');
    if (challenged === undefined || !cracked.includes(challenged.slotId)) return;
    setOpenSlotId(null);
    openerRef.current?.focus();
  }, [notices, slots, openSlotId]);

  function close(): void {
    setOpenSlotId(null);
    const opener = openerRef.current;
    if (opener !== null && opener.isConnected) {
      opener.focus();
      return;
    }
    // The opener is gone: move to the next available control instead of dropping focus.
    document.querySelector<HTMLElement>('.room-screen__lock-button')?.focus();
  }

  function activate(slot: LockSlotState | ReturnSlotState, opener: HTMLElement): void {
    if (slot.status !== 'open') {
      setStatusText(SLOT_STATUS_WORDS[slot.status]);
      return;
    }
    setStatusText('');
    openerRef.current = opener;
    dispatch({ type: 'openLock', slotId: slot.slotId });
    setOpenSlotId(slot.slotId);
  }

  return (
    <section className="room-screen" aria-labelledby="room-screen-title">
      <h2 id="room-screen-title" className="room-screen__title">
        {room === undefined ? '' : roomDisplayName(roomIndex)}
      </h2>
      <p className="room-screen__sample-label">{SAMPLE_CRYPT_LABEL}</p>
      <p className="room-screen__hints">{ROOM_PLAY_LABELS.hintsLeft(state.remainingHints)}</p>
      <ul className="room-screen__locks">
        {slots.map((slot) => (
          <li key={slot.slotId} className="room-screen__lock">
            <button
              type="button"
              className="room-screen__lock-button"
              data-status={slot.status}
              aria-label={lockName(slot.stationType, slot.status)}
              onClick={(event) => activate(slot, event.currentTarget)}
            >
              {lockName(slot.stationType, slot.status)}
            </button>
            {slot.status === 'challenged' ? (
              <span className="room-screen__challenged">{ROOM_PLAY_LABELS.challengedLabel}</span>
            ) : null}
          </li>
        ))}
      </ul>
      {returnSlots.length > 0 ? (
        <ul className="room-screen__returns" data-testid="return-slots">
          {returnSlots.map((slot) => {
            const name = returnSlotName(slot.label === 'review', slot.status);
            return (
              <li key={slot.slotId} className="room-screen__lock">
                <button
                  type="button"
                  className="room-screen__return-button"
                  data-status={slot.status}
                  aria-label={name}
                  onClick={(event) => activate(slot, event.currentTarget)}
                >
                  {name}
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
      {selectFinalDoor(state).available && !state.atFinalDoor ? (
        <button
          type="button"
          className="room-screen__door-button"
          aria-label={doorButtonName()}
          onClick={() => dispatch({ type: 'enterFinalDoor' })}
        >
          {doorButtonName()}
        </button>
      ) : null}
      <GhostList
        ghosts={state.ghosts}
        spiritCandleCount={
          (room?.spiritCandles.length ?? 0) + (state.atFinalDoor ? state.finalDoor.spiritCandles.length : 0)
        }
      />
      <p className="room-screen__status" data-testid="slot-status">
        {statusText}
      </p>
      <div className="room-screen__panel-slot" data-testid="panel-slot">
        {openSlot !== undefined && renderPanel !== undefined ? renderPanel(openSlot, { openerRef, onClose: close }) : null}
      </div>
    </section>
  );
}
