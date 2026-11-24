import type { ExtractionClient } from '../features/ingest/extraction-client';
import { runCount, runExtraction } from '../features/ingest/extraction-core';
import type { ExtractionMessageOut, PdfDocumentLike } from '../features/ingest/extraction-core';

type PdfJs = typeof import('pdfjs-dist');

/**
 * Test double for the Extraction Client that reads the file it is given with the
 * real pdf.js (legacy build, no Worker) and the same `runCount` and
 * `runExtraction` the Extraction Worker uses. Messages arrive asynchronously.
 */
export function createRealPdfjsClient(): ExtractionClient {
  let generation = 0;

  async function withDocument(
    file: { arrayBuffer(): Promise<ArrayBuffer> },
    use: (doc: PdfDocumentLike, isCancelled: () => boolean) => Promise<void>,
  ): Promise<void> {
    const mine = (generation += 1);
    const pdfjs = (await import('pdfjs-dist/legacy/build/pdf.mjs')) as unknown as PdfJs;
    const task = pdfjs.getDocument({
      data: new Uint8Array(await file.arrayBuffer()),
      useWorkerFetch: false,
      useSystemFonts: false,
    });
    try {
      const doc = (await task.promise) as unknown as PdfDocumentLike;
      await use(doc, () => generation !== mine);
    } finally {
      await task.destroy();
    }
  }

  const deliver = (onMessage: (m: ExtractionMessageOut) => void) => (m: ExtractionMessageOut) =>
    onMessage(m);

  return {
    count: ({ file, onMessage }) => {
      void withDocument(file, (doc, isCancelled) =>
        runCount({ open: () => Promise.resolve(doc), post: deliver(onMessage), isCancelled }),
      ).catch(() => onMessage({ type: 'error', error: { kind: 'unreadable' } }));
      return Promise.resolve({ ok: true, value: true });
    },
    start: ({ file, pageIndexes, onMessage }) => {
      void withDocument(file, (doc, isCancelled) =>
        runExtraction({
          doc,
          pageIndexes,
          startedAtMs: 0,
          clock: { now: () => 0 },
          post: deliver(onMessage),
          isCancelled,
        }),
      ).catch(() => onMessage({ type: 'error', error: { kind: 'unreadable' } }));
      return Promise.resolve({ ok: true, value: true });
    },
    cancel: () => {
      generation += 1;
    },
    terminate: () => {
      generation += 1;
    },
  };
}