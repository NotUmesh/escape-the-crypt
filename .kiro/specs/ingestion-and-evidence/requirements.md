# Requirements Document

## Introduction

This spec covers the part of Escape the Crypt that lets a learner bring their own study notes into the game and turn them into immutable, traceable chunks that every later question can cite. It covers, and only covers: paste input, PDF input and page selection, extraction limits, per-page quality flags, the extraction preview with editing, chunking, quote resolution and citation labels, plus the design tokens and self-hosted fonts, the layout-agnostic Ingest UI, and local notes storage (Requirements 16 to 18).

The following are explicitly out of scope for this spec and are covered elsewhere: question generation, AI calls, model invocation and prompts; gameplay, rooms, locks, scoring and reports; and server-side job processing in `apps/worker`. This spec is concerned only with client-side input, the extraction preview, chunking and quote resolution.

Engine logic (chunking, quote resolution, the limits, page checks and citation labels) lives in `packages/core` as pure, synchronous functions. The UI and the extraction web worker live in `apps/web` under the ingest feature folder.

## Glossary

- **Learner**: the person using the crypt to study their own notes.
- **Notes**: the learner's study material, supplied by paste or PDF.
- **Ingest UI**: the `apps/web` feature (under `apps/web/src/features/ingest`) that collects learner input, shows the preview and produces confirmed text.
- **Extraction Worker**: the web worker in `apps/web` that extracts text from a PDF in the browser using the pinned pdf.js library. If pdf.js cannot run inside it, the extraction runs through pdf.js's own worker from the main thread under the same contract (see Requirement 2, criterion 1).
- **Engine**: the `packages/core` library of pure functions (the Chunker, the Quote Resolver, the Citation Labeller, the Limits Module and the Page Checker).
- **Chunker**: the pure function in the Engine that splits confirmed text into chunks and assigns chunk IDs.
- **Quote Resolver**: the pure function in the Engine that finds a quote in a chunk and returns a resolved location or a typed error.
- **Citation Labeller**: the pure function in the Engine that produces a display label for a resolved quote.
- **Limits Module**: the named constants and checks in the Engine that bound extraction (maximum file size, maximum selected pages, maximum extracted words, maximum extraction time).
- **Page Checker**: the pure function in the Engine that classifies an extracted PDF page as ok, low-text or suspicious.
- **Test Suite**: the Vitest, fast-check and Playwright tests that run in CI.
- **Confirmed text**: the text the learner has reviewed, optionally edited and approved for chunking.
- **Chunk**: an immutable, code-assigned unit of confirmed text that later questions can cite.
- **Chunk ID**: an immutable identifier assigned by the Chunker; deterministic for identical confirmed text.
- **Document digest**: a hash of the confirmed text, recorded on each chunk.
- **Source type**: the origin of a chunk, either `pdf` or `paste`.
- **PDF page index**: the 0-based position of a page in the PDF file.
- **Printed page label**: the page number printed on a PDF page when detectable; a field distinct from the PDF page index.
- **Paragraph number**: the 1-based position of a paragraph in pasted notes.
- **Edited flag**: a per-chunk flag stating whether the chunk's text is original extraction or learner-edited.
- **Quote**: a short excerpt of text drawn from a single chunk.
- **Resolved location**: a code-computed reference to where a quote occurs in a chunk; the Quote Resolver is the sole source of resolved locations.
- **Normalisation**: the text transformations applied before matching a quote (whitespace, curly versus straight quotation marks, hyphenation at line breaks, ligatures).
- **Page flag**: a per-page classification (ok, low-text, suspicious) produced by the Page Checker.
- **Maximum file size**: a named constant (5 MB) bounding the size of an uploaded PDF.
- **Maximum selected pages**: a named constant (10) bounding the number of PDF pages a learner may include.
- **Maximum extracted words**: a named constant (6000) bounding the words of text the Chunker processes, applied to extracted PDF text and to pasted text.
- **Maximum extraction time**: a named constant (20 seconds) bounding how long a single extraction may run.
- **Minimum quote length**: a named constant in `packages/core` (default: 4 words or 20 characters, whichever is longer) bounding the shortest quote the Quote Resolver will search for; shorter quotes return a too-short error without searching.
- **Maximum chunk size**: a named constant (1,200 characters) bounding the longest chunk the Chunker emits; the Chunker splits chunks that exceed it at sentence boundaries.
- **Minimum chunk size**: a named constant (40 characters) bounding the shortest standalone chunk the Chunker emits; the Chunker merges chunks shorter than this, such as lone headings, into the following chunk of the same page or paragraph (or into the preceding chunk when the short chunk is last in its page or paragraph).- **Design tokens**: the CSS custom properties defined in `apps/web/src/styles/tokens.css` that carry the design-system.md palette: `--stone-950`, `--stone-800`, `--stone-300`, `--bone-50`, `--spectre-300`, `--candle-400`, `--ember-600`, `--parchment-100` and `--ink-900`.
- **Self-hosted font**: a font shipped as a woff2 file inside the app and loaded from the same origin as the app.
- **Title font**: Cinzel or Cinzel Decorative, used for titles only.
- **Body font**: Crimson Pro, used for body text, questions and inputs.
- **Focus ring**: the visible focus indicator, a 2px solid outline in `--spectre-300` with a positive outline offset.
- **Lit state**: a success or completed state, the only state in which the Ingest UI uses `--candle-400`.
- **Parent layout**: any later screen that hosts the Ingest UI components, such as the open book on the desk described in product.md.
- **Atmosphere layer**: a decorative layer added by a parent layout, such as darkness, vignette, grain, mist or cursor glow.
- **Notes record**: the IndexedDB record that stores the chunks of one set of confirmed notes on the learner's device, keyed by the document digest.
- **Schema version**: the `schemaVersion` field of the notes record, an integer that identifies the record's shape.

