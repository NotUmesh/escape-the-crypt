import type { ReactNode } from 'react';
import { FINAL_DOOR_STATUS_LABELS } from '@escape-the-crypt/core';
import type { selectFinalDoor } from '@escape-the-crypt/core';
import { sealName } from './accessible-names';
import type { PlacedSeal } from './seal-layout';

type SealSlot = ReturnType<typeof selectFinalDoor>['slots'][number];

export interface SealListProps {
  readonly slots: readonly SealSlot[];
  /** Seals are controls only while the run is in progress. */
  readonly playing: boolean;
  /** One point per slot, inside the door hotspot. Null draws the plain list (the scene failed). */
  readonly points: readonly PlacedSeal[] | null;
  readonly onOpen: (slotId: string, opener: HTMLButtonElement) => void;
}

/** One seal per Final_Door_Slot, in slot order, each with a text label and a name that states its status. */
export function SealList({ slots, playing, points, onOpen }: SealListProps): ReactNode {
  return (
    <ul
      className={`final-door__seals${points === null ? '' : ' final-door__seals--placed'}`}
      data-testid="final-door-seals"
    >
      {slots.map((slot, index) => {
        const name = sealName(index + 1, slot.status);
        const broken = slot.status !== 'open';
        const point = points?.[index];
        return (
          <li
            key={slot.slotId}
            className={`final-door__seal${point === undefined ? '' : ' final-door__seal--placed'}${point?.labelAbove === true ? ' final-door__seal--above' : ''}`}
            data-status={slot.status}
            style={point === undefined ? undefined : { left: point.x, top: point.y }}
          >
            {slot.status === 'open' && playing ? (
              <button
                type="button"
                className="final-door__seal-button"
                aria-label={name}
                onClick={(event) => onOpen(slot.slotId, event.currentTarget)}
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
