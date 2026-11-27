import fc from 'fast-check';
import { IDBFactory, IDBKeyRange as FakeIDBKeyRange } from 'fake-indexeddb';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { apply, initial } from '@escape-the-crypt/core';
import type { Event, RunSettings } from '@escape-the-crypt/core';
import { createMemoryStore } from '../../features/ingest/notes-store-memory';
import { SAMPLE_BUNDLE, SAMPLE_CRYPT } from '../../test-support/sample-bundle';
import { saveCrypt } from './crypt-repository';
import { openDb, STORES } from './db';
import { playAccepted, runSettingsArb } from './persistence-arbitraries';
import { restoreRun } from './restore-run';
import type { RestoreDeps } from './restore-run';
import { createRun } from './run-repository';

const MANIFEST_ID = SAMPLE_BUNDLE.manifest.manifestId;
const RUN_ID = 'run-1';
const SETTINGS: RunSettings = { length: 'short', difficulty: 'apprentice', hintAllowance: 1 };

type StoreName = (typeof STORES)[keyof typeof STORES];

async function withStore<T>(
  factory: IDBFactory,
  name: StoreName,
  mode: IDBTransactionMode,
  use: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const opened = await openDb(factory);
  if (!opened.ok) throw new Error('open failed');
  const db = opened.value;
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(name, mode);
      const req = use(tx.objectStore(name));
      tx.oncomplete = () => resolve(req.result);
      tx.onerror = () => reject(new Error('tx failed'));
      tx.onabort = () => reject(new Error('tx aborted'));
    });
  } finally {
    db.close();
  }
}

/** Every record in every store, in key order. */
async function dumpAll(factory: IDBFactory): Promise<Record<StoreName, unknown[]>> {
  const out = {} as Record<StoreName, unknown[]>;
  for (const name of Object.values(STORES)) {
    out[name] = (await withStore(factory, name, 'readonly', (s) => s.getAll())) as unknown[];
  }
  return out;
}

async function writeRows(factory: IDBFactory, rows: readonly { seq: number; event: Event }[]): Promise<void> {
  for (const row of rows) {
    await withStore(factory, STORES.events, 'readwrite', (s) =>
      s.put({ schemaVersion: 1, runId: RUN_ID, seq: row.seq, event: row.event }),
    );
  }
}

async function seededFactory(source: 'sample' | 'generated' = 'sample'): Promise<IDBFactory> {
  const factory = new IDBFactory();
  const saved = await saveCrypt(factory, {
    bundle: SAMPLE_BUNDLE,
    source,
    ...(source === 'generated' ? { documentDigest: 'digest-missing' } : {}),
  });
  expect(saved.ok).toBe(true);
  const run = await createRun(factory, { runId: RUN_ID, manifestId: MANIFEST_ID, settings: SETTINGS, createdAt: 1 });
  expect(run.ok).toBe(true);
  return factory;
}

const depsFor = (factory: IDBFactory): RestoreDeps => ({
  factory,
  notesStore: createMemoryStore(),
  buildSample: () => ({ ok: true, value: SAMPLE_CRYPT }),
});

/** An event the guard accepts and the reducer rejects after any accepted run. */
const REJECTED: Event = { kind: 'RunStarted', manifestId: MANIFEST_ID };

type Tamper =
  | { kind: 'gap'; drop: number }
  | { kind: 'rejected'; at: number }
  | { kind: 'missing-run' }
  | { kind: 'notes-missing' };

const tamperArb: fc.Arbitrary<Tamper> = fc.oneof(
  fc.nat().map((drop): Tamper => ({ kind: 'gap', drop })),
  fc.nat().map((at): Tamper => ({ kind: 'rejected', at })),
  fc.constant<Tamper>({ kind: 'missing-run' }),
  fc.constant<Tamper>({ kind: 'notes-missing' }),
);