## Requirements

### Requirement 1: Paste input

**User Story:** As a learner, I want to paste my plain-text study notes into the crypt, so that my notes can become citable chunks.

#### Acceptance Criteria

1. THE Ingest UI SHALL provide a text input area that accepts pasted plain text from the learner.
2. WHEN the learner confirms pasted text, THE Chunker SHALL split the text into paragraphs at one or more consecutive blank lines.
3. WHEN the pasted text exceeds the maximum extracted words, THE Ingest UI SHALL show a message naming the word limit and the next step the learner can take.

### Requirement 2: PDF input and page selection

**User Story:** As a learner, I want to upload a text-based PDF and choose which pages to include, so that only the pages I want become citable chunks.

#### Acceptance Criteria

1. WHEN the learner selects a PDF file, THE Extraction Worker SHALL extract text from the learner's chosen pages in the browser using the pinned pdf.js library running inside a web worker. IF a feasibility check shows that pdf.js cannot run correctly inside the Extraction Worker on Chrome, Firefox and Android Chrome, THEN THE Ingest UI SHALL run the pdf.js worker from the main thread, SHALL call `loadingTask.destroy()` and terminate the pdf.js worker on cancel or timeout, and SHALL still honour cancel, timeout and memory release as required by criteria 2, 3 and 7 and by Requirement 3 criterion 5.
2. WHILE extraction is in progress, THE Extraction Worker SHALL remain cancellable.
3. THE Ingest UI SHALL provide a control that stops an in-progress extraction.
4. WHILE extraction is running, THE Extraction Worker SHALL send no request to another origin and SHALL send no request body that contains file content or extracted text. Same-origin static asset requests, including the self-hosted pdf.js worker, cMaps and fonts, are allowed. THE Extraction Worker SHALL disable cMap and standard-font fetching unless those files are self-hosted on the same origin.
5. THE Extraction Worker SHALL disable embedded PDF actions, including JavaScript, form submissions and launch actions, during extraction.
6. THE Ingest UI SHALL let the learner choose which pages to include before extraction begins.
7. WHEN extraction is cancelled or times out, THE Ingest UI SHALL terminate the Extraction Worker and SHALL release its memory.

