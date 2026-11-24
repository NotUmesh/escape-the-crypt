import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import type { Page, Request } from '@playwright/test';
import { readNotesStore } from './notes-db';
import type { StoredRecord } from './notes-db';

const SENTINEL = 'ZEBRA-QUILL-7731';
const FILE_NAME = 'ZEBRA-FILENAME-4410.pdf';
const PROSE =
  'Active recall means producing an answer from memory instead of re-reading the notes. ' +
  'Spaced repetition schedules each review just before the learner would forget the item.';

function watch(page: Page): { consoleMessages: string[]; requestsAfterConfirm: Request[]; markConfirm: () => void } {
  const consoleMessages: string[] = [];
  const requestsAfterConfirm: Request[] = [];
  let confirmed = false;
  page.on('console', (m) => consoleMessages.push(m.text()));
  page.on('pageerror', (e) => consoleMessages.push(`${e.name}: ${e.message}`));
  page.on('request', (r) => {
    if (confirmed) requestsAfterConfirm.push(r);
  });
  return {
    consoleMessages,
    requestsAfterConfirm,
    markConfirm: () => {
      confirmed = true;
    },
  };
}

function expectOnlyAllowedFields(records: StoredRecord[]): void {
  expect(records).toHaveLength(1);
  const record = records[0] as StoredRecord;
  expect(Object.keys(record).sort()).toEqual(['chunks', 'documentDigest', 'schemaVersion']);
  for (const chunk of record['chunks'] as StoredRecord[]) {
    expect(Object.keys(chunk).sort()).toEqual(['documentDigest', 'edited', 'id', 'location', 'position', 'text']);
  }
}

test('paste flow: the notes text stays out of the console and off the network', async ({ page, baseURL }) => {
  const seen = watch(page);
  await page.goto('/ingest');
  await page.locator('.ingest-paste textarea').fill(`${SENTINEL} ${PROSE}`);
  seen.markConfirm();
  await page.getByRole('button', { name: 'Confirm notes' }).click();
  await expect(page.getByRole('status')).toHaveText('Notes confirmed and saved on this device');

  expect(seen.consoleMessages.filter((m) => m.includes(SENTINEL))).toEqual([]);

  const { records, binary } = await readNotesStore(page);
  expectOnlyAllowedFields(records);
  expect(binary).toEqual([]);
  // The notes text is the one thing the record is meant to hold.
  expect(JSON.stringify(records)).toContain(SENTINEL);

  const origin = new URL(baseURL ?? 'http://localhost').origin;
  for (const request of seen.requestsAfterConfirm) {
    expect(new URL(request.url()).origin, request.url()).toBe(origin);
    expect(request.postData() ?? '', request.url()).not.toContain(SENTINEL);
  }
});

test('PDF flow: no file name or bytes are stored', async ({ page }) => {
  const seen = watch(page);
  await page.goto('/ingest');
  await page.locator('input[type="file"]').setInputFiles({
    name: FILE_NAME,
    mimeType: 'application/pdf',
    buffer: readFileSync(fileURLToPath(new URL('../src/features/ingest/fixtures/ok-page.pdf', import.meta.url))),
  });
  await expect(page.locator('.ingest-pdf-page')).toHaveCount(1);
  await page.locator('.ingest-pdf-page input').check();
  await page.getByRole('button', { name: 'Read these pages' }).click();
  await expect(page.locator('.ingest-preview')).toBeVisible();
  seen.markConfirm();
  await page.getByRole('button', { name: 'Confirm notes' }).click();
  await expect(page.getByRole('status')).toHaveText('Notes confirmed and saved on this device');

  const { records, binary } = await readNotesStore(page);
  expectOnlyAllowedFields(records);
  expect(binary).toEqual([]);
  expect(JSON.stringify(records)).not.toContain('ZEBRA-FILENAME');
  expect(JSON.stringify(records)).not.toContain('.pdf');
  expect(seen.consoleMessages.filter((m) => m.includes('ZEBRA'))).toEqual([]);

  const origin = new URL(page.url()).origin;
  for (const request of seen.requestsAfterConfirm) {
    expect(new URL(request.url()).origin, request.url()).toBe(origin);
    expect(request.postData() ?? '').not.toContain('ZEBRA');
  }
});