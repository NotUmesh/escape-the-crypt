import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { ENTER_CRYPT_LABEL, FRONT_OF_HOUSE_COPY, GENERATION_COPY, ROOM_PLAY_LABELS, SHARE_COPY } from '@escape-the-crypt/core';
import {
  NOTES_TEXT,
  answerSlot,
  buildSampleCrypt,
  correctAnswerFor,
  enterCrypt,
  roomOneSlots,
  skipDescent,
  submitAnswer,
} from './crypt-helpers';
import { installFakeWorker, SAMPLE_NOTES, WORKER_ORIGIN } from './fake-worker';

// The screens before the crypt: the desk, the open book, the dig and the descent. Each is scanned
// with axe on desktop and on a phone (the Pixel 7 project). In
// Playwright's Firefox, polling with expect(...).toBeVisible() around an axe scan can crash the
// page, so the waits around a scan use locator.waitFor() and one-shot reads.

const crypt = buildSampleCrypt();

/** Waits for every finite animation to end, so a scan never reads colours blended mid-fade. */
async function settle(page: Page): Promise<void> {
  await page.evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        .filter((animation) => Number.isFinite(animation.effect?.getComputedTiming().endTime ?? Number.POSITIVE_INFINITY))
        .map((animation) => animation.finished.catch(() => undefined)),
    ),
  );
}

