import fc from 'fast-check';
import { IDBFactory, IDBKeyRange as FakeIDBKeyRange } from 'fake-indexeddb';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { CryptBundle } from '@escape-the-crypt/core';
import { loadCrypt, saveCrypt } from './crypt-repository';
import { buildExport, ExportFileSchema, exportToJson } from './export-run';
import { contentArb, persistableRunArb } from './persistable-run-support';
import type { AcceptedRun } from './persistence-arbitraries';
import { appendEvent, createRun, loadEvents, loadRun } from './run-repository';

const RUN_ID = 'run-export';

/** One accepted run with at least two events, its content, and the stored records. */
async function setup(storedEvents: number) {
  const run = fc
    .sample(persistableRunArb, { seed: 7, numRuns: 100 })
    .find((candidate: AcceptedRun) => candidate.events.length >= 2);
  if (run === undefined) throw new Error('no run with events generated');
  const content = fc.sample(contentArb(run.manifest), { seed: 7, numRuns: 1 })[0]!;
  const bundle: CryptBundle = { manifest: run.manifest, content };
  const factory = new IDBFactory();
  expect((await saveCrypt(factory, { bundle, source: 'sample' })).ok).toBe(true);
  expect(
    (await createRun(factory, { runId: RUN_ID, manifestId: run.manifest.manifestId, settings: run.settings, createdAt: 1 })).ok,
  ).toBe(true);
  for (const event of run.events.slice(0, storedEvents)) {
    expect((await appendEvent(factory, RUN_ID, event)).ok).toBe(true);
  }
  const crypt = await loadCrypt(factory, run.manifest.manifestId);
  const record = await loadRun(factory, RUN_ID);
  if (!crypt.ok || !record.ok) throw new Error('records unreadable');
  return { run, factory, crypt: crypt.value, record: record.value };
}

describe('export file', () => {
  beforeAll(() => {
    vi.stubGlobal('IDBKeyRange', FakeIDBKeyRange);
  });

  it('parses with the strict schema, holds no file name, and carries the accepted events', async () => {
    // **Validates: Requirements 13.2, 13.7**
    const { run, crypt, record } = await setup(Number.MAX_SAFE_INTEGER);
    const built = buildExport({ crypt, run: record, acceptedEvents: run.events, chunks: null });
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(ExportFileSchema.safeParse(built.value).success).toBe(true);
    expect(Object.keys(built.value).sort()).toEqual(
      ['chunks', 'content', 'events', 'manifest', 'schemaVersion', 'settings'].sort(),
    );
    const json = exportToJson(built.value);
    expect(json.ok).toBe(true);
    if (!json.ok) return;
    expect(json.value).not.toMatch(/fileName|pdfBytes/);
    expect(ExportFileSchema.safeParse(JSON.parse(json.value)).success).toBe(true);
    expect(built.value.events).toEqual(run.events);
  });

  it('exports the in-memory events when the last events failed to save', async () => {
    // **Validates: Requirements 13.5**
    const { run, factory, crypt, record } = await setup(1);
    const stored = await loadEvents(factory, RUN_ID);
    expect(stored.ok && stored.value.length).toBe(1);
    const built = buildExport({ crypt, run: record, acceptedEvents: run.events, chunks: null });
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.value.events).toEqual(run.events);
    expect(built.value.events.length).toBeGreaterThan(1);
  });

  it('rejects unknown extra keys such as fileName and pdfBytes', async () => {
    // **Validates: Requirements 13.2**
    const { run, crypt, record } = await setup(0);
    const built = buildExport({ crypt, run: record, acceptedEvents: run.events, chunks: null });
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(ExportFileSchema.safeParse({ ...built.value, fileName: 'notes.pdf' }).success).toBe(false);
    expect(ExportFileSchema.safeParse({ ...built.value, pdfBytes: [1, 2, 3] }).success).toBe(false);
  });
});
