# Build log

## Costume Step 2
- Implemented outside Kiro with GitHub Copilot. The playable room now fills the page below a stone HUD. The stock art, hotspots and lights share one crop; hover and keyboard focus trace the lock shapes, and a wax seal by the door advances the run. The existing lock close-up and final-door scenes remain separate.

## Costume Step 1
- Implemented outside Kiro with GitHub Copilot. Added shared code-drawn parchment, stone, brass, wax, tags and candle ornaments to the existing screens, with keyboard focus and forced-colors treatments. Kept the gameplay, art placement and screen flow unchanged.

## Costume Step 0
- Implemented outside Kiro with GitHub Copilot. Removed the Lantern toggle and atmosphere overlays; retained painted art, candles, ghosts, contrast backing, and automatic reduced motion.
- Connected the shipped final-door and escape clips to the existing skippable transition, with escape after the last answer's evidence. No game rules or worker behavior changed.

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
- Open_Decision 4 fixes, one commit each: desk push-in holds its end frame under reduced motion; the descent fade is clear at once under reduced motion; the dig mist and specks are named ambient loops (both already stop under reduced motion). The descent and start screens draw no atmosphere, and Lantern_Mode controls the overlay only, so they need no `useLantern`. The descent clips keep playing in Lantern_Mode by decision; reduced motion skips them. The audit now flags only screens that draw atmosphere without reading `useLantern`. It reports 0 findings.

Haunting polish checkpoint at c1ddaee (clean worktree, Node 22.23.5):
| run | passed | failed | skipped | notes |
| --- | --- | --- | --- | --- |
| vitest apps/web (--maxWorkers=50%) | 1340 (169 files) | 0 | 0 | |
| vitest packages/core (--maxWorkers=50%) | 1530 (177 files) | 0 | 0 | |
| web e2e chromium, firefox, pixel (--workers=2) | 235 | 0 | 1 | skip is crypt-hotspots "door too small for placed seals"; haunting-moments 24/24 (8 per project) |
Not yet written: haunting-axe.e2e.ts and haunting-input.e2e.ts (tasks 9.2, 9.3), and the per-moment screenshots of Checkpoint B. Still held: QuillMark and Lantern toggle in autopsy-view.tsx and final-door.tsx, and the title routed through DeskHub (Open_Decisions 1 and 2).

## Task 39.4 (open points, record only)
- Streaming a new room into a running game (Req 16.4, 22.10) remains deferred and unchanged by Phase 5.
- The combination dial's `reveal-digit` hint stays unreachable for now: the mapper always produces `hintEffect: null` and `narrowHint` rejects any non-`null` dial hint (tasks 35.5, 35.7).
- Test-support finding from 39.1: `buildManifest({ hintEffects: true })` in `packages/core/src/test-support/question-payloads.ts` still emits a `reveal-digit` hint for dial questions, which the schema rejects. Left as is; noted for a follow-up.
- Fixed: the fixture now gives combination-dial questions `hint: null` (hintEffect null), other types unchanged; `buildManifest({ hintEffects: true })` over all six types passes `CryptManifestSchema` (asserted in `manifest-schema-six-types.test.ts`, workaround removed).

## Task 39.5 (play panels in LOCK_PANELS, read-only check)
Read `apps/web/src/features/crypt/lock-panel-registry.ts` as it stands; last commit touching it: 337bc6a "Lock types phase 2: register the four panels, payloadFor, panel announcer, unknown-type fallback, registry and art tests".
- Present: bone-ordering, bound-threads, cursed-object, combination-dial
- Missing: none
## Task 39.6 (allow-lists widened, per type)
Widened in this order, one type per edit, in both `DEFAULT_ALLOWED_LOCK_TYPES` (`packages/core/src/pipeline/generation-prompt.ts`) and `ALLOWED_LOCK_TYPES` (`apps/worker/src/config.ts`): bone-ordering, bound-threads, cursed-object, combination-dial. Widened: all four. Left out: none (every panel is present in `LOCK_PANELS`, see 39.5). Both lists now equal the six types in order: rune-cipher, seance-board, bone-ordering, bound-threads, cursed-object, combination-dial.
- Release_Status gating (Req 14.9, 23.5) stays in P6; no gating code was added.
- Tests that relied on the old two-type default now pass the explicit list `['rune-cipher', 'seance-board']`: the frozen two-type schema hash test (hash value unchanged), the bone-ordering, bound-threads, cursed-object and combination-dial "not offered by default" assertions, and the worker `HEART_SETTINGS` (pinned like `HUMAN_HEART_E2E_OPTIONS`). No cassette, digest or golden fixture was edited.
- The worker `cli.test.ts` replay test now replays dev-01 with all six types against the re-recorded cassette (run 2026-11-27-3, gpt-5.4-mini, temperature 0.2).

