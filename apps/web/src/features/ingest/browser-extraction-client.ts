import { createExtractionClient } from './extraction-client';
import type { ExtractionClient, WorkerLike } from './extraction-client';

/** The client wired to the real Extraction Worker, timers and clock. */
export function createBrowserExtractionClient(): ExtractionClient {
  return createExtractionClient({
    createWorker: () =>
      new Worker(new URL('./extraction-worker.ts', import.meta.url), {
        type: 'module',
      }) as unknown as WorkerLike,
    clock: { now: () => Date.now() },
    setTimer: (fn, ms) => globalThis.setTimeout(fn, ms),
    clearTimer: (handle) => globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>),
  });
}