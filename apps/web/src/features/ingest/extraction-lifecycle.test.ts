import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { MAX_EXTRACTION_MS } from '@escape-the-crypt/core';
import { mapPdfError } from './extraction-core';
import type { ExtractionMessageIn, ExtractionMessageOut } from './extraction-core';
import { createExtractionClient } from './extraction-client';
import type { WorkerLike } from './extraction-client';

type PdfJs = typeof import('pdfjs-dist');

async function openEncryptedFixture(): Promise<unknown> {
  // The legacy build runs in Node; no Worker exists, so pdf.js uses its fake worker.
  const pdfjs = (await import('pdfjs-dist/legacy/build/pdf.mjs')) as unknown as PdfJs;
  const bytes = await readFile(join(import.meta.dirname, 'fixtures', 'encrypted.pdf'));
  const task = pdfjs.getDocument({
    data: new Uint8Array(bytes),
    useWorkerFetch: false,
    useSystemFonts: false,
  });
  try {
    await task.promise;
    return null;
  } catch (err) {
    return err;
  } finally {
    await task.destroy();
  }
}

interface Harness {
  readonly worker: WorkerLike;
  readonly calls: string[];
  readonly sent: ExtractionMessageIn[];
  readonly terminate: ReturnType<typeof vi.fn>;
  readonly received: ExtractionMessageOut[];
  readonly timers: Array<() => void>;
  readonly client: ReturnType<typeof createExtractionClient>;
  readonly clearTimer: ReturnType<typeof vi.fn>;
  readonly begin: (pageIndexes?: readonly number[]) => Promise<void>;
}

function makeHarness(): Harness {
  const calls: string[] = [];
  const sent: ExtractionMessageIn[] = [];
  const received: ExtractionMessageOut[] = [];
  const timers: Array<() => void> = [];
  const terminate = vi.fn(() => {
    calls.push('terminate');
  });
  const worker: WorkerLike = {
    postMessage: (message) => {
      calls.push(message.type);
      sent.push(message);
    },
    terminate,
    onmessage: null,
    onerror: null,
  };
  const clearTimer = vi.fn();
  const client = createExtractionClient({
    createWorker: () => {
      calls.push('create');
      return worker;
    },
    clock: { now: () => 0 },
    setTimer: (fn) => {
      timers.push(fn);
      return timers.length;
    },
    clearTimer,
  });
  const begin = async (pageIndexes: readonly number[] = [2, 0]): Promise<void> => {
    await client.start({
      file: { size: 10, arrayBuffer: () => Promise.resolve(new ArrayBuffer(10)) },
      pageIndexes,
      onMessage: (m) => received.push(m),
    });
  };
  return { worker, calls, sent, terminate, received, timers, client, clearTimer, begin };
}

describe('encrypted PDF', () => {
  it('opens with a PasswordException that maps to the encrypted error', async () => {
    const err = await openEncryptedFixture();
    expect(err).not.toBeNull();
    expect(mapPdfError(err)).toEqual({ kind: 'encrypted' });
  });

  it('terminates the worker when the worker reports the encrypted error', async () => {
    const h = makeHarness();
    await h.begin();
    const error = mapPdfError(await openEncryptedFixture());
    const handler = h.worker.onmessage;
    expect(handler).not.toBeNull();
    handler?.({ data: { type: 'error', error } });
    expect(h.received).toEqual([{ type: 'error', error: { kind: 'encrypted' } }]);
    expect(h.terminate).toHaveBeenCalledTimes(1);
    expect(h.worker.onmessage).toBeNull();
  });
});

describe('worker lifecycle (mocked worker)', () => {
  it('sends the page choice inside start, as the first message after the worker exists', async () => {
    const h = makeHarness();
    await h.begin([2, 0]);
    expect(h.calls).toEqual(['create', 'start']);
    expect(h.sent).toHaveLength(1);
    expect(h.sent[0]).toMatchObject({ type: 'start', pageIndexes: [2, 0] });
  });

  it('terminates the worker and clears the timer on Stop', async () => {
    const h = makeHarness();
    await h.begin();
    h.client.cancel();
    expect(h.terminate).toHaveBeenCalledTimes(1);
    expect(h.clearTimer).toHaveBeenCalledTimes(1);
    expect(h.worker.onmessage).toBeNull();
    expect(h.received).toEqual([]);
  });

  it('terminates the worker and reports a time error when the timer fires', async () => {
    const h = makeHarness();
    await h.begin();
    expect(h.timers).toHaveLength(1);
    h.timers[0]?.();
    expect(h.terminate).toHaveBeenCalledTimes(1);
    expect(h.received).toEqual([{ type: 'error', error: { kind: 'time', limitMs: MAX_EXTRACTION_MS } }]);
  });

  it('terminates the worker and reports unreadable when the worker errors', async () => {
    const h = makeHarness();
    await h.begin();
    h.worker.onerror?.(new Error('boom'));
    expect(h.terminate).toHaveBeenCalledTimes(1);
    expect(h.received).toEqual([{ type: 'error', error: { kind: 'unreadable' } }]);
  });

  it('ignores a late timer after the run has ended', async () => {
    const h = makeHarness();
    await h.begin();
    h.client.cancel();
    h.timers[0]?.();
    expect(h.terminate).toHaveBeenCalledTimes(1);
    expect(h.received).toEqual([]);
  });

  it('terminates the first worker when start is called during an active run and ignores its later messages', async () => {
    const first = makeHarness();
    const secondTerminate = vi.fn();
    const secondWorker: WorkerLike = {
      postMessage: () => undefined,
      terminate: secondTerminate,
      onmessage: null,
      onerror: null,
    };
    const workers = [first.worker, secondWorker];
    const received: ExtractionMessageOut[] = [];
    const client = createExtractionClient({
      createWorker: () => workers.shift() as WorkerLike,
      clock: { now: () => 0 },
      setTimer: () => 1,
      clearTimer: () => undefined,
    });
    const request = {
      file: { size: 10, arrayBuffer: () => Promise.resolve(new ArrayBuffer(10)) },
      pageIndexes: [0],
      onMessage: (m: ExtractionMessageOut) => received.push(m),
    };
    await client.start(request);
    const staleOnMessage = first.worker.onmessage;
    const staleOnError = first.worker.onerror;
    await client.start(request);
    expect(first.terminate).toHaveBeenCalledTimes(1);
    expect(secondTerminate).not.toHaveBeenCalled();
    staleOnMessage?.({ data: { type: 'done' } });
    staleOnError?.(new Error('late'));
    expect(received).toEqual([]);
    expect(secondTerminate).not.toHaveBeenCalled();
  });});
