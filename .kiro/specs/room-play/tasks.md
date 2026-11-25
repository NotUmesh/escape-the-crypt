# Implementation Plan: Room Play

## Overview

Implementation is TypeScript throughout (strict, Node 22, Vitest, fast-check, Playwright, axe). The plan builds a plain playable loop first (groups 1 to 13) and adds the layered art, motion and art tests afterwards (groups 14 to 17).

- Groups 1 to 2: core groundwork in `packages/core` (Crypt_Content with `concepts`, mapper handoff with concept titles, builder result with `SAMPLE_CONCEPT_TITLES`, citation labeller source variant, copy, the `FinalDoorSlotState` export).
- Group 3: the Room_Binding in `apps/web/src/state/` (event mapper, `stepBinding`, `RoomAssets` with `firstQuestionByConcept`, the hook, `chosenOptionFor`).
- Groups 4 to 11: the playable loop with simple hotspot buttons (no layered art): `evidenceResult`, announcements, room screen with typography, rune and séance panels, hint/skip/challenge, evidence, ghosts, final door, escape view, Autopsy with titles, the honest "Enter the crypt" entry and the CSS source test.
- Group 12: Playwright play-throughs, keyboard path and axe.
- Groups 14 to 16: layered art by room order, geometry, candles and light, motion, reduced motion, lantern setting, then the art tests.

Every task is required. Property tests sit next to the code they test and cite the design property by number. No task adds the label "Human-reviewed" or "Blind model review passed", and no task calls an AI provider.

## Tasks

- [x] 1. Core groundwork for the loop (`packages/core`)
  - [x] 1.1 Add the Crypt_Content type and Zod schema
    - Create `packages/core/src/mapper/crypt-content.ts` starting with `import { z } from '../zod';` (never `'zod'`, per the repo lint rule), with `CryptContentExcerptSchema`, `CryptContentEntrySchema` (strict object, `superRefine` that an `optionId` must name an option of the same entry), `CryptContentConceptSchema` (`z.strictObject({ title: z.string().trim().min(1) })`), `CryptContentSchema` (`z.strictObject({ questions: z.record(...), concepts: z.record(...) })`) and `parseCryptContentEntry` returning a typed `Result` with `CryptContentSchemaError`
    - Export `CryptContent` as `{ questions, concepts }`, plus `CryptContentEntry`, `CryptContentExcerpt` and `CryptContentConcept`; define no answer-key field anywhere
    - Write `crypt-content.test.ts`: accepts a valid entry; rejects an extra `answer` or `key` field; rejects empty `excerpts`; accepts an excerpt without `optionId`; rejects an `optionId` that `options` does not hold and an `optionId` on an entry with no `options`; rejects a concept with an empty or whitespace-only title and a concept with an extra field; accepts a `concepts` record with plain-text titles; a source check that the file imports `z` from `../zod` and contains no import from `'zod'`; `parseCryptContentEntry` never throws on malformed input
    - _Requirements: 6.1, 6.2, 6.3, 6.10, 6.12, 6.13, 6.19, 6.20_

  - [x] 1.2 Add `cryptContentArb` and write the round-trip property test
    - Add `cryptContentArb` to `packages/core/src/test-support/` next to `arbitraries.ts`; build `options` first and draw each `optionId` from them; also generate a non-empty `concepts` record with non-blank plain-text titles
    - **Property 3: Crypt_Content survives a JSON round trip, including `optionId`** (covers `concepts` and every concept title)
    - **Validates: Requirements 6.11, 6.18, 6.23**
    - _Requirements: 25.15_

  - [x] 1.3 Change the Manifest_Mapper to hand off Crypt_Content
    - In `packages/core/src/mapper/manifest-mapper.ts`, make `mapAuthoringQuestionToSpec(question, maps, questionId, conceptTitle)` return `Result<MappedQuestion, MapperError>` with `{ spec, content, concept: { conceptId, title } }`; `conceptTitle` is the generated concept's label, or the sample's fixed title
    - Build question-level excerpts without `optionId`; for séance questions build one Option_Excerpt per option from that option's own evidence, in option order, resolved through `maps.chunksByParagraph`
    - Build `evidenceRefs` from the same excerpts so every `evidenceRefs` ID appears as an excerpt `chunkId`
    - Add `MapperError` kinds `option-evidence-missing`, `content-schema-invalid` and `concept-label-missing` (carrying `questionId` and `conceptId`); validate the entry with `parseCryptContentEntry` before returning; a missing or blank `conceptTitle` returns `concept-label-missing`; return no spec and no content on any of the three
    - For generated crypts the mapper fills `concepts` with one entry per conceptId of the manifest, each title taken from that concept's label
    - Update existing callers of `mapAuthoringQuestionToSpec` to the new signature and return type
    - Keep `option-evidence-missing` as a guard only: the sample file already gives every séance option its own evidence, so the guard is never expected to fire for it
    - Extend `manifest-mapper.test.ts`: content per question, no `optionId` on question-level excerpts, `option-evidence-missing` (tested with a synthetic séance question whose option has no evidence, not with the sample file), `content-schema-invalid`, `concept-label-missing` for an undefined and a blank `conceptTitle` (no spec, no content), a present title fills `concept`, no throw on malformed input
    - _Requirements: 6.4, 6.8, 6.10, 6.12, 6.14, 6.15, 6.16, 6.21, 6.24_

  - [x] 1.4 Return `{ manifest, content, chunks }` from `buildHumanHeartSampleCrypt`
    - In `packages/core/src/sample-crypt/human-heart.ts`, add `SampleCryptResult` (`manifest`, `content`, `chunks`); change `loadQuestion` to `loadMappedQuestion` returning `Result<MappedQuestion, SampleCryptError>`; for every primary, Alternate and reserved final-door question set `content.questions[questionId] = mapped.content` and `content.concepts[mapped.concept.conceptId] = { title }` next to each `lockSlots.push(...)` / `slots.push(...)`; return `maps.chunks` verbatim as `chunks`
    - Add a fixed `SAMPLE_CONCEPT_TITLES` table (conceptId to plain-text title) in `human-heart.ts` next to the fixed question selection and pass `SAMPLE_CONCEPT_TITLES[conceptId]` as `conceptTitle`; before returning, check that every conceptId of the manifest has an entry in `content.concepts` and return the `concept-label-missing` error (propagated as `SampleCryptError`, never thrown) on a gap
    - Do not edit `samples/questions/human-heart.json`: every séance option in it already carries its own evidence, its `status` stays "draft" so `isHumanReviewed` stays false, and the concept titles live in the table, not in the file
    - Update existing callers and tests of `buildHumanHeartSampleCrypt` to the new result shape; keep `human-heart.ts` under about 300 lines
    - Extend `human-heart.test.ts`: `content` passes `CryptContentSchema`; has an entry for every manifest Question_Id including Alternates and `hh-final-1` to `hh-final-3`; exactly one Option_Excerpt per séance payload option; the test reads the unedited `samples/questions/human-heart.json` and asserts every séance option carries its own evidence; `content.concepts` holds a title for both manifest conceptIds, equal to the `SAMPLE_CONCEPT_TITLES` entries; an in-memory copy of the questions JSON with a conceptId missing from the table returns `concept-label-missing`; every cited `chunkId` exists in `chunks`; `isHumanReviewed` is false; malformed input returns a typed error and never throws
    - _Requirements: 2.1, 6.5, 6.6, 6.7, 6.8, 6.10, 6.17, 6.22, 6.24, 25.11, 25.15_

  - [x] 1.5 Write the mapper completeness property test
    - Use `test-support/authoring-arbitraries.ts` to generate rune cipher and séance board questions with per-option evidence
    - Give every generated question a concept title; the property also asserts every conceptId of the manifest has a non-empty title in `content.concepts`; add a second case that removes one title and expects `concept-label-missing`
    - **Property 4: The mapper gives every question complete content**
    - **Validates: Requirements 6.4, 6.5, 6.6, 6.8, 6.14, 6.17, 6.21, 6.24**

  - [x] 1.6 Add the `Citation_Source` variant to `citationLabel`
    - Add `CITATION_COPY.sampleParagraph(n)` ("Paragraph N of the sample notes") to `packages/core/src/copy.ts`
    - Change `citationLabel(chunk, source: CitationSource = 'notes')` in `packages/core/src/citation-labeller.ts`; only the paste branch changes
    - Extend `citation-labeller.test.ts` with explicit `'sample'` and `'notes'` examples for paste, PDF and edited-PDF chunks
    - **Property 8: `citationLabel` source variants**
    - **Validates: Requirements 3.8, 3.9, 3.10, 3.11, 3.12, 25.12**

  - [x] 1.7 Add the room-play strings to `copy.ts`
    - Add: the sample-crypt line for "Enter the crypt" (generating from your own notes comes later; this is a sample crypt), the visible sample-crypt label, `ROOM_START_ERROR_COPY` (`{ what, next }` for `SampleCryptError`, `PublishManifestError` and start rejections, including the `concept-label-missing` kind), `FINAL_DOOR_STATUS_LABELS` (keyed by `SlotStatus`: "Not yet answered", "Solved", "Excluded from score", "Challenged: excluded from score"), the `ROOM_ANNOUNCEMENT_COPY` catalogue (one entry per Outcome_Notice kind `candleLit`, `ghostSpawned`, `ghostLaidToRest`, `sealCracked`, `roomCleared`, `escaped`; one per new slot status `solved`, `settled`, `challenged`; one per evidence result `correct` and `wrong`), `ESCAPE_COPY.message`, the final door button name text used by `doorButtonName()`, panel and button labels (including "Open the Autopsy" and "Play again"), empty-answer messages, "No hints left", the no-penalty line, "Not this time. Here's what your notes say.", "Source excerpt matched", "Challenged: excluded from score", ghost and Return_Slot name templates, the "This ghost returns later." line, and the unplayable-type message
    - Extend `copy.test.ts` so the banned-words test covers every new catalogue and string, including `ROOM_ANNOUNCEMENT_COPY`, `FINAL_DOOR_STATUS_LABELS`, `ESCAPE_COPY`, `ROOM_START_ERROR_COPY` and `CITATION_COPY.sampleParagraph`
    - _Requirements: 1.3, 1.4, 3.3, 3.5, 3.6, 3.7, 3.11, 14.3, 15.3, 16.3, 16.10, 17.7, 18.9, 19.2, 19.8, 19.9, 20.8, 20.11, 21.2, 21.3, 21.4, 21.5_

  - [x] 1.8 Export `FinalDoorSlotState` from the core runtime index
    - In `packages/core/src/runtime/index.ts` add `export type { FinalDoorSlotState }` next to the other slot types; no logic change to the runtime
    - Add `runtime/index-exports.test.ts`: a type-level test that imports `FinalDoorSlotState`, `LockSlotState` and `ReturnSlotState` from the runtime index and assigns an element of `State['finalDoor']['slots']` to `FinalDoorSlotState` (fails `pnpm typecheck` if the export is missing)
    - _Requirements: 4.11_

