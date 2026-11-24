import AxeBuilder from '@axe-core/playwright';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { citationLabel } from '@escape-the-crypt/core';
import type { Chunk } from '@escape-the-crypt/core';
import { readNotesStore } from './notes-db';

const fixture = (name: string): string =>
  fileURLToPath(new URL(`../src/features/ingest/fixtures/${name}`, import.meta.url));

// Three paragraphs, each at least 40 characters. The first holds markup-looking text.
const P1 = 'Active recall means producing an answer from memory, as in <i>not italic</i> notes.';
const P2 = 'Spaced repetition schedules each review just before the learner would forget it.';
const P3 = 'Interleaving mixes related topics in one session so similar ideas stay distinct.';
const P2_EDITED = `${P2} Edited.`;
const SAVED = 'Notes confirmed and saved on this device';

async function storedChunks(page: Page): Promise<Chunk[]> {
  const { records } = await readNotesStore(page);
  expect(records).toHaveLength(1);
  return (records[0] as unknown as { chunks: Chunk[] }).chunks;
}

function expectOnlyChunk2Edited(chunks: readonly Chunk[]): void {
  expect(chunks).toHaveLength(3);
  expect(chunks.map((c) => c.edited)).toEqual([false, true, false]);
  expect(chunks.map((c) => citationLabel(c))).toEqual([
    'Paragraph 1 of your notes',
    'Paragraph 2 of your notes',
    'Paragraph 3 of your notes',
  ]);
  expect(chunks[1]?.text).toBe(P2_EDITED);
}

test('paste flow: confirm is explained while empty, text stays plain, only paragraph 2 is edited', async ({ page }) => {
  await page.goto('/ingest');
  await page.locator('.ingest-paste textarea').fill(`${P1}\n\n${P2}\n\n${P3}`);

  const areas = page.locator('.ingest-preview textarea');
  await expect(areas).toHaveCount(3);
  // Preview text is plain text: the markup shows as characters and no element is made.
  await expect(areas.nth(0)).toHaveValue(P1);
  await expect(page.locator('.ingest-root i')).toHaveCount(0);

  // With every paragraph blank, Confirm is disabled and says why.
  for (let i = 0; i < 3; i += 1) await areas.nth(i).fill('');
  const confirm = page.getByRole('button', { name: 'Confirm notes' });
  await expect(confirm).toBeDisabled();
  await expect(page.getByText("There's no text in your notes yet.")).toBeVisible();

  // Put the paragraphs back, with paragraph 2 edited.
  await areas.nth(0).fill(P1);
  await areas.nth(1).fill(P2_EDITED);
  await areas.nth(2).fill(P3);
  await expect(confirm).toBeEnabled();
  await confirm.click();
  await expect(page.getByRole('status')).toHaveText(SAVED);

  expectOnlyChunk2Edited(await storedChunks(page));
});

test('paste flow with the keyboard only', async ({ page }) => {
  await page.goto('/ingest');
  // First Tab stop is the paste box.
  await page.keyboard.press('Tab');
  await expect(page.locator('.ingest-paste textarea')).toBeFocused();
  await page.keyboard.type(`${P1}\n\n${P2}\n\n${P3}`);
  await expect(page.locator('.ingest-preview textarea')).toHaveCount(3);

  await page.keyboard.press('Tab'); // PDF file input
  await page.keyboard.press('Tab'); // paragraph 1
  await page.keyboard.press('Tab'); // paragraph 2
  await expect(page.locator('.ingest-preview textarea').nth(1)).toBeFocused();
  await page.keyboard.press('Control+End');
  await page.keyboard.type(' Edited.');
  await page.keyboard.press('Tab'); // paragraph 3
  await page.keyboard.press('Tab'); // Confirm
  const confirm = page.getByRole('button', { name: 'Confirm notes' });
  await expect(confirm).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('status')).toHaveText(SAVED);

  expectOnlyChunk2Edited(await storedChunks(page));
});

test.describe('axe', () => {
  const scan = async (page: Page): Promise<void> => {
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
      .analyze();
    // The rules really ran, so an empty list of violations is not a scan that did nothing.
    expect(results.passes.length).toBeGreaterThan(10);
    expect(
      results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`),
    ).toEqual([]);
  };

  test('upload screen', async ({ page }) => {
    await page.goto('/ingest');
    await expect(page.locator('.ingest-root')).toBeVisible();
    await scan(page);
  });

  // Real PDF through the pdf.js worker. Not run on Firefox (see playwright.config.ts), where
  // the canned-pages scan below covers the same screen.
  test('page list screen, with a flagged page @real-pdf-axe', async ({ page }) => {
    await page.goto('/ingest');
    await page.locator('input[type="file"]').setInputFiles(fixture('table-like.pdf'));
    await expect(page.locator('.ingest-pdf-page')).toHaveCount(1);
    await scan(page);
    await page.locator('.ingest-pdf-page input').check();
    await page.getByRole('button', { name: 'Read these pages' }).click();
    await expect(page.getByRole('button', { name: 'Remove page' })).toBeVisible();
    await scan(page);
  });

test('page list screen with canned ok, low-text and suspicious pages (no pdf.js worker)', async ({ page }) => {
    await page.goto('/test-parent.html?width=720&client=canned');
    await page.locator('input[type="file"]').setInputFiles({
      name: 'notes.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from('%PDF-1.7 canned'),
    });
    await expect(page.locator('.ingest-pdf-page')).toHaveText([
      'Page 1 (printed page iv)',
      'Page 2 (printed page v)',
      'Page 3 (printed page vi)',
    ]);
    await scan(page);
    for (const box of await page.locator('.ingest-pdf-page input').all()) await box.check();
    await page.getByRole('button', { name: 'Read these pages' }).click();
    await expect(page.locator('.ingest-flag')).toHaveText(['Looks good', 'Low text', 'Check this page']);
    await expect(page.getByRole('button', { name: 'Remove page' })).toHaveCount(2);
    await scan(page);
  });

  test('preview screen', async ({ page }) => {
    await page.goto('/ingest');
    await page.locator('.ingest-paste textarea').fill(`${P1}\n\n${P2}\n\n${P3}`);
    await expect(page.locator('.ingest-preview')).toBeVisible();
    await scan(page);
  });
});