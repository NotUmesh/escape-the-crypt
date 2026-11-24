import { describe, expect, it } from 'vitest';
import { buildManifest } from '../test-support/manifest-fixture';
import { apply } from './apply';
import { initial } from './initial';
import { SETTINGS } from '../test-support/run-settings';
import type { CryptManifest } from './manifest-types';

const manifest = buildManifest({ rooms: 2, conceptsPerRoom: 3 });
const start = { kind: 'RunStarted', manifestId: manifest.manifestId } as const;

describe('RunStarted', () => {
  it('starts the run and sets remaining hints from the allowance', () => {
    const result = apply(initial(manifest, SETTINGS), start);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.status).toBe('in progress');
    expect(result.state.remainingHints).toBe(3);
    expect(result.state.settings).toEqual(SETTINGS);
    expect(result.notices).toEqual([]);
  });

  it('rejects a different manifest ID with manifest-mismatch', () => {
    const result = apply(initial(manifest, SETTINGS), { kind: 'RunStarted', manifestId: 'other' });
    expect(result).toEqual({ ok: false, error: { kind: 'manifest-mismatch' } });
  });

  it('rejects a second start with run-already-started', () => {
    const first = apply(initial(manifest, SETTINGS), start);
    if (!first.ok) throw new Error('setup');
    expect(apply(first.state, start)).toEqual({ ok: false, error: { kind: 'run-already-started' } });
  });

  it('returns the invalid-manifest error from the check and leaves state unchanged', () => {
    const room = manifest.rooms[0];
    const slot = room?.lockSlots[0];
    if (!room || !slot) throw new Error('fixture');
    const bad: CryptManifest = {
      ...manifest,
      rooms: [{ ...room, lockSlots: [...room.lockSlots, { ...slot, slotId: 'again' }] }],
    };
    const state = initial(bad, SETTINGS);
    const before = JSON.stringify(state);
    expect(apply(state, start)).toEqual({
      ok: false,
      error: { kind: 'invalid-manifest', room: 'room-1', lockType: slot.stationType },
    });
    expect(JSON.stringify(state)).toBe(before);
  });
});
