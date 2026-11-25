# Implementation Plan: Room Play

## Overview

Implementation is TypeScript throughout (strict, Node 22, Vitest, fast-check, Playwright, axe). The plan builds a plain playable loop first (groups 1 to 13) and adds the layered art, motion and art tests afterwards (groups 14 to 17).

- Groups 1 to 2: core groundwork in `packages/core` (Crypt_Content, mapper handoff, builder result, citation labeller source variant, copy).
- Group 3: the Room_Binding in `apps/web/src/state/`.
- Groups 4 to 11: the playable loop with simple hotspot buttons (no layered art): room screen, rune and séance panels, hint/skip/challenge, evidence, ghosts, final door, escape, Autopsy and the honest "Enter the crypt" entry.
- Group 12: Playwright play-throughs, keyboard path and axe.
- Groups 14 to 16: layered art by room order, geometry, candles and light, motion, reduced motion, lantern setting, then the art tests.

Every task is required. Property tests sit next to the code they test and cite the design property by number. No task adds the label "Human-reviewed" or "Blind model review passed", and no task calls an AI provider.

## Tasks

- [ ] 1. Core groundwork for the loop (`packages/core`)
  - [ ] 1.1 Add the Crypt_Content type and Zod schema
    - Create `packages/core/src/mapper/crypt-content.ts` with `CryptContentExcerptSchema`, `CryptContentEntrySchema` (strict object, `superRefine` that an `optionId` must name an option of the same entry), `CryptContentSchema` and `parseCryptContentEntry` returning a typed `Result` with `CryptContentSchemaError`
    - Define no answer-key field anywhere; export the inferred types
    - Write `crypt-content.test.ts`: accepts a valid entry; rejects an extra `answer` or `key` field; rejects empty `excerpts`; accepts an excerpt without `optionId`; rejects an `optionId` that `options` does not hold and an `optionId` on an entry with no `options`; `parseCryptContentEntry` never throws on malformed input
    - _Requirements: 6.1, 6.2, 6.3, 6.10, 6.12, 6.13_

  - [ ] 1.2 Add `cryptContentArb` and write the round-trip property test
    - Add `cryptContentArb` to `packages/core/src/test-support/` next to `arbitraries.ts`; build `options` first and draw each `optionId` from them
    - **Property 3: Crypt_Content survives a JSON round trip, including `optionId`**
    - **Validates: Requirements 6.11, 6.18**

  - [ ] 1.3 Change the Manifest_Mapper to hand off Crypt_Content
    - In `packages/core/src/mapper/manifest-mapper.ts`, make `mapAuthoringQuestionToSpec` return `Result<MappedQuestion, MapperError>` with `{ spec, content }`
    - Build question-level excerpts without `optionId`; for séance questions build one Option_Excerpt per option from that option's own evidence, in option order, resolved through `maps.chunksByParagraph`
    - Build `evidenceRefs` from the same excerpts so every `evidenceRefs` ID appears as an excerpt `chunkId`
    - Add `MapperError` kinds `option-evidence-missing` and `content-schema-invalid`; validate the entry with `parseCryptContentEntry` before returning; return no spec and no content on either error
    - Update existing callers of `mapAuthoringQuestionToSpec` to the new return type
    - Keep `option-evidence-missing` as a guard only: the sample file already gives every séance option its own evidence, so the guard is never expected to fire for it
    - Extend `manifest-mapper.test.ts`: content per question, no `optionId` on question-level excerpts, `option-evidence-missing` (tested with a synthetic séance question whose option has no evidence, not with the sample file), `content-schema-invalid`, no throw on malformed input
    - _Requirements: 6.4, 6.8, 6.10, 6.12, 6.14, 6.15, 6.16_

  - [ ] 1.4 Return `{ manifest, content, chunks }` from `buildHumanHeartSampleCrypt`
    - In `packages/core/src/sample-crypt/human-heart.ts`, add `SampleCryptResult`; change `loadQuestion` to `loadMappedQuestion`; collect `content[questionId]` for every primary, Alternate and reserved final-door question; return `maps.chunks` verbatim as `chunks`
    - Do not edit `samples/questions/human-heart.json`: every séance option in it already carries its own evidence, and its `status` stays "draft" so `isHumanReviewed` stays false
    - Update existing callers and tests of `buildHumanHeartSampleCrypt` to the new result shape
    - Extend `human-heart.test.ts`: `content` passes `CryptContentSchema`; has an entry for every manifest Question_Id including Alternates and `hh-final-1` to `hh-final-3`; exactly one Option_Excerpt per séance payload option; every cited `chunkId` exists in `chunks`; `isHumanReviewed` is false; malformed input returns a typed error and never throws
    - _Requirements: 2.1, 6.5, 6.6, 6.7, 6.8, 6.10, 6.17, 25.11_

  - [ ] 1.5 Write the mapper completeness property test
    - Use `test-support/authoring-arbitraries.ts` to generate rune cipher and séance board questions with per-option evidence
    - **Property 4: The mapper gives every question complete content**
    - **Validates: Requirements 6.4, 6.5, 6.6, 6.8, 6.14, 6.17**

  - [ ] 1.6 Add the `Citation_Source` variant to `citationLabel`
    - Add `CITATION_COPY.sampleParagraph(n)` ("Paragraph N of the sample notes") to `packages/core/src/copy.ts`
    - Change `citationLabel(chunk, source: CitationSource = 'notes')` in `packages/core/src/citation-labeller.ts`; only the paste branch changes
    - Extend `citation-labeller.test.ts` with explicit `'sample'` and `'notes'` examples for paste, PDF and edited-PDF chunks
    - **Property 8: `citationLabel` source variants**
    - **Validates: Requirements 3.8, 3.9, 3.10, 3.11, 3.12, 25.12**

  - [ ] 1.7 Add the room-play strings to `copy.ts`
    - Add: the sample-crypt line for "Enter the crypt" (generating from your own notes comes later; this is a sample crypt), the visible sample-crypt label, `ROOM_START_ERROR_COPY` (`{ what, next }` for `SampleCryptError` and start rejections), `FINAL_DOOR_STATUS_LABELS`, Outcome_Notice announcements (candle lit, ghost spawned, ghost laid to rest, seal cracked, room cleared, escaped), correct and not-correct announcements, panel and button labels, empty-answer messages, "No hints left", the no-penalty line, "Not this time. Here's what your notes say.", "Source excerpt matched", "Challenged: excluded from score", ghost and Return_Slot name templates, the "This ghost returns later." line, and the unplayable-type message
    - Extend `copy.test.ts` so the banned-words test covers every new catalogue and string
    - _Requirements: 1.3, 1.4, 3.3, 3.5, 3.6, 3.7, 3.11, 14.3, 15.3, 16.3, 16.10, 17.7, 18.9, 19.8, 20.8, 20.11, 21.2, 21.3, 21.5_

