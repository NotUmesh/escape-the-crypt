import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { CONFLICT_NOTICE_COPY, ENTER_CRYPT_LABEL, GENERATION_COPY, chunkDocument, conflictLeftOut, conflictNext } from '@escape-the-crypt/core';
import { skipDescent } from './crypt-helpers';
import { installFakeWorker, SAMPLE_NOTES } from './fake-worker';

// The notice on a generated crypt that left a topic out. The worker is answered by page.route and
// only sends the notice to a client that asks with ?notices=1, as the real one does. In Playwright's
// Firefox, polling with expect(...).toBeVisible() around an axe scan can crash the page, so the
// waits around a scan use locator.waitFor() and one-shot reads.

const TITLE = 'How the heart valves work';
const [, FIRST, SECOND] = chunkDocument({ sourceType: 'paste', text: SAMPLE_NOTES, originalText: SAMPLE_NOTES });
const firstWords = (text: string | undefined): string => (text ?? '').split(/\s+/).slice(0, 8).join(' ');

async function generateAndEnter(page: Page): Promise<void> {
  await page.goto('/ingest');
  await page.locator('.ingest-paste textarea').fill(SAMPLE_NOTES);
  await page.getByRole('button', { name: 'Confirm notes' }).click();
  await page.getByRole('button', { name: GENERATION_COPY.generateButton }).click();
  await page.getByTestId('descent-gate').waitFor({ timeout: 30_000 });
  await skipDescent(page);
  await page.locator('.room-screen__lock-button').first().waitFor();
}

async function scan(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze();
  expect(results.passes.length).toBeGreaterThan(10);
  expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`)).toEqual([]);
}

const notice = (page: Page) => page.getByTestId('conflict-notice');

test.describe('the conflict notice', () => {
  test('a crypt that left a topic out says so once, with both passages behind "Show passages"', async ({ page }) => {
    test.setTimeout(90_000);
    const fake = await installFakeWorker(page, [{ status: 'running' }, { status: 'completed', leftOut: TITLE }]);
    await generateAndEnter(page);

    // The client asked for the notices, and the sentence is core's.
    expect(fake.seen.filter((request) => request.method === 'GET').every((request) => new URL(request.url).searchParams.get('notices') === '1')).toBe(true);
    await expect(notice(page)).toBeVisible();
    await expect(notice(page).getByRole('heading', { name: CONFLICT_NOTICE_COPY.heading })).toBeVisible();
    await expect(notice(page)).toContainText(conflictLeftOut(TITLE));
    await expect(notice(page)).toContainText(conflictNext);
    await expect(page.getByTestId('conflict-notice')).toHaveCount(1);

    // The passages are hidden until asked for, then both are there as text with their paragraph.
    const summary = notice(page).getByText(CONFLICT_NOTICE_COPY.showPassages, { exact: true });
    await expect(notice(page).locator('blockquote').first()).toBeHidden();
    await scan(page);
    await summary.click();
    await expect(notice(page).locator('blockquote')).toHaveCount(2);
    await expect(notice(page).locator('blockquote').nth(0)).toHaveText(firstWords(FIRST?.text));
    await expect(notice(page).locator('blockquote').nth(1)).toHaveText(firstWords(SECOND?.text));
    await expect(notice(page).locator('figcaption').nth(0)).toContainText('Paragraph 2 of your notes');
    await expect(notice(page).locator('figcaption').nth(1)).toContainText('Paragraph 3 of your notes');
    await scan(page);

    // The one live region reads it, and the notice has no live role of its own.
    await expect(page.locator('[aria-live]', { hasText: conflictLeftOut(TITLE) })).toHaveCount(1);
    expect(await notice(page).locator('[aria-live], [role="status"], [role="alert"]').count()).toBe(0);

    // It fits the screen and the room is still playable under it.
    const box = await notice(page).boundingBox();
    const viewport = page.viewportSize();
    if (box === null || viewport === null) throw new Error('no layout box');
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
    for (const lock of await page.locator('.room-screen__lock-button').all()) await expect(lock).toBeEnabled();
  });

  test('it can be opened with the keyboard alone', async ({ page }) => {
    test.setTimeout(90_000);
    await installFakeWorker(page, [{ status: 'completed', leftOut: TITLE }]);
    await generateAndEnter(page);
    const summary = notice(page).locator('summary');
    await summary.focus();
    expect(await summary.evaluate((el) => el === document.activeElement)).toBe(true);
    await page.keyboard.press('Enter');
    await expect(notice(page).locator('blockquote')).toHaveCount(2);
    await page.keyboard.press('Enter');
    await expect(notice(page).locator('blockquote').first()).toBeHidden();
  });

  test('a crypt that left nothing out shows no notice', async ({ page }) => {
    test.setTimeout(90_000);
    await installFakeWorker(page, [{ status: 'completed' }]);
    await generateAndEnter(page);
    await expect(notice(page)).toHaveCount(0);
  });

  test('it is shown from the job that made the crypt, not kept: Continue later shows none', async ({ page }) => {
    test.setTimeout(90_000);
    await installFakeWorker(page, [{ status: 'completed', leftOut: TITLE }]);
    await generateAndEnter(page);
    await expect(notice(page)).toBeVisible();
    await page.goto('/');
    await page.getByRole('button', { name: ENTER_CRYPT_LABEL, exact: true }).click();
    await page.locator('.room-screen__lock-button').first().waitFor();
    await expect(notice(page)).toHaveCount(0);
  });
});
