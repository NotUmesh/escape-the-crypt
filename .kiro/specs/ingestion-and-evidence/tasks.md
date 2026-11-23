# Implementation Plan: Ingestion and Evidence

## Overview

The design uses TypeScript (strict mode, Node 22, pnpm workspaces, Vitest, fast-check, Playwright, axe), so no language choice is needed. The plan starts with scaffolding the workspace (packages, tooling, CI), then the pdf.js worker feasibility spike, then builds the pure engine in `packages/core` (limits, page checker, PDF text assembly, chunker, quote resolver, citation labeller, copy), then the Extraction Worker and Ingest UI in `apps/web/src/features/ingest`, then the integration, accessibility and Playwright tests. Source files use kebab-case names and stay at or below 300 lines. Tests never call an AI provider.

All test tasks are required and part of done. Property tests for one module are split across small test files so that each property is its own sub-task and files can be written in parallel.

## Tasks

- [ ] 0. Scaffold the workspace
  - [ ] 0.1 Create the root workspace and shared TypeScript and lint config
    - Create root `package.json` (private, Node 22 engines, scripts `dev`, `test`, `lint`, `typecheck`, `e2e`) and `pnpm-workspace.yaml` covering `apps/*` and `packages/*`
    - Create `tsconfig.base.json` with `strict` on, `noUncheckedIndexedAccess`, and no implicit `any`
    - Add ESLint (flat config, typescript-eslint) at the root with `no-explicit-any`, `no-eval`, `no-new-func` and `no-restricted-syntax` for `dangerouslySetInnerHTML` under `apps/web/src/features/ingest`
    - _Requirements: 12.1, 12.4_

  - [ ] 0.2 Create the three workspace packages
    - `apps/web`: Vite + React + TypeScript with a minimal `src/main.tsx` and `src/features/` folder, extending `tsconfig.base.json`
    - `apps/worker`: empty Node TypeScript package with a `src/index.ts` placeholder and its own `tsconfig.json`
    - `packages/core`: TypeScript library with `src/index.ts` and its own `tsconfig.json`, with no React, DOM or AI SDK dependency
    - Each package exposes `typecheck` and `test` scripts so root `pnpm -r` commands work
    - _Requirements: 12.1, 12.4_

  - [ ] 0.3 Configure Vitest and Playwright
    - Add a Vitest config (workspace projects for `packages/core` in Node and `apps/web` in jsdom) with one trivial passing test per package so the pipeline is green
    - Add `apps/web/playwright.config.ts` with three projects: Chromium, Firefox and a Pixel emulation (Android Chrome profile), starting the Vite preview server as `webServer`
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
    - Add a Playwright spike test with Chromium, Firefox and a Pixel emulation project (configured in task 0.3) that checks text comes back, `terminate()` stops work, and no cross-origin request is made
    - _Requirements: 2.1, 2.2, 2.4, 2.5, 2.7_

  - [ ] 1.2 Run the spike and record the decision
    - Run the spike test and record, in `docs/build-log.md`, which configuration works on Chrome, Firefox and Android Chrome (emulated here; note that a real-device check is still manual)
    - If neither configuration works on all three, record the main-thread fallback with `loadingTask.destroy()`, document destroy and pdf.js worker termination on cancel or timeout
    - Record the chosen mode in a single exported constant that `extraction-client.ts` will read
    - After recording the decision, delete the spike page and harness under `apps/web/src/features/ingest/spike/`; keep only the Playwright spike test if it is still useful as a regression check, and update it so it no longer depends on deleted files
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
  - Create `.kiro/hooks/core-tests-on-edit.json` with `version` `v1` and a `hooks` array holding one hook: `name` "Run core tests after edits", `trigger` `PostToolUse`, `matcher` `fs_write|fs_append|str_replace`, and `action` of type `command` that runs `node .kiro/hooks/run-core-tests.mjs`
  - The `PostToolUse` matcher is tested against the tool name only, so the path filter lives in the script: create `.kiro/hooks/run-core-tests.mjs`, which reads the JSON from stdin, exits 0 without output unless the edited file path is under `packages/core/src`, and otherwise runs `pnpm --filter core test --run` and exits with that command's status
  - Confirm the hook JSON matches the hook schema and that the script writes no logs or user content under `.kiro/`
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
    - Add a generator script and small fixtures under `apps/web/src/features/ingest/fixtures/`: a PDF padded just over 5 MB, an 11-page PDF, a PDF over 6,000 words, an `ok` prose page, an image-only page, a garbled and table-like page, an encrypted PDF, a PDF with embedded JavaScript, and a three-paragraph PDF with a hyphenated word break ("exam-" then "ple")
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

