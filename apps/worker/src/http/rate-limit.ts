import type { IncomingMessage } from 'node:http';
import { sha256Hex } from '../jobs/job-store';

/**
 * Per-IP limit on `POST /jobs`: at most `RATE_LIMIT_MAX_STARTS` attempts per IP in any
 * `RATE_LIMIT_WINDOW_MS`. A real learner starts one crypt and waits a minute or two for it, and
 * the client retries a failed POST at most twice, so 6 in 15 minutes never stops normal use while
 * a script can spend only a little of the daily budget before it is refused.
 */
export const RATE_LIMIT_WINDOW_MS = 15 * 60_000;
export const RATE_LIMIT_MAX_STARTS = 6;
/** Bounds the memory the limiter holds: the oldest IPs are forgotten first beyond this. */
export const RATE_LIMIT_MAX_TRACKED_IPS = 10_000;
/**
 * Proxies in front of the worker that append to `X-Forwarded-For` (Render runs one). The client's
 * address is the entry this many places from the end; anything to its left is client-supplied and
 * could be forged, so it is never used.
 */
export const TRUSTED_PROXY_HOPS = 1;

export interface RateLimitConfig {
  readonly windowMs: number;
  readonly maxStarts: number;
  readonly maxTrackedIps: number;
}
export const DEFAULT_RATE_LIMIT: RateLimitConfig = {
  windowMs: RATE_LIMIT_WINDOW_MS,
  maxStarts: RATE_LIMIT_MAX_STARTS,
  maxTrackedIps: RATE_LIMIT_MAX_TRACKED_IPS,
};

export type RateDecision =
  | { readonly allowed: true }
  /** `retryAfterSeconds`: when the oldest counted attempt leaves the window. */
  | { readonly allowed: false; readonly retryAfterSeconds: number };

export interface RateLimiter {
  /** Counts one attempt for this client key and decides. Never throws. */
  attempt(clientKey: string): RateDecision;
}

/** Sliding window per client key. Keys are hashed before they are stored, so no IP is held. */
export function createRateLimiter(config: RateLimitConfig, now: () => number): RateLimiter {
  const seen = new Map<string, number[]>();
  return {
    attempt(clientKey) {
      const key = sha256Hex(clientKey);
      const t = now();
      const recent = (seen.get(key) ?? []).filter((at) => t - at < config.windowMs);
      if (recent.length >= config.maxStarts) {
        seen.set(key, recent);
        const oldest = recent[0] ?? t;
        return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((oldest + config.windowMs - t) / 1000)) };
      }
      recent.push(t);
      seen.delete(key); // re-insert so Map order tracks the most recent use
      seen.set(key, recent);
      while (seen.size > config.maxTrackedIps) {
        const first = seen.keys().next().value;
        if (first === undefined) break;
        seen.delete(first);
      }
      return { allowed: true };
    },
  };
}

/**
 * The client's address: the `X-Forwarded-For` entry `TRUSTED_PROXY_HOPS` from the end when the
 * header is present, else the socket address. Used only as a rate-limit key, never logged.
 */
export function clientAddress(req: IncomingMessage, trustedHops: number = TRUSTED_PROXY_HOPS): string {
  const header = req.headers['x-forwarded-for'];
  const raw = Array.isArray(header) ? header.join(',') : header;
  if (typeof raw === 'string' && trustedHops > 0) {
    const parts = raw.split(',').map((p) => p.trim()).filter(Boolean);
    const entry = parts[parts.length - trustedHops];
    if (entry !== undefined) return entry;
  }
  return req.socket.remoteAddress ?? 'unknown';
}
