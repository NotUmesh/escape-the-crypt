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

## Property 12 caught a design flaw in the chunker merge step (spec ingestion-and-evidence, task 4.7)
- Caught: the chunk size property test (seed 1973783039) fed one ~2,400-character sentence and got chunks of 1,199, 1,200 and 21 characters. A short last piece was merged backward, the merged text was over 1,200 characters, and re-splitting cut at the same word boundary, so the short tail came back. The design said a merged piece is never merged again, so nothing fixed it.
- Fix: when the re-split leaves a tail under 40 characters, the last two pieces are rebalanced. The cut goes inside `[total - 1200, total - 40]`, preferring a sentence boundary, then the word boundary closest to the window end, then a hard cut that keeps surrogate pairs whole. Requirement 6.14 and Property 12 stay as written. Code: `packages/core/src/chunker-rebalance.ts`. Design step 4 updated.
## First Kiro hook: run core tests on save (spec ingestion-and-evidence, task 8)
- Hook "Run core tests on save", created with Kiro's `createHook` tool. Produced file: `.kiro/hooks/run-core-tests-on-save.json` (v2 hook format).
- Trigger: `PostFileSave`, matcher `packages[/\\]core[/\\]src[/\\]` (accepts `/` and `\`). Command: `node .kiro/hooks/run-core-tests.mjs`, which runs `pnpm --filter @escape-the-crypt/core test --run` and exits with its status.
- The script reads the hook's stdin defensively. Missing, empty or unparseable input, or JSON with no file path, runs the tests. It skips (exit 0) only when a file path is present and outside `packages/core/src`. It writes no logs or user content under `.kiro/`.
- CI remains the release gate. The hook is fast feedback only.
