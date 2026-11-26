import type { ComponentType } from 'react';
import type { LockType } from '@escape-the-crypt/core';
import { RuneCipherPanel } from './rune-cipher-panel';
import { SeanceBoardPanel } from './seance-board-panel';

/** What the shell hands to a lock panel. The panel keeps its own draft. */
export interface LockPanelProps {
  readonly slotId: string;
  readonly questionId: string;
  readonly questionType: LockType;
}

export type LockPanelRegistry = Readonly<Partial<Record<LockType, ComponentType<LockPanelProps>>>>;

/** Tasks 5.2 and 5.3 add the rune cipher and séance board panels here. */
export const LOCK_PANELS: LockPanelRegistry = {
  'rune-cipher': RuneCipherPanel,
  'seance-board': SeanceBoardPanel,
};
