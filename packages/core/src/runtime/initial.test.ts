import { describe, expect, it } from 'vitest';
import { buildManifest } from '../test-support/manifest-fixture';
import { SETTINGS } from '../test-support/run-settings';
import { initial } from './initial';
import type { CryptManifest } from './manifest-types';

describe('initial', () => {
  it('starts not started with zero candles, no ghosts and no room entered', () => {
    const manifest = buildManifest({ rooms: 2, conceptsPerRoom: 3 });
    const state = initial(manifest, SETTINGS);
    expect(state.status).toBe('not started');
    expect(state.candleCount).toBe(0);
    expect(state.judgedAnswerCount).toBe(0);
    expect(state.ghosts).toEqual([]);
    expect(state.currentRoomId).toBeNull();
    expect(state.rooms.every((r) => !r.published && !r.cleared)).toBe(true);
    expect(state.concepts).toHaveLength(6);
    expect(state.manifestId).toBe(manifest.manifestId);
  });

  it('builds open lock slots from the primary questions', () => {
    const manifest = buildManifest({ rooms: 1, conceptsPerRoom: 2 });
    const slot = initial(manifest, SETTINGS).rooms[0]?.lockSlots[0];
    const spec = manifest.rooms[0]?.lockSlots[0];
    expect(slot).toMatchObject({
      slotId: spec?.slotId,
      status: 'open',
      candleLit: false,
      appliedHint: null,
      currentQuestionId: spec?.primaryQuestion.questionId,
    });
  });

  it('does not throw or check a manifest that would fail the check', () => {
    const base = buildManifest({ rooms: 1, conceptsPerRoom: 2 });
    const room = base.rooms[0];
    const slot = room?.lockSlots[0];
    if (!room || !slot) throw new Error('fixture');
    const bad: CryptManifest = {
      ...base,
      rooms: [{ ...room, lockSlots: [...room.lockSlots, { ...slot, slotId: 'again' }] }],
    };
    expect(() => initial(bad, SETTINGS)).not.toThrow();
    expect(initial(bad, SETTINGS).status).toBe('not started');
  });

  it('is JSON-safe and returns equal states for equal inputs', () => {
    const manifest = buildManifest();
    const a = initial(manifest, SETTINGS);
    expect(initial(manifest, SETTINGS)).toEqual(a);
    expect(JSON.parse(JSON.stringify(a))).toEqual(a);
  });
});
