import { IDBFactory, IDBKeyRange as FakeIDBKeyRange } from 'fake-indexeddb';
import { act, createElement, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { ENTER_CRYPT_LABEL } from '@escape-the-crypt/core';
import { waitFor } from '../../test-support/wait-for';
import { createIdbStore } from '../ingest/notes-store-idb';
import { CryptFlow } from '../crypt/crypt-flow';
import { usePersistedRoom } from '../../state/persisted-room';
import { useRoomBinding } from '../../state/room-binding';
import type { BuildCrypt, RoomBinding } from '../../state/room-binding';
import { buildSampleCrypt } from '../../state/sample-crypt-source';
import { acquireRunLock } from '../../state/storage/run-lock';
import { loadEvents } from '../../state/storage/run-repository';
import type { LockManagerLike, RunLock } from '../../state/storage/run-lock';
import { SAMPLE_CRYPT } from '../../test-support/sample-bundle';
import { TAKE_OVER_LABEL } from './read-only-screen';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** Web Locks stand-in shared by both tabs: ifAvailable gets null when held; steal aborts the holder. */
function makeSharedLocks(): LockManagerLike {
  const holders = new Map<string, { abort: (reason: unknown) => void }>();
  return {
    request: (name, options, callback) => {
      const current = holders.get(name);
      if (current !== undefined && options.ifAvailable === true && options.steal !== true) {
        return Promise.resolve(callback(null));
      }
      if (current !== undefined && options.steal === true) {
        holders.delete(name);
        current.abort(Object.assign(new Error('stolen'), { name: 'AbortError' }));
      }
      return new Promise((resolve, reject) => {
        const entry = { abort: reject };
        holders.set(name, entry);
        Promise.resolve(callback({})).then(resolve, reject);
      });
    },
  };
}


const okBuild: BuildCrypt = () => ({ ok: true, value: SAMPLE_CRYPT });
const RUN_ID = 'run-two-tabs';

describe('second tab: read-only screen and "Take over here"', () => {
  beforeAll(() => {
    vi.stubGlobal('IDBKeyRange', FakeIDBKeyRange);
  });
  afterAll(() => {
    vi.unstubAllGlobals();
  });

  // **Validates: Requirements 9.2, 9.3, 9.7, 12.10**
  it('shows the saved run read-only, then takeover restores a playable crypt and the old tab is lost', async () => {
    const factory = new IDBFactory();
    const locks = makeSharedLocks();

    // Tab A owns the run and writes its first events.
    let tabA: RoomBinding | null = null;
    function TabA(): null {
      tabA = usePersistedRoom(okBuild, { factory, now: () => 1, newRunId: () => RUN_ID, locks, channelFactory: undefined });
      return null;
    }
    const rootA = createRoot(document.createElement('div'));
    act(() => rootA.render(createElement(TabA)));
    act(() => tabA?.dispatch({ type: 'startRun' }));
    await waitFor(() => (tabA as RoomBinding | null)?.lockState === 'held', { what: 'tab A to hold the run lock' });
    expect((tabA as RoomBinding | null)?.lockState).toBe('held');
    // Tab B shows what was saved, so tab A's events must be stored before tab B opens the run.
    await waitFor(
      async () => {
        const stored = await loadEvents(factory, RUN_ID);
        return stored.ok && stored.value.length > 0 && stored.value.length === (tabA as RoomBinding | null)?.eventLog.length;
      },
      { what: "tab A's events to be stored" },
    );

    // Tab B opens the same run through the real lock, rendered by CryptFlow.
    let lockB: RunLock | null = null;
    const useTabB = (): RoomBinding => {
      const base = useRoomBinding(buildSampleCrypt);
      const [lock] = useState(() => {
        lockB = acquireRunLock({ locks }, RUN_ID);
        return lockB;
      });
      const [lockState, setLockState] = useState(lock.state);
      const [subscribed] = useState(() => lock.subscribe(setLockState));
      void subscribed;
      return {
        ...base,
        runId: RUN_ID,
        lockState,
        takeOver: async () => {
          await lock.takeOver();
          setLockState(lock.state);
        },
      };
    };
    const container = document.createElement('div');
    document.body.append(container);
    const rootB = createRoot(container);
    const restoreDeps = { factory, notesStore: createIdbStore(factory) };
    act(() => rootB.render(createElement(CryptFlow, { useBinding: useTabB, restoreDeps })));
    await waitFor(() => container.querySelector('[data-testid="read-only-crypt"]') !== null, { what: 'the read-only screen to show the saved crypt' });

    const screen = container.querySelector('[data-testid="read-only-screen"]');
    expect(screen).not.toBeNull();
    expect(container.textContent).not.toContain(ENTER_CRYPT_LABEL);
    expect(container.querySelector('[data-testid="read-only-crypt"]')).not.toBeNull();
    expect(screen?.querySelectorAll('[data-testid="read-only-locks"] button')).toHaveLength(0);

    const button = Array.from(container.querySelectorAll('button')).find((b) => b.textContent === TAKE_OVER_LABEL);
    expect(button).toBeDefined();
    await act(async () => button?.click());
    await waitFor(() => container.querySelector('[data-testid="read-only-screen"]') === null, { what: 'the take over to restore the crypt' });

    expect(container.querySelector('[data-testid="read-only-screen"]')).toBeNull();
    expect(container.textContent).toContain(ENTER_CRYPT_LABEL);
    expect((lockB as RunLock | null)?.state).toBe('held');
    expect(tabA === null ? undefined : (tabA as RoomBinding).lockState).toBe('lost');

    act(() => rootB.unmount());
    act(() => rootA.unmount());
    container.remove();
  });
});
