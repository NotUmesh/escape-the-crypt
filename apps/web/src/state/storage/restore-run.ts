import { apply, chunkDocument, initial } from '@escape-the-crypt/core';
import type { Chunk, Event, Result, SampleCryptError, SampleCryptResult, State } from '@escape-the-crypt/core';
import type { NotesStore } from '../../features/ingest/notes-store';
import { notesTextFromChunks } from '../../features/generate/generated-crypt';
import type { BindingModel } from '../room-binding-model';
import { buildFirstQuestionByConcept } from '../room-assets';
import type { RoomAssets } from '../room-assets';
import { buildSampleCrypt } from '../sample-crypt-source';
import { loadCrypt } from './crypt-repository';
import type { CryptRecord, RunRecord } from './records';
import { loadEvents, loadRun } from './run-repository';
import { storageError } from './storage-error';
import type { StorageResult } from './storage-error';

export interface RestoreDeps {
  readonly factory: IDBFactory | undefined;
  /** The Notes_Store adapter; read only. */
  readonly notesStore: NotesStore;
  /** Supplies the chunks of the bundled sample crypt. Defaults to the bundled builder. */
  readonly buildSample?: () => Result<SampleCryptResult, SampleCryptError>;
}

export interface RestoredRun {
  readonly run: RunRecord;
  readonly crypt: CryptRecord;
  readonly events: readonly Event[];
  readonly model: BindingModel;
  readonly assets: RoomAssets;
}

type Chunks = ReadonlyMap<string, Chunk>;

async function sampleChunks(deps: RestoreDeps, crypt: CryptRecord): Promise<StorageResult<Chunks>> {
  const built = (deps.buildSample ?? buildSampleCrypt)();
  if (!built.ok || built.value.manifest.manifestId !== crypt.manifestId) return storageError('record-unreadable');
  return { ok: true, value: built.value.chunks };
}

async function notesChunks(deps: RestoreDeps, crypt: CryptRecord): Promise<StorageResult<Chunks>> {
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

/**
 * Rebuilds a run from storage. Reads the run, its crypt and its events, then folds the events
 * with `initial` and `apply` only. Writes nothing. Never throws.
 */
export async function restoreRun(deps: RestoreDeps, runId: string): Promise<StorageResult<RestoredRun>> {
  try {
    const run = await loadRun(deps.factory, runId);
    if (!run.ok) return run;
    const crypt = await loadCrypt(deps.factory, run.value.manifestId);
    if (!crypt.ok) return crypt;
    const rows = await loadEvents(deps.factory, runId);
    if (!rows.ok) return rows;

    const { manifest } = crypt.value;
    let state: State = initial(manifest, run.value.settings);
    const events: Event[] = [];
    for (const row of rows.value) {
      const result = apply(state, row.event);
      if (!result.ok) return storageError('event-log-rejected');
      state = result.state;
      events.push(row.event);
    }

    const isSample = crypt.value.source === 'sample';
    const chunks = isSample ? await sampleChunks(deps, crypt.value) : await notesChunks(deps, crypt.value);
    if (!chunks.ok) return chunks;

    const assets: RoomAssets = {
      source: isSample ? 'sample' : 'notes',
      content: crypt.value.content,
      chunks: chunks.value,
      firstQuestionByConcept: buildFirstQuestionByConcept(manifest),
    };
    const model: BindingModel = { manifest, eventLog: events, state, notices: [], rejection: null };
    return { ok: true, value: { run: run.value, crypt: crypt.value, events, model, assets } };
  } catch {
    return storageError('storage-unavailable');
  }
}
