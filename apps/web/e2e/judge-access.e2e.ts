import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { GENERATION_COPY, JUDGE_ACCESS_COPY } from '@escape-the-crypt/core';
import { skipDescent } from './crypt-helpers';
import { installFakeWorker, SAMPLE_NOTES, WORKER_ORIGIN } from './fake-worker';

// The "Judge access" disclosure on the notes book. The worker is answered by page.route; the code
// below is made up and matches nothing real. In Playwright's Firefox, polling with
// expect(...).toBeVisible() around an axe scan can crash the page, so the waits around a scan use
// locator.waitFor() and one-shot reads.

const CODE = 'judge-code-0123456789-abcdef';
const WRONG = 'wrong-code-0123456789-abcdef';

async function bookWithNotes(page: Page): Promise<void> {
  await page.goto('/ingest');
  await page.locator('.ingest-paste textarea').fill(SAMPLE_NOTES);
  await page.getByRole('button', { name: 'Confirm notes' }).click();
  await page.getByTestId('start-actions').waitFor();
}

const disclosure = (page: Page) => page.getByTestId('judge-access');
const summary = (page: Page) => disclosure(page).locator('summary');
const field = (page: Page) => disclosure(page).getByLabel(JUDGE_ACCESS_COPY.label);

async function openDisclosure(page: Page): Promise<void> {
  await summary(page).click();
  await field(page).waitFor();
}

