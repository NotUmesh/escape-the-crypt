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
## Integration and structure checks (spec ingestion-and-evidence, task 12)
- Stop button: the layout e2e loads the test parent with `?hold=1`, which wraps the real client so `count` and `start` wait until the test releases them. Stop is checked during both steps for visibility, a 44x44 box, no cover, and Enter and Space. A count stopped while held stays stopped after release.
- The e2e-only test page cannot ship: `vite build --mode e2e` writes to `apps/web/dist-e2e`, and `pnpm lint` runs `scripts/check-structure.ts`, which fails if `apps/web/dist` holds a `test-parent` or e2e file or mentions the `ingestTest` hook. A test builds the app both ways and checks that a normal build passes and an e2e build fails.
- The same script checks that `packages/core` imports nothing but `@noble/hashes` and relative files (tests may also use vitest, fast-check and `node:`), uses no DOM global, has `@noble/hashes` at an exact version as its only runtime dependency, that no source file passes 300 lines, that file names are kebab-case, and that the shared types are declared only in `types.ts`.
- Firefox and axe: Playwright's Firefox crashes the page when axe runs on a page that has also run the pdf.js worker (axe 4.14, Playwright 1.65, legacy mode too). The real-PDF page-list scan is tagged `@real-pdf-axe` and runs on Chromium and Pixel; the Firefox project excludes it with `grepInvert`. Every project, Firefox included, also scans the page list rendered through the test parent with `?client=canned`: a fake Extraction Client (`src/test-support/canned-extraction-client.ts`) returns one ok, one low-text and one suspicious page with printed labels iv, v and vi, flagged by the real Page Checker, and runs no pdf.js worker. A unit test checks the canned pages get those three flags.
- parseNotesRecord is hand-checked and tested; migrate to Zod in spec 3.

## Room runtime: reducer, judges, ghosts, final door, outcomes (spec room-runtime, task 7.8)
- What exists: a pure reducer in `packages/core/src/runtime/` (`apply(state, event)` returns the next state and notices, or a typed rejection). Game state is a fold over a JSON-safe event log, so a reload replays to the same state. The reducer has no timers, randomness or I/O. Invalid events return a typed error and leave the state as it was.
- Six answer judges, one file per lock type in `packages/core/src/locks/`: rune cipher, séance board, bone ordering, bound threads, cursed object, combination dial. Each judge returns correct, wrong or invalid, and `judge-registry.ts` holds exactly those six IDs. The combination dial compares on integer tenths, so `22.1` against 21.5 ± 0.5 is wrong and `22.15` is invalid.
- Ghost queue: a wrong first answer raises a ghost. It comes back as a Return slot after `GHOST_DELAY = 3` judged answers. Return 1 uses the unused Alternate (otherwise the primary), return 2 uses the primary and is labelled "Review". A second miss leaves a lingering spirit and sets the review-due flag. Skips and challenges never count toward the delay. A Return never shows a challenged question.
- Final door: it mixes the manifest's reserved questions with every outstanding ghost and deferred skip, with the delay waived. Escape is always reachable, including after all wrong answers or all challenges (zero candles).
- Outcomes: each concept ends as first-try correct, assisted, retried, challenged or review due. Challenged questions are excluded from the score and from candle counts.
- Hook change: `.kiro/hooks/run-core-tests.mjs` now picks its command by saved path. A save under `packages/core/src/runtime/` or `packages/core/src/locks/` runs `vitest run src/runtime src/locks`. Any other save under `packages/core/src/` still runs the full core suite, and saves outside it are skipped. CI remains the release gate.
- Full core suite, run for this entry (`pnpm --filter @escape-the-crypt/core test --run`): 66 test files passed, 439 tests passed, 0 failed, 0 skipped. Duration about 21 s. No known failures in core.
- Not covered by that run: lint, typecheck, and the web and worker packages.
- Bugs caught in review (spec 2):
  - Requirements: a wrong return 1 at the final door would have left the concept with no outcome.
  - Requirements: the Challenged outcome was unreachable under D4.
  - Requirements: job events were rejected before RunStarted.
  - Design: bound-threads used Set, which JSON drops, so answers would vanish on reload.
  - Design: reserved final-door questions had no question content.
  - Design: judges couldn't see which hint was applied.
  - Design: a challenged primary followed by a correct Alternate matched none of the five outcomes (fixed with `answeredCorrectFirst`).
  - Code review: four judges threw on a null or wrong-typed submission.
  - Code review: answer, hint, skip and challenge were accepted for locks outside the current room.
  - Code review: a challenged question could come back as a "Review" Return.
  - Code review: door slots were gated on availability instead of entry.
  - Tests: Property 2 was flaky because random runs rarely got far enough.
  - Tests: model runs ran below 100 iterations, with no proof they reached ghosts (coverage counters added).
  - Process: a test helper left out of a commit broke CI typecheck.
