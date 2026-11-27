import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { LockType, SlotStatus } from '@escape-the-crypt/core';
import { realScene } from '../../test-support/scene-fixtures';
import { artRoomForPosition } from './art-room';
import type { ArtRoom } from './art-room';
import { lightImageFile, lockImageFile } from './lock-layer';
import type { SceneBlock } from './scene-types';

// Requirements 24.1, 24.2: every file a Scene_File implies exists on disk.
const ROOMS_DIR = join(process.cwd(), 'public', 'art', 'rooms');
const ART_ROOMS: readonly ArtRoom[] = [1, 2, 3].map((position) => {
  const room = artRoomForPosition(position);
  if (room === null) throw new Error(`no art room at position ${position}`);
  return room;
});
const LOCK_STATES: readonly (readonly [SlotStatus, boolean])[] = [
  ['open', false],
  ['open', true],
  ['solved', false],
  ['solved', true],
];

function lockTypesOf(block: SceneBlock): LockType[] {
  return Object.keys(block.locks) as LockType[];
}

/** Every file a block needs, relative to the Art_Room folder. */
function filesNeeded(directory: 'desktop' | 'mobile', block: SceneBlock): string[] {
  const names = ['background.webp', 'foreground.webp', 'door-closed.webp', 'door-open.webp', 'light-door.webp'];
  if (directory === 'desktop') names.push('background@2x.webp');
  for (const lock of lockTypesOf(block)) {
    for (const [status, hovered] of LOCK_STATES) names.push(lockImageFile(lock, status, hovered));
    names.push(lightImageFile(lock));
  }
  return names.map((name) => `${directory}/${name}`);
}

describe.each(ART_ROOMS)('Art_Room %s', (artRoom) => {
  const scene = realScene(artRoom);

  it('names itself in its scene.json', () => {
    expect(scene.room).toBe(artRoom);
  });

  it('has every desktop file the scene needs', () => {
    const missing = filesNeeded('desktop', scene.desktop).filter((file) => !existsSync(join(ROOMS_DIR, artRoom, file)));
    expect(missing).toEqual([]);
  });

  it('has all four Lock_Layers and the Light_Pass for every lock in the scene', () => {
    const locks = lockTypesOf(scene.desktop);
    expect(locks.length).toBeGreaterThan(0);
    for (const lock of locks) {
      const files = [...LOCK_STATES.map(([status, hovered]) => lockImageFile(lock, status, hovered)), lightImageFile(lock)];
      expect(new Set(files).size).toBe(5);
      for (const file of files) {
        expect(existsSync(join(ROOMS_DIR, artRoom, 'desktop', file)), `${artRoom}/desktop/${file}`).toBe(true);
      }
    }
  });

  it('has the mobile files too when the scene has a mobile block', () => {
    if (scene.mobile === undefined) return;
    const missing = filesNeeded('mobile', scene.mobile).filter((file) => !existsSync(join(ROOMS_DIR, artRoom, file)));
    expect(missing).toEqual([]);
  });
});
