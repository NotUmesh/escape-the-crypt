# Implementation Plan: Ingestion and Evidence

## Overview

The design uses TypeScript (strict mode, Node 22, pnpm workspaces, Vitest, fast-check, Playwright, axe), so no language choice is needed. The plan starts with scaffolding the workspace (packages, tooling, CI), then the pdf.js worker feasibility spike, then builds the pure engine in `packages/core` (limits, page checker, PDF text assembly, chunker, quote resolver, citation labeller, copy). It then adds the Extraction Worker, the ingest state machine, the design tokens and self-hosted fonts, and the Ingest UI in `apps/web/src/features/ingest`. The Ingest UI is built from native elements styled only with tokens and carries no layout of its own, so a later open-book screen can host it unchanged. Confirmed chunks are saved as a notes record in IndexedDB, keyed by document digest. The plan ends with the integration, accessibility and Playwright tests. Source files use kebab-case names and stay at or below 300 lines. Tests never call an AI provider.

All test tasks are required and part of done. Property tests for one module are split across small test files so that each property is its own sub-task and files can be written in parallel.

## Tasks

- [ ] 0. Scaffold the workspace
  - [x] 0.1 Create the root workspace and shared TypeScript and lint config
    - Create root `package.json` (private, Node 22 engines, scripts `dev`, `test`, `lint`, `typecheck`, `e2e`) and `pnpm-workspace.yaml` covering `apps/*` and `packages/*`
    - Create `tsconfig.base.json` with `strict` on, `noUncheckedIndexedAccess`, and no implicit `any`
    - Add ESLint (flat config, typescript-eslint) at the root with `no-explicit-any`, `no-eval`, `no-new-func` and `no-restricted-syntax` for `dangerouslySetInnerHTML` under `apps/web/src/features/ingest`
    - _Requirements: 12.1, 12.4_

  - [x] 0.2 Create the three workspace packages
    - `apps/web` (package name `@escape-the-crypt/web`): Vite + React + TypeScript with a minimal `src/main.tsx` and `src/features/` folder, extending `tsconfig.base.json`
    - `apps/worker` (package name `@escape-the-crypt/worker`): empty Node TypeScript package with a `src/index.ts` placeholder and its own `tsconfig.json`
    - `packages/core` (package name `@escape-the-crypt/core`): TypeScript library with `src/index.ts` and its own `tsconfig.json`, with no React, DOM or AI SDK dependency
    - Use these names in every `pnpm --filter` command and in cross-package imports (for example `apps/web` depends on `@escape-the-crypt/core`)
    - Each package exposes `typecheck` and `test` scripts so root `pnpm -r` commands work
    - _Requirements: 12.1, 12.4_

  - [x] 0.3 Configure Vitest and Playwright
    - Add a Vitest config (workspace projects for `packages/core` in Node and `apps/web` in jsdom) with one trivial passing test per package so the pipeline is green. Configure Vitest to exclude `**/e2e/**` and `**/*.e2e.ts` so it never picks up Playwright tests
    - Add `apps/web/playwright.config.ts` with `testDir: './e2e'` and `testMatch: '**/*.e2e.ts'` (so Playwright never picks up `*.test.ts` files) and three projects: Chromium, Firefox and a Pixel emulation (Android Chrome profile), starting the Vite preview server as `webServer`
    - _Requirements: 12.4_

  - [ ] 0.4 Add the GitHub Actions workflow
    - Create `.github/workflows/ci.yml` triggered on every push, using Node 22 and pnpm with a frozen lockfile install
    - Run `pnpm lint`, `pnpm typecheck` and `pnpm test` as separate steps
    - _Requirements: 12.4_

  - [ ] 0.5 Update the steering commands if they changed
    - Compare the root scripts with the Commands list in `.kiro/steering/tech.md` and edit that list only if a script name or behaviour differs
    - Keep the file otherwise unchanged and add no logs or user content under `.kiro/`
    - _Requirements: 12.4_
- [ ] 1. Feasibility spike: pdf.js inside the Extraction Worker
  - [ ] 1.1 Set up dependencies and the spike harness
    - Add `pdfjs-dist` (exact pinned version), `@noble/hashes` (exact pinned version, `packages/core` only), `fast-check`, `vitest`, `@playwright/test` and `@axe-core/playwright` to the correct workspace packages, and commit the pnpm lockfile
    - Self-host the pdf.js worker file under `apps/web/public` so it is served from the same origin
    - Create a tiny fixture PDF and a spike page under `apps/web/src/features/ingest/spike/` that extracts its text in two configurations: nested pdf.js worker inside the Extraction Worker, and in-thread (fake worker) mode inside the Extraction Worker
    - Set `enableScripting: false`, give no password callback, and disable cMap and standard-font fetching
    - Add a Playwright spike test at `apps/web/e2e/pdfjs-spike.e2e.ts` with Chromium, Firefox and a Pixel emulation project (configured in task 0.3) that checks text comes back, `terminate()` stops work, and no cross-origin request is made
    - _Requirements: 2.1, 2.2, 2.4, 2.5, 2.7_

  - [ ] 1.2 Run the spike and record the decision
    - Run the spike test and record, in `docs/build-log.md`, which configuration works on Chrome, Firefox and Android Chrome (emulated here; note that a real-device check is still manual)
    - If neither configuration works on all three, record the main-thread fallback with `loadingTask.destroy()`, document destroy and pdf.js worker termination on cancel or timeout
    - Record the chosen mode in a single exported constant that `extraction-client.ts` will read
    - After recording the decision, delete the spike page and harness under `apps/web/src/features/ingest/spike/`; keep only the Playwright spike test (`apps/web/e2e/pdfjs-spike.e2e.ts`) if it is still useful as a regression check, and update it so it no longer depends on deleted files
    - _Requirements: 2.1, 2.2, 2.3, 2.7, 3.5_

