import fc from 'fast-check';
import { IDBFactory, IDBKeyRange as FakeIDBKeyRange } from 'fake-indexeddb';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { Event, RunSettings } from '@escape-the-crypt/core';
import { SAMPLE_BUNDLE } from '../../test-support/sample-bundle';
import { loadCrypt, saveCrypt } from './crypt-repository';
import { openDb } from './db';
import type { FailureKind } from './persistence-arbitraries';
import { failurePlanArb, runSettingsArb, startEventsFor } from './persistence-arbitraries';
import { restoreRun } from './restore-run';
import {
  appendEvent,
  createRun,
  deleteCrypt,
  findResumable,
  loadEvents,
  loadRun,
  setRunStatus,
} from './run-repository';

/** Stands in for notes content. It is the message of every injected error and must never surface. */
const SECRET = 'SECRET-NOTES-TEXT-xyzzy';

/** The persistence failure kinds, plus throws and request rejections at the IndexedDB layer. */
type Fault = FailureKind | 'throwing-open' | 'throwing-transaction' | 'rejected-request';

const EXTRA_FAULTS: readonly Fault[] = ['throwing-open', 'throwing-transaction', 'rejected-request'];

const faultArb: fc.Arbitrary<Fault> = fc.oneof(
  failurePlanArb(1).map((plan): Fault => plan.kind),
  fc.constantFrom(...EXTRA_FAULTS),
);

type Handler = ((event?: unknown) => void) | null;

interface FakeRequest {
  result: unknown;
  error: DOMException | null;
  onsuccess: Handler;
  onerror: Handler;
}

/** A transaction whose requests never succeed. It rejects them (if asked) and then aborts. */
function fakeTransaction(fault: Fault): unknown {
  const requests: FakeRequest[] = [];
  const tx = {
    error: null as DOMException | null,
    oncomplete: null as Handler,
    onabort: null as Handler,
    onerror: null as Handler,
    abort: () => undefined,
    objectStore: () => store,
  };
  const makeRequest = (): FakeRequest => {
    const req: FakeRequest = { result: undefined, error: null, onsuccess: null, onerror: null };
    requests.push(req);
    return req;
  };
  // Every store and index method returns a pending request; `index()` returns the store again.
  const store: unknown = new Proxy({}, { get: (_t, prop) => (prop === 'index' ? () => store : makeRequest) });
  setTimeout(() => {
    if (fault === 'rejected-request') {
      for (const req of requests) {
        req.error = new DOMException(SECRET, 'UnknownError');
        req.onerror?.();
      }
    }
    tx.error = new DOMException(SECRET, fault === 'quota-exceeded' ? 'QuotaExceededError' : 'AbortError');
    tx.onabort?.();
  }, 0);
  return tx;
}

