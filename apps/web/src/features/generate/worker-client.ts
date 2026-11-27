import { parseCryptBundle, z } from '@escape-the-crypt/core';
import type { CryptBundle, GenerationFailureKind, Result } from '@escape-the-crypt/core';

/** Worker job states the client hands back. No response body ever travels in an error. */
export type JobState =
  | { readonly kind: 'queued' }
  | { readonly kind: 'running' }
  | { readonly kind: 'completed'; readonly bundle: CryptBundle }
  | { readonly kind: 'failed'; readonly failure: GenerationFailureKind }
  | { readonly kind: 'cancelled' }
  | { readonly kind: 'expired' };

export type WorkerStatusName = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled' | 'expired';

export type InvalidResponseReason =
  | 'not-json'
  | 'schema'
  | 'unknown-failure'
  | 'bundle';

/** Kinds and status codes only. */
export type WorkerError =
  | { readonly kind: 'network' }
  | { readonly kind: 'timeout' }
  | { readonly kind: 'not-found' }
  | { readonly kind: 'rejected'; readonly status: number }
  | {
      readonly kind: 'invalid-response';
      readonly reason: InvalidResponseReason;
      /** The `CryptBundleError` kind when `reason` is `bundle`. */
      readonly bundleErrorKind?: string;
    };

export type WorkerResult<T> = Result<T, WorkerError>;

export interface StartedJob {
  readonly jobId: string;
  readonly status: WorkerStatusName;
}

export interface WorkerClient {
  startJob(notesText: string, idempotencyKey: string): Promise<WorkerResult<StartedJob>>;
  getJob(jobId: string): Promise<WorkerResult<JobState>>;
  /** Fire-and-forget DELETE /jobs/:id. Survives page unload. Never throws; the outcome is ignored. */
  cancelJob(jobId: string): void;
}

export interface WorkerClientOptions {
  /** A normalised `https://host[:port]` origin (see worker-config). */
  readonly origin: string;
  readonly fetchImpl: typeof fetch;
  readonly sessionToken: string;
  readonly timeoutMs: number;
}

const STATUS_NAMES = ['queued', 'running', 'completed', 'failed', 'cancelled', 'expired'] as const;
const StatusSchema = z.enum(STATUS_NAMES);

const StartResponseSchema = z.object({ jobId: z.string().min(1), status: StatusSchema });

const GetResponseSchema = z.object({
  status: StatusSchema,
  failure: z.string().optional(),
  manifest: z.unknown().optional(),
  content: z.unknown().optional(),
});

const KNOWN_FAILURES: readonly GenerationFailureKind[] = [
  'expired',
  'budget-exhausted',
  'not-enough-material',
  'generation-failed',
];

function invalid(reason: InvalidResponseReason, bundleErrorKind?: string): WorkerError {
  return bundleErrorKind === undefined
    ? { kind: 'invalid-response', reason }
    : { kind: 'invalid-response', reason, bundleErrorKind };
}

function fail<T>(error: WorkerError): WorkerResult<T> {
  return { ok: false, error };
}

function toJobState(body: z.infer<typeof GetResponseSchema>): WorkerResult<JobState> {
  switch (body.status) {
    case 'queued':
    case 'running':
    case 'cancelled':
    case 'expired':
      return { ok: true, value: { kind: body.status } };
    case 'failed': {
      if (body.failure === undefined) return fail(invalid('schema'));
      if (body.failure === 'cancelled') return { ok: true, value: { kind: 'cancelled' } };
      const known = KNOWN_FAILURES.find((kind) => kind === body.failure);
      if (known === undefined) return fail(invalid('unknown-failure'));
      return { ok: true, value: { kind: 'failed', failure: known } };
    }
    case 'completed': {
      const parsed = parseCryptBundle({ manifest: body.manifest, content: body.content });
      if (!parsed.ok) return fail(invalid('bundle', parsed.error.kind));
      return { ok: true, value: { kind: 'completed', bundle: parsed.value } };
    }
  }
}

/** A client for the generation worker. Never throws; never logs; no cookies are sent. */
export function createWorkerClient(options: WorkerClientOptions): WorkerClient {
  const { origin, fetchImpl, sessionToken, timeoutMs } = options;

  async function request<T>(
    path: string,
    init: { method: 'GET' | 'POST'; headers: Record<string, string>; body?: string },
    accept: (json: unknown) => WorkerResult<T>,
  ): Promise<WorkerResult<T>> {
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
    try {
      const response = await fetchImpl(`${origin}${path}`, {
        method: init.method,
        headers: init.headers,
        ...(init.body === undefined ? {} : { body: init.body }),
        credentials: 'omit',
        cache: 'no-store',
        redirect: 'error',
        signal: controller.signal,
      });
      if (response.status === 404) return fail({ kind: 'not-found' });
      if (response.status < 200 || response.status > 299) {
        return fail({ kind: 'rejected', status: response.status });
      }
      let json: unknown;
      try {
        json = await response.json();
      } catch {
        return fail(timedOut ? { kind: 'timeout' } : invalid('not-json'));
      }
      return accept(json);
    } catch {
      return fail(timedOut ? { kind: 'timeout' } : { kind: 'network' });
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    startJob(notesText, idempotencyKey) {
      return request(
        '/jobs',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Session-Token': sessionToken,
            'Idempotency-Key': idempotencyKey,
          },
          body: JSON.stringify({ notesText, runLength: 'short' }),
        },
        (json) => {
          const parsed = StartResponseSchema.safeParse(json);
          if (!parsed.success) return fail(invalid('schema'));
          return { ok: true, value: { jobId: parsed.data.jobId, status: parsed.data.status } };
        },
      );
    },
    getJob(jobId) {
      return request(
        `/jobs/${encodeURIComponent(jobId)}`,
        { method: 'GET', headers: { 'X-Session-Token': sessionToken } },
        (json) => {
          const parsed = GetResponseSchema.safeParse(json);
          if (!parsed.success) return fail(invalid('schema'));
          return toJobState(parsed.data);
        },
      );
    },
    cancelJob(jobId) {
      try {
        fetchImpl(`${origin}/jobs/${encodeURIComponent(jobId)}`, {
          method: 'DELETE',
          headers: { 'X-Session-Token': sessionToken },
          credentials: 'omit',
          cache: 'no-store',
          redirect: 'error',
          keepalive: true,
        }).then(
          () => undefined,
          () => undefined,
        );
      } catch {
        // Ignored: the worker also expires jobs by itself.
      }
    },
  };
}