### Requirement 3: Extraction limits

**User Story:** As a learner, I want extraction to stop early with a clear message when my file is too large or too long, so that I know what went wrong and what to do.

#### Acceptance Criteria

1. THE Limits Module SHALL define the maximum file size, the maximum selected pages, the maximum extracted words and the maximum extraction time as named constants in `packages/core`.
2. WHEN the selected PDF exceeds the maximum file size, THE Ingest UI SHALL check the file size before extraction begins and SHALL reject the file without starting the Extraction Worker and SHALL show a message naming the file-size limit and the next step the learner can take.
3. WHEN the learner selects more than the maximum selected pages, THE Ingest UI SHALL stop the selection at the maximum selected pages and SHALL tell the learner the page limit.
4. WHEN the running word count of extracted PDF text exceeds the maximum extracted words, THE Extraction Worker SHALL stop extraction and THE Ingest UI SHALL show a message naming the word limit and the next step the learner can take.
5. WHEN extraction runs longer than the maximum extraction time, THE Extraction Worker SHALL stop extraction and THE Ingest UI SHALL show a message naming the time limit and the next step the learner can take.
6. WHEN any limit is exceeded, THE Ingest UI SHALL show a message that names which limit was reached and what the learner can do next.

### Requirement 4: Page quality checks

**User Story:** As a learner, I want each PDF page flagged when its text looks wrong, so that I can fix or remove pages that would produce bad chunks.

#### Acceptance Criteria

1. WHEN the Extraction Worker finishes extracting a page, THE Page Checker SHALL classify the page as ok, low-text or suspicious.
2. WHILE a page contains little or no extractable text, THE Page Checker SHALL flag the page as low-text to indicate a likely scanned or image-only page.
3. WHILE a page's extracted text shows garbled characters or very short lines that suggest tables or columns, THE Page Checker SHALL flag the page as suspicious.
4. IF the selected PDF is encrypted or password-protected, THEN THE Extraction Worker SHALL reject the file and THE Ingest UI SHALL show a message that explains the problem and what the learner can do.
5. WHEN a page is flagged as low-text or suspicious, THE Ingest UI SHALL let the learner remove the page from the included set.
6. THE Ingest UI SHALL display each page flag with an icon and a text label.

### Requirement 5: Extraction preview and editing

**User Story:** As a learner, I want to see and edit the extracted text before it is used, so that I can fix mistakes and keep the text accurate.

#### Acceptance Criteria

1. WHEN extraction finishes, THE Ingest UI SHALL show the learner the extracted text for each included page or pasted paragraph.
2. THE Ingest UI SHALL let the learner edit the extracted text for each page or paragraph.
3. THE Ingest UI SHALL determine the edited flag for each chunk by comparing the chunk's text to its original extraction text, rather than marking a whole page or paragraph as edited.
4. THE Ingest UI SHALL record, for each chunk, an edited flag that states whether the chunk's text differs from its original extraction text.
5. THE Ingest UI SHALL require the learner to confirm the preview before the Chunker produces chunks from the text.
6. WHEN no pages are included or the confirmed text is empty, THE Ingest UI SHALL disable the Confirm control with an explanation.
7. THE Ingest UI SHALL render all preview text as plain text and SHALL NOT render preview text as HTML, including via `dangerouslySetInnerHTML`, consistent with the security steering rules.

### Requirement 6: Chunking

**User Story:** As a builder, I want confirmed text split into immutable, traceable chunks with code-assigned IDs, so that every later question can cite a specific piece of the notes.

#### Acceptance Criteria

