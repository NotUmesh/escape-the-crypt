import { timingSafeEqual } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import { sha256Hex } from '../jobs/job-store';

/** The header a judge sends the access code in. Never a URL or query parameter. */
export const JUDGE_HEADER = 'x-judge-token';
/** A shorter code is refused at startup and the judge route stays off. */
export const MIN_JUDGE_TOKEN_LENGTH = 24;
/** Judge jobs that may run at once, separate from public capacity. */
export const MAX_ACTIVE_JUDGE_JOBS = 3;

/**
 * Judge access, from the `JUDGE_ACCESS_TOKEN` env var (set in Render, never in the repo). Only the
 * SHA-256 of the code is kept in memory; requests are compared hash to hash in constant time.
 */
export interface JudgeAccess {
  /** True when the request carries the judge code. */
  accepts(req: IncomingMessage): boolean;
  /** Judge jobs now running. */
  readonly active: Set<string>;
}

/**
 * Whether `JUDGE_ACCESS_TOKEN` turns the judge route on, for the startup log. The reason names the
 * rule, never the value or its length.
 */
export type JudgeAccessStatus =
  | { readonly judgeAccess: 'enabled' }
  | { readonly judgeAccess: 'disabled'; readonly judgeAccessReason: 'unset' | 'shorter-than-24-characters' };

export function judgeAccessStatus(raw: string | undefined): JudgeAccessStatus {
  const token = raw?.trim() ?? '';
  if (token === '') return { judgeAccess: 'disabled', judgeAccessReason: 'unset' };
  if (token.length < MIN_JUDGE_TOKEN_LENGTH) return { judgeAccess: 'disabled', judgeAccessReason: 'shorter-than-24-characters' };
  return { judgeAccess: 'enabled' };
}

export function judgeAccessFromEnv(raw: string | undefined): JudgeAccess | null {
  const token = raw?.trim();
  if (token === undefined || token.length < MIN_JUDGE_TOKEN_LENGTH) return null;
  const expected = Buffer.from(sha256Hex(token), 'hex');
  return {
    active: new Set<string>(),
    accepts(req) {
      const header = req.headers[JUDGE_HEADER];
      if (typeof header !== 'string' || header.length === 0) return false;
      const given = Buffer.from(sha256Hex(header), 'hex');
      return given.length === expected.length && timingSafeEqual(given, expected);
    },
  };
}
