import { describe, expect, it } from 'vitest';
import { buildManifest } from '../test-support/manifest-fixture';
import {
  JOB_FAILURE_KINDS,
  JOB_STATUSES,
  JobAckResponseSchema,
  JobErrorResponseSchema,
  JobStatusResponseSchema,
} from './job-response-schema';

const manifest = buildManifest({ rooms: 1, conceptsPerRoom: 2, lockTypes: ['rune-cipher', 'seance-board'] });
const entry = { prompt: 'p', excerpts: [{ chunkId: 'c1', quote: 'q' }], explanation: 'e' };
const bundle = { manifest, content: { questions: { q1: entry }, concepts: { k1: { title: 'T' } } }, unplacedAccepted: [] };
const failure = (kind: string) => ({ kind, message: 'm' });

describe('JobStatusResponseSchema', () => {
  it.each(['queued', 'running', 'cancelling', 'expired'])('accepts a bare %s body', (status) => {
    expect(JobStatusResponseSchema.safeParse({ jobId: 'j', status }).success).toBe(true);
  });

  it('accepts a completed body with a bundle', () => {
    expect(JobStatusResponseSchema.safeParse({ jobId: 'j', status: 'completed', bundle }).success).toBe(true);
  });

  it('accepts unplacedAccepted entries', () => {
    const question = {
      questionId: 'u1',
      lockType: 'rune-cipher',
      payload: { answer: 'heart', aliases: [], caseSensitive: false },
      evidenceRefs: ['c1'],
      hintEffect: null,
    };
    const body = {
      jobId: 'j',
      status: 'completed',
      bundle: { ...bundle, unplacedAccepted: [{ conceptId: 'k', conceptTitle: 'T', question, content: entry }] },
    };
    expect(JobStatusResponseSchema.safeParse(body).success).toBe(true);
  });

  it.each(['failed', 'cancelled'])('accepts %s with every failure kind', (status) => {
    for (const kind of JOB_FAILURE_KINDS) {
      expect(JobStatusResponseSchema.safeParse({ jobId: 'j', status, failure: failure(kind) }).success).toBe(true);
    }
  });

  it('rejects the old top-level shape, a string failure and a missing bundle', () => {
    const { manifest: m, content } = bundle;
    expect(JobStatusResponseSchema.safeParse({ jobId: 'j', status: 'completed', manifest: m, content }).success).toBe(false);
    expect(JobStatusResponseSchema.safeParse({ jobId: 'j', status: 'failed', failure: 'generation-failed' }).success).toBe(false);
    expect(JobStatusResponseSchema.safeParse({ jobId: 'j', status: 'completed' }).success).toBe(false);
    expect(JobStatusResponseSchema.safeParse({ jobId: 'j', status: 'failed' }).success).toBe(false);
  });

  it('rejects extra keys, a bundle on a running job and unknown statuses or kinds', () => {
    expect(JobStatusResponseSchema.safeParse({ jobId: 'j', status: 'running', extra: 1 }).success).toBe(false);
    expect(JobStatusResponseSchema.safeParse({ jobId: 'j', status: 'running', bundle }).success).toBe(false);
    expect(JobStatusResponseSchema.safeParse({ jobId: 'j', status: 'paused' }).success).toBe(false);
    expect(JobStatusResponseSchema.safeParse({ jobId: 'j', status: 'failed', failure: failure('oops') }).success).toBe(false);
    expect(JobStatusResponseSchema.safeParse({ status: 'queued' }).success).toBe(false);
    expect(
      JobStatusResponseSchema.safeParse({ jobId: 'j', status: 'completed', bundle: { ...bundle, extra: 1 } }).success,
    ).toBe(false);
  });
});

describe('JobAckResponseSchema', () => {
  it.each([...JOB_STATUSES, 'expired'])('accepts status %s without a bundle', (status) => {
    expect(JobAckResponseSchema.safeParse({ jobId: 'j', status }).success).toBe(true);
  });

  it('rejects a bundle, a failure and unknown statuses', () => {
    expect(JobAckResponseSchema.safeParse({ jobId: 'j', status: 'completed', bundle }).success).toBe(false);
    expect(JobAckResponseSchema.safeParse({ jobId: 'j', status: 'failed', failure: failure('cancelled') }).success).toBe(false);
    expect(JobAckResponseSchema.safeParse({ jobId: 'j', status: 'done' }).success).toBe(false);
  });
});

describe('JobErrorResponseSchema', () => {
  it('accepts the sendError body and nothing else', () => {
    expect(JobErrorResponseSchema.safeParse({ error: 'not-found', message: 'Nothing is here.' }).success).toBe(true);
    expect(JobErrorResponseSchema.safeParse({ error: 'not-found' }).success).toBe(false);
    expect(JobErrorResponseSchema.safeParse({ error: 'x', message: 'y', status: 404 }).success).toBe(false);
  });
});
