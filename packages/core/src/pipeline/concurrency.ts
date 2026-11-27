import type { Result } from '../types';

export const DEFAULT_CONCURRENCY = 4;

/**
 * Typed failure for a task that rejected despite the "tasks return results" contract.
 * Carries no message or stack, so nothing from the task can leak into logs (Req 11.7).
 */
export interface TaskRejectedError {
  readonly kind: 'task-rejected';
}

export type ConcurrencyOutcome<T> = Result<T, TaskRejectedError>;

function normaliseLimit(limit: number, taskCount: number): number {
  const whole = Number.isFinite(limit) ? Math.floor(limit) : DEFAULT_CONCURRENCY;
  return Math.min(Math.max(whole, 1), Math.max(taskCount, 1));
}

/**
 * Runs `tasks` with at most `limit` in flight (default 4, Req 11.6). Results keep the
 * input order. Never rejects: a task that throws or rejects becomes
 * `{ ok: false, error: { kind: 'task-rejected' } }`. Uses no timers.
 */
export async function runWithConcurrency<T>(
  tasks: ReadonlyArray<() => Promise<T>>,
  limit: number = DEFAULT_CONCURRENCY,
): Promise<ReadonlyArray<ConcurrencyOutcome<T>>> {
  const outcomes: Array<ConcurrencyOutcome<T> | undefined> = new Array<
    ConcurrencyOutcome<T> | undefined
  >(tasks.length).fill(undefined);
  let next = 0;

  const worker = async (): Promise<void> => {
    while (next < tasks.length) {
      const index = next;
      next += 1;
      const task = tasks[index];
      if (task === undefined) continue;
      try {
        outcomes[index] = { ok: true, value: await task() };
      } catch {
        outcomes[index] = { ok: false, error: { kind: 'task-rejected' } };
      }
    }
  };

  const workerCount = normaliseLimit(limit, tasks.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));

  return outcomes.map(
    (outcome): ConcurrencyOutcome<T> =>
      outcome ?? { ok: false, error: { kind: 'task-rejected' } },
  );
}
