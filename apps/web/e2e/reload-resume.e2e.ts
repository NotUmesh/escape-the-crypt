import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { ROOM_PLAY_LABELS } from '@escape-the-crypt/core';
import { NOTES_TEXT, buildSampleCrypt, correctAnswerFor, enterCrypt, openLockName, roomOneSlots, submitAnswer } from './crypt-helpers';

interface ScreenSnapshot {
  readonly lockNames: readonly string[];
  readonly lockStatuses: readonly (string | null)[];
  readonly status: string;
  readonly ghostText: string;
  readonly panelText: string;
  readonly optionValues: readonly string[];
  readonly optionLabels: readonly string[];
}

/** What the learner sees: every lock, the status line, the open panel's text and its option order. */
async function snapshot(page: Page): Promise<ScreenSnapshot> {
  const locks = page.locator('.room-screen__lock-button');
  const options = page.getByTestId('panel-slot').locator('input[type="radio"]');
  const optionValues = await options.evaluateAll((els) => els.map((el) => (el as HTMLInputElement).value));
  const optionLabels = await options.evaluateAll((els) => els.map((el) => (el as HTMLInputElement).labels?.[0]?.textContent?.trim() ?? ''));
  return {
    lockNames: (await locks.evaluateAll((els) => els.map((el) => el.getAttribute('aria-label') ?? el.textContent ?? ''))).map((s) => s.trim()),
    lockStatuses: await locks.evaluateAll((els) => els.map((el) => el.getAttribute('data-status'))),
    status: ((await page.getByTestId('slot-status').innerText()) ?? '').trim(),
    ghostText: (await page.getByTestId('ghost-list').allInnerTexts()).join('|').trim(),
    panelText: (await page.getByTestId('panel-slot').innerText()).trim(),
    optionValues,
    optionLabels,
  };
}

test('reload mid-run, then Continue your crypt: the same screen comes back', async ({ page }) => {
  const crypt = buildSampleCrypt();
  const [first, second] = roomOneSlots(crypt);
  if (first === undefined || second === undefined) throw new Error('room 1 needs two lock slots');

  // No provider and no worker endpoint may be called during this spec.
  const workerCalls: string[] = [];
  await page.route('http://127.0.0.1:8799/**', (route) => {
    workerCalls.push(route.request().url());
    return route.abort();
  });

  await enterCrypt(page);

  // Three events: open the first lock, answer it correctly, continue from its evidence.
  await page.getByRole('button', { name: openLockName(first.stationType), exact: true }).click();
  await submitAnswer(page, correctAnswerFor(crypt, first.primaryQuestion));
  await page.getByRole('button', { name: ROOM_PLAY_LABELS.continue, exact: true }).click();
  await expect(page.locator('.room-screen__lock-button').first()).toHaveAttribute('data-status', 'solved');

  // Leave the second lock open so a question and its options are on screen.
  await page.getByRole('button', { name: openLockName(second.stationType), exact: true }).click();
  await expect(page.getByTestId('panel-slot').locator('.question-panel')).toBeVisible();
  const before = await snapshot(page);
  expect(before.lockStatuses).toContain('solved');

  // Let the autosave settle, then reload.
  await page.waitForTimeout(500);
  await page.reload();
  // The app opens on /ingest; the start screen (and its resume entry) shows once the notes are confirmed again.
  await page.locator('.ingest-paste textarea').fill(NOTES_TEXT);
  await page.getByRole('button', { name: 'Confirm notes' }).click();
  await page.getByRole('button', { name: 'Continue your crypt', exact: true }).click();
  await page.locator('.room-screen__lock-button').first().waitFor();

  // The run state is restored: same locks, same solved/open statuses, same candle and ghost lines.
  // Which panel is open is screen state held in the room view, so the learner reopens the lock.
  const restored = await snapshot(page);
  expect(restored.lockNames).toEqual(before.lockNames);
  expect(restored.lockStatuses).toEqual(before.lockStatuses);
  expect(restored.ghostText).toEqual(before.ghostText);

  await page.getByRole('button', { name: openLockName(second.stationType), exact: true }).click();
  await expect(page.getByTestId('panel-slot').locator('.question-panel')).toBeVisible();
  const after = await snapshot(page);
  expect(after).toEqual(before);
  expect(workerCalls).toEqual([]);
});
