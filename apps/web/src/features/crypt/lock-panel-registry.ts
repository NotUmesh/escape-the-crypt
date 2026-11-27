import type { ComponentType } from 'react';
import type { LockType } from '@escape-the-crypt/core';
import { BoneOrderingPanel } from './bone-ordering-panel';
import { BoundThreadsPanel } from './bound-threads-panel';
import { CombinationDialPanel } from './combination-dial-panel';
import { CursedObjectPanel } from './cursed-object-panel';
import { RuneCipherPanel } from './rune-cipher-panel';
import { SeanceBoardPanel } from './seance-board-panel';

/** What the shell hands to a lock panel. The panel keeps its own draft. */
export interface LockPanelProps {
  readonly slotId: string;
  readonly questionId: string;
  readonly questionType: LockType;
}

export type LockPanelRegistry = Readonly<Partial<Record<LockType, ComponentType<LockPanelProps>>>>;

/** One panel per lock type. A type string outside this table falls back to the unplayable message. */
export const LOCK_PANELS: LockPanelRegistry = {
  'rune-cipher': RuneCipherPanel,
  'seance-board': SeanceBoardPanel,
  'bone-ordering': BoneOrderingPanel,
  'bound-threads': BoundThreadsPanel,
  'combination-dial': CombinationDialPanel,
  'cursed-object': CursedObjectPanel,
};
