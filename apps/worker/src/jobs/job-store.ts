import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import type { JobFailureKindName, JobStatusName, PipelineResult, RunLength } from '@escape-the-crypt/core';

/** `cancelling` is non-terminal: cancel was requested and the pipeline has not returned yet. */
export type JobStatus = JobStatusName;
/** Defined in core's job-response-schema, so the response schema and the store cannot drift apart. */
export type JobFailureKind = JobFailureKindName;
/** Tombstone_TTL: fixed, not configurable. */
export const TOMBSTONE_TTL_MS = 24 * 60 * 60 * 1000;
/** Default Job_TTL: 30 minutes after the terminal status. */
export const DEFAULT_JOB_TTL_MS = 30 * 60 * 1000;

/** A job still queued or running this long after `createdAtMs` is failed by `sweepExpired`. */
export const MAX_RUN_MS = 10 * 60 * 1000;
/** Queued or running jobs allowed per session. */
export const MAX_ACTIVE_JOBS_PER_SESSION = 1;
/**
 * Live jobs allowed in the store in total. Counts every non-tombstoned job of any status,
 * so finished jobs still awaiting the Job_TTL count against it.
 */
export const MAX_LIVE_JOBS = 20;

const TERMINAL: ReadonlySet<JobStatus> = new Set(['completed', 'failed', 'cancelled']);

/** Content-free record kept after the Job_TTL. Answers a repeated POST and a GET, nothing else. */
export interface Tombstone {
  readonly jobId: string;
  readonly sessionHash: string;
  readonly idempotencyKeyHash: string;
  readonly requestDigest: string;
  readonly status: 'expired';
  readonly expiredAt: number;
}

export interface Job {
  readonly id: string;
  /** sha-256 of the session token. The raw token is never stored. */
  readonly sessionHash: string;
  /** sha-256 of the idempotency key. The raw key is never stored. */
  readonly idempotencyKeyHash: string;
  readonly requestDigest: string;
  readonly status: JobStatus;
  readonly createdAtMs: number;
  /** Set when the status first becomes terminal. Starts the Job_TTL. */
  readonly terminalAtMs: number | null;
  readonly failure: JobFailureKind | null;
  /** Sets the crypt size the pipeline aims for (`cryptTargetFor`). */
  readonly runLength: RunLength;
  /** Needed to run the pipeline. Deleted at the Job_TTL. */
  readonly notesText: string | null;
  /** Null until completed. Deleted at the Job_TTL. */
  readonly result: PipelineResult | null;
}

export interface CreateJobInput {
  readonly sessionToken: string;
  readonly idempotencyKey: string;
  /** Computed by the HTTP layer over the validated body (see `requestDigest`). */
  readonly requestDigest: string;
  readonly runLength: RunLength;
  readonly notesText: string;
  /** Judge access: skips the per-session and public capacity limits. The daily budget still applies. */
  readonly judge?: boolean;
}

export type CreateJobResult =
  | { readonly kind: 'new'; readonly job: Job }
  | { readonly kind: 'replay'; readonly job: Job }
  | { readonly kind: 'replay-expired'; readonly jobId: string; readonly status: 'expired' }
  | { readonly kind: 'conflict' }
  | { readonly kind: 'session-busy' }
  | { readonly kind: 'capacity' };

export type JobView =
  | { readonly kind: 'job'; readonly job: Job }
  | { readonly kind: 'expired'; readonly jobId: string; readonly status: 'expired'; readonly expiredAt: number };

export type CancelRequestResult =
  | { readonly kind: 'cancelling'; readonly job: Job }
  | { readonly kind: 'terminal'; readonly job: Job }
  | { readonly kind: 'expired'; readonly jobId: string };

export interface JobStatusPatch {
  readonly failure?: JobFailureKind | null;
  readonly result?: PipelineResult | null;
}