- [ ] 2. Checkpoint - Core groundwork
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 3. Room_Binding (`apps/web/src/state/`)
  - [ ] 3.1 Add `room-actions.ts` and `room-event-mapper.ts`
    - Define the `RoomAction` union and a pure mapper from each action (except `startRun` and `playAgain`) to exactly one runtime `Event`
    - Write `room-event-mapper.test.ts`: every action maps to one Event of the expected kind, including `enterRoom`
    - _Requirements: 4.4, 4.9_

  - [ ] 3.2 Implement `stepBinding` in `room-binding-model.ts` with its property test
    - Define `BindingModel` and the pure `stepBinding(model, action)`: accepted appends one Event, replaces state and notices, clears rejection; rejected leaves log and state unchanged and sets `rejection`
    - Keep Draft_Answer values out of the model
    - Write `room-binding-model.test.ts` with examples for accept, reject and notices replaced rather than accumulated
    - **Property 1: The binding's state is the fold of its accepted events**
    - **Validates: Requirements 4.3, 4.5, 4.6**
    - _Requirements: 4.1, 4.2, 4.7, 4.8_

  - [ ] 3.3 Implement `useRoomBinding` and `RoomAssets`
    - Create `room-binding.ts`: `useReducer` over `stepBinding`; `startRun` calls an injectable `buildCrypt` (default builds from `samples/human-heart.txt` and `samples/questions/human-heart.json` imported with Vite `?raw` and JSON imports, so no request leaves the origin), then applies `initial(manifest, { length: 'short', difficulty: 'apprentice', hintAllowance: 2 })` and the four start Events in order
    - On a build error or a rejected start Event set phase `start-failed` with the typed error and start no run
    - Hold `RoomAssets { content, chunks }` unchanged for the run; `playAgain` clears the log and reruns the start sequence against the same built crypt
    - Write `room-binding.test.ts`: start sequence order and fixed settings, `buildCrypt` error and rejected start event, `playAgain` empties the log, assets not reassigned, drafts never reach `dispatch`, confirmed notes untouched
    - _Requirements: 1.5, 2.1, 2.2, 2.3, 2.4, 4.1, 4.2, 4.10, 5.1, 5.2, 5.3, 20.9_

  - [ ] 3.4 Add the chosen-option selector and expose the event log from the binding
    - Create `apps/web/src/state/room-selectors.ts` with pure `chosenOptionFor(eventLog: readonly Event[], slotId: string): string | undefined`: it scans the log from the end and returns `selectedOptionId` from the submission of the latest accepted `AnswerSubmitted` event for that slot, and `undefined` when there is none or the submission has no string `selectedOptionId` (for example a rune cipher `{ text }`); it reads the submission through a small Zod schema, never throws and reads nothing from `State`
    - Expose the log from `useRoomBinding` as a read-only `eventLog: readonly Event[]` field next to `state`, `notices` and `rejection` (empty until a run starts); the log lives in the `BindingModel` held by `useReducer`, not in a ref, so a render that reads it is never stale. Components call `chosenOptionFor(eventLog, slotId)` themselves; the hook has no `chosenOptionId` method. Rejected actions are never in the log, so a rejected submission is never returned
    - State and the runtime are unchanged: slots keep `judgedResult` only and do not record the chosen option
    - Write `room-selectors.test.ts`: returns the id of the accepted séance submission; returns the latest one when a slot has several `AnswerSubmitted` events (retry, Return_Slot or Alternate); ignores events of other slots and other kinds; returns `undefined` for an empty log, a rune `{ text }` submission and a malformed submission; a rejected submission (absent from the log) is not returned; add a binding test that the exposed `eventLog` follows `dispatch` (grows on accepted actions, unchanged on rejected ones) and that `chosenOptionFor(eventLog, slotId)` over it returns the submitted option
    - _Requirements: 4.2, 4.3, 17.4, 17.15_