## Checkpoint 40 (Phase 5 final gates)
| Gate | Result |
| --- | --- |
| typecheck packages/core, apps/worker, apps/web | pass, pass, pass |
| `pnpm lint` | ESLint: 1 error left, in `apps/worker/src/provider/scratch-keywords.test.ts` (untracked scratch file, not touched). The one in `manifest-schema-six-types.test.ts` was fixed. Structure check run on its own: pass |
| vitest core | 181 files, 1579 tests passed, 0 failed, 0 skipped |
| vitest worker | 23 files, 255 tests passed, 0 failed, 0 skipped |
| vitest web | 167 files, 1329 tests passed, 0 failed, 0 skipped |
| worker build | pass |
| web e2e (`--workers=2`) | 229 passed, 0 failed, 7 skipped |

Acceptance, run 2026-11-27-3 (gpt-5.4-mini, temperature 0.2, check version 2026-11-27.5, six types, policy promoteAlternates+dedupeAnswers). 12 of 12 dev notes published a crypt. 203 live and 44 replayed calls. Spent $0.372210 of the $2.00 cap.
| Lock type | Candidates | Code-check rejected (Check_IDs) | Review rejected (reasons) | Accepted | Placed as lead |
| --- | --- | --- | --- | --- | --- |
| rune-cipher | 83 | 13 (negative-question 7, answer-leak-in-prompt 5, quote-too-long 2, rune-needs-one-blank 1) | 5 (answer-mismatch 5) | 65 | 12 |
| seance-board | 35 | 1 (quote-not-found 1) | 5 (label-mismatch 4, unknown-label 1) | 29 | 9 |
| bone-ordering | 13 | 1 (no-explicit-sequence-marker-in-quotes 1) | 0 | 12 | 9 |
| bound-threads | 4 | 1 (not-one-to-one 1) | 0 | 3 | 3 |
| cursed-object | 7 | 3 (needs-category-and-outside-quotes 2, negative-question 2) | 0 | 4 | 4 |
| combination-dial | 30 | 10 (number-not-in-quote 10; quote-not-found 1) | 1 (answer-mismatch 1) | 19 | 7 |

The result file records no wrong-accepted or correct-rejected counts against gold labels, no schema-rejection count and no time to first playable room. Per-note stage timings summed: p50 10.4 s, p90 14.3 s. Replay of the new cassettes (both policies, six types) reproduces these per-type counts and writes nothing under eval/results.

## Gemini fallback provider (record only)
- Added `PROVIDER=gemini` as a manual fallback (`apps/worker/src/provider/gemini-provider.ts`, `generateContent` v1 over REST). OpenAI stays the default; there is no automatic failover.
- Cassette provenance is the folder path: Gemini cassettes go to `cassettes/dev-gemini/<model-id>/`, OpenAI ones stay in `cassettes/dev/`, and replay reads only its own folder. Possible follow-up, not planned: an optional `producer: { provider, modelId }` field in the cassette file schema (`packages/core/src/cassette/types.ts`). Left out on purpose to avoid core churn now.

## Known gap: failed calls are billed but not charged to the budget
- `callWithBudget` (`packages/core/src/budget/call-with-budget.ts`) reserves the worst case before every call. On success it reconciles the reservation to the actual cost; on any failure it releases the reservation, so the ledger records $0 for that call.
- Some failures still cost money at the provider: a reply cut off at the output limit (OpenAI `finish_reason: length`, Gemini `MAX_TOKENS`), a filtered or blocked reply that produced tokens, a reply that is not valid JSON, and possibly an attempt that timed out after the provider started generating.
- Effect: actual spend can exceed what the ledger and the eval result files report, for both providers. Each such call costs at most its worst-case reservation, and the number of calls per job is bounded, so the overrun is bounded, but it is not zero.
- Not measured: no run so far counts how many calls failed after being billed, so there is no dollar figure for the gap yet.
- Not fixed this round. A fix needs a provider-agnostic core change: let a `ProviderFailure` carry the usage it reported, and reconcile instead of release when usage is present.

## Task 41.2: Phase 6 baseline

| Check | Result | Notes |
| --- | --- | --- |
| core typecheck | Pass | |
| worker typecheck | FAIL | 2 pre-existing errors (TS4104) in `apps/worker/src/provider/gemini-provider.test.ts` lines 184-185. Not Phase 6. |
| lint | Pass | |
| core vitest | Pass | 182 files / 1584 tests |
| worker vitest | Pass | 26 files / 316 tests |
| worker build | Pass | `pnpm --filter ./apps/worker build` matched no project, so `pnpm build` inside `apps/worker` was used. The correct filter is `--filter @escape-the-crypt/worker`. |

## Task 41.1 findings

