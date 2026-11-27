import { createServer as createHttpServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { applyCors, applyPreflightHeaders } from './cors';
import { ERROR_COPY } from './copy';
import type { JobRunnerDeps } from './job-runner';
import { DEFAULT_MAX_BODY_BYTES, handleCreateJob, handleDeleteJob, handleGetJob, sendNotFound } from './routes-jobs';
import { sendError, sendJson, silentLogger, type Logger, type RequestOutcome } from './respond';
import type { PipelineProgress } from '@escape-the-crypt/core';
import type { JudgeAccess } from './judge-access';
import { DEFAULT_RATE_LIMIT, createRateLimiter, type RateLimitConfig } from './rate-limit';

export interface ServerLimits {
  /** Hard cap on the `POST /jobs` body, in bytes. */
  readonly maxBodyBytes: number;
}

export interface ServerDeps extends Omit<JobRunnerDeps, 'logger'> {
  /** The one allowed CORS origin (`WEB_ORIGIN`). */
  readonly webOrigin: string;
  readonly logger?: Logger;
  readonly limits?: Partial<ServerLimits>;
  /** What `GET /health` reports. Defaults to `ok`. Always answers 200: the process is up either way. */
  readonly healthStatus?: () => 'ok' | 'budget-not-configured';
  /** From `JUDGE_ACCESS_TOKEN`. Absent or null: `POST /judge/jobs` answers 404. */
  readonly judge?: JudgeAccess | null;
  /** Per-IP limit on public `POST /jobs`. Defaults to `DEFAULT_RATE_LIMIT`. */
  readonly rateLimit?: RateLimitConfig;
}

const JOB_PATH = /^\/jobs\/([^/]+)$/;

function decodeId(raw: string): string {
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

/**
 * Builds the worker's HTTP server. Nothing is listening until the caller calls `listen`.
 * The request handler never throws: an unexpected error becomes a typed 500.
 */
export function createServer(deps: ServerDeps): Server {
  const logger = deps.logger ?? silentLogger;
  const routeDeps = {
    ...deps,
    logger,
    controllers: deps.controllers ?? new Map<string, AbortController>(),
    progress: deps.progress ?? new Map<string, PipelineProgress>(),
    maxBodyBytes: deps.limits?.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES,
    rateLimiter: createRateLimiter(deps.rateLimit ?? DEFAULT_RATE_LIMIT, deps.now),
    judge: deps.judge ?? null,
  };

  const route = async (req: IncomingMessage, res: ServerResponse, outcome: RequestOutcome): Promise<void> => {
    const method = req.method ?? '';
    const path = (req.url ?? '').split('?')[0] ?? '';
    const allowed = applyCors(req, res, deps.webOrigin);

    if (method === 'OPTIONS') {
      outcome.route = 'OPTIONS *';
      if (allowed) applyPreflightHeaders(res);
      outcome.status = 204;
      res.writeHead(204, { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' });
      res.end();
      return;
    }
    if (method === 'GET' && path === '/health') {
      outcome.route = 'GET /health';
      sendJson(res, outcome, 200, { status: deps.healthStatus?.() ?? 'ok' });
      return;
    }
    if (method === 'POST' && path === '/jobs') {
      outcome.route = 'POST /jobs';
      await handleCreateJob(req, res, outcome, routeDeps);
      return;
    }
    if (method === 'POST' && path === '/judge/jobs') {
      outcome.route = 'POST /judge/jobs';
      await handleCreateJob(req, res, outcome, routeDeps, 'judge');
      return;
    }
    const match = method === 'GET' || method === 'DELETE' ? JOB_PATH.exec(path) : null;
    if (match !== null) {
      const id = decodeId(match[1] ?? '');
      if (method === 'DELETE') {
        outcome.route = 'DELETE /jobs/:id';
        handleDeleteJob(req, res, outcome, routeDeps, id);
        return;
      }
      outcome.route = 'GET /jobs/:id';
      handleGetJob(req, res, outcome, deps.jobStore, id, routeDeps.progress);
      return;
    }
    outcome.route = 'unmatched';
    sendNotFound(res, outcome);
  };

  return createHttpServer((req, res) => {
    const started = deps.now();
    const outcome: RequestOutcome = { status: 0, errorKind: null, route: 'unmatched' };
    const method = req.method ?? '';
    void route(req, res, outcome)
      .catch((error: unknown) => {
        const errorType = error instanceof Error ? error.constructor.name : typeof error;
        try {
          if (!res.headersSent) {
            sendError(res, outcome, 500, 'internal', ERROR_COPY.internal);
          } else {
            res.destroy();
          }
          logger.error({ event: 'request-error', route: outcome.route, errorType });
        } catch {
          res.destroy();
        }
      })
      .finally(() => {
        try {
          logger.info({
            event: 'request',
            method,
            route: outcome.route,
            status: outcome.status,
            durationMs: deps.now() - started,
            ...(outcome.errorKind === null ? {} : { errorKind: outcome.errorKind }),
          });
        } catch {
          // Logging must never take the process down.
        }
      });
  });
}
