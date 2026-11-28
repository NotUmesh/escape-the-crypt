import { IDBKeyRange as FakeIDBKeyRange } from 'fake-indexeddb';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { SAMPLE_IDS, makeNotesRecord } from '@escape-the-crypt/core';
import { buildCryptForSample } from '../../features/crypt/sample-sources';
import { SAMPLE_CRYPT } from '../../test-support/sample-bundle';
import { importCryptFromText } from './import-crypt';
import { GOOD, PLAYED, SETTINGS, notesChunksFor, parse, refused, sampleScenario, stringify } from './import-run-fixtures';
import { dump, exportTextOf, freshDevice } from './import-test-support';
import type { ExportScenario } from './import-test-support';
import { playAccepted } from './persistence-arbitraries';
import { restoreRun } from './restore-run';
import { loadEvents, loadRun } from './run-repository';

beforeAll(() => {
  vi.stubGlobal('IDBKeyRange', FakeIDBKeyRange);
});

describe('importing a copy of the bundled sample', () => {
  it('puts the crypt on the shelf as a new active run that restores', async () => {
    const device = freshDevice();
    const result = await importCryptFromText(device.deps, GOOD);
    expect(result).toEqual({
      ok: true,
      value: { manifestId: SAMPLE_CRYPT.manifest.manifestId, runId: 'imported-1', status: 'active', source: 'sample', withNotes: false },
    });
    const run = await loadRun(device.factory, 'imported-1');
    expect(run).toMatchObject({ ok: true, value: { status: 'active', createdAt: 1_700_000_000_000 } });
    const events = await loadEvents(device.factory, 'imported-1');
    expect(events.ok && events.value.map((row) => row.event)).toEqual(PLAYED.run.events);
    expect((await restoreRun({ factory: device.factory, notesStore: device.notes }, 'imported-1')).ok).toBe(true);
  });

  it('reads an escaped run as escaped', async () => {
    const escaped = sampleScenario(Array<number>(400).fill(0));
    expect(escaped.run.state.status).toBe('escaped');
    const result = await importCryptFromText(freshDevice().deps, exportTextOf(escaped));
    expect(result).toMatchObject({ ok: true, value: { status: 'escaped' } });
  });

  it('keeps nothing from the file beyond the crypt, the settings and the events', async () => {
    const device = freshDevice();
    await importCryptFromText(device.deps, GOOD);
    const stored = await dump(device);
    expect(stored).not.toMatch(/"(fileName|filename|file|bytes|pdf)"/i);
    expect(device.notes.all()).toEqual([]);
  });
});

describe.each(SAMPLE_IDS)('importing a copy of the %s sample', (id) => {
  const scenario = (): ExportScenario => {
    const built = buildCryptForSample(id)();
    if (!built.ok) throw new Error(`sample ${id} did not build`);
    return {
      run: playAccepted(built.value.manifest, SETTINGS, [0, 0, 1, 2, 0, 0]),
      chunks: [...built.value.chunks.values()],
      source: 'sample',
      crypt: { schemaVersion: 1, manifestId: built.value.manifest.manifestId, manifest: built.value.manifest, content: built.value.content, source: 'sample' },
    };
  };

  it('is kept as a sample, with no notes of its own on the device', async () => {
    const device = freshDevice();
    const result = await importCryptFromText(device.deps, exportTextOf(scenario()));
    expect(result).toMatchObject({ ok: true, value: { source: 'sample', withNotes: false } });
    expect(device.notes.all()).toEqual([]);
  });

  it('then restores, with the sample\'s own notes', async () => {
    const device = freshDevice();
    await importCryptFromText(device.deps, exportTextOf(scenario()));
    const restored = await restoreRun({ factory: device.factory, notesStore: device.notes }, 'imported-1');
    expect(restored.ok, JSON.stringify(restored)).toBe(true);
    expect(restored.ok && restored.value.assets.source).toBe('sample');
  });

  it('is refused when its notes are not the bundled notes', async () => {
    const file = parse(exportTextOf(scenario()));
    const chunks = file['chunks'] as { text: string }[];
    file['chunks'] = chunks.map((chunk, i) => (i === 0 ? { ...chunk, text: `${chunk.text} Changed.` } : chunk));
    await refused(stringify(file), 'notes-invalid');
  });
});

