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

## Phase 5 baseline (task 28.2, before any Phase 5 change)

Vitest ran with `--maxWorkers=50%`. No Playwright suite was run.

| Check | Package | Result |
| --- | --- | --- |
| typecheck (`tsc --noEmit`) | packages/core | pass, no errors |
| typecheck (`tsc --noEmit`) | apps/worker | pass, no errors |
| vitest | packages/core | 136 files passed; 1084 tests passed, 0 failed, 0 skipped |
| vitest | apps/worker | 18 files passed; 226 tests passed, 0 failed, 0 skipped |
| cassette e2e (`e2e-pipeline.test.ts`, `e2e-cassette-digest.test.ts`) | packages/core | 2 files passed; 4 tests passed, 0 failed, 0 skipped |
| `pnpm lint` (eslint + structure check) | root | pass, "Structure checks passed." |

No failures at baseline.

## Checkpoint 30 (after Phase 5 task 29)

Vitest ran with `--maxWorkers=50%`; Playwright with `--workers=2` (port 4173 was free).
Two failures from task 29 files were fixed first: `bone-ordering-e2e-fixtures.ts` moved from `test-support/` to `pipeline/` (it imports the provider and mentioned the results folder, which `boundary.test.ts` and `no-eval-results-writes.test.ts` forbid there), and the Check_ID and CHECK_VERSION tests moved from `registry.test.ts` (318 lines) into `registry-ids.test.ts`.

| Check | Package | Result |
| --- | --- | --- |
| typecheck (`tsc --noEmit`) | packages/core | pass, no errors |
| typecheck (`tsc --noEmit`) | apps/worker | pass, no errors |
| typecheck (`tsc --noEmit`) | apps/web | pass, no errors |
| `pnpm lint` (eslint + structure check) | root | pass, "Structure checks passed." |
| vitest | packages/core | 143 files passed; 1145 tests passed, 0 failed, 0 skipped |
| vitest | apps/worker | 19 files passed; 228 tests passed, 0 failed, 0 skipped |
| vitest | apps/web | 111 files passed; 925 tests passed, 0 failed, 0 skipped |
| worker build (`pnpm --filter ./apps/worker build`) | apps/worker | pass, `dist/index.js` 1.8mb |
| Playwright e2e (`--workers=2`) | apps/web | 172 passed, 0 failed, 1 skipped |

### Checkpoint 32 (Phase 5, task 31 complete)

| Check | Package | Result |
| --- | --- | --- |
| typecheck (`tsc --noEmit`) | packages/core | pass, no errors |
| typecheck (`tsc --noEmit`) | apps/worker | pass, no errors |
| typecheck (`tsc --noEmit`) | apps/web | pass, no errors |
| `pnpm lint` (eslint + structure check) | root | pass, "Structure checks passed." |
| vitest `--maxWorkers=50%` | packages/core | 153 files passed; 1245 tests passed, 0 failed, 0 skipped |
| vitest `--maxWorkers=50%` | apps/worker | 20 files passed; 240 tests passed, 0 failed, 0 skipped |
| vitest `--maxWorkers=50%` | apps/web | 111 files passed; 925 tests passed, 0 failed, 0 skipped |
| worker build (`pnpm --filter ./apps/worker build`) | apps/worker | pass, `dist/index.js` 1.8mb |
| Playwright e2e (`--workers=2`) | apps/web | 172 passed, 0 failed, 1 skipped |

Fixes made at this checkpoint (both stale expectations from task 31):
- `packages/core/src/runtime/manifest-schema-hints.test.ts`: the "no payload schema" test used `bound-threads`, which now has a schema; it uses `cursed-object`.
- `packages/core/src/test-support/contract/job-completed.json`: golden job fixture regenerated. Only `manifestId` (now suffixed) and two `slotId` values (now prefixed with the room) changed.

Cassettes: only the `checkVersion` field changed (`2026-11-27.2` to `2026-11-27.3`) in `bone-ordering-e2e.json` and `human-heart-e2e.json`. No digest edits. `bound-threads-e2e.json` is new.
Lock types: `DEFAULT_ALLOWED_LOCK_TYPES` (core) and `ALLOWED_LOCK_TYPES` (worker) are both still `['rune-cipher', 'seance-board']`.

