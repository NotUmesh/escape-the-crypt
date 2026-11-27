import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeWorker } from '../../test-support/fake-worker-client';
import { useMount } from '../../test-support/flow-dom';
import { SAMPLE_BUNDLE, SAMPLE_NOTES_TEXT } from '../../test-support/sample-bundle';
import { useGeneration } from './use-generation';
import type { Generation } from './use-generation';
import type { WorkerClient } from './worker-client';

let current: Generation;
let keyCount = 0;
const newKey = (): string => `key-${(keyCount += 1)}`;

function Probe({ client, maxPolls }: { readonly client: WorkerClient; readonly maxPolls?: number }): null {
  current = useGeneration({ client, intervalMs: 2000, maxPolls, newKey, startRetries: 2 });
  return null;
}

/** Lets pending promises settle, then moves fake time forward. */
async function tick(ms: number): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

describe('useGeneration', () => {
  const mount = useMount();
  beforeEach(() => {
    vi.useFakeTimers();
    keyCount = 0;
  });
  afterEach(() => vi.useRealTimers());

  it('polls every 2 seconds until the job completes, then is ready', async () => {
    const worker = fakeWorker([{ kind: 'queued' }, { kind: 'running' }, { kind: 'completed', bundle: SAMPLE_BUNDLE }]);
    mount.render(<Probe client={worker.client} />);
    await act(async () => current.start(SAMPLE_NOTES_TEXT));
    expect(current.state.status).toBe('polling');
    expect(worker.polls).toHaveLength(0);
    await tick(2000);
    expect(worker.polls).toHaveLength(1);
    await tick(2000);
    expect(worker.polls).toHaveLength(2);
    expect(current.state.status).toBe('polling');
    await tick(2000);
    expect(current.state.status).toBe('ready');
    expect(current.crypt()?.source).toBe('notes');
    await tick(10_000);
    expect(worker.polls).toHaveLength(3);
  });

  it('sends the notes text it was given', async () => {
    const worker = fakeWorker([{ kind: 'queued' }]);
    mount.render(<Probe client={worker.client} />);
    await act(async () => current.start('some notes'));
    expect(worker.startTexts).toEqual(['some notes']);
  });

  it('treats reaching the attempt cap as generation-failed and stops polling', async () => {
    const worker = fakeWorker([{ kind: 'running' }]);
    mount.render(<Probe client={worker.client} maxPolls={3} />);
    await act(async () => current.start('notes'));
    await tick(2000 * 3);
    expect(worker.polls).toHaveLength(3);
    expect(current.state).toEqual({ status: 'failed', kind: 'generation-failed' });
    await tick(20_000);
    expect(worker.polls).toHaveLength(3);
  });

  it('cancel stops polling, drops the job and sends no further request', async () => {
    const worker = fakeWorker([{ kind: 'running' }]);
    mount.render(<Probe client={worker.client} />);
    await act(async () => current.start('notes'));
    await tick(2000);
    expect(worker.polls).toHaveLength(1);
    act(() => current.cancel());
    expect(current.state).toEqual({ status: 'cancelled' });
    await tick(60_000);
    expect(worker.polls).toHaveLength(1);
    expect(worker.startKeys).toHaveLength(1);
  });

  it('cancel while the first request is in flight ignores its answer', async () => {
    const worker = fakeWorker([{ kind: 'running' }]);
    mount.render(<Probe client={worker.client} />);
    act(() => {
      current.start('notes');
      current.cancel();
    });
    await tick(60_000);
    expect(current.state.status).toBe('cancelled');
    expect(worker.polls).toHaveLength(0);
  });

  it('reuses the same key when the first request is retried after a network or timeout error', async () => {
    const worker = fakeWorker([{ kind: 'running' }], [{ kind: 'network' }, { kind: 'timeout' }, 'ok']);
    mount.render(<Probe client={worker.client} />);
    await act(async () => current.start('notes'));
    await tick(2000);
    await tick(2000);
    expect(worker.startKeys).toEqual(['key-1', 'key-1', 'key-1']);
    expect(current.state.status).toBe('polling');
  });

  it('gives up after the retry limit and fails', async () => {
    const worker = fakeWorker([{ kind: 'running' }], [{ kind: 'network' }]);
    mount.render(<Probe client={worker.client} />);
    await act(async () => current.start('notes'));
    await tick(2000);
    await tick(2000);
    expect(worker.startKeys).toHaveLength(3);
    expect(current.state).toEqual({ status: 'failed', kind: 'generation-failed' });
  });

  it('does not retry a rejected request', async () => {
    const worker = fakeWorker([{ kind: 'running' }], [{ kind: 'rejected', status: 400 }]);
    mount.render(<Probe client={worker.client} />);
    await act(async () => current.start('notes'));
    expect(worker.startKeys).toHaveLength(1);
    expect(current.state).toEqual({ status: 'failed', kind: 'generation-failed' });
  });

  it('makes a new key for each new press', async () => {
    const worker = fakeWorker([{ kind: 'failed', failure: 'budget-exhausted' }]);
    mount.render(<Probe client={worker.client} />);
    await act(async () => current.start('notes'));
    await tick(2000);
    expect(current.state).toEqual({ status: 'failed', kind: 'budget-exhausted' });
    await act(async () => current.start('notes'));
    expect(worker.startKeys).toEqual(['key-1', 'key-2']);
  });

  it('ignores a second press while a job runs', async () => {
    const worker = fakeWorker([{ kind: 'running' }]);
    mount.render(<Probe client={worker.client} />);
    await act(async () => current.start('notes'));
    await act(async () => current.start('notes'));
    expect(worker.startKeys).toHaveLength(1);
  });

  it('fails when the bundle cites chunks the sent text does not have', async () => {
    const worker = fakeWorker([{ kind: 'completed', bundle: SAMPLE_BUNDLE }]);
    mount.render(<Probe client={worker.client} />);
    await act(async () => current.start('Other notes here.\n\nAnd a second paragraph of them.'));
    await tick(2000);
    expect(current.state).toEqual({ status: 'failed', kind: 'generation-failed' });
  });

  it('maps a poll error to generation-failed', async () => {
    const worker = fakeWorker([{ kind: 'not-found' }]);
    mount.render(<Probe client={worker.client} />);
    await act(async () => current.start('notes'));
    await tick(2000);
    expect(current.state).toEqual({ status: 'failed', kind: 'generation-failed' });
  });

  it('stops polling when the component unmounts', async () => {
    const worker = fakeWorker([{ kind: 'running' }]);
    mount.render(<Probe client={worker.client} />);
    await act(async () => current.start('notes'));
    mount.render(null);
    await tick(20_000);
    expect(worker.polls).toHaveLength(0);
  });
  describe('poll errors', () => {
    const NET = { kind: 'network' } as const;
    const TIMEOUT = { kind: 'timeout' } as const;
    const DONE = { kind: 'completed', bundle: SAMPLE_BUNDLE } as const;
    it('keeps polling through 3 consecutive network errors, then completes', async () => {
      const worker = fakeWorker([NET, NET, NET, DONE]);
      mount.render(<Probe client={worker.client} />);
      await act(async () => current.start(SAMPLE_NOTES_TEXT));
      await tick(2000 * 3);
      expect(current.state.status).toBe('polling');
      await tick(2000);
      expect(current.state.status).toBe('ready');
    });
    it('resets the count on any successful poll', async () => {
      const worker = fakeWorker([NET, NET, { kind: 'running' }, NET, NET, NET, { kind: 'running' }]);
      mount.render(<Probe client={worker.client} />);
      await act(async () => current.start('notes'));
      await tick(2000 * 6);
      expect(worker.polls).toHaveLength(6);
      expect(current.state.status).toBe('polling');
    });
    it('fails as generation-failed on the 4th consecutive network or timeout error', async () => {
      const worker = fakeWorker([NET, TIMEOUT, NET, TIMEOUT, DONE]);
      mount.render(<Probe client={worker.client} />);
      await act(async () => current.start('notes'));
      await tick(2000 * 3);
      expect(current.state.status).toBe('polling');
      await tick(2000);
      expect(current.state).toEqual({ status: 'failed', kind: 'generation-failed' });
      await tick(20_000);
      expect(worker.polls).toHaveLength(4);
    });
    it('fails at once on not-found', async () => {
      const worker = fakeWorker([{ kind: 'not-found' }, DONE]);
      mount.render(<Probe client={worker.client} />);
      await act(async () => current.start('notes'));
      await tick(2000);
      expect(current.state).toEqual({ status: 'failed', kind: 'generation-failed' });
      expect(worker.polls).toHaveLength(1);
    });
    it('counts a tolerated error toward the poll cap', async () => {
      const worker = fakeWorker([NET, { kind: 'running' }, NET]);
      mount.render(<Probe client={worker.client} maxPolls={3} />);
      await act(async () => current.start('notes'));
      await tick(2000 * 3);
      expect(worker.polls).toHaveLength(3);
      expect(current.state).toEqual({ status: 'failed', kind: 'generation-failed' });
    });
  });
  it('fails with the judge message when the worker refuses the code, and does not retry', async () => {
    let starts = 0;
    const client: WorkerClient = {
      startJob: () => {
        starts += 1;
        return Promise.resolve({ ok: false, error: { kind: 'judge-denied' } });
      },
      getJob: () => Promise.resolve({ ok: false, error: { kind: 'network' } }),
      cancelJob: () => undefined,
    };
    mount.render(<Probe client={client} />);
    await act(async () => current.start(SAMPLE_NOTES_TEXT));
    await tick(10_000);
    expect(current.state).toEqual({ status: 'failed', kind: 'judge-access-denied' });
    expect(starts).toBe(1);
  });
});
