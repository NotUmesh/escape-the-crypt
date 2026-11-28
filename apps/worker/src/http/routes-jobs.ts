import type { IncomingMessage, ServerResponse } from 'node:http';
import { RUN_LENGTHS, checkWordCount, countWords, z } from '@escape-the-crypt/core';
import type { JobAckResponse, JobStatusResponse, PipelineProgress } from '@escape-the-crypt/core';
import { requestDigest, sha256Hex, type Job, type JobStore, type JobView } from '../jobs/job-store';
import { readBody } from './body';
import { ERROR_COPY, FAILURE_COPY, type ErrorKind } from './copy';
import { runJob, type JobRunnerDeps } from './job-runner';
import { MAX_ACTIVE_JUDGE_JOBS, type JudgeAccess } from './judge-access';
import { clientAddress, type RateLimiter } from './rate-limit';
import { sendError, sendJson, type Logger, type RequestOutcome } from './respond';

/** Hard cap on the request body. 6,000 words is about 50 KB; the rest is headroom for escaping. */
export const DEFAULT_MAX_BODY_BYTES = 256 * 1024;

export const SESSION_HEADER = 'x-session-token';
export const IDEMPOTENCY_HEADER = 'idempotency-key';

/** Base64url, 22 to 128 characters: at least 128 bits when random. */
const SESSION_TOKEN_PATTERN = /^[A-Za-z0-9_-]{22,128}$/;
/** 8 to 128 URL-safe characters. */
const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9_-]{8,128}$/;
const MAX_JOB_ID_LENGTH = 128;

export { RUN_LENGTHS };

/** Notes text and run length only (Req 29.7). Anything else is rejected. */
export const createJobBodySchema = z.strictObject({
  notesText: z.string().refine((t) => t.trim() !== ''),
  runLength: z.enum(RUN_LENGTHS),
});

export interface RouteDeps extends JobRunnerDeps {
  readonly maxBodyBytes: number;
  /** Per-IP limit on public `POST /jobs`. */
  readonly rateLimiter: RateLimiter;
  /** Which `X-Forwarded-For` entry, counted from the end, is the client (`TRUSTED_PROXY_HOPS`). */
  readonly trustedProxyHops: number;
  /** Null when `JUDGE_ACCESS_TOKEN` is not set: the judge route answers 404. */
  readonly judge: JudgeAccess | null;
}

/** Public: rate-limited per IP, one job per session. Judge: neither, but the daily budget holds. */
export type CreateAccess = 'public' | 'judge';

function fail(res: ServerResponse, outcome: RequestOutcome, status: number, kind: ErrorKind): void {
  sendError(res, outcome, status, kind, ERROR_COPY[kind]);
}

/** The one 404. A wrong session, a missing job and a swept tombstone all use it. */
export function sendNotFound(res: ServerResponse, outcome: RequestOutcome): void {
  fail(res, outcome, 404, 'not-found');
}

function headerValue(req: IncomingMessage, name: string): string | null {
  const value = req.headers[name];
  return typeof value === 'string' ? value : null;
}

function sessionToken(req: IncomingMessage): string | null {
  const token = headerValue(req, SESSION_HEADER);
  return token !== null && SESSION_TOKEN_PATTERN.test(token) ? token : null;
}

/** The body of POST /jobs and DELETE /jobs/:id: a status, never a bundle. */
function ack(jobId: string, status: JobAckResponse['status']): JobAckResponse {
  return { jobId, status };
}
export async function handleCreateJob(
  req: IncomingMessage,
  res: ServerResponse,
  outcome: RequestOutcome,
  deps: RouteDeps,
  access: CreateAccess = 'public',
): Promise<void> {
  if (access === 'judge') {
    // A missing route and a wrong code look the same from outside.
    if (deps.judge === null) return sendNotFound(res, outcome);
    if (!deps.judge.accepts(req)) return fail(res, outcome, 403, 'judge-access-denied');
    if (deps.judge.active.size >= MAX_ACTIVE_JUDGE_JOBS) return fail(res, outcome, 429, 'capacity');
  } else {
    // Counted before the body is read, so a flood costs nothing to refuse.
    const decision = deps.rateLimiter.attempt(clientAddress(req, deps.trustedProxyHops));
    if (!decision.allowed) {
      res.setHeader('Retry-After', String(decision.retryAfterSeconds));
      return fail(res, outcome, 429, 'rate-limited');
    }
  }
  const token = sessionToken(req);
  if (token === null) return fail(res, outcome, 400, 'invalid-session-token');
  const key = headerValue(req, IDEMPOTENCY_HEADER);
  if (key === null || !IDEMPOTENCY_KEY_PATTERN.test(key)) {
    return fail(res, outcome, 400, 'invalid-idempotency-key');
  }

  const body = await readBody(req, deps.maxBodyBytes);
  if (!body.ok) {
    if (body.kind === 'aborted') return fail(res, outcome, 400, 'invalid-json');
    res.setHeader('Connection', 'close');
    return fail(res, outcome, 413, 'payload-too-large');
  }

  let json: unknown;
  try {
    json = JSON.parse(body.text);
  } catch {
    return fail(res, outcome, 400, 'invalid-json');
  }
  const parsed = createJobBodySchema.safeParse(json);
  if (!parsed.success) return fail(res, outcome, 400, 'invalid-body');

  // Word cap before the store, a reservation or a Provider call.
  if (!checkWordCount(countWords(parsed.data.notesText)).ok) {
    return fail(res, outcome, 413, 'notes-too-long');
  }

  // `create` comes first. Only a `new` result may reach a reservation or a Provider call.
  const created = deps.jobStore.create({
    sessionToken: token,
    idempotencyKey: key,
    requestDigest: requestDigest(parsed.data),
    runLength: parsed.data.runLength,
    notesText: parsed.data.notesText,
    ...(access === 'judge' ? { judge: true } : {}),
  });
  switch (created.kind) {
    case 'new':
      sendJson(res, outcome, 202, ack(created.job.id, created.job.status));
      if (access === 'judge') deps.judge?.active.add(created.job.id);
      void runJob(deps, created.job).finally(() => deps.judge?.active.delete(created.job.id));
      return;
    case 'replay':
      return sendJson(res, outcome, 200, ack(created.job.id, created.job.status));
    case 'replay-expired':
      return sendJson(res, outcome, 200, ack(created.jobId, 'expired'));
    case 'conflict':
      return fail(res, outcome, 409, 'idempotency-conflict');
    case 'session-busy':
      return fail(res, outcome, 429, 'session-busy');
    case 'capacity':
      return fail(res, outcome, 429, 'capacity');
  }
}

