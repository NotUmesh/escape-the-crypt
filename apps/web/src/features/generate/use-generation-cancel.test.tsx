import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeWorker } from '../../test-support/fake-worker-client';
import { useMount } from '../../test-support/flow-dom';
import { SAMPLE_BUNDLE } from '../../test-support/sample-bundle';
import { useGeneration } from './use-generation';
import type { Generation } from './use-generation';
import type { JobState, StartedJob, WorkerClient, WorkerResult } from './worker-client';

let current: Generation;
let keyCount = 0;
const newKey = (): string => `key-${(keyCount += 1)}`;

function Probe({ client }: { readonly client: WorkerClient }): null {
  current = useGeneration({ client, intervalMs: 2000, newKey, startRetries: 2 });
  return null;
}

async function tick(ms: number): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

/** A client whose POST stays pending until 
elease is called. */
function slowStart(): { client: WorkerClient; release: () => void; cancels: string[]; polls: string[] } {
  const cancels: string[] = [];
  const polls: string[] = [];
  let release: () => void = () => undefined;
  const client: WorkerClient = {
    startJob: () =>
      new Promise<WorkerResult<StartedJob>>((resolve) => {
        release = () => resolve({ ok: true, value: { jobId: 'job-1', status: 'queued' } });
      }),
    getJob: (jobId) => {
      polls.push(jobId);
      return Promise.resolve({ ok: true, value: { kind: 'running' } } as WorkerResult<JobState>);
    },
    cancelJob: (jobId) => {
      cancels.push(jobId);
    },
  };
  return { client, release: () => release(), cancels, polls };
}

describe('useGeneration: telling the worker to stop', () => {
  const mount = useMount();
  beforeEach(() => {
    vi.useFakeTimers();
    keyCount = 0;
  });
  afterEach(() => vi.useRealTimers());

  it('cancel during polling sends one DELETE and no further GET', async () => {
    const worker = fakeWorker([{ kind: 'running' }]);
    mount.render(<Probe client={worker.client} />);
    await act(async () => current.start('notes'));
    await tick(2000);
    expect(worker.polls).toHaveLength(1);
    act(() => current.cancel());
    expect(worker.cancels).toEqual(['job-1']);
    await tick(60_000);
    expect(worker.polls).toHaveLength(1);
    expect(worker.cancels).toEqual(['job-1']);
  });

  it('cancel twice sends one DELETE', async () => {
    const worker = fakeWorker([{ kind: 'running' }]);
    mount.render(<Probe client={worker.client} />);
    await act(async () => current.start('notes'));
    act(() => current.cancel());
    act(() => current.cancel());
    expect(worker.cancels).toEqual(['job-1']);
  });

  it('cancel before the job ID is known sends nothing until the POST returns, then one DELETE and no polling', async () => {
    const slow = slowStart();
    mount.render(<Probe client={slow.client} />);
    await act(async () => current.start('notes'));
    act(() => current.cancel());
    expect(current.state).toEqual({ status: 'cancelled' });
    expect(slow.cancels).toEqual([]);
    await act(async () => {
      slow.release();
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(slow.cancels).toEqual(['job-1']);
    await tick(60_000);
    expect(slow.polls).toEqual([]);
    expect(slow.cancels).toEqual(['job-1']);
  });

  it('unmount during an active job sends one DELETE', async () => {
    const worker = fakeWorker([{ kind: 'running' }]);
    mount.render(<Probe client={worker.client} />);
    await act(async () => current.start('notes'));
    await tick(2000);
    mount.render(null);
    expect(worker.cancels).toEqual(['job-1']);
    await tick(10_000);
    expect(worker.polls).toHaveLength(1);
    expect(worker.cancels).toEqual(['job-1']);
  });

  it('pagehide during an active job sends one DELETE, even when repeated and before unmount', async () => {
    const worker = fakeWorker([{ kind: 'running' }]);
    mount.render(<Probe client={worker.client} />);
    await act(async () => current.start('notes'));
    window.dispatchEvent(new Event('pagehide'));
    window.dispatchEvent(new Event('pagehide'));
    expect(worker.cancels).toEqual(['job-1']);
    mount.render(null);
    expect(worker.cancels).toEqual(['job-1']);
  });

  it('pagehide before any job ID sends nothing', async () => {
    const slow = slowStart();
    mount.render(<Probe client={slow.client} />);
    await act(async () => current.start('notes'));
    window.dispatchEvent(new Event('pagehide'));
    expect(slow.cancels).toEqual([]);
  });

  it('removes the pagehide listener on unmount', async () => {
    const worker = fakeWorker([{ kind: 'running' }]);
    mount.render(<Probe client={worker.client} />);
    mount.render(null);
    window.dispatchEvent(new Event('pagehide'));
    expect(worker.cancels).toEqual([]);
  });

  const ENDS: ReadonlyArray<readonly [string, JobState]> = [
    ['completed', { kind: 'completed', bundle: SAMPLE_BUNDLE }],
    ['failed', { kind: 'failed', failure: 'generation-failed' }],
    ['expired', { kind: 'expired' }],
    ['cancelled by the worker', { kind: 'cancelled' }],
  ];
  for (const [name, end] of ENDS) {
    it(`sends no DELETE after the job ${name}, on cancel, pagehide or unmount`, async () => {
      const worker = fakeWorker([end]);
      mount.render(<Probe client={worker.client} />);
      await act(async () => current.start('notes'));
      await tick(2000);
      act(() => current.cancel());
      window.dispatchEvent(new Event('pagehide'));
      mount.render(null);
      expect(worker.cancels).toEqual([]);
    });
  }
});
