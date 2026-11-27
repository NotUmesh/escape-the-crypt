import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { FINAL_DOOR_BUTTON_TEXT, GENERATION_COPY, ROOM_PLAY_LABELS } from '@escape-the-crypt/core';
import { answerSlot, buildSampleCrypt, correctAnswerFor, roomOneSlots, submitAnswer } from './crypt-helpers';
import { installFakeWorker, SAMPLE_NOTES, WORKER_ORIGIN } from './fake-worker';
import type { FakeStep } from './fake-worker';

const POLL_MS = 2000;

/** Paste the sample notes, confirm them and press "Generate from my notes". */
async function startGeneration(page: Page): Promise<void> {
  await page.goto('/ingest');
  await page.locator('.ingest-paste textarea').fill(SAMPLE_NOTES);
  await page.getByRole('button', { name: 'Confirm notes' }).click();
  await page.getByRole('button', { name: GENERATION_COPY.generateButton }).click();
}

/** Request URLs that left the app origin for anywhere but the worker origin. */
function foreignRequests(urls: readonly string[], appOrigin: string): string[] {
  return urls.filter((url) => {
    if (url.startsWith('data:') || url.startsWith('blob:') || url.startsWith('about:')) return false;
    const origin = new URL(url).origin;
    return origin !== appOrigin && origin !== WORKER_ORIGIN;
  });
}

test('generated crypt: progress, polls, play to the escape view with notes citations', async ({ page }) => {
  test.setTimeout(90_000);
  const requested: string[] = [];
  page.on('request', (request) => requested.push(request.url()));
  const fake = await installFakeWorker(page, [{ status: 'queued' }, { status: 'running' }, { status: 'completed' }]);
  const crypt = buildSampleCrypt();
  await startGeneration(page);
  const appOrigin = new URL(page.url()).origin;
  await expect(page.getByTestId('generation-progress').getByText(GENERATION_COPY.progress, { exact: true })).toBeVisible();
  await expect(page.locator('[aria-live]')).toHaveCount(1);
  await page.locator('.room-screen').waitFor({ timeout: 30_000 });
  await page.locator('.room-screen__lock-button').first().waitFor();

  const posts = fake.seen.filter((request) => request.method === 'POST');
  const gets = fake.seen.filter((request) => request.method === 'GET');
  expect(posts).toHaveLength(1);
  expect(gets.length).toBeGreaterThanOrEqual(3);
  const post = posts[0];
  if (post === undefined) throw new Error('no POST seen');
  expect(post.url).toBe(`${WORKER_ORIGIN}/jobs`);
  expect(post.headers['x-session-token']).toMatch(/^[A-Za-z0-9_-]{22,128}$/);
  expect(post.headers['idempotency-key']).toBeTruthy();
  expect(post.headers['cookie']).toBeUndefined();
  const body: unknown = JSON.parse(post.body ?? '{}');
  expect(Object.keys(body as object).sort()).toEqual(['notesText', 'runLength']);
  expect((body as { runLength: string }).runLength).toBe('short');
  for (const get of gets) {
    expect(get.headers['x-session-token']).toBe(post.headers['x-session-token']);
    expect(get.headers['cookie']).toBeUndefined();
  }

  const citations: string[] = [];
  const collect = async (): Promise<void> => {
    await page.locator('.evidence-panel').waitFor();
    citations.push(...(await page.locator('.evidence-panel__citation').allInnerTexts()).map((t) => t.trim()));
    const text = await page.evaluate(() => document.body.innerText);
    expect(text).toContain('Blind model review passed');
    expect(text).not.toContain('Sample crypt');
    expect(text).not.toContain('Human-reviewed');
  };
  for (const slot of roomOneSlots(crypt)) {
    await answerSlot(page, slot, correctAnswerFor(crypt, slot.primaryQuestion));
    await collect();
    await page.getByRole('button', { name: ROOM_PLAY_LABELS.continue, exact: true }).click();
  }
  await page.getByRole('button', { name: FINAL_DOOR_BUTTON_TEXT, exact: true }).click();
  for (const doorSlot of crypt.manifest.finalDoor.slots) {
    await page.locator('.final-door__seal-button').first().click();
    await submitAnswer(page, correctAnswerFor(crypt, doorSlot.question));
    await collect();
    await page.getByRole('button', { name: ROOM_PLAY_LABELS.continue, exact: true }).click();
  }
  await expect(page.getByTestId('escape-view')).toBeVisible();
  expect(await page.evaluate(() => document.body.innerText)).not.toContain('Sample crypt');
  expect(citations.length).toBeGreaterThan(0);
  for (const label of citations) expect(label).toMatch(/^Paragraph \d+ of your notes$/);
  expect(foreignRequests(requested, appOrigin)).toEqual([]);
});

const FAILURES = ['budget-exhausted', 'not-enough-material', 'generation-failed'] as const;
for (const kind of FAILURES) {
  test(`failure ${kind}: message, sample offer, and the offer starts the sample crypt`, async ({ page }) => {
    const requested: string[] = [];
    page.on('request', (request) => requested.push(request.url()));
    await installFakeWorker(page, [{ status: 'failed', failure: kind }]);
    await startGeneration(page);
    const appOrigin = new URL(page.url()).origin;
    const copy = GENERATION_COPY.failures[kind];
    await expect(page.getByText(copy.what, { exact: true })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(copy.next, { exact: true })).toBeVisible();
    await page.getByRole('button', { name: GENERATION_COPY.sampleOffer }).click();
    await page.locator('.room-screen').waitFor();
    await page.locator('.room-screen__lock-button').first().waitFor();
    expect(foreignRequests(requested, appOrigin)).toEqual([]);
  });
}

test('expired: message and sample offer', async ({ page }) => {
  await installFakeWorker(page, [{ status: 'expired' }]);
  await startGeneration(page);
  const copy = GENERATION_COPY.failures.expired;
  await expect(page.getByText(copy.what, { exact: true })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(copy.next, { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: GENERATION_COPY.sampleOffer })).toBeVisible();
});

test('cancel: no request reaches the worker afterwards, and both buttons return', async ({ page }) => {
  const steps: FakeStep[] = [{ status: 'running' }];
  const fake = await installFakeWorker(page, steps);
  await startGeneration(page);
  await expect(page.getByTestId('generation-progress')).toBeVisible();
  await expect.poll(() => fake.seen.length, { timeout: 10_000 }).toBeGreaterThanOrEqual(1);
  await page.getByRole('button', { name: GENERATION_COPY.cancel, exact: true }).click();
  const countAtCancel = fake.seen.length;
  await expect(page.getByTestId('generation-cancelled')).toBeVisible();
  await page.waitForTimeout(POLL_MS * 2 + 1000);
  expect(fake.seen.length).toBe(countAtCancel);
  await expect(page.getByRole('button', { name: 'Enter the crypt' })).toBeVisible();
  await expect(page.getByRole('button', { name: GENERATION_COPY.generateButton })).toBeVisible();
});
