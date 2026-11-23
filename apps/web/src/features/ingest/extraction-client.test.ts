import { afterEach, describe, expect, it, vi } from 'vitest';
import { MAX_EXTRACTION_MS, MAX_SELECTED_PAGES } from '@escape-the-crypt/core';
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

  it('transfers the file buffer to the worker instead of copying it', async () => {
    const { worker, postMessage } = makeWorker();
    const client = createExtractionClient(makeDeps(() => worker));
    const buffer = new ArrayBuffer(10);
    await client.start({
      file: { size: 10, arrayBuffer: async () => buffer },
      pageIndexes: [0],
      onMessage: () => undefined,
    });
    const [message, transfer] = postMessage.mock.calls[0] ?? [];
    expect((message as { fileBuffer: ArrayBuffer }).fileBuffer).toBe(buffer);
    expect(transfer).toEqual([buffer]);
  });

  it('ends the run with a time error when a message arrives after the clock passes the limit', async () => {
    const terminate = vi.fn();
    const worker: WorkerLike = { postMessage: vi.fn(), terminate, onmessage: null, onerror: null };
    let nowMs = 0;
    const client = createExtractionClient({
      createWorker: () => worker,
      clock: { now: () => nowMs },
      setTimer: () => 1,
      clearTimer: () => undefined,
    });
    const received: unknown[] = [];
    await client.start({
      file: { size: 10, arrayBuffer: async () => new ArrayBuffer(10) },
      pageIndexes: [0],
      onMessage: (m) => received.push(m),
    });
    nowMs = MAX_EXTRACTION_MS + 1;
    worker.onmessage?.({ data: { type: 'done' } });
    expect(received).toEqual([{ type: 'error', error: { kind: 'time', limitMs: MAX_EXTRACTION_MS } }]);
    expect(terminate).toHaveBeenCalledTimes(1);
  });});
