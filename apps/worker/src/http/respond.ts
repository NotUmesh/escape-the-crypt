import type { ServerResponse } from 'node:http';

/** Log fields are numbers, booleans and closed-set names only. Never content, tokens or keys. */
export type LogFields = Readonly<Record<string, string | number | boolean>>;

export interface Logger {
  readonly info: (fields: LogFields) => void;
  readonly error: (fields: LogFields) => void;
}

export const silentLogger: Logger = { info: () => undefined, error: () => undefined };

/** Typed error body. `error` is a closed-set kind, `message` is plain learner-facing language. */
export interface ErrorBody {
  readonly error: string;
  readonly message: string;
}

/** Per-request facts the logger may record. Filled in by routes; read by the server. */
export interface RequestOutcome {
  status: number;
  errorKind: string | null;
  route: string;
}

export function sendJson(
  res: ServerResponse,
  outcome: RequestOutcome,
  status: number,
  body: unknown,
  errorKind: string | null = null,
): void {
  outcome.status = status;
  outcome.errorKind = errorKind;
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload, 'utf8'),
    'Cache-Control': 'private, no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(payload);
}

export function sendError(
  res: ServerResponse,
  outcome: RequestOutcome,
  status: number,
  error: string,
  message: string,
): void {
  const body: ErrorBody = { error, message };
  sendJson(res, outcome, status, body, error);
}
