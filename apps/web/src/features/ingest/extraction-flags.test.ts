import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { chunkDocument, resolveQuote } from '@escape-the-crypt/core';
import type { Chunk } from '@escape-the-crypt/core';
import { runExtraction } from './extraction-core';
import type { ExtractionMessageOut, PdfDocumentLike } from './extraction-core';

type PdfJs = typeof import('pdfjs-dist');
type PageMessage = Extract<ExtractionMessageOut, { type: 'page' }>;

let pdfjsPromise: Promise<PdfJs> | null = null;
function loadPdfjs(): Promise<PdfJs> {
  // The legacy build runs in Node; no Worker exists, so pdf.js uses its fake worker.
  pdfjsPromise ??= import('pdfjs-dist/legacy/build/pdf.mjs') as Promise<PdfJs>;
  return pdfjsPromise;
}

/** Extracts page 1 of a fixture through the real pdf.js path. */
async function extractFirstPage(name: string): Promise<PageMessage> {
  const pdfjs = await loadPdfjs();
  const bytes = await readFile(join(import.meta.dirname, 'fixtures', name));
  const task = pdfjs.getDocument({
    data: new Uint8Array(bytes),
    useWorkerFetch: false,
    useSystemFonts: false,
  });
  const doc = (await task.promise) as unknown as PdfDocumentLike;
  const out: ExtractionMessageOut[] = [];
  await runExtraction({
    doc,
    pageIndexes: [0],
    startedAtMs: 0,
    clock: { now: () => 0 },
    post: (m) => out.push(m),
    isCancelled: () => false,
  });
  const page = out.find((m): m is PageMessage => m.type === 'page');
  if (page === undefined) throw new Error(`no page extracted from ${name}`);
  return page;
}

describe('page flags (fixture PDFs)', () => {
  it('flags a prose page as ok', async () => {
    expect((await extractFirstPage('ok-page.pdf')).flag).toBe('ok');
  });

  it('flags an image-only page as low-text', async () => {
    expect((await extractFirstPage('image-only.pdf')).flag).toBe('low-text');
  });

  it('flags a garbled page as suspicious', async () => {
    expect((await extractFirstPage('garbled.pdf')).flag).toBe('suspicious');
  });

  it('flags a table-like page as suspicious', async () => {
    expect((await extractFirstPage('table-like.pdf')).flag).toBe('suspicious');
  });
});

describe('multi-paragraph extraction (three-paragraphs.pdf)', () => {
  it('keeps paragraphs apart, makes three chunks and resolves a quote across the hyphen break', async () => {
    const page = await extractFirstPage('three-paragraphs.pdf');
    expect(page.flag).toBe('ok');
    expect(page.text.split(/\n[^\S\n]*\n/u)).toHaveLength(3);

    const chunks = chunkDocument({
      sourceType: 'pdf',
      pages: [
        {
          pdfPageIndex: page.pdfPageIndex,
          printedPageLabel: page.printedPageLabel,
          text: page.text,
          originalText: page.text,
        },
      ],
    });
    expect(chunks).toHaveLength(3);

    // chunkDocument reflows the page: the line-break hyphen is joined and wraps become spaces.
    const second = chunks[1] as Chunk;
    expect(second.text).toContain('A good example is closing the book');
    expect(second.text).not.toMatch(/exam-\s*ple/u);
    expect(second.text).not.toContain('\n');
    const byId = new Map(chunks.map((c) => [c.id, c]));
    // A quote copied from the raw extraction, with the break, still resolves.
    for (const quote of ['A good exam-\nple is closing the book', 'A good example is closing the book']) {
      const result = resolveQuote(byId, second.id, quote);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(second.text.slice(result.value.start, result.value.end)).toBe(
          'A good example is closing the book',
        );
      }
    }
  });
});
