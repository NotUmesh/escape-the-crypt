import { useState } from 'react';
import type { ReactNode } from 'react';
import { ROOM_PLAY_LABELS, SAMPLE_CRYPT_LABEL, SLOT_STATUS_WORDS } from '@escape-the-crypt/core';
import type { LockSlotState, State } from '@escape-the-crypt/core';
import type { RoomAction } from '../../state/room-actions';
import { lockName } from './accessible-names';
import './room-screen.css';

export interface RoomScreenProps {
  readonly state: State;
  readonly dispatch: (action: RoomAction) => void;
  /** Fills the panel slot for the opened lock. Later tasks pass the Question_Panel here. */
  readonly renderPanel?: (slot: LockSlotState) => ReactNode;
}

/** The current room as one native button per Lock_Slot, in slot order (Requirements 10.1, 10.2, 10.3). */
export function RoomScreen({ state, dispatch, renderPanel }: RoomScreenProps): ReactNode {
  const [openSlotId, setOpenSlotId] = useState<string | null>(null);
  const [statusText, setStatusText] = useState<string>('');

  const room = state.rooms.find((r) => r.roomId === state.currentRoomId);
  const slots = room?.lockSlots ?? [];
  const openSlot = slots.find((s) => s.slotId === openSlotId && s.status === 'open');

  function activate(slot: LockSlotState): void {
    if (slot.status !== 'open') {
      setStatusText(SLOT_STATUS_WORDS[slot.status]);
      return;
    }
    setStatusText('');
    dispatch({ type: 'openLock', slotId: slot.slotId });
    setOpenSlotId(slot.slotId);
  }

  return (
    <section className="room-screen" aria-labelledby="room-screen-title">
      <h2 id="room-screen-title" className="room-screen__title">
        {room?.roomId ?? ''}
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
              onClick={() => activate(slot)}
            >
              {lockName(slot.stationType, slot.status)}
            </button>
            {slot.status === 'challenged' ? (
              <span className="room-screen__challenged">{ROOM_PLAY_LABELS.challengedLabel}</span>
            ) : null}
          </li>
        ))}
      </ul>
      <p className="room-screen__status" data-testid="slot-status">
        {statusText}
      </p>
      <div className="room-screen__panel-slot" data-testid="panel-slot">
        {openSlot !== undefined && renderPanel !== undefined ? renderPanel(openSlot) : null}
      </div>
    </section>
  );
}
