import { MAX_EXTRACTION_MS, capPageSelection, checkElapsed, checkFileSize } from '@escape-the-crypt/core';
import type { LimitError, Result } from '@escape-the-crypt/core';
import type { Clock, ExtractionMessageIn, ExtractionMessageOut } from './extraction-core';
import { EXTRACTION_MODE } from './extraction-mode';

/** The slice of `Worker` the client uses, so tests can pass a mock. */
export interface WorkerLike {
  postMessage(message: ExtractionMessageIn, transfer: Transferable[]): void;
  terminate(): void;
  onmessage: ((event: { data: ExtractionMessageOut }) => void) | null;
  onerror: ((event: unknown) => void) | null;
}

export interface ExtractionClientDeps {
  readonly createWorker: () => WorkerLike;
  readonly clock: Clock;
  readonly setTimer: (fn: () => void, ms: number) => unknown;
  readonly clearTimer: (handle: unknown) => void;
}

export interface ExtractionRequest {
  readonly file: { readonly size: number; arrayBuffer(): Promise<ArrayBuffer> };
  /** 0-based page indexes, chosen before extraction begins. */
  readonly pageIndexes: readonly number[];
  readonly onMessage: (message: ExtractionMessageOut) => void;
}

export interface ExtractionClient {
  /** Fails with a file-size error before any worker exists. */
  start(request: ExtractionRequest): Promise<Result<true, LimitError>>;
  /** Ends the run without a message. */
  cancel(): void;
  terminate(): void;
}

export function createExtractionClient(deps: ExtractionClientDeps): ExtractionClient {
  if (EXTRACTION_MODE === 'main-thread') {
    throw new Error('Extraction mode main-thread is not implemented yet; use nested-worker or in-thread.');
  }
  let worker: WorkerLike | null = null;
  let timer: unknown = null;
  // Incremented by start, cancel and terminate; a start whose token changed while
  // it awaited the file buffer must not create a worker.
  let token = 0;

  // Ends the run: stops the timer, terminates the worker (which also ends the
  // nested pdf.js worker) and drops the references.
  const end = (): void => {
    if (timer !== null) deps.clearTimer(timer);
    timer = null;
    const current = worker;
    worker = null;
    if (current) {
      current.onmessage = null;
      current.onerror = null;
      current.terminate();
    }
  };

  return {
    async start({ file, pageIndexes, onMessage }) {
      const size = checkFileSize(file.size);
      if (!size.ok) return size;
      end();
      token += 1;
      const mine = token;
      const fileBuffer = await file.arrayBuffer();
      if (token !== mine) return { ok: true, value: true };
      const { kept } = capPageSelection(pageIndexes);
      const startedAtMs = deps.clock.now();
      const w = deps.createWorker();
      worker = w;
      const finish = (message: ExtractionMessageOut): void => {
        if (worker !== w) return;
        end();
        onMessage(message);
      };
      // Wall-clock timeout; the injected clock below is the second guard.
      timer = deps.setTimer(
        () => finish({ type: 'error', error: { kind: 'time', limitMs: MAX_EXTRACTION_MS } }),
        MAX_EXTRACTION_MS,
      );
      w.onmessage = (event) => {
        if (worker !== w) return;
        const message = event.data;
        const elapsed = checkElapsed(startedAtMs, deps.clock.now());
        if (!elapsed.ok) return finish({ type: 'error', error: elapsed.error });
        if (message.type === 'error' || message.type === 'done') return finish(message);
        onMessage(message);
      };
      w.onerror = () => finish({ type: 'error', error: { kind: 'unreadable' } });
      // The page choice travels inside `start`; the buffer is transferred, not copied.
      w.postMessage({ type: 'start', fileBuffer, pageIndexes: kept, startedAtMs }, [fileBuffer]);
      return { ok: true, value: true };
    },
    cancel() {
      token += 1;
      end();
    },
    terminate() {
      token += 1;
      end();
    },
  };
}