export interface JobStore {
  create(input: CreateJobInput): CreateJobResult;
  /** Null for a missing ID, a wrong session and a swept tombstone, identically. */
  get(jobId: string, sessionToken: string): JobView | null;
  /**
   * Marks a queued or running job `cancelling` (idempotent). Null for a missing ID, a wrong
   * session and a swept tombstone, identically to `get`. A finished job is returned unchanged;
   * an unswept tombstone with the right session gives `expired`. Never throws.
   */
  requestCancel(jobId: string, sessionHash: string): CancelRequestResult | null;
  /**
   * True if the job exists. A terminal job never changes again. A `cancelling` job ignores
   * non-terminal updates, and any `completed`/`failed` outcome becomes `cancelled`
   * (failure `cancelled`, result discarded, never stored).
   */
  setStatus(jobId: string, status: JobStatus, patch?: JobStatusPatch): boolean;
  /** Counts only, for logging. Never throws. */
  sweepExpired(): { readonly expired: number; readonly swept: number };
}

export interface JobStoreConfig {
  readonly now: () => number;
  readonly jobTtlMs?: number;
  readonly newId?: () => string;
}

export function sha256Hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`);
    return `{${entries.join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

/** sha-256 over key-sorted canonical JSON, so key order never changes the digest. */
export function requestDigest(body: unknown): string {
  return sha256Hex(canonicalJson(body));
}

function hashesEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  return left.length === right.length && timingSafeEqual(left, right);
}

const slot = (sessionHash: string, keyHash: string): string => `${sessionHash}:${keyHash}`;

export function createJobStore(config: JobStoreConfig): JobStore {
  const jobTtlMs = config.jobTtlMs ?? DEFAULT_JOB_TTL_MS;
  const newId = config.newId ?? ((): string => randomUUID());
  const jobs = new Map<string, Job>();
  const tombstones = new Map<string, Tombstone>();
  const jobBySlot = new Map<string, string>();
  const tombstoneBySlot = new Map<string, string>();

  return {
    create(input) {
      const sessionHash = sha256Hex(input.sessionToken);
      const keyHash = sha256Hex(input.idempotencyKey);
      const key = slot(sessionHash, keyHash);

      const liveId = jobBySlot.get(key);
      const live = liveId === undefined ? undefined : jobs.get(liveId);
      if (live !== undefined) {
        return hashesEqual(live.requestDigest, input.requestDigest)
          ? { kind: 'replay', job: live }
          : { kind: 'conflict' };
      }
      const deadId = tombstoneBySlot.get(key);
      const dead = deadId === undefined ? undefined : tombstones.get(deadId);
      if (dead !== undefined) {
        return hashesEqual(dead.requestDigest, input.requestDigest)
          ? { kind: 'replay-expired', jobId: dead.jobId, status: 'expired' }
          : { kind: 'conflict' };
      }

      // Limits come after the idempotency lookups, so a retry of the same request is never refused.
      // A refusal reserves nothing and calls no Provider: the store calls neither. The HTTP layer
      // must call `create` before any reservation or Provider call.
      let activeForSession = 0;
      for (const j of jobs.values()) {
        if (j.sessionHash === sessionHash && j.terminalAtMs === null) activeForSession += 1;
      }
      if (input.judge !== true && activeForSession >= MAX_ACTIVE_JOBS_PER_SESSION) return { kind: 'session-busy' };
      if (input.judge !== true && jobs.size >= MAX_LIVE_JOBS) return { kind: 'capacity' };

      const job: Job = {
        id: newId(),
        sessionHash,
        idempotencyKeyHash: keyHash,
        requestDigest: input.requestDigest,
        status: 'queued',
        createdAtMs: config.now(),
        terminalAtMs: null,
        failure: null,
        runLength: input.runLength,
        notesText: input.notesText,
        result: null,
      };
      jobs.set(job.id, job);
      jobBySlot.set(key, job.id);
      return { kind: 'new', job };
    },

    get(jobId, sessionToken) {
      const sessionHash = sha256Hex(sessionToken);
      const job = jobs.get(jobId);
      if (job !== undefined) {
        return hashesEqual(job.sessionHash, sessionHash) ? { kind: 'job', job } : null;
      }
      const stone = tombstones.get(jobId);
      if (stone !== undefined && hashesEqual(stone.sessionHash, sessionHash)) {
        return { kind: 'expired', jobId: stone.jobId, status: 'expired', expiredAt: stone.expiredAt };
      }
      return null;
    },

    requestCancel(jobId, sessionHash) {
      const job = jobs.get(jobId);
      if (job !== undefined) {
        if (!hashesEqual(job.sessionHash, sessionHash)) return null;
        if (job.terminalAtMs !== null) return { kind: 'terminal', job };
        if (job.status === 'cancelling') return { kind: 'cancelling', job };
        const marked: Job = { ...job, status: 'cancelling' };
        jobs.set(jobId, marked);
        return { kind: 'cancelling', job: marked };
      }
      const stone = tombstones.get(jobId);
      if (stone !== undefined && hashesEqual(stone.sessionHash, sessionHash)) {
        return { kind: 'expired', jobId: stone.jobId };
      }
      return null;
    },

    setStatus(jobId, status, patch) {
      const job = jobs.get(jobId);
      if (job === undefined) return false;
      if (job.terminalAtMs !== null) return true; // terminal is final; first outcome wins
      if (job.status === 'cancelling') {
        // Cancel was requested: only a pipeline outcome ends the job, and it always ends
        // `cancelled`. A success bundle is dropped here, so it is never stored. A late
        // `running` update must not undo the cancel request.
        if (!TERMINAL.has(status)) return true;
        jobs.set(jobId, {
          ...job,
          status: 'cancelled',
          terminalAtMs: config.now(),
          failure: 'cancelled',
          result: null,
        });
        return true;
      }
      const terminal = TERMINAL.has(status);
      jobs.set(jobId, {
        ...job,
        status,
        terminalAtMs: terminal ? config.now() : null,
        failure: patch?.failure !== undefined ? patch.failure : job.failure,
        result: patch?.result !== undefined ? patch.result : job.result,
      });
      return true;
    },

    sweepExpired() {
      const nowMs = config.now();
      let expired = 0;
      let swept = 0;
      // Fail stuck jobs first. Their terminal time starts now, so the TTL sweep below
      // handles them on a later pass. A late pipeline result cannot overwrite this:
      // `setStatus` keeps the first terminal outcome.
      for (const job of [...jobs.values()]) {
        if (job.terminalAtMs !== null || nowMs - job.createdAtMs <= MAX_RUN_MS) continue;
        jobs.set(
          job.id,
          job.status === 'cancelling'
            ? { ...job, status: 'cancelled', failure: 'cancelled', result: null, terminalAtMs: nowMs }
            : { ...job, status: 'failed', failure: 'generation-failed', terminalAtMs: nowMs },
        );
      }
      for (const job of [...jobs.values()]) {
        if (job.terminalAtMs === null || nowMs - job.terminalAtMs <= jobTtlMs) continue;
        const key = slot(job.sessionHash, job.idempotencyKeyHash);
        jobs.delete(job.id);
        jobBySlot.delete(key);
        tombstones.set(job.id, {
          jobId: job.id,
          sessionHash: job.sessionHash,
          idempotencyKeyHash: job.idempotencyKeyHash,
          requestDigest: job.requestDigest,
          status: 'expired',
          expiredAt: nowMs,
        });
        tombstoneBySlot.set(key, job.id);
        expired += 1;
      }
      for (const stone of [...tombstones.values()]) {
        if (nowMs - stone.expiredAt <= TOMBSTONE_TTL_MS) continue;
        tombstones.delete(stone.jobId);
        tombstoneBySlot.delete(slot(stone.sessionHash, stone.idempotencyKeyHash));
        swept += 1;
      }
      return { expired, swept };
    },
  };
}
