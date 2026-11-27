import fc from 'fast-check';
import { IDBFactory, IDBKeyRange as FakeIDBKeyRange } from 'fake-indexeddb';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { Event } from '@escape-the-crypt/core';
import { SAMPLE_BUNDLE } from '../../test-support/sample-bundle';
import * as cryptRepository from './crypt-repository';
import { saveCrypt } from './crypt-repository';
import type { EventRow } from './records';
import * as restoreModule from './restore-run';
import * as runRepository from './run-repository';
import { appendEvent, createRun, findResumable, loadEvents, loadRun, setRunStatus } from './run-repository';

const MANIFEST_ID = SAMPLE_BUNDLE.manifest.manifestId;
const RUN_IDS = ['run-a', 'run-b'] as const;
const SETTINGS = { length: 'short', difficulty: 'apprentice', hintAllowance: 1 } as const;

type Op =
  | { readonly kind: 'saveCrypt' }
  | { readonly kind: 'createRun'; readonly runIndex: number }
  | { readonly kind: 'setRunStatus'; readonly runIndex: number; readonly status: 'active' | 'escaped' | 'left' }
  | { readonly kind: 'appendEvent'; readonly runIndex: number }
  | { readonly kind: 'loadEvents'; readonly runIndex: number }
  | { readonly kind: 'findResumable' }
  | { readonly kind: 'loadRun'; readonly runIndex: number };

// Index 2 is a run id that never exists, so failing calls are covered too.
const runIndexArb = fc.integer({ min: 0, max: 2 });
const runId = (index: number): string => RUN_IDS[index] ?? 'no-such-run';

const opArb: fc.Arbitrary<Op> = fc.oneof(
  { weight: 1, arbitrary: fc.constant<Op>({ kind: 'saveCrypt' }) },
  { weight: 2, arbitrary: runIndexArb.map<Op>((runIndex) => ({ kind: 'createRun', runIndex })) },
  {
    weight: 2,
    arbitrary: fc
      .tuple(runIndexArb, fc.constantFrom('active', 'escaped', 'left'))
      .map<Op>(([runIndex, status]) => ({ kind: 'setRunStatus', runIndex, status })),
  },
  { weight: 6, arbitrary: runIndexArb.map<Op>((runIndex) => ({ kind: 'appendEvent', runIndex })) },
  { weight: 2, arbitrary: runIndexArb.map<Op>((runIndex) => ({ kind: 'loadEvents', runIndex })) },
  { weight: 1, arbitrary: fc.constant<Op>({ kind: 'findResumable' }) },
  { weight: 1, arbitrary: runIndexArb.map<Op>((runIndex) => ({ kind: 'loadRun', runIndex })) },
);

async function runOp(factory: IDBFactory, op: Op, counter: number): Promise<void> {
  switch (op.kind) {
    case 'saveCrypt':
      await saveCrypt(factory, { bundle: SAMPLE_BUNDLE, source: 'sample' });
      return;
    case 'createRun':
      await createRun(factory, {
        runId: runId(op.runIndex),
        manifestId: MANIFEST_ID,
        settings: SETTINGS,
        createdAt: counter,
      });
      return;
    case 'setRunStatus':
      await setRunStatus(factory, runId(op.runIndex), op.status);
      return;
    case 'appendEvent': {
      const event = { kind: 'RoomPublished', roomId: `room-${counter}` } as Event;
      await appendEvent(factory, runId(op.runIndex), event);
      return;
    }
    case 'loadEvents':
      await loadEvents(factory, runId(op.runIndex));
      return;
    case 'findResumable':
      await findResumable(factory);
      return;
    case 'loadRun':
      await loadRun(factory, runId(op.runIndex));
      return;
  }
}

async function snapshot(factory: IDBFactory): Promise<ReadonlyMap<string, readonly EventRow[]>> {
  const rows = new Map<string, readonly EventRow[]>();
  for (const id of RUN_IDS) {
    const loaded = await loadEvents(factory, id);
    expect(loaded.ok).toBe(true);
    rows.set(id, loaded.ok ? loaded.value : []);
  }
  return rows;
}

// Feature: persistence, Property 9: The event log is a gapless, race-free, append-only sequence
describe('event rows are immutable (S2)', () => {
  // The repository builds key ranges from the global `IDBKeyRange`, which jsdom does not provide.
  beforeAll(() => {
    vi.stubGlobal('IDBKeyRange', FakeIDBKeyRange);
  });

  it('any operation other than deleteCrypt leaves every existing EventRow unchanged and present', async () => {
    // **Validates: Requirements 4.2, 4.3**
    await fc.assert(
      fc.asyncProperty(fc.array(opArb, { minLength: 1, maxLength: 25 }), async (ops) => {
        const factory = new IDBFactory();
        // Start with both runs present so appends have somewhere to land.
        await saveCrypt(factory, { bundle: SAMPLE_BUNDLE, source: 'sample' });
        for (const id of RUN_IDS) {
          await createRun(factory, { runId: id, manifestId: MANIFEST_ID, settings: SETTINGS, createdAt: 0 });
        }
        let before = await snapshot(factory);
        for (const [index, op] of ops.entries()) {
          await runOp(factory, op, index + 1);
          const after = await snapshot(factory);
          for (const id of RUN_IDS) {
            const prior = before.get(id) ?? [];
            const now = after.get(id) ?? [];
            expect(now.length).toBeGreaterThanOrEqual(prior.length);
            expect(now.slice(0, prior.length)).toEqual(prior);
          }
          before = after;
        }
      }),
      { numRuns: 50 },
    );
  });

  it('no repository export updates or deletes a single event row', () => {
    // **Validates: Requirements 4.2, 4.3**
    const names = [
      ...Object.keys(runRepository),
      ...Object.keys(cryptRepository),
      ...Object.keys(restoreModule),
    ];
    expect([...names].sort()).toEqual(
      [
        'appendEvent',
        'canonicalJson',
        'createRun',
        'deleteCrypt',
        'findResumable',
        'loadCrypt',
        'loadEvents',
        'loadRun',
        'restoreRun',
        'saveCrypt',
        'setRunStatus',
      ].sort(),
    );
    // Event-row writers: only append, plus deleteCrypt, which removes a whole crypt at once.
    const eventNames = names.filter((n) => /event/i.test(n));
    expect([...eventNames].sort()).toEqual(['appendEvent', 'loadEvents']);
    expect(names.filter((n) => /^(update|put|edit|replace|remove|delete)/i.test(n))).toEqual(['deleteCrypt']);
  });
});
