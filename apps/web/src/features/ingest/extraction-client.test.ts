import { afterEach, describe, expect, it, vi } from 'vitest';
import { MAX_SELECTED_PAGES } from '@escape-the-crypt/core';
import { createExtractionClient } from './extraction-client';
import type { WorkerLike } from './extraction-client';

function makeWorker() {
  const postMessage = vi.fn<WorkerLike['postMessage']>();
  const terminate = vi.fn<WorkerLike['terminate']>();
  const worker: WorkerLike = { postMessage, terminate, onmessage: null, onerror: null };
  return { worker, postMessage };
}

function makeDeps(createWorker: () => WorkerLike) {
  return {
    createWorker,
    clock: { now: () => 0 },
    setTimer: () => 1,
    clearTimer: () => undefined,
  };
}

afterEach(() => {
  vi.doUnmock('./extraction-mode');
  vi.resetModules();
});

describe('extraction client', () => {
  it('does not create a worker when cancelled while the file is being read', async () => {
    const createWorker = vi.fn((): WorkerLike => makeWorker().worker);
    const client = createExtractionClient(makeDeps(createWorker));
    let release: (b: ArrayBuffer) => void = () => undefined;
    const buffer = new Promise<ArrayBuffer>((resolve) => {
      release = resolve;
    });
    const started = client.start({
      file: { size: 10, arrayBuffer: () => buffer },
      pageIndexes: [0],
      onMessage: () => undefined,
    });
    client.cancel();
    release(new ArrayBuffer(10));
    await started;
    expect(createWorker).not.toHaveBeenCalled();
  });

  it('does not create a worker when terminated while the file is being read', async () => {
    const createWorker = vi.fn((): WorkerLike => makeWorker().worker);
    const client = createExtractionClient(makeDeps(createWorker));
    let release: (b: ArrayBuffer) => void = () => undefined;
    const buffer = new Promise<ArrayBuffer>((resolve) => {
      release = resolve;
    });
    const started = client.start({
      file: { size: 10, arrayBuffer: () => buffer },
      pageIndexes: [0],
      onMessage: () => undefined,
    });
    client.terminate();
    release(new ArrayBuffer(10));
    await started;
    expect(createWorker).not.toHaveBeenCalled();
  });

  it('sends only the first MAX_SELECTED_PAGES page indexes', async () => {
    const { worker, postMessage } = makeWorker();
    const client = createExtractionClient(makeDeps(() => worker));
    const many = Array.from({ length: MAX_SELECTED_PAGES + 3 }, (_, i) => i);
    await client.start({
      file: { size: 10, arrayBuffer: async () => new ArrayBuffer(10) },
      pageIndexes: many,
      onMessage: () => undefined,
    });
    const sent = postMessage.mock.calls[0]?.[0] as { type: string; pageIndexes: number[] };
    expect(sent.type).toBe('start');
    expect(sent.pageIndexes).toEqual(many.slice(0, MAX_SELECTED_PAGES));
  });

  it('throws a clear error in main-thread mode', async () => {
    vi.resetModules();
    vi.doMock('./extraction-mode', () => ({ EXTRACTION_MODE: 'main-thread' }));
    const mod = await import('./extraction-client');
    expect(() => mod.createExtractionClient(makeDeps(() => makeWorker().worker))).toThrow(/not implemented/);
  });
});