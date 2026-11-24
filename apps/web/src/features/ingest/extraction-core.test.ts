import { describe, expect, it } from 'vitest';
import { MAX_EXTRACTED_WORDS, MAX_EXTRACTION_MS } from '@escape-the-crypt/core';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { mapPdfError, runCount, runExtraction } from './extraction-core';
import type {
  ExtractionMessageOut,
  PdfDocumentLike,
  PdfTextItemLike,
} from './extraction-core';

function line(str: string, y: number): PdfTextItemLike {
  return { str, transform: [1, 0, 0, 1, 0, y], height: 10, hasEOL: true };
}

function fakeDoc(
  pages: readonly (readonly PdfTextItemLike[] | Error)[],
  labels: readonly string[] | null = null,
): PdfDocumentLike {
  return {
    numPages: pages.length,
    getPageLabels: () => Promise.resolve(labels),
    getPage: (n) => {
      const p = pages[n - 1];
      if (p === undefined || p instanceof Error) return Promise.reject(p ?? new Error('x'));
      return Promise.resolve({ getTextContent: () => Promise.resolve({ items: p }) });
    },
  };
}

const prose = 'word '.repeat(30).trim();

async function run(
  doc: PdfDocumentLike,
  opts: { pageIndexes?: number[]; times?: number[]; cancelAfter?: number } = {},
): Promise<ExtractionMessageOut[]> {
  const out: ExtractionMessageOut[] = [];
  const times = [...(opts.times ?? [])];
  let last = 0;
  await runExtraction({
    doc,
    pageIndexes: opts.pageIndexes ?? [0],
    startedAtMs: 0,
    clock: { now: () => (last = times.shift() ?? last) },
    post: (m) => out.push(m),
    isCancelled: () =>
      opts.cancelAfter !== undefined &&
      out.filter((m) => m.type === 'page').length >= opts.cancelAfter,
  });
  return out;
}

describe('runExtraction', () => {
  it('posts progress, page (with label and flag) and done', async () => {
    const out = await run(fakeDoc([[line(prose, 100)]], ['iv']));
    expect(out.map((m) => m.type)).toEqual(['progress', 'page', 'done']);
    expect(out[1]).toMatchObject({ pdfPageIndex: 0, printedPageLabel: 'iv', flag: 'ok' });
  });

  it('flags low-text pages and uses null for a missing label', async () => {
    const out = await run(fakeDoc([[line('hi', 1)]]));
    expect(out[1]).toMatchObject({ printedPageLabel: null, flag: 'low-text' });
  });

  it('maps PasswordException to encrypted and other failures to unreadable', async () => {
    const pw = Object.assign(new Error('x'), { name: 'PasswordException' });
    expect(mapPdfError(pw)).toEqual({ kind: 'encrypted' });
    expect(mapPdfError(new Error('bad'))).toEqual({ kind: 'unreadable' });
    const out = await run(fakeDoc([new Error('bad')]));
    expect(out.at(-1)).toEqual({ type: 'error', error: { kind: 'unreadable' } });
  });

  it('stops with a time error when the clock passes the limit before a page', async () => {
    const out = await run(fakeDoc([[line(prose, 1)]]), { times: [MAX_EXTRACTION_MS + 1] });
    expect(out).toEqual([{ type: 'error', error: { kind: 'time', limitMs: MAX_EXTRACTION_MS } }]);
  });

  it('stops with a time error when the limit passes during a page', async () => {
    const out = await run(fakeDoc([[line(prose, 1)]]), { times: [0, MAX_EXTRACTION_MS + 1] });
    expect(out.at(-1)).toMatchObject({ type: 'error', error: { kind: 'time' } });
    expect(out.some((m) => m.type === 'page')).toBe(false);
  });

  it('stops with a word-count error when the running total exceeds the limit', async () => {
    const big = 'w '.repeat(MAX_EXTRACTED_WORDS / 2 + 1).trim();
    const doc = fakeDoc([[line(big, 1)], [line(big, 1)]]);
    const out = await run(doc, { pageIndexes: [0, 1] });
    expect(out.filter((m) => m.type === 'page')).toHaveLength(1);
    expect(out.at(-1)).toMatchObject({ type: 'error', error: { kind: 'word-count' } });
  });

  it('checks the cancelled flag between pages and posts no done', async () => {
    const doc = fakeDoc([[line(prose, 1)], [line(prose, 1)]]);
    const out = await run(doc, { pageIndexes: [0, 1], cancelAfter: 1 });
    expect(out.filter((m) => m.type === 'page')).toHaveLength(1);
    expect(out.some((m) => m.type === 'done' || m.type === 'error')).toBe(false);
  });
});

