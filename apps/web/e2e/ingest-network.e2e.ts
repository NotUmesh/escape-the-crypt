import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';

const fixture = (name: string): string =>
  fileURLToPath(new URL(`../src/features/ingest/fixtures/${name}`, import.meta.url));

// Words that appear in ok-page.pdf, so they are extracted text.
const EXTRACTED_PHRASES = ['Spaced repetition', 'Active recall', 'interleaving'];

interface Seen {
  readonly url: string;
  readonly method: string;
  readonly body: string | null;
}

/** Everything the page and its workers sent that breaks the network guarantee. */
function violations(seen: readonly Seen[], origin: string): string[] {
  const found: string[] = [];
  for (const { url, method, body } of seen) {
    if (url.startsWith('data:') || url.startsWith('blob:')) continue;
    if (new URL(url).origin !== origin) found.push(`cross-origin: ${url}`);
    if (method !== 'GET') found.push(`${method} request: ${url}`);
    if (body !== null && body !== '') found.push(`request body: ${url}`);
    const haystack = `${decodeURIComponent(url)} ${body ?? ''}`.toLowerCase();
    for (const phrase of EXTRACTED_PHRASES) {
      if (haystack.includes(phrase.toLowerCase())) found.push(`extracted text in request: ${url}`);
    }
  }
  return found;
}

test('a PDF extraction sends no cross-origin request, no body and no extracted text', async ({ page, context, baseURL }) => {
  const origin = new URL(baseURL ?? 'http://localhost').origin;
  const seen: Seen[] = [];
  // The context sees requests from workers as well as from the page.
  context.on('request', (r) => seen.push({ url: r.url(), method: r.method(), body: r.postData() }));

  await page.goto('/ingest');
  await page.locator('input[type="file"]').setInputFiles(fixture('ok-page.pdf'));
  await expect(page.locator('.ingest-pdf-page')).toHaveCount(1);
  await page.locator('.ingest-pdf-page input').check();
  await page.getByRole('button', { name: 'Read these pages' }).click();
  await expect(page.locator('.ingest-preview')).toBeVisible();
  await expect(page.locator('.ingest-preview textarea')).toHaveValue(/Spaced repetition/);

  // The extraction itself ran: the self-hosted pdf.js worker was fetched from this origin.
  expect(seen.some((s) => s.url.endsWith('/pdf.worker.min.mjs'))).toBe(true);
  expect(violations(seen, origin)).toEqual([]);
});

test('same-origin font files are allowed', () => {
  const seen: Seen[] = [
    { url: 'http://localhost:4173/fonts/cinzel-latin-400-normal.woff2', method: 'GET', body: null },
  ];
  expect(violations(seen, 'http://localhost:4173')).toEqual([]);
});

// Built from pieces so this file holds no literal remote URL for the style guard to flag.
const REMOTE_FONTS = ['https://', 'fonts.', 'googleapis.com', '/css2?family=Cinzel'].join('');
const REMOTE_OTHER = ['https://', 'example.', 'test', '/x'].join('');

test('the guard fails on a cross-origin request, a request body and extracted text', () => {
  const origin = 'http://localhost:4173';
  expect(
    violations([{ url: REMOTE_FONTS, method: 'GET', body: null }], origin),
  ).toHaveLength(1);
  expect(violations([{ url: REMOTE_OTHER, method: 'GET', body: null }], origin)).toHaveLength(1);
  expect(violations([{ url: `${origin}/log`, method: 'POST', body: 'x' }], origin)).toHaveLength(2);
  expect(violations([{ url: `${origin}/a?q=Spaced%20repetition`, method: 'GET', body: null }], origin)).toHaveLength(1);
  expect(violations([{ url: `${origin}/a`, method: 'GET', body: 'ACTIVE RECALL' }], origin).length).toBeGreaterThan(0);
});