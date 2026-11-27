import { IDBFactory, IDBKeyRange as FakeIDBKeyRange } from 'fake-indexeddb';
import { act } from 'react';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { startEventsFor } from '../../state/storage/persistence-arbitraries';
import { saveCrypt } from '../../state/storage/crypt-repository';
import { appendEvent, createRun, setRunStatus } from '../../state/storage/run-repository';
import { SAMPLE_BUNDLE } from '../../test-support/sample-bundle';
import { useMount } from '../../test-support/flow-dom';
import type { ShelfEntry } from './shelf-entry';
import { interimShelfLoader, useShelf } from './use-shelf';
import type { ShelfLoader } from './use-shelf';

const SETTINGS = { length: 'short', difficulty: 'apprentice', hintAllowance: 2 } as const;
const MANIFEST_ID = SAMPLE_BUNDLE.manifest.manifestId;

async function seed(factory: IDBFactory, runId: string, createdAt: number): Promise<void> {
  expect((await saveCrypt(factory, { bundle: SAMPLE_BUNDLE, source: 'sample' })).ok).toBe(true);
  expect((await createRun(factory, { runId, manifestId: MANIFEST_ID, settings: SETTINGS, createdAt })).ok).toBe(true);
  for (const event of startEventsFor(SAMPLE_BUNDLE.manifest)) {
    expect((await appendEvent(factory, runId, event)).ok).toBe(true);
  }
}

const entry = (id: string, createdAt: number): ShelfEntry => ({
  manifestId: id,
  runId: null,
  status: 'left',
  createdAt,
  source: 'generated',
  roomCount: 2,
});

function Probe({ load }: { readonly load: ShelfLoader }): React.JSX.Element {
  const shelf = useShelf(load);
  return <p data-testid="ids">{shelf.map((e) => e.manifestId).join(',')}</p>;
}
const flush = (): Promise<void> => act(async () => new Promise((resolve) => setTimeout(resolve, 20)));

describe('interimShelfLoader', () => {
  beforeAll(() => {
    vi.stubGlobal('IDBKeyRange', FakeIDBKeyRange);
  });
  afterAll(() => {
    vi.unstubAllGlobals();
  });

  it('gives an empty shelf when nothing is saved', async () => {
    expect(await interimShelfLoader(new IDBFactory())()).toEqual([]);
  });

  it('gives an empty shelf when storage is unavailable', async () => {
    expect(await interimShelfLoader(undefined)()).toEqual([]);
  });

  it('gives one book for the latest active run', async () => {
    const factory = new IDBFactory();
    await seed(factory, 'run-1', 1_700_000_000_000);
    const shelf = await interimShelfLoader(factory)();
    expect(shelf).toEqual([
      {
        manifestId: MANIFEST_ID,
        runId: 'run-1',
        status: 'active',
        createdAt: 1_700_000_000_000,
        source: 'sample',
        roomCount: SAMPLE_BUNDLE.manifest.rooms.length,
      },
    ]);
  });

  it('shows nothing for a run that was left, because it cannot be continued', async () => {
    const factory = new IDBFactory();
    await seed(factory, 'run-1', 1_700_000_000_000);
    await setRunStatus(factory, 'run-1', 'left');
    expect(await interimShelfLoader(factory)()).toEqual([]);
  });
});

describe('useShelf', () => {
  const mount = useMount();

  it('loads once on mount and lists newest first', async () => {
    const load = vi.fn<ShelfLoader>().mockResolvedValue([entry('old', 1), entry('new', 3), entry('mid', 2)]);
    mount.render(<Probe load={load} />);
    await flush();
    expect(mount.container.querySelector('[data-testid="ids"]')?.textContent).toBe('new,mid,old');
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('shows an empty shelf when the load fails', async () => {
    mount.render(<Probe load={() => Promise.reject(new Error('no'))} />);
    await flush();
    expect(mount.container.querySelector('[data-testid="ids"]')?.textContent).toBe('');
  });

  it('ignores a load that finishes after the hub is gone', async () => {
    let resolve: (value: readonly ShelfEntry[]) => void = () => undefined;
    const load: ShelfLoader = () => new Promise((r) => (resolve = r));
    mount.render(<Probe load={load} />);
    mount.render(<div />);
    await act(async () => resolve([entry('late', 1)]));
    expect(mount.container.textContent).toBe('');
  });
});
