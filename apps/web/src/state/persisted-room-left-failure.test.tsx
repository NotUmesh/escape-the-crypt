import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { IDBFactory, IDBKeyRange as FakeIDBKeyRange } from 'fake-indexeddb';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { buildHumanHeartSampleCrypt } from '@escape-the-crypt/core';
import type { HumanHeartQuestionsFile, SampleCryptResult } from '@escape-the-crypt/core';
import { usePersistedRoom } from './persisted-room';
import type { BuildCrypt, RoomBinding } from './room-binding';
import { loadEvents, loadRun } from './storage/run-repository';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const SAMPLES = join(process.cwd(), '..', '..', 'samples');

function build(): SampleCryptResult {
  const notes = readFileSync(join(SAMPLES, 'human-heart.txt'), 'utf8');
  const file = JSON.parse(
    readFileSync(join(SAMPLES, 'questions', 'human-heart.json'), 'utf8'),
  ) as HumanHeartQuestionsFile;
  const built = buildHumanHeartSampleCrypt(notes, file);
  if (!built.ok) throw new Error(`sample crypt failed: ${built.error.kind}`);
  return built.value;
}

const CRYPT = build();
const okBuild: BuildCrypt = () => ({ ok: true, value: CRYPT });
const tick = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** Calls on a real IDB object keep their own `this`. */
function wrap<T extends object>(target: T, override: (prop: string | symbol) => unknown): T {
  return new Proxy(target, {
    get: (t, prop) => {
      const custom = override(prop);
      if (custom !== undefined) return custom;
      const value = Reflect.get(t, prop, t) as unknown;
      return typeof value === 'function' ? (value as (...a: unknown[]) => unknown).bind(t) : value;
    },
    set: (t, prop, value) => Reflect.set(t, prop, value, t),
  });
}

/** Behaves like the real factory, except a status write of `left` aborts its transaction. */
function failingLeftFactory(real: IDBFactory): IDBFactory {
  const wrapTx = (tx: IDBTransaction): IDBTransaction =>
    wrap(tx, (prop) => {
      if (prop !== 'objectStore') return undefined;
      return (name: string) =>
        wrap(tx.objectStore(name), (p) => {
          if (p !== 'put') return undefined;
          return (value: { status?: string }, key?: IDBValidKey) => {
            if (value.status === 'left') {
              tx.abort();
              return undefined;
            }
            return tx.objectStore(name).put(value, key);
          };
        });
    });
  const wrapDb = (db: IDBDatabase): IDBDatabase =>
    wrap(db, (prop) =>
      prop === 'transaction'
        ? (stores: string | string[], mode?: IDBTransactionMode) => wrapTx(db.transaction(stores, mode))
        : undefined,
    );
  return wrap(real, (prop) => {
    if (prop !== 'open') return undefined;
    return (name: string, version?: number) => {
      const inner = real.open(name, version);
      const req = wrap(inner, (p) => {
        if (p === 'result') return inner.readyState === 'done' ? wrapDb(inner.result) : inner.result;
        return undefined;
      });
      return req;
    };
  });
}

describe('usePersistedRoom when marking the old run left fails', () => {
  beforeAll(() => {
    vi.stubGlobal('IDBKeyRange', FakeIDBKeyRange);
  });
  afterAll(() => {
    vi.unstubAllGlobals();
  });

  // **Validates: Requirements 3.4, 7.2, 7.5**
  it('sets saveFailed, keeps play going and still saves the new run', async () => {
    const real = new IDBFactory();
    const factory = failingLeftFactory(real);
    const ids = ['run-old', 'run-new'];
    let current: RoomBinding | undefined;
    function Probe(): null {
      current = usePersistedRoom(okBuild, { factory, newRunId: () => ids.shift() ?? 'run-extra', now: () => 1 });
      return null;
    }
    const binding = (): RoomBinding => {
      if (current === undefined) throw new Error('not mounted');
      return current;
    };
    const root = createRoot(document.createElement('div'));
    try {
      await act(async () => {
        root.render(<Probe />);
      });
      await act(async () => {
        binding().dispatch({ type: 'startRun' });
      });
      for (let i = 0; i < 10; i += 1) {
        await act(async () => {
          await tick(10);
        });
      }
      expect(binding().saveFailed).toBe(false);

      await act(async () => {
        binding().dispatch({ type: 'startRun' });
      });
      for (let i = 0; i < 40 && !binding().saveFailed; i += 1) {
        await act(async () => {
          await tick(10);
        });
      }
      expect(binding().saveFailed).toBe(true);
      // Play continues: the new run has a state and accepts further actions.
      expect(binding().state).not.toBeNull();
      const length = binding().eventLog.length;
      expect(length).toBeGreaterThan(0);
      for (let i = 0; i < 10; i += 1) {
        await act(async () => {
          await tick(10);
        });
      }
      // The banner stays on after the new run's own writes settle.
      expect(binding().saveFailed).toBe(true);

      const oldRun = await loadRun(real, 'run-old');
      expect(oldRun.ok && oldRun.value.status).toBe('active');
      const newRun = await loadRun(real, 'run-new');
      expect(newRun.ok && newRun.value.status).toBe('active');
      const stored = await loadEvents(real, 'run-new');
      expect(stored.ok && stored.value.length).toBe(length);
    } finally {
      await act(async () => {
        root.unmount();
      });
    }
  }, 30000);
});
