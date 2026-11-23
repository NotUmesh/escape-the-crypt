import { describe, expect, it } from 'vitest';
import { MAX_EXTRACTED_WORDS, MAX_EXTRACTION_MS } from '@escape-the-crypt/core';
import { mapPdfError, runExtraction } from './extraction-core';
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