- [ ] 2. Core foundations: types, limits, shared test generators
  - [ ] 2.1 Create shared types and test generators
    - Create `packages/core/src/types.ts` with `SourceType`, `SourceLocation`, `Chunk`, `PageFlag`, `ResolvedLocation`, `QuoteError`, `Result`, `LimitError` and `IngestError` as in the design
    - Create `packages/core/src/test-support/arbitraries.ts` with fast-check generators for pasted text with blank-line runs, PDF page lists with printed labels or `null`, duplicate paragraphs, over-long sentences and tokens, chunk texts with line-break hyphens, ligatures, curly quotes and decomposed accents, and quotes cut from a chunk at random offsets
    - Export the public API from `packages/core/src/index.ts`
    - _Requirements: 12.3_

  - [ ] 2.2 Implement the Limits Module
    - Create `packages/core/src/limits.ts` with `MAX_FILE_SIZE_BYTES` (5 MB), `MAX_SELECTED_PAGES` (10), `MAX_EXTRACTED_WORDS` (6000), `MAX_EXTRACTION_MS` (20000)
    - Implement `checkFileSize`, `capPageSelection`, `countWords`, `checkWordCount` and `checkElapsed(startedAtMs, nowMs)`; a value equal to the limit passes
    - _Requirements: 1.3, 3.1, 3.2, 3.3, 3.4, 3.5_

  - [ ] 2.3 Write property test for the word-count limit
    - File: `packages/core/src/limits-word-count.test.ts`
    - **Property 2: Word-count limit boundary**
    - **Validates: Requirements 1.3, 3.4**

  - [ ] 2.4 Write property test for file size and page selection limits
    - File: `packages/core/src/limits-size-pages.test.ts`
    - **Property 3: File size and page selection limits**
    - **Validates: Requirements 3.2, 3.3**

  - [ ] 2.5 Write property test for the elapsed-time limit and a constants test
    - File: `packages/core/src/limits-time.test.ts`
    - **Property 4: Elapsed-time limit with injected clock**
    - Add a unit test asserting every named constant (5 MB, 10, 6000, 20000)
    - **Validates: Requirements 3.1, 3.5, 14.1**

- [ ] 3. Page Checker and PDF text assembly
  - [ ] 3.1 Implement the Page Checker
    - Create `packages/core/src/page-checker.ts` with `classifyPage` and the named thresholds `LOW_TEXT_MIN_WORDS`, `GARBLE_MAX_RATIO`, `SHORT_LINE_MIN_LINES`, `SHORT_LINE_MEDIAN_CHARS`
    - Apply the rules in the design order: low-text, garbled ratio, short-line median, otherwise ok
    - _Requirements: 4.1, 4.2, 4.3_

  - [ ] 3.2 Write property test for page classification
    - File: `packages/core/src/page-checker.test.ts`
    - **Property 6: Page classification**
    - **Validates: Requirements 4.1, 4.2, 4.3**

  - [ ] 3.3 Implement PDF text assembly
    - Create `packages/core/src/pdf-text-assembly.ts` with `TextItemData`, `PARAGRAPH_GAP_FACTOR` (1.5) and `assemblePageText`
    - Start a new line on `hasEOL` or a y change above the tolerance; join lines with `\n`, or `\n\n` when the gap is greater than 1.5 times the median line height; return `""` for an empty page
    - _Requirements: 2.1, 6.1_

  - [ ] 3.4 Write unit and property tests for PDF text assembly
    - File: `packages/core/src/pdf-text-assembly.test.ts`
    - Unit cases: `hasEOL` gives `\n`; y change gives `\n`; gap above 1.5 times the median gives `\n\n`; gap of exactly 1.5 times gives `\n`; empty page gives `""`
    - Property: output keeps every item's non-whitespace characters in order and never contains three consecutive line breaks
    - _Requirements: 2.1, 6.1_

