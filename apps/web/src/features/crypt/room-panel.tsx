import { useMemo } from 'react';
import type { ReactNode, RefObject } from 'react';
import type { LockSlotState, State, Typed_Rejection } from '@escape-the-crypt/core';
import type { RoomAssets } from '../../state/room-assets';
import type { RoomAction } from '../../state/room-actions';
import { lockName } from './accessible-names';
import { LockPanelContext } from './lock-panel-context';
import type { LockPanelContextValue } from './lock-panel-context';
import { QuestionPanel } from './question-panel';

export interface RoomPanelProps {
  readonly slot: LockSlotState;
  readonly state: State;
  readonly assets: RoomAssets;
  readonly rejection: Typed_Rejection | null;
  readonly dispatch: (action: RoomAction) => void;
  readonly openerRef: RefObject<HTMLElement | null>;
  readonly onClose: () => void;
}

/** The Question_Panel for an opened Lock_Slot, with the context the lock panels read. */
export function RoomPanel({ slot, state, assets, rejection, dispatch, openerRef, onClose }: RoomPanelProps): ReactNode {
  const value = useMemo<LockPanelContextValue>(
    () => ({
      dispatch,
      rejection,
      content: assets.content,
      appliedHintFor: (slotId) => {
        for (const room of state.rooms) {
          const found = room.lockSlots.find((s) => s.slotId === slotId);
          if (found !== undefined) return found.appliedHint;
        }
        return null;
      },
    }),
    [dispatch, rejection, assets.content, state.rooms],
  );

  return (
    <LockPanelContext.Provider value={value}>
      <QuestionPanel
        slotId={slot.slotId}
        questionId={slot.currentQuestionId}
        questionType={slot.currentQuestionType}
        heading={lockName(slot.stationType, slot.status)}
        open
        openerRef={openerRef}
        onClose={onClose}
        awaitingContinue={slot.evidencePanelOpen}
      />
    </LockPanelContext.Provider>
  );
}
