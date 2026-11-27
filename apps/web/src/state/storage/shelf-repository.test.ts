import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';
import type { CryptBundle } from '@escape-the-crypt/core';
import type { ShelfEntry as DeskShelfEntry } from '../../features/desk/shelf-entry';
import { SAMPLE_BUNDLE, SAMPLE_NOTES_TEXT } from '../../test-support/sample-bundle';
import { saveCrypt } from './crypt-repository';
import { STORES, openDb } from './db';
import { createRun, setRunStatus } from './run-repository';
import { listShelf } from './shelf-repository';
import type { ShelfEntry } from './shelf-repository';

const SETTINGS = { length: 'short', difficulty: 'apprentice', hintAllowance: 3 } as const;

function bundle(manifestId: string): CryptBundle {
  return { manifest: { ...SAMPLE_BUNDLE.manifest, manifestId }, content: SAMPLE_BUNDLE.content };
}

async function save(factory: IDBFactory, manifestId: string, source: 'sample' | 'generated' = 'generated'): Promise<void> {
  const saved = await saveCrypt(factory, { bundle: bundle(manifestId), source, ...(source === 'generated' ? { documentDigest: 'd' } : {}) });
  if (!saved.ok) throw new Error(`save failed: ${saved.error.kind}`);
}
async function run(factory: IDBFactory, runId: string, manifestId: string, createdAt: number): Promise<void> {
  const created = await createRun(factory, { runId, manifestId, settings: SETTINGS, createdAt });
  if (!created.ok) throw new Error(`run failed: ${created.error.kind}`);
}

describe('listShelf', () => {
  it('is empty for a new device', async () => {
    expect(await listShelf(new IDBFactory())).toEqual({ ok: true, value: [] });
  });

  it('lists every saved crypt, most recently played first, from its latest run', async () => {
    const factory = new IDBFactory();
    await save(factory, 'crypt-a');
    await save(factory, 'crypt-b');
    await save(factory, 'human-heart-sample', 'sample');
    await run(factory, 'a-1', 'crypt-a', 100);
    await run(factory, 'a-2', 'crypt-a', 500);
    await run(factory, 'b-1', 'crypt-b', 300);
    await run(factory, 's-1', 'human-heart-sample', 200);
    await setRunStatus(factory, 'a-2', 'escaped');
    const shelf = await listShelf(factory);
    expect(shelf).toEqual({
      ok: true,
      value: [
        { manifestId: 'crypt-a', runId: 'a-2', status: 'escaped', createdAt: 500, source: 'generated', roomCount: 1 },
        { manifestId: 'crypt-b', runId: 'b-1', status: 'active', createdAt: 300, source: 'generated', roomCount: 1 },
        { manifestId: 'human-heart-sample', runId: 's-1', status: 'active', createdAt: 200, source: 'sample', roomCount: 1 },
      ],
    });
  });

  it('keeps a crypt with no run, last, as not finished and with nothing to continue', async () => {
    const factory = new IDBFactory();
    await save(factory, 'crypt-played');
    await save(factory, 'crypt-unplayed');
    await run(factory, 'p-1', 'crypt-played', 10);
    const shelf = await listShelf(factory);
    expect(shelf.ok && shelf.value.map((e) => [e.manifestId, e.runId, e.status, e.createdAt])).toEqual([
      ['crypt-played', 'p-1', 'active', 10],
      ['crypt-unplayed', null, 'left', 0],
    ]);
  });

  it('leaves an unreadable record off the shelf instead of hiding every book', async () => {
    const factory = new IDBFactory();
    await save(factory, 'crypt-good');
    await run(factory, 'g-1', 'crypt-good', 1);
    const opened = await openDb(factory);
    if (!opened.ok) throw new Error('open failed');
    await new Promise<void>((resolve) => {
      const tx = opened.value.transaction([STORES.crypts, STORES.runs], 'readwrite');
      tx.objectStore(STORES.crypts).put({ schemaVersion: 1, manifestId: 'crypt-broken', manifest: {}, content: {}, source: 'generated' });
      tx.objectStore(STORES.runs).put({ schemaVersion: 1, runId: 'bad', manifestId: 'crypt-good', createdAt: 'yesterday' });
      tx.oncomplete = () => resolve();
    });
    opened.value.close();
    const shelf = await listShelf(factory);
    expect(shelf.ok && shelf.value.map((e) => [e.manifestId, e.runId])).toEqual([['crypt-good', 'g-1']]);
  });

  it('is storage-unavailable without IndexedDB', async () => {
    expect(await listShelf(undefined)).toEqual({ ok: false, error: { kind: 'storage-unavailable' } });
  });

  it('carries no study text: no prompt, option, notes or concept title', async () => {
    const factory = new IDBFactory();
    await save(factory, 'crypt-a');
    await run(factory, 'a-1', 'crypt-a', 1);
    const json = JSON.stringify(await listShelf(factory));
    for (const entry of Object.values(SAMPLE_BUNDLE.content.questions)) expect(json).not.toContain(entry.prompt);
    for (const concept of Object.values(SAMPLE_BUNDLE.content.concepts)) expect(json).not.toContain(concept.title);
    expect(json).not.toContain(SAMPLE_NOTES_TEXT.slice(0, 30));
  });

  it('matches the shape the desk declares', () => {
    const entry: ShelfEntry = { manifestId: 'm', runId: null, status: 'left', createdAt: 0, source: 'sample', roomCount: 1 };
    const forDesk: DeskShelfEntry = entry;
    expect(forDesk).toBe(entry);
  });
});