1. WHEN the learner confirms the preview, THE Chunker SHALL split the confirmed text into chunks by paragraph or heading.
2. THE Chunker SHALL assign each chunk an immutable chunk ID, and the Chunker, not any model, SHALL be the sole source of chunk IDs.
3. THE Chunker SHALL record, for each chunk, the document digest of the confirmed text.
4. THE Chunker SHALL record, for each chunk, the source type as either `pdf` or `paste`.
5. WHERE the source type is `pdf`, THE Chunker SHALL record the PDF page index (0-based) and the printed page label as two distinct fields.
6. WHERE the source type is `paste`, THE Chunker SHALL record the paragraph number.
7. THE Chunker SHALL record, for each chunk, the edited flag.
8. WHEN the Chunker receives identical confirmed text on two separate occasions, THE Chunker SHALL produce identical chunk IDs for chunks in identical positions.
9. THE Chunker SHALL derive each chunk ID from the document digest and the chunk's position within the document, so that identical paragraphs within one document receive distinct chunk IDs.
10. THE Chunker SHALL define the maximum chunk size (1,200 characters) and the minimum chunk size (40 characters) as named constants in `packages/core`.
11. WHEN a chunk is longer than the maximum chunk size, THE Chunker SHALL split the chunk at sentence boundaries.
12. WHEN a chunk is shorter than the minimum chunk size and a following chunk exists within the same PDF page or the same paragraph, THE Chunker SHALL merge the chunk into that following chunk.
13. THE Chunker SHALL NOT merge or split chunks across a PDF page boundary (source type pdf) or a paragraph boundary (source type paste), so that every chunk keeps exactly one source location.
14. WHEN the last chunk within a page or paragraph is shorter than the minimum chunk size, THE Chunker SHALL merge it into the preceding chunk of the same page or paragraph instead of the following chunk, and this rule SHALL take precedence over criterion 12 because no following chunk exists within that page or paragraph.
15. WHEN a single sentence exceeds the maximum chunk size, THE Chunker SHALL split the sentence at the nearest word boundary.
16. WHEN a chunk is shorter than the minimum chunk size and is the only chunk within its PDF page or paragraph, THE Chunker SHALL keep the chunk unchanged and SHALL NOT merge the chunk with any chunk from another page or paragraph.

### Requirement 7: Quote resolution

**User Story:** As a builder, I want a pure function that finds a short quote inside a chunk and returns a resolved location, so that citations point to real text and the model never supplies offsets.

#### Acceptance Criteria

1. WHEN given a chunk ID and a quote, THE Quote Resolver SHALL normalise the chunk text and the quote using a defined normalisation that handles whitespace, curly versus straight quotation marks, hyphenation at line breaks, ligatures and Unicode NFC normalisation.
2. THE Quote Resolver SHALL join only hyphens at line breaks during normalisation and SHALL preserve in-word hyphens.
3. THE Quote Resolver SHALL match quotes case-sensitively.
4. WHEN the normalised quote occurs exactly once in the chunk, THE Quote Resolver SHALL return a resolved location.
5. IF the normalised quote does not occur in the chunk, THEN THE Quote Resolver SHALL return a not-found error.
6. IF the normalised quote occurs more than once in the chunk, THEN THE Quote Resolver SHALL return an ambiguous error.
7. IF the given chunk ID does not exist, THEN THE Quote Resolver SHALL return an unknown-chunk error.
8. THE Quote Resolver, not any model, SHALL be the sole source of resolved locations.
9. THE Quote Resolver SHALL return typed errors for not-found, ambiguous, unknown-chunk and too-short, rather than throwing strings.
10. THE Quote Resolver SHALL include in each resolved location a start offset and an end offset measured in the original, unnormalised chunk text, so that the Ingest UI can highlight the matched text.
11. THE Engine SHALL define the minimum quote length (4 words or 20 characters, whichever is longer) as a named constant in `packages/core`.
12. IF the quote is shorter than the minimum quote length, THEN THE Quote Resolver SHALL return a too-short error without searching the chunk.

