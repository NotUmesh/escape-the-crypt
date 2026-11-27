import type { ReactNode } from 'react';
import type { CryptContent, LockSlotState } from '@escape-the-crypt/core';
import { LockPanelContext } from '../features/crypt/lock-panel-context';
import { LockAnnounceContext } from '../features/crypt/lock-panel-payload';
import type { RoomAction } from '../state/room-actions';

export interface LockPanelTestProviderProps {
  readonly content: CryptContent;
  /** The payload of the one question under test. */
  readonly payload: unknown;
  readonly dispatch: (action: RoomAction) => void;
  readonly announce?: (message: string) => void;
  readonly appliedHint?: LockSlotState['appliedHint'];
  readonly rejection?: { readonly kind: 'invalid-submission'; readonly slotId: string } | null;
  readonly children: ReactNode;
}
/** A test-local context for one lock panel. It does not import the panel registry. */
export function LockPanelTestProvider({
  content,
  payload,
  dispatch,
  announce = () => undefined,
  appliedHint = null,
  rejection = null,
  children,
}: LockPanelTestProviderProps): ReactNode {
  return (
    <LockPanelContext.Provider
      value={{
        dispatch,
        rejection: rejection as never,
        content,
        appliedHintFor: () => appliedHint,
        payloadFor: () => payload,
      }}
    >
      <LockAnnounceContext.Provider value={announce}>{children}</LockAnnounceContext.Provider>
    </LockPanelContext.Provider>
  );
}
