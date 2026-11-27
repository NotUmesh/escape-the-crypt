import type { LockType } from '@escape-the-crypt/core';
import { chooseBlock } from './scene-layout';
import type { SceneFile } from './scene-types';

export type PanelSide = 'left' | 'right';

/**
 * The side a lock's Question_Panel opens on: the `panelSide` of its Scene_File entry (Requirement 13.1).
 * A lock the scene does not draw, or no scene at all, gives the right side, as at the final door.
 */
export function panelSideFor(scene: SceneFile | null, lockType: LockType, phone: boolean): PanelSide {
  if (scene === null) return 'right';
  return chooseBlock(scene, phone).block.locks[lockType]?.panelSide ?? 'right';
}
