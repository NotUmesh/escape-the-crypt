# Build log

## 2026-11-23
- Repo created, structure set up.
- Kiro: 
- Broke / caught:

## pdf.js worker spike (spec ingestion-and-evidence, task 1.2)
- Question: can pdf.js run inside our Extraction Worker, and in which configuration?
- Method: Playwright spike (`pdfjs-spike.e2e.ts`) against the production build, each configuration run on a fixture PDF. Checks: text comes back, `terminate()` stops all work (tick counter flat after terminate), no cross-origin request. Projects: Chromium, Firefox, Pixel 7 emulation (Android Chrome, emulated).
- Result (12 of 12 passed):

  | Configuration | Chromium | Firefox | Pixel 7 (emulated) |
  | --- | --- | --- | --- |
  | Nested pdf.js worker inside Extraction Worker | pass | pass | pass |
  | In-thread (fake worker) inside Extraction Worker | pass | pass | pass |

- Decision: **nested worker**. Both work everywhere, so the nested worker is chosen because pdf.js parsing stays off the Extraction Worker's own thread, and `terminate()` on the Extraction Worker also stopped the nested worker in every browser. Constant: `EXTRACTION_MODE = "nested-worker"` in `apps/web/src/features/ingest/extraction-mode.ts`.
- Main-thread fallback was not needed. If a real device ever breaks the nested worker, switch the constant to `"in-thread"` first. If both fail, use `"main-thread"`: run pdf.js on the main thread, and on cancel or timeout call `loadingTask.destroy()` (which also ends pdf.js's own worker) and drop the document.
- Still manual: a check on a real Android Chrome device. Pixel 7 here is emulation only (Chromium engine with mobile viewport and user agent).
- Cleanup: spike page and harness deleted. The spike Playwright test was removed with them, since it only drove that page. Cancel, timeout and network guarantees are covered by later tasks (9 and 12.1) against the real Extraction Worker.