- [x] 2. Checkpoint - Core groundwork
  - Ensure all tests pass, ask the user if questions arise.

- [x] 3. Room_Binding (`apps/web/src/state/`)
  - [x] 3.1 Add `room-actions.ts` and `room-event-mapper.ts`
    - Define the `RoomAction` union and a pure mapper from each action (except `startRun` and `playAgain`) to exactly one runtime `Event`
    - Write `room-event-mapper.test.ts`: every action maps to one Event of the expected kind, including `enterRoom`
    - _Requirements: 4.4, 4.9_

  - [x] 3.2 Implement `stepBinding` in `room-binding-model.ts` with its property test
    - Define `BindingModel` and the pure `stepBinding(model, action)`: accepted appends one Event, replaces state and notices, clears rejection; rejected leaves log and state unchanged and sets `rejection`
    - Keep Draft_Answer values out of the model
    - Write `room-binding-model.test.ts` with examples for accept, reject and notices replaced rather than accumulated
    - **Property 1: The binding's state is the fold of its accepted events**
    - **Validates: Requirements 4.3, 4.5, 4.6**
    - _Requirements: 4.1, 4.2, 4.7, 4.8_

  - [x] 3.3 Add `room-assets.ts` with `buildFirstQuestionByConcept`
    - Create `apps/web/src/state/room-assets.ts` exporting the `RoomAssets` type (`content: CryptContent`, `chunks: ReadonlyMap<string, Chunk>`, `firstQuestionByConcept: Readonly<Record<string, string>>`) and the pure `buildFirstQuestionByConcept(manifest)`: walk the manifest's primary questions (first Lock_Slot question of each slot, in manifest order; never Alternates, never reserved final-door questions) and keep the first Question_Id seen for each conceptId
    - Write `room-assets.test.ts`: every conceptId of the sample manifest maps to the primary question of its first Lock_Slot; an Alternate or a reserved final-door question is never returned, even when it shares the concept; a synthetic manifest with several slots per concept keeps the first in manifest order; every conceptId of the manifest has an entry
    - _Requirements: 2.5, 2.6, 20.6, 25.16_

  - [x] 3.4 Implement `useRoomBinding` and `RoomAssets`
    - Create `room-binding.ts`: `useReducer` over `stepBinding`; `startRun` calls an injectable `buildCrypt` (default builds from `samples/human-heart.txt` and `samples/questions/human-heart.json` imported with Vite `?raw` and JSON imports, so no request leaves the origin), then applies `initial(manifest, { length: 'short', difficulty: 'apprentice', hintAllowance: 2 })` and the four start Events in order
    - On a build error or a rejected start Event set phase `start-failed` with the typed error and start no run
    - Read `manifest`, `content` and `chunks` from the `SampleCryptResult`; assemble `assets = { content, chunks, firstQuestionByConcept: buildFirstQuestionByConcept(manifest) }` once at crypt-build time with the `room-assets.ts` function of task 3.3 and hold it unchanged for the run; `playAgain` clears the log and reruns the start sequence against the same built crypt and the same assets
    - Write `room-binding.test.ts`: start sequence order and fixed settings, `buildCrypt` error (including a `concept-label-missing` error) and rejected start event, `playAgain` empties the log, `assets` (including `firstQuestionByConcept`) not reassigned between `startRun` and `playAgain`, drafts never reach `dispatch`, confirmed notes untouched
    - _Requirements: 1.5, 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 4.1, 4.2, 4.10, 5.1, 5.2, 5.3, 20.9_

  - [x] 3.5 Add the chosen-option selector and expose the event log from the binding
    - Create `apps/web/src/state/room-selectors.ts` with pure `chosenOptionFor(eventLog: readonly Event[], slotId: string): string | undefined`: it scans the log from the end and returns `selectedOptionId` from the submission of the latest accepted `AnswerSubmitted` event for that slot, and `undefined` when there is none or the submission has no string `selectedOptionId` (for example a rune cipher `{ text }`); it reads the submission through a small Zod schema, never throws and reads nothing from `State`
    - Expose the log from `useRoomBinding` as a read-only `eventLog: readonly Event[]` field next to `state`, `notices` and `rejection` (empty until a run starts); the log lives in the `BindingModel` held by `useReducer`, not in a ref, so a render that reads it is never stale. Components call `chosenOptionFor(eventLog, slotId)` themselves; the hook has no `chosenOptionId` method. Rejected actions are never in the log, so a rejected submission is never returned
    - State and the runtime are unchanged: slots keep `judgedResult` only and do not record the chosen option
    - Write `room-selectors.test.ts`: returns the id of the accepted séance submission; returns the latest one when a slot has several `AnswerSubmitted` events (retry, Return_Slot or Alternate); ignores events of other slots and other kinds; returns `undefined` for an empty log, a rune `{ text }` submission and a malformed submission; a rejected submission (absent from the log) is not returned; add a binding test that the exposed `eventLog` follows `dispatch` (grows on accepted actions, unchanged on rejected ones) and that `chosenOptionFor(eventLog, slotId)` over it returns the submitted option
    - _Requirements: 4.2, 4.3, 17.4, 17.15_

- [x] 4. Room screen with simple hotspot buttons (no layered art)
  - [-] 4.1 Add `accessible-names.ts` with table-driven tests
    - Pure functions for lock, ghost, Return_Slot, final door button and seal names, each stating status in words (for example "Rune tablet: rune cipher, unsolved")
    - Write `accessible-names.test.ts` over every `SlotStatus`
    - _Requirements: 10.3, 18.3, 18.7, 21.6_

  - [x] 4.2 Add `evidenceResult` in `evidence-text.ts`
    - Create `apps/web/src/features/crypt/evidence-text.ts` with the type `EvidenceResult = 'correct' | 'wrong' | null` and the pure `evidenceResult(slot: LockSlotState | ReturnSlotState | FinalDoorSlotState)`, importing all three slot types from the core runtime index (`FinalDoorSlotState` from task 1.8): a Lock_Slot gives `correct` or `wrong` from `judgedResult` and `null` for anything else; a Return_Slot and a Final_Door slot (no `judgedResult`) give `correct` for `solved`, `wrong` for `settled` and `null` for `challenged` and `open`
    - Write `evidence-text.test.ts`, table-driven: Lock_Slot `judgedResult` `correct`, `wrong`, `invalid` and `null`; Return_Slot and Final_Door slot (both `origin` values) for each of the four `SlotStatus` values, whatever else the slot holds
    - Task 7.1 adds `resolveExcerpt` and `orderExcerpts` to the same file
    - _Requirements: 17.2, 17.7, 21.5_

  - [x] 4.3 Add `announcements.ts`, `live-region.tsx` and the notice-to-announcement mapping
    - Create `announcements.ts` with the pure `announcementsFor(previous: State, next: State, notices: readonly Outcome_Notice[]): readonly string[]`, returning for one accepted dispatch, in this order: (1) one correct or not-correct message from `evidenceResult` when a slot's `evidencePanelOpen` turns true; (2) one message naming the new status for every Lock_Slot, Return_Slot or Final_Door slot whose `status` changed from `open` to `solved`, `settled` or `challenged`; (3) one message per Outcome_Notice (`candleLit`, `ghostSpawned`, `ghostLaidToRest`, `sealCracked`, `roomCleared`, `escaped`) in notice order; every message is a `ROOM_ANNOUNCEMENT_COPY` entry from `copy.ts`
    - Create `live-region.tsx`: the one `aria-live="polite"` region, showing one message at a time from a queue so two messages from one dispatch are not merged
    - Write `announcements.test.ts`, table-driven over every notice kind, every `open` to `solved`, `settled` or `challenged` change on a lock, return and final-door slot, and an Evidence_Panel opening with a correct and a not-correct result; an unchanged State with no notices (a rejected dispatch) gives no messages; every returned string equals a `ROOM_ANNOUNCEMENT_COPY` entry; ordering is evidence result, then status, then notices
    - Component tests for the live region: one polite region, queued messages shown one at a time
    - _Requirements: 21.1, 21.2, 21.3, 21.4, 21.5_

  - [x] 4.4 Build the simple `room-screen.tsx` and the base typography
    - Render one native button per Lock_Slot of the current room (no art), each at least 44 by 44 px with the focus outline `2px` in `--spectre-300` from `tokens.css`, ordered left to right by slot order
    - Show the remaining hint count from State, the visible sample-crypt label and the "Challenged: excluded from score" label on challenged locks
    - Activating a button of an open slot dispatches `LockOpened` and opens a panel slot; activating a solved, settled or challenged slot shows a short status text and dispatches no Event
    - Create `room-screen.css` referring to colours only through custom properties from `apps/web/src/styles/tokens.css` and to fonts only through `--font-body` (Crimson Pro) and `--font-title` (Cinzel): question, option, excerpt and explanation text uses `--font-body` at `font-size: 1.125rem` by default and `1rem` inside the phone media query for the Phone_Viewport; `--font-title` on headings and titles only; no hex or `rgb(` literal, no `@import`, no `url(http`
    - Component tests for all of the above
    - _Requirements: 1.6, 3.5, 5.4, 8.6, 10.1, 10.2, 10.3, 10.6, 10.9, 10.10, 21.7, 22.3, 22.4_

  - [x] 4.5 Build `crypt-flow.tsx` and the error boundary
    - Own `useRoomBinding`; route to the start view, the `start-failed` message built from `ROOM_START_ERROR_COPY`, `<RoomScreen>` while `state.status` is `in progress` and `!state.atFinalDoor`, `<FinalDoor>` while `state.atFinalDoor` and the status is not `escaped`, `<FinalDoor escaped>` (the escape view) while the status is `escaped` and the Autopsy has not been requested, and `<AutopsyView>` only while the status is `escaped` and the Autopsy has been requested
    - Hold the "Autopsy requested" flag as a local `useState<boolean>` that holds no game state: set by the escape view's "Open the Autopsy" button, cleared when `playAgain` is dispatched so a new run starts in room 1 with no Autopsy showing
    - Keep the previous `State` in a `useRef` and, in an effect on each accepted dispatch, call `announcementsFor(previous, state, notices)` and feed the result to `live-region.tsx`; a rejected dispatch announces nothing
    - Wrap in a React error boundary that logs only `error.name` and the component stack
    - Until tasks 9.3, 9.4 and 10.2 build the final door, escape view and Autopsy, route those cases to minimal stand-in components that those tasks replace
    - Component tests for each route, the start-failed message, the flag being set and cleared, and announcements fed once per accepted dispatch
    - _Requirements: 2.2, 5.3, 19.9, 19.10, 20.1, 20.2, 20.9, 21.2, 21.3, 21.4, 21.5_

