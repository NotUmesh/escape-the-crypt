import fc from 'fast-check';
import { IDBFactory, IDBKeyRange as FakeIDBKeyRange } from 'fake-indexeddb';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { chunkDocument, makeNotesRecord } from '@escape-the-crypt/core';
import type { Chunk } from '@escape-the-crypt/core';
import { createMemoryStore } from '../../features/ingest/notes-store-memory';
import type { NotesStore } from '../../features/ingest/notes-store';
import { notesTextFromChunks } from '../../features/generate/generated-crypt';
import { SAMPLE_BUNDLE, SAMPLE_NOTES_TEXT } from '../../test-support/sample-bundle';
import { saveCrypt } from './crypt-repository';
import { STORES, openDb } from './db';
import { runSettingsArb } from './persistence-arbitraries';
import { restoreRun } from './restore-run';
import { createRun } from './run-repository';

const idArb = fc.stringMatching(/^[a-z0-9-]{1,24}$/);

const sourceChunks = chunkDocument({ sourceType: 'paste', text: SAMPLE_NOTES_TEXT, originalText: SAMPLE_NOTES_TEXT });
const notesRecord = makeNotesRecord(sourceChunks);
const OTHER_TEXT = 'Completely different notes about something else entirely, with enough words to form one chunk of text here.';
const otherRecord = makeNotesRecord(chunkDocument({ sourceType: 'paste', text: OTHER_TEXT, originalText: OTHER_TEXT }));

type NotesState = 'present' | 'absent' | 'unreadable' | 'other-notes' | 'no-digest';

async function setup(state: NotesState, runId: string, settings: Parameters<typeof createRun>[1]['settings']) {
  const factory = new IDBFactory();
  const saved = await saveCrypt(factory, {
    bundle: SAMPLE_BUNDLE,
    source: 'generated',
    ...(state === 'no-digest' ? {} : { documentDigest: notesRecord.documentDigest }),
  });
  expect(saved.ok).toBe(true);
  const manifestId = SAMPLE_BUNDLE.manifest.manifestId;
  expect((await createRun(factory, { runId, manifestId, settings, createdAt: 1 })).ok).toBe(true);

  const memory = createMemoryStore();
  let notesStore: NotesStore = memory;
  if (state === 'present') await memory.save(notesRecord);
  if (state === 'other-notes') {
    // Same digest key, but the record holds different notes.
    await memory.save({ ...otherRecord, documentDigest: notesRecord.documentDigest });
  }
  if (state === 'unreadable') {
    notesStore = {
      save: memory.save,
      load: () => Promise.resolve({ ok: false, error: { kind: 'storage-unavailable' } }),
    };
  }
  return { factory, notesStore, runId };
}

function dumpStore(factory: IDBFactory, name: string): Promise<unknown[]> {
  return openDb(factory).then(async (opened) => {
    if (!opened.ok) throw new Error('open failed');
    try {
      return await new Promise<unknown[]>((resolve, reject) => {
        const req = opened.value.transaction(name).objectStore(name).getAll();
        req.onsuccess = () => resolve(req.result as unknown[]);
        req.onerror = () => reject(new Error('read failed'));
      });
    } finally {
      opened.value.close();
    }
  });
}

// Feature: persistence, Property 13: Citation chunks are rebuilt, not stored, and match the source
describe('restored citation chunks', () => {
  beforeAll(() => {
    // The repository builds key ranges from the global IDBKeyRange, which jsdom does not provide.
    vi.stubGlobal('IDBKeyRange', FakeIDBKeyRange);
  });

  it('are rebuilt from the notes record and match chunking the notes directly, never stored', async () => {
    // **Validates: Requirements 5.7, 5.8**
    await fc.assert(
      fc.asyncProperty(idArb, runSettingsArb, async (runId, settings) => {
        const { factory, notesStore } = await setup('present', runId, settings);
        const restored = await restoreRun({ factory, notesStore }, runId);
        expect(restored.ok).toBe(true);
        if (!restored.ok) return;

        const text = notesTextFromChunks(notesRecord.chunks);
        const direct = new Map<string, Chunk>();
        for (const chunk of chunkDocument({ sourceType: 'paste', text, originalText: text })) {
          direct.set(chunk.id, chunk);
        }
        expect(restored.value.assets.source).toBe('notes');
        expect(restored.value.assets.chunks).toEqual(direct);

        for (const store of [STORES.crypts, STORES.runs, STORES.events]) {
          const rows = JSON.stringify(await dumpStore(factory, store));
          for (const chunk of direct.values()) expect(rows).not.toContain(chunk.text);
          expect(rows).not.toContain('"chunks"');
        }
      }),
      { numRuns: 15 },
    );
  });

  it('return notes-unavailable when the notes are absent, unreadable, mismatched or unreferenced', async () => {
    // **Validates: Requirements 5.7, 5.8**
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom<NotesState>('absent', 'unreadable', 'other-notes', 'no-digest'),
        idArb,
        runSettingsArb,
        async (state, runId, settings) => {
          const { factory, notesStore } = await setup(state, runId, settings);
          const restored = await restoreRun({ factory, notesStore }, runId);
          expect(restored).toEqual({ ok: false, error: { kind: 'notes-unavailable' } });
        },
      ),
      { numRuns: 20 },
    );
  });
});
