import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { ENTER_CRYPT_LABEL } from '@escape-the-crypt/core';
import { NOTES_TEXT } from './crypt-helpers';

// Requirements 9.8 and 12.13: the read-only screen has no axe violations and focus lands on
// "Take over here".
//
// Approach: the resume entry (task 7) does not exist yet, so a second tab cannot open the same run.
// Instead both pages share one browser context (Web Locks are per origin). Tab 1 starts a crypt and
// holds the run lock `run:<id>`. Tab 2 steals that lock with navigator.locks.request({ steal: true }),
// which puts tab 1 into `lost`, and tab 1 then renders the read-only screen that is scanned.
test('read-only screen: no axe violations and focus on Take over here', async ({ context, page }) => {
  await page.goto('/ingest');
  await page.locator('.ingest-paste textarea').fill(NOTES_TEXT);
  await page.getByRole('button', { name: 'Confirm notes' }).click();
  await page.getByRole('button', { name: ENTER_CRYPT_LABEL }).click();
  await page.locator('.room-screen').waitFor();

  // Wait until tab 1 holds a run lock, and read its name.
  const lockName = await page.evaluate(async () => {
    for (let i = 0; i < 100; i += 1) {
      const snapshot = await navigator.locks.query();
      const held = (snapshot.held ?? []).find((l) => l.name?.startsWith('run:'));
      if (held?.name !== undefined) return held.name;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    return null;
  });
  if (lockName === null) throw new Error('Tab 1 never acquired a run lock');

  const other = await context.newPage();
  await other.goto('/ingest');
  await other.evaluate((name) => {
    // Held for the rest of the page's life, so tab 1 cannot take it back on its own.
    void navigator.locks.request(name, { steal: true }, () => new Promise<void>(() => undefined));
  }, lockName);

  await expect(page.getByTestId('read-only-screen')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'This crypt is open in another tab' })).toBeVisible();
  const takeOver = page.getByRole('button', { name: 'Take over here' });
  await expect(takeOver).toBeFocused();

  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze();
  expect(results.passes.length).toBeGreaterThan(10);
  expect(
    results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`),
  ).toEqual([]);
});