- [ ] 5. Rune and séance panels (keyboard operable, no drag)
  - [ ] 5.1 Build the `question-panel.tsx` shell
    - Panel with heading, focus moved into it on open, focus returned to the opening control on close, Escape closing with no Event while no judged answer waits for Continue, panel keyed by `slotId:currentQuestionId` so the draft resets on a question change
    - Choose the lock panel by Current_Question_Type
    - Accept a `side: 'left' | 'right'` prop (ignored by the plain loop, used for placement in task 14.11) so the room screen and the final door share this one shell with its Evidence_Panel and hint, skip and challenge controls
    - Put the panel CSS in a file that uses only `tokens.css` custom properties and the `--font-body` sizes of task 4.4
    - Component tests for focus in, focus back, Escape keeps the draft, and no Event on Escape
    - _Requirements: 10.7, 10.8, 13.5, 14.6, 15.5_

  - [ ] 5.2 Build `rune-cipher-panel.tsx`
    - Prompt as plain text, labelled text input, "Submit answer" button and Enter key; dispatch `AnswerSubmitted` with `{ text }`; empty after trim shows the ask-for-answer message with no Event; `invalid-submission` rejection shows the message, keeps the draft and keeps the slot open
    - Show the first letter and answer length while the Applied_Hint is `reveal-first-letter`
    - Component tests including keyboard-only submit
    - _Requirements: 14.1, 14.2, 14.3, 14.4, 14.5, 14.6, 14.7, 22.1, 22.2_

  - [ ] 5.3 Build `seance-board-panel.tsx`
    - Prompt as plain text; options as radio inputs in manifest `payload.optionIds` order inside a labelled group; arrow keys move between options; "Submit answer" dispatches `AnswerSubmitted` with `{ selectedOptionId }`; no choice shows the choose-an-option message with no Event
    - The panel keeps the draft choice locally and does not read or record the chosen option afterwards; the chosen option is later derived from the event log by `chosenOptionFor(eventLog, slotId)` selector over the binding's read-only `eventLog` (task 3.5)
    - Show a removed option with a text label and disable it while the Applied_Hint is `remove-option`
    - Component tests including option order from the payload and keyboard-only choice
    - _Requirements: 6.7, 15.1, 15.2, 15.3, 15.4, 15.5, 15.6, 15.7, 22.1, 22.2_

  - [ ] 5.4 Wire the panels into the room screen
    - Show the Question_Panel for the opened slot using prompt, options and hint data from `RoomAssets.content` and State
    - Component test: open a rune lock, submit correct text, State shows the slot judged
    - _Requirements: 10.6, 14.1, 15.1, 21.7_

- [ ] 6. Hint, Skip and Challenge
  - [ ] 6.1 Add the Hint, Skip and Challenge controls to the Question_Panel
    - "Hint" dispatches `HintUsed`; disabled with "No hints left" at 0 and while the question already has an Applied_Hint; show the remaining count next to it; "Skip" dispatches `Skipped` and closes the panel; "Challenge" dispatches `Challenged`; show the no-penalty line; send nothing to any server
    - Component tests for each control, disabled states and no network call
    - _Requirements: 16.1, 16.2, 16.3, 16.4, 16.5, 16.6, 16.7, 16.10, 16.11_

  - [ ] 6.2 Handle `sealCracked` in the panel and room screen
    - On `sealCracked` for an `open` slot show the Alternate question, clear the draft and move focus to the panel heading; for a `challenged` slot close the panel and show "Challenged: excluded from score" on that lock
    - Component tests for both outcomes using fixture notices
    - _Requirements: 16.8, 16.9, 3.5_

