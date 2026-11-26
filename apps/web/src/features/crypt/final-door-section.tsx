import type { ReactNode } from 'react';
import { FINAL_DOOR_STATUS_LABELS, ROOM_PLAY_LABELS } from '@escape-the-crypt/core';
import type { CryptContent, SlotStatus, State } from '@escape-the-crypt/core';

export interface FinalDoorSectionProps {
  readonly state: State;
  readonly content: CryptContent | null;
}

/* Icons: decorative only. The status label beside each one carries the meaning. */
function IconFrame({ children }: { readonly children: ReactNode }): ReactNode {
  return (
    <svg
      className="autopsy-icon"
      width="20"
      height="20"
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

const STATUS_ICONS: Readonly<Record<SlotStatus, () => ReactNode>> = {
  open: () => (
    <IconFrame>
      <circle cx="10" cy="10" r="6" />
    </IconFrame>
  ),
  solved: () => (
    <IconFrame>
      <path d="M4 10.5l4 4 8-9" />
    </IconFrame>
  ),
  settled: () => (
    <IconFrame>
      <path d="M5 10h10" />
    </IconFrame>
  ),
  challenged: () => (
    <IconFrame>
      <path d="M5 3v14" />
      <path d="M5 4h10l-2 3 2 3H5" />
    </IconFrame>
  ),
};

function isExcluded(status: SlotStatus): boolean {
  return status === 'settled' || status === 'challenged';
}

/** The Final_Door_Section: each final door question with its prompt and final status (Requirements 20.11 to 20.13). */
export function FinalDoorSection({ state, content }: FinalDoorSectionProps): ReactNode {
  return (
    <section className="autopsy-final-door" aria-labelledby="autopsy-final-door-heading">
      <h3 id="autopsy-final-door-heading">{ROOM_PLAY_LABELS.autopsyFinalDoorHeading}</h3>
      <ul>
        {state.finalDoor.slots.map((slot) => {
          const known = content !== null && Object.hasOwn(content.questions, slot.currentQuestionId);
          const prompt = known ? content.questions[slot.currentQuestionId]?.prompt : undefined;
          return (
            <li key={slot.slotId} className="autopsy-final-door__entry" data-status={slot.status}>
              <p className="autopsy-final-door__prompt">{prompt ?? slot.currentQuestionId}</p>
              <span className="autopsy-outcome">
                {STATUS_ICONS[slot.status]()}
                <span className="autopsy-outcome__label">{FINAL_DOOR_STATUS_LABELS[slot.status]}</span>
              </span>
              {isExcluded(slot.status) ? (
                <p className="autopsy-final-door__statement">{ROOM_PLAY_LABELS.autopsyExcludedStatement}</p>
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
