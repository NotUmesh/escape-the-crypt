import { IDBFactory, IDBKeyRange as FakeIDBKeyRange } from 'fake-indexeddb';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { chunkDocument, makeNotesRecord } from '@escape-the-crypt/core';
import type { CryptBundle } from '@escape-the-crypt/core';
import { createMemoryStore } from '../../features/ingest/notes-store-memory';
import { SAMPLE_BUNDLE, SAMPLE_NOTES_TEXT } from '../../test-support/sample-bundle';
import { saveCrypt } from './crypt-repository';
import { restoreRun } from './restore-run';
import { createRun } from './run-repository';

// Run length and difficulty: a generated crypt's manifest ID now follows its content
// (`crypt-<notes digest>-<content hash>`). Two crypts from the same notes, for example a Short and a
// Long one, used to share an ID and the second failed to save (manifest-conflict). Now each is
// stored under its own ID, and both find the same notes through `documentDigest`.
const notesRecord = makeNotesRecord(chunkDocument({ sourceType: 'paste', text: SAMPLE_NOTES_TEXT, originalText: SAMPLE_NOTES_TEXT }));

/** The sample crypt under another manifest ID, with one concept title changed so the content differs. */
function variant(manifestId: string, title: string): CryptBundle {
  const [conceptId] = Object.keys(SAMPLE_BUNDLE.content.concepts);
  return {
    manifest: { ...SAMPLE_BUNDLE.manifest, manifestId },
    content: { ...SAMPLE_BUNDLE.content, concepts: { ...SAMPLE_BUNDLE.content.concepts, [conceptId as string]: { title } } },
  };
}

describe('two crypts from the same notes under content manifest IDs', () => {
  beforeAll(() => {
    vi.stubGlobal('IDBKeyRange', FakeIDBKeyRange);
  });

  it('both save, and each run restores with the shared notes', async () => {
    const factory = new IDBFactory();
    const notesStore = createMemoryStore();
    await notesStore.save(notesRecord);
    const short = variant('crypt-0123456789abcdef-aaaaaaaa', 'The heart valves');
    const long = variant('crypt-0123456789abcdef-bbbbbbbb', 'Valves of the heart');
    for (const bundle of [short, long]) {
      const saved = await saveCrypt(factory, { bundle, source: 'generated', documentDigest: notesRecord.documentDigest });
      expect(saved).toEqual({ ok: true, value: { manifestId: bundle.manifest.manifestId } });
    }
    const runs = [
      { runId: 'run-short', bundle: short, settings: { length: 'short', difficulty: 'apprentice', hintAllowance: 3 } },
      { runId: 'run-long', bundle: long, settings: { length: 'long', difficulty: 'lich', hintAllowance: 0 } },
    ] as const;
    for (const r of runs) {
      expect((await createRun(factory, { runId: r.runId, manifestId: r.bundle.manifest.manifestId, settings: r.settings, createdAt: 1 })).ok).toBe(true);
    }
    for (const r of runs) {
      const restored = await restoreRun({ factory, notesStore }, r.runId);
      expect(restored.ok).toBe(true);
      if (!restored.ok) continue;
      expect(restored.value.crypt.manifestId).toBe(r.bundle.manifest.manifestId);
      expect(restored.value.crypt.documentDigest).toBe(notesRecord.documentDigest);
      expect(restored.value.assets.chunks.size).toBeGreaterThan(0);
      // Resume keeps the stored settings.
      expect(restored.value.run.settings).toEqual(r.settings);
      expect(restored.value.model.state.settings).toEqual(r.settings);
    }
  });

  it('still treats a differing crypt under the same ID as a conflict', async () => {
    const factory = new IDBFactory();
    const id = 'crypt-0123456789abcdef-cccccccc';
    expect((await saveCrypt(factory, { bundle: variant(id, 'One'), source: 'generated' })).ok).toBe(true);
    expect(await saveCrypt(factory, { bundle: variant(id, 'Two'), source: 'generated' })).toEqual({
      ok: false,
      error: { kind: 'manifest-conflict' },
    });
  });
});
