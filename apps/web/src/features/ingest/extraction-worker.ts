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

interface OpenTask {
  readonly task: ReturnType<typeof pdfjs.getDocument>;
  /** Destroys the loading task, then the pdf.js worker this call started. */
  readonly close: () => Promise<void>;
}
/**
 * Opens a PDF with the safe options from extraction-options.ts.
 *
 * pdf.js cannot start its own worker from inside a worker: it reads `window.location`,
 * which does not exist here, and falls back to running in this thread ("fake worker").
 * So this starts the self-hosted worker file itself and hands pdf.js the port.
 * Terminating this Extraction Worker also stops the nested one.
 */
function openTask(fileBuffer: ArrayBuffer): OpenTask {
  const port = new Worker(pdfWorkerUrl(import.meta.env.BASE_URL, self.location.origin), {
    type: 'module',
  });
  const worker = pdfjs.PDFWorker.create({ port });
  const task = pdfjs.getDocument({ ...safeDocumentParams(fileBuffer), worker });
  return {
    task,
    close: async () => {
      await task.destroy();
      worker.destroy();
      port.terminate();
    },
  };
}

async function start(msg: Extract<ExtractionMessageIn, { type: 'start' }>): Promise<void> {
  cancelled = false;
  if (EXTRACTION_MODE === 'main-thread') {
    // The main-thread mode runs pdf.js in the client, not in this worker.
    post({ type: 'error', error: { kind: 'unreadable' } });
    return;
  }
  const { task, close } = openTask(msg.fileBuffer);
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
    await close();
  }
}

async function count(msg: Extract<ExtractionMessageIn, { type: 'count' }>): Promise<void> {
  cancelled = false;
  if (EXTRACTION_MODE === 'main-thread') {
    post({ type: 'error', error: { kind: 'unreadable' } });
    return;
  }
  const { task, close } = openTask(msg.fileBuffer);
  try {
    await runCount({
      open: async () => (await task.promise) as PdfDocumentLike,
      post,
      isCancelled: () => cancelled,
    });
  } finally {
    await close();
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