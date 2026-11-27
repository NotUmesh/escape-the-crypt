import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import fc from 'fast-check';
import { IDBFactory, IDBKeyRange as FakeIDBKeyRange } from 'fake-indexeddb';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { buildHumanHeartSampleCrypt } from '@escape-the-crypt/core';
import type { HumanHeartQuestionsFile, SampleCryptResult } from '@escape-the-crypt/core';
import { usePersistedRoom } from './persisted-room';
import type { BuildCrypt, RoomBinding } from './room-binding';
import type { FailureKind } from './storage/persistence-arbitraries';
import { failurePlanArb } from './storage/persistence-arbitraries';
import { loadEvents } from './storage/run-repository';

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
const SLOT_IDS = CRYPT.manifest.rooms.flatMap((r) => r.lockSlots.map((s) => s.slotId));

type Handler = ((event?: unknown) => void) | null;

interface FakeRequest {
  result: unknown;
  error: DOMException | null;
  onsuccess: Handler;
  onerror: Handler;
}

/** A transaction whose requests never succeed; it aborts, with a quota error when asked. */
function abortingTransaction(kind: FailureKind): unknown {
  const tx = {
    error: null as DOMException | null,
    oncomplete: null as Handler,
    onabort: null as Handler,
    onerror: null as Handler,
    abort: () => undefined,
    objectStore: () => store,
  };
  const makeRequest = (): FakeRequest => ({ result: undefined, error: null, onsuccess: null, onerror: null });
  const store: unknown = new Proxy({}, { get: (_t, prop) => (prop === 'index' ? () => store : makeRequest) });
  setTimeout(() => {
    tx.error = new DOMException('x', kind === 'quota-exceeded' ? 'QuotaExceededError' : 'AbortError');
    tx.onabort?.();
  }, 0);
  return tx;
}

interface Faulty {
  readonly factory: IDBFactory | undefined;
  /** The real database underneath; nothing may ever be written to it. */
  readonly real: IDBFactory;
}

function faultyFactory(kind: FailureKind): Faulty {
  const real = new IDBFactory();
  if (kind === 'undefined-factory') return { factory: undefined, real };
  const factory = {
    open: (name: string, version?: number) => {
      const req = {
        result: undefined as unknown,
        error: null as DOMException | null,
        transaction: null as unknown,
        onsuccess: null as Handler,
        onerror: null as Handler,
        onblocked: null as Handler,
        onupgradeneeded: null as Handler,
      };
      if (kind === 'rejected-open') {
        setTimeout(() => {
          req.error = new DOMException('x', 'UnknownError');
          req.onerror?.();
        }, 0);
        return req;
      }
      const inner = real.open(name, version);
      inner.onupgradeneeded = (event) => {
        req.result = inner.result;
        req.transaction = inner.transaction;
        req.onupgradeneeded?.(event);
      };
      inner.onsuccess = () => {
        const db = inner.result;
        req.result = { close: () => db.close(), transaction: () => abortingTransaction(kind) };
        req.onsuccess?.();
      };
      inner.onerror = () => {
        req.error = inner.error;
        req.onerror?.();
      };
      return req;
    },
  } as unknown as IDBFactory;
  return { factory, real };
}

const tick = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

type Move = { readonly open: number; readonly submit: boolean };
const moveArb: fc.Arbitrary<Move> = fc.record({
  open: fc.nat({ max: Math.max(0, SLOT_IDS.length - 1) }),
  submit: fc.boolean(),
});

async function runWithFailure(kind: FailureKind, moves: readonly Move[]): Promise<void> {
  const { factory, real } = faultyFactory(kind);
  let current: RoomBinding | undefined;
  function Probe(): null {
    current = usePersistedRoom(okBuild, { factory, newRunId: () => 'run-fail', now: () => 1 });
    return null;
  }
  const root = createRoot(document.createElement('div'));
  const binding = (): RoomBinding => {
    if (current === undefined) throw new Error('not mounted');
    return current;
  };
  try {
    await act(async () => {
      root.render(<Probe />);
    });
    await act(async () => {
      binding().dispatch({ type: 'startRun' });
    });
    expect(binding().eventLog).toHaveLength(4);

    let previous = binding().eventLog;
    for (const move of moves) {
      const slotId = SLOT_IDS[move.open] ?? '';
      const actions = move.submit
        ? ([{ type: 'openLock', slotId }, { type: 'submitAnswer', slotId, submission: { text: 'zzz' } }] as const)
        : ([{ type: 'openLock', slotId }] as const);
      for (const action of actions) {
        await act(async () => {
          binding().dispatch(action);
        });
        const log = binding().eventLog;
        // In memory, in order: the log only ever grows by appending, or stays as it was.
        expect(log.length).toBeGreaterThanOrEqual(previous.length);
        expect(log.slice(0, previous.length)).toEqual(previous);
        previous = log;
      }
    }

    // Let every failing write settle, then the banner state must be on.
    for (let i = 0; i < 40 && !binding().saveFailed; i += 1) {
      await act(async () => {
        await tick(10);
      });
    }
    expect(binding().saveFailed).toBe(true);
    expect(binding().state).not.toBeNull();
    expect(binding().eventLog.length).toBeGreaterThanOrEqual(4);

    // Nothing was written past the failure: the real database holds no events.
    const stored = await loadEvents(real, 'run-fail');
    if (stored.ok) expect(stored.value).toHaveLength(0);
  } finally {
    await act(async () => {
      root.unmount();
    });
  }
}

// Feature: persistence, Property 16: A run survives a storage failure and never writes past it
describe('usePersistedRoom under storage failure', () => {
  beforeAll(() => {
    // The repository builds key ranges from the global IDBKeyRange, which jsdom does not provide.
    vi.stubGlobal('IDBKeyRange', FakeIDBKeyRange);
  });
  afterAll(() => {
    vi.unstubAllGlobals();
  });

  // **Validates: Requirements 7.1, 7.2, 7.4, 7.5**
  it('keeps accepting events in order in memory and sets saveFailed, whatever fails', async () => {
    const kinds = failurePlanArb(1).map((plan) => plan.kind);
    await fc.assert(
      fc.asyncProperty(kinds, fc.array(moveArb, { maxLength: 4 }), runWithFailure),
      { numRuns: 20 },
    );
  }, 120000);

  it.each<FailureKind>(['undefined-factory', 'rejected-open', 'aborted-transaction', 'quota-exceeded'])(
    'shows the save failure under %s with no moves after the start',
    async (kind) => {
      await runWithFailure(kind, []);
    },
    30000,
  );
});
