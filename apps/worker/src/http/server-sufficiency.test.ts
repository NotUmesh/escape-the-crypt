import { afterEach, describe, expect, it } from 'vitest';
import { mapFailure } from './job-runner';
import { FAILURE_COPY } from './copy';
import { closeAll, failingPipeline, heartBody, startHarness } from './http-test-support';

afterEach(closeAll);

interface FailedBody {
  readonly status: string;
  readonly failure: { readonly kind: string; readonly message: string };
}

async function failedBody(error: Parameters<typeof failingPipeline>[0]) {
  const h = await startHarness({ runPipeline: failingPipeline(error) });
  const created = await h.post(heartBody);
  const done = await h.waitDone((created.json as { jobId: string }).jobId);
  return { h, body: done.json as FailedBody };
}

describe('insufficient-concepts', () => {
  it('maps to the existing not-enough-material kind', () => {
    expect(mapFailure({ kind: 'insufficient-concepts', found: 1 })).toBe('not-enough-material');
  });

  it('appends the count sentence to the failure message', async () => {
    const { h, body } = await failedBody({ kind: 'insufficient-concepts', found: 3 });
    expect(body.status).toBe('failed');
    expect(body.failure.kind).toBe('not-enough-material');
    expect(body.failure.message).toBe(
      `${FAILURE_COPY['not-enough-material']} Your notes gave us 3 topics we could ask about.`,
    );
    const line = h.logs.find((l) => l['errorKind'] === 'insufficient-concepts');
    expect(line).toMatchObject({ failure: 'not-enough-material', goodConcepts: 3 });
  });

  it('uses the singular for one topic', async () => {
    const { body } = await failedBody({ kind: 'insufficient-concepts', found: 1 });
    expect(body.failure.message).toContain('1 topic we could');
  });

  it('leaves the message unchanged when there is no count', async () => {
    const { body } = await failedBody({ kind: 'empty-room' });
    expect(body.failure.kind).toBe('not-enough-material');
    expect(body.failure.message).toBe(FAILURE_COPY['not-enough-material']);
  });
});
