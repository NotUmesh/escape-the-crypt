import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  MAX_EXTRACTED_WORDS,
  MAX_EXTRACTION_MS,
  MAX_FILE_SIZE_BYTES,
  MAX_SELECTED_PAGES,
  capPageSelection,
} from '@escape-the-crypt/core';
import { runExtraction } from './extraction-core';
import type { ExtractionMessageOut, PdfDocumentLike } from './extraction-core';
import { createExtractionClient } from './extraction-client';
import type { WorkerLike } from './extraction-client';
import { buildOversizedPdf } from './fixtures/generate-fixtures';

type PdfJs = typeof import('pdfjs-dist');

let pdfjsPromise: Promise<PdfJs> | null = null;
function loadPdfjs(): Promise<PdfJs> {
  // The legacy build runs in Node; no Worker exists, so pdf.js uses its fake worker.
  pdfjsPromise ??= import('pdfjs-dist/legacy/build/pdf.mjs') as Promise<PdfJs>;
  return pdfjsPromise;
}

async function openFixture(name: string): Promise<PdfDocumentLike> {
  const pdfjs = await loadPdfjs();
  // Vitest runs with apps/web as the working directory.
  const bytes = await readFile(resolve(process.cwd(), 'src/features/ingest/fixtures', name));
  const task = pdfjs.getDocument({
    data: new Uint8Array(bytes),
    useWorkerFetch: false,
    useSystemFonts: false,
  });
  return (await task.promise) as unknown as PdfDocumentLike;
}

async function extract(
  doc: PdfDocumentLike,
  pageIndexes: readonly number[],
  now: () => number = () => 0,
): Promise<ExtractionMessageOut[]> {
  const out: ExtractionMessageOut[] = [];
  await runExtraction({
    doc,
    pageIndexes,
    startedAtMs: 0,
    clock: { now },
    post: (m) => out.push(m),
    isCancelled: () => false,
  });
  return out;
}

const range = (n: number): number[] => Array.from({ length: n }, (_, i) => i);

describe('extraction limits (fixture PDFs)', () => {
  it('rejects a PDF just over the file-size limit without starting a worker', async () => {
    const bytes = await buildOversizedPdf();
    expect(bytes.byteLength).toBeGreaterThan(MAX_FILE_SIZE_BYTES);
    const createWorker = vi.fn((): WorkerLike => {
      throw new Error('worker must not start');
    });
    const client = createExtractionClient({
      createWorker,
      clock: { now: () => 0 },
      setTimer: () => 1,
      clearTimer: () => undefined,
    });
    const arrayBuffer = vi.fn(() => Promise.resolve(new ArrayBuffer(0)));
    const result = await client.start({
      file: { size: bytes.byteLength, arrayBuffer },
      pageIndexes: [0],
      onMessage: () => undefined,
    });
    expect(result).toEqual({
      ok: false,
      error: { kind: 'file-size', limitBytes: MAX_FILE_SIZE_BYTES },
    });
    expect(createWorker).not.toHaveBeenCalled();
    expect(arrayBuffer).not.toHaveBeenCalled();
  });

  it('caps an 11-page PDF to 10 selected pages and extracts only those', async () => {
    const doc = await openFixture('eleven-pages.pdf');
    expect(doc.numPages).toBe(MAX_SELECTED_PAGES + 1);
    const { kept, capped } = capPageSelection(range(doc.numPages));
    expect(capped).toBe(true);
    expect(kept).toHaveLength(MAX_SELECTED_PAGES);
    const out = await extract(doc, kept);
    expect(out.filter((m) => m.type === 'page')).toHaveLength(MAX_SELECTED_PAGES);
    expect(out.at(-1)).toEqual({ type: 'done' });
  });

  it('stops with a word-count error on the 6,500-word fixture', async () => {
    const doc = await openFixture('over-word-limit.pdf');
    const out = await extract(doc, range(doc.numPages));
    expect(out.at(-1)).toMatchObject({
      type: 'error',
      error: { kind: 'word-count', limit: MAX_EXTRACTED_WORDS },
    });
    expect(out.some((m) => m.type === 'done')).toBe(false);
  });

  it('stops with a time error when the injected clock jumps past 20 seconds', async () => {
    const doc = await openFixture('ok-page.pdf');
    let t = 0;
    const out = await extract(doc, [0], () => {
      const current = t;
      t = MAX_EXTRACTION_MS + 1;
      return current;
    });
    expect(out.at(-1)).toEqual({ type: 'error', error: { kind: 'time', limitMs: MAX_EXTRACTION_MS } });
    expect(out.some((m) => m.type === 'page' || m.type === 'done')).toBe(false);
  });
});
