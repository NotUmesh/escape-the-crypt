import { describe, expect, it } from 'vitest';
import { requestDigest, sha256Hex } from './job-store';
import {
  DIGEST_1,
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

describe('requestDigest and sha256Hex', () => {
  it('ignores key order and differs for different bodies', () => {
    expect(requestDigest({ a: 1, b: { c: 2, d: 3 } })).toBe(requestDigest({ b: { d: 3, c: 2 }, a: 1 }));
    expect(requestDigest({ a: 1 })).not.toBe(requestDigest({ a: 2 }));
  });

  it('sha256Hex matches a known vector', () => {
    expect(sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
});

describe('create', () => {
  it('starts a queued job, stores hashes only', () => {
    const { store, clock } = makeStore();
    const r = store.create(input());
    expect(r.kind).toBe('new');
    if (r.kind !== 'new') return;
    expect(r.job).toMatchObject({
      id: 'job-1',
      status: 'queued',
      createdAtMs: clock.t,
      terminalAtMs: null,
      failure: null,
      result: null,
      notesText: NOTES,
      sessionHash: sha256Hex(TOKEN_A),
      idempotencyKeyHash: sha256Hex(KEY_1),
    });
  });

  it('replays the same session, key and digest without a second job', () => {
    const { store } = makeStore();
    store.create(input());
    const again = store.create(input());
    expect(again.kind).toBe('replay');
    if (again.kind === 'replay') expect(again.job.id).toBe('job-1');
  });

  it('conflicts on the same key with a different digest', () => {
    const { store } = makeStore();
    store.create(input());
    expect(store.create(input({ requestDigest: DIGEST_2 })).kind).toBe('conflict');
  });

  it('binds keys to the session: another session with the same key starts its own job', () => {
    const { store } = makeStore();
    store.create(input());
    const other = store.create(input({ sessionToken: TOKEN_B }));
    expect(other.kind).toBe('new');
    if (other.kind === 'new') expect(other.job.id).toBe('job-2');
  });
});

describe('get', () => {
  it('returns the job for the right session', () => {
    const { store } = makeStore();
    store.create(input());
    const view = store.get('job-1', TOKEN_A);
    expect(view?.kind).toBe('job');
  });

  it('answers a wrong session exactly like a missing ID', () => {
    const { store } = makeStore();
    store.create(input());
    expect(store.get('job-1', TOKEN_B)).toBeNull();
    expect(store.get('no-such-job', TOKEN_A)).toBeNull();
    expect(store.get('job-1', TOKEN_B)).toEqual(store.get('no-such-job', TOKEN_A));
  });
});

describe('privacy of stored state', () => {
  it('never exposes the raw token or raw idempotency key', () => {
    const { store } = makeStore();
    const created = store.create(input());
    store.setStatus('job-1', 'running');
    const views = [created, store.create(input()), store.get('job-1', TOKEN_A)];
    for (const v of views) {
      const text = JSON.stringify(v);
      expect(text).not.toContain(TOKEN_A);
      expect(text).not.toContain(KEY_1);
      expect(text).toContain(sha256Hex(TOKEN_A));
      expect(text).toContain(sha256Hex(KEY_1));
    }
  });
});

describe('setStatus', () => {
  it('returns false for an unknown job and true for a known one', () => {
    const { store } = makeStore();
    expect(store.setStatus('nope', 'running')).toBe(false);
    store.create(input());
    expect(store.setStatus('job-1', 'running')).toBe(true);
  });

  it('keeps the first terminal outcome', () => {
    const { store, clock } = makeStore();
    store.create(input());
    clock.t += 5;
    store.setStatus('job-1', 'cancelled', { failure: 'cancelled' });
    clock.t += 5;
    store.setStatus('job-1', 'completed', { failure: null });
    const view = store.get('job-1', TOKEN_A);
    expect(view?.kind === 'job' && view.job.status).toBe('cancelled');
    expect(view?.kind === 'job' && view.job.failure).toBe('cancelled');
    expect(view?.kind === 'job' && view.job.terminalAtMs).toBe(1_000_005);
  });
});

describe('no reservations or Provider calls outside a new job', () => {
  it('reserves and calls the Provider once for new, never for any other outcome', async () => {
    const { store } = makeStore();
    const { ledger, provider, startJob } = makeSpend();

    expect((await startJob(store, input())).kind).toBe('new');
    expect(ledger.reservations).toBe(1);
    expect(provider.calls).toBe(1);

    const others = [
      input(), // replay
      input({ requestDigest: DIGEST_2 }), // conflict
      input({ idempotencyKey: KEY_2 }), // session-busy
    ];
    const kinds: string[] = [];
    for (const o of others) kinds.push((await startJob(store, o)).kind);
    expect(kinds).toEqual(['replay', 'conflict', 'session-busy']);
    expect(ledger.reservations).toBe(1);
    expect(ledger.refusals).toBe(0);
    expect(provider.calls).toBe(1);
  });
});

describe('digest constants', () => {
  it('are distinct', () => {
    expect(DIGEST_1).not.toBe(DIGEST_2);
  });
});
