/**
 * How pdf.js runs inside the Extraction Worker. Decided by the task 1 spike
 * (see docs/build-log.md). `extraction-client.ts` and `extraction-worker.ts`
 * read this constant; do not duplicate the decision elsewhere.
 *
 * - "nested-worker": pdf.js starts its own self-hosted worker from inside the
 *   Extraction Worker. Terminating the Extraction Worker also stops it.
 * - "in-thread": pdf.js fake-worker mode inside the Extraction Worker.
 * - "main-thread": fallback; pdf.js runs on the main thread and cancel or
 *   timeout calls `loadingTask.destroy()` and ends pdf.js's worker.
 */
export type ExtractionMode = "nested-worker" | "in-thread" | "main-thread";

export const EXTRACTION_MODE: ExtractionMode = "nested-worker";
