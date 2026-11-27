import { useMemo } from 'react';
import type { LockSlotState, State } from '@escape-the-crypt/core';
import { artRoomForState } from './art-room';
import type { ArtRoom } from './art-room';
import { createArtFailureLog } from './art-failure-log';
import type { ArtFailureLog } from './art-failure-log';
import { partitionDrawnSlots } from './scene-layout';
import { useScene } from './use-scene';
import type { SceneLoader, SceneState } from './use-scene';

export interface RoomArt {
  readonly artRoom: ArtRoom | null;
  readonly log: ArtFailureLog;
  readonly sceneState: SceneState;
  /** Every Lock_Slot of the current room, in slot order. */
  readonly slots: readonly LockSlotState[];
  /** Slots that have art, once the scene is ready. */
  readonly drawn: readonly LockSlotState[];
  /**
   * Slots that need a plain button. Empty while the scene loads, so no button is swapped out
   * from under a click; every slot after a failure; the slots without art once the scene is ready.
   */
  readonly plain: readonly LockSlotState[];
}

/** The current room's scene and the split between drawn locks and plain buttons. */
export function useRoomArt(state: State, loader?: SceneLoader): RoomArt {
  const room = state.rooms.find((r) => r.roomId === state.currentRoomId);
  const slots = room?.lockSlots ?? [];
  const artRoom = artRoomForState(state);
  const log = useMemo(() => createArtFailureLog(), [artRoom]);
  const sceneState = useScene(artRoom, log, loader);
  if (sceneState.status === 'loading') return { artRoom, log, sceneState, slots, drawn: [], plain: [] };
  if (sceneState.status === 'failed' || artRoom === null) {
    return { artRoom, log, sceneState, slots, drawn: [], plain: slots };
  }
  const { drawn, undrawn } = partitionDrawnSlots(sceneState.scene, slots);
  return { artRoom, log, sceneState, slots, drawn, plain: undrawn };
}
