import { act } from 'react';
import { IDBFactory, IDBKeyRange as FakeIDBKeyRange } from 'fake-indexeddb';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { GENERATION_COPY } from '@escape-the-crypt/core';
import { IngestScreen } from '../../app';
import { createMemoryStore } from '../ingest/notes-store-memory';
import { usePersistedRoom } from '../../state/persisted-room';
import type { BuildCrypt } from '../../state/room-binding';
import { loadCrypt } from '../../state/storage/crypt-repository';
import { restoreRun } from '../../state/storage/restore-run';
import { fakeWorker } from '../../test-support/fake-worker-client';
import { clickButton, typeNotes, useMount } from '../../test-support/flow-dom';
import { SAMPLE_BUNDLE, SAMPLE_NOTES_TEXT } from '../../test-support/sample-bundle';

const RUN_ID = 'digest-restore-run';

// Spec: phase 2 gap closure (a). Requirements 2.3, 5.8: a generated crypt keeps the digest of the
// confirmed notes record, so a reload finds those notes and the run is playable.
describe('a generated crypt carries documentDigest through to restore', () => {
  const mount = useMount();
  beforeAll(() => {
    // The repository builds key ranges from the global IDBKeyRange, which jsdom does not provide.
    vi.stubGlobal('IDBKeyRange', FakeIDBKeyRange);
  });
  afterAll(() => {
    vi.unstubAllGlobals();
  });

  it('saves the digest with the crypt, and a fresh mount restores a playable run from the notes store', async () => {
    const factory = new IDBFactory();
    const notesStore = createMemoryStore();
    const worker = fakeWorker([{ kind: 'completed', bundle: SAMPLE_BUNDLE }]);
    const useBinding = (buildCrypt: BuildCrypt) => usePersistedRoom(buildCrypt, { factory, newRunId: () => RUN_ID });

    mount.render(
      <IngestScreen
        store={notesStore}
        useBinding={useBinding}
        generate={{ origin: 'http://localhost:8787', client: worker.client, intervalMs: 5 }}
      />,
    );
    typeNotes(mount.container, SAMPLE_NOTES_TEXT);
    await clickButton(mount.container, 'Confirm notes');
    await clickButton(mount.container, GENERATION_COPY.generateButton);
    await vi.waitFor(() => expect(mount.container.querySelector('.room-screen')).not.toBeNull());
    // Ingest trims the trailing newline; the confirmed text is what the worker receives.
    expect(worker.startTexts).toEqual([SAMPLE_NOTES_TEXT.trimEnd()]);

    // The first Event is written only after the crypt and the run are stored.
    const manifestId = SAMPLE_BUNDLE.manifest.manifestId;
    await vi.waitFor(async () => {
      const crypt = await loadCrypt(factory, manifestId);
      expect(crypt.ok).toBe(true);
    });
    const saved = await loadCrypt(factory, manifestId);
    if (!saved.ok) throw new Error('crypt not saved');
    expect(saved.value.source).toBe('generated');

    // The digest saved with the crypt is the one of the confirmed notes record.
    const digest = saved.value.documentDigest;
    expect(digest).toBeTypeOf('string');
    const record = await notesStore.load(digest ?? '');
    expect(record.ok && record.value !== null).toBe(true);

    // A reload: a fresh mount, the same IndexedDB, the notes record still in the notes store.
    await act(async () => {
      mount.render(null);
    });
    await vi.waitFor(async () => {
      const restored = await restoreRun({ factory, notesStore }, RUN_ID);
      expect(restored.ok).toBe(true);
      if (restored.ok) {
        expect(restored.value.assets.source).toBe('notes');
        expect(restored.value.assets.chunks.size).toBeGreaterThan(0);
        expect(restored.value.crypt.documentDigest).toBe(digest);
      }
    });
    const restored = await restoreRun({ factory, notesStore: createMemoryStore() }, RUN_ID);
    expect(restored).toEqual({ ok: false, error: { kind: 'notes-unavailable' } });
  });
});
