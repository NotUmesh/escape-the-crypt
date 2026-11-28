import { readFileSync, writeFileSync } from 'node:fs';
import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import type { Browser, Page, TestInfo } from '@playwright/test';
import { GENERATION_COPY, IMPORT_COPY, ROOM_PLAY_LABELS, renderError } from '@escape-the-crypt/core';
import { answerSlot, buildSampleCrypt, correctAnswerFor, enterCrypt, roomOneSlots, skipDescent } from './crypt-helpers';
import { installFakeWorker, SAMPLE_NOTES, WORKER_ORIGIN } from './fake-worker';
import { buildSample, skipLock, startSample } from './sample-nav';

// Import is the counterpart of "Export a copy". The export is made in one browser context and
// imported in a second, fresh one, which shares no storage with the first. In Playwright's Firefox,
// polling with expect(...).toBeVisible() around an axe scan can crash the page, so the waits around
// a scan use locator.waitFor() and one-shot reads.

const crypt = buildSampleCrypt();
const EXPORT_BUTTON = /Export a copy/;

async function scan(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze();
  expect(results.passes.length).toBeGreaterThan(10);
  expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`)).toEqual([]);
}

/** A page in a brand-new browser context: no IndexedDB, no storage, nothing from the first. */
async function freshPage(browser: Browser, like: Page, baseURL: string | undefined): Promise<Page> {
  const context = await browser.newContext({ baseURL, viewport: like.viewportSize() ?? undefined });
  return context.newPage();
}

/** Plays one lock, then exports the crypt from the desk's book card and returns the file's path. */
async function exportFromDesk(page: Page, testInfo: TestInfo, name: string): Promise<string> {
  await page.goto('/');
  await page.getByTestId('book-card').waitFor();
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: EXPORT_BUTTON }).click()]);
  const path = testInfo.outputPath(name);
  await download.saveAs(path);
  return path;
}

async function playOneLock(page: Page): Promise<void> {
  const [first] = roomOneSlots(crypt);
  if (first === undefined) throw new Error('sample crypt room 1 has no slots');
  await answerSlot(page, first, correctAnswerFor(crypt, first.primaryQuestion));
  await page.getByRole('button', { name: ROOM_PLAY_LABELS.continue, exact: true }).click();
  await page.locator('.room-screen__lock-button[data-status="solved"]').first().waitFor();
}

const chooseFile = (page: Page, path: string): Promise<void> => page.getByTestId('import-file').setInputFiles(path);
const status = (page: Page) => page.getByTestId('import-status');
const refusal = (kind: keyof typeof IMPORT_COPY.errors): string => renderError(IMPORT_COPY.errors[kind]);

test.describe('import a crypt', () => {
  test('a sample crypt exported in one browser resumes in a fresh one, with the same lock solved', async ({ page, browser, baseURL }, testInfo) => {
    await enterCrypt(page);
    await playOneLock(page);
    const file = await exportFromDesk(page, testInfo, 'sample-export.json');

    const other = await freshPage(browser, page, baseURL);
    await other.goto('/');
    await other.getByTestId('shelf-empty').waitFor();
    await chooseFile(other, file);
    await expect(status(other)).toHaveText(IMPORT_COPY.done.active);
    await expect(other.getByTestId('shell-announcer')).toHaveText(IMPORT_COPY.done.active);
    await other.getByTestId('book-card').waitFor();
    await expect(other.getByTestId('book-stack').locator('li')).toHaveCount(1);
    await expect(other.getByTestId('shelf-empty')).toHaveCount(0);
    expect(await other.locator('[aria-live]').count()).toBe(1);

    await other.getByRole('button', { name: 'Continue your crypt', exact: true }).click();
    await other.locator('.room-screen__lock-button[data-status="solved"]').first().waitFor();
    await other.context().close();
  });

  test('a printing-press crypt exported in one browser resumes in a fresh one, with its own notes and the same lock settled', async ({ page, browser, baseURL }, testInfo) => {
    test.setTimeout(60_000);
    const press = buildSample('printing-press');
    const first = press.manifest.rooms[0]?.lockSlots[0];
    if (first === undefined) throw new Error('printing-press room 1 has no slots');
    await startSample(page, 'printing-press', 'click');
    await skipLock(page, first, 'click');
    await page.locator('.room-screen__lock-button[data-status="settled"]').first().waitFor();
    const file = await exportFromDesk(page, testInfo, 'printing-press-export.json');

    const other = await freshPage(browser, page, baseURL);
    await other.goto('/');
    await other.getByTestId('shelf-empty').waitFor();
    await chooseFile(other, file);
    await expect(status(other)).toHaveText(IMPORT_COPY.done.active);
    await other.getByTestId('book-card').waitFor();
    await other.getByRole('button', { name: 'Continue your crypt', exact: true }).click();
    // The restored room is the printing press's, with the lock settled as it was.
    await other.locator('.room-screen__lock-button[data-status="settled"]').first().waitFor();
    expect(await other.locator('.room-screen__lock-button').count()).toBe(press.manifest.rooms[0]?.lockSlots.length);
    await other.context().close();
  });

  test('a generated crypt keeps its notes through export and import, so it resumes in a fresh browser', async ({ page, browser, baseURL }, testInfo) => {
    test.setTimeout(90_000);
    await installFakeWorker(page, [{ status: 'running' }, { status: 'completed' }]);
    await page.goto('/ingest');
    await page.locator('.ingest-paste textarea').fill(SAMPLE_NOTES);
    await page.getByRole('button', { name: 'Confirm notes' }).click();
    await page.getByRole('button', { name: GENERATION_COPY.generateButton }).click();
    await page.getByTestId('descent-gate').waitFor({ timeout: 30_000 });
    await skipDescent(page);
    await page.locator('.room-screen__lock-button').first().waitFor();
    await playOneLock(page);
    const file = await exportFromDesk(page, testInfo, 'generated-export.json');
    // The export holds the notes, and no file name or bytes.
    const exported = JSON.parse(readFileSync(file, 'utf8')) as { chunks: unknown[] | null };
    expect(Array.isArray(exported.chunks) && exported.chunks.length > 0).toBe(true);

    const other = await freshPage(browser, page, baseURL);
    const requested: string[] = [];
    other.on('request', (request) => requested.push(request.url()));
    await other.goto('/');
    await chooseFile(other, file);
    await expect(status(other)).toHaveText(IMPORT_COPY.done.active);
    await other.getByTestId('book-card').waitFor();
    await other.getByRole('button', { name: 'Continue your crypt', exact: true }).click();
    await other.locator('.room-screen__lock-button[data-status="solved"]').first().waitFor();
    // Reading a file and resuming it asks nothing of the worker or anyone else.
    const origin = new URL(other.url()).origin;
    expect(requested.filter((url) => !url.startsWith('data:') && !url.startsWith('blob:') && !url.startsWith(origin))).toEqual([]);
    expect(requested.filter((url) => url.startsWith(WORKER_ORIGIN))).toEqual([]);
    await other.context().close();
  });

  test('importing the same file twice says it is a duplicate and changes nothing', async ({ page, browser, baseURL }, testInfo) => {
    await enterCrypt(page);
    await playOneLock(page);
    const file = await exportFromDesk(page, testInfo, 'duplicate-export.json');

    const other = await freshPage(browser, page, baseURL);
    await other.goto('/');
    await chooseFile(other, file);
    await expect(status(other)).toHaveText(IMPORT_COPY.done.active);
    await other.getByTestId('book-card').waitFor();
    const before = await other.getByTestId('book-card').innerText();
    await chooseFile(other, file);
    await expect(status(other)).toHaveText(refusal('duplicate'));
    await expect(other.getByTestId('shell-announcer')).toHaveText(refusal('duplicate'));
    expect(await other.getByTestId('book-card').innerText()).toBe(before);
    // Still exactly one book on the shelf.
    await expect(other.getByTestId('book-stack').locator('li')).toHaveCount(1);
    await other.context().close();
  });

  test('a damaged or foreign file is refused with the typed copy, and the shelf stays empty', async ({ page }, testInfo) => {
    await page.goto('/');
    await page.getByTestId('shelf-empty').waitFor();
    const cases: { name: string; text: string; kind: keyof typeof IMPORT_COPY.errors }[] = [
      { name: 'not-json.json', text: 'this is not json', kind: 'not-json' },
      { name: 'foreign.json', text: JSON.stringify({ hello: 'world' }), kind: 'not-an-export' },
      { name: 'newer.json', text: JSON.stringify({ schemaVersion: 2 }), kind: 'unsupported-version' },
    ];
    for (const { name, text, kind } of cases) {
      const path = testInfo.outputPath(name);
      writeFileSync(path, text);
      await chooseFile(page, path);
      await expect(status(page)).toHaveText(refusal(kind));
      await expect(page.getByTestId('shell-announcer')).toHaveText(refusal(kind));
      await expect(page.getByTestId('shelf-empty')).toBeVisible();
      // Neither the file's name nor its text is ever shown.
      expect(await page.locator('body').innerText()).not.toContain(name);
    }
    // A damaged copy of a real export is refused too.
    await enterCrypt(page);
    await playOneLock(page);
    const real = await exportFromDesk(page, testInfo, 'real.json');
    const text = readFileSync(real, 'utf8');
    const damaged = testInfo.outputPath('damaged.json');
    writeFileSync(damaged, text.slice(0, Math.floor(text.length / 2)));
    const other = await page.context().browser()?.newContext({ baseURL: new URL(page.url()).origin });
    if (other === undefined) throw new Error('no browser');
    const fresh = await other.newPage();
    await fresh.goto('/');
    await fresh.getByTestId('shelf-empty').waitFor();
    await chooseFile(fresh, damaged);
    await expect(status(fresh)).toHaveText(refusal('not-json'));
    await expect(fresh.getByTestId('shelf-empty')).toBeVisible();
    await other.close();
  });

  test('the import control is axe clean on an empty desk, after a success and after a refusal, with the lantern on and off', async ({ page, browser, baseURL }, testInfo) => {
    await enterCrypt(page);
    await playOneLock(page);
    const file = await exportFromDesk(page, testInfo, 'axe-export.json');
    const bad = testInfo.outputPath('axe-bad.json');
    writeFileSync(bad, '{');

    const other = await freshPage(browser, page, baseURL);
    await other.goto('/');
    await other.getByTestId('import-crypt').waitFor();
    const lantern = other.getByRole('button', { name: 'Lantern mode' });
    const scanBoth = async (): Promise<void> => {
      await scan(other);
      await lantern.click();
      await scan(other);
      await lantern.click();
    };
    await scanBoth();
    await chooseFile(other, bad);
    await expect(status(other)).toHaveText(refusal('not-json'));
    await scanBoth();
    await chooseFile(other, file);
    await expect(status(other)).toHaveText(IMPORT_COPY.done.active);
    await other.getByTestId('book-card').waitFor();
    await scanBoth();

    // The button is a real, named, keyboard-reachable control of at least 44 px.
    const button = other.getByRole('button', { name: IMPORT_COPY.button, exact: true });
    const box = await button.boundingBox();
    if (box === null) throw new Error('the import button has no layout box');
    expect(box.height).toBeGreaterThanOrEqual(44);
    expect(box.width).toBeGreaterThanOrEqual(44);
    await button.focus();
    expect(await button.evaluate((el) => el === document.activeElement)).toBe(true);
    await other.context().close();
  });
});