### Requirement 8: Citation labels

**User Story:** As a learner, I want clear, human-readable labels on cited quotes, so that I can find the evidence in my notes.

#### Acceptance Criteria

1. WHERE the source type is `pdf` and the edited flag is not set, THE Citation Labeller SHALL produce a label of the form "PDF page X", where X is the PDF page index plus one.
2. WHERE the source type is `paste`, THE Citation Labeller SHALL produce a label of the form "Paragraph N of your notes", where N is the paragraph number, whether or not the edited flag is set.
3. WHERE the source type is `pdf` and the edited flag is set, THE Citation Labeller SHALL produce a label of the form "Your edited notes, originally extracted from PDF page X", using the PDF page index plus one and, when the printed page label differs, the printed page label as described in criterion 5.
4. THE Citation Labeller SHALL NOT use the words "verified", "guaranteed", "100% accurate" or "hallucination-free" in any label.
5. WHERE the source type is `pdf` and a printed page label exists that differs from the PDF page index plus one, THE Citation Labeller SHALL show both values in the page reference, in the form "PDF page 5 (printed page iv)".
6. WHERE the source type is `pdf` and the printed page label equals the PDF page index plus one, THE Citation Labeller SHALL show that single value in the page reference.

### Requirement 9: Accessibility of the ingest flow

**User Story:** As a learner who uses a keyboard or a screen reader, I want every ingest step to be usable without a mouse or sight, so that I can bring my notes into the crypt.

#### Acceptance Criteria

1. THE Ingest UI SHALL make every action in upload, page selection, page flags, preview and editing reachable with the keyboard using Tab, Shift+Tab, Enter, Space and arrow keys.
2. THE Ingest UI SHALL keep a visible focus indicator on every interactive element.
3. WHEN a status changes among page flag set, page removed, text edited and preview confirmed, THE Ingest UI SHALL announce the change through a polite live region.
4. THE Ingest UI SHALL present the extracted text preview as real text, not as images.
5. THE Ingest UI SHALL pair every colour-based state indicator with an icon and a text label.
6. THE Ingest UI SHALL size every touch target at least 44 pixels wide and 44 pixels tall.
7. THE Ingest UI SHALL make every ingest action completable without drag.

### Requirement 10: Privacy notice

**User Story:** As a learner, I want to know where my file goes, so that I can trust the crypt with my notes.

#### Acceptance Criteria

1. THE Ingest UI SHALL show a plain-language notice on the upload screen stating that the file stays on the device during extraction.
2. THE Ingest UI SHALL state in the same notice that only the confirmed text will be sent for later question generation.
3. THE Ingest UI SHALL refer to the learner's material as "your notes" in privacy and status messages.

### Requirement 11: Honest and kind ingest copy

**User Story:** As a learner, I want the crypt's messages to be kind and honest, so that I trust the guidance I am given.

#### Acceptance Criteria

1. THE Ingest UI SHALL use plain, kind language in all ingest messages and SHALL NOT mock, scold or shame the learner.
2. THE Ingest UI SHALL NOT use the words "verified", "guaranteed", "100% accurate", "hallucination-free", "mastered" or "exam-ready" in any ingest copy.
3. THE Ingest UI SHALL refer to the learner's material as "your notes" and SHALL NOT use the phrase "the source document".
4. WHEN an ingest message reports a problem, THE Ingest UI SHALL state what happened and what the learner can do next.

### Requirement 12: Architecture and structure constraints

**User Story:** As a builder, I want the ingest engine and UI to live in the right packages, so that the engine stays pure, reusable and within the project's file-size guidance.

#### Acceptance Criteria

1. THE Engine SHALL implement the Chunker, the Quote Resolver, the Limits Module, the Page Checker and the Citation Labeller as pure, synchronous functions in `packages/core`, with `@noble/hashes` (the synchronous `sha256` function, pinned to an exact version) as the Engine's only runtime dependency. THE Engine SHALL NOT access IndexedDB or the DOM.
2. THE Ingest UI, the Extraction Worker and the notes record store adapters (including the IndexedDB adapter and the in-memory fallback adapter) SHALL live in `apps/web`, with the Ingest UI under the `apps/web/src/features/ingest` folder.
3. THE Engine SHALL define shared types for chunks, quotes, page flags and events in `packages/core/src/types.ts`.
4. THE Engine and the Ingest UI SHALL name source files in kebab-case and SHALL keep each source file at or below 300 lines, splitting files by responsibility.

### Requirement 13: Property-based tests

**User Story:** As a builder, I want property-based tests for the engine, so that determinism and quote-resolution correctness hold across many inputs.

#### Acceptance Criteria

1. THE Test Suite SHALL include a fast-check property that, for identical confirmed text, the Chunker produces identical chunk IDs.
2. THE Test Suite SHALL include a fast-check property that every chunk records exactly one source location, being one PDF page index or one paragraph number.
3. THE Test Suite SHALL include a fast-check property that the Quote Resolver never returns a resolved location for a quote that does not occur in the chunk.
4. THE Test Suite SHALL include a fast-check property that the Quote Resolver always rejects an ambiguous quote that occurs more than once.
5. THE Test Suite SHALL include a fast-check property that the start and end offsets returned by the Quote Resolver map back to the original, unnormalised chunk text and highlight the correct span.
6. THE Test Suite SHALL include a fast-check property that the Quote Resolver always returns a too-short error, and never a resolved location, for a quote shorter than the minimum quote length.
7. THE Test Suite SHALL include a fast-check property that duplicate paragraphs within one document receive distinct chunk IDs.
8. THE Test Suite SHALL include a fast-check property that no chunk exceeds the maximum chunk size after splitting.
9. THE Test Suite SHALL include a fast-check property that no chunk spans more than one PDF page or one paragraph.

### Requirement 14: Unit tests for limits and page flags

**User Story:** As a builder, I want unit tests for each limit and each page flag, so that boundary behaviour is verified with small fixtures.

#### Acceptance Criteria

1. THE Test Suite SHALL include a unit test for each of the maximum file size, the maximum selected pages and the maximum extracted words using small fixture PDFs, and SHALL test the maximum extraction time using an injected clock rather than a slow fixture PDF.
2. THE Test Suite SHALL include a unit test for each page flag (ok, low-text, suspicious) using small fixture PDFs.

### Requirement 15: End-to-end Playwright test

**User Story:** As a builder, I want an end-to-end test of the paste flow, so that editing and confirmation produce correct chunks.

#### Acceptance Criteria

1. THE Test Suite SHALL include a Playwright test that performs paste, preview, edit and confirm, and SHALL verify that the resulting chunks carry the correct edited flags and citation labels.

### Requirement 16: Design tokens and self-hosted fonts

**User Story:** As a learner, I want the ingest screens to look like the rest of the crypt and stay readable, so that I can read and edit my notes comfortably and trust that nothing is fetched from other sites.

#### Acceptance Criteria

