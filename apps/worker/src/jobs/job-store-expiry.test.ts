import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  MAX_ACTIVE_JOBS_PER_SESSION,
  MAX_LIVE_JOBS,
  MAX_RUN_MS,
  TOMBSTONE_TTL_MS,
  sha256Hex,
} from './job-store';
import {
  DIGEST_2,
  KEY_1,
  KEY_2,
  NOTES,
  TOKEN_A,
  TOKEN_B,
  input,
  makeSpend,
  makeStore,
} from './job-store-test-support';

const TTL = 1000;

/** Creates job-1, completes it at the current time, and returns the harness. */
function finishedJob(jobTtlMs = TTL) {
  const h = makeStore({ jobTtlMs });
  h.store.create(input());
  h.store.setStatus('job-1', 'completed');
  return h;
}

describe('Job_TTL sweep', () => {
  it('does not expire at exactly the TTL, expires one ms after (rule: now - terminalAt > ttl)', () => {
    const { store, clock } = finishedJob();
    clock.t += TTL;
    expect(store.sweepExpired()).toEqual({ expired: 0, swept: 0 });
    expect(store.get('job-1', TOKEN_A)?.kind).toBe('job');
    clock.t += 1;
    expect(store.sweepExpired()).toEqual({ expired: 1, swept: 0 });
    expect(store.get('job-1', TOKEN_A)?.kind).toBe('expired');
  });

  it('expired + right session reads as expired; wrong session reads like missing', () => {
    const { store, clock } = finishedJob();
    clock.t += TTL + 1;
    store.sweepExpired();
    expect(store.get('job-1', TOKEN_A)).toEqual({
      kind: 'expired',
      jobId: 'job-1',
      status: 'expired',
      expiredAt: clock.t,
    });
    expect(store.get('job-1', TOKEN_B)).toBeNull();
    expect(store.get('job-1', TOKEN_B)).toEqual(store.get('nope', TOKEN_A));
  });

  it('does not expire a job that is still running, however old (until MAX_RUN_MS)', () => {
    const { store, clock } = makeStore({ jobTtlMs: TTL });
    store.create(input());
    store.setStatus('job-1', 'running');
    clock.t += MAX_RUN_MS;
    expect(store.sweepExpired()).toEqual({ expired: 0, swept: 0 });
  });
});

describe('Tombstone content', () => {
  afterEach(() => vi.restoreAllMocks());

  it('has exactly the six keys and no notes, result or raw secrets', () => {
    const captured: unknown[] = [];
    const realSet = Map.prototype.set;
    vi.spyOn(Map.prototype, 'set').mockImplementation(function (this: Map<unknown, unknown>, k, v) {
      if (typeof v === 'object' && v !== null && 'expiredAt' in v) captured.push(v);
      return realSet.call(this, k, v);
    });
    const { store, clock } = makeStore({ jobTtlMs: TTL });
    store.create(input());
    store.setStatus('job-1', 'completed', { result: { secretResult: 'RESULT-BODY' } as never });
    clock.t += TTL + 1;
    store.sweepExpired();

    expect(captured).toHaveLength(1);
    const stone = captured[0] as Record<string, unknown>;
    expect(Object.keys(stone).sort()).toEqual(
      ['expiredAt', 'idempotencyKeyHash', 'jobId', 'requestDigest', 'sessionHash', 'status'].sort(),
    );
    expect(stone).toMatchObject({
      jobId: 'job-1',
      sessionHash: sha256Hex(TOKEN_A),
      idempotencyKeyHash: sha256Hex(KEY_1),
      status: 'expired',
      expiredAt: clock.t,
    });
    const text = JSON.stringify(stone);
    for (const secret of [NOTES, 'RESULT-BODY', TOKEN_A, KEY_1]) expect(text).not.toContain(secret);
  });

  it('the public expired reads carry no content or raw secrets', () => {
    const { store, clock } = finishedJob();
    clock.t += TTL + 1;
    store.sweepExpired();
    const view = store.get('job-1', TOKEN_A);
    const replay = store.create(input());
    expect(Object.keys(view ?? {}).sort()).toEqual(['expiredAt', 'jobId', 'kind', 'status']);
    expect(replay).toEqual({ kind: 'replay-expired', jobId: 'job-1', status: 'expired' });
    for (const v of [view, replay]) {
      const text = JSON.stringify(v);
      for (const secret of [NOTES, TOKEN_A, KEY_1]) expect(text).not.toContain(secret);
    }
  });
});

