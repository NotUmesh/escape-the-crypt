import type { Chunk, Event, State } from '@escape-the-crypt/core';
import type { RoomAssets } from '../../state/room-assets';
import { loadCrypt } from '../../state/storage/crypt-repository';
import { buildExport, exportToJson } from '../../state/storage/export-run';
import type { CryptRecord, RunRecord } from '../../state/storage/records';
import { notesChunks } from '../../state/storage/notes-chunks';
import type { RestoreDeps } from '../../state/storage/restore-run';

/** The generic file name. It never carries the name of an uploaded file (Req 13.2). */
export const EXPORT_FILE_NAME = 'escape-the-crypt-export.json';

export interface ExportRunInput {
  readonly state: State;
  readonly assets: RoomAssets;
  /** The in-memory accepted events, including any that failed to save (Req 13.5). */
  readonly eventLog: readonly Event[];
  readonly runId: string;
  readonly deps: RestoreDeps;
}

export type ExportOutcome =
  | { readonly ok: true; readonly json: string; readonly withNotes: boolean }
  | { readonly ok: false };

/**
 * The notes chunks of the crypt, or `null` when unavailable. A sample crypt uses its bundled
 * chunks. A generated crypt is rebuilt from the notes store the way a restore does it.
 */
async function resolveChunks(input: ExportRunInput, crypt: CryptRecord): Promise<readonly Chunk[] | null> {
  if (input.assets.source === 'sample') return [...input.assets.chunks.values()];
  try {
    const stored = await loadCrypt(input.deps.factory, crypt.manifestId);
    if (!stored.ok) return null;
    const rebuilt = await notesChunks(input.deps, stored.value);
    return rebuilt.ok ? [...rebuilt.value.values()] : null;
  } catch {
    return null;
  }
}

/** Builds the JSON text of the export from the in-memory run. Never throws. */
export async function prepareExport(input: ExportRunInput): Promise<ExportOutcome> {
  const { state, assets } = input;
  const crypt: CryptRecord = {
    schemaVersion: 1,
    manifestId: state.manifest.manifestId,
    manifest: state.manifest,
    content: assets.content,
    source: assets.source === 'sample' ? 'sample' : 'generated',
  };
  const run: RunRecord = {
    schemaVersion: 1,
    runId: input.runId,
    manifestId: crypt.manifestId,
    settings: state.settings,
    createdAt: 0,
    status: state.status === 'escaped' ? 'escaped' : 'active',
  };
  const chunks = await resolveChunks(input, crypt);
  const built = buildExport({ crypt, run, acceptedEvents: input.eventLog, chunks });
  if (!built.ok) return { ok: false };
  const json = exportToJson(built.value);
  return json.ok ? { ok: true, json: json.value, withNotes: chunks !== null } : { ok: false };
}

/** Starts a browser download of `json`. Download only; nothing is read back. */
export function downloadJson(json: string): void {
  const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = EXPORT_FILE_NAME;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
