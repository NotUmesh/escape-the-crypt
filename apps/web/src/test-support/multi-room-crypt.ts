import type { RunSettings } from '@escape-the-crypt/core';
import type { BuiltCrypt } from '../state/room-binding';
import { SAMPLE_CRYPT } from './sample-bundle';

/**
 * The sample crypt's two locks split into two rooms of one lock each, as a generated crypt from
 * notes. Every question and concept is the sample's own, so content, chunks and judging all work.
 */
export function twoRoomCrypt(settings?: RunSettings): BuiltCrypt {
  const [first, second] = SAMPLE_CRYPT.manifest.rooms[0]?.lockSlots ?? [];
  if (first === undefined || second === undefined) throw new Error('the sample has two locks');
  return {
    ...SAMPLE_CRYPT,
    manifest: {
      manifestId: 'crypt-two-rooms-test',
      rooms: [
        { roomId: 'room-1', lockSlots: [first] },
        { roomId: 'room-2', lockSlots: [second] },
      ],
      finalDoor: SAMPLE_CRYPT.manifest.finalDoor,
    },
    source: 'notes',
    ...(settings === undefined ? {} : { settings }),
  };
}
