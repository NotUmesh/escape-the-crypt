/**
 * Single-tab ownership of a run (persistence spec, Req 9).
 *
 * Uses Web Locks when available, a BroadcastChannel as a best-effort fallback,
 * and reports `single-tab` when neither exists. Nothing here throws.
 */

/** cquiring: Web Locks request not answered yet. It is not writable and not yet a conflict. */
export type RunLockState = 'acquiring' | 'held' | 'waiting' | 'lost' | 'single-tab';

export interface RunLock {
  readonly state: RunLockState;
  takeOver(): Promise<void>;
  release(): void;
  subscribe(listener: (state: RunLockState) => void): () => void;
}

/** The part of `LockManager` this module uses. */
export interface LockManagerLike {
  request(
    name: string,
    options: { readonly ifAvailable?: boolean; readonly steal?: boolean },
    callback: (lock: unknown) => Promise<unknown> | unknown,
  ): Promise<unknown>;
}

/** The part of `BroadcastChannel` this module uses. */
export interface BroadcastChannelLike {
  postMessage(message: unknown): void;
  close(): void;
  onmessage: ((event: { readonly data: unknown }) => void) | null;
}

export interface RunLockDeps {
  readonly locks?: LockManagerLike;
  readonly channelFactory?: (name: string) => BroadcastChannelLike;
}

type Listener = (state: RunLockState) => void;

interface Core {
  state: RunLockState;
  released: boolean;
  readonly listeners: Set<Listener>;
}

function setState(core: Core, next: RunLockState): void {
  if (core.state === next) return;
  core.state = next;
  for (const listener of [...core.listeners]) {
    try {
      listener(next);
    } catch {
      // A failing listener must not affect the lock.
    }
  }
}

function makeLock(core: Core, takeOver: () => Promise<void>, release: () => void): RunLock {
  return {
    get state() {
      return core.state;
    },
    takeOver: async () => {
      try {
        await takeOver();
      } catch {
        // Never throw.
      }
    },
    release: () => {
      core.released = true;
      try {
        release();
      } catch {
        // Never throw.
      }
    },
    subscribe: (listener) => {
      core.listeners.add(listener);
      return () => {
        core.listeners.delete(listener);
      };
    },
  };
}

function isDeps(value: RunLockDeps | undefined): RunLockDeps {
  return value ?? {};
}

function acquireWithLocks(locks: LockManagerLike, runId: string): RunLock {
  const name = `run:${runId}`;
  const core: Core = { state: 'acquiring', released: false, listeners: new Set() };
  const holders = new Set<() => void>();

  /** Requests the lock and keeps it until the returned release function runs. */
  const hold = (
    options: { readonly ifAvailable?: boolean; readonly steal?: boolean },
    onNull: () => void,
    onGranted: () => void,
  ): Promise<void> =>
    new Promise<void>((settled) => {
      let free: () => void = () => undefined;
      const pending = new Promise<void>((resolve) => {
        free = resolve;
      });
      const callback = (lock: unknown): Promise<void> | undefined => {
        if (lock === null || lock === undefined) {
          onNull();
          settled();
          return undefined;
        }
        if (core.released) {
          settled();
          return undefined;
        }
        holders.add(free);
        onGranted();
        settled();
        return pending;
      };
      let request: Promise<unknown>;
      try {
        request = locks.request(name, options, callback);
      } catch {
        // Unusable lock manager: do not block play.
        setState(core, 'single-tab');
        settled();
        return;
      }
      request.then(
        () => {
          holders.delete(free);
        },
        () => {
          // The lock was stolen (AbortError) or the request failed.
          holders.delete(free);
          settled();
          if (!core.released) setState(core, 'lost');
        },
      );
    });

  void hold(
    { ifAvailable: true },
    () => setState(core, 'waiting'),
    () => setState(core, 'held'),
  );

  return makeLock(
    core,
    () =>
      hold(
        { steal: true },
        () => setState(core, 'waiting'),
        () => setState(core, 'held'),
      ),
    () => {
      for (const free of [...holders]) free();
      holders.clear();
    },
  );
}

function acquireWithChannel(
  channelFactory: (name: string) => BroadcastChannelLike,
  runId: string,
): RunLock | null {
  let channel: BroadcastChannelLike;
  try {
    channel = channelFactory(`run:${runId}`);
  } catch {
    return null;
  }
  const self = Math.random().toString(36).slice(2) + Date.now().toString(36);
  const core: Core = { state: 'held', released: false, listeners: new Set() };

  const post = (type: 'hello' | 'owned' | 'takeover'): void => {
    try {
      channel.postMessage({ type, from: self });
    } catch {
      // Best effort.
    }
  };

  channel.onmessage = (event) => {
    const data = event.data;
    if (typeof data !== 'object' || data === null) return;
    const { type, from } = data as { type?: unknown; from?: unknown };
    if (from === self || core.released) return;
    if (type === 'hello' && core.state === 'held') post('owned');
    else if (type === 'owned' && core.state === 'held') setState(core, 'waiting');
    else if (type === 'takeover' && core.state === 'held') setState(core, 'lost');
  };

  post('hello');

  return makeLock(
    core,
    async () => {
      post('takeover');
      setState(core, 'held');
    },
    () => {
      channel.onmessage = null;
      channel.close();
    },
  );
}

export function acquireRunLock(deps: RunLockDeps | undefined, runId: string): RunLock {
  const { locks, channelFactory } = isDeps(deps);
  try {
    if (locks) return acquireWithLocks(locks, runId);
    if (channelFactory) {
      const viaChannel = acquireWithChannel(channelFactory, runId);
      if (viaChannel) return viaChannel;
    }
  } catch {
    // Fall through to single-tab.
  }
  const core: Core = { state: 'single-tab', released: false, listeners: new Set() };
  return makeLock(
    core,
    async () => undefined,
    () => undefined,
  );
}
