import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { IDBFactory, IDBKeyRange as FakeIDBKeyRange } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildHumanHeartSampleCrypt } from '@escape-the-crypt/core';
import type { HumanHeartQuestionsFile, Outcome_Notice } from '@escape-the-crypt/core';
import type { StorageResult } from './storage/storage-error';

type AppendResult = StorageResult<{ seq: number }>;

// The writer's append goes through the repository's appendEvent; the gate below lets a test settle
// each append by hand. Everything else in the repository stays real (fake-indexeddb).
const gate = vi.hoisted(() => ({
  pending: [] as Array<(result: AppendResult) => void>,
}));

vi.mock('./storage/run-repository', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./storage/run-repository')>();
  return {
    ...actual,
    appendEvent: (): Promise<AppendResult> =>
      new Promise<AppendResult>((resolve) => {
        gate.pending.push(resolve);
      }),
  };
});

import { usePersistedRoom } from './persisted-room';
import type { PersistedRoomOptions } from './persisted-room';
import type { BuildCrypt, RoomBinding } from './room-binding';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const SAMPLES = join(process.cwd(), '..', '..', 'samples');
const notes = readFileSync(join(SAMPLES, 'human-heart.txt'), 'utf8');
const file = JSON.parse(
  readFileSync(join(SAMPLES, 'questions', 'human-heart.json'), 'utf8'),
) as HumanHeartQuestionsFile;
const built = buildHumanHeartSampleCrypt(notes, file);
if (!built.ok) throw new Error(`sample crypt failed: ${built.error.kind}`);
const okBuild: BuildCrypt = () => ({ ok: true, value: built.value });

let root: Root;
let current: RoomBinding;

function Probe(props: { readonly options: PersistedRoomOptions }): null {
  current = usePersistedRoom(okBuild, props.options);
  return null;
}

async function startAndWaitForFirstAppend(options: PersistedRoomOptions): Promise<void> {
  act(() => {
    root.render(createElement(Probe, { options }));
  });
  await act(async () => {
    current.dispatch({ type: 'startRun' });
  });
  // The first append is only called once the crypt and the run are stored.
  await vi.waitFor(() => expect(gate.pending.length).toBe(1));
}

async function settleNext(result: AppendResult): Promise<void> {
  const resolve = gate.pending.shift();
  if (resolve === undefined) throw new Error('no append is waiting');
  await act(async () => {
    resolve(result);
    await Promise.resolve();
  });
}

beforeEach(() => {
  vi.stubGlobal('IDBKeyRange', FakeIDBKeyRange);
  gate.pending.length = 0;
  root = createRoot(document.createElement('div'));
});
afterEach(() => {
  act(() => root.unmount());
  vi.unstubAllGlobals();
});

// Feature: persistence, Property 14: Notices never precede a settled write, and state never waits for one
describe('usePersistedRoom notice animation', () => {
  it('calls animate only after the append settles, and shows state without waiting', async () => {
    // **Validates: Requirements 6.1, 6.2, 6.5, 7.3**
    const animate = vi.fn<(notices: readonly Outcome_Notice[]) => void>();
    await startAndWaitForFirstAppend({
      factory: new IDBFactory(),
      newRunId: () => 'run-1',
      animate,
    });

    // Append unresolved: state is already the reducer's, the notices are held, animate is silent.
    expect(current.state).not.toBeNull();
    expect(current.eventLog).toHaveLength(4);
    expect(current.notices).toEqual([]);
    expect(animate).not.toHaveBeenCalled();

    await settleNext({ ok: true, value: { seq: 1 } });
    expect(animate).toHaveBeenCalledTimes(1);

    // One call per accepted Event, each after its own append.
    for (const seq of [2, 3, 4]) {
      await vi.waitFor(() => expect(gate.pending.length).toBe(1));
      expect(animate.mock.calls.length).toBe(seq - 1);
      await settleNext({ ok: true, value: { seq } });
      expect(animate).toHaveBeenCalledTimes(seq);
    }
  });

  it('releases the notices when the append fails, and the state is unchanged', async () => {
    // **Validates: Requirements 6.1, 6.5, 7.3**
    const animate = vi.fn<(notices: readonly Outcome_Notice[]) => void>();
    await startAndWaitForFirstAppend({
      factory: new IDBFactory(),
      newRunId: () => 'run-2',
      animate,
    });
    const stateBefore = current.state;
    expect(animate).not.toHaveBeenCalled();

    await settleNext({ ok: false, error: { kind: 'write-failed' } } as AppendResult);

    // The failed append releases its notices; the three later Events settle as skipped behind it.
    await vi.waitFor(() => expect(animate).toHaveBeenCalledTimes(4));
    expect(gate.pending).toHaveLength(0);
    expect(current.saveFailed).toBe(true);
    expect(current.state).toEqual(stateBefore);
  });
});