1. `LOCK_TYPES` is not exported from the core `index.ts`; it lives in `types.ts:57`.
2. `ProviderStage` is `'concept-extraction' | 'generation' | 'review'`. `StageHandlers` in `orchestrator-fixtures.ts` is exhaustive. `PROVIDER_STAGES` and `TimedStage` in `run-metadata.ts` need the new stage.
3. `PipelineOptions` extends `GenerationOptions` (`orchestrator.ts:56`).
4. `CandidateResult` in `candidate-outcomes.ts` needs `'conflict-rejected'`.
5. `apps/worker/src/lock-type-flags.ts` does not exist yet; `start.ts` passes `ALLOWED_LOCK_TYPES` directly.

## Task 42.9: DISABLED_LOCK_TYPES
- `DISABLED_LOCK_TYPES` is an optional worker variable: a comma-separated list of Lock_Types the learner path will not ask for. Unset disables nothing.
- On Render, a change needs an environment edit and a restart. A restart loses the in-memory Jobs and resets the Interim_Ledger day counter (Requirement 28.8).
- If fewer than two lock types stay enabled, the worker refuses to start (decided D1).
- Samples and the evaluation CLI are unaffected.
- The flag only narrows. It is the operational samples-only switch for the learner path. It does not mark any type "released" or evaluated.
- Requirement 23 (evaluation-driven Release_Status) is deferred this round: no gold ratings exist, and the samples are too small for 10 rated questions per type.

## Task 43: checkpoint, release flags group

Vitest ran with `--maxWorkers=50%`. No e2e suite was run.

