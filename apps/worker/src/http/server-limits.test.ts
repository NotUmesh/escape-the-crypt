import { afterEach, describe, expect, it } from 'vitest';
import { MAX_LIVE_JOBS } from '../jobs/job-store';
import { DEFAULT_MAX_BODY_BYTES } from './routes-jobs';
import { KEY, KEY_2, TOKEN, closeAll, deferred, gatedPipeline, heartBody, startHarness } from './http-test-support';

afterEach(closeAll);

const NO_STORE = 'private, no-store';

describe('request limits', () => {
  it('caps the body at 256 KB by default', () => {
    expect(DEFAULT_MAX_BODY_BYTES).toBe(256 * 1024);
  });

  it('answers 413 to a 300 KB body with the default limit, with no work', async () => {
    const h = await startHarness();
    const res = await h.post(JSON.stringify({ notesText: 'a'.repeat(300 * 1024), runLength: 'short' }));
    expect(res.status).toBe(413);
    expect(res.json).toMatchObject({ error: 'payload-too-large' });
    expect(res.headers.get('cache-control')).toBe(NO_STORE);
    expect(h.runs()).toBe(0);
    expect(h.ledger.reservations).toBe(0);
    expect(h.provider.calls).toBe(0);
  });

  it('rejects a body over the limit with 413 and no work', async () => {
    const h = await startHarness({ maxBodyBytes: 1024 });
    const res = await h.post(JSON.stringify({ notesText: 'a'.repeat(2048), runLength: 'short' }));
    expect(res.status).toBe(413);
    expect(res.json).toMatchObject({ error: 'payload-too-large' });
    expect(res.headers.get('cache-control')).toBe(NO_STORE);
    expect(h.runs()).toBe(0);
    expect(h.ledger.reservations).toBe(0);
    expect(h.provider.calls).toBe(0);
  });

  it('rejects more than 6,000 words with 413 notes-too-long and no work', async () => {
    const h = await startHarness();
    const notesText = Array.from({ length: 6001 }, () => 'word').join(' ');
    const res = await h.post({ notesText, runLength: 'short' });
    expect(res.status).toBe(413);
    expect(res.json).toMatchObject({ error: 'notes-too-long' });
    expect(res.headers.get('cache-control')).toBe(NO_STORE);
    expect(h.runs()).toBe(0);
    expect(h.ledger.reservations).toBe(0);
    expect(h.provider.calls).toBe(0);
  });
});

describe('429', () => {
  it('answers session-busy for a second job while the first runs', async () => {
    const gate = deferred();
    const pending = gatedPipeline(gate.promise);
    const h = await startHarness({ runPipeline: pending });
    expect((await h.post(heartBody)).status).toBe(202);
    const second = await h.post(
      { notesText: 'A second set of notes about something else.', runLength: 'short' },
      { 'Idempotency-Key': KEY_2 },
    );
    expect(second.status).toBe(429);
    expect(second.json).toMatchObject({ error: 'session-busy' });
    expect(second.headers.get('cache-control')).toBe(NO_STORE);
    expect(h.runs()).toBe(1);
    expect(h.ledger.reservations).toBe(0);
    expect(h.provider.calls).toBe(0);
    gate.release();
  });

  // Each session comes from its own address, so the per-IP limit is not what refuses it.
  it('answers capacity once the store is full, from a new session', async () => {
    const gate = deferred();
    const pending = gatedPipeline(gate.promise);
    const h = await startHarness({ runPipeline: pending });
    for (let i = 0; i < MAX_LIVE_JOBS; i += 1) {
      const res = await h.post(heartBody, { 'X-Session-Token': `${TOKEN}-${i}`, 'X-Forwarded-For': `10.0.0.${i}` });
      expect(res.status).toBe(202);
    }
    const over = await h.post(heartBody, { 'X-Session-Token': `${TOKEN}-over`, 'Idempotency-Key': KEY, 'X-Forwarded-For': '10.0.1.1' });
    expect(over.status).toBe(429);
    expect(over.json).toMatchObject({ error: 'capacity' });
    expect(over.headers.get('cache-control')).toBe(NO_STORE);
    expect(h.runs()).toBe(MAX_LIVE_JOBS);
    expect(h.ledger.reservations).toBe(0);
    expect(h.provider.calls).toBe(0);
    gate.release();
  });
});
