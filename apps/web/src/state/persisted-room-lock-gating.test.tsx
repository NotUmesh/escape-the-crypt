import { IDBFactory, IDBKeyRange as FakeIDBKeyRange } from 'fake-indexeddb';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { SAMPLE_CRYPT } from '../test-support/sample-bundle';
import { usePersistedRoom } from './persisted-room';
import type { BuildCrypt, RoomBinding } from './room-binding';
import { waitFor } from '../test-support/wait-for';
import { loadEvents } from './storage/run-repository';
import type { LockManagerLike, RunLockState } from './storage/run-lock';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const okBuild: BuildCrypt = () => ({ ok: true, value: SAMPLE_CRYPT });
const RUN_ID = 'run-gating';
const slotId = SAMPLE_CRYPT.manifest.rooms.flatMap((r) => r.lockSlots.map((s) => s.slotId))[0] ?? '';

type FirstRequest = 'grant' | 'deny' | 'pending';

/** A scriptable Web Locks stand-in: the first (ifAvailable) request is granted, denied or left unanswered. */
class StubLocks implements LockManagerLike {
  private abortHolder: (() => void) | null = null;
  private answerPending: (() => void) | null = null;

  constructor(private readonly first: FirstRequest) {}

  request(
    _name: string,
    options: { readonly ifAvailable?: boolean; readonly steal?: boolean },
    callback: (lock: unknown) => Promise<unknown> | unknown,
  ): Promise<unknown> {
    if (options.steal === true) return this.grant(callback);
    if (this.first === 'deny') return Promise.resolve(callback(null));
    if (this.first === 'pending')
      return new Promise((resolve) => {
        this.answerPending = () => resolve(this.grant(callback));
      });
    return this.grant(callback);
  }

  /** The browser answers a request that was still pending with a grant. */
  grantPending(): void {
    this.answerPending?.();
  }

  /** Another tab steals the lock: the current holder's request is aborted. */
  stealByOtherTab(): void {
    this.abortHolder?.();
  }

  private grant(callback: (lock: unknown) => Promise<unknown> | unknown): Promise<unknown> {
    return new Promise((resolve, reject) => {
      this.abortHolder = () => reject(new Error('AbortError'));
      Promise.resolve(callback({})).then(resolve, reject);
    });
  }
}

const settle = async (): Promise<void> => {
  for (let i = 0; i < 2; i += 1)
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 40));
    });
};

interface Harness {
  /** Waits (polling) until the hook reports this lock state. */
  readonly untilLock: (state: RunLockState) => Promise<void>;
  /** Waits (polling) until every accepted event is stored, and returns how many that is. */
  readonly untilSaved: () => Promise<number>;
  readonly locks: StubLocks;
  readonly binding: () => RoomBinding;
  readonly stored: () => Promise<number>;
  readonly dispatch: (action: Parameters<RoomBinding['dispatch']>[0]) => void;
  readonly takeOver: () => Promise<void>;
  readonly expectLock: (state: RunLockState) => void;
}

interface GatingCase {
  readonly title: string;
  readonly first: FirstRequest;
  readonly run: (h: Harness) => Promise<void>;
}

/*
 * The fixed set of lock interleavings (grant, loss, steal). Each case starts a run, then:
 *  1. pending      : the lock request is never answered (acquiring)           -> nothing written
 *  2. pending→grant: acquiring, then the browser grants it (held)             -> backlog written
 *  3. denied       : another tab holds it (waiting)                           -> nothing written
 *  4. denied→steal : waiting, then this tab steals it (held)                  -> backlog and new events written
 *  5. granted      : held from the start                                      -> everything written
 *  6. granted→lost : held, writes happen, another tab steals (lost)           -> no row after the steal
 *  7. steal→lost   : waiting, this tab steals, another tab steals back (lost) -> no row after the second steal
 *  8. no manager   : no Web Locks and no channel (single-tab)                 -> everything written
 */
