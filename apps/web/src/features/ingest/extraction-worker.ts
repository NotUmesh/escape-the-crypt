/// <reference lib="webworker" />
import * as pdfjs from 'pdfjs-dist';
import type { DocumentInitParameters } from 'pdfjs-dist/types/src/display/api';
import { EXTRACTION_MODE } from './extraction-mode';
import { mapPdfError, runExtraction } from './extraction-core';
import type {
  Clock,
  ExtractionMessageIn,
  ExtractionMessageOut,
  PdfDocumentLike,
} from './extraction-core';

/** Self-hosted, same-origin pdf.js worker file (apps/web/public). */
const PDF_WORKER_PATH = '/pdf.worker.min.mjs';

const clock: Clock = { now: () => Date.now() };
let cancelled = false;

function post(message: ExtractionMessageOut): void {
  self.postMessage(message);
}

async function start(msg: Extract<ExtractionMessageIn, { type: 'start' }>): Promise<void> {
  cancelled = false;
  if (EXTRACTION_MODE === 'main-thread') {
    // The main-thread mode runs pdf.js in the client, not in this worker.
    post({ type: 'error', error: { kind: 'unreadable' } });
    return;
  }
  // Both "nested-worker" and "in-thread" load the same self-hosted file:
  // pdf.js starts it as a worker, or imports it for its in-thread mode.
  pdfjs.GlobalWorkerOptions.workerSrc = new URL(PDF_WORKER_PATH, self.location.origin).href;

  // No password callback is set; scripting is off; cMap and standard-font
  // fetching are off, so nothing is requested from another origin.
  const params: DocumentInitParameters & { enableScripting: false } = {
    data: new Uint8Array(msg.fileBuffer),
    enableScripting: false,
    useWorkerFetch: false,
    useSystemFonts: false,
  };
  const task = pdfjs.getDocument(params);
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

self.onmessage = (event: MessageEvent<ExtractionMessageIn>): void => {
  const msg = event.data;
  if (msg.type === 'cancel') {
    cancelled = true;
    return;
  }
  void start(msg);
};