- [ ] 4. Chunker
  - [ ] 4.1 Implement digest and splitting
    - Create `packages/core/src/digest.ts` with `documentDigest` using the synchronous `sha256` from `@noble/hashes` over UTF-8 bytes (units joined by `\n\n` for paste, `\f` for PDF pages)
    - Create `packages/core/src/chunker-split.ts` with `MAX_CHUNK_CHARS` (1200): paragraph and heading candidates, sentence-boundary packing, word-boundary split for over-long sentences, hard split for tokens with no whitespace
    - _Requirements: 6.1, 6.3, 6.10, 6.11, 6.15_

  - [ ] 4.2 Implement merging and `chunkDocument`
    - Create `packages/core/src/chunker-merge.ts` with `MIN_CHUNK_CHARS` (40): merge short chunks forward within the same unit, backward when last, keep when alone, never across a page or paragraph, single pass with no re-merge
    - Create `packages/core/src/chunker.ts` with `chunkDocument(input)`: build units, assign `chk_<digest12>_<position>` IDs, record source type, location, digest and edited flag (exact text match against the original chunks of the same unit), and freeze each chunk
    - _Requirements: 1.2, 5.3, 5.4, 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 6.8, 6.9, 6.12, 6.13, 6.14, 6.16_

  - [ ] 4.3 Write property test for paste paragraph splitting
    - File: `packages/core/src/chunker-paragraphs.test.ts`
    - **Property 1: Paste paragraphs split at blank lines**
    - **Validates: Requirements 1.2, 6.1**

  - [ ] 4.4 Write property test for chunking determinism
    - File: `packages/core/src/chunker-determinism.test.ts`
    - **Property 9: Chunking is deterministic**
    - **Validates: Requirements 6.8, 13.1**

  - [ ] 4.5 Write property test for distinct chunk IDs and digest
    - File: `packages/core/src/chunker-ids.test.ts`
    - **Property 10: Chunk IDs are distinct and carry the document digest**
    - **Validates: Requirements 6.2, 6.3, 6.9, 13.7**

  - [ ] 4.6 Write property test for a single source location per chunk
    - File: `packages/core/src/chunker-location.test.ts`
    - **Property 11: Every chunk has exactly one source location**
    - **Validates: Requirements 6.4, 6.5, 6.6, 6.13, 13.2, 13.9**

  - [ ] 4.7 Write property test for chunk size bounds
    - File: `packages/core/src/chunker-size.test.ts`
    - **Property 12: Chunk size bounds**
    - **Validates: Requirements 6.11, 6.12, 6.14, 6.15, 6.16, 13.8**

  - [ ] 4.8 Write property test for the per-chunk edited flag
    - File: `packages/core/src/chunker-edited.test.ts`
    - **Property 8: Edited flag reflects a per-chunk difference**
    - Include an edit that changes the number of chunks in a unit
    - **Validates: Requirements 5.3, 5.4, 6.7**

  - [ ] 4.9 Write unit tests for chunker edge cases and constants
    - File: `packages/core/src/chunker.test.ts`
    - Cover a lone heading that is the only chunk on its page, a last short chunk merging backward, a single sentence over 1,200 characters, and the constants 1,200 and 40
    - _Requirements: 6.10, 6.14, 6.15, 6.16_

- [ ] 5. Quote Resolver
  - [ ] 5.1 Implement normalisation with an offset map
    - Create `packages/core/src/normalise.ts` with `normaliseWithMap`: NFC, ligature table, curly-to-straight quotes, removal of line-break hyphens only (in-word hyphens kept), whitespace collapse and trim, each normalised character mapped to its original range
    - _Requirements: 7.1, 7.2, 7.10_

  - [ ] 5.2 Implement `resolveQuote`
    - Create `packages/core/src/quote-resolver.ts` with `MIN_QUOTE_WORDS` (4), `MIN_QUOTE_CHARS` (20) and `resolveQuote`
    - Order: too-short check first (needs at least 4 words and 20 characters), then unknown-chunk, then case-sensitive count of overlapping occurrences (zero is not-found, more than one is ambiguous with count), then offsets from the map
    - Return typed errors and never throw
    - _Requirements: 7.3, 7.4, 7.5, 7.6, 7.7, 7.8, 7.9, 7.10, 7.11, 7.12_

  - [ ] 5.3 Write property test for unique quotes and offsets
    - File: `packages/core/src/quote-resolver-offsets.test.ts`
    - **Property 13: Unique quotes resolve to correct offsets**
    - **Validates: Requirements 7.4, 7.10, 13.5**

  - [ ] 5.4 Write property test for absent quotes
    - File: `packages/core/src/quote-resolver-not-found.test.ts`
    - **Property 14: Absent quotes never resolve**
    - **Validates: Requirements 7.5, 13.3**

  - [ ] 5.5 Write property test for repeated quotes
    - File: `packages/core/src/quote-resolver-ambiguous.test.ts`
    - **Property 15: Repeated quotes are ambiguous**
    - Include overlapping occurrences
    - **Validates: Requirements 7.6, 13.4**

  - [ ] 5.6 Write property test for short quotes
    - File: `packages/core/src/quote-resolver-too-short.test.ts`
    - **Property 16: Short quotes are rejected without searching**
    - **Validates: Requirements 7.12, 13.6**

  - [ ] 5.7 Write property test for normalisation equivalences
    - File: `packages/core/src/quote-resolver-normalise.test.ts`
    - **Property 17: Normalisation equivalences**
    - **Validates: Requirements 7.1, 7.2, 7.3**

  - [ ] 5.8 Write property test for typed errors without throwing
    - File: `packages/core/src/quote-resolver-typed-errors.test.ts`
    - **Property 18: The Quote Resolver returns typed errors and never throws**
    - **Validates: Requirements 7.7, 7.9**

  - [ ] 5.9 Write unit tests for the Quote Resolver
    - File: `packages/core/src/quote-resolver.test.ts`
    - Cover unknown chunk ID, too-short winning over unknown chunk ID, the "well-\nknown" trade-off, and constants 4 words and 20 characters
    - _Requirements: 7.2, 7.7, 7.11, 7.12_