- [ ] 10. Ingest state machine
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

- [ ] 11. Ingest UI
  - [ ] 11.1 Build the privacy notice, paste input and live announcer
    - Create `privacy-notice.tsx`, `paste-input.tsx` (labelled native `textarea` with a word counter) and `live-announcer.tsx` (visually hidden polite live region) under `apps/web/src/features/ingest/`
    - Take all text from the copy catalogue; the notice states the file stays on the device and only confirmed text is sent later
    - _Requirements: 1.1, 1.3, 9.3, 10.1, 10.2, 10.3_

  - [ ] 11.2 Build the PDF picker and page list
    - Create `pdf-picker.tsx` (native file input, size check, page checkboxes stopping at 10 with a message, Stop button during extraction) and `page-list.tsx` (flag icon plus text label, "Remove page" button on flagged pages)
    - Use native controls, 44x44 px hit areas, a visible 2px focus outline and no drag interactions
    - _Requirements: 2.3, 2.6, 3.2, 3.3, 4.5, 4.6, 9.1, 9.2, 9.5, 9.6, 9.7_

  - [ ] 11.3 Build the preview editor
    - Create `preview-editor.tsx`: one native `textarea` per page or paragraph, rendered as plain React text with no `dangerouslySetInnerHTML`
    - Show the Confirm button disabled with an adjacent explanation when `canConfirm` is false
    - _Requirements: 5.1, 5.2, 5.5, 5.6, 5.7, 9.1, 9.4_

  - [ ] 11.4 Wire the flow and storage
    - Create `ingest-flow.tsx` connecting the components to the state machine and the Extraction Client, and an IndexedDB store that saves chunks and digest only (no file bytes, no logs of notes)
    - Add the Ingest screen route in `apps/web` and announce page flag set, page removed, text edited and notes confirmed
    - _Requirements: 2.3, 4.5, 5.5, 9.3, 12.2_

  - [ ] 11.5 Write component tests
    - File: `apps/web/src/features/ingest/ingest-ui.test.tsx`
    - Preview text such as `<img src=x onerror=alert(1)>` renders as visible text with no element created; a check rejects `dangerouslySetInnerHTML` in `features/ingest`
    - Flags show an icon and text; live-region announcements appear after remove, edit and confirm; targets measure at least 44x44 px; no action needs drag
    - The upload screen contains both privacy statements and "your notes"
    - _Requirements: 4.6, 5.7, 9.3, 9.5, 9.6, 9.7, 10.1, 10.2, 10.3_

- [ ] 12. Integration, end-to-end and structure checks
  - [ ] 12.1 Write the network guarantee test
    - File: `apps/web/e2e/ingest-network.e2e.ts`
    - During a fixture PDF extraction, allow same-origin GETs without a body, and fail on any cross-origin request, any request with a body, or any request containing extracted text
    - _Requirements: 2.4_

  - [ ] 12.2 Write the PDF actions smoke test
    - File: `apps/web/src/features/ingest/extraction-actions.test.ts`
    - Assert the pdf.js options have scripting disabled and the embedded-JavaScript fixture causes no side effect
    - _Requirements: 2.5_

  - [ ] 12.3 Write the Playwright paste flow test with axe
    - File: `apps/web/src/features/ingest/ingest.e2e.ts`
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
    { "id": 11, "tasks": ["8", "9.1", "9.3", "10.1", "11.1"] },
    { "id": 12, "tasks": ["9.2", "10.2", "11.2", "11.3"] },
    { "id": 13, "tasks": ["9.4", "9.5", "9.6", "11.4"] },
    { "id": 14, "tasks": ["11.5", "12.1", "12.2", "12.3", "12.4"] },
    { "id": 15, "tasks": ["13"] }
  ]
}
```