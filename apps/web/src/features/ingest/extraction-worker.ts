/// <reference lib="webworker" />
import * as pdfjs from 'pdfjs-dist';
import { EXTRACTION_MODE } from './extraction-mode';
import { mapPdfError, runCount, runExtraction } from './extraction-core';
import type {
  Clock,
  ExtractionMessageIn,
  ExtractionMessageOut,
  PdfDocumentLike,
} from './extraction-core';
import { safeDocumentParams } from './extraction-options';
import { pdfWorkerUrl } from './pdf-worker-url';

const clock: Clock = { now: () => Date.now() };
let cancelled = false;

function post(message: ExtractionMessageOut): void {
  self.postMessage(message);
}

/**
 * Opens a PDF with the safe options from extraction-options.ts.
 */
function openTask(fileBuffer: ArrayBuffer): ReturnType<typeof pdfjs.getDocument> {
  // Both "nested-worker" and "in-thread" load the same self-hosted file:
  // pdf.js starts it as a worker, or imports it for its in-thread mode.
  pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl(
    import.meta.env.BASE_URL,
    self.location.origin,
  );
  return pdfjs.getDocument(safeDocumentParams(fileBuffer));
}

async function start(msg: Extract<ExtractionMessageIn, { type: 'start' }>): Promise<void> {
  cancelled = false;
  if (EXTRACTION_MODE === 'main-thread') {
    // The main-thread mode runs pdf.js in the client, not in this worker.
    post({ type: 'error', error: { kind: 'unreadable' } });
    return;
  }
  const task = openTask(msg.fileBuffer);
  try {
    const doc: PdfDocumentLike = await task.promise;
    await runExtraction({
      doc,
      pageIndexes: msg.pageIndexes,
      startedAtMs: msg.startedAtMs,
      clock,
      post,
      isCancelled: () => cancelled,
    });
  } catch (err) {
    post({ type: 'error', error: mapPdfError(err) });
  } finally {
    await task.destroy();
  }
}

async function count(msg: Extract<ExtractionMessageIn, { type: 'count' }>): Promise<void> {
  cancelled = false;
  if (EXTRACTION_MODE === 'main-thread') {
    post({ type: 'error', error: { kind: 'unreadable' } });
    return;
  }
  const task = openTask(msg.fileBuffer);
  try {
    await runCount({
      open: async () => (await task.promise) as PdfDocumentLike,
      post,
      isCancelled: () => cancelled,
    });
  } finally {
    await task.destroy();
  }
}

self.onmessage = (event: MessageEvent<ExtractionMessageIn>): void => {
  const msg = event.data;
  if (msg.type === 'cancel') {
    cancelled = true;
    return;
  }
  void (msg.type === 'count' ? count(msg) : start(msg));
};