- [ ] 6. Citation Labeller and copy catalogue
  - [ ] 6.1 Implement the copy catalogue
    - Create `packages/core/src/copy.ts`: a typed map where every error key has `what` and `next` parts, plus the privacy notice, page-flag labels and citation label templates
    - Use plain, kind wording, say "your notes", and use none of the banned words (verified, guaranteed, 100% accurate, hallucination-free, mastered, exam-ready, "the source document")
    - _Requirements: 3.6, 4.4, 8.4, 10.1, 10.2, 10.3, 11.1, 11.2, 11.3, 11.4_

  - [ ] 6.2 Implement the Citation Labeller
    - Create `packages/core/src/citation-labeller.ts` with `citationLabel(chunk)` covering paste, unedited PDF, edited PDF, and printed label equal or different from page index plus one
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6_

  - [ ] 6.3 Write property test for citation labels
    - File: `packages/core/src/citation-labeller.test.ts`
    - **Property 19: Citation labels follow the chunk metadata**
    - **Validates: Requirements 8.1, 8.2, 8.3, 8.5, 8.6**

  - [ ] 6.4 Write property test for problem messages
    - File: `packages/core/src/copy-errors.test.ts`
    - **Property 5: Problem messages name the limit and a next step**
    - **Validates: Requirements 3.6, 4.4, 11.3, 11.4**

  - [ ] 6.5 Write property test for banned words
    - File: `packages/core/src/copy-banned-words.test.ts`
    - **Property 20: Banned words never appear in labels or copy**
    - **Validates: Requirements 8.4, 11.2**

