import { IDBFactory, IDBKeyRange as FakeIDBKeyRange } from 'fake-indexeddb';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { SAMPLE_IDS } from '@escape-the-crypt/core';
import { buildCryptForSample } from '../../features/crypt/sample-sources';
import { createMemoryStore } from '../../features/ingest/notes-store-memory';
import { saveCrypt } from './crypt-repository';
import { startEventsFor } from './persistence-arbitraries';
import { restoreRun } from './restore-run';
import { appendEvent, createRun } from './run-repository';

const SETTINGS = { length: 'short', difficulty: 'apprentice', hintAllowance: 3 } as const;

beforeAll(() => {
  vi.stubGlobal('IDBKeyRange', FakeIDBKeyRange);
});

/** Saves a sample crypt and a run with its start events, the way playing it does. */
async function saveSampleRun(id: string, source: 'sample' | 'generated' = 'sample') {
  const built = buildCryptForSample(id)();
  if (!built.ok) throw new Error(`sample ${id} did not build`);
  const factory = new IDBFactory();
  const bundle = { manifest: built.value.manifest, content: built.value.content };
  expect((await saveCrypt(factory, { bundle, source, ...(source === 'generated' ? { documentDigest: 'd' } : {}) })).ok).toBe(true);
  const manifestId = built.value.manifest.manifestId;
  expect((await createRun(factory, { runId: 'run-1', manifestId, settings: SETTINGS, createdAt: 1 })).ok).toBe(true);
  for (const event of startEventsFor(built.value.manifest)) expect((await appendEvent(factory, 'run-1', event)).ok).toBe(true);
  return { factory, built: built.value };
}

describe('restoring a saved sample run', () => {
  it.each(SAMPLE_IDS)('rebuilds the %s sample from its own notes, whichever sample it is', async (id) => {
    const { factory, built } = await saveSampleRun(id);
    const restored = await restoreRun({ factory, notesStore: createMemoryStore() }, 'run-1');
    expect(restored.ok, JSON.stringify(restored)).toBe(true);
    if (!restored.ok) return;
    expect(restored.value.assets.source).toBe('sample');
    expect(restored.value.crypt.manifestId).toBe(built.manifest.manifestId);
    // The chunks are the sample's own, not another sample's.
    expect([...restored.value.assets.chunks.keys()]).toEqual([...built.chunks.keys()]);
    expect(restored.value.events).toEqual(startEventsFor(built.manifest));
  });

  it('does not give one sample the notes of another', async () => {
    const { factory } = await saveSampleRun('https');
    const other = buildCryptForSample('printing-press')();
    const restored = await restoreRun({ factory, notesStore: createMemoryStore(), buildSample: () => other }, 'run-1');
    expect(restored).toEqual({ ok: false, error: { kind: 'record-unreadable' } });
  });

  it('cannot restore a "sample" crypt whose manifest is not a bundled sample', async () => {
    const built = buildCryptForSample('https')();
    if (!built.ok) throw new Error('https did not build');
    const factory = new IDBFactory();
    const manifest = { ...built.value.manifest, manifestId: 'not-a-bundled-sample' };
    expect((await saveCrypt(factory, { bundle: { manifest, content: built.value.content }, source: 'sample' })).ok).toBe(true);
    expect((await createRun(factory, { runId: 'run-1', manifestId: 'not-a-bundled-sample', settings: SETTINGS, createdAt: 1 })).ok).toBe(true);
    for (const event of startEventsFor(manifest)) await appendEvent(factory, 'run-1', event);
    expect(await restoreRun({ factory, notesStore: createMemoryStore() }, 'run-1')).toEqual({ ok: false, error: { kind: 'record-unreadable' } });
  });

  it('still honours a supplied builder, as the tests and the read-only screen pass one', async () => {
    const { factory, built } = await saveSampleRun('printing-press');
    const restored = await restoreRun({ factory, notesStore: createMemoryStore(), buildSample: () => ({ ok: true, value: built }) }, 'run-1');
    expect(restored.ok).toBe(true);
  });
});