async function scan(page: Page): Promise<void> {
  await settle(page);
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze();
  expect(results.passes.length).toBeGreaterThan(10);
  expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`)).toEqual([]);
}

async function confirmNotes(page: Page, text: string): Promise<void> {
  await page.goto('/ingest');
  await page.locator('.ingest-paste textarea').fill(text);
  await page.getByRole('button', { name: 'Confirm notes' }).click();
  await page.getByTestId('start-actions').waitFor();
}

const regionCount = (page: Page): Promise<number> => page.locator('[aria-live]').count();

test.describe('the desk', () => {
  test('empty: axe clean in both lights, one main, one live region, a plain link to the book', async ({ page }) => {
    await page.goto('/');
    const bring = page.getByRole('link', { name: FRONT_OF_HOUSE_COPY.hub.bringNotes });
    await bring.waitFor();
    await page.getByTestId('shelf-empty').waitFor();
    expect(await page.locator('main').count()).toBe(1);
    expect(await regionCount(page)).toBe(1);
    await expect(bring).toHaveAttribute('href', '/ingest');
    await scan(page);
  });

  test('panels are opaque, so text never sits on art', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('link', { name: FRONT_OF_HOUSE_COPY.hub.bringNotes }).waitFor();
    const alphas = await page.locator('.fh-panel').evaluateAll((panels) =>
      panels.map((panel) => {
        const match = /rgba?\(([^)]+)\)/.exec(getComputedStyle(panel).backgroundColor);
        const parts = (match?.[1] ?? '').split(/[ ,/]+/).filter((part) => part !== '');
        return parts.length >= 4 ? Number(parts[3]) : 1;
      }),
    );
    expect(alphas.length).toBeGreaterThan(0);
    for (const alpha of alphas) expect(alpha).toBe(1);
  });

  test('with a saved crypt: its book, Continue and Start again, axe clean', async ({ page }) => {
    await enterCrypt(page);
    const [first] = roomOneSlots(crypt);
    if (first === undefined) throw new Error('sample crypt room 1 has no slots');
    await answerSlot(page, first, correctAnswerFor(crypt, first.primaryQuestion));
    await page.getByRole('button', { name: ROOM_PLAY_LABELS.continue, exact: true }).click();
    await page.goto('/');
    await page.getByTestId('book-card').waitFor();
    await page.getByRole('button', { name: 'Continue your crypt', exact: true }).waitFor();
    await page.getByRole('button', { name: 'Start again', exact: true }).waitFor();
    expect(await regionCount(page)).toBe(1);
    await scan(page);
  });

  test('keyboard: Tab reaches the link to the notes book and Enter opens it', async ({ page }) => {
    await page.goto('/');
    const bring = page.getByRole('link', { name: FRONT_OF_HOUSE_COPY.hub.bringNotes });
    await bring.waitFor();
    for (let i = 0; i < 10; i += 1) {
      if (await bring.evaluate((el) => el === document.activeElement)) break;
      await page.keyboard.press('Tab');
    }
    expect(await bring.evaluate((el) => el === document.activeElement)).toBe(true);
    await page.keyboard.press('Enter');
    await page.locator('.ingest-paste textarea').waitFor();
    expect(new URL(page.url()).pathname).toBe('/ingest');
  });
});

test.describe('the notes book', () => {
  test('before and after Confirm: axe clean, one live region, settings then actions', async ({ page }) => {
    await page.goto('/ingest');
    await page.locator('.ingest-paste textarea').waitFor();
    expect(await regionCount(page)).toBe(1);
    await scan(page);
    await confirmNotes(page, NOTES_TEXT);
    await page.getByTestId('settings-slot').waitFor();
    expect(await regionCount(page)).toBe(1);
    const order = await page.evaluate(() => {
      const settings = document.querySelector('[data-testid="settings-slot"]');
      const actions = document.querySelector('[data-testid="bring-actions"]');
      return settings !== null && actions !== null && Boolean(settings.compareDocumentPosition(actions) & Node.DOCUMENT_POSITION_FOLLOWING);
    });
    expect(order).toBe(true);
    await scan(page);
  });

  test('"Back to the desk" is a plain link to the hub', async ({ page }) => {
    await page.goto('/ingest');
    const back = page.getByRole('link', { name: FRONT_OF_HOUSE_COPY.bring.back });
    await expect(back).toHaveAttribute('href', '/');
    await back.click();
    await page.getByTestId('shelf-empty').waitFor();
  });
});

test.describe('the dig', () => {
  test('shows the real elapsed time and notes size, no stage list, one live region; axe clean; Cancel returns to the book', async ({ page }) => {
    const fake = await installFakeWorker(page, [{ status: 'running' }]);
    await confirmNotes(page, SAMPLE_NOTES);
    await page.getByRole('button', { name: GENERATION_COPY.generateButton }).click();
    await page.getByTestId('dig-screen').waitFor();
    await expect(page.getByTestId('dig-notes')).toContainText(/\d+ pieces? · \d+ words?/);
    await expect(page.getByTestId('dig-stage-list')).toHaveCount(0);
    expect(await regionCount(page)).toBe(1);
    await expect(page.locator('[aria-live]')).toHaveText(GENERATION_COPY.progress);
    await scan(page);
    await page.getByRole('button', { name: GENERATION_COPY.cancel, exact: true }).click();
    await page.getByTestId('start-actions').waitFor();
    await expect(page.locator('[aria-live]')).toHaveText(GENERATION_COPY.cancelled);
    await expect.poll(() => fake.seen.filter((request) => request.method === 'DELETE').length).toBe(1);
  });

  test('a failed job returns to the book with the message and the sample offer; axe clean', async ({ page }) => {
    await installFakeWorker(page, [{ status: 'failed', failure: 'generation-failed' }]);
    await confirmNotes(page, SAMPLE_NOTES);
    await page.getByRole('button', { name: GENERATION_COPY.generateButton }).click();
    const copy = GENERATION_COPY.failures['generation-failed'];
    await page.getByText(copy.what, { exact: true }).waitFor({ timeout: 15_000 });
    await page.getByRole('button', { name: GENERATION_COPY.sampleOffer }).waitFor();
    expect(await regionCount(page)).toBe(1);
    await scan(page);
  });
});

test.describe('the descent', () => {
  test('plays over a newly started crypt: Skip has focus, the room is inert until it goes, axe clean', async ({ page }) => {
    await confirmNotes(page, NOTES_TEXT);
    await page.getByRole('button', { name: ENTER_CRYPT_LABEL }).click();
    const gate = page.getByTestId('descent-gate');
    await gate.waitFor();
    const skip = page.getByRole('button', { name: FRONT_OF_HOUSE_COPY.descent.skip, exact: true });
    await skip.waitFor();
    expect(await skip.evaluate((el) => el === document.activeElement)).toBe(true);
    await expect(page.locator('.crypt-stage')).toHaveAttribute('inert', '');
    await scan(page);
    await page.keyboard.press('Escape');
    await expect(gate).toHaveCount(0);
    await expect(page.locator('.crypt-stage')).not.toHaveAttribute('inert', /.*/);
    // Focus goes into the room, not to the page's top.
    await page.waitForFunction(() => document.querySelector('.room-screen')?.contains(document.activeElement) === true);
  });

  test('with reduced motion there is no gate and the run is usable at once', async ({ browser }) => {
    const context = await browser.newContext({ reducedMotion: 'reduce' });
    const page = await context.newPage();
    await confirmNotes(page, NOTES_TEXT);
    await page.getByRole('button', { name: ENTER_CRYPT_LABEL }).click();
    await page.locator('.room-screen__lock-button').first().waitFor();
    await expect(page.getByTestId('descent-gate')).toHaveCount(0);
    await expect(page.locator('.crypt-stage')).not.toHaveAttribute('inert', /.*/);
    await context.close();
  });

  test('Continue goes straight in with a short fade, not the clips', async ({ page }) => {
    await enterCrypt(page);
    const [first] = roomOneSlots(crypt);
    if (first === undefined) throw new Error('sample crypt room 1 has no slots');
    await answerSlot(page, first, correctAnswerFor(crypt, first.primaryQuestion));
    await page.getByRole('button', { name: ROOM_PLAY_LABELS.continue, exact: true }).click();
    await page.goto('/');
    await page.getByRole('button', { name: 'Continue your crypt', exact: true }).click();
    await page.locator('.room-screen__lock-button').first().waitFor();
    await expect(page.getByTestId('descent-gate')).toHaveCount(0);
    await expect(page.getByRole('button', { name: FRONT_OF_HOUSE_COPY.descent.skip })).toHaveCount(0);
  });
});

test('paste, generate, descend, play, escape, then the share card', async ({ page }) => {
  test.setTimeout(120_000);
  const requested: string[] = [];
  page.on('request', (request) => requested.push(request.url()));
  await installFakeWorker(page, [{ status: 'queued' }, { status: 'running' }, { status: 'completed' }]);
  await confirmNotes(page, SAMPLE_NOTES);
  const appOrigin = new URL(page.url()).origin;
  await page.getByRole('button', { name: GENERATION_COPY.generateButton }).click();
  await page.getByTestId('dig-screen').waitFor();
  expect(await regionCount(page)).toBe(1);
  // The job finishes; the descent plays over the new crypt.
  await page.getByTestId('descent-gate').waitFor({ timeout: 30_000 });
  await skipDescent(page);
  await page.locator('.room-screen__lock-button').first().waitFor();
  // Play to the escape.
  for (const slot of roomOneSlots(crypt)) {
    await answerSlot(page, slot, correctAnswerFor(crypt, slot.primaryQuestion));
    await page.getByRole('button', { name: ROOM_PLAY_LABELS.continue, exact: true }).click();
  }
  await page.getByRole('button', { name: /final door/i }).click();
  for (const doorSlot of crypt.manifest.finalDoor.slots) {
    await page.locator('.final-door__seal-button').first().click();
    await submitAnswer(page, correctAnswerFor(crypt, doorSlot.question));
    await page.getByRole('button', { name: ROOM_PLAY_LABELS.continue, exact: true }).click();
  }
  await page.getByTestId('escape-view').waitFor();
  await page.getByRole('button', { name: ROOM_PLAY_LABELS.openAutopsy, exact: true }).click();
  const section = page.getByTestId('share-section');
  await section.waitFor();
  // The card of a crypt made from notes names no title and holds no concept or note text.
  const headline = (await page.getByTestId('share-headline').innerText()).trim();
  expect(headline).toBe(SHARE_COPY.headline(null, Number.parseInt(headline.match(/(\d+) ghosts?/)?.[1] ?? '0', 10)));
  const cardText = await page.getByTestId('share-card').innerText();
  for (const concept of Object.values(crypt.content.concepts)) expect(cardText).not.toContain(concept.title);
  expect(cardText).not.toContain('Active recall');
  const [download] = await Promise.all([page.waitForEvent('download'), section.getByRole('button').click()]);
  expect(download.suggestedFilename()).toBe(SHARE_COPY.fileName);
  await expect(page.getByTestId('share-status')).toHaveText(/^Card downloaded/);
  // Nothing but the app and the worker was asked for.
  const foreign = requested.filter((url) => {
    if (url.startsWith('data:') || url.startsWith('blob:') || url.startsWith('about:')) return false;
    const origin = new URL(url).origin;
    return origin !== appOrigin && origin !== WORKER_ORIGIN;
  });
  expect(foreign).toEqual([]);
});
