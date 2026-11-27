import { describe, expect, it } from 'vitest';
import type { Provider, ProviderRequest, ProviderResult } from '../provider/types';
import { DEFAULT_CONCURRENCY, runWithConcurrency } from './concurrency';

interface Deferred<T> {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

const flush = async (): Promise<void> => {
  for (let i = 0; i < 20; i += 1) await Promise.resolve();
};

const request: ProviderRequest = {
  stage: 'review',
  promptVersion: 'v1',
  modelId: 'fake-model',
  system: 's',
  messages: [{ role: 'user', content: 'q' }],
  temperature: 0,
  maxOutputTokens: 10,
  jsonSchema: {},
  timeoutMs: 100,
  retryLimit: 0,
};

/** Fake provider whose calls resolve only when the test releases them; tracks peak in-flight. */
function gatedProvider() {
  const gates: Array<Deferred<ProviderResult>> = [];
  const stats = { inFlight: 0, peak: 0, started: 0 };
  const provider: Provider = {
    async complete(): Promise<ProviderResult> {
      const gate = deferred<ProviderResult>();
      gates.push(gate);
      stats.started += 1;
      stats.inFlight += 1;
      stats.peak = Math.max(stats.peak, stats.inFlight);
      const result = await gate.promise;
      stats.inFlight -= 1;
      return result;
    },
  };
  return { provider, gates, stats };
}

const okResult = (n: number): ProviderResult => ({
  ok: true,
  json: { n },
  usage: { inputTokens: n, outputTokens: n },
});

describe('runWithConcurrency', () => {
  it('never exceeds 4 simultaneous provider calls and completes all 10', async () => {
    const { provider, gates, stats } = gatedProvider();
    const tasks = Array.from({ length: 10 }, () => () => provider.complete(request));
    const run = runWithConcurrency(tasks, 4);

    await flush();
    expect(stats.inFlight).toBe(4);

    let released = 0;
    while (released < 10) {
      await flush();
      const gate = gates[released];
      if (gate === undefined) break;
      gate.resolve(okResult(released));
      released += 1;
      await flush();
      expect(stats.inFlight).toBeLessThanOrEqual(4);
    }

    const outcomes = await run;
    expect(stats.peak).toBe(4);
    expect(stats.started).toBe(10);
    expect(outcomes.every((o) => o.ok)).toBe(true);
  });

  it('defaults to a limit of 4', async () => {
    expect(DEFAULT_CONCURRENCY).toBe(4);
    const { provider, gates, stats } = gatedProvider();
    const run = runWithConcurrency(Array.from({ length: 8 }, () => () => provider.complete(request)));
    await flush();
    expect(stats.inFlight).toBe(4);
    for (let i = 0; i < 8; i += 1) {
      await flush();
      gates[i]?.resolve(okResult(i));
    }
    await run;
    expect(stats.peak).toBe(4);
  });

  it('preserves result order when tasks finish out of order', async () => {
    const gates = [deferred<number>(), deferred<number>(), deferred<number>()];
    const run = runWithConcurrency(
      gates.map((g) => () => g.promise),
      3,
    );
    await flush();
    gates[2]?.resolve(30);
    gates[0]?.resolve(10);
    gates[1]?.resolve(20);
    const outcomes = await run;
    expect(outcomes).toEqual([
      { ok: true, value: 10 },
      { ok: true, value: 20 },
      { ok: true, value: 30 },
    ]);
  });

  it('turns a throwing or rejecting task into task-rejected with no message', async () => {
    const outcomes = await runWithConcurrency<number>(
      [
        () => Promise.resolve(1),
        () => {
          throw new Error('secret user content');
        },
        () => Promise.reject(new Error('another secret')),
        () => Promise.resolve(4),
      ],
      2,
    );
    expect(outcomes).toEqual([
      { ok: true, value: 1 },
      { ok: false, error: { kind: 'task-rejected' } },
      { ok: false, error: { kind: 'task-rejected' } },
      { ok: true, value: 4 },
    ]);
    expect(JSON.stringify(outcomes)).not.toContain('secret');
  });

  it('runs strictly one at a time with limit 1', async () => {
    const { provider, gates, stats } = gatedProvider();
    const run = runWithConcurrency(Array.from({ length: 3 }, () => () => provider.complete(request)), 1);
    for (let i = 0; i < 3; i += 1) {
      await flush();
      expect(stats.inFlight).toBe(1);
      gates[i]?.resolve(okResult(i));
    }
    await run;
    expect(stats.peak).toBe(1);
  });

  it('starts all tasks at once when the limit exceeds the task count', async () => {
    const { provider, gates, stats } = gatedProvider();
    const run = runWithConcurrency(Array.from({ length: 3 }, () => () => provider.complete(request)), 100);
    await flush();
    expect(stats.inFlight).toBe(3);
    gates.forEach((g, i) => g.resolve(okResult(i)));
    await run;
    expect(stats.peak).toBe(3);
  });

  it('handles an empty task list', async () => {
    expect(await runWithConcurrency([], 4)).toEqual([]);
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    'falls back to the default limit for non-finite limit %s',
    async (limit) => {
      const { provider, gates, stats } = gatedProvider();
      const run = runWithConcurrency(Array.from({ length: 8 }, () => () => provider.complete(request)), limit);
      await flush();
      expect(stats.inFlight).toBe(4);
      for (let i = 0; i < 8; i += 1) {
        await flush();
        gates[i]?.resolve(okResult(i));
      }
      const outcomes = await run;
      expect(stats.peak).toBe(4);
      expect(outcomes).toHaveLength(8);
    },
  );

  it.each([0, -3])('treats limit %s as 1', async (limit) => {
    const { provider, gates, stats } = gatedProvider();
    const run = runWithConcurrency(Array.from({ length: 2 }, () => () => provider.complete(request)), limit);
    await flush();
    expect(stats.inFlight).toBe(1);
    for (let i = 0; i < 2; i += 1) {
      await flush();
      gates[i]?.resolve(okResult(i));
    }
    await run;
    expect(stats.peak).toBe(1);
  });
});
