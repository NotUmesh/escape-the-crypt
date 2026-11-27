import type { IncomingMessage, ServerResponse } from 'node:http';

export const ALLOWED_METHODS = 'GET, POST, DELETE, OPTIONS';
export const ALLOWED_HEADERS = 'Content-Type, X-Session-Token, Idempotency-Key, X-Judge-Token';
const PREFLIGHT_MAX_AGE_SECONDS = '600';

/**
 * Sets CORS headers on a response. `Vary: Origin` is always sent. Allow headers are sent only
 * when the request `Origin` equals `webOrigin` exactly. Credentials are never allowed, so
 * `Access-Control-Allow-Credentials` is never set.
 */
export function applyCors(req: IncomingMessage, res: ServerResponse, webOrigin: string): boolean {
  res.setHeader('Vary', 'Origin');
  const origin = req.headers.origin;
  if (typeof origin !== 'string' || origin !== webOrigin) return false;
  res.setHeader('Access-Control-Allow-Origin', webOrigin);
  return true;
}

/** Adds the preflight-only headers. Call only when `applyCors` returned true. */
export function applyPreflightHeaders(res: ServerResponse): void {
  res.setHeader('Access-Control-Allow-Methods', ALLOWED_METHODS);
  res.setHeader('Access-Control-Allow-Headers', ALLOWED_HEADERS);
  res.setHeader('Access-Control-Max-Age', PREFLIGHT_MAX_AGE_SECONDS);
}