describe('importing a copy of a generated crypt', () => {
  it('keeps its notes, so the crypt restores', async () => {
    const { generated } = await notesChunksFor();
    const device = freshDevice();
    const result = await importCryptFromText(device.deps, exportTextOf(generated));
    expect(result).toMatchObject({ ok: true, value: { source: 'generated', withNotes: true } });
    expect(device.notes.all()).toHaveLength(1);
    expect((await restoreRun({ factory: device.factory, notesStore: device.notes }, 'imported-1')).ok).toBe(true);
  });

  it('refuses a copy exported without its notes', async () => {
    const { generated } = await notesChunksFor();
    await refused(exportTextOf(generated, null), 'no-notes');
    await refused(exportTextOf(generated, []), 'no-notes');
  });

  it('refuses notes that do not hold what the questions cite', async () => {
    const { generated, otherChunks } = await notesChunksFor();
    await refused(exportTextOf(generated, otherChunks), 'notes-invalid');
  });

  it('refuses a file whose notes would replace different notes already on the device, and leaves those notes', async () => {
    const { generated } = await notesChunksFor();
    const device = freshDevice();
    const digest = generated.chunks[0]?.documentDigest ?? '';
    const mine = { schemaVersion: 1 as const, documentDigest: digest, chunks: generated.chunks.map((c) => ({ ...c, text: `${c.text} My own edit.` })) };
    await device.notes.save(mine);
    const before = await dump(device);
    const result = await importCryptFromText(device.deps, exportTextOf(generated));
    expect(result).toEqual({ ok: false, error: { kind: 'notes-conflict' } });
    expect(await dump(device)).toBe(before);
  });

  it('accepts identical notes that are already on the device, and does not write them a second time', async () => {
    const { generated } = await notesChunksFor();
    const device = freshDevice();
    await device.notes.save(makeNotesRecord(generated.chunks));
    expect(device.notes.saves()).toBe(1);
    const result = await importCryptFromText(device.deps, exportTextOf(generated));
    expect(result.ok).toBe(true);
    expect(device.notes.saves()).toBe(1);
    expect(device.notes.all()).toHaveLength(1);
    await expect(restoreRun({ factory: device.factory, notesStore: device.notes }, 'imported-1')).resolves.toMatchObject({ ok: true });
  });

  it('takes the crypt out again when the notes cannot be saved, leaving the device as it was', async () => {
    const { generated } = await notesChunksFor();
    const device = freshDevice({ failNotesSave: true });
    const before = await dump(device);
    const result = await importCryptFromText(device.deps, exportTextOf(generated));
    expect(result).toEqual({ ok: false, error: { kind: 'storage-unavailable' } });
    expect(await dump(device)).toBe(before);
  });
});

describe('never overwriting', () => {
  it('says a crypt that is already here is a duplicate, and changes nothing', async () => {
    const device = freshDevice();
    expect((await importCryptFromText(device.deps, GOOD)).ok).toBe(true);
    const before = await dump(device);
    expect(await importCryptFromText(device.deps, GOOD)).toEqual({ ok: false, error: { kind: 'duplicate' } });
    expect(await dump(device)).toBe(before);
  });

  it('says a different crypt with the same identity is a conflict, and changes nothing', async () => {
    const { generated } = await notesChunksFor();
    const device = freshDevice();
    expect((await importCryptFromText(device.deps, exportTextOf(generated))).ok).toBe(true);
    const text = parse(exportTextOf(generated));
    const content = text['content'] as { concepts: Record<string, { title: string }> };
    const firstConcept = Object.keys(content.concepts)[0] ?? '';
    content.concepts[firstConcept] = { title: 'A different title' };
    const before = await dump(device);
    expect(await importCryptFromText({ ...device.deps, newRunId: () => 'other' }, stringify(text))).toEqual({
      ok: false,
      error: { kind: 'conflict' },
    });
    expect(await dump(device)).toBe(before);
  });

  it('refuses a copy of the sample that carries other notes', async () => {
    const text = parse(GOOD);
    const chunks = text['chunks'] as { text: string }[];
    text['chunks'] = chunks.map((chunk, i) => (i === 0 ? { ...chunk, text: `${chunk.text} Changed.` } : chunk));
    await refused(stringify(text), 'notes-invalid');
  });

  it('accepts a copy of the sample exported without notes', async () => {
    const text = parse(GOOD);
    text['chunks'] = null;
    expect((await importCryptFromText(freshDevice().deps, stringify(text))).ok).toBe(true);
  });

  it('refuses a lookalike of the bundled sample', async () => {
    const text = parse(GOOD);
    const content = text['content'] as { concepts: Record<string, { title: string }> };
    content.concepts[Object.keys(content.concepts)[0] ?? ''] = { title: 'Not the sample title' };
    await refused(stringify(text), 'conflict');
  });
});
