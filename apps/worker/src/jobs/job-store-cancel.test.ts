import { describe, expect, it } from 'vitest';
import type { PipelineResult } from '@escape-the-crypt/core';
import {
  DEFAULT_JOB_TTL_MS,
  MAX_LIVE_JOBS,
  MAX_RUN_MS,
  TOMBSTONE_TTL_MS,
  sha256Hex,
  type Job,
} from './job-store';
import {
  DIGEST_1,
  DIGEST_2,
  KEY_1,
  KEY_2,
  TOKEN_A,
  TOKEN_B,
  input,
  makeStore,
  type Harness,
} from './job-store-test-support';

const HASH_A = sha256Hex(TOKEN_A);
const HASH_B = sha256Hex(TOKEN_B);
const BUNDLE_MARKER = 'BUNDLE-MARKER-must-never-be-stored';
// A stand-in bundle; the store treats the result as opaque.
const BUNDLE = { marker: BUNDLE_MARKER } as unknown as PipelineResult;

function newJob(h: Harness, overrides: Parameters<typeof input>[0] = {}): Job {
  const created = h.store.create(input(overrides));
  if (created.kind !== 'new') throw new Error(`expected new, got ${created.kind}`);
  return created.job;
}

function current(h: Harness, id: string, token = TOKEN_A): Job {
  const view = h.store.get(id, token);
  if (view === null || view.kind !== 'job') throw new Error('expected a live job');
  return view.job;
}

describe('requestCancel', () => {
  it('turns a queued job into cancelling, and a second request returns cancelling again', () => {
    const h = makeStore();
    const job = newJob(h);
    const first = h.store.requestCancel(job.id, HASH_A);
    expect(first?.kind).toBe('cancelling');
    expect(current(h, job.id).status).toBe('cancelling');
    const second = h.store.requestCancel(job.id, HASH_A);
    expect(second?.kind).toBe('cancelling');
    expect(current(h, job.id).status).toBe('cancelling');
    expect(current(h, job.id).terminalAtMs).toBeNull();
  });

  it('turns a running job into cancelling', () => {
    const h = makeStore();
    const job = newJob(h);
    h.store.setStatus(job.id, 'running');
    const res = h.store.requestCancel(job.id, HASH_A);
    expect(res?.kind).toBe('cancelling');
    expect(current(h, job.id).status).toBe('cancelling');
  });

  it.each(['completed', 'failed', 'cancelled'] as const)('leaves a %s job unchanged', (status) => {
    const h = makeStore();
    const job = newJob(h);
    h.store.setStatus(job.id, status, {
      failure: status === 'completed' ? null : 'generation-failed',
      result: status === 'completed' ? BUNDLE : null,
    });
    const before = current(h, job.id);
    const res = h.store.requestCancel(job.id, HASH_A);
    expect(res?.kind).toBe('terminal');
    expect(current(h, job.id)).toEqual(before);
    expect(current(h, job.id).status).toBe(status);
    if (status === 'completed') {
      expect(current(h, job.id).result).toBe(BUNDLE);
      if (res?.kind === 'terminal') expect(res.job.result).toBe(BUNDLE);
    }
  });

  it('returns expired for an unswept tombstone with the right session', () => {
    const h = makeStore();
    const job = newJob(h);
    h.store.setStatus(job.id, 'failed', { failure: 'generation-failed' });
    h.clock.t += DEFAULT_JOB_TTL_MS + 1;
    h.store.sweepExpired();
    expect(h.store.requestCancel(job.id, HASH_A)).toEqual({ kind: 'expired', jobId: job.id });
  });

  it('returns null for a missing job, matching get', () => {
    const h = makeStore();
    expect(h.store.requestCancel('nope', HASH_A)).toEqual(null);
    expect(h.store.get('nope', TOKEN_A)).toEqual(null);
  });

  it('returns null for a wrong session, matching get, and does not cancel', () => {
    const h = makeStore();
    const job = newJob(h);
    expect(h.store.requestCancel(job.id, HASH_B)).toEqual(null);
    expect(h.store.get(job.id, TOKEN_B)).toEqual(null);
    expect(current(h, job.id).status).toBe('queued');
  });

  it('returns null for a wrong session on a tombstone', () => {
    const h = makeStore();
    const job = newJob(h);
    h.store.setStatus(job.id, 'completed', { result: BUNDLE });
    h.clock.t += DEFAULT_JOB_TTL_MS + 1;
    h.store.sweepExpired();
    expect(h.store.requestCancel(job.id, HASH_B)).toEqual(null);
    expect(h.store.get(job.id, TOKEN_B)).toEqual(null);
  });

  it('returns null for a swept tombstone, matching get', () => {
    const h = makeStore();
    const job = newJob(h);
    h.store.setStatus(job.id, 'failed', { failure: 'generation-failed' });
    h.clock.t += DEFAULT_JOB_TTL_MS + 1;
    h.store.sweepExpired();
    h.clock.t += TOMBSTONE_TTL_MS + 1;
    expect(h.store.sweepExpired().swept).toBe(1);
    expect(h.store.requestCancel(job.id, HASH_A)).toEqual(null);
    expect(h.store.get(job.id, TOKEN_A)).toEqual(null);
  });

  it('never throws on odd input', () => {
    const h = makeStore();
    newJob(h);
    expect(() => h.store.requestCancel('', HASH_A)).not.toThrow();
    expect(h.store.requestCancel('', HASH_A)).toEqual(null);
    expect(() => h.store.requestCancel('job-1', 'unknown-hash')).not.toThrow();
    expect(h.store.requestCancel('job-1', 'unknown-hash')).toEqual(null);
    expect(() => h.store.requestCancel('', '')).not.toThrow();
  });
});