1. THE Ingest UI SHALL take every colour value from the design tokens defined in `apps/web/src/styles/tokens.css`.
2. THE Ingest UI SHALL define no colour literal outside `apps/web/src/styles/tokens.css`.
3. THE Ingest UI SHALL set title text in the Title font and SHALL set body text, preview text and inputs in the Body font.
4. THE Ingest UI SHALL NOT set questions, options, preview text or inputs in the Title font.
5. THE Ingest UI SHALL ship the Title font and the Body font as self-hosted woff2 files and SHALL load them from the same origin as the app.
6. THE Ingest UI SHALL NOT request a font or any other asset from a Google Fonts CDN or from any other origin, so that the network guarantee in Requirement 2 criterion 4 holds.
7. THE Ingest UI SHALL render body text with a contrast ratio of at least 4.5:1 against its actual background, and SHALL render large text with a contrast ratio of at least 3:1 against its actual background.
8. WHERE text is placed on `--parchment-100`, THE Ingest UI SHALL colour the text with `--ink-900`.
9. THE Ingest UI SHALL render body text at a size of at least 18px on desktop viewports and at least 16px on mobile viewports, with a line-height of 1.5.
10. WHEN an interactive element receives keyboard focus, THE Ingest UI SHALL show the focus ring on that element.
11. THE Ingest UI SHALL use `--candle-400` only to indicate a lit state.
12. THE Test Suite SHALL include a test that fails when any stylesheet or component under `apps/web` contains a colour literal outside `apps/web/src/styles/tokens.css` or a reference to an origin other than the app's own, and SHALL include a test that fails when any file under `apps/web/src/features/ingest` uses viewport units, `position: fixed`, a page background or background art. The colour-literal and cross-origin checks apply app-wide to `apps/web`; the layout checks apply only to `apps/web/src/features/ingest`.

### Requirement 17: Composable, layout-agnostic Ingest UI

**User Story:** As a builder, I want the ingest components to carry no screen layout of their own, so that a later screen can place them inside the open book on the desk without rewriting them.

#### Acceptance Criteria

1. THE Ingest UI SHALL style its components using the design tokens only.
2. THE Ingest UI SHALL NOT set a fixed screen layout, a viewport-based size (including viewport units), `position: fixed`, a page background or background art on any ingest component. This criterion applies only to files under `apps/web/src/features/ingest`; later desk and crypt screens outside that folder may use full-screen layers and fixed overlays.
3. THE Ingest UI SHALL size each ingest component to the width and height that a parent layout gives the component.
4. THE Ingest UI SHALL build its controls from native `button`, `input`, `textarea` and `form` elements.
5. WHEN a parent layout renders an ingest component, THE Ingest UI SHALL function without changes to the ingest component's source.
6. WHERE a parent layout adds an atmosphere layer, THE Ingest UI SHALL remain fully lit and readable, and the parent layout SHALL set `pointer-events: none` on the atmosphere layer so that the layer does not cover an ingest control.
7. THE Test Suite SHALL include a test that renders the ingest components inside a minimal test parent layout with a width of 360px and verifies that every ingest control is visible and operable.

### Requirement 18: Local notes storage shape

**User Story:** As a learner, I want my confirmed notes kept only on my device in a shape that later features can build on, so that my notes stay private and saved crypts can be added later without losing my data.

#### Acceptance Criteria

1. WHEN the learner confirms the preview, THE Ingest UI SHALL store the chunks in a notes record in IndexedDB, keyed by the document digest.
2. THE Ingest UI SHALL include a schema version field named `schemaVersion` in each notes record.
3. THE Engine SHALL define the current schema version as a named constant in `packages/core`, so that a later persistence spec can add saved crypts without a data migration of existing notes records.
4. WHEN the learner confirms notes whose document digest matches an existing notes record, THE Ingest UI SHALL replace that notes record and SHALL NOT create a second record.
5. THE Ingest UI SHALL NOT store the bytes of an uploaded PDF file in the notes record or anywhere else on the device.
6. THE Ingest UI SHALL NOT write the text of your notes to console logs, error reports or any other log.
7. THE Ingest UI SHALL keep the notes record on the learner's device and SHALL NOT send the notes record to any server.
8. IF IndexedDB is unavailable or a write fails, THEN THE Ingest UI SHALL keep the chunks in memory for the current session and SHALL tell the learner that the notes could not be saved on this device and what the learner can do next.
9. FOR ALL valid sets of chunks, writing a notes record and then reading the notes record by its document digest SHALL produce an equivalent set of chunks (round-trip property).
10. THE Engine SHALL hold only the notes record type, the schema version constant and pure helper functions for the notes record in `packages/core`, and the store adapters that read and write IndexedDB SHALL live in `apps/web`.