describe('runCount', () => {
  async function count(
    open: () => Promise<PdfDocumentLike>,
    isCancelled: () => boolean = () => false,
  ): Promise<ExtractionMessageOut[]> {
    const out: ExtractionMessageOut[] = [];
    await runCount({ open, post: (m) => out.push(m), isCancelled });
    return out;
  }

  it('reports the page count and printed labels', async () => {
    const doc = fakeDoc([[line(prose, 700)], [line(prose, 700)], [line(prose, 700)]], ['i', '', 'iii']);
    expect(await count(() => Promise.resolve(doc))).toEqual([
      { type: 'counted', pageCount: 3, labels: ['i', null, 'iii'] },
    ]);
  });

  it('gives null labels when the PDF has none or reading them fails', async () => {
    const none = fakeDoc([[line(prose, 700)], [line(prose, 700)]], null);
    expect(await count(() => Promise.resolve(none))).toEqual([
      { type: 'counted', pageCount: 2, labels: [null, null] },
    ]);
    const failing: PdfDocumentLike = { ...none, getPageLabels: () => Promise.reject(new Error('x')) };
    expect(await count(() => Promise.resolve(failing))).toEqual([
      { type: 'counted', pageCount: 2, labels: [null, null] },
    ]);
  });

  it('maps a password failure to encrypted and any other failure to unreadable', async () => {
    const password = Object.assign(new Error('password'), { name: 'PasswordException' });
    expect(await count(() => Promise.reject(password))).toEqual([
      { type: 'error', error: { kind: 'encrypted' } },
    ]);
    expect(await count(() => Promise.reject(new Error('bad')))).toEqual([
      { type: 'error', error: { kind: 'unreadable' } },
    ]);
  });

  it('posts nothing when cancelled while opening or after it opened', async () => {
    const doc = fakeDoc([[line(prose, 700)]]);
    expect(await count(() => Promise.resolve(doc), () => true)).toEqual([]);
    const password = Object.assign(new Error('password'), { name: 'PasswordException' });
    expect(await count(() => Promise.reject(password), () => true)).toEqual([]);
  });

  describe('with real pdf.js (legacy build, no worker)', () => {
    async function countFixture(name: string): Promise<ExtractionMessageOut[]> {
      const pdfjs = (await import('pdfjs-dist/legacy/build/pdf.mjs')) as unknown as typeof import('pdfjs-dist');
      const bytes = await readFile(join(import.meta.dirname, 'fixtures', name));
      const task = pdfjs.getDocument({
        data: new Uint8Array(bytes),
        useWorkerFetch: false,
        useSystemFonts: false,
      });
      try {
        return await count(async () => (await task.promise) as unknown as PdfDocumentLike);
      } finally {
        await task.destroy();
      }
    }

    it('counts the pages of the 11-page fixture', async () => {
      const [message] = await countFixture('eleven-pages.pdf');
      expect(message).toMatchObject({ type: 'counted', pageCount: 11 });
      expect(message?.type === 'counted' && message.labels).toHaveLength(11);
    });

    it('reports the encrypted fixture as encrypted', async () => {
      expect(await countFixture('encrypted.pdf')).toEqual([
        { type: 'error', error: { kind: 'encrypted' } },
      ]);
    });
  });
});