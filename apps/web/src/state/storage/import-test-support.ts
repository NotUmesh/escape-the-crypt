import fc from 'fast-check';
import { IDBFactory } from 'fake-indexeddb';
import { chunkDocument } from '@escape-the-crypt/core';
import type { Chunk, CryptContent, NotesRecord } from '@escape-the-crypt/core';
import type { NotesStore } from '../../features/ingest/notes-store';
import { SAMPLE_CRYPT } from '../../test-support/sample-bundle';
import { canonicalJson } from './crypt-repository';
import { STORES, openDb } from './db';
import { buildExport, exportToJson } from './export-run';
import type { ImportDeps } from './import-crypt';
import { contentArb, persistableRunArb } from './persistable-run-support';
import { playAccepted, runSettingsArb } from './persistence-arbitraries';
import type { AcceptedRun } from './persistence-arbitraries';
import type { CryptRecord, RunRecord } from './records';

/** Test support for the import tests: a device to import into, arbitrary exports, and a full dump. */
export interface Device {
  readonly factory: IDBFactory;
  readonly notes: NotesStore & { readonly all: () => NotesRecord[]; readonly saves: () => number };
  readonly deps: ImportDeps;
}

/** A notes store that keeps its records where a test can read them, and can be made to fail. */
export function recordingNotes(failSave = false): Device['notes'] {
  const records = new Map<string, NotesRecord>();
  let saves = 0;
  return {
    saves: () => saves,
    save(record) {
      saves += 1;
      if (failSave) return Promise.resolve({ ok: false, error: { kind: 'storage-unavailable' } });
      records.set(record.documentDigest, record);
      return Promise.resolve({ ok: true, value: true });
    },
    load: (digest) => Promise.resolve({ ok: true, value: records.get(digest) ?? null }),
    all: () => [...records.values()],
  };
}

export function freshDevice(options: { failNotesSave?: boolean } = {}): Device {
  const factory = new IDBFactory();
  const notes = recordingNotes(options.failNotesSave === true);
  let counter = 0;
  return {
    factory,
    notes,
    deps: { factory, notesStore: notes, now: () => 1_700_000_000_000, newRunId: () => `imported-${(counter += 1)}` },
  };
}

/** Everything stored on the device, as one canonical string: all three stores and the notes store. */
export async function dump(device: Device): Promise<string> {
  const opened = await openDb(device.factory);
  if (!opened.ok) throw new Error('could not open the test database');
  const db = opened.value;
  try {
    const all = (name: string): Promise<unknown[]> =>
      new Promise((resolve, reject) => {
        const request = db.transaction(name, 'readonly').objectStore(name).getAll();
        request.onsuccess = () => resolve(request.result as unknown[]);
        request.onerror = () => reject(request.error);
      });
    return canonicalJson({
      crypts: await all(STORES.crypts),
      runs: await all(STORES.runs),
      events: await all(STORES.events),
      notes: device.notes.all(),
    });
  } finally {
    db.close();
  }
}

const paragraphArb = fc.stringMatching(/^[A-Za-z][A-Za-z ,.]{40,160}[A-Za-z]$/);

export const notesChunksArb: fc.Arbitrary<readonly Chunk[]> = fc
  .array(paragraphArb, { minLength: 1, maxLength: 4 })
  .map((paragraphs) => {
    const text = paragraphs.join('\n\n');
    return chunkDocument({ sourceType: 'paste', text, originalText: text });
  });

/** Points every excerpt at a chunk that exists, as a real generated crypt's content does. */
function citing(content: CryptContent, chunks: readonly Chunk[]): CryptContent {
  let next = 0;
  const questions = Object.fromEntries(
    Object.entries(content.questions).map(([id, entry]) => [
      id,
      { ...entry, excerpts: entry.excerpts.map((excerpt) => ({ ...excerpt, chunkId: chunks[(next += 1) % chunks.length]?.id ?? '' })) },
    ]),
  );
  return { ...content, questions };
}

export interface ExportScenario {
  readonly run: AcceptedRun;
  readonly crypt: CryptRecord;
  readonly chunks: readonly Chunk[];
  readonly source: 'sample' | 'generated';
}

/** A generated crypt, played some way, with the notes its questions cite. */
export const generatedScenarioArb: fc.Arbitrary<ExportScenario> = persistableRunArb.chain((run) =>
  fc.tuple(contentArb(run.manifest), notesChunksArb).map(([content, chunks]) => ({
    run,
    chunks,
    source: 'generated' as const,
    crypt: {
      schemaVersion: 1,
      manifestId: run.manifest.manifestId,
      manifest: run.manifest,
      content: citing(content, chunks),
      source: 'generated',
      documentDigest: chunks[0]?.documentDigest ?? 'd',
    } satisfies CryptRecord,
  })),
);

/** The bundled sample crypt, played some way. */
export const sampleScenarioArb: fc.Arbitrary<ExportScenario> = fc
  .tuple(runSettingsArb, fc.array(fc.nat({ max: 1000 }), { maxLength: 60 }))
  .map(([settings, choices]) => ({
    run: playAccepted(SAMPLE_CRYPT.manifest, settings, choices),
    chunks: [...SAMPLE_CRYPT.chunks.values()],
    source: 'sample' as const,
    crypt: {
      schemaVersion: 1,
      manifestId: SAMPLE_CRYPT.manifest.manifestId,
      manifest: SAMPLE_CRYPT.manifest,
      content: SAMPLE_CRYPT.content,
      source: 'sample',
    } satisfies CryptRecord,
  }));

export function runRecordFor(scenario: ExportScenario): RunRecord {
  return {
    schemaVersion: 1,
    runId: 'exported-run',
    manifestId: scenario.crypt.manifestId,
    settings: scenario.run.settings,
    createdAt: 0,
    status: scenario.run.state.status === 'escaped' ? 'escaped' : 'active',
  };
}

/** The text of the file `Export a copy` would write for this scenario. */
export function exportTextOf(scenario: ExportScenario, chunks: readonly Chunk[] | null = scenario.chunks): string {
  const built = buildExport({ crypt: scenario.crypt, run: runRecordFor(scenario), acceptedEvents: scenario.run.events, chunks });
  if (!built.ok) throw new Error(`export failed: ${built.error.kind}`);
  const json = exportToJson(built.value);
  if (!json.ok) throw new Error('export text failed');
  return json.value;
}

/** The same JSON value with object keys sorted, so two exports compare by content and order of arrays. */
export function canonical(text: string): string {
  return canonicalJson(JSON.parse(text));
}