- [ ] 4. Room screen with simple hotspot buttons (no layered art)
  - [ ] 4.1 Add `accessible-names.ts` with table-driven tests
    - Pure functions for lock, ghost, Return_Slot, final door button and seal names, each stating status in words (for example "Rune tablet: rune cipher, unsolved")
    - Write `accessible-names.test.ts` over every `SlotStatus`
    - _Requirements: 10.3, 18.3, 18.7, 21.6_

  - [ ] 4.2 Add `live-region.tsx` and the notice-to-announcement mapping
    - One polite live region; one message per Outcome_Notice from `copy.ts`; announce solved, settled and challenged status changes and correct or not-correct for an opening Evidence_Panel
    - Component tests: each notice kind produces its copy message once, in order
    - _Requirements: 21.1, 21.2, 21.3, 21.4, 21.5_

  - [ ] 4.3 Build the simple `room-screen.tsx`
    - Render one native button per Lock_Slot of the current room (no art), each at least 44 by 44 px with the focus outline `2px` in `--spectre-300` from `tokens.css`, ordered left to right by slot order
    - Show the remaining hint count from State, the visible sample-crypt label and the "Challenged: excluded from score" label on challenged locks
    - Activating a button of an open slot dispatches `LockOpened` and opens a panel slot; activating a solved, settled or challenged slot shows a short status text and dispatches no Event
    - Component tests for all of the above
    - _Requirements: 1.6, 3.5, 5.4, 8.6, 10.1, 10.2, 10.3, 10.6, 10.9, 10.10, 21.7_

  - [ ] 4.4 Build `crypt-flow.tsx` and the error boundary
    - Own `useRoomBinding`; route to the start view, the `start-failed` message built from `ROOM_START_ERROR_COPY`, the Room_Screen, the final door view and the Autopsy by State
    - Wrap in a React error boundary that logs only `error.name` and the component stack
    - Component tests for each route and for the start-failed message
    - _Requirements: 2.2, 5.3, 19.10, 20.1, 20.2_

