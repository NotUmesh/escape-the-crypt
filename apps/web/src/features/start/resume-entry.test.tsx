import { IDBFactory, IDBKeyRange as FakeIDBKeyRange } from 'fake-indexeddb';
import { act } from 'react';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { SAMPLE_BUNDLE, SAMPLE_CRYPT } from '../../test-support/sample-bundle';
import { useMount, clickButton } from '../../test-support/flow-dom';
import { createIdbStore } from '../ingest/notes-store-idb';
import { startEventsFor } from '../../state/storage/persistence-arbitraries';
import { saveCrypt } from '../../state/storage/crypt-repository';
import { appendEvent, createRun, loadEvents, loadRun } from '../../state/storage/run-repository';
import type { RestoreDeps, RestoredRun } from '../../state/storage/restore-run';
import {
  CONTINUE_LABEL,
  NOTES_MISSING_TEXT,
  RESTORE_FAILED_TEXT,
  ResumeEntry,
  START_AGAIN_LABEL,
} from './resume-entry';

const SETTINGS = { length: 'short', difficulty: 'apprentice', hintAllowance: 2 } as const;
const MANIFEST_ID = SAMPLE_BUNDLE.manifest.manifestId;

const flush = (): Promise<void> =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });

async function seed(
  factory: IDBFactory,
  runId: string,
  createdAt: number,
  source: 'sample' | 'generated' = 'sample',
): Promise<void> {
  const saved = await saveCrypt(factory, {
    bundle: SAMPLE_BUNDLE,
    source,
    ...(source === 'generated' ? { documentDigest: 'digest-missing' } : {}),
  });
  expect(saved.ok).toBe(true);
  const run = await createRun(factory, { runId, manifestId: MANIFEST_ID, settings: SETTINGS, createdAt });
  expect(run.ok).toBe(true);
  for (const event of startEventsFor(SAMPLE_BUNDLE.manifest)) {
    expect((await appendEvent(factory, runId, event)).ok).toBe(true);
  }
}

const depsFor = (factory: IDBFactory | undefined): RestoreDeps => ({
  factory,
  notesStore: createIdbStore(factory),
  buildSample: () => ({ ok: true, value: SAMPLE_CRYPT }),
});

describe('ResumeEntry', () => {
  const mount = useMount();
  beforeAll(() => {
    vi.stubGlobal('IDBKeyRange', FakeIDBKeyRange);
  });
  afterAll(() => {
    vi.unstubAllGlobals();
  });

  const noop = (): void => undefined;

  it('renders nothing when no active run exists', async () => {
    mount.render(<ResumeEntry deps={depsFor(new IDBFactory())} onContinue={noop} onStartAgain={noop} />);
    await flush();
    expect(mount.container.querySelector('[data-testid="resume-entry"]')).toBeNull();
  });

  it('renders nothing when the lookup fails', async () => {
    mount.render(<ResumeEntry deps={depsFor(undefined)} onContinue={noop} onStartAgain={noop} />);
    await flush();
    expect(mount.container.textContent).toBe('');
  });

  it('shows both buttons for an active run, each at least 44 px and named', async () => {
    const factory = new IDBFactory();
    await seed(factory, 'run-1', 1);
    mount.render(<ResumeEntry deps={depsFor(factory)} onContinue={noop} onStartAgain={noop} />);
    await flush();
    const buttons = Array.from(mount.container.querySelectorAll('button'));
    expect(buttons.map((b) => b.textContent)).toEqual([CONTINUE_LABEL, START_AGAIN_LABEL]);
    expect(mount.container.querySelectorAll('button.resume-entry__button')).toHaveLength(2);
  });

  it('hands the restored run to onContinue', async () => {
    const factory = new IDBFactory();
    await seed(factory, 'run-1', 1);
    let restored: RestoredRun | null = null;
    mount.render(
      <ResumeEntry
        deps={depsFor(factory)}
        onContinue={(r) => {
          restored = r;
        }}
        onStartAgain={noop}
      />,
    );
    await flush();
    await clickButton(mount.container, CONTINUE_LABEL);
    await flush();
    expect((restored as RestoredRun | null)?.run.runId).toBe('run-1');
    expect((restored as RestoredRun | null)?.events).toHaveLength(4);
  });

  it('says the saved crypt could not be opened and offers only Start again', async () => {
    const factory = new IDBFactory();
    await seed(factory, 'run-1', 1);
    const deps: RestoreDeps = { ...depsFor(factory), buildSample: () => ({ ok: false, error: { kind: 'sample-unavailable' } as never }) };
    mount.render(<ResumeEntry deps={deps} onContinue={noop} onStartAgain={noop} />);
    await flush();
    const before = await loadEvents(factory, 'run-1');
    await clickButton(mount.container, CONTINUE_LABEL);
    await flush();
    expect(mount.container.textContent).toContain(RESTORE_FAILED_TEXT);
    expect(mount.container.textContent).toContain('could not be opened on this device');
    expect(mount.container.textContent).toContain('Start again opens the sample crypt');
    expect(Array.from(mount.container.querySelectorAll('button')).map((b) => b.textContent)).toEqual([
      START_AGAIN_LABEL,
    ]);
    expect(await loadEvents(factory, 'run-1')).toEqual(before);
    expect((await loadRun(factory, 'run-1')).ok && (await loadRun(factory, 'run-1'))).toMatchObject({
      value: { status: 'active' },
    });
  });

  it('says the notes are missing when a generated crypt has no notes on this device', async () => {
    const factory = new IDBFactory();
    await seed(factory, 'run-1', 1, 'generated');
    mount.render(<ResumeEntry deps={depsFor(factory)} onContinue={noop} onStartAgain={noop} />);
    await flush();
    await clickButton(mount.container, CONTINUE_LABEL);
    await flush();
    expect(mount.container.textContent).toContain(NOTES_MISSING_TEXT);
    expect(mount.container.textContent).toContain('missing from this device');
    expect(mount.container.querySelectorAll('button')).toHaveLength(1);
  });

  it('Start again marks the previous run left, keeps its events and starts a new run', async () => {
    const factory = new IDBFactory();
    await seed(factory, 'run-1', 1);
    const before = await loadEvents(factory, 'run-1');
    const started: unknown[] = [];
    mount.render(<ResumeEntry deps={depsFor(factory)} onContinue={noop} onStartAgain={(c) => started.push(c)} />);
    await flush();
    await clickButton(mount.container, START_AGAIN_LABEL);
    await flush();
    const run = await loadRun(factory, 'run-1');
    expect(run.ok && run.value.status).toBe('left');
    expect(await loadEvents(factory, 'run-1')).toEqual(before);
    expect(started).toEqual([null]);
  });
});
