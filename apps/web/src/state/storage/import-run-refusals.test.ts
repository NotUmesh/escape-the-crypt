import { IDBKeyRange as FakeIDBKeyRange } from 'fake-indexeddb';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { IMPORT_ERROR_KINDS } from '@escape-the-crypt/core';
import { importCryptFile, importCryptFromText } from './import-crypt';
import { MAX_IMPORT_BYTES } from './import-run';
import { GOOD, notesChunksFor, parse, refused, sampleScenario, stringify } from './import-run-fixtures';
import { dump, exportTextOf, freshDevice } from './import-test-support';

beforeAll(() => {
  vi.stubGlobal('IDBKeyRange', FakeIDBKeyRange);
});

describe('a file that is not a good copy', () => {
  it('refuses a file over the size cap, as text and as a file, without reading the file', async () => {
    await refused('x'.repeat(MAX_IMPORT_BYTES + 1), 'too-large');
    await refused(`"${'é'.repeat(MAX_IMPORT_BYTES)}"`, 'too-large');
    const big = { size: MAX_IMPORT_BYTES + 1, text: vi.fn() } as unknown as Blob;
    expect(await importCryptFile(freshDevice().deps, big)).toEqual({ ok: false, error: { kind: 'too-large' } });
    expect((big as unknown as { text: ReturnType<typeof vi.fn> }).text).not.toHaveBeenCalled();
  });

  it('refuses text that is not JSON, or an empty file', async () => {
    for (const text of ['', '{', 'not json', GOOD.slice(0, GOOD.length - 10), '\u0000\u0001']) await refused(text, 'not-json');
  });

  it('refuses JSON that is not an export, however it is shaped', async () => {
    for (const value of [null, 0, 'text', [], {}, [GOOD], { schemaVersion: 1 }, { ...parse(GOOD), extra: 1 }]) {
      await refused(stringify(value), 'not-an-export');
    }
  });

  it('refuses a missing key, a changed key and a key added by hand', async () => {
    for (const key of ['chunks', 'content', 'events', 'manifest', 'settings', 'schemaVersion']) {
      const copy = parse(GOOD);
      delete copy[key];
      await refused(stringify(copy), 'not-an-export');
    }
    await refused(stringify({ ...parse(GOOD), fileName: 'notes.pdf' }), 'not-an-export');
    await refused(stringify({ ...parse(GOOD), settings: { length: 'short', difficulty: 'lich', hintAllowance: 1, extra: true } }), 'not-an-export');
  });

  it('says a newer version is newer, and an older or odd version is not an export', async () => {
    await refused(stringify({ ...parse(GOOD), schemaVersion: 2 }), 'unsupported-version');
    await refused(stringify({ ...parse(GOOD), schemaVersion: 99 }), 'unsupported-version');
    for (const version of [0, -1, 1.5, '1', null]) await refused(stringify({ ...parse(GOOD), schemaVersion: version }), 'not-an-export');
  });

  it('refuses a crypt with no rooms, whichever check catches it first', async () => {
    const empty = parse(GOOD);
    (empty['manifest'] as { rooms: unknown[] }).rooms = [];
    const device = freshDevice();
    const before = await dump(device);
    const result = await importCryptFromText(device.deps, stringify(empty));
    expect(result.ok).toBe(false);
    expect(await dump(device)).toBe(before);
  });

  it('refuses a crypt that fails the publish checks', async () => {
    const noDoor = parse(GOOD);
    delete (noDoor['manifest'] as Record<string, unknown>)['finalDoor'];
    await refused(stringify(noDoor), 'crypt-invalid');
    const retyped = parse(GOOD);
    (retyped['manifest'] as { manifestId: unknown }).manifestId = 42;
    await refused(stringify(retyped), 'crypt-invalid');
    await refused(stringify({ ...parse(GOOD), manifest: 'nope' }), 'crypt-invalid');
    await refused(stringify({ ...parse(GOOD), content: { questions: {}, concepts: {} } }), 'crypt-invalid');
  });

  it('refuses events that are not events, or that the reducer does not accept in order', async () => {
    const events = parse(GOOD)['events'] as unknown[];
    await refused(stringify({ ...parse(GOOD), events: [...events, { kind: 'Nope' }] }), 'events-invalid');
    await refused(stringify({ ...parse(GOOD), events: [...events, 'text'] }), 'events-invalid');
    await refused(stringify({ ...parse(GOOD), events: [] }), 'events-invalid');
    await refused(stringify({ ...parse(GOOD), events: [...events].reverse() }), 'events-invalid');
    await refused(stringify({ ...parse(GOOD), events: events.slice(1) }), 'events-invalid');
    // An answer to a slot that does not exist.
    await refused(stringify({ ...parse(GOOD), events: [...events, { kind: 'Skipped', slotId: 'no-such-slot' }] }), 'events-invalid');
  });

  it('refuses a run that already escaped when more events follow the escape', async () => {
    const escaped = parse(exportTextOf(sampleScenario(Array<number>(400).fill(0))));
    const events = escaped['events'] as unknown[];
    await refused(stringify({ ...escaped, events: [...events, ...events.slice(-1)] }), 'events-invalid');
  });

  it('survives hostile object keys without polluting anything', async () => {
    const text = GOOD.replace('"settings":', '"__proto__":{"polluted":true},"settings":');
    await refused(text, 'not-an-export');
    expect(({} as Record<string, unknown>)['polluted']).toBeUndefined();
  });

  it('refuses very deep nesting without throwing', async () => {
    const deep = `${'['.repeat(200_000)}${']'.repeat(200_000)}`;
    const result = await importCryptFromText(freshDevice().deps, deep);
    expect(result.ok).toBe(false);
  });

  it('only ever answers with a kind that has copy', async () => {
    const kinds = new Set<string>();
    for (const text of ['', '{}', stringify({ ...parse(GOOD), schemaVersion: 2 }), GOOD.replace('"manifest"', '"manifesto"')]) {
      const result = await importCryptFromText(freshDevice().deps, text);
      if (!result.ok) kinds.add(result.error.kind);
    }
    for (const kind of kinds) expect(IMPORT_ERROR_KINDS as readonly string[]).toContain(kind);
  });
});

describe('storage that fails', () => {
  it('reports an unavailable database as storage-unavailable and throws nothing', async () => {
    const device = freshDevice();
    const result = await importCryptFromText({ ...device.deps, factory: undefined }, GOOD);
    expect(result).toEqual({ ok: false, error: { kind: 'storage-unavailable' } });
  });

  it('never throws when the notes store or the factory misbehaves', async () => {
    const { generated } = await notesChunksFor();
    const device = freshDevice();
    const boom = (): never => {
      throw new Error('boom');
    };
    const hostile = { ...device.deps, notesStore: { save: boom, load: boom } };
    const result = await importCryptFromText(hostile, exportTextOf(generated));
    expect(result.ok).toBe(false);
    const brokenFactory = { open: boom } as unknown as IDBFactory;
    expect((await importCryptFromText({ ...device.deps, factory: brokenFactory }, GOOD)).ok).toBe(false);
  });
});