- [ ] 5. Rune and séance panels (keyboard operable, no drag)
  - [ ] 5.1 Build the `question-panel.tsx` shell
    - Panel with heading, focus moved into it on open, focus returned to the opening control on close, Escape closing with no Event while no judged answer waits for Continue, panel keyed by `slotId:currentQuestionId` so the draft resets on a question change
    - Choose the lock panel by Current_Question_Type
    - Component tests for focus in, focus back, Escape keeps the draft, and no Event on Escape
    - _Requirements: 10.7, 10.8, 13.5, 14.6, 15.5_

  - [ ] 5.2 Build `rune-cipher-panel.tsx`
    - Prompt as plain text, labelled text input, "Submit answer" button and Enter key; dispatch `AnswerSubmitted` with `{ text }`; empty after trim shows the ask-for-answer message with no Event; `invalid-submission` rejection shows the message, keeps the draft and keeps the slot open
    - Show the first letter and answer length while the Applied_Hint is `reveal-first-letter`
    - Component tests including keyboard-only submit
    - _Requirements: 14.1, 14.2, 14.3, 14.4, 14.5, 14.6, 14.7, 22.1, 22.2_

  - [ ] 5.3 Build `seance-board-panel.tsx`
    - Prompt as plain text; options as radio inputs in manifest `payload.optionIds` order inside a labelled group; arrow keys move between options; "Submit answer" dispatches `AnswerSubmitted` with `{ selectedOptionId }`; no choice shows the choose-an-option message with no Event
    - The panel keeps the draft choice locally and does not read or record the chosen option afterwards; the chosen option is later derived from the event log by `chosenOptionFor(eventLog, slotId)` selector over the binding's read-only `eventLog` (task 3.4)
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
    - `resolveExcerpt(assets, excerpt, 'sample')` returns `{ quote, citationLabel, matched }` using `resolveQuote` and `citationLabel`; total for an unknown `chunkId`
    - `orderExcerpts(excerpts, chosenOptionId?, keyOptionId?)` works on indices so each excerpt appears once: chosen Option_Excerpt, key Option_Excerpt, then the rest in stored order
    - Its inputs come from outside `State` and `Crypt_Content`: `chosenOptionId` from `chosenOptionFor(eventLog, slotId)` in `room-selectors.ts` (the latest accepted `AnswerSubmitted` for that slot in the binding's `eventLog`), `keyOptionId` from the manifest payload
    - Unit tests for `resolveExcerpt` (matched and unmatched) and for `orderExcerpts` examples (chosen is key, non-séance, missing option excerpt)
    - **Property 10: Séance evidence ordering shows each excerpt once, chosen first, then key**
    - **Validates: Requirements 17.3, 17.4, 17.13, 17.14, 17.16**
    - _Requirements: 3.3, 3.4, 3.9, 6.9, 17.15_

  - [ ] 7.2 Build `evidence-panel.tsx`
    - Show the result as text and an icon, the chosen and key option texts for séance questions (chosen option ID from `chosenOptionFor(eventLog, slotId)` over the binding's read-only `eventLog`, because State records only `judgedResult`; key from the manifest payload; both option texts looked up in `Crypt_Content` `options`; no chosen option shown when the selector returns `undefined`), every ordered excerpt once with its Citation_Label and "Source excerpt matched" only when matched, the explanation, a kind opening sentence for wrong answers, and a "Continue" button; offer no second submission
    - Result text source: for a Lock_Slot take the result from `judgedResult`; for a Return_Slot take it from the slot status: `solved` shows the correct result text, `settled` shows the wrong result text, and `challenged` shows no result text (the "Challenged: excluded from score" label only)
    - Unit tests for the result-text choice, one per status: Return_Slot `solved` gives the correct text, Return_Slot `settled` gives the wrong text, Return_Slot `challenged` gives no result text, and a Lock_Slot with `judgedResult` correct and with `judgedResult` wrong gives the matching text
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
    - Closed door with no control while `selectFinalDoor(state).available` is false; button to open it when available dispatching `FinalDoorEntered`; at the final door one seal per Final_Door_Slot with a status text and broken state when solved, settled or challenged; a control per open slot opening its Question_Panel; hint, skip, challenge, evidence and ghosts work as in a room
    - `unplayable-panel.tsx` for a lock type with no panel: shows the not-playable message and offers only "Skip"
    - Component tests for each state, including the unplayable fallback
    - _Requirements: 19.1, 19.2, 19.3, 19.4, 19.5, 19.6, 19.7, 19.8, 21.6_

  - [ ] 9.4 Add the escape message and Autopsy button
    - On the `escaped` notice show an escape message and a button that opens the Autopsy; once State is `escaped` the screen accepts no answer, hint, skip or challenge
    - Component tests
    - _Requirements: 19.9, 19.10_

  - [ ] 9.5 Write the escape-always-possible test
    - Using `stepBinding` and `test-support/escape-driver.ts`, drive the Sample_Crypt with sequences that answer wrong, skip or challenge every question and assert status `escaped` within the runtime's prompt bound; include a fast-check generator over per-slot choices
    - _Requirements: 19.11, 18.4, 18.5_

- [ ] 10. Autopsy with Final door section
  - [ ] 10.1 Build `autopsy-view.tsx` for concepts and counts
    - Built from `selectAutopsy(state)`: one entry per `State.concepts` with a short title and a label from `AUTOPSY_LABELS` as text and an icon, the five counts, "excluded from the score" text for challenged outcomes, a link per entry that shows the first cited excerpt of the concept's first question with its sample Citation_Label, and a "Play again" button that dispatches `playAgain`; shown only when State is `escaped`
    - Component tests including no banned phrases
    - _Requirements: 20.1, 20.2, 20.3, 20.4, 20.5, 20.6, 20.7, 20.8, 20.9, 20.10_

  - [ ] 10.2 Add the Final_Door_Section
    - List each `State.finalDoor.slots` question with its prompt from `Crypt_Content` and a status label from `FINAL_DOOR_STATUS_LABELS` as text and an icon; state "excluded from the score" for `settled` and `challenged`
    - Component tests across every status
    - _Requirements: 20.10, 20.11, 20.12, 20.13_

- [ ] 11. Sample labels and "Enter the crypt" entry
  - [ ] 11.1 Add the "Enter the crypt" step after the notes preview
    - In `apps/web/src/app.tsx` show the "Enter the crypt" button after notes are confirmed, with the sample-crypt line from `copy.ts` beside it; activating it starts the run and shows room 1; confirmed notes stay unchanged and unused by the run; a reload returns to the notes preview with no run
    - Component tests for the button, the line, the start and the reload behaviour
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 4.10_

  - [ ] 11.2 Add the honest-label checks
    - Show the visible sample-crypt label during the run; add a component test that renders every screen (start, room, panels, evidence, final door, Autopsy) and asserts no "Human-reviewed", no "Blind model review passed", no Banned_Phrases and no Citation_Label ending in "of your notes"
    - Add a static test that no source under `apps/web/src/features/crypt/` or `apps/web/src/state/` uses `dangerouslySetInnerHTML` or a colour literal outside `tokens.css`
    - _Requirements: 1.6, 3.1, 3.2, 3.6, 3.12, 22.2, 22.3_

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
    - `MIN_HIT_PX`, `hotspotBox`, `stackOrder` and `tabOrder` as pure functions
    - **Property 5: A hotspot box is never smaller than 44 by 44 px**
    - **Validates: Requirements 10.2, 11.6**
    - **Property 6: Stacking order follows depth and tab order follows x**
    - **Validates: Requirements 10.4, 10.5**

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
    - Draw ghosts at Ghost_Anchors using `assignGhostAnchors` and the crop mapping, with the rise on `ghostSpawned` and a fade on `ghostLaidToRest`; draw Spirit_Candle flames with no Light_Pass; crossfade `door-closed.webp` to `door-open.webp` and fade `light-door.webp` in on `roomCleared`; place final door seals inside the door `hotspot` polygon; all ghost layers `pointer-events: none` and never covering controls
    - Component tests for anchor use and door transitions
    - _Requirements: 18.1, 18.2, 18.4, 18.5, 18.6, 18.10, 18.11, 19.4_

  - [ ] 14.11 Add panel placement and the lock close-up
    - Open the Question_Panel on the lock's `panelSide` (right side at the final door); show `locks/<lock>/closed.webp` behind it for an open slot and `locks/<lock>/open.webp` for a solved slot; keep the panel fully lit with text contrast of at least 4.5:1; full width on a Phone_Viewport; question text in Crimson Pro at 18px or larger on desktop and 16px or larger on phones
    - Component tests for side, image and phone width
    - _Requirements: 13.1, 13.2, 13.3, 13.4, 19.6, 22.4_

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
- Property tests sit in the same task as the code they test and cite the design property number. Properties covered: 1 (3.2), 2 (14.1), 3 (1.2), 4 (1.5), 5 and 6 (14.3), 7 (14.4), 8 (1.6), 9 (14.5), 10 (7.1).
- Each task lists the granular requirement clauses it covers. Requirements 24 and 25 are covered by groups 12 and 16 and by the test sub-tasks named in them.
- Groups 4 to 11 use plain buttons so the loop is playable without art. Group 14 replaces them with the layered scene and keeps the plain list as the Scene_File and art failure fallback (Requirement 23.3).
- Tests call no real AI provider and read correct answers from the Sample_Crypt manifest.
- Spec 4 owns saving runs and persisting Crypt_Content; no task here writes run data to storage beyond the Lantern_Setting.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2", "1.3"] },
    { "id": 2, "tasks": ["1.4", "1.6"] },
    { "id": 3, "tasks": ["1.5", "1.7"] },
    { "id": 4, "tasks": ["2"] },
    { "id": 5, "tasks": ["3.1"] },
    { "id": 6, "tasks": ["3.2"] },
    { "id": 7, "tasks": ["3.3"] },
    { "id": 8, "tasks": ["3.4", "4.1", "4.2", "7.1"] },
    { "id": 9, "tasks": ["4.3"] },
    { "id": 10, "tasks": ["4.4"] },
    { "id": 11, "tasks": ["5.1"] },
    { "id": 12, "tasks": ["5.2", "5.3", "7.2"] },
    { "id": 13, "tasks": ["5.4"] },
    { "id": 14, "tasks": ["6.1"] },
    { "id": 15, "tasks": ["6.2"] },
    { "id": 16, "tasks": ["7.3"] },
    { "id": 17, "tasks": ["8"] },
    { "id": 18, "tasks": ["9.1", "9.5"] },
    { "id": 19, "tasks": ["9.2"] },
    { "id": 20, "tasks": ["9.3"] },
    { "id": 21, "tasks": ["9.4"] },
    { "id": 22, "tasks": ["10.1"] },
    { "id": 23, "tasks": ["10.2"] },
    { "id": 24, "tasks": ["11.1"] },
    { "id": 25, "tasks": ["11.2"] },
    { "id": 26, "tasks": ["12.1"] },
    { "id": 27, "tasks": ["12.2", "12.3", "12.4"] },
    { "id": 28, "tasks": ["12.5", "12.6"] },
    { "id": 29, "tasks": ["13"] },
    { "id": 30, "tasks": ["14.1", "14.2", "14.3", "14.4", "14.5", "14.6"] },
    { "id": 31, "tasks": ["14.7"] },
    { "id": 32, "tasks": ["14.8"] },
    { "id": 33, "tasks": ["14.9"] },
    { "id": 34, "tasks": ["14.10"] },
    { "id": 35, "tasks": ["14.11"] },
    { "id": 36, "tasks": ["14.12"] },
    { "id": 37, "tasks": ["15"] },
    { "id": 38, "tasks": ["16.1", "16.2", "16.3", "16.4", "16.5", "16.6", "16.7"] },
    { "id": 39, "tasks": ["17"] }
  ]
}
```
