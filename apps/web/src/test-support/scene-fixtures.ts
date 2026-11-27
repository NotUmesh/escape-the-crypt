import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { act } from 'react';
import type { LockSlotState, LockType } from '@escape-the-crypt/core';
import type { SceneLoader } from '../features/crypt/use-scene';
import { SceneFileSchema } from '../features/crypt/scene-types';
import type { SceneFile } from '../features/crypt/scene-types';

/** A real scene.json from public/art, parsed. Tests run with the web app as the working directory. */
export function realScene(room = 'burial-chamber'): SceneFile {
  const path = join(process.cwd(), 'public', 'art', 'rooms', room, 'scene.json');
  return SceneFileSchema.parse(JSON.parse(readFileSync(path, 'utf8')));
}

export function slotOf(type: LockType, over: Partial<LockSlotState> = {}): LockSlotState {
  return {
    slotId: `slot-${type}`,
    stationType: type,
    currentQuestionId: `q-${type}`,
    currentQuestionType: type,
    status: 'open',
    candleLit: false,
    appliedHint: null,
    evidencePanelOpen: false,
    judgedResult: null,
    ...over,
  };
}



/** A loader whose scene never arrives: the plain lock buttons are the fallback. */
export const failedSceneLoader: SceneLoader = () => Promise.resolve({ ok: false, error: { kind: 'network' } });

/** Lets a resolved scene load settle inside act. */
export async function flushScene(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}