/** Wraps a fresh fake-indexeddb factory so it, or the database it opens, fails as `fault` says. */
function faultyFactory(fault: Fault): IDBFactory | undefined {
  if (fault === 'undefined-factory') return undefined;
  if (fault === 'throwing-open') {
    return {
      open: () => {
        throw new Error(SECRET);
      },
    } as unknown as IDBFactory;
  }
  const real = new IDBFactory();
  return {
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
      if (fault === 'rejected-open') {
        setTimeout(() => {
          req.error = new DOMException(SECRET, 'UnknownError');
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
        req.result = {
          close: () => db.close(),
          transaction: () => {
            if (fault === 'throwing-transaction') throw new Error(SECRET);
            return fakeTransaction(fault);
          },
        };
        req.onsuccess?.();
      };
      inner.onerror = () => {
        req.error = inner.error;
        req.onerror?.();
      };
      return req;
    },
  } as unknown as IDBFactory;
}

const notesStore = {
  load: () => Promise.resolve({ ok: false as const, error: { kind: 'storage-unavailable' as const } }),
  save: () => Promise.resolve({ ok: false as const, error: { kind: 'storage-unavailable' as const } }),
};

const MANIFEST_ID = SAMPLE_BUNDLE.manifest.manifestId;
const FIRST_EVENT = startEventsFor(SAMPLE_BUNDLE.manifest)[0] as Event;

type Call = (factory: IDBFactory | undefined, settings: RunSettings) => Promise<unknown>;

/** Every exported function of the opener, both repositories and restoreRun. */
const CALLS: Record<string, Call> = {
  openDb: (f) => openDb(f),
  saveCrypt: (f) => saveCrypt(f, { bundle: SAMPLE_BUNDLE, source: 'sample' }),
  loadCrypt: (f) => loadCrypt(f, MANIFEST_ID),
  createRun: (f, settings) => createRun(f, { runId: 'run-1', manifestId: MANIFEST_ID, settings, createdAt: 1 }),
  setRunStatus: (f) => setRunStatus(f, 'run-1', 'left'),
  loadRun: (f) => loadRun(f, 'run-1'),
  findResumable: (f) => findResumable(f),
  appendEvent: (f) => appendEvent(f, 'run-1', FIRST_EVENT),
  loadEvents: (f) => loadEvents(f, 'run-1'),
  deleteCrypt: (f) => deleteCrypt(f, MANIFEST_ID),
  restoreRun: (f) => restoreRun({ factory: f, notesStore }, 'run-1'),
};
const NAMES = Object.keys(CALLS);
const ALL_FAULTS: readonly Fault[] = [
  'undefined-factory',
  'rejected-open',
  'aborted-transaction',
  'quota-exceeded',
  ...EXTRA_FAULTS,
];

const KINDS = new Set([
  'storage-unavailable',
  'unsupported-version',
  'crypt-invalid',
  'manifest-conflict',
  'record-unreadable',
  'run-not-found',
  'event-log-gap',
  'event-log-rejected',
  'notes-unavailable',
  'write-failed',
  'quota-exceeded',
]);

/** openDb makes no transaction, so faults below the open leave it succeeding. */
const OPEN_UNAFFECTED: ReadonlySet<Fault> = new Set<Fault>([
  'aborted-transaction',
  'quota-exceeded',
  'throwing-transaction',
  'rejected-request',
]);

async function checkNeverThrows(name: string, fault: Fault, settings: RunSettings): Promise<void> {
  const call = CALLS[name] as Call;
  let result: unknown;
  try {
    result = await Promise.race([
      call(faultyFactory(fault), settings),
      new Promise((_, reject) => setTimeout(() => reject(new Error(`${name} hung under ${fault}`)), 2000)),
    ]);
  } catch (error) {
    const hung = error instanceof Error && error.message.includes(' hung under ');
    throw new Error(hung ? error.message : `${name} threw under ${fault}`);
  }
  if (name === 'openDb' && OPEN_UNAFFECTED.has(fault)) {
    const opened = result as { ok: boolean; value: { close(): void } };
    expect(opened.ok).toBe(true);
    opened.value.close();
    return;
  }
  const failed = result as { ok: boolean; error?: { kind: string } };
  expect(failed.ok, `${name} under ${fault}`).toBe(false);
  expect(Object.keys(failed)).toEqual(['ok', 'error']);
  expect(Object.keys(failed.error ?? {})).toEqual(['kind']);
  expect(KINDS.has(failed.error?.kind ?? ''), `${name} under ${fault}: ${failed.error?.kind}`).toBe(true);
  expect(JSON.stringify(result)).not.toContain(SECRET);
}

// Feature: persistence, Property 17: Storage functions never throw and never carry content
describe('storage functions never throw and never carry content', () => {
  // The repository builds key ranges from the global IDBKeyRange, which jsdom does not provide.
  beforeAll(() => {
    vi.stubGlobal('IDBKeyRange', FakeIDBKeyRange);
  });

  // **Validates: Requirements 7.6, 7.7, 11.5**
  it('returns a typed error holding only the kind, whatever fails', async () => {
    await fc.assert(
      fc.asyncProperty(fc.constantFrom(...NAMES), faultArb, runSettingsArb, checkNeverThrows),
      { numRuns: 100 },
    );
  }, 60000);

  it('covers every function under every fault', async () => {
    const settings = fc.sample(runSettingsArb, { numRuns: 1, seed: 1 })[0] as RunSettings;
    for (const name of NAMES) {
      for (const fault of ALL_FAULTS) await checkNeverThrows(name, fault, settings);
    }
  }, 60000);

  it('the quota fault reaches the caller as quota-exceeded on writes', async () => {
    const result = await saveCrypt(faultyFactory('quota-exceeded'), { bundle: SAMPLE_BUNDLE, source: 'sample' });
    expect(result).toEqual({ ok: false, error: { kind: 'quota-exceeded' } });
  });
});