describe('restoreRun with untrusted storage', () => {
  beforeAll(() => {
    vi.stubGlobal('IDBKeyRange', FakeIDBKeyRange);
  });

  // Feature: persistence, Property 12: Restore rejects what it cannot trust and changes nothing
  it('returns the matching error for tampered storage and leaves every store unchanged', async () => {
    // **Validates: Requirements 5.3, 5.4, 5.5, 5.6**
    await fc.assert(
      fc.asyncProperty(
        runSettingsArb,
        fc.array(fc.nat({ max: 1000 }), { maxLength: 20 }),
        tamperArb,
        async (_settings, choices, tamper) => {
          const accepted = playAccepted(SAMPLE_BUNDLE.manifest, SETTINGS, choices);
          const events = [...accepted.events];
          const factory = await seededFactory(tamper.kind === 'notes-missing' ? 'generated' : 'sample');
          let expected: string;

          if (tamper.kind === 'gap') {
            // Drop one row that is not the last, so the remaining seqs are not 0..n-1.
            const drop = tamper.drop % (events.length - 1);
            await writeRows(factory, events.flatMap((event, seq) => (seq === drop ? [] : [{ seq, event }])));
            expected = 'event-log-gap';
          } else if (tamper.kind === 'rejected') {
            // Insert a reducer-rejected event; seqs stay gapless.
            const at = 1 + (tamper.at % events.length);
            const tampered = [...events.slice(0, at), REJECTED, ...events.slice(at)];
            await writeRows(factory, tampered.map((event, seq) => ({ seq, event })));
            expected = 'event-log-rejected';
          } else if (tamper.kind === 'missing-run') {
            await writeRows(factory, events.map((event, seq) => ({ seq, event })));
            expected = 'run-not-found';
          } else {
            await writeRows(factory, events.map((event, seq) => ({ seq, event })));
            expected = 'notes-unavailable';
          }

          const before = await dumpAll(factory);
          const result = await restoreRun(depsFor(factory), tamper.kind === 'missing-run' ? 'no-such-run' : RUN_ID);

          expect(result).toEqual({ ok: false, error: { kind: expected } });
          expect(await dumpAll(factory)).toEqual(before);
        },
      ),
      { numRuns: 50 },
    );
  });

  it('accepts the untampered log, so the tampering is what causes each rejection', async () => {
    const accepted = playAccepted(SAMPLE_BUNDLE.manifest, SETTINGS, [0, 1, 2, 3, 4, 0, 0]);
    const factory = await seededFactory();
    await writeRows(factory, accepted.events.map((event, seq) => ({ seq, event })));
    const result = await restoreRun(depsFor(factory), RUN_ID);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.events).toEqual(accepted.events);
  });

  it('a stored log with a missing seq returns event-log-gap', async () => {
    const accepted = playAccepted(SAMPLE_BUNDLE.manifest, SETTINGS, []);
    expect(accepted.events.length).toBeGreaterThanOrEqual(3);
    const factory = await seededFactory();
    // seq 1 is missing.
    await writeRows(
      factory,
      accepted.events.flatMap((event, seq) => (seq === 1 ? [] : [{ seq, event }])),
    );
    const before = await dumpAll(factory);
    expect(await restoreRun(depsFor(factory), RUN_ID)).toEqual({ ok: false, error: { kind: 'event-log-gap' } });
    expect(await dumpAll(factory)).toEqual(before);
  });

  it('a stored event the reducer rejects returns event-log-rejected', async () => {
    const accepted = playAccepted(SAMPLE_BUNDLE.manifest, SETTINGS, []);
    const state = accepted.state;
    // Precondition: the reducer really rejects this event here.
    expect(apply(state, REJECTED).ok).toBe(false);
    expect(apply(initial(SAMPLE_BUNDLE.manifest, SETTINGS), { kind: 'RoomEntered', roomId: 'x' }).ok).toBe(false);
    const factory = await seededFactory();
    await writeRows(factory, [...accepted.events, REJECTED].map((event, seq) => ({ seq, event })));
    const before = await dumpAll(factory);
    expect(await restoreRun(depsFor(factory), RUN_ID)).toEqual({ ok: false, error: { kind: 'event-log-rejected' } });
    expect(await dumpAll(factory)).toEqual(before);
  });
});
