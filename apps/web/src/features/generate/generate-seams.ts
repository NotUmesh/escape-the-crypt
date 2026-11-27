import { readOrCreateSessionToken } from './session-token';
import { createWorkerClient } from './worker-client';
import type { WorkerClient } from './worker-client';
import { workerOrigin } from './worker-config';

/** Test seams for "Generate from my notes". Production passes none. */
export interface GenerateSeams {
  /** Overrides the build-time worker origin. `null` hides the button. */
  readonly origin?: string | null;
  readonly client?: WorkerClient;
  readonly intervalMs?: number;
  readonly maxPolls?: number;
  readonly newKey?: () => string;
}

const REQUEST_TIMEOUT_MS = 15_000;

/** Answers every call with a network error. Used only while the button is hidden. */
const INERT_CLIENT: WorkerClient = {
  startJob: () => Promise.resolve({ ok: false, error: { kind: 'network' } }),
  getJob: () => Promise.resolve({ ok: false, error: { kind: 'network' } }),
  cancelJob: () => undefined,
};

export function resolveOrigin(seams: GenerateSeams | undefined): string | null {
  return seams?.origin !== undefined ? seams.origin : workerOrigin();
}

export function resolveClient(seams: GenerateSeams | undefined, origin: string | null): WorkerClient {
  if (seams?.client !== undefined) return seams.client;
  if (origin === null) return INERT_CLIENT;
  return createWorkerClient({
    origin,
    fetchImpl: (input, init) => globalThis.fetch(input, init),
    sessionToken: readOrCreateSessionToken(),
    timeoutMs: REQUEST_TIMEOUT_MS,
  });
}