async function scan(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze();
  expect(results.passes.length).toBeGreaterThan(10);
  expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`)).toEqual([]);
}

/** Everything the page keeps on this device, as one string: both storages and every IndexedDB store. */
async function everythingStored(page: Page): Promise<string> {
  return page.evaluate(async () => {
    const parts: string[] = [JSON.stringify({ ...localStorage }), JSON.stringify({ ...sessionStorage }), document.cookie];
    const databases = (await indexedDB.databases?.()) ?? [];
    for (const info of databases) {
      if (info.name === undefined) continue;
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const open = indexedDB.open(info.name as string);
        open.onsuccess = () => resolve(open.result);
        open.onerror = () => reject(open.error);
      });
      for (const store of Array.from(db.objectStoreNames)) {
        const rows = await new Promise<unknown[]>((resolve, reject) => {
          const request = db.transaction(store, 'readonly').objectStore(store).getAll();
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
        parts.push(JSON.stringify(rows));
      }
      db.close();
    }
    return parts.join('\n');
  });
}

test.describe('judge access disclosure', () => {
  test('is closed by default, small, keyboard-operable and axe clean open and closed', async ({ page }) => {
    await installFakeWorker(page, [{ status: 'running' }]);
    await bookWithNotes(page);
    await expect(disclosure(page)).toBeVisible();
    expect(await disclosure(page).evaluate((el) => (el as HTMLDetailsElement).open)).toBe(false);
    await expect(summary(page)).toHaveText(JUDGE_ACCESS_COPY.summary);
    const box = await summary(page).boundingBox();
    if (box === null) throw new Error('the summary has no layout box');
    expect(box.height).toBeGreaterThanOrEqual(44);
    await scan(page);

    // Keyboard: Tab to the summary, Enter opens it, Tab reaches the field.
    await summary(page).focus();
    await page.keyboard.press('Enter');
    await field(page).waitFor();
    await page.keyboard.press('Tab');
    expect(await field(page).evaluate((el) => el === document.activeElement)).toBe(true);
    await expect(field(page)).toHaveAttribute('type', 'password');
    await page.keyboard.type(CODE);
    await scan(page);
  });

  test('a right code sends Generate to /judge/jobs with the header, and the code goes nowhere else', async ({ page }) => {
    test.setTimeout(60_000);
    const requested: string[] = [];
    page.on('request', (request) => requested.push(request.url()));
    const consoleText: string[] = [];
    page.on('console', (message) => consoleText.push(message.text()));
    const fake = await installFakeWorker(page, [{ status: 'running' }, { status: 'completed' }], { judgeCode: CODE });
    await bookWithNotes(page);
    await openDisclosure(page);
    await field(page).fill(CODE);
    await page.getByRole('button', { name: GENERATION_COPY.generateButton }).click();
    await page.getByTestId('descent-gate').waitFor({ timeout: 30_000 });
    await skipDescent(page);

    const post = fake.seen.find((request) => request.method === 'POST');
    expect(new URL(post?.url ?? '').pathname).toBe('/judge/jobs');
    expect(post?.url.startsWith(WORKER_ORIGIN)).toBe(true);
    expect(post?.headers['x-judge-token']).toBe(CODE);
    expect(post?.body ?? '').not.toContain(CODE);
    // Only the start request carries it: polls and everything else do not.
    for (const request of fake.seen.filter((seen) => seen !== post)) {
      expect(request.headers['x-judge-token']).toBeUndefined();
    }
    // Never in an address, a log or on the device.
    expect(requested.filter((url) => url.includes(CODE))).toEqual([]);
    expect(page.url()).not.toContain(CODE);
    expect(consoleText.filter((text) => text.includes(CODE))).toEqual([]);
    // The scan is not vacuous: the saved crypt and run are in there.
    const stored = await everythingStored(page);
    expect(stored.length).toBeGreaterThan(1000);
    expect(stored).not.toContain(CODE);
  });

  test('without a code the public route is used and no judge header is sent', async ({ page }) => {
    const fake = await installFakeWorker(page, [{ status: 'running' }], { judgeCode: CODE });
    await bookWithNotes(page);
    await page.getByRole('button', { name: GENERATION_COPY.generateButton }).click();
    await page.getByTestId('dig-screen').waitFor();
    const post = fake.seen.find((request) => request.method === 'POST');
    expect(new URL(post?.url ?? '').pathname).toBe('/jobs');
    expect(post?.headers['x-judge-token']).toBeUndefined();
  });

  test('a wrong code shows the typed error copy, marks the field, starts no crypt, and is axe clean', async ({ page }) => {
    const fake = await installFakeWorker(page, [{ status: 'running' }], { judgeCode: CODE });
    await bookWithNotes(page);
    await openDisclosure(page);
    await field(page).fill(WRONG);
    await page.getByRole('button', { name: GENERATION_COPY.generateButton }).click();
    const copy = GENERATION_COPY.failures['judge-access-denied'];
    await page.getByText(copy.what, { exact: true }).waitFor();
    await page.getByText(copy.next, { exact: true }).waitFor();
    expect(await disclosure(page).evaluate((el) => (el as HTMLDetailsElement).open)).toBe(true);
    await expect(field(page)).toHaveAttribute('aria-invalid', 'true');
    expect(await page.locator('body').innerText()).not.toContain(WRONG);
    // Nothing was started or polled, and the notes are still there.
    expect(fake.seen.filter((request) => request.method !== 'POST')).toEqual([]);
    expect(fake.seen).toHaveLength(1);
    await page.locator('.ingest-confirmed').waitFor();
    await page.getByRole('button', { name: GENERATION_COPY.sampleOffer }).waitFor();
    await scan(page);
    expect(await everythingStored(page)).not.toContain(WRONG);

    // Fixing the code and trying again works from the same screen.
    await field(page).fill(CODE);
    await page.getByRole('button', { name: GENERATION_COPY.generateButton }).click();
    await page.getByTestId('dig-screen').waitFor();
    await expect.poll(() => fake.seen.filter((request) => request.method === 'POST').length).toBe(2);
    expect(fake.seen.filter((request) => request.method === 'POST').map((request) => request.headers['x-judge-token'])).toEqual([WRONG, CODE]);
  });

  test('a worker with the judge route off answers the same way, with the same copy', async ({ page }) => {
    await installFakeWorker(page, [{ status: 'running' }]);
    await bookWithNotes(page);
    await openDisclosure(page);
    await field(page).fill(CODE);
    await page.getByRole('button', { name: GENERATION_COPY.generateButton }).click();
    await page.getByText(GENERATION_COPY.failures['judge-access-denied'].what, { exact: true }).waitFor();
  });

  test('the code is gone after a reload', async ({ page }) => {
    await installFakeWorker(page, [{ status: 'running' }], { judgeCode: CODE });
    await bookWithNotes(page);
    await openDisclosure(page);
    await field(page).fill(CODE);
    await page.reload();
    await page.locator('.ingest-paste textarea').fill(SAMPLE_NOTES);
    await page.getByRole('button', { name: 'Confirm notes' }).click();
    await page.getByTestId('judge-access').waitFor();
    expect(await disclosure(page).evaluate((el) => (el as HTMLDetailsElement).open)).toBe(false);
    await openDisclosure(page);
    await expect(field(page)).toHaveValue('');
  });
});
