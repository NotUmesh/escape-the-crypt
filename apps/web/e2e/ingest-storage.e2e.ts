import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import type { Page, Request } from '@playwright/test';

const SENTINEL = 'ZEBRA-QUILL-7731';
const FILE_NAME = 'ZEBRA-FILENAME-4410.pdf';
const PROSE =
  'Active recall means producing an answer from memory instead of re-reading the notes. ' +
  'Spaced repetition schedules each review just before the learner would forget the item.';

interface StoredRecord {
  readonly [key: string]: unknown;
}

/** Reads every record in the `notes` store and describes any binary value inside it. */
async function readNotesStore(page: Page): Promise<{ records: StoredRecord[]; binary: string[] }> {
  return page.evaluate(
    () =>
      new Promise<{ records: StoredRecord[]; binary: string[] }>((resolve, reject) => {
        const open = indexedDB.open('escape-the-crypt', 1);
        open.onerror = () => reject(new Error('open failed'));
        open.onsuccess = () => {
          const all = open.result.transaction('notes').objectStore('notes').getAll();
          all.onsuccess = () => {
            const binary: string[] = [];
            const walk = (value: unknown, path: string): void => {
              if (value instanceof ArrayBuffer || ArrayBuffer.isView(value)) binary.push(`${path}: bytes`);
              else if (value instanceof Blob) binary.push(`${path}: blob`);
              else if (Array.isArray(value)) value.forEach((v, i) => walk(v, `${path}[${i}]`));
              else if (value !== null && typeof value === 'object') {
                for (const [k, v] of Object.entries(value)) walk(v, `${path}.${k}`);
              }
            };
            walk(all.result, 'records');
            open.result.close();
            resolve({ records: all.result as StoredRecord[], binary });
          };
        };
      }),
  );
}

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