import { describe, expect, it } from 'vitest';
import { acquireRunLock } from './run-lock';
import type { BroadcastChannelLike, LockManagerLike, RunLockState } from './run-lock';

/**
 * A Web Locks stand-in shared by every "tab" in a test. It models the three request
 * shapes the lock uses: `ifAvailable` (null grant when held), `steal` (aborts the holder),
 * and a plain grant when free.
 */
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
        const clear = (): void => {
          if (holders.get(name) === entry) holders.delete(name);
        };
        Promise.resolve(callback({})).then(
          (value) => {
            clear();
            resolve(value);
          },
          (error: unknown) => {
            clear();
            reject(error);
          },
        );
      });
    },
  };
}

/** A same-origin broadcast bus: every channel with the same name hears the others, not itself. */
function makeBus(): (name: string) => BroadcastChannelLike {
  const channels = new Map<string, Set<BroadcastChannelLike>>();
  return (name) => {
    const group = channels.get(name) ?? new Set<BroadcastChannelLike>();
    channels.set(name, group);
    const channel: BroadcastChannelLike = {
      onmessage: null,
      postMessage: (message) => {
        for (const other of [...group]) {
          if (other !== channel) other.onmessage?.({ data: message });
        }
      },
      close: () => {
        group.delete(channel);
      },
    };
    group.add(channel);
    return channel;
  };
}

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

function track(lock: { subscribe(l: (s: RunLockState) => void): () => void }): RunLockState[] {
  const seen: RunLockState[] = [];
  lock.subscribe((s) => seen.push(s));
  return seen;
}

describe('acquireRunLock with Web Locks', () => {
  // **Validates: Requirements 9.2, 9.3**
  it('first tab holds, second tab waits, takeOver steals and the first tab is lost', async () => {
    const locks = makeSharedLocks();
    const a = acquireRunLock({ locks }, 'r1');
    await flush();
    expect(a.state).toBe('held');

    const b = acquireRunLock({ locks }, 'r1');
    await flush();
    expect(b.state).toBe('waiting');
    expect(a.state).toBe('held');

    const seenA = track(a);
    await b.takeOver();
    await flush();
    expect(b.state).toBe('held');
    expect(a.state).toBe('lost');
    expect(seenA).toEqual(['lost']);
  });

  // **Validates: Requirements 9.3, 9.7**
  it('uses a separate lock per run id', async () => {
    const locks = makeSharedLocks();
    const a = acquireRunLock({ locks }, 'r1');
    const b = acquireRunLock({ locks }, 'r2');
    await flush();
    expect([a.state, b.state]).toEqual(['held', 'held']);
  });

  // **Validates: Requirements 9.6, 9.7**
  it('a waiting tab does not acquire by itself when the holder releases', async () => {
    const locks = makeSharedLocks();
    const a = acquireRunLock({ locks }, 'r1');
    await flush();
    const b = acquireRunLock({ locks }, 'r1');
    await flush();
    expect(b.state).toBe('waiting');

    const seenA = track(a);
    a.release();
    await flush();
    expect(seenA).toEqual([]); // releasing is not a loss
    expect(b.state).toBe('waiting');

    await b.takeOver();
    await flush();
    expect(b.state).toBe('held');
  });

  // **Validates: Requirements 9.6, 9.7**
  it('a tab opened after the holder releases acquires the lock', async () => {
    const locks = makeSharedLocks();
    const a = acquireRunLock({ locks }, 'r1');
    await flush();
    a.release();
    await flush();
    const b = acquireRunLock({ locks }, 'r1');
    await flush();
    expect(b.state).toBe('held');
  });

  // **Validates: Requirements 9.5**
  it('does not throw when the lock manager throws, and reports single-tab', () => {
    const locks: LockManagerLike = {
      request: () => {
        throw new Error('no locks');
      },
    };
    const lock = acquireRunLock({ locks }, 'r1');
    expect(lock.state).toBe('single-tab');
  });

  it('release is safe to call twice and never throws', async () => {
    const lock = acquireRunLock({ locks: makeSharedLocks() }, 'r1');
    await flush();
    expect(() => {
      lock.release();
      lock.release();
    }).not.toThrow();
  });

  it('a failing listener does not stop others or the lock', async () => {
    const locks = makeSharedLocks();
    const a = acquireRunLock({ locks }, 'r1');
    await flush();
    const b = acquireRunLock({ locks }, 'r1');
    await flush();
    b.subscribe(() => {
      throw new Error('listener');
    });
    const seen = track(b);
    await b.takeOver();
    await flush();
    expect(seen).toEqual(['held']);
    expect(a.state).toBe('lost');
  });

  it('unsubscribe stops notifications', async () => {
    const locks = makeSharedLocks();
    acquireRunLock({ locks }, 'r1');
    await flush();
    const b = acquireRunLock({ locks }, 'r1');
    await flush();
    const seen: RunLockState[] = [];
    const off = b.subscribe((s) => seen.push(s));
    off();
    await b.takeOver();
    await flush();
    expect(seen).toEqual([]);
  });
});

describe('acquireRunLock with the BroadcastChannel fallback', () => {
  // **Validates: Requirements 9.5, 9.6**
  it('the first tab is held; a second tab hears "owned" and waits', () => {
    const channelFactory = makeBus();
    const a = acquireRunLock({ channelFactory }, 'r1');
    expect(a.state).toBe('held');
    const b = acquireRunLock({ channelFactory }, 'r1');
    expect(b.state).toBe('waiting');
    expect(a.state).toBe('held');
  });

  // **Validates: Requirements 9.3, 9.5**
  it('takeover makes the other tab lost and this tab held', async () => {
    const channelFactory = makeBus();
    const a = acquireRunLock({ channelFactory }, 'r1');
    const b = acquireRunLock({ channelFactory }, 'r1');
    expect(b.state).toBe('waiting');
    await b.takeOver();
    expect(b.state).toBe('held');
    expect(a.state).toBe('lost');
  });

  it('different runs do not interfere', () => {
    const channelFactory = makeBus();
    const a = acquireRunLock({ channelFactory }, 'r1');
    const b = acquireRunLock({ channelFactory }, 'r2');
    expect([a.state, b.state]).toEqual(['held', 'held']);
  });

  it('a released tab stops answering hello, so a new tab is held', () => {
    const channelFactory = makeBus();
    const a = acquireRunLock({ channelFactory }, 'r1');
    a.release();
    const b = acquireRunLock({ channelFactory }, 'r1');
    expect(b.state).toBe('held');
  });

  it('ignores malformed messages', () => {
    const channelFactory = makeBus();
    const a = acquireRunLock({ channelFactory }, 'r1');
    const stray = channelFactory('run:r1');
    stray.postMessage(null);
    stray.postMessage('takeover');
    stray.postMessage({ type: 'other', from: 'x' });
    expect(a.state).toBe('held');
  });

  it('falls back to single-tab when the channel cannot be created', () => {
    const lock = acquireRunLock(
      {
        channelFactory: () => {
          throw new Error('no channel');
        },
      },
      'r1',
    );
    expect(lock.state).toBe('single-tab');
  });
});

describe('acquireRunLock with neither API', () => {
  // **Validates: Requirements 9.5, 12.10**
  it('reports single-tab, and takeOver and release do nothing harmful', async () => {
    for (const deps of [undefined, {}]) {
      const lock = acquireRunLock(deps, 'r1');
      expect(lock.state).toBe('single-tab');
      await expect(lock.takeOver()).resolves.toBeUndefined();
      expect(() => lock.release()).not.toThrow();
      expect(lock.state).toBe('single-tab');
    }
  });
});
