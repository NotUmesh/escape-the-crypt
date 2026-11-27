import { chunkDocument } from '@escape-the-crypt/core';
import type { Chunk } from '@escape-the-crypt/core';
import type { NotesStore } from '../../features/ingest/notes-store';
import { notesTextFromChunks } from '../../features/generate/generated-crypt';
import type { CryptRecord } from './records';
import { storageError } from './storage-error';
import type { StorageResult } from './storage-error';

/** Rebuilds the chunks of a generated crypt from the notes store. Read only. */
export async function notesChunks(
  deps: { readonly notesStore: NotesStore },
  crypt: CryptRecord,
): Promise<StorageResult<ReadonlyMap<string, Chunk>>> {
  const digest = crypt.documentDigest;
  if (digest === undefined) return storageError('notes-unavailable');
  const loaded = await deps.notesStore.load(digest);
  if (!loaded.ok || loaded.value === null) return storageError('notes-unavailable');
  const text = notesTextFromChunks(loaded.value.chunks);
  const chunks = new Map<string, Chunk>();
  for (const chunk of chunkDocument({ sourceType: 'paste', text, originalText: text })) {
    chunks.set(chunk.id, chunk);
  }
  // Every cited chunk must exist, or the notes are not the ones the crypt was made from.
  for (const entry of Object.values(crypt.content.questions)) {
    for (const excerpt of entry.excerpts) {
      if (!chunks.has(excerpt.chunkId)) return storageError('notes-unavailable');
    }
  }
  return { ok: true, value: chunks };
}
