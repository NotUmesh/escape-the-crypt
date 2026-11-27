import type { IncomingMessage, ServerResponse } from 'node:http';
import { checkWordCount, countWords, z } from '@escape-the-crypt/core';
import { requestDigest, sha256Hex, type Job, type JobStore, type JobView } from '../jobs/job-store';
import { readBody } from './body';
import { ERROR_COPY, FAILURE_COPY, type ErrorKind } from './copy';
import { runJob, type JobRunnerDeps } from './job-runner';
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

export const RUN_LENGTHS = ['short', 'standard', 'long'] as const;

/** Notes text and run length only (Req 29.7). Anything else is rejected. */
export const createJobBodySchema = z.strictObject({
  notesText: z.string().refine((t) => t.trim() !== ''),
  runLength: z.enum(RUN_LENGTHS),
});

export interface RouteDeps extends JobRunnerDeps {
  readonly maxBodyBytes: number;
}

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

export async function handleCreateJob(
  req: IncomingMessage,
  res: ServerResponse,
  outcome: RequestOutcome,
  deps: RouteDeps,
): Promise<void> {
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
    notesText: parsed.data.notesText,
  });
  switch (created.kind) {
    case 'new':
      sendJson(res, outcome, 202, { jobId: created.job.id, status: created.job.status });
      void runJob(deps, created.job);
      return;
    case 'replay':
      return sendJson(res, outcome, 200, { jobId: created.job.id, status: created.job.status });
    case 'replay-expired':
      return sendJson(res, outcome, 200, { jobId: created.jobId, status: 'expired' });
    case 'conflict':
      return fail(res, outcome, 409, 'idempotency-conflict');
    case 'session-busy':
      return fail(res, outcome, 429, 'session-busy');
    case 'capacity':
      return fail(res, outcome, 429, 'capacity');
  }
}

function jobBody(job: Job): Record<string, unknown> {
  if (job.status === 'completed' && job.result !== null) {
    const { manifest, content, unplacedAccepted } = job.result;
    return { jobId: job.id, status: 'completed', bundle: { manifest, content, unplacedAccepted } };
  }
  if (job.status === 'cancelling') return { jobId: job.id, status: 'cancelling' };
  if (job.status === 'failed' || job.status === 'cancelled') {
    const kind = job.failure ?? (job.status === 'cancelled' ? 'cancelled' : 'generation-failed');
    return { jobId: job.id, status: job.status, failure: { kind, message: FAILURE_COPY[kind] } };
  }
  return { jobId: job.id, status: job.status };
}

function viewBody(view: JobView): Record<string, unknown> {
  return view.kind === 'expired' ? { jobId: view.jobId, status: 'expired' } : jobBody(view.job);
}

export function handleGetJob(
  req: IncomingMessage,
  res: ServerResponse,
  outcome: RequestOutcome,
  store: JobStore,
  rawId: string,
): void {
  const token = sessionToken(req);
  if (token === null) return fail(res, outcome, 400, 'invalid-session-token');
  const id = rawId.length > MAX_JOB_ID_LENGTH ? null : rawId;
  const view = id === null ? null : store.get(id, token);
  if (view === null) return sendNotFound(res, outcome);
  sendJson(res, outcome, 200, viewBody(view));
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
      return sendJson(res, outcome, 202, { jobId: result.job.id, status: 'cancelling' });
    case 'terminal':
      deps.logger.info({ event: 'job-cancel-requested', route: 'DELETE /jobs/:id', status: result.job.status });
      return sendJson(res, outcome, 200, { jobId: result.job.id, status: result.job.status });
    case 'expired':
      deps.logger.info({ event: 'job-cancel-requested', route: 'DELETE /jobs/:id', status: 'expired' });
      return sendJson(res, outcome, 200, { jobId: result.jobId, status: 'expired' });
  }
}