describe('Tombstone_TTL sweep', () => {
  it('keeps the tombstone at exactly 24h and deletes it one ms later (rule: now - expiredAt > TTL)', () => {
    const { store, clock } = finishedJob();
    clock.t += TTL + 1;
    store.sweepExpired(); // tombstoned at this time
    clock.t += TOMBSTONE_TTL_MS;
    expect(store.sweepExpired()).toEqual({ expired: 0, swept: 0 });
    expect(store.get('job-1', TOKEN_A)?.kind).toBe('expired');
    clock.t += 1;
    expect(store.sweepExpired()).toEqual({ expired: 0, swept: 1 });
    expect(store.get('job-1', TOKEN_A)).toBeNull();
  });
});

describe('idempotency after expiry', () => {
  it('answers replay-expired with zero reservations and zero Provider calls', async () => {
    const { store, clock } = makeStore({ jobTtlMs: TTL });
    const { ledger, provider, startJob } = makeSpend();
    expect((await startJob(store, input())).kind).toBe('new');
    store.setStatus('job-1', 'completed');
    clock.t += TTL + 1;
    store.sweepExpired();

    const again = await startJob(store, input());
    expect(again).toEqual({ kind: 'replay-expired', jobId: 'job-1', status: 'expired' });
    expect(ledger.reservations).toBe(1);
    expect(provider.calls).toBe(1);
  });

  it('conflicts on a different digest after expiry, spending nothing', async () => {
    const { store, clock } = makeStore({ jobTtlMs: TTL });
    const { ledger, provider, startJob } = makeSpend();
    await startJob(store, input());
    store.setStatus('job-1', 'completed');
    clock.t += TTL + 1;
    store.sweepExpired();
    expect((await startJob(store, input({ requestDigest: DIGEST_2 }))).kind).toBe('conflict');
    expect(ledger.reservations).toBe(1);
    expect(provider.calls).toBe(1);
  });

  it('starts a new job after the tombstone sweep', async () => {
    const { store, clock } = makeStore({ jobTtlMs: TTL });
    const { ledger, provider, startJob } = makeSpend();
    await startJob(store, input());
    store.setStatus('job-1', 'completed');
    clock.t += TTL + 1;
    store.sweepExpired();
    clock.t += TOMBSTONE_TTL_MS + 1;
    store.sweepExpired();
    const again = await startJob(store, input());
    expect(again.kind).toBe('new');
    if (again.kind === 'new') expect(again.job.id).toBe('job-2');
    expect(ledger.reservations).toBe(2);
    expect(provider.calls).toBe(2);
  });

  it('a different session with the same key starts its own job after expiry', () => {
    const { store, clock } = finishedJob();
    clock.t += TTL + 1;
    store.sweepExpired();
    expect(store.create(input({ sessionToken: TOKEN_B })).kind).toBe('new');
  });
});

