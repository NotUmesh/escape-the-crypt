import { useEffect, useState } from 'react';
import { loadScene } from './scene-loader';
import type { SceneFile } from './scene-types';
import type { ArtFailureLog } from './art-failure-log';

export type SceneLoader = typeof loadScene;

export type SceneState =
  | { readonly status: 'loading' }
  | { readonly status: 'ready'; readonly scene: SceneFile }
  | { readonly status: 'failed' };

export function sceneFileLabel(artRoom: string): string {
  return `rooms/${artRoom}/scene.json`;
}

/**
 * Loads one Art_Room's Scene_File. A failure is logged once and leaves the plain buttons
 * in place (Requirement 23.3). `loader` is injectable so tests need no network.
 */
export function useScene(
  artRoom: string | null,
  log: ArtFailureLog,
  loader: SceneLoader = loadScene,
): SceneState {
  const [state, setState] = useState<{ readonly room: string | null; readonly value: SceneState }>({
    room: null,
    value: { status: 'loading' },
  });
  useEffect(() => {
    if (artRoom === null) return undefined;
    let cancelled = false;
    void loader(artRoom).then((result) => {
      if (cancelled) return;
      if (result.ok) {
        setState({ room: artRoom, value: { status: 'ready', scene: result.value } });
        return;
      }
      log(sceneFileLabel(artRoom), 'scene-load-failed');
      setState({ room: artRoom, value: { status: 'failed' } });
    });
    return () => {
      cancelled = true;
    };
  }, [artRoom, loader, log]);
  if (artRoom === null) return { status: 'failed' };
  return state.room === artRoom ? state.value : { status: 'loading' };
}
