import { IDBFactory, IDBKeyRange as FakeIDBKeyRange } from 'fake-indexeddb';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { SAMPLE_CRYPT } from '../test-support/sample-bundle';
import { usePersistedRoom } from './persisted-room';
import type { BuildCrypt, RoomBinding } from './room-binding';
import { waitFor } from '../test-support/wait-for';
import { loadEvents } from './storage/run-repository';
import type { LockManagerLike } from './storage/run-lock';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const okBuild: BuildCrypt = () => ({ ok: true, value: SAMPLE_CRYPT });

/** Another tab holds the lock: `ifAvailable` gets null; `steal` is granted. */
const heldElsewhere: LockManagerLike = {
  request: (_name, options, callback) =>
    Promise.resolve(options.steal === true ? callback({}) : callback(null)),
};

const settle = (): Promise<void> =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 50));
  });

describe('usePersistedRoom run lock', () => {
  beforeAll(() => {
    vi.stubGlobal('IDBKeyRange', FakeIDBKeyRange);
  });
  afterAll(() => {
    vi.unstubAllGlobals();
  });

  // **Validates: Requirements 9.1, 9.2, 9.3, 9.4**
  it('writes nothing while waiting, then restores and writes after takeOver', async () => {
    const factory = new IDBFactory();
    let latest: RoomBinding | null = null;
    const options = { factory, now: () => 1, newRunId: () => 'run-lock', locks: heldElsewhere, channelFactory: undefined };
    function Probe(): null {
      latest = usePersistedRoom(okBuild, options);
      return null;
    }
    const root = createRoot(document.createElement('div'));
    act(() => root.render(createElement(Probe)));
    const get = (): RoomBinding => {
      if (latest === null) throw new Error('not rendered');
      return latest;
    };

    act(() => get().dispatch({ type: 'startRun' }));
    await waitFor(() => get().lockState === 'waiting', { what: 'the run lock to report waiting' });
    // "Nothing is written" cannot be polled for: wait for the state that should hold it back, then allow a short grace.
    await settle();
    expect(get().lockState).toBe('waiting');
    expect(get().eventLog.length).toBeGreaterThan(0);
    const before = await loadEvents(factory, 'run-lock');
    expect(before.ok ? before.value.length : 0).toBe(0);

    await act(async () => {
      await get().takeOver?.();
    });
    await waitFor(() => get().lockState === 'held', { what: 'the takeover to hold the run lock' });
    expect(get().lockState).toBe('held');
    // The held log is written once the lock is ours: poll until every event is stored.
    await waitFor(
      async () => {
        const loaded = await loadEvents(factory, 'run-lock');
        return loaded.ok && loaded.value.length === get().eventLog.length;
      },
      { what: 'the held events to be written after the takeover' },
    );
    const stored = await loadEvents(factory, 'run-lock');
    expect(stored.ok).toBe(true);
    if (stored.ok) expect(stored.value.map((row) => row.event)).toEqual(get().eventLog);
    act(() => root.unmount());
  });
});