- [ ] 7. Evidence panel
  - [ ] 7.1 Add `evidence-text.ts` with `resolveExcerpt` and `orderExcerpts`
    - Extend `evidence-text.ts` (created in task 4.2 with `evidenceResult`) with `resolveExcerpt` and `orderExcerpts`
    - `resolveExcerpt(assets, excerpt, 'sample')` returns `{ quote, citationLabel, matched }` using `resolveQuote` and `citationLabel`; total for an unknown `chunkId`
    - `orderExcerpts(excerpts, chosenOptionId?, keyOptionId?)` works on indices so each excerpt appears once: chosen Option_Excerpt, key Option_Excerpt, then the rest in stored order
    - Its inputs come from outside `State` and `Crypt_Content`: `chosenOptionId` from `chosenOptionFor(eventLog, slotId)` in `room-selectors.ts` (the latest accepted `AnswerSubmitted` for that slot in the binding's `eventLog`), `keyOptionId` from the manifest payload
    - Unit tests for `resolveExcerpt` (matched and unmatched) and for `orderExcerpts` examples (chosen is key, non-séance, missing option excerpt)
    - **Property 10: Séance evidence ordering shows each excerpt once, chosen first, then key**
    - **Validates: Requirements 17.3, 17.4, 17.13, 17.14, 17.16**
    - _Requirements: 3.3, 3.4, 3.9, 6.9, 17.15_

  - [ ] 7.2 Build `evidence-panel.tsx`
    - Show the result as text and an icon, the chosen and key option texts for séance questions (chosen option ID from `chosenOptionFor(eventLog, slotId)` over the binding's read-only `eventLog`, because State records only `judgedResult`; key from the manifest payload; both option texts looked up in `Crypt_Content` `options`; no chosen option shown when the selector returns `undefined`), every ordered excerpt once with its Citation_Label and "Source excerpt matched" only when matched, the explanation, a kind opening sentence for wrong answers, and a "Continue" button; offer no second submission
    - Result text and icon: call `evidenceResult(slot)` from task 4.2 for a Lock_Slot, a Return_Slot and a Final_Door slot alike; show the result text and icon only when it is not `null`, and open with the kind "Not this time" sentence only when it returns `wrong`; a challenged Return_Slot or Final_Door slot shows neither (the "Challenged: excluded from score" label only)
    - Component tests for the result text per slot kind: Lock_Slot `judgedResult` correct and wrong; Return_Slot and Final_Door slot `solved` (correct text), `settled` (wrong text and kind sentence) and `challenged` (no result text)
    - Component tests: matched and unmatched excerpt labels, wrong-answer opening, option texts (chosen option taken from a fixture event log through `chosenOptionFor`), excerpt order chosen first, no answer controls, no Citation_Label ending in "of your notes"
    - _Requirements: 3.3, 3.4, 3.12, 17.2, 17.3, 17.4, 17.5, 17.6, 17.7, 17.8, 17.11, 17.15, 21.7, 22.1_

  - [ ] 7.3 Wire the Evidence_Panel into the room screen
    - Show it when State has `evidencePanelOpen` for a slot; move focus into it; "Continue" dispatches `EvidenceContinued`, closes it and returns focus to the slot's button or to the next available control
    - Component tests for focus in, Continue dispatch and focus return
    - _Requirements: 17.1, 17.9, 17.10, 17.12_

- [ ] 8. Checkpoint - Playable loop through evidence
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 9. Return slots, ghosts, final door and escape
  - [ ] 9.1 Add ghost assignment and the simple ghost list
    - Pure `assignGhostAnchors(ghosts, anchorCount)` using `index modulo anchorCount` with a table-driven test
    - Render each pending ghost as text with its return number and, when not yet due, "This ghost returns later."; ghosts use `pointer-events: none`
    - Show lit Spirit_Candles as a small text and flame marker
    - Component tests
    - _Requirements: 18.1, 18.2, 18.3, 18.6, 18.9, 18.10_

  - [ ] 9.2 Add Return_Slot controls
    - Separate buttons for due Return_Slots with names that state a returning question and "Review" when `label` is "review"; they open the Question_Panel and leave lock controls unchanged
    - Component tests
    - _Requirements: 18.7, 18.8_

  - [ ] 9.3 Build `final-door.tsx` and `unplayable-panel.tsx`
    - Create `final-door.tsx`, reading only `selectFinalDoor(state)`, `State.atFinalDoor` and `State.status` and adding no game rule: closed door with no control while `selectFinalDoor(state).available` is false; one native button to open it when available (name from `doorButtonName()` in `accessible-names.ts`, text from `copy.ts`) dispatching `FinalDoorEntered`
    - At the final door draw one seal per `State.finalDoor.slots` entry, in slot order (a plain list in this plain-loop task; task 14.10 positions them with `sealPoints`), each with a visible text label from `FINAL_DOOR_STATUS_LABELS`, drawn broken when solved, settled or challenged, with an accessible name stating the status in words
    - A native control per open slot opens its Question_Panel through the shared `question-panel.tsx` (passing `side="right"`), so the Evidence_Panel, hint, skip and challenge controls and ghost drawing are the same as in a room, with no second copy
    - Create `unplayable-panel.tsx` for a slot whose Current_Question_Type has no panel: shows the not-playable message and offers only "Skip"
    - Component tests for each state: closed door, enter button and dispatch, seals per status with labels, slot control opening the shared panel with `side="right"`, and the unplayable fallback
    - _Requirements: 19.1, 19.2, 19.3, 19.4, 19.5, 19.6, 19.7, 19.8, 21.6_

  - [ ] 9.4 Add the escape view with the Autopsy button
    - In `final-door.tsx` add the `escaped` mode (`<FinalDoor escaped>`): show the escape message from `ESCAPE_COPY.message` and one "Open the Autopsy" button; render no slot button, no Question_Panel and no hint, skip or challenge control, so none can be sent once State is `escaped` (the runtime also rejects them)
    - The button sets the local "Autopsy requested" flag held in `crypt-flow.tsx` (task 4.5); the flag is cleared when `playAgain` is dispatched, so a new run starts in room 1 with no Autopsy showing
    - Replace the escape-view stand-in of task 4.5; art for the open door and `light-door.webp` arrives in task 14.10
    - Component tests: the escape view shows the message and the button and no controls; activating the button shows the Autopsy; `playAgain` clears the flag and returns to room 1
    - _Requirements: 19.9, 19.10, 20.1, 20.9_

  - [ ] 9.5 Write the termination policy test
    - Extend `room-binding-model.test.ts`: drive `stepBinding` from the run-start model with four fixed policies — answer every open slot wrong, skip every open slot, challenge every open slot, and rotate wrong, skip and challenge — re-reading the open slots after each step and entering the final door when `selectFinalDoor(state).available` is true
    - Reuse the loop in `packages/core/src/test-support/escape-driver.ts`; each policy reaches `status === 'escaped'` within the prompt bound that the room-runtime spec states, and every action dispatched after `escaped` is rejected and leaves `State` and the `eventLog` unchanged
    - _Requirements: 19.10, 19.11, 18.4, 18.5_

- [ ] 10. Autopsy with Final door section
  - [ ] 10.1 Add `autopsy-titles.ts` with `withConceptTitles`
    - Create `apps/web/src/features/crypt/autopsy-titles.ts` with the type `AutopsyEntryView` (`AutopsyEntry` plus `title`) and the pure `withConceptTitles(entries, content)`: each entry becomes `{ ...entry, title: content.concepts[entry.conceptId].title }`, keeping entry order; a missing title falls back to the `conceptId` so the entry still shows; the runtime's `AutopsyEntry` and `autopsy-selector.ts` stay unchanged
    - Write `autopsy-titles.test.ts`: every entry gets its `content.concepts` title; order is kept; a missing title falls back to the conceptId; a title containing markup characters is returned as the same plain string
    - _Requirements: 20.3, 20.10, 22.1_

  - [ ] 10.2 Build `autopsy-view.tsx` for concepts and counts
    - Built from `selectAutopsy(state)`: entries passed through `withConceptTitles(view.entries, content)`, one per `State.concepts`, each shown as the concept title (plain React text) and the label from `AUTOPSY_LABELS`; the five outcome counts read from `view.counts`; shown only when State is `escaped`
    - Draw each outcome as an icon and its text label side by side: small inline SVG components in this file, one per `ConceptOutcome`, with `aria-hidden="true"` because the text carries the meaning; a concept whose outcome is `challenged` shows the "excluded from the score" statement
    - Excerpt link per entry: on activation read `assets.firstQuestionByConcept[entry.conceptId]`, take `content.questions[questionId].excerpts[0]` and call `resolveExcerpt(assets, excerpt, 'sample')`, showing the quote with its "Paragraph N of the sample notes" label; it reads no manifest and runs no search at click time
    - A "Play again" button that dispatches `playAgain`, which starts a new run with an empty Event_Log
    - Replace the Autopsy stand-in of task 4.5
    - Component tests: one entry per concept with its title and `AUTOPSY_LABELS` label, five counts, icons present and `aria-hidden`, the excerpt link shows the first excerpt of the first question of that concept with a sample label, challenged statement, Play again dispatches `playAgain`, no Banned_Phrases
    - _Requirements: 20.1, 20.2, 20.3, 20.4, 20.5, 20.6, 20.7, 20.8, 20.9, 20.10, 22.1_

  - [ ] 10.3 Add the Final_Door_Section
    - List each `State.finalDoor.slots` question with its prompt from `content.questions[slot.currentQuestionId].prompt` and a status label from `FINAL_DOOR_STATUS_LABELS` as text and an icon (inline SVG, one per `SlotStatus`, `aria-hidden="true"`); state "excluded from the score" for `settled` and `challenged`; `open` stays handled for totality although an escaped run cannot hold it
    - Component tests across every status, prompts as plain text, and icon plus label for each
    - _Requirements: 20.10, 20.11, 20.12, 20.13, 22.1_

- [ ] 11. Sample labels and "Enter the crypt" entry
  - [ ] 11.1 Add the "Enter the crypt" step after the notes preview
    - In `apps/web/src/app.tsx` show the "Enter the crypt" button after notes are confirmed, with the sample-crypt line from `copy.ts` beside it; activating it starts the run and shows room 1; confirmed notes stay unchanged and unused by the run; a reload returns to the notes preview with no run
    - Component tests for the button, the line, the start and the reload behaviour
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 4.10_

  - [ ] 11.2 Add the honest-label checks
    - Show the visible sample-crypt label during the run; add a component test that renders every screen (start, room, panels, evidence, final door, Autopsy) and asserts no "Human-reviewed", no "Blind model review passed", no Banned_Phrases and no Citation_Label ending in "of your notes"
    - The static source checks (`dangerouslySetInnerHTML`, colour literals, fonts, text sizes) live in task 11.3
    - _Requirements: 1.6, 3.1, 3.2, 3.6, 3.12_

  - [ ] 11.3 Add the typography and tokens source test
    - Write `apps/web/src/features/crypt/crypt-css.test.ts`: read every CSS and TSX source under `apps/web/src/features/crypt/` (found by glob, so files added in group 14 are covered) and fail on a hex or `rgb(` colour literal outside `tokens.css`, an `@import` or `url(http` reference or any other origin, any `dangerouslySetInnerHTML`, a `font-family` other than the `--font-body` and `--font-title` tokens, `--font-title` on a question, option, excerpt or explanation selector, and a `font-size` below `1.125rem` on the question-text selectors (below `1rem` inside the phone media query)
    - Include one positive case: the shipped `room-screen.css` and panel CSS pass
    - Re-run in the group 15 and 17 checkpoints, since group 14 adds CSS files
    - _Requirements: 22.2, 22.3, 22.4_

- [ ] 12. Playwright play-through, keyboard path and axe
  - [ ] 12.1 Add the e2e helpers
    - Create `apps/web/e2e/` helpers that build the Sample_Crypt manifest and read correct answers from it (no AI provider), enter the crypt from the notes preview, and answer a slot by lock type
    - _Requirements: 25.10_

  - [ ] 12.2 Playwright: all answers correct
    - Play from "Enter the crypt" through every Evidence_Panel and the final door to the Autopsy; assert the two concept entries carry labels from `AUTOPSY_LABELS` and the Final_Door_Section lists every door question with a final status
    - _Requirements: 25.1_

  - [ ] 12.3 Playwright: all answers wrong
    - Answer every question wrong; assert ghosts appear and return at the final door, the final door is reached and the escape happens
    - _Requirements: 25.2, 19.11_

  - [ ] 12.4 Playwright: keyboard-only path and focus
    - Play with the keyboard only, including a hint, a skip and a challenge; assert focus moves into each panel and returns to the opening control
    - _Requirements: 25.3, 25.4, 10.7, 10.8, 17.10, 17.12_

  - [ ] 12.5 Playwright: axe on four screens
    - Run axe on the Room_Screen with the Question_Panel open, with the Evidence_Panel open, at the final door and on the Autopsy; expect no violations
    - _Requirements: 25.5_

  - [ ] 12.6 Playwright: labels, citations and network
    - Assert "Human-reviewed" and "Blind model review passed" appear nowhere during a run; every Citation_Label shown reads "Paragraph N of the sample notes"; no request goes to another origin
    - _Requirements: 25.7, 25.9, 25.14, 3.1, 3.2, 3.12, 2.3_

- [ ] 13. Checkpoint - Plain playable loop complete
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 14. Layered art, geometry, candles, light and motion
  - [ ] 14.1 Add `art-room.ts` with its property test
    - `artRoomForPosition(position)` returns `burial-chamber`, `library-of-bones` or `sunken-chapel` for 1, 2 and 3 and `null` otherwise; the room screen finds the position from `State.rooms` and never reads `roomId` for the art choice
    - **Property 2: The Art_Room is chosen by room position only**
    - **Validates: Requirements 7.1, 7.2, 24.3**

  - [ ] 14.2 Add `scene-types.ts` and `scene-loader.ts`
    - Zod `SceneFile` schema mirroring section 4 of `docs/art/asset-contract.md` (`desktop`, optional `mobile`, locks, `ambientCandles`, `ghostAnchors`, `door`, `parallax`); loader returns a typed `Result`
    - Unit tests for a valid file, a missing field and a malformed file
    - _Requirements: 7.3, 23.3_

  - [ ] 14.3 Add `hotspot-geometry.ts` with property tests
    - `MIN_HIT_PX`, `hotspotBox`, `stackOrder`, `tabOrder` and `sealPoints(polygon, count)` as pure functions in `apps/web/src/features/crypt/hotspot-geometry.ts`; `sealPoints` intersects a horizontal scan line at the polygon's centroid height with the polygon (using the nearest height that crosses the interior when the centroid is outside a concave polygon), takes the widest interior interval and returns `count` points at fractions `(i + 1) / (count + 1)` along it
    - Write `hotspot-geometry.test.ts`: `sealPoints` returns exactly `count` points for counts 0 to 8, each inside a convex polygon and inside a concave L-shaped polygon, in left-to-right order; examples for `stackOrder` and `tabOrder` (stable, input not mutated)
    - **Property 5: A hotspot box is never smaller than 44 by 44 px**
    - **Validates: Requirements 10.2, 11.6**
    - **Property 6: Stacking order follows depth and tab order follows x**
    - **Validates: Requirements 10.4, 10.5**
    - _Requirements: 19.4_

  - [ ] 14.4 Add `crop-mapping.ts` with its property test
    - `hotspotUnionBounds` and `mapCropPoint` under `object-fit: cover` centred on the union of drawn hotspots; add a unit test with fixed examples
    - **Property 7: Crop_Mapping keeps hotspot-union points inside the viewport**
    - **Validates: Requirements 11.3, 11.5, 24.4**
    - _Requirements: 11.4_

  - [ ] 14.5 Add `lantern-setting.ts` with its property test
    - `resolveLanternMode(stored, prefersReducedMotion)` plus guarded `localStorage` read and write under one key, each inside try/catch; a throwing write keeps the session value silently; nothing but the Lantern_Setting is stored
    - Unit tests for write path, throwing read, throwing write and unrecognised values
    - **Property 9: The Lantern setting falls back to the reduced-motion default**
    - **Validates: Requirements 12.3, 12.9, 12.10**
    - _Requirements: 12.8, 12.11, 12.12, 25.13_

  - [ ] 14.6 Add `art-failure-log.ts`
    - One `console.error` per distinct file per room mount, logging only the file name and error type, tracked in a `Set`
    - Unit tests for single logging and for the logged payload holding no learner content
    - _Requirements: 23.1, 23.4_

  - [ ] 14.7 Build the layered stack in `lock-layer.tsx` and the room screen
    - Stack background, one Lock_Layer per drawn lock, Light_Passes, door layer and foreground at 0,0 in that order; use `background@2x.webp` on high-DPI; draw a lock only when the room has a Lock_Slot of that type; empty `alt` on every art layer; `lockImageFile` and `shouldDrawFlame` as pure functions
    - On Scene_File failure or an art `onError`, use `art-failure-log.ts`, draw nothing for that file and fall back to the simple button list of group 4 with the same accessible names
    - Table-driven tests for `lockImageFile` and `shouldDrawFlame` over every `SlotStatus`, `candleLit` and hover value; component tests for layer order, absent lock types and failure fallback
    - _Requirements: 7.3, 7.4, 7.5, 7.6, 7.7, 8.1, 8.2, 8.6, 9.1, 23.1, 23.2, 23.3_

  - [ ] 14.8 Position the Hotspot_Buttons and add phone framing
    - Place each native button over its `hotspot` polygon using `hotspotBox`, emit in `tabOrder`, stack by `stackOrder`; add hover and focus crossfade to the `-hover` image over 200 ms with no interaction depending on hover
    - On a Phone_Viewport use the `mobile` block when present, else crop the desktop art with `mapCropPoint` for every hotspot, candle, ambient candle, Ghost_Anchor and door coordinate, keeping every button at least 44 by 44 px
    - Component tests for order, size and crop use
    - _Requirements: 8.3, 8.4, 10.1, 10.2, 10.4, 10.5, 11.1, 11.2, 11.3, 11.6_

  - [ ] 14.9 Add flames, ambient candles and light passes
    - Create `flame.tsx` (code-drawn gold flame, short flare then gentle flicker, no teal); ambient candles from the first frame; on a `candleLit` notice fade the Light_Pass in over about 600 ms and crossfade the lock to `-solved`; light passes composited with `plus-lighter` and a `screen` fallback; a room drawn from State with a lit candle shows flame and light at once with no animation; settled and challenged locks draw no flame and no light
    - Component tests for animated and steady-state drawing and for settled locks
    - _Requirements: 8.5, 8.6, 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 9.7, 9.8_

  - [ ] 14.10 Position ghosts, spirit candles, door layers and seals
    - Draw ghosts at Ghost_Anchors using `assignGhostAnchors` and the crop mapping, with the rise on `ghostSpawned` and a fade on `ghostLaidToRest`; draw Spirit_Candle flames with no Light_Pass; crossfade `door-closed.webp` to `door-open.webp` and fade `light-door.webp` in on `roomCleared`; replace the plain seal list of `final-door.tsx` by seals drawn at the points returned by `sealPoints(doorPolygonInViewportPx, State.finalDoor.slots.length)` (door polygon mapped through the crop mapping), so every seal is inside the door `hotspot` polygon, with the open door (`door-open.webp`) and `light-door.webp` in the escape view; all ghost layers `pointer-events: none` and never covering controls
    - Component tests for anchor use and door transitions
    - _Requirements: 18.1, 18.2, 18.4, 18.5, 18.6, 18.10, 18.11, 19.4_

  - [ ] 14.11 Add panel placement and the lock close-up
    - Open the Question_Panel on the lock's `panelSide` (right side at the final door); show `locks/<lock>/closed.webp` behind it for an open slot and `locks/<lock>/open.webp` for a solved slot; keep the panel fully lit with text contrast of at least 4.5:1; full width on a Phone_Viewport; keep the question-text typography of task 4.4 (Crimson Pro at `1.125rem`, `1rem` on phones) in any new CSS, which `crypt-css.test.ts` from task 11.3 checks
    - Component tests for side, image and phone width
    - _Requirements: 13.1, 13.2, 13.3, 13.4, 19.6, 22.3, 22.4_

  - [ ] 14.12 Add motion, reduced motion and the lantern control
    - Parallax of a few pixels following the Scene_File `parallax` factors on pointer or tilt; with `prefers-reduced-motion: reduce` turn off parallax and flicker and make crossfades instant, and start in Lantern_Mode unless a stored setting exists; create `lantern-toggle.tsx`; in Lantern_Mode drop darkness, vignette, grain and mist overlays and show every layer fully lit; all atmosphere layers `pointer-events: none` and never covering a panel; no flashing, jump scare or screen shake
    - Component tests for reduced-motion behaviour, the toggle writing the setting and overlays removed
    - _Requirements: 12.1, 12.2, 12.3, 12.4, 12.5, 12.6, 12.7, 12.8, 12.9, 12.10_

- [ ] 15. Checkpoint - Layered art and motion
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 16. Art tests and reduced-motion checks
  - [ ] 16.1 Unit test: every Scene_File file exists
    - For each Art_Room, assert every file named by its `scene.json` exists under `apps/web/public/art/rooms/<art-room>/`, and for every lock all four Lock_Layers and the Light_Pass exist
    - _Requirements: 24.1, 24.2_

  - [ ] 16.2 Unit test: absent lock types draw nothing
    - A lock type absent from the current room draws no Lock_Layer, Light_Pass or Hotspot_Button; the Art_Room is chosen by position and not by `roomId`
    - _Requirements: 24.3, 24.8, 7.6_

  - [ ] 16.3 Playwright: hover and focus swap
    - Hovering and focusing a Hotspot_Button swaps its lock layer to the `-hover` image and back on leave and blur
    - _Requirements: 24.5, 8.3_

  - [ ] 16.4 Playwright: light pass and flame on solve
    - Solving a lock adds its Light_Pass and Flame; a settled lock adds neither
    - _Requirements: 24.6, 8.6, 9.1, 9.2, 9.3_

  - [ ] 16.5 Playwright: missing art file
    - Route one art file to a failure; assert one console message for that file, no learner content in it, and that the game stays playable
    - _Requirements: 24.7, 23.1, 23.2, 23.4_

  - [ ] 16.6 Playwright: reduced motion
    - With `prefers-reduced-motion: reduce` assert Lantern_Mode is on, no parallax transform or flicker animation runs and crossfades are instant
    - _Requirements: 25.6, 12.2, 12.3, 12.4_

  - [ ] 16.7 Playwright: lantern setting and phone viewport
    - Assert the Lantern_Setting survives a page reload; on a Phone_Viewport assert every drawn Hotspot_Button is at least 44 by 44 px and a lock can be opened and answered
    - _Requirements: 25.8, 25.13, 11.6, 12.8, 12.9_

- [ ] 17. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- All tasks are required; none is marked optional.
- Property tests sit in the same task as the code they test and cite the design property number. Properties covered: 1 (3.2), 2 (14.1), 3 (1.2, including concept titles), 4 (1.5, including concept titles and `concept-label-missing`), 5 and 6 (14.3), 7 (14.4), 8 (1.6), 9 (14.5), 10 (7.1).
- Table-driven and example tests sit next to their code: `evidenceResult` (4.2), `announcementsFor` (4.3), `buildFirstQuestionByConcept` (3.3), `chosenOptionFor` (3.5), `withConceptTitles` (10.1), `sealPoints` (14.3), the termination policies (9.5) and the CSS source check (11.3).
- Each task lists the granular requirement clauses it covers. Requirements 24 and 25 are covered by groups 12 and 16 and by the test sub-tasks named in them.
- Groups 4 to 11 use plain buttons so the loop is playable without art. Group 14 replaces them with the layered scene and keeps the plain list as the Scene_File and art failure fallback (Requirement 23.3).
- Tests call no real AI provider and read correct answers from the Sample_Crypt manifest.
- Spec 4 owns saving runs and persisting Crypt_Content; no task here writes run data to storage beyond the Lantern_Setting.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2", "1.3", "1.8"] },
    { "id": 2, "tasks": ["1.4", "1.6"] },
    { "id": 3, "tasks": ["1.5", "1.7"] },
    { "id": 4, "tasks": ["2"] },
    { "id": 5, "tasks": ["3.1", "3.3"] },
    { "id": 6, "tasks": ["3.2"] },
    { "id": 7, "tasks": ["3.4"] },
    { "id": 8, "tasks": ["3.5", "4.1", "4.2"] },
    { "id": 9, "tasks": ["4.3", "4.4"] },
    { "id": 10, "tasks": ["4.5"] },
    { "id": 11, "tasks": ["5.1"] },
    { "id": 12, "tasks": ["5.2", "5.3", "7.1"] },
    { "id": 13, "tasks": ["5.4", "7.2"] },
    { "id": 14, "tasks": ["6.1"] },
    { "id": 15, "tasks": ["6.2"] },
    { "id": 16, "tasks": ["7.3"] },
    { "id": 17, "tasks": ["8"] },
    { "id": 18, "tasks": ["9.1", "9.5", "10.1"] },
    { "id": 19, "tasks": ["9.2"] },
    { "id": 20, "tasks": ["9.3"] },
    { "id": 21, "tasks": ["9.4"] },
    { "id": 22, "tasks": ["10.2"] },
    { "id": 23, "tasks": ["10.3"] },
    { "id": 24, "tasks": ["11.1"] },
    { "id": 25, "tasks": ["11.2"] },
    { "id": 26, "tasks": ["11.3"] },
    { "id": 27, "tasks": ["12.1"] },
    { "id": 28, "tasks": ["12.2", "12.3", "12.4"] },
    { "id": 29, "tasks": ["12.5", "12.6"] },
    { "id": 30, "tasks": ["13"] },
    { "id": 31, "tasks": ["14.1", "14.2", "14.3", "14.4", "14.5", "14.6"] },
    { "id": 32, "tasks": ["14.7"] },
    { "id": 33, "tasks": ["14.8"] },
    { "id": 34, "tasks": ["14.9"] },
    { "id": 35, "tasks": ["14.10"] },
    { "id": 36, "tasks": ["14.11"] },
    { "id": 37, "tasks": ["14.12"] },
    { "id": 38, "tasks": ["15"] },
    { "id": 39, "tasks": ["16.1", "16.2", "16.3", "16.4", "16.5", "16.6", "16.7"] },
    { "id": 40, "tasks": ["17"] }
  ]
}
```
