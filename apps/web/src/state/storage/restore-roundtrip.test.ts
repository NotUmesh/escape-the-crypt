import fc from 'fast-check';
import { IDBFactory, IDBKeyRange as FakeIDBKeyRange } from 'fake-indexeddb';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { CryptBundle, CryptManifest, State } from '@escape-the-crypt/core';
import { questionFor } from '../../../../../packages/core/src/test-support/runtime-model-support';
import type { NotesStore } from '../../features/ingest/notes-store';
import { saveCrypt } from './crypt-repository';
import { contentArb, persistableRunArb } from './persistable-run-support';
import type { AcceptedRun } from './persistence-arbitraries';
import { restoreRun } from './restore-run';
import { appendEvent, createRun } from './run-repository';

const RUN_ID = 'run-restore';

/** Every question the state currently shows, with the payload the learner would see. */
function shownPayloads(state: State, manifest: CryptManifest): Record<string, unknown> {
  const shown: Record<string, unknown> = {};
  const add = (questionId: string): void => {
    shown[questionId] = questionFor(manifest, questionId).payload;
  };
  for (const room of state.rooms) {
    for (const slot of room.lockSlots) add(slot.currentQuestionId);
    for (const slot of room.dueReturnSlots) add(slot.currentQuestionId);
  }
  for (const slot of state.finalDoor.slots) add(slot.currentQuestionId);
  return shown;
}

function hintsOf(state: State): unknown[] {
  const hints: unknown[] = [];
  for (const room of state.rooms) {
    for (const slot of [...room.lockSlots, ...room.dueReturnSlots]) hints.push(slot.appliedHint);
  }
  for (const slot of state.finalDoor.slots) hints.push(slot.appliedHint);
  return hints;
}

const emptyNotesStore: NotesStore = {
  save: async () => ({ ok: true, value: true }),
  load: async () => ({ ok: true, value: null }),
};

// Feature: persistence, Property 11: Restoring a run folds its stored log to the live state
describe('restoring a run folds its stored log to the live state', () => {
  // The repository builds key ranges from the global `IDBKeyRange`, which jsdom does not provide.
  beforeAll(() => {
    vi.stubGlobal('IDBKeyRange', FakeIDBKeyRange);
  });

  it('restored state, option order, hints used and candle count equal the live state', async () => {
    // **Validates: Requirements 5.2** (acceptance criterion 12.1)
    await fc.assert(
      fc.asyncProperty(
        persistableRunArb.chain((run: AcceptedRun) => contentArb(run.manifest).map((content) => ({ run, content }))),
        async ({ run, content }) => {
          const bundle: CryptBundle = { manifest: run.manifest, content };
          const factory = new IDBFactory();
          const saved = await saveCrypt(factory, { bundle, source: 'sample' });
          expect(saved.ok).toBe(true);
          const created = await createRun(factory, {
            runId: RUN_ID,
            manifestId: run.manifest.manifestId,
            settings: run.settings,
            createdAt: 1,
          });
          expect(created.ok).toBe(true);
          for (const event of run.events) {
            const appended = await appendEvent(factory, RUN_ID, event);
            expect(appended.ok).toBe(true);
          }

          // Each repository call opens and closes its own connection, so this read happens
          // on a freshly opened database over the data written above.
          const restored = await restoreRun(
            {
              factory,
              notesStore: emptyNotesStore,
              buildSample: () => ({
                ok: true,
                value: { manifest: run.manifest, content, chunks: new Map() },
              }),
            },
            RUN_ID,
          );
          expect(restored.ok).toBe(true);
          if (!restored.ok) return;
          const { model, events } = restored.value;

          expect(events).toEqual(run.events);
          expect(model.state.candleCount).toBe(run.state.candleCount);
          expect(model.state.remainingHints).toBe(run.state.remainingHints);
          expect(hintsOf(model.state)).toEqual(hintsOf(run.state));
          expect(shownPayloads(model.state, model.manifest)).toEqual(shownPayloads(run.state, run.manifest));
          expect(model.state).toEqual(run.state);
        },
      ),
      { numRuns: 100 },
    );
  }, 120_000);
});
