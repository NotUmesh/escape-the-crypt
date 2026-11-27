import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { GENERATION_COPY, ROOM_PLAY_LABELS, RUN_SETUP_COPY } from '@escape-the-crypt/core';
import { installFakeWorker, SAMPLE_NOTES } from './fake-worker';

// The length and difficulty choice before a crypt is made: no axe violations, rows of at least
// 44 px, chosen by keyboard alone, and the choice reaches the worker and the run.
//
// In Playwright's Firefox, polling with expect(...).toBeVisible() around an axe scan can crash the
// page, so the waits around the scan use locator.waitFor() and one-shot reads.

const checkedLabel = async (page: import('@playwright/test').Page, legend: string): Promise<string> =>
  page.evaluate((text) => {
    const fieldset = Array.from(document.querySelectorAll('fieldset')).find((f) => f.querySelector('legend')?.textContent === text);
    const checked = fieldset?.querySelector<HTMLInputElement>('input[type="radio"]:checked');
    return checked?.closest('label')?.querySelector('.run-settings__label')?.textContent ?? '';
  }, legend);

test('run settings: axe clean, 44 px rows, keyboard only, and the choice reaches the run', async ({ page }) => {
  test.setTimeout(90_000);
  const fake = await installFakeWorker(page, [{ status: 'running' }, { status: 'completed' }]);
  await page.goto('/ingest');
  await page.locator('.ingest-paste textarea').fill(SAMPLE_NOTES);
  await page.getByRole('button', { name: 'Confirm notes' }).click();
  const settings = page.getByTestId('run-settings');
  await settings.waitFor();

  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
  expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`)).toEqual([]);

  for (const row of await settings.locator('label.run-settings__option').all()) {
    const box = await row.boundingBox();
    if (box === null) throw new Error('an option row has no layout box');
    expect(box.height).toBeGreaterThanOrEqual(44);
  }
  expect(await checkedLabel(page, RUN_SETUP_COPY.lengthLegend)).toBe('Short');
  expect(await checkedLabel(page, RUN_SETUP_COPY.difficultyLegend)).toBe('Apprentice');

  // Keyboard only: Tab into the length group, arrows to Standard; Tab to the difficulty group, arrows to Lich.
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  const shortRadio = settings.getByRole('radio', { name: /Short/ });
  for (let i = 0; i < 40; i += 1) {
    if (await shortRadio.evaluate((el) => el === document.activeElement)) break;
    await page.keyboard.press('Tab');
  }
  expect(await shortRadio.evaluate((el) => el === document.activeElement)).toBe(true);
  await page.keyboard.press('ArrowDown');
  expect(await checkedLabel(page, RUN_SETUP_COPY.lengthLegend)).toBe('Standard');
  await page.keyboard.press('Tab');
  expect(await settings.getByRole('radio', { name: /Apprentice/ }).evaluate((el) => el === document.activeElement)).toBe(true);
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  expect(await checkedLabel(page, RUN_SETUP_COPY.difficultyLegend)).toBe('Lich');

  await page.getByRole('button', { name: GENERATION_COPY.generateButton }).click();
  await page.locator('.room-screen').waitFor({ timeout: 30_000 });
  const post = fake.seen.find((request) => request.method === 'POST');
  expect((JSON.parse(post?.body ?? '{}') as { runLength?: string }).runLength).toBe('standard');
  // The fake answers with the one-room sample crypt: Standard asked for 3, so it is shortened, and Lich has no hints.
  await page.getByTestId('crypt-shortened').waitFor();
  expect(await page.getByTestId('crypt-shortened').innerText()).toBe(ROOM_PLAY_LABELS.cryptShortened(1, 3));
  expect(await page.locator('.room-screen__hints').count()).toBe(0);
});