/**
 * The status body. `progress` is added to a running job only when the client asked for it: a client
 * built before progress existed parses `running` strictly and would refuse the extra field.
 */
function jobBody(job: Job, progress: PipelineProgress | undefined): JobStatusResponse {
  if (job.status === 'running' && progress !== undefined) return { jobId: job.id, status: 'running', progress };
  if (job.status === 'completed' && job.result !== null) {
    const { manifest, content, unplacedAccepted } = job.result;
    return { jobId: job.id, status: 'completed', bundle: { manifest, content, unplacedAccepted } };
  }
  if (job.status === 'failed' || job.status === 'cancelled') {
    const kind = job.failure ?? (job.status === 'cancelled' ? 'cancelled' : 'generation-failed');
    return { jobId: job.id, status: job.status, failure: { kind, message: FAILURE_COPY[kind] } };
  }
  if (job.status === 'completed') {
    // Not reachable through the store (a completed job holds a result). The contract has no
    // bundle-less `completed` body, so answer a failure instead.
    const kind = 'generation-failed';
    return { jobId: job.id, status: 'failed', failure: { kind, message: FAILURE_COPY[kind] } };
  }
  return { jobId: job.id, status: job.status };
}
function viewBody(view: JobView, progressOf: (jobId: string) => PipelineProgress | undefined): JobStatusResponse {
  return view.kind === 'expired' ? { jobId: view.jobId, status: 'expired' } : jobBody(view.job, progressOf(view.job.id));
}

export function handleGetJob(
  req: IncomingMessage,
  res: ServerResponse,
  outcome: RequestOutcome,
  store: JobStore,
  rawId: string,
  /** Latest progress per running job; read only when the request has `?progress=1`. */
  progress?: ReadonlyMap<string, PipelineProgress>,
): void {
  const token = sessionToken(req);
  if (token === null) return fail(res, outcome, 400, 'invalid-session-token');
  const id = rawId.length > MAX_JOB_ID_LENGTH ? null : rawId;
  const view = id === null ? null : store.get(id, token);
  if (view === null) return sendNotFound(res, outcome);
  const wantsProgress = new URL(req.url ?? '/', 'http://worker').searchParams.get('progress') === '1';
  sendJson(res, outcome, 200, viewBody(view, (jobId) => (wantsProgress ? progress?.get(jobId) : undefined)));
}

/**
 * `DELETE /jobs/:id`. Records a cancel request and aborts the running pipeline, if any.
 * Makes no reservation and no Provider call. Logs the route template and status only.
 */
export function handleDeleteJob(
  req: IncomingMessage,
  res: ServerResponse,
  outcome: RequestOutcome,
  deps: { readonly jobStore: JobStore; readonly controllers?: Map<string, AbortController>; readonly logger: Logger },
  rawId: string,
): void {
  const token = sessionToken(req);
  if (token === null) return fail(res, outcome, 400, 'invalid-session-token');
  const result = rawId.length > MAX_JOB_ID_LENGTH ? null : deps.jobStore.requestCancel(rawId, sha256Hex(token));
  if (result === null) return sendNotFound(res, outcome);
  switch (result.kind) {
    case 'cancelling':
      deps.controllers?.get(result.job.id)?.abort();
      deps.logger.info({ event: 'job-cancel-requested', route: 'DELETE /jobs/:id', status: 'cancelling' });
      return sendJson(res, outcome, 202, ack(result.job.id, 'cancelling'));
    case 'terminal':
      deps.logger.info({ event: 'job-cancel-requested', route: 'DELETE /jobs/:id', status: result.job.status });
      return sendJson(res, outcome, 200, ack(result.job.id, result.job.status));
    case 'expired':
      deps.logger.info({ event: 'job-cancel-requested', route: 'DELETE /jobs/:id', status: 'expired' });
      return sendJson(res, outcome, 200, ack(result.jobId, 'expired'));
  }
}