describe('max run time', () => {
  it('does not fail at exactly MAX_RUN_MS, fails one ms later (rule: now - createdAt > MAX_RUN_MS)', () => {
    const { store, clock } = makeStore();
    store.create(input());
    store.setStatus('job-1', 'running');
    clock.t += MAX_RUN_MS;
    store.sweepExpired();
    const at = store.get('job-1', TOKEN_A);
    expect(at?.kind === 'job' && at.job.status).toBe('running');
    clock.t += 1;
    store.sweepExpired();
    const after = store.get('job-1', TOKEN_A);
    expect(after?.kind === 'job' && after.job).toMatchObject({
      status: 'failed',
      failure: 'generation-failed',
      terminalAtMs: clock.t,
    });
  });

  it('fails a stuck queued job too, and a late pipeline result does not overwrite it', () => {
    const { store, clock } = makeStore();
    store.create(input());
    clock.t += MAX_RUN_MS + 1;
    store.sweepExpired();
    expect(store.setStatus('job-1', 'completed', { result: { late: true } as never })).toBe(true);
    const view = store.get('job-1', TOKEN_A);
    expect(view?.kind === 'job' && view.job).toMatchObject({ status: 'failed', result: null });
  });

  it('a failed stuck job frees the session and later expires on the Job_TTL', () => {
    const { store, clock } = makeStore({ jobTtlMs: TTL });
    store.create(input());
    clock.t += MAX_RUN_MS + 1;
    store.sweepExpired();
    expect(store.create(input({ idempotencyKey: KEY_2 })).kind).toBe('new');
    clock.t += TTL + 1;
    expect(store.sweepExpired().expired).toBe(1);
    expect(store.get('job-1', TOKEN_A)?.kind).toBe('expired');
  });
});

describe('limits', () => {
  it('constants', () => {
    expect(MAX_ACTIVE_JOBS_PER_SESSION).toBe(1);
    expect(MAX_LIVE_JOBS).toBe(20);
  });

  it('refuses a second active job for the session, with no reservation or Provider call', async () => {
    const { store } = makeStore();
    const { ledger, provider, startJob } = makeSpend();
    await startJob(store, input());
    expect((await startJob(store, input({ idempotencyKey: KEY_2 }))).kind).toBe('session-busy');
    expect(ledger.reservations).toBe(1);
    expect(provider.calls).toBe(1);
  });

  it('allows a new job once the first is terminal', () => {
    const { store } = makeStore();
    store.create(input());
    store.setStatus('job-1', 'failed', { failure: 'generation-failed' });
    expect(store.create(input({ idempotencyKey: KEY_2 })).kind).toBe('new');
  });

  it('still answers a replay and a conflict while the session is busy', () => {
    const { store } = makeStore();
    store.create(input());
    expect(store.create(input()).kind).toBe('replay');
    expect(store.create(input({ requestDigest: DIGEST_2 })).kind).toBe('conflict');
  });

  it('refuses at capacity, answers replay at capacity, counts finished jobs, and spends nothing', async () => {
    const { store, clock } = makeStore({ jobTtlMs: TTL });
    const { ledger, provider, startJob } = makeSpend();
    for (let i = 0; i < MAX_LIVE_JOBS; i += 1) {
      const r = await startJob(store, input({ sessionToken: `tok-${i}`, idempotencyKey: `k-${i}` }));
      expect(r.kind).toBe('new');
    }
    expect(ledger.reservations).toBe(MAX_LIVE_JOBS);
    const extra = input({ sessionToken: 'tok-extra', idempotencyKey: 'k-extra' });
    expect((await startJob(store, extra)).kind).toBe('capacity');
    // replay of an existing job is still answered
    expect(store.create(input({ sessionToken: 'tok-0', idempotencyKey: 'k-0' })).kind).toBe('replay');
    // finished jobs still count until the Job_TTL passes
    store.setStatus('job-1', 'completed');
    expect(store.create(extra).kind).toBe('capacity');
    expect(ledger.reservations).toBe(MAX_LIVE_JOBS);
    expect(provider.calls).toBe(MAX_LIVE_JOBS);
    clock.t += TTL + 1;
    store.sweepExpired();
    expect(store.create(extra).kind).toBe('new');
  });

  it('answers session-busy before capacity', () => {
    const { store } = makeStore();
    for (let i = 0; i < MAX_LIVE_JOBS; i += 1) {
      store.create(input({ sessionToken: `tok-${i}`, idempotencyKey: `k-${i}` }));
    }
    expect(store.create(input({ sessionToken: 'tok-0', idempotencyKey: 'other' })).kind).toBe('session-busy');
  });
});
