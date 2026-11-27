import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { ENTER_CRYPT_LABEL } from '@escape-the-crypt/core';
import { NOTES_TEXT, skipDescent } from './crypt-helpers';

// Requirements 9.8 and 12.13: the read-only screen has no axe violations and focus lands on
// "Take over here".
//
// Both pages share one browser context (Web Locks and IndexedDB are per origin). Tab 1 starts a
// crypt and holds the run lock. Tab 2 opens the app, confirms the same notes and chooses
// "Continue your crypt". The run is held by tab 1, so tab 2 shows the read-only screen.
//
// In Playwright's Firefox, polling with expect(...).toBeVisible() around an axe scan crashes the
// page. Tab 2 uses locator.waitFor() and one-shot reads instead.

const READ_ONLY_TITLE = 'This crypt is open in another tab';
const TAKE_OVER_LABEL = 'Take over here';

async function confirmNotes(page: Page): Promise<void> {
  await page.goto('/ingest');
  await page.locator('.ingest-paste textarea').fill(NOTES_TEXT);
  await page.getByRole('button', { name: 'Confirm notes' }).click();
}

test('read-only screen: no axe violations and focus on Take over here', async ({ context, page }) => {
  await confirmNotes(page);
  await page.getByRole('button', { name: ENTER_CRYPT_LABEL }).click();
  await skipDescent(page);
  await page.locator('.room-screen').waitFor();
  await page.locator('.room-screen__lock-button').first().waitFor();

  // Tab 1 takes the run lock when the run starts; wait until it is held before opening tab 2.
  const held = await page.evaluate(async () => {
    for (let i = 0; i < 100; i += 1) {
      const snapshot = await navigator.locks.query();
      if ((snapshot.held ?? []).some((l) => l.name?.startsWith('run:'))) return true;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    return false;
  });
  if (!held) throw new Error('Tab 1 never acquired a run lock');

  const other = await context.newPage();
  // The saved crypt is on the desk's book stack, so tab 2 opens the desk, not the notes book.
  await other.goto('/');
  await other.getByRole('button', { name: 'Continue your crypt', exact: true }).click();
  await other.getByTestId('read-only-screen').waitFor();
  const takeOver = other.getByRole('button', { name: TAKE_OVER_LABEL, exact: true });
  await takeOver.waitFor();

  const heading = other.getByTestId('read-only-screen').getByRole('heading', { level: 2 });
  expect((await heading.innerText()).trim()).toBe(READ_ONLY_TITLE);
  // Focus moves to "Take over here" on mount; give React a frame, then read it once.
  await other.waitForFunction(
    (label) => document.activeElement?.textContent?.trim() === label,
    TAKE_OVER_LABEL,
  );
  expect(await takeOver.evaluate((el) => el === document.activeElement)).toBe(true);

  const results = await new AxeBuilder({ page: other })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze();
  expect(results.passes.length).toBeGreaterThan(10);
  expect(
    results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`),
  ).toEqual([]);

  // Tab 1 still holds the run: it is still on the room screen, not the read-only screen.
  expect(await page.getByTestId('read-only-screen').count()).toBe(0);
});
