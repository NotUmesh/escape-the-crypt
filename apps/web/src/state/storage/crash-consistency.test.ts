import fc from 'fast-check';
import { IDBFactory, IDBKeyRange as FakeIDBKeyRange } from 'fake-indexeddb';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { apply, initial } from '@escape-the-crypt/core';
import type { CryptBundle, Event, State } from '@escape-the-crypt/core';
import type { NotesStore } from '../../features/ingest/notes-store';
import { saveCrypt } from './crypt-repository';
import { createEventWriter } from './event-writer';
import type { AppendFn } from './event-writer';
import { failurePlanArb } from './persistence-arbitraries';
import type { AcceptedRun, FailurePlan } from './persistence-arbitraries';
import { contentArb, persistableRunArb } from './persistable-run-support';
import { restoreRun } from './restore-run';
import { appendEvent, createRun, loadEvents } from './run-repository';
import { storageError } from './storage-error';

const RUN_ID = 'run-crash';

const emptyNotesStore: NotesStore = {
  save: async () => ({ ok: true, value: true }),
  load: async () => ({ ok: true, value: null }),
};

function foldPrefix(run: AcceptedRun, count: number): State {
  let state = initial(run.manifest, run.settings);
  for (const event of run.events.slice(0, count)) {
    const result = apply(state, event);
    if (!result.ok) throw new Error('accepted event rejected');
    state = result.state;
  }
  return state;
}

/** An append that fails for the planned event while `failing` is true, and records every attempt. */
function failingAppend(
  factory: IDBFactory,
  events: readonly Event[],
  plan: FailurePlan,
  control: { failing: boolean },
  attempts: number[],
): AppendFn {
  return async (_factory, runId, event) => {
    const index = events.indexOf(event);
    attempts.push(index);
    if (index === plan.atIndex && control.failing) {
      switch (plan.kind) {
        case 'undefined-factory':
          return storageError('storage-unavailable');
        case 'rejected-open':
          throw new Error('open rejected');
        case 'aborted-transaction':
          return storageError('write-failed');
        case 'quota-exceeded':
          return storageError('quota-exceeded');
      }
    }
    return appendEvent(factory, runId, event);
  };
}

async function storedEvents(factory: IDBFactory): Promise<Event[]> {
  const rows = await loadEvents(factory, RUN_ID);
  expect(rows.ok).toBe(true);
  return rows.ok ? rows.value.map((row) => row.event) : [];
}

// Feature: persistence, Property 16: A run survives a storage failure and never writes past it
describe('a run survives a storage failure and never writes past it', () => {
  // The repository builds key ranges from the global `IDBKeyRange`, which jsdom does not provide.
  beforeAll(() => {
    vi.stubGlobal('IDBKeyRange', FakeIDBKeyRange);
  });

  it('stores exactly the prefix before the failure, restores to its fold, and a retry drains the rest in order', async () => {
    // **Validates: Requirements 7.1, 7.2, 7.4, 7.5, 8.3, 8.4, 8.5, 8.6** (acceptance criterion 12.3)
    await fc.assert(
      fc.asyncProperty(
        persistableRunArb
          .chain((run: AcceptedRun) => contentArb(run.manifest).map((content) => ({ run, content })))
          .chain(({ run, content }) =>
            failurePlanArb(run.events.length).map((plan) => ({ run, content, plan })),
          ),
        async ({ run, content, plan }) => {
          const factory = new IDBFactory();
          const bundle: CryptBundle = { manifest: run.manifest, content };
          expect((await saveCrypt(factory, { bundle, source: 'sample' })).ok).toBe(true);
          const created = await createRun(factory, {
            runId: RUN_ID,
            manifestId: run.manifest.manifestId,
            settings: run.settings,
            createdAt: 1,
          });
          expect(created.ok).toBe(true);

          const control = { failing: true };
          const attempts: number[] = [];
          const writer = createEventWriter({
            factory,
            runId: RUN_ID,
            append: failingAppend(factory, run.events, plan, control, attempts),
          });
          const k = plan.atIndex;

          const outcomes = await Promise.all(run.events.map((event) => writer.enqueue(event)));
          outcomes.forEach((outcome, i) => {
            if (i < k) expect(outcome.status).toBe('saved');
            else if (i === k) expect(outcome.status).toBe('failed');
            else expect(outcome.status).toBe('skipped');
          });
          // Nothing past the failed event was ever attempted.
          expect(Math.max(...attempts)).toBe(k);
          expect(writer.unsaved()).toEqual(run.events.slice(k));

          // Reopened state equals the fold of the events stored before the failure.
          expect(await storedEvents(factory)).toEqual(run.events.slice(0, k));
          const crashed = await restoreRun(
            {
              factory,
              notesStore: emptyNotesStore,
              buildSample: () => ({ ok: true, value: { manifest: run.manifest, content, chunks: new Map() } }),
            },
            RUN_ID,
          );
          expect(crashed.ok).toBe(true);
          if (crashed.ok) expect(crashed.value.model.state).toEqual(foldPrefix(run, k));

          if (!plan.retryAfter) {
            // A retry that fails again still writes nothing past the failed event.
            const again = await writer.retry();
            expect(again.status).toBe('failed');
            expect(Math.max(...attempts)).toBe(k);
            expect(await storedEvents(factory)).toEqual(run.events.slice(0, k));
            return;
          }

          control.failing = false;
          const before = attempts.length;
          const retried = await writer.retry();
          expect(retried.status).toBe('saved');
          expect(writer.unsaved()).toEqual([]);
          // The retry stores the failed event first, then the rest in order.
          expect(attempts.slice(before)).toEqual(run.events.map((_, i) => i).slice(k));
          expect(await storedEvents(factory)).toEqual(run.events);
          const recovered = await restoreRun(
            {
              factory,
              notesStore: emptyNotesStore,
              buildSample: () => ({ ok: true, value: { manifest: run.manifest, content, chunks: new Map() } }),
            },
            RUN_ID,
          );
          expect(recovered.ok).toBe(true);
          if (recovered.ok) expect(recovered.value.model.state).toEqual(run.state);
        },
      ),
      { numRuns: 100 },
    );
  }, 180_000);
});
