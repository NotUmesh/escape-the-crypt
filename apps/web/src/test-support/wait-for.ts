import { act } from 'react';

export interface WaitOptions {
  /** How long to keep polling before the test fails. Generous: a slow CI runner must not fail a correct test. */
  readonly timeoutMs?: number;
  readonly intervalMs?: number;
  /** Named in the failure, so a timeout says what never happened. */
  readonly what?: string;
}

/**
 * Polls `check` until it is true, letting React effects and pending IndexedDB work run between
 * tries (each try is wrapped in `act`). Use it in place of "wait a fixed time, then assert": a fixed
 * delay passes on a fast machine and fails on a slow one, and this does not. It cannot show that
 * something did NOT happen; for that, wait for the positive state first, then allow a short grace.
 */
export async function waitFor(check: () => boolean | Promise<boolean>, options: WaitOptions = {}): Promise<void> {
  const { timeoutMs = 3000, intervalMs = 10, what = 'the expected state' } = options;
  const deadline = Date.now() + timeoutMs;
  while (!(await check())) {
    if (Date.now() >= deadline) throw new Error(`timed out after ${timeoutMs} ms waiting for ${what}`);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    });
  }
}