- [ ] 7. Checkpoint - Engine complete
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 8. Create the first Kiro hook
  - Create the hook with Kiro's `createHook` tool (or the Agent Hooks UI). Whatever file name and format it produces is correct; do not hard-code a file name or write the hook JSON by hand
  - The hook is named "Run core tests on save", triggers on save of files under `packages/core/src` (a `PostFileSave` trigger whose matcher accepts both `/` and `\` path separators, for example `packages[/\\]core[/\\]src[/\\]`), and runs the command `node .kiro/hooks/run-core-tests.mjs`
  - `PostFileSave` matchers are tested against the saved file path, so the matcher already limits the hook to `packages/core/src`. Record the file name that was produced in `docs/build-log.md`
  - Create `.kiro/hooks/run-core-tests.mjs`: it runs `pnpm --filter @escape-the-crypt/core test --run` and exits with that command's status. It reads stdin defensively: if there is no stdin, stdin is empty, the JSON does not parse, or the JSON has no file path, it RUNS the tests. It exits 0 early without running anything only when a file path is present and that path is outside `packages/core/src` (treating `/` and `\` alike)
  - Confirm the generated hook file loads in Kiro and that the script writes no logs or user content under `.kiro/`
  - Add a short entry to `docs/build-log.md` noting the hook, its trigger, and that CI remains the release gate while the hook is fast feedback only
  - _Requirements: 12.1_

- [ ] 9. Extraction Worker and client
  - [ ] 9.1 Implement the Extraction Worker
    - Create `apps/web/src/features/ingest/extraction-worker.ts` using the mode recorded by the spike
    - Open the document with `enableScripting: false`, no password callback and cMap and font fetching off (unless self-hosted)
    - Per page: check `checkElapsed` with an injected `Clock` before and after, map items to `TextItemData`, call `assemblePageText`, update the running word total with `checkWordCount`, run `classifyPage`, post `progress`, `page`, `error` or `done`
    - Map pdf.js `PasswordException` to `encrypted` and parse failures to `unreadable`; check a `cancelled` flag between pages
    - _Requirements: 2.1, 2.2, 2.4, 2.5, 3.4, 3.5, 4.1, 4.4_

  - [ ] 9.2 Implement the Extraction Client
    - Create `apps/web/src/features/ingest/extraction-client.ts` exposing `start`, `cancel` and `terminate`, hiding the chosen mode
    - Check file size before creating any worker and reject without starting one
    - Apply a wall-clock timeout with the injected clock as a second guard; terminate the worker (or run `loadingTask.destroy()`, document destroy and pdf.js worker termination in fallback mode) on cancel, timeout or error, and drop buffer references
    - Send the page choice with `start` so pages are chosen before extraction begins
    - _Requirements: 2.2, 2.3, 2.6, 2.7, 3.2, 3.5_

  - [ ] 9.3 Create fixture PDFs
    - Add a generator script and small fixtures under `apps/web/src/features/ingest/fixtures/`: a PDF padded just over 5 MB, an 11-page PDF, a PDF over 6,000 words, an `ok` prose page, an image-only page, a garbled and table-like page, a PDF with embedded JavaScript, and a three-paragraph PDF with a hyphenated word break ("exam-" then "ple")
    - The encrypted PDF is not produced by the generator script, because pdf-lib cannot encrypt PDFs. Commit a small pre-made encrypted PDF, generated once with a tool that supports encryption (for example `qpdf --encrypt user owner 256 -- in.pdf out.pdf`), and note the tool and exact command in a fixtures `README.md` in the same folder
    - _Requirements: 14.1, 14.2_

  - [ ] 9.4 Write limit tests with fixture PDFs and an injected clock
    - File: `apps/web/src/features/ingest/extraction-limits.test.ts`
    - Test the file-size, page-count and word-count limits with the fixtures, and the 20-second limit with an injected clock that jumps past the limit instead of a slow fixture
    - Assert the file-size rejection never starts the worker
    - _Requirements: 3.2, 3.3, 3.4, 3.5, 14.1_

  - [ ] 9.5 Write page flag and multi-paragraph fixture tests
    - File: `apps/web/src/features/ingest/extraction-flags.test.ts`
    - One fixture each for `ok`, `low-text` and `suspicious`
    - Extract the three-paragraph fixture through the real pdf.js path and check blank lines between paragraphs, three chunks from `chunkDocument`, and that a quote spanning the hyphen break resolves
    - _Requirements: 4.1, 4.2, 4.3, 6.1, 7.2, 14.2_

  - [ ] 9.6 Write encrypted PDF and worker lifecycle tests
    - File: `apps/web/src/features/ingest/extraction-lifecycle.test.ts`
    - Encrypted fixture gives the `encrypted` error and the worker is terminated
    - With a mocked worker: Stop, timeout and error each terminate it, and the page choice is sent before `start`
    - _Requirements: 2.2, 2.3, 2.6, 2.7, 4.4_

- [ ] 10. Ingest state machine, design tokens and fonts
  - [ ] 10.1 Implement the state machine
    - Create `apps/web/src/features/ingest/ingest-machine.ts`: reducer with `PASTE_CHANGED`, `FILE_SELECTED`, `PAGES_CHOSEN`, `EXTRACTION_PAGE`, `EXTRACTION_ERROR`, `CANCEL`, `PAGE_REMOVED`, `TEXT_EDITED`, `CONFIRM`
    - Hold ingest units (original text, current text, flag, included), status and the latest announcement
    - Implement `canConfirm`; on `CONFIRM` call `chunkDocument`; reject pasted text over the word limit with the copy message
    - _Requirements: 1.3, 2.6, 3.3, 3.6, 4.5, 5.1, 5.2, 5.5, 5.6_

  - [ ] 10.2 Write property test and unit tests for the state machine
    - File: `apps/web/src/features/ingest/ingest-machine.test.ts`
    - **Property 7: Confirm is disabled for empty content**
    - Unit tests for removing a page, an over-limit paste message, and cancel discarding partial results
    - **Validates: Requirements 5.6**

  - [ ] 10.3 Create the design tokens and self-hosted fonts
    - Create `apps/web/src/styles/tokens.css` with the palette from `.kiro/steering/design-system.md` on `:root`: `--stone-950`, `--stone-800`, `--stone-300`, `--bone-50`, `--spectre-300`, `--candle-400`, `--ember-600`, `--parchment-100` and `--ink-900`. Add the font variables `--font-title` (Cinzel, Cinzel Decorative, serif) and `--font-body` (Crimson Pro, EB Garamond, serif) and the focus variables `--focus-ring` (2px solid `--spectre-300`) and `--focus-offset`. This is the only file in the app that may contain colour literals
    - Create `apps/web/src/styles/fonts.css` with `@font-face` rules, `font-display: swap`, whose `src` values are root-relative `/fonts/*.woff2` paths. Import `tokens.css` and `fonts.css` once from the app entry (`apps/web/src/main.tsx`)
    - Add the woff2 files under `apps/web/public/fonts/`: Cinzel and Cinzel Decorative for titles only, and Crimson Pro for body text, with each family's SIL OFL license file next to its font files, and list the fonts and licenses in `ASSETS.md`
    - Download the woff2 files once during development (from the `@fontsource` packages or the google/fonts repository) and commit them to the repository. The app never fetches fonts from another origin, at build time or run time, and does not use the Google Fonts CDN, so the network guarantee test in task 12.1 still passes (font files are same-origin `GET` requests)
    - Add a base ingest rule set in `apps/web/src/features/ingest/ingest-base.css` that uses tokens only: `font-family: var(--font-body)` on body text, `inherit` on `button` and `input`, root `container-type: inline-size` with 16px text and line-height 1.5 raised to 18px by a `@container (min-width: 40rem)` rule, and a single `:focus-visible` rule using `--focus-ring` and `--focus-offset`
    - _Requirements: 16.1, 16.2, 16.3, 16.4, 16.5, 16.6, 16.9, 16.10_

  - [ ] 10.4 Write the token, contrast and style-guard tests
    - File: `apps/web/src/styles/tokens.test.ts`: parse `tokens.css`, check all nine palette variables exist with the `design-system.md` values, compute the WCAG contrast ratio for each text and surface pair in the design's colour-role table (at least 4.5:1 for body text, 3:1 for large text), and check text on `--parchment-100` uses `--ink-900`
    - File: `apps/web/src/features/ingest/style-guard.test.ts` with two scan scopes, because later desk and crypt screens outside the ingest folder need full-screen layers and fixed overlays
    - App-wide scope: scan every `.css`, `.tsx` and `.ts` file under `apps/web` (including `fonts.css`) and fail on a colour literal outside `apps/web/src/styles/tokens.css` (hex, `rgb(`, `rgba(`, `hsl(`, `hsla(`, `hwb(`, `lab(`, `lch(`, `oklab(`, `oklch(`, `color(`, or a named colour as a colour value), a cross-origin URL (allow only the SVG namespace string), a Google Fonts host, and any `fonts.css` URL that is not a root-relative `/fonts/*.woff2` path to an existing file
    - Ingest-only scope: scan only `.css`, `.tsx` and `.ts` files under `apps/web/src/features/ingest/**` and fail on any viewport unit (`vw`, `vh`, `dvh`, `svh`), `position: fixed`, a page-level `background`, `background-image` or `url(` in ingest styles, and `--candle-400` used outside a lit-state selector. Files outside `features/ingest` are never subject to these checks
    - Add negative tests that feed the guard one fixture string per violation and expect it to fail, so the guard cannot pass silently. Scope-aware cases: a colour literal, a cross-origin URL and a Google Fonts host fail wherever they appear under `apps/web` (except a colour literal inside `tokens.css`); a `position: fixed` (and a viewport unit, `background-image`, `--candle-400` outside a lit-state selector) fixture placed outside `features/ingest` passes, and the same fixture placed inside `features/ingest` fails
    - Run the scan over the finished ingest components, so schedule this after the UI tasks
    - _Requirements: 16.1, 16.2, 16.5, 16.6, 16.7, 16.8, 16.11, 16.12, 17.1, 17.2_

- [ ] 11. Ingest UI
  - [ ] 11.1 Build the privacy notice, paste input and live announcer
    - Create `privacy-notice.tsx`, `paste-input.tsx` (labelled native `textarea` with a word counter) and `live-announcer.tsx` (visually hidden polite live region) under `apps/web/src/features/ingest/`, each with its own small CSS file
    - Style only with the design tokens from task 10.3. Set no fixed layout, no viewport units, no page background and no background art. Each component draws its own surface and takes the width and height its parent gives it, so a later open-book parent can host it without changes to the component
    - Use native `textarea`, `label` and `form` elements and take all text from the copy catalogue; the notice states the file stays on the device and only confirmed text is sent later
    - Set title text in the Title font and body text and inputs in the Body font
    - _Requirements: 1.1, 1.3, 9.3, 10.1, 10.2, 10.3, 16.1, 16.3, 16.4, 17.1, 17.2, 17.3, 17.4, 17.5_

  - [ ] 11.2 Build the PDF picker and page list
    - Create `pdf-picker.tsx` (native file input, size check, page checkboxes stopping at 10 with a message, Stop button during extraction) and `page-list.tsx` (flag icon plus text label, "Remove page" button on flagged pages), each with its own small CSS file
    - Style only with the design tokens. Set no fixed layout, no viewport units, no page background and no background art, and size to the space the parent gives. Use native `button`, `input` and `label` elements and compose cleanly inside a later open-book parent
    - Use 44x44 px hit areas, the shared token focus ring and no drag interactions
    - _Requirements: 2.3, 2.6, 3.2, 3.3, 4.5, 4.6, 9.1, 9.2, 9.5, 9.6, 9.7, 16.10, 17.1, 17.2, 17.3, 17.4, 17.5_

  - [ ] 11.3 Build the preview editor
    - Create `preview-editor.tsx` with its own small CSS file: one native `textarea` per page or paragraph, rendered as plain React text with no `dangerouslySetInnerHTML`
    - Draw the preview on a `--parchment-100` surface with `--ink-900` text, in the Body font, and show the Confirm button disabled with an adjacent explanation when `canConfirm` is false
    - Style only with the design tokens. Set no fixed layout, no viewport units, no page background and no background art, and use native `button` and `textarea` elements so the editor composes inside a later open-book parent
    - _Requirements: 5.1, 5.2, 5.5, 5.6, 5.7, 9.1, 9.4, 16.3, 16.4, 16.8, 17.1, 17.2, 17.3, 17.4, 17.5_

  - [ ] 11.4 Wire the flow and local notes storage
    - In `packages/core` (pure, no DOM, no IndexedDB): create `packages/core/src/notes-record.ts` holding ONLY the `NotesRecord` type, the `NOTES_SCHEMA_VERSION` constant (1) and the pure helpers `makeNotesRecord(chunks)` and `parseNotesRecord(value)`. The record has only `schemaVersion`, `documentDigest` and `chunks`, and `parseNotesRecord` returns a typed error and never throws. Define `NotesRecord` in `types.ts` if task 2.1 did not already, and export the new module from `packages/core/src/index.ts`. `NotesStore`, `createSessionStore` and both adapters do NOT go in `packages/core`, because core must not touch the DOM or IndexedDB
    - In `apps/web/src/features/ingest/` (all store code lives here and imports `NotesRecord` and `Result` from `@escape-the-crypt/core`): create `notes-store.ts` (the `NotesStore` interface, the `storage-unavailable` result and `createSessionStore(primary, fallback)`), `notes-store-idb.ts` (the IndexedDB adapter) and `notes-store-memory.ts` (the in-memory adapter). The IndexedDB adapter uses database `escape-the-crypt`, version 1, object store `notes` with `keyPath: 'documentDigest'` and `put`, so a record with the same digest is replaced. It catches errors and returns the kind only, without logging the error object
    - Create `ingest-flow.tsx` connecting the components to the state machine, the Extraction Client and the store (passed in as a prop). On Confirm it builds the record with `makeNotesRecord` and saves it. If the save fails, it keeps the chunks in the in-memory store for the session and announces the `storage-failed` message from the copy catalogue (add that message to `copy.ts` with `what` and `next` parts). It announces page flag set, page removed, text edited and notes confirmed
    - Never store the PDF bytes or file name, never write the text of your notes to console logs or error reports, and never send the notes record to a server. Add `no-console` as an error for `features/ingest` in the ESLint config
    - `ingest-flow.tsx` has no fixed layout, no viewport units, no page background and no background art, imports no router or layout, and takes everything through props, so a later open-book screen can host it unchanged. Add the Ingest screen route in `apps/web`
    - _Requirements: 2.3, 4.5, 5.5, 9.3, 12.2, 17.2, 17.5, 18.1, 18.2, 18.3, 18.4, 18.5, 18.6, 18.7, 18.8, 18.10_

  - [ ] 11.5 Write component and layout tests
    - File: `apps/web/src/features/ingest/ingest-ui.test.tsx`
    - Preview text such as `<img src=x onerror=alert(1)>` renders as visible text with no element created; a check rejects `dangerouslySetInnerHTML` in `features/ingest`
    - Flags show an icon and text; live-region announcements appear after remove, edit and confirm; no action needs drag (the 44x44 px target-size check is not done here, because jsdom has no layout; it is in the Playwright layout test below)
    - The upload screen contains both privacy statements and "your notes"
    - No `div` or `span` in the ingest output carries a button role (native elements only)
    - Create `apps/web/src/features/ingest/test-parent.tsx` (it stays in `src`; the e2e file imports or loads it as needed): a minimal 360px-wide parent layout with a parchment background and a decorative atmosphere overlay set to `pointer-events: none`. File: `apps/web/e2e/ingest-layout.e2e.ts` renders `IngestFlow` in the test parent and checks that every control is visible, is not covered (`elementFromPoint` returns the control), measures at least 44x44 px (the target-size check lives here, not in the jsdom test), and works by click and keyboard. Repeat at 720px to confirm the components fill the width the parent gives
    - Playwright style check in the same file: computed `font-family` on a title, the preview, a textarea and a button; computed `font-size` and `line-height` at 360px (16px, 1.5) and at a 1024px parent (18px, 1.5); and a 2px `--spectre-300` outline after Tab on each control
    - _Requirements: 4.6, 5.7, 9.3, 9.5, 9.6, 9.7, 10.1, 10.2, 10.3, 16.3, 16.4, 16.9, 16.10, 17.3, 17.4, 17.5, 17.6, 17.7_

  - [ ] 11.6 Write storage property tests and the console-capture check
    - File: `packages/core/src/notes-record.test.ts`: unit tests that `NOTES_SCHEMA_VERSION` is a named integer constant, that `makeNotesRecord` output has only `schemaVersion`, `documentDigest` and `chunks`, and that `parseNotesRecord` rejects malformed values without throwing
    - File: `apps/web/src/features/ingest/notes-store.test.ts`, using `fake-indexeddb` (add it as a dev dependency of `apps/web`) behind the real IndexedDB adapter:
      - **Property 21: Notes record round trip**
      - **Property 22: Saving the same digest replaces the record**
      - **Property 23: Storage failure keeps notes in the session**
      - Property 23 injects failures: undefined `indexedDB`, a rejected `open`, an aborted write and a quota error
    - File: `apps/web/e2e/ingest-storage.e2e.ts`: enter a sentinel string in the notes, run the paste flow and confirm, then assert that no console message contains the sentinel, that the `notes` store holds only the allowed record fields with no `ArrayBuffer`, `Blob` or file name, and that no request after Confirm leaves the origin or carries the notes text. Add a component test that renders the flow with a failing store and checks the `storage-failed` message appears in the live region and the flow stays usable
    - **Validates: Requirements 18.1, 18.2, 18.4, 18.8, 18.9**
    - _Requirements: 18.2, 18.3, 18.5, 18.6, 18.7_

- [ ] 12. Integration, end-to-end and structure checks
  - [ ] 12.1 Write the network guarantee test
    - File: `apps/web/e2e/ingest-network.e2e.ts`
    - During a fixture PDF extraction, allow same-origin GETs without a body, and fail on any cross-origin request, any request with a body, or any request containing extracted text
    - Same-origin `GET /fonts/*.woff2` requests are allowed, because the self-hosted fonts are same-origin static files; a request to Google Fonts or any other origin must still fail the test
    - _Requirements: 2.4, 16.5, 16.6_

  - [ ] 12.2 Write the PDF actions smoke test
    - File: `apps/web/src/features/ingest/extraction-actions.test.ts`
    - Assert the pdf.js options have scripting disabled and the embedded-JavaScript fixture causes no side effect
    - _Requirements: 2.5_

  - [ ] 12.3 Write the Playwright paste flow test with axe
    - File: `apps/web/e2e/ingest.e2e.ts`
    - Paste three paragraphs of at least 40 characters, check Confirm is disabled and explained while empty, check the preview shows plain text, edit paragraph 2, confirm
    - Read stored chunks: only chunk 2 has `edited: true`; labels read "Paragraph 1 of your notes", "Paragraph 2 of your notes", "Paragraph 3 of your notes"
    - Repeat the flow with keyboard only, and run axe on the upload, page-list and preview screens
    - _Requirements: 5.4, 5.6, 8.2, 9.1, 15.1_

  - [ ] 12.4 Add architecture and structure checks
    - Add lint or CI checks that `packages/core` imports nothing from React, `pdfjs-dist` or the DOM, that `@noble/hashes` is its only runtime dependency (exact version), that no source file exceeds 300 lines, that file names are kebab-case, and that shared types live in `packages/core/src/types.ts`
    - Wire them into `pnpm lint` (the CI workflow from task 0.4 already runs it on every push)
    - _Requirements: 12.1, 12.2, 12.3, 12.4_

- [ ] 13. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- All test tasks are required; tests are part of done
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties; unit tests validate examples and edge cases
- The spike (task 1) decides the pdf.js mode; if it selects the main-thread fallback, tasks 9.1 and 9.2 implement the fallback contract from the design
- Task 10.3 creates the tokens and self-hosted fonts that every Ingest UI task in task 11 depends on; `tokens.css` is the only file allowed to contain colour literals
- Fonts are same-origin static files, so the network guarantee test in task 12.1 allows them and still fails on any cross-origin request
- Ingest components carry no layout of their own and use native elements and tokens only, so a later open-book screen can host them unchanged
- The notes record is `{ schemaVersion, documentDigest, chunks }` in IndexedDB, keyed by digest; saved crypts are a later spec and need no migration of existing records
- The hook in task 8 is fast feedback only; CI stays the release gate
- A real Android Chrome device check and a manual keyboard, zoom and screen reader pass remain manual steps outside this task list

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["0.1"] },
    { "id": 1, "tasks": ["0.2"] },
    { "id": 2, "tasks": ["0.3", "0.4"] },
    { "id": 3, "tasks": ["0.5"] },
    { "id": 4, "tasks": ["1.1"] },
    { "id": 5, "tasks": ["1.2"] },
    { "id": 6, "tasks": ["2.1"] },
    { "id": 7, "tasks": ["2.2", "3.1", "3.3", "4.1", "5.1", "6.1"] },
    { "id": 8, "tasks": ["2.3", "2.4", "2.5", "3.2", "3.4", "4.2", "5.2", "6.2"] },
    { "id": 9, "tasks": ["4.3", "4.4", "4.5", "4.6", "4.7", "4.8", "4.9", "5.3", "5.4", "5.5", "5.6", "5.7", "5.8", "5.9", "6.3", "6.4", "6.5"] },
    { "id": 10, "tasks": ["7"] },
    { "id": 11, "tasks": ["8", "9.1", "9.3", "10.1", "10.3"] },
    { "id": 12, "tasks": ["9.2", "10.2", "11.1", "11.2", "11.3"] },
    { "id": 13, "tasks": ["9.4", "9.5", "9.6", "11.4"] },
    { "id": 14, "tasks": ["10.4", "11.5", "11.6", "12.1", "12.2", "12.3", "12.4"] },
    { "id": 15, "tasks": ["13"] }
  ]
}
```
