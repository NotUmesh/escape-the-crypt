import { JobAckResponseSchema, JobStatusResponseSchema, parseCryptBundle } from '@escape-the-crypt/core';
import type { CryptBundle, GenerationFailureKind, JobAckResponse, JobStatusResponse, Result, RunLength } from '@escape-the-crypt/core';

/** Worker job states the client hands back. No response body ever travels in an error. */
export type JobState =
  | { readonly kind: 'queued' }
  | { readonly kind: 'running' }
  | { readonly kind: 'completed'; readonly bundle: CryptBundle }
  | { readonly kind: 'failed'; readonly failure: GenerationFailureKind }
  | { readonly kind: 'cancelled' }
  | { readonly kind: 'expired' };

/** What POST /jobs reports: any job status, or expired for a swept job. */
export type WorkerStatusName = JobAckResponse['status'];

export type InvalidResponseReason =
  | 'not-json'
  | 'schema'
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
  /** `runLength` defaults to Short, the length the worker always ran before lengths were real. */
  startJob(notesText: string, idempotencyKey: string, runLength?: RunLength): Promise<WorkerResult<StartedJob>>;
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

function invalid(reason: InvalidResponseReason, bundleErrorKind?: string): WorkerError {
  return bundleErrorKind === undefined
    ? { kind: 'invalid-response', reason }
    : { kind: 'invalid-response', reason, bundleErrorKind };
}
function fail<T>(error: WorkerError): WorkerResult<T> {
  return { ok: false, error };
}
/**
 * Maps a parsed `GET /jobs/:id` body to a state. `cancelling` reads as `running`: it is not
 * terminal, so polling goes on until the worker reports `cancelled`. The worker's
 * `failure.message` is never read; the app shows its own copy for each kind.
 */
function toJobState(body: JobStatusResponse): WorkerResult<JobState> {
  switch (body.status) {
    case 'queued':
    case 'running':
    case 'expired':
    case 'cancelled':
      return { ok: true, value: { kind: body.status } };
    case 'cancelling':
      return { ok: true, value: { kind: 'running' } };
    case 'failed':
      if (body.failure.kind === 'cancelled') return { ok: true, value: { kind: 'cancelled' } };
      return { ok: true, value: { kind: 'failed', failure: body.failure.kind } };
    case 'completed': {
      // The schema checked the shape; this is the deeper gate (publish checks, content cross-check).
      const parsed = parseCryptBundle({ manifest: body.bundle.manifest, content: body.bundle.content });
      if (!parsed.ok) return fail(invalid('bundle', parsed.error.kind));
      return { ok: true, value: { kind: 'completed', bundle: parsed.value } };
    }
  }
}/** A client for the generation worker. Never throws; never logs; no cookies are sent. */
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
    startJob(notesText, idempotencyKey, runLength = 'short') {
      return request(
        '/jobs',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Session-Token': sessionToken,
            'Idempotency-Key': idempotencyKey,
          },
          body: JSON.stringify({ notesText, runLength }),
        },
        (json) => {
          const parsed = JobAckResponseSchema.safeParse(json);
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
          const parsed = JobStatusResponseSchema.safeParse(json);
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
