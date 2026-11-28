import type { ImportErrorKind, SampleCryptError, SampleCryptResult } from '@escape-the-crypt/core';
import type { Result } from '@escape-the-crypt/core';
import type { NotesStore } from '../../features/ingest/notes-store';
import { canonicalJson } from './crypt-repository';
import { importFailure, importSuccess } from './import-result';
import type { ImportResult, ImportedCrypt } from './import-result';
import { isTooLarge, MAX_IMPORT_BYTES, validateImport } from './import-run';
import { writeImport } from './import-write';
import type { RunRecord } from './records';
import { deleteCrypt } from './run-repository';

export interface ImportDeps {
  readonly factory: IDBFactory | undefined;
  /** Where a generated crypt's notes are kept. Read to look for a clash, written once the crypt is in. */
  readonly notesStore: NotesStore;
  readonly buildSample?: () => Result<SampleCryptResult, SampleCryptError>;
  /** Test seams. Default to the clock and `crypto.randomUUID`. */
  readonly now?: () => number;
  readonly newRunId?: () => string;
}

function storageKind(kind: string): ImportErrorKind {
  return kind === 'quota-exceeded' ? 'quota-exceeded' : kind === 'storage-unavailable' ? 'storage-unavailable' : 'write-failed';
}

/**
 * Imports the text of an exported file as a new crypt with a new run, or changes nothing.
 *
 * The file is validated first (see `validateImport`). Then, for a generated crypt, any notes the
 * device already holds under the same fingerprint must be identical, so a file can never replace the
 * learner's own notes. The crypt, run and events go in one transaction that refuses to overwrite.
 * Notes are written last; if that fails the crypt is removed again, so a failure leaves nothing
 * behind. The run gets a fresh ID and the current time, so it is the newest run on the shelf.
 */
export async function importCryptFromText(deps: ImportDeps, text: string): Promise<ImportResult<ImportedCrypt>> {
  try {
    const validated = await validateImport(text, { buildSample: deps.buildSample });
    if (!validated.ok) return validated;
    const { crypt, settings, events, status, notes } = validated.value;

    let notesPresent = false;
    if (notes !== null) {
      const existing = await deps.notesStore.load(notes.documentDigest);
      if (!existing.ok) return importFailure('storage-unavailable');
      if (existing.value !== null) {
        if (canonicalJson(existing.value) !== canonicalJson(notes)) return importFailure('notes-conflict');
        notesPresent = true;
      }
    }

    const run: RunRecord = {
      schemaVersion: 1,
      runId: (deps.newRunId ?? ((): string => globalThis.crypto.randomUUID()))(),
      manifestId: crypt.manifestId,
      settings,
      createdAt: (deps.now ?? Date.now)(),
      status,
    };
    const written = await writeImport(deps.factory, { crypt, run, events });
    if (!written.ok) {
      const kind = written.kind;
      return importFailure(kind === 'duplicate' || kind === 'conflict' ? kind : storageKind(kind));
    }

    if (notes !== null && !notesPresent) {
      const saved = await deps.notesStore.save(notes);
      if (!saved.ok) {
        // Take the crypt out again, so a failed import leaves the device as it was.
        await deleteCrypt(deps.factory, crypt.manifestId);
        return importFailure('storage-unavailable');
      }
    }
    return importSuccess({ manifestId: crypt.manifestId, runId: run.runId, status, source: crypt.source, withNotes: notes !== null });
  } catch {
    return importFailure('write-failed');
  }
}

/** Reads a chosen file and imports it. A file over the cap is refused before it is read. Never throws. */
export async function importCryptFile(deps: ImportDeps, file: Blob): Promise<ImportResult<ImportedCrypt>> {
  try {
    if (file.size > MAX_IMPORT_BYTES) return importFailure('too-large');
    const text = await file.text();
    return isTooLarge(text) ? importFailure('too-large') : await importCryptFromText(deps, text);
  } catch {
    return importFailure('not-json');
  }
}