## Task 33.2: cursed-object Code_Checks
Task 33.2: adv-20 stays a review fixture; needs-category-and-outside-quotes is tested with hand-written questions; reason: adv-20's `expectedCatch` is `review:odd-item-not-explicitly-outside` (repo convention: `review:` fixtures must pass every code check and are rejected by the blind review, tested in task 33.5). Its quotes never mention the odd item "Moths", so a code check that required the odd item's text would contradict that label. A test reads adv-20 at test time and expects no code failures.
Heuristic implemented (`locks/cursed-object-checks.ts`): over uniquely resolved quotes, one quote must be a category quote (names a non-odd item, or has at least half its content words in `categoryRule`) and a different quote must be an outside quote (an exclusion marker such as "not", or the odd item's text). Checked on all 13 real cursed-object questions in eval/dev/questions and samples/questions: zero failures. adv-27 fails only `item-count`. The registry, run-checks.ts and CHECK_VERSION are unchanged (task 33.3).

## Checkpoint 34

| Check | Pass | Fail | Skipped | Notes |
| --- | --- | --- | --- | --- |
| tsc packages/core | clean | 0 | 0 | exit 0 |
| tsc apps/worker | clean | 0 | 0 | exit 0 |
| tsc apps/web | clean | 0 | 0 | exit 0 |
| pnpm lint (ESLint + structure) | pass | 0 | 0 | First run failed structure: generation-schema.test.ts was 311 lines. Moved the bound-threads and cursed-object tests to generation-schema-arms.test.ts; now passes |
| vitest packages/core | 1327 (161 files) | 0 | 0 | |
| vitest apps/worker | 241 (20 files) | 0 | 0 | |
| vitest apps/web | 1160 (140 files) | 2 | 0 | share-card-css.test.ts "is allowed in the copy file only"; style-guard.test.ts "reports no violations in any .css/.ts/.tsx file". Both come from the committed share-card files (HEAD 6be0ebc), not Phase 5 |
| worker build | ok | 0 | 0 | dist/index.js 1.9mb |
| web e2e (--workers=2) | 175 | 0 | 1 | |

Cassette and constants: e2e-pipeline, e2e-cassette-digest, bone-ordering-e2e, bound-threads-e2e, cursed-object-e2e and human-heart tests all pass (6 files, 36 tests). CHECK_VERSION is 2026-11-27.4. DEFAULT_ALLOWED_LOCK_TYPES and ALLOWED_LOCK_TYPES are both ['rune-cipher', 'seance-board'].

Haunting polish: Open_Decision 4 findings (report-only audit, `outside-crypt-motion-audit.test.ts`):
- desk/desk-scene.css: `.desk-scene[data-push='true'] .desk-scene__stage` animation has no reduced-motion rule.
- dig/dig.css: `.cavern__mist` (90 s) and `.cavern__speck` (9 s) loop forever. They read as ambient loops, so they probably need to join the named allowlist, but each needs a `reduce` rule first. Not yet checked.
- descent/descent.css: `.descent--fade` animation has no reduced-motion rule.
- descent and start: no screen source reads `useLantern`.
Runtime note from the selector properties: a Skipped lock queues a return without a `ghostSpawned` notice, so no ghost rises on screen for it. This is by design: decision D3 in the room-runtime brief (skip settles the lock with no ghost visual and no penalty). Property 3 checks only that a ghost laid to rest belongs to a concept that had a ghost earlier.

## Checkpoint 36 (after task 35: combination-dial)

| Check | Pass | Fail | Skipped | Notes |
| --- | --- | --- | --- | --- |
| tsc packages/core | clean | 0 | 0 | exit 0 |
| tsc apps/worker | clean | 0 | 0 | exit 0 |
| tsc apps/web | clean | 0 | 0 | exit 0 |
| pnpm lint (ESLint + structure) | pass | 0 | 0 | First run: generation-prompt.test.ts (task 35.1) imported `zod` directly; changed to `import { z } from '../zod'`. Re-run passes |
| vitest packages/core | 1519 (175 files) | 0 | 0 | |
| vitest apps/worker | 255 (22 files) | 0 | 0 | |
| vitest apps/web | 1223 (153 files) | 0 | 0 | share-card-css and style-guard tests pass in this run |
| worker build | ok | 0 | 0 | dist/index.js 1.9mb |
| web e2e (--workers=2) | 175 | 0 | 1 | port 4173 had no listener |

Cassette and constants: e2e-pipeline, e2e-cassette-digest, bone-ordering-e2e, bound-threads-e2e, cursed-object-e2e, combination-dial-e2e and human-heart tests pass (7 files, 39 tests) with no digest edits. Only `checkVersion` changed in task 35.2 for human-heart-e2e, bone-ordering-e2e, bound-threads-e2e and cursed-object-e2e (2026-11-27.4 to 2026-11-27.5). combination-dial-e2e.json is new. The `--allowed-lock-types rune-cipher,seance-board` replay digest test in apps/worker cli.test.ts passes (12 tests in that file). CHECK_VERSION is 2026-11-27.5. DEFAULT_ALLOWED_LOCK_TYPES and ALLOWED_LOCK_TYPES are both ['rune-cipher', 'seance-board']; EVAL_ALLOWED_LOCK_TYPES and PHASE5_TEST_ALLOWED_LOCK_TYPES list all six. The registry has all 17 phase-5 Check_IDs implemented (bone-ordering 3, bound-threads 2, cursed-object 4, combination-dial 8).

Haunting polish, decisions after the integration push:
- Announcements: `usePersistedRoom` releases notices a render after the State, once the Event is written. `CryptFlow` had already handled that State and dropped them. `announce-step.ts` now announces late notices once, and has a unit test. The moment e2e asserts the sentences again.
- Due ghost: `drawn-ghosts.ts` keeps a due ghost drawn while its return is open (room or final door). `use-placed-ghosts.ts` holds a departed ghost for 400 ms so a late `ghostLaidToRest` still starts the fade. `crypt-run-view.tsx` now passes notices to the final door, where nothing animated before.