| Check | Result | Notes |
| --- | --- | --- |
| core typecheck | Pass | |
| worker typecheck | FAIL (8 errors) | All in `evaluation/export-ratings.ts` and `evaluation/ratings-csv.ts` (another chat's untracked work). The earlier TS4104 in `gemini-provider.test.ts` no longer appears. |
| web typecheck | Pass | |
| lint: ESLint | FAIL (4 errors) | All in `evaluation/export-ratings.ts` and `evaluation/import-ratings.ts` (another chat). Two Phase 6 errors (unused `lockTypeEntryArb`, unused `_entry`) were fixed here. |
| lint: structure check (run on its own, because `eslint && structure` stops at the first failure) | Pass | Two Phase 6 test files had dotted names; renamed to `lock-type-flags-property.test.ts` and `lock-type-flags-boundary.test.ts`. |
| core vitest | 1 fail | 183 files passed, 1 failed; 1588 tests passed, 1 failed, 0 skipped. The failure is `cassette/no-eval-results-writes.test.ts`, which flags `evaluation/export-ratings.ts` (another chat). |
| worker vitest | 1 fail | 28 files passed, 1 failed; 379 tests passed, 1 failed, 0 skipped. The failure is `config-provider.test.ts:39`: an exact `toEqual` on the Gemini config that now also holds `allowedLockTypes` and `disabledLockTypes` (a Phase 6 task 42.3 side effect). Not fixed: it is a Gemini provider test file. |
| web vitest | Pass | 171 files, 1360 tests, 0 skipped |
| worker build | Pass | `pnpm --filter @escape-the-crypt/worker build` |
| six cassette e2e tests | Pass | 6 files, 17 tests; no digest edits |
| cassette and contract diff | Empty | `git diff --stat -- packages/core/src/test-support/cassettes packages/core/src/test-support/contract` prints nothing; `job-completed.json` has no diff |
| files over 300 lines | None | Largest touched file: `orchestrator.ts`, 299 lines |

## Rater tooling and the holdout guard (record only)
- Added `eval export-ratings` and `eval import-ratings` to the evaluation CLI. Export writes one CSV row per accepted or rejected question of a result file (lock type, prompt, answer key, options, cited quotes, rejection reason) with blank rater, verdict and comment columns; `--blind` drops the outcome columns and shuffles. Import reads one or two filled CSVs and writes a new `<result>-rated.json`: Wrong_Accepted and Correct_Rejected per lock type for each rater and for the questions both rated alike, agreement, Cohen's kappa, and every disagreement listed. The original result file is never changed.
- No real ratings exist yet. The numbers in the tests come from fixture CSVs, so the result files still carry no Wrong_Accepted or Correct_Rejected figure.
- Limits. The result file does not link a candidate to its cassette entry, so export matches generation replies to concepts by order and refuses any note whose counts or lock types do not line up (a retried call, a re-recorded cassette). "Unsure" is never counted as wrong or as correct; a separate worst-case rate counts it against the pipeline. Rater CSVs hold question text, so `eval/results/*.csv` is git-ignored.
- `eval holdout` is the only way to run the final test set. It refuses when the results folder already holds a holdout result or `ledger-holdout.json`, or without `--confirm-final-run`. It has not been run.
- Deliberate guard change: `apps/worker/src/boundary.test.ts` used to forbid any mention of the holdout folder path. It now allows exactly one file, `evaluation/paths.ts`, and `holdout-isolation.test.ts` checks that no other mode reads that folder. The holdout notes are assumed to sit in a `notes` subfolder, like the dev set; this is unconfirmed.
- The result file's `set` field is now `dev` or `holdout`, and an optional `ratings` section was added; older result files still parse.

Lock types phase 3 checkpoint (samples), clean worktree at 4f1f710, Node 22.23.5:
| run | passed | failed | skipped | notes |
| --- | --- | --- | --- | --- |
| lint, typecheck | ok | 0 | 0 | |
| vitest packages/core (--maxWorkers=50%) | 1628 (186 files) | 0 | 1 todo | todo: human-heart places all six types, waits for a decision |
| vitest apps/web (--maxWorkers=50%) | 1364 (172 files) | 0 | 0 | |
| web e2e chromium, firefox, pixel (--workers=2) | 262 | 0 | 1 | skip is crypt-hotspots "door too small for placed seals"; sample-escape 9/9 (3 samples x 3 projects, keyboard only) |
Samples: https and printing-press each place all six lock types across two rooms and a three-seal final door, built through the core mapper. human-heart is unchanged (rune cipher and séance board only): widening it changes the final-door seal count or the room count that tests under apps/web/src/state pin. https.json gained one rune cipher question (hs-q10), so the Phase 1 dataset counts are now 57 questions and 27 rune ciphers.
Resume: a saved https or printing-press run still returns `record-unreadable` until `restoreRun` in apps/web/src/state/storage picks the sample from the manifest ID (needs the other machine; see the phase 3 report).

## Task 44.20: golden contract fixture, owner step pending
- State: `apps/worker/src/http/job-contract.test.ts` run without `UPDATE_CONTRACT` passes (6 of 6). `packages/core/src/test-support/contract/job-completed.json` is unmodified (`git status` shows no entry for it). No agent regenerated it (D14).
- `git pull --rebase` was refused because the working tree holds uncommitted work. `git fetch` then showed no commits on `origin/main` beyond `HEAD` (`git log HEAD..origin/main` is empty), so there was nothing to rebase.
- The test does not cover `?notices=1` today. The fixture has `contractVersion`, `notesText`, `response` and `running`. Running the update command alone changes nothing, because the test never produces a notices case. **The owner must first add the case to the test (draft below, not applied), then run the update.**
- Expected diff the owner will see in `job-completed.json`: one new top-level key, `withNotices`, holding a completed body requested with `?notices=1`. `contractVersion`, `notesText`, `response` and `running` stay exactly as they are. Whether to bump `contractVersion` from 2 is the owner's call; the field is additive and optional, so the draft leaves it at 2.
- Shape, from `packages/core/src/job-api/job-response-schema.ts` (strict objects): `bundle.notices = { excluded: ExcludedConcept[], sufficiency: SufficiencyNotice | null }`. `ExcludedConcept` is `{ conceptId, conceptTitle, source: 'code' | 'model', passages: [Passage, Passage] }` and `Passage` is `{ chunkId, quote }`. `sufficiency` is nullable, not optional: when there is no sufficiency notice the server sends `"sufficiency": null`, and the key is present. The whole `notices` key is absent when the client did not ask or the job has none (`routes-jobs.ts`, `jobBody`).
- Example of the new case (the `manifest`, `content` and `unplacedAccepted` values are the same as in `response`, abbreviated here):

```json
"withNotices": {
  "request": "GET /jobs/:id?notices=1",
  "response": {
    "jobId": "job-contract-1",
    "status": "completed",
    "bundle": {
      "manifest": { "...": "same as response.bundle.manifest" },
      "content": { "...": "same as response.bundle.content" },
      "unplacedAccepted": [],
      "notices": {
        "excluded": [
          {
            "conceptId": "c1",
            "conceptTitle": "Valves",
            "source": "code",
            "passages": [
              { "chunkId": "k1", "quote": "one" },
              { "chunkId": "k2", "quote": "two" }
            ]
          }
        ],
        "sufficiency": null
      }
    }
  }
}
```

  The `unplacedAccepted` value is whatever the recorded heart run yields; copy it from `response`. The chunk ids and quotes above are placeholders from `server-notices.test.ts`; the owner may prefer real heart-notes chunk ids and quotes so the web's quote check can resolve them.
- Owner command (the package is `@escape-the-crypt/worker`; the test writes the fixture only when `UPDATE_CONTRACT=1` or the file is missing):

```
UPDATE_CONTRACT=1 pnpm --filter ./apps/worker exec vitest --run job-contract
```

  Equivalent: `pnpm --filter @escape-the-crypt/worker exec vitest --run job-contract` with the same variable set. On PowerShell: `$env:UPDATE_CONTRACT='1'; pnpm --filter ./apps/worker exec vitest --run job-contract; Remove-Item Env:UPDATE_CONTRACT`. Then review the diff, commit.
- Draft test addition (NOT applied). It goes in `job-contract.test.ts`, in the first test, after `gate.release()` and before `const golden`. It needs `import { runRoomPipeline, type PipelineResult } from '@escape-the-crypt/core';` (extend the existing core import) and `import type { RunPipeline } from './job-runner';`:

```ts
    // Notices (Phase 6): a completed body for a client that asks with ?notices=1.
    const NOTICES: NonNullable<PipelineResult['notices']> = {
      excluded: [
        {
          conceptId: 'c1',
          conceptTitle: 'Valves',
          source: 'code',
          passages: [
            { chunkId: 'k1', quote: 'one' },
            { chunkId: 'k2', quote: 'two' },
          ],
        },
      ],
      sufficiency: null,
    };
    const withNotices: RunPipeline = async (notes, options) => {
      const result = await runRoomPipeline(notes, options);
      return result.ok ? { ok: true, value: { ...result.value, notices: NOTICES } } : result;
    };
    const noticing = await startHarness({ runPipeline: withNotices });
    const noticingId = idOf(await noticing.post(heartBody));
    await noticing.waitDone(noticingId);
    const noticingRes = await noticing.request(`/jobs/${noticingId}?notices=1`, { headers: { 'X-Session-Token': TOKEN } });
    const noticed = parseStatus(noticingRes);
    expect(noticed?.status).toBe('completed');
    // ...and in `golden`, after `running`:
    //   withNotices: { request: 'GET /jobs/:id?notices=1', response: { ...noticed, jobId: FIXTURE_JOB_ID } },
```

  The test must compare the new case against the committed file the same way the existing two are compared (the final `toEqual` already covers the whole `golden` object). Also update the comment above `FIXTURE_PATH` only if the owner wants to mention the new case. The web's contract test should then read `withNotices` and parse it with the strict schema.
- This task stops here. The owner step is pending; nothing past it was done.

## Task 44.21: `CHECK_VERSION` unchanged in Phase 6
- `CHECK_VERSION` is `'2026-11-27.5'` in `packages/core/src/checks/registry.ts:4`, unchanged.
- `git status` and `git diff` over `packages/core/src/checks/` show no change. Over `packages/core/src/locks/` they show only: `lock-types.test.ts` (modified, 1 line), and the new `answer-statement.ts` and `answer-statement.test.ts`. None of the six per-type files (`rune-cipher`, `seance-board`, `bone-ordering`, `bound-threads`, `cursed-object`, `combination-dial`) changed. The last commits touching `checks/` or `locks/` are from before Phase 6.
- The only `checkVersion` lines in the uncommitted diff are two removed `checkVersion: CHECK_VERSION,` lines in pipeline files outside `checks/` and `locks/`; the constant's value did not change. No cassette file was touched by this task, so no bump and no cassette edit were needed.

## Task 44.20: contract change (deliberate), contractVersion stays 2
- New optional `notices` object in the completed bundle, sent only behind `?notices=1`. `contractVersion` stays 2 because the field is additive and optional behind a query: old clients never see it, and the web test (`apps/web/src/features/generate/job-contract.test.tsx` line 94) pins 2. The user decided this.
- Third fixture case in `packages/core/src/test-support/contract/job-completed.json`, top-level key `notices` (the 44.20 note above suggested `withNotices`; the key actually written is `notices`, with `request: "GET /jobs/:id?notices=1"`). Its response is the real worker body for the heart notes with one excluded concept, "Time for the Moon to orbit Earth" (source `model`, `conceptId` `concept-1`), and the two passages from adv-18 over `eval/adversarial/notes/adv-01-moon.txt`: `chk_21c60b15f118_3` "The Moon takes about 27 days to orbit Earth." (paragraph 4) and `chk_21c60b15f118_6` "One orbit of the Moon around Earth takes about 35 days." (paragraph 7).
- How the content is real: the ids and quotes were printed from a run of core's `captureConflictE2e()` (the real pipeline over the adv-18 cassette scenario) and pasted into `ADV18_NOTICES` in `apps/worker/src/http/job-contract.test.ts`. The case is built like the others: the real worker server answers `GET /jobs/:id?notices=1` for a job whose pipeline is the recorded heart pipeline with those notices attached (same wrapper as `server-notices.test.ts`). The bundle's rooms are therefore the heart crypt, not the moon crypt; only the notice is from adv-18.
- Commands: `$env:UPDATE_CONTRACT='1'; pnpm --filter @escape-the-crypt/worker exec vitest --run job-contract --maxWorkers=50%; Remove-Item Env:UPDATE_CONTRACT` (once), then the same without the variable (6 passed). Web check, read-only: `pnpm exec vitest run src/features/generate/job-contract.test.tsx --maxWorkers=50%` in `apps/web` (3 passed).
- Diff summary for `job-completed.json`: 253 insertions, 0 deletions, one hunk at line 245 (the new `notices` key at the end). `contractVersion` unchanged at 2; `response` and `running` untouched.
- Also in this task: `conflict-stage.test.ts` gained a call-order test (the first provisional `assemble` call already lacks the code-excluded concepts, so the code scan ran first). `Passage.quote` stays `string` in `conflict-stage.ts`: the schema's non-empty rule would need a branded type, which ripples through `conflict-code.ts` and `conflict-report.ts`.
- Resolved: done by the agent with the user's authorisation
## Checkpoint 45: conflict check group (full table, including e2e)
Run on 2026-11-28 over the working tree. HEAD was 60bb6ba at the start; during the checkpoint, other chats pushed 39757c6, 6f53ad5 and 957fd43, which were pulled with `--autostash`. Commands were run with `--maxWorkers=50%` (Vitest) and `--workers=2` (Playwright). Port 4173 was free before e2e.

| Check | Result |
|---|---|
| `tsc --noEmit` packages/core | pass |
| `tsc --noEmit` apps/worker | pass (re-run after 957fd43: pass) |
| `tsc --noEmit` apps/web | pass |
| `pnpm lint` (ESLint + structure) | first run: ESLint fail, 2 errors (`_c`, `_n` unused) in `apps/worker/src/evaluation/result-file.test.ts` (Phase 6, fixed); structure check run alone: passed. After the fix: pass |
| vitest packages/core | first run: 1 failed / 1690 passed. `no-eval-results-writes.test.ts` flagged the literal results-folder path in a test title in `result-file.test.ts` (Phase 6, title reworded). After: 198 files, 1691 passed, 0 failed, 0 skipped |
| vitest apps/worker | 37 files, 447 passed, 0 failed, 0 skipped; after 957fd43: 38 files, 465 passed |
| vitest apps/web | 172 files, 1364 passed, 0 failed, 0 skipped |
| worker build | pass (`dist/index.js` 1.9 MB) |
| e2e (`--workers=2`) | full run: 253 passed, 9 failed, 1 skipped. Eight failures were `net::ERR_CONNECTION_REFUSED` at localhost:4173 (the preview server dropped mid-run); one was a 30 s wait for `descent-gate` (most likely `judge-access.e2e.ts`; the log was not kept to confirm). `--last-failed` re-run: 9 passed, 0 failed. None of the failing specs are Phase 6 files. |

- Cassette e2e (`e2e-pipeline`, `bone-ordering-e2e`, `bound-threads-e2e`, `combination-dial-e2e`, `cursed-object-e2e`, `e2e-cassette-digest`, `conflict-check-e2e`): 7 files, 26 passed. No digest or test edits. `git diff --stat` over `test-support/cassettes` is empty; the only new file is the untracked `conflict-check-e2e.json`.
- `git diff --numstat` over `test-support/contract`: `job-completed.json` 253 insertions, 0 deletions (the additive 44.20 `notices` case only). Not regenerated in this checkpoint.
- `CHECK_VERSION` is `'2026-11-27.5'` (`packages/core/src/checks/registry.ts:4`).
- Structure check passed: every source file is within the limit. The longest Phase 6 source files are `orchestrator.ts` (296 lines), `copy-banned-words.test.ts` (280), `cli.test.ts` (268), `boundary.test.ts` (255) and `conflict-stage.test.ts` (253).
- Paid re-record with `--conflict-check on`: the command was given to the user and not run.
Decision (lock types phase 3): human-heart stays the two-type starter (rune cipher and séance board), not widened. Widening it changed the room count or the final-door seal count that tests under apps/web/src/state pin, and those tests belong to the other machine. https and printing-press each place all six lock types. The `restoreRun` and `import-run.ts` change that lets a saved https or printing-press run resume goes to the Default chat on this machine.

Lock types phase 4 checkpoint (per-type e2e, axe, skip and challenge), clean worktree at 1d7c7f8, Node 22.23.5:
| run | passed | failed | skipped | notes |
| --- | --- | --- | --- | --- |
| lint, typecheck | ok | 0 | 0 | |
| vitest packages/core (--maxWorkers=50%) | 1735 (200 files) | 0 | 0 | |
| vitest apps/web (--maxWorkers=50%) | 1368 (172 files) | 0 | 0 | |
| web e2e chromium, firefox, pixel (--workers=2) | 309 | 0 | 2 | skips: crypt-hotspots "door too small for placed seals"; lock-types-axe "combination dial, a number typed" on Firefox only |
New e2e files, 57 tests: lock-types (5 tests x 3 projects, keyboard on desktop with Alt+Arrow for bones, taps and a 44 by 44 px check on every control on pixel), lock-types-axe (5 tests x 3 projects, each panel fresh, with a hint applied and part way through an answer), sample-escape (3 samples x 3), sample-settle (3 samples x skip and challenge x 3). 56 pass, 1 skip, 0 flaky.
Bug found by the axe run and fixed: the bone ordering, bound threads and cursed object panels read the applied hint once, when they mounted, so a hint used after the panel opened showed nothing and (for bone ordering) made the answer invalid at the judge. They now apply the hint at render time (applyBoneHint, applyThreadHint, applyRemoveHint), announce it once, and have mid-answer property tests and a panel test that fails if the hint is ignored.
Firefox: Playwright's Firefox build crashes the page when a text input and an axe scan are used on the same page, in either order. The existing rune cipher input does the same, so it is not specific to the dial. Playwright runs a fallback build on this OS. The typed-entry axe state is skipped on Firefox and scanned on chromium and pixel.
Finding while closing lock types task 5 (not fixed here: schema and judge belong to the other machine): `narrowHint` accepts a bound-threads `tie-thread` hint naming a key pair in either order, but the judge looks for the hint pair as [left, right]. A hint written [right, left] passes validation and then every answer, the correct one too, is judged invalid. The mapper always writes [left, right], so generated and sample crypts are safe; an imported crypt file is untrusted input. Fix `narrowHint` to require [left, right], or compare the pair unordered in the judge. `manifest-hints-answer-safety.test.ts` records it as an expected failure (`it.fails`); remove `.fails` once fixed.

<<<<<<< ours
Haunting polish, the decisions after the integration push:
- Open_Decision 1 (title through DeskHub) was already true: `/` is drawn by FrontOfHouse inside CryptFlow's one LanternProvider, and the desk, notes, dig, room, final door, escape view and Autopsy all carry the toggle. `haunting-lantern.e2e.ts` shows one stored value (`escape-the-crypt:lantern`) read and written from the title and from the crypt, nothing written for a default, and Lantern mode on by default under reduced motion on every screen.
- Open_Decision 2: the quill and a Lantern toggle sit beside the Autopsy heading; the escape view has a toggle. Two escape-view tests asserted exactly one button; they now count buttons other than the toggle and assert the toggle once, since a display setting is not a game control. On the parchment the pressed toggle is ink with a second ring (a shape as well as a colour), never gold.
- Found by looking at the pictures: the Autopsy outcome counts ran into their labels ("First-try correct0", "Review due2"); the counts section had never had a stylesheet. Fixed on the parchment: one row per outcome, label left, count right.
- Found by looking at the pictures and NOT fixed (the seal layout is existing code outside this spec): on the final door the seals sit in a tight column and the wrapped "Not yet answered" labels run into the next seal's ring, which cuts through the word "answered". The status text is the non-colour cue for each seal. Picture: `docs/screenshots/haunting/final-door-seals-overlap.jpg` (2x). Options: shorter label text beside the ring, wider seal spacing in `seal-layout.ts`, or the label shown only on hover and focus with the status kept in the accessible name.
- Pictures, one per moment with motion allowed and with reduced motion, in `docs/screenshots/haunting/` (chromium, opt in with `HAUNTING_SCREENSHOTS=1 pnpm exec playwright test e2e/haunting-shots.e2e.ts --project=chromium`): `candle-lit-motion.jpg` and `candle-lit-reduced.jpg` (cropped around the flame at 2x; motion is about 250 ms into the 500 ms flare, with the overlay drawn, reduced is the steady flame in Lantern mode), `ghost-rises-motion.jpg` and `-reduced.jpg`, `ghost-laid-to-rest-motion.jpg` (mid-fade, spirit candle lit) and `-reduced.jpg`, `autopsy-opens-motion.jpg` (mid-fade, quill part drawn) and `-reduced.jpg` (finished stroke, toggle pressed). The motion frames are approximate: they are taken about 250 ms after the moment starts.

Haunting polish checkpoint (decision 2, tasks 9.2, 9.3, 11.1 to 11.3), clean worktree at 8cb97e3, Node 22.23.5:
| run | passed | failed | skipped | notes |
| --- | --- | --- | --- | --- |
| lint, typecheck | ok | 0 | 0 | |
| vitest packages/core (--maxWorkers=50%) | 1743 (202 files) | 0 | 1 expected fail | the bound-threads reversed-pair gap, recorded earlier |
| vitest apps/web (--maxWorkers=50%) | 1436 (178 files) | 0 | 0 | |
| web e2e chromium, firefox, pixel (--workers=2) | 368 | 1 | 2 | skips: crypt-hotspots "door too small for placed seals"; lock-types-axe "combination dial, a number typed" on Firefox only |
The one e2e failure is `import-crypt.e2e.ts` "importing the same file twice says it is a duplicate and changes nothing", Firefox only, not part of this work. It is flaky at the commit before mine too: 1 failure in 20 runs at 40b1beb, 3 in 20 at 8cb97e3 (a difference that 20 runs cannot tell apart). The test reads the book card text right after the import, before the "Continue your crypt" and "Start again" buttons have rendered, so `before` and `after` differ. Fix in that test: wait for the buttons before reading `before`. Not edited here (the import work belongs to the Default chat).
New e2e files, 42 tests, all passing: haunting-lantern (3 tests x 3 projects), haunting-axe (6 x 3), haunting-input (5 x 3). `haunting-shots.e2e.ts` defines no tests unless HAUNTING_SCREENSHOTS=1.

Phase 6 checkpoint 47 (sufficiency group), HEAD abf0b40 plus the uncommitted Phase 6 work, Node 22:
| run | passed | failed | skipped | notes |
| --- | --- | --- | --- | --- |
| typecheck packages/core, apps/worker, apps/web | ok | 0 | 0 | |
| pnpm lint (ESLint + structure check) | ok | 0 | 0 | structure check passed, no file over 300 lines |
| vitest packages/core (--maxWorkers=50%) | 1768 (206 files) | 0 | 0 | plus 1 expected fail (the recorded reversed-pair gap) |
| vitest apps/worker (--maxWorkers=50%) | 475 (39 files) | 0 | 0 | includes the dev-cassette replay digest tests in cli.test.ts |
| vitest apps/web (--maxWorkers=50%) | 1368 (172 files) | 0 | 0 | |
| worker build | ok | 0 | 0 | |
| web e2e chromium, firefox, pixel (--workers=2) | 309 | 0 | 2 | port 4173 was free; no 30 s timeout and no connection refused, so no `--last-failed` re-run |
Checks: the cassette e2e tests (e2e-pipeline, e2e-cassette-digest, bone-ordering, bound-threads, combination-dial, cursed-object, conflict-check-e2e) pass with no digest edit and no cassette file modified. job-completed.json has no diff. CHECK_VERSION is '2026-11-27.5'. DEFAULT_ALLOWED_LOCK_TYPES and ALLOWED_LOCK_TYPES are the six. Sufficiency is on in apps/worker/src/start.ts and false in the five cassette fixtures and HEART_SETTINGS. Task 46.8 stays open until the free replay distribution is run in the user's shell.
Open product gap (found in 46.7, not fixed): when a conflict exclusion leaves no buildable room, `runConflictStage` returns the `empty-room` assembly error as it is, and `runAssemblyPhase` returns it before the stage counts are merged. The learner gets the generic not-enough-material failure with no conflict notice, and the run metadata has no conflict counts.
=======
## Checks from the crypt-keeper review (2026-11-28, written by hand outside Kiro)

The crypt-keeper agent's review of the six-type dev run (`eval/results/2026-11-27-3.json`) led to three Code_Check changes. `CHECK_VERSION` is now `2026-11-28.1`; only the `checkVersion` field changed in the six synthetic cassettes.
- `units-reveal-number` (combination dial): units are shown beside the dial, so they must not contain a digit. Caught dev-04 concept 5 alternate (answer 20, units "July 20").
- `steps-listed-in-prompt` (bone ordering): rejects a prompt that names two or more steps in key order. No dev question trips it today; it closes the gap the agent named (`answer-leak-in-prompt` covered rune cipher only).
- Cursed-object negative-question exemption widened from "which one/of these … not" to "which … not", so odd-one-out prompts such as "Which item is not…" are no longer rejected.
- Rejected suggestion: a code check that a contradicted séance option must not cite the supported option's quote. It would reject good questions: one sentence ("The heart has four chambers") legitimately supports "four" and contradicts "three". The agent's remaining séance cases are judgement calls left to blind review.
- Free replay over the recorded dev cassettes (conflict check on): `units-reveal-number` removes 1 accepted question. dev-04 then fails in replay with `conflict-check-failed`, because its room changed and the recorded conflict-check call no longer matches (a replay artefact; a live run makes a new call).
>>>>>>> theirs

## Task 46.8: sufficiency floor checked on the dev replay (outside Kiro)

Free replay of the conflict-check dev cassettes with `--sufficiency off` (all six lock types, conflict check on) gives `sourceWords` for all 92 extracted concepts: min 13, p10 30, p50 50, p90 88, max 95. The smallest accepted concept has 13 source words and the smallest placed one 15. A floor of 12 drops none; 15 would drop 2 accepted concepts, 20 would drop 3 and 30 would drop 7. `MIN_CONCEPT_SOURCE_WORDS` stays 12. Caveat: the dev set has no thin note, so the floor has not yet been seen rejecting a real thin concept; the holdout run is the next evidence.

## Known gap: a conflict that leaves no buildable room (Requirement 18.4)

When conflict exclusions leave no room that can be assembled, the run ends with the generic not-enough-material failure and the exclusion notice is not carried on the failure. The learner sees an honest failure but not the reason. Fixing it needs an optional notice on the failure body across core, worker, web client and UI; it is left for after the submission because the case needs many contradictions in one short note.