const CASES: readonly GatingCase[] = [
  {
    title: 'lock request never answered: acquiring, no event row is written',
    first: 'pending',
    run: async (h) => {
      h.dispatch({ type: 'startRun' });
      await settle();
      h.expectLock('acquiring');
      h.dispatch({ type: 'openLock', slotId });
      await settle();
      expect(h.binding().eventLog.length).toBeGreaterThan(0);
      expect(await h.stored()).toBe(0);
    },
  },
  {
    title: 'acquiring, then granted: nothing before the grant, the whole log after it',
    first: 'pending',
    run: async (h) => {
      h.dispatch({ type: 'startRun' });
      await settle();
      expect(await h.stored()).toBe(0);
      await act(async () => h.locks.grantPending());
      await h.untilLock('held');
      await h.untilSaved();
      expect(await h.stored()).toBe(h.binding().eventLog.length);
    },
  },
  {
    title: 'denied: waiting, no event row is written however many events are accepted',
    first: 'deny',
    run: async (h) => {
      h.dispatch({ type: 'startRun' });
      await settle();
      h.dispatch({ type: 'openLock', slotId });
      await h.untilLock('waiting');
      // Nothing written cannot be polled for: the state that holds writes back is reached, then a grace.
      await settle();
      h.expectLock('waiting');
      expect(h.binding().eventLog.length).toBeGreaterThan(0);
      expect(await h.stored()).toBe(0);
    },
  },
  {
    title: 'denied, then this tab steals the lock: writes resume with the held log',
    first: 'deny',
    run: async (h) => {
      h.dispatch({ type: 'startRun' });
      await settle();
      expect(await h.stored()).toBe(0);
      await act(async () => h.takeOver());
      await h.untilLock('held');
      h.dispatch({ type: 'openLock', slotId });
      await h.untilSaved();
      expect(await h.stored()).toBe(h.binding().eventLog.length);
    },
  },
  {
    title: 'granted from the start: held, every accepted event is written',
    first: 'grant',
    run: async (h) => {
      h.dispatch({ type: 'startRun' });
      await h.untilLock('held');
      h.dispatch({ type: 'openLock', slotId });
      await h.untilSaved();
      const total = h.binding().eventLog.length;
      expect(total).toBeGreaterThan(0);
      expect(await h.stored()).toBe(total);
    },
  },
  {
    title: 'granted, then stolen by another tab: lost, the old holder writes nothing more',
    first: 'grant',
    run: async (h) => {
      h.dispatch({ type: 'startRun' });
      await h.untilLock('held');
      const written = await h.untilSaved();
      expect(written).toBeGreaterThan(0);
      await act(async () => h.locks.stealByOtherTab());
      await h.untilLock('lost');
      const before = h.binding().eventLog.length;
      h.dispatch({ type: 'openLock', slotId });
      // Nothing written after the loss cannot be polled for: the event is accepted in memory, then a grace.
      await waitFor(() => h.binding().eventLog.length > before, { what: 'the event to be accepted in memory' });
      await settle();
      expect(h.binding().eventLog.length).toBeGreaterThan(before);
      expect(await h.stored()).toBe(written);
    },
  },
  {
    title: 'denied, stolen by this tab, then stolen back by another tab: lost, no row after that',
    first: 'deny',
    run: async (h) => {
      h.dispatch({ type: 'startRun' });
      await settle();
      await act(async () => h.takeOver());
      await h.untilLock('held');
      const written = await h.untilSaved();
      await act(async () => h.locks.stealByOtherTab());
      await h.untilLock('lost');
      h.dispatch({ type: 'openLock', slotId });
      // Nothing written after the loss cannot be polled for: a short grace.
      await settle();
      expect(await h.stored()).toBe(written);
    },
  },
];

describe('usePersistedRoom write gating by run lock', () => {
  let root: Root | undefined;

  beforeAll(() => {
    vi.stubGlobal('IDBKeyRange', FakeIDBKeyRange);
  });
  afterEach(() => {
    if (root !== undefined) {
      const mounted = root;
      act(() => mounted.unmount());
      root = undefined;
    }
  });
  afterAll(() => {
    vi.unstubAllGlobals();
  });

  function mount(locks: LockManagerLike | undefined, factory: IDBFactory): () => RoomBinding {
    let latest: RoomBinding | null = null;
    const options = { factory, now: () => 1, newRunId: () => RUN_ID, locks, channelFactory: undefined };
    function Probe(): null {
      latest = usePersistedRoom(okBuild, options);
      return null;
    }
    root = createRoot(document.createElement('div'));
    const mounted = root;
    act(() => mounted.render(createElement(Probe)));
    return () => {
      if (latest === null) throw new Error('not rendered');
      return latest;
    };
  }

  function harness(locks: StubLocks, factory: IDBFactory): Harness {
    const binding = mount(locks, factory);
    const stored = async (): Promise<number> => {
      const loaded = await loadEvents(factory, RUN_ID);
      return loaded.ok ? loaded.value.length : 0;
    };
    return {
      untilLock: (state) => waitFor(() => binding().lockState === state, { what: `the run lock to be ${state}` }),
      untilSaved: async () => {
        await waitFor(async () => (await stored()) === binding().eventLog.length, { what: 'every accepted event to be stored' });
        return stored();
      },
      locks,
      binding,
      stored: async () => {
        const loaded = await loadEvents(factory, RUN_ID);
        return loaded.ok ? loaded.value.length : 0;
      },
      dispatch: (action) => act(() => binding().dispatch(action)),
      takeOver: async () => {
        await binding().takeOver?.();
      },
      expectLock: (state) => expect(binding().lockState).toBe(state),
    };
  }

  // Feature: persistence, Property 18: Writes happen only while the run lock is held or unneeded
  // **Validates: Requirements 9.1, 9.2, 9.4**
  it.each(CASES.map((c) => [c.title, c] as const))('%s', async (_title, testCase) => {
    const factory = new IDBFactory();
    await testCase.run(harness(new StubLocks(testCase.first), factory));
  });

  // Feature: persistence, Property 18: Writes happen only while the run lock is held or unneeded
  // **Validates: Requirements 9.1, 9.2, 9.4**
  it('no lock manager (single-tab): every accepted event is written', async () => {
    const factory = new IDBFactory();
    const binding = mount(undefined, factory);
    act(() => binding().dispatch({ type: 'startRun' }));
    act(() => binding().dispatch({ type: 'openLock', slotId }));
    const stored = async (): Promise<number> => {
      const loaded = await loadEvents(factory, RUN_ID);
      return loaded.ok ? loaded.value.length : -1;
    };
    await waitFor(async () => binding().eventLog.length > 0 && (await stored()) === binding().eventLog.length, {
      what: 'every accepted event to be stored',
    });
    expect(binding().lockState).toBe('single-tab');
    expect(await stored()).toBe(binding().eventLog.length);
  });
});
