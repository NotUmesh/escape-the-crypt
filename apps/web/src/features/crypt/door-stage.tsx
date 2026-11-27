import type { ReactNode } from 'react';
import type { Outcome_Notice, State } from '@escape-the-crypt/core';
import { ArtStage } from './art-stage';
import type { Viewport } from './crop-mapping';
import type { SceneLayout } from './scene-layout';
import type { RoomArt } from './use-room-art';

export interface DoorStageProps {
  readonly art: RoomArt;
  readonly state: State;
  readonly notices?: readonly Outcome_Notice[];
  readonly viewport?: Viewport;
  /** Drawn over the art, in stage px (the seals). */
  readonly overlay?: (layout: SceneLayout) => ReactNode;
}

/**
 * The room's art with the door open and its light on, for the final door and the escape view.
 * It has no lock buttons. Draws nothing until the scene is ready.
 */
export function DoorStage({ art, state, notices, viewport, overlay }: DoorStageProps): ReactNode {
  if (art.sceneState.status !== 'ready' || art.artRoom === null) return null;
  return (
    <ArtStage
      artRoom={art.artRoom}
      scene={art.sceneState.scene}
      slots={art.drawn}
      cleared
      log={art.log}
      notices={notices}
      ghosts={state.ghosts}
      spiritCandleCount={
        (state.rooms.find((r) => r.roomId === state.currentRoomId)?.spiritCandles.length ?? 0) +
        state.finalDoor.spiritCandles.length
      }
      overlay={overlay}
      viewport={viewport}
    />
  );
}