describe('setStatus on a cancelling job', () => {
  it('a late success ends cancelled, stores no bundle, and starts the TTL at the cancel finish', () => {
    const h = makeStore();
    const job = newJob(h);
    h.store.setStatus(job.id, 'running');
    h.store.requestCancel(job.id, HASH_A);
    h.clock.t += 5_000;
    const finishedAt = h.clock.t;
    expect(h.store.setStatus(job.id, 'completed', { result: BUNDLE })).toBe(true);

    const done = current(h, job.id);
    expect(done.status).toBe('cancelled');
    expect(done.failure).toBe('cancelled');
    expect(done.result).toBeNull();
    expect(done.terminalAtMs).toBe(finishedAt);
    expect(JSON.stringify(done)).not.toContain(BUNDLE_MARKER);
    expect(JSON.stringify(h.store.get(job.id, TOKEN_A))).not.toContain(BUNDLE_MARKER);

    // The TTL runs from the cancel finish, not from the cancel request or creation.
    h.clock.t = finishedAt + DEFAULT_JOB_TTL_MS;
    h.store.sweepExpired();
    expect(h.store.get(job.id, TOKEN_A)?.kind).toBe('job');
    h.clock.t = finishedAt + DEFAULT_JOB_TTL_MS + 1;
    expect(h.store.sweepExpired().expired).toBe(1);
    expect(h.store.get(job.id, TOKEN_A)?.kind).toBe('expired');
  });

  it('a late failure also ends cancelled', () => {
    const h = makeStore();
    const job = newJob(h);
    h.store.requestCancel(job.id, HASH_A);
    h.store.setStatus(job.id, 'failed', { failure: 'generation-failed' });
    const done = current(h, job.id);
    expect(done.status).toBe('cancelled');
    expect(done.failure).toBe('cancelled');
    expect(done.result).toBeNull();
    expect(done.terminalAtMs).toBe(h.clock.t);
  });

  it('a late cancelled update ends cancelled', () => {
    const h = makeStore();
    const job = newJob(h);
    h.store.requestCancel(job.id, HASH_A);
    h.store.setStatus(job.id, 'cancelled', { failure: 'cancelled' });
    const done = current(h, job.id);
    expect(done.status).toBe('cancelled');
    expect(done.failure).toBe('cancelled');
    expect(done.result).toBeNull();
  });

  it('ignores a late running update', () => {
    const h = makeStore();
    const job = newJob(h);
    h.store.requestCancel(job.id, HASH_A);
    expect(h.store.setStatus(job.id, 'running')).toBe(true);
    expect(current(h, job.id).status).toBe('cancelling');
    expect(current(h, job.id).terminalAtMs).toBeNull();
  });

  it('keeps the first terminal outcome after cancelled', () => {
    const h = makeStore();
    const job = newJob(h);
    h.store.requestCancel(job.id, HASH_A);
    h.store.setStatus(job.id, 'failed');
    h.store.setStatus(job.id, 'completed', { result: BUNDLE });
    const done = current(h, job.id);
    expect(done.status).toBe('cancelled');
    expect(done.result).toBeNull();
  });
});

describe('limits and sweep with cancelling jobs', () => {
  it('holds session-busy while cancelling and frees it once cancelled', () => {
    const h = makeStore();
    const job = newJob(h);
    h.store.requestCancel(job.id, HASH_A);
    expect(h.store.create(input({ idempotencyKey: KEY_2, requestDigest: DIGEST_2 })).kind).toBe(
      'session-busy',
    );
    h.store.setStatus(job.id, 'completed', { result: BUNDLE });
    expect(h.store.create(input({ idempotencyKey: KEY_2, requestDigest: DIGEST_2 })).kind).toBe('new');
  });

  it('counts a cancelling job toward the live-job capacity', () => {
    const h = makeStore();
    for (let i = 0; i < MAX_LIVE_JOBS; i += 1) {
      newJob(h, { sessionToken: `session-${i}-${'x'.repeat(40)}` });
    }
    const probe = { sessionToken: TOKEN_B, idempotencyKey: KEY_1, requestDigest: DIGEST_1 };
    expect(h.store.create(input(probe)).kind).toBe('capacity');
    h.store.requestCancel('job-1', sha256Hex(`session-0-${'x'.repeat(40)}`));
    expect(h.store.get('job-1', `session-0-${'x'.repeat(40)}`)).not.toBeNull();
    expect(h.store.create(input(probe)).kind).toBe('capacity');
  });

  it('is never TTL-swept while cancelling', () => {
    const h = makeStore({ jobTtlMs: 1_000 });
    const job = newJob(h);
    h.store.requestCancel(job.id, HASH_A);
    h.clock.t += 5_000; // well past the Job_TTL, still under MAX_RUN_MS
    expect(h.store.sweepExpired()).toEqual({ expired: 0, swept: 0 });
    expect(current(h, job.id).status).toBe('cancelling');
  });

  it('the max-run sweep ends a stuck cancelling job as cancelled, not generation-failed', () => {
    const h = makeStore();
    const job = newJob(h);
    h.store.requestCancel(job.id, HASH_A);
    h.clock.t += MAX_RUN_MS + 1;
    h.store.sweepExpired();
    const done = current(h, job.id);
    expect(done.status).toBe('cancelled');
    expect(done.failure).toBe('cancelled');
    expect(done.result).toBeNull();
    expect(done.terminalAtMs).toBe(h.clock.t);
    // A late pipeline outcome cannot change it.
    h.store.setStatus(job.id, 'failed', { failure: 'generation-failed' });
    expect(current(h, job.id).failure).toBe('cancelled');
  });
});
