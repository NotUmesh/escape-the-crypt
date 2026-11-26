import { createContext, useContext } from 'react';
import type { CryptContent, LockSlotState, Typed_Rejection } from '@escape-the-crypt/core';
import type { RoomAction } from '../../state/room-actions';

/**
 * What a lock panel reads from the room screen: the binding's `dispatch`, the last rejection,
 * the run's content and the slot's Applied_Hint. Task 5.4 provides it around the Question_Panel.
 * Drafts never travel through it.
 */
export interface LockPanelContextValue {
  readonly dispatch: (action: RoomAction) => void;
  readonly rejection: Typed_Rejection | null;
  readonly content: CryptContent;
  /** The slot's `appliedHint`; a panel ignores it unless it is for the slot's current question. */
  readonly appliedHintFor: (slotId: string) => LockSlotState['appliedHint'];
}

export const LockPanelContext = createContext<LockPanelContextValue | null>(null);

export function useLockPanelContext(): LockPanelContextValue | null {
  return useContext(LockPanelContext);
}
