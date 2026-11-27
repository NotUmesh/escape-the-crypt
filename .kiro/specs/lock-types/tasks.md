# Implementation Plan: Lock Types

## Overview

TypeScript throughout (strict, Node 22, Vitest, fast-check, Playwright, axe). Groups 1-2 are the coordination gate and must run first and before every later commit. Groups 3-5 build the pure core (Interaction_Models, manifest widening, sample mapping). Groups 6-7 build the three sample crypts. Groups 8-12 build the four panels and registry. Group 13 is the sample picker. Groups 14-15 are Playwright/axe and the final checkpoint.

During a task, run only the test files that task names (`vitest run <file>` or a single `playwright test <file> --project=chromium`). Only at a Checkpoint task run the full suites: `pnpm test` (adds `--maxWorkers=50%` for this invocation) and `pnpm e2e -- --workers=2`, then append one row per run to `docs/build-log.md`. No task edits `packages/core/src/pipeline/`, `checks/`, `mapper/manifest-mapper.ts`, `authoring/`, `apps/worker/`, `eval/` or `apps/web/src/state/`, and no task edits an existing file in `packages/core/src/locks/`.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2", "2.1"] },
    { "id": 2, "tasks": ["3.1"] },
    { "id": 3, "tasks": ["3.2", "3.4", "3.6", "3.8"] },
    { "id": 4, "tasks": ["3.3", "3.5", "3.7", "3.9", "3.10"] },
    { "id": 5, "tasks": ["4.1"] },
    { "id": 6, "tasks": ["4.2"] },
    { "id": 7, "tasks": ["4.3", "4.4"] },
    { "id": 8, "tasks": ["5.1"] },
    { "id": 9, "tasks": ["5.2", "5.3", "5.4"] },
    { "id": 10, "tasks": ["5.5"] },
    { "id": 11, "tasks": ["6.1", "7.1"] },
    { "id": 12, "tasks": ["6.2", "7.2"] },
    { "id": 13, "tasks": ["7.3", "7.4"] },
    { "id": 14, "tasks": ["7.5"] },
    { "id": 15, "tasks": ["8.1", "8.2", "8.3"] },
    { "id": 16, "tasks": ["9.1", "10.1", "11.1", "12.1"] },
    { "id": 17, "tasks": ["9.2", "10.2", "11.2", "12.2"] },
    { "id": 18, "tasks": ["13.1", "13.2", "13.3"] },
    { "id": 19, "tasks": ["13.4"] },
    { "id": 20, "tasks": ["14.1"] },
    { "id": 21, "tasks": ["14.2", "14.3"] },
    { "id": 22, "tasks": ["15.1"] },
    { "id": 23, "tasks": ["15.2", "15.3"] },
    { "id": 24, "tasks": ["15.4", "15.5"] },
    { "id": 25, "tasks": ["15.6"] }
  ]
}
```

Group 2 (the pre-commit reminder) has no code dependency and applies to every commit from Group 1 onward.

## Tasks

- [ ] 1. Coordination gate
  - [ ] 1.1 Confirm the push and pull
    - Ask the user to confirm the Other_Machine's work (multi-room play, rune letter count) is pushed
    - Run `git pull --rebase`; on conflict, stop and report the conflicting files to the user and make no further edit
    - _Requirements: 1.1, 1.2, 1.4_
  - [ ] 1.2 Re-read the six shared files and record the delta
    - Read `room-screen.tsx`, `art-room.ts`, `question-controls.tsx`, `rune-cipher-panel.tsx`, `room-panel.tsx`, `lock-panel-context.ts` as they now stand after the pull
    - Compare against the design's assumptions (generic `LOCK_PANELS[questionType]` dispatch in `room-panel.tsx`/`question-panel.tsx`, type-agnostic `QuestionControls`, scene files already listing all six lock types); write one short note in the task output naming any assumption that no longer holds and the smallest adjustment needed
    - _Requirements: 1.8, 1.9_

- [ ] 2. Pre-commit discipline reminder
  - [ ] 2.1 Add a one-line note to this plan's own checkpoint tasks (12, 15) that `git pull --rebase` runs immediately before each commit
    - No code change; this task only confirms the rule is carried into every later commit step (enforced by the implementer at commit time, not by a test)
    - _Requirements: 1.3_

- [ ] 3. Shared Display_Order and the four Interaction_Models (`packages/core/src/locks/`)
  - [ ] 3.1 Add `display-order.ts` with the seeded shuffle and its tests
    - Create `packages/core/src/locks/display-order.ts` exporting `displayOrder<T>(items, seed)`: a seeded Fisher-Yates that is deterministic for a given seed and length, retries up to 5 seed variants and falls back to a rotate-by-one when the result equals the identity order
    - Write `display-order.test.ts`: same seed and input gives the same output; output is a permutation of the input (property test, fast-check); for short lists (3 items) the result is never equal to the input order
    - **Property 3: Display_Order is a permutation that avoids the key order for the shapes this spec ships**
    - **Validates: Requirements 3.2**
    - _Requirements: 3.1, 3.2_
  - [ ] 3.2 Add `bone-ordering-interaction.ts`
    - Export `BoneOrderingDraft`, `initBoneOrderingDraft(payload, hint, questionId)`, `moveBoneUp`, `moveBoneDown`, `boneOrderingSubmission`; shuffle via `displayOrder`, splice the Pinned_Bone to its key position when a `lock-first-bone` hint is applied, no-op at array bounds and on the pinned bone
    - Write `bone-ordering-interaction.test.ts`: initial draft is never equal to `keyOrder` for `itemIds === keyOrder` fixtures (property test); move up/down at bounds is a no-op; a pinned bone never moves and the rest differs from `keyOrder`; never throws for any input
    - **Property 3: Display_Order is a permutation that avoids the key order for the shapes this spec ships**
    - **Validates: Requirements 3.3, 3.4**
    - _Requirements: 3.3, 3.4, 3.6, 3.7, 3.8, 3.17_
  - [ ] 3.3 Write the bone-ordering Judge-agreement property test
    - In `bone-ordering-interaction.test.ts` or a sibling `bone-ordering-interaction-property.test.ts`, generate a valid `BoneOrderingQuestion` and an optional `lock-first-bone` hint with fast-check; drive `moveBoneUp`/`moveBoneDown` to reach `keyOrder` and assert `judge(...) === 'correct'`; drive to a different permutation and assert `judge(...) !== 'correct'`
    - **Property 1: Judge agreement**
    - **Validates: Requirements 4.13**
    - _Requirements: 4.13_
  - [ ] 3.4 Add `bound-threads-interaction.ts`
    - Export `BoundThreadsDraft`, `ThreadRefusal`, `initBoundThreadsDraft`, `selectLeft`, `tieRight`, `undoThread`, `boundThreadsSubmission`; right column via `displayOrder` seeded so it differs from the key-aligned order; pre-tie the Hinted_Pair when a `tie-thread` hint is applied and refuse to undo it
    - Write `bound-threads-interaction.test.ts`: `tieRight` refuses with `no-left-selected` when nothing is selected and with `already-tied` for a tied side; `selectLeft` toggles; `undoThread` is a no-op on the hinted pair; `boundThreadsSubmission` returns `{ ready: false }` while any left is untied; never throws
    - **Property 3: Display_Order is a permutation that avoids the key order for the shapes this spec ships**
    - **Validates: Requirements 3.5**
    - _Requirements: 3.5, 3.6, 3.9, 3.10, 3.11, 3.16, 3.17_
  - [ ] 3.5 Write the bound-threads invariant and Judge-agreement property tests
    - Property test: for any random sequence of `selectLeft`/`tieRight`/`undoThread` calls (including calls on tied/hinted items), `pairs` never holds a duplicate value and the hinted pair is never removed
    - Property test: driving the operations to tie every pair of `keyPairs` is judged `correct`; tying a complete but different one-to-one matching is judged `wrong`
    - **Property 2: Bound-threads one-to-one invariant**
    - **Property 1: Judge agreement**
    - **Validates: Requirements 5.15, 3.11, 5.14**
    - _Requirements: 5.14, 5.15_
  - [ ] 3.6 Add `combination-dial-interaction.ts`
    - Export `CombinationDialDraft`, `initCombinationDialDraft(payload)`, `wheelsOf`, `stepWheel`, `setTypedEntry`, `combinationDialSubmission`; `wheelCount` is `max(3, integer digits of the largest stated number)`, `hasTenths` true only when a stated number has a non-zero tenths part; `text` stays the single source of truth
    - Write `combination-dial-interaction.test.ts`: `wheelCount`/`hasTenths` for `exact`, `range` and `tolerance` fixtures; `stepWheel` wraps 9→0 and 0→9 at one position only, leaves a leading `-` untouched; `combinationDialSubmission` returns `{ ready: false }` for blank text; never throws
    - **Validates: Requirements 3.12, 3.13, 3.14**
    - _Requirements: 3.12, 3.13, 3.14, 3.17_
  - [ ] 3.7 Write the combination-dial round-trip and Judge-agreement property tests
    - Property test: for any draft and any text the panel can produce (typed or built by stepping wheels), `wheelsOf(setTypedEntry(draft, text))` reconstructs the same digits `text` encodes
    - Property test: for `exact`, `range` and `tolerance` payloads, a draft set to an accepted value is judged `correct`; a draft set to a value outside the accepted set is judged `wrong`
    - **Property 4: Combination-dial round trip**
    - **Property 1: Judge agreement**
    - **Validates: Requirements 6.16, 6.15**
    - _Requirements: 6.15, 6.16_
  - [ ] 3.8 Add `cursed-object-interaction.ts`
    - Export `CursedObjectDraft`, `initCursedObjectDraft(hint)`, `chooseItem`, `clearChoice`, `cursedObjectSubmission`; `chooseItem` is a no-op on the Removed_Item
    - Write `cursed-object-interaction.test.ts`: choosing the removed item is a no-op; `clearChoice` resets to `null`; submission is `{ ready: false }` while unchosen; never throws
    - **Validates: Requirements 3.15**
    - _Requirements: 3.15, 3.17_
  - [ ] 3.9 Write the cursed-object Judge-agreement property test
    - Property test: choosing `oddOneOutId` is judged `correct`; choosing any other enabled item is judged `wrong`; with a `remove-option` hint applied, the removed item can never be chosen (asserted directly, not just via the judge)
    - **Property 1: Judge agreement**
    - **Validates: Requirements 7.9, 7.10**
    - _Requirements: 7.9, 7.10_
  - [ ] 3.10 Write the "no key exposed by the Interaction_Models" check
    - Static review task plus a unit test per module asserting the module's exports do not include a function named or shaped to return `keyOrder`, `keyPairs`, `oddOneOutId`, `exactValue`, `min`, `max`, `value` or `tolerance`
    - _Requirements: 3.6_

- [ ] 4. Manifest widening (`packages/core/src/runtime/manifest-schema.ts`, `manifest-hints.ts`)
  - [ ] 4.1 Add the three payload schemas and wire `payloadSchemaFor`
    - Add `BoundThreadsPayloadSchema`, `CursedObjectPayloadSchema`, `CombinationDialPayloadSchema` exactly as designed; widen `payloadSchemaFor`'s switch and return type
    - Extend `manifest-schema.test.ts`: each schema accepts a valid fixture and rejects a malformed one (wrong arity, non-one-to-one `keyPairs`, `oddOneOutId` not in `optionIds`, `min > max`, negative `tolerance`, non-finite number)
    - _Requirements: 2.1, 2.2, 2.3, 2.9_
  - [ ] 4.2 Add the `narrowHint` branches for the three types
    - Add `bound-threads` (`tie-thread` pair must be one of `keyPairs`), `cursed-object` (`remove-option` id in `optionIds`, not `oddOneOutId`) and `combination-dial` (any non-null hint rejected) branches to `narrowHint` in `manifest-hints.ts`
    - Extend `manifest-schema-hints.test.ts` (or sibling) with accept/reject cases for each of the three new branches, including a `combination-dial` question with a non-null hint being rejected and with `null` accepted
    - _Requirements: 2.4, 2.5, 2.6_
  - [ ] 4.3 Write the manifest round-trip and six-type acceptance property tests
    - Property test: for all valid payloads of the three new types embedded in an otherwise-valid manifest, `parseManifest(JSON.parse(JSON.stringify(manifest)))` equals the original
    - Property test: for all valid payloads and hints `narrowHint` accepts for a lock type (all six types), the Manifest_Schema accepts the QuestionSpec; for hints of a kind `narrowHint` rejects for that type, it is rejected
    - **Property 6: Manifest round trip for the three new payloads**
    - **Validates: Requirements 2.10, 2.11**
    - _Requirements: 2.10, 2.11_
  - [ ] 4.4 Verify the Crypt_Bundle_Parser and Crypt_Content schema need no change
    - Write a unit test in `crypt-bundle-parse.test.ts` that builds a bundle with a `bound-threads`, a `cursed-object` and a `combination-dial` question (the last with no `options`) and asserts `parseCryptBundle` accepts it unmodified
    - IF the test fails, make the smallest compatible widening to `crypt-content.ts` or `crypt-bundle-parse.ts` only, and report the change made to the user in the task output
    - _Requirements: 2.7, 2.12_

- [ ] 5. Sample-only mapping (`packages/core/src/sample-crypt/sample-mapping.ts`, new)
  - [ ] 5.1 Add the raw question shapes and `SampleMappingError`
    - Define `RawBoundThreadsQuestion`, `RawCursedObjectQuestion`, `RawCombinationDialQuestion` and `SampleMappingError` (`sample-mapping-quote-unresolved`, `sample-mapping-shape-invalid`) in `sample-mapping.ts`; do not export these three functions or types from `packages/core`'s public `index.ts`
    - _Requirements: 12.6_
  - [ ] 5.2 Implement `mapSampleBoundThreads`
    - Generate `leftIds`/`rightIds` with the `<questionId>-l<i>`/`-r<i>` convention, `keyPairs` aligned in authoring order, resolve each pair's evidence through `maps.chunksByParagraph`, hint always `{ kind: 'tie-thread', pair: keyPairs[0] }`, validate the content entry with `parseCryptContentEntry`
    - Write `sample-mapping.test.ts` (bound-threads part): maps `hh-q07`-shaped fixture correctly; returns `sample-mapping-quote-unresolved` for an unresolvable paragraph; content holds one option entry per left and right ID
    - _Requirements: 11.1, 11.2, 11.4, 11.5, 11.6, 12.6, 15.5_
  - [ ] 5.3 Implement `mapSampleCursedObject`
    - Generate `optionIds` with the `<questionId>-o<i>` convention, `oddOneOutId` from `answer`, hint removes the first non-odd item, resolve evidence, validate content
    - Extend `sample-mapping.test.ts`: maps `hh-q09`-shaped fixture correctly; hint never names `oddOneOutId`; content holds one option entry per item
    - _Requirements: 11.1, 11.2, 11.4, 11.5, 11.6, 12.6, 15.5_
  - [ ] 5.4 Implement `mapSampleCombinationDial`
    - Map `exact`/`range` answers to the payload shape, `unit` from `units`, `hintEffect: null` always, resolve evidence, validate content with no `options` field
    - Extend `sample-mapping.test.ts`: maps `hh-q10`/`hh-q11`-shaped fixtures (`exact`, `range`) correctly; content has no `options`
    - _Requirements: 11.1, 11.3, 11.4, 11.5, 11.6, 12.6, 15.5_
  - [ ] 5.5 Write the sample-mapping property test for all three functions
    - Property test: for generated raw questions with resolvable evidence, the built `MappedQuestion`'s payload passes the matching Manifest_Schema payload schema and its content passes `CryptContentSchema`
    - **Validates: Requirements 11.5, 11.6**
    - _Requirements: 11.5, 11.6_

- [ ] 6. Human-heart sample crypt widened to six types
  - [ ] 6.1 Widen `human-heart.ts`'s layout and selection tables
    - Change `ROOM_SELECTION` to the two-room, four-Lock_Slot table (rune-cipher/séance in room 1, bone-ordering/bound-threads in room 2) and `FINAL_DOOR_SELECTION` to `hh-q09` (cursed-object), `hh-q10`, `hh-q11` (combination-dial), from the design's table
    - Call `mapSampleBoundThreads`/`mapSampleCursedObject`/`mapSampleCombinationDial` for the newly-added questions and `loadMappedQuestion` (unchanged) for the rest; keep the file at or below ~300 lines, splitting a `human-heart-layout.ts` constants file if needed
    - _Requirements: 12.1, 12.2, 12.4, 12.5, 12.13, 12.17_
  - [ ] 6.2 Update `human-heart.test.ts` and every dependent fixture/test for the new shape
    - Update assertions that assumed one room, two Lock_Slots and three final-door questions; update `apps/web/src/test-support/sample-bundle.ts`-consuming tests and any Playwright fixture that reads `hh-slot-1`/`hh-slot-2` only
    - Verify every `evidenceRefs` ID appears as an excerpt `chunkId` and every quote resolves, for the newly added questions
    - **Property 7: Sample crypts are complete and escapable**
    - **Validates: Requirements 12.3, 12.14**
    - _Requirements: 12.3, 12.13, 12.14, 15.5_

- [ ] 7. New https and printing-press sample crypts
  - [ ] 7.1 Add the rune-cipher question to `samples/questions/https.json`
    - Add `hs-q10` (`lockType: rune-cipher`, `role: primary`, `conceptId: hs-c07`) quoting a short, unambiguous term from `samples/https.txt`; keep `status` a draft value
    - Verify by hand (and in task 7.3's test) that the quote resolves against its paragraph
    - _Requirements: 12.7, 12.8_
  - [ ] 7.2 Add `sample-crypt/https.ts`
    - Fixed `HTTPS_ROOM_SELECTION`/`HTTPS_FINAL_DOOR_SELECTION` per the design's table, `HTTPS_CONCEPT_TITLES`, `buildHttpsSampleCrypt(notesText, questionsJson)` returning `SampleCryptResult`, following `human-heart.ts`'s structure and the ~300 line limit
    - _Requirements: 12.1, 12.2, 12.4, 12.5, 12.17_
  - [ ] 7.3 Write `https.test.ts`
    - Content passes `CryptContentSchema`, has an entry per manifest question; manifest passes `validateManifestForPublish` and `parseCryptBundle`; all six lock types present; every `evidenceRefs` ID resolves, including the new `hs-q10`
    - **Property 7: Sample crypts are complete and escapable**
    - **Validates: Requirements 12.3, 12.14**
    - _Requirements: 12.3, 12.9, 12.14_
  - [ ] 7.4 Add `sample-crypt/printing-press.ts` and `printing-press.test.ts`
    - Fixed selection tables and `PRINTING_PRESS_CONCEPT_TITLES` per the design's table; same shape and tests as task 7.2-7.3
    - **Property 7: Sample crypts are complete and escapable**
    - **Validates: Requirements 12.3, 12.14**
    - _Requirements: 12.1, 12.2, 12.3, 12.4, 12.5, 12.9, 12.14, 12.17_
  - [ ] 7.5 Checkpoint: core groundwork
    - Run `pnpm --filter @escape-the-crypt/core test` (targeted), then `pnpm typecheck` and `pnpm lint` for `packages/core` only
    - `git pull --rebase` before committing
    - _Requirements: 14.1, 14.6_

- [ ] 8. Accessible-names and payload accessor additions
  - [ ] 8.1 Add bone-ordering move-button and thread/wheel/odd-item name helpers to `accessible-names.ts`
    - Add `boneMoveName(action, text, position, total)`, `threadStateName(text, state, partnerText?)`, `wheelName(action, placeValue, digit)`, matching the existing `lockName`-style pure functions
    - Write unit tests for each in `accessible-names.test.ts`
    - _Requirements: 8.6, 4.2, 5.10, 6.2_
  - [ ] 8.2 Add `copy-lock-panels.ts`
    - Define every new learner-facing string (move/tie/undo/select/choose/type messages, "Fixed by hint", "Tied by hint") in the tone of `.kiro/steering/tone.md`; reuse `ROOM_PLAY_LABELS.removedByHint` rather than duplicating it
    - Confirm the banned-words test's module list (read it first); add `copy-lock-panels.ts` to that list if it is not auto-discovered
    - _Requirements: 15.1, 8.11_
  - [ ] 8.3 Add the minimal `payloadFor` accessor
    - Re-read `room-panel.tsx` and `lock-panel-context.ts` as pulled in task 1.2; add the smallest possible `payloadFor(slotId, questionId)` field to `LockPanelContextValue` and its one call site in `RoomPanel`'s context value, reading `question.payload` from the already-available `state.manifest`
    - Write a unit test that `payloadFor` returns the primary question's payload and the Alternate's after a seal crack
    - _Requirements: 1.9_

- [ ] 9. Bone ordering panel
  - [ ] 9.1 Implement `bone-ordering-panel.tsx` and register it
    - Build the ordered list of Move up/down buttons per the design, using `initBoneOrderingDraft`/`moveBoneUp`/`moveBoneDown`/`boneOrderingSubmission`, `payloadFor`, and `content.questions[questionId].options`
    - Alt+Up/Down moves the bone; plain Up/Down moves focus; "Submit answer" dispatches `{ order }`; the Pinned_Bone shows "Fixed by hint" and disabled buttons
    - Add `'bone-ordering': BoneOrderingPanel` to `LOCK_PANELS`
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8, 4.9, 4.10, 4.11, 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.9, 8.10, 8.12, 9.1, 9.2_
  - [ ] 9.2 Write `bone-ordering-panel.test.tsx` (keyboard-only)
    - Complete a correct and a wrong answer using Tab, Alt+Arrow and Enter only; assert announced position text; assert the Pinned_Bone cannot move; assert the panel remounts with an empty draft on an Alternate swap
    - Assert no DOM node contains `keyOrder`'s text before submission
    - **Property 5: No early answer leak**
    - **Validates: Requirements 13.9**
    - _Requirements: 13.2, 13.9_

- [ ] 10. Bound threads panel
  - [ ] 10.1 Implement `bound-threads-panel.tsx` and register it
    - Two columns of buttons plus a tied-pairs list with Undo buttons, using the Interaction_Model operations and `payloadFor`
    - Select-left then select-right ties a Thread; selecting an already-selected left clears it; selecting a right with no left selected shows the "choose a left item first" message; "Submit answer" dispatches `{ pairs }` only when every left is tied
    - Add `'bound-threads': BoundThreadsPanel` to `LOCK_PANELS`
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 5.8, 5.9, 5.10, 5.11, 5.12, 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.9, 8.10, 8.12, 9.1, 9.2_
  - [ ] 10.2 Write `bound-threads-panel.test.tsx` (keyboard-only)
    - Complete a correct and a wrong matching, undo a Thread and retie it, using Tab and Enter only; assert the hinted pair shows "Tied by hint" with no Undo button; assert the submit guard message when a left item is untied
    - Assert no DOM node contains a `keyPairs` pairing before submission
    - **Property 5: No early answer leak**
    - **Validates: Requirements 13.9**
    - _Requirements: 13.2, 13.9_

- [ ] 11. Combination dial panel
  - [ ] 11.1 Implement `combination-dial-panel.tsx` and register it
    - Wheel row of Increase/Decrease buttons plus a labelled text `Typed_Entry`, using the Interaction_Model operations and `payloadFor` for the unit; Left/Right arrow moves focus between wheels, Up/Down steps the focused wheel
    - "Submit answer" or Enter in the Typed_Entry dispatches `{ rawInput }`; empty text shows the "type a number" message; `invalid-submission` rejection shows the digits/decimal message and keeps the draft
    - Add `'combination-dial': CombinationDialPanel` to `LOCK_PANELS`
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 6.8, 6.9, 6.10, 6.11, 6.12, 6.13, 6.14, 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.9, 8.10, 8.12, 9.1, 9.2_
  - [ ] 11.2 Write `combination-dial-panel.test.tsx` (keyboard-only)
    - Complete a correct and a wrong value by stepping wheels only, then by typing only, using Tab, Arrow keys and Enter; assert the unit text is visible and no payload number is in the DOM before submission
    - **Property 5: No early answer leak**
    - **Validates: Requirements 13.9**
    - _Requirements: 13.2, 13.9_

- [ ] 12. Cursed object panel
  - [ ] 12.1 Implement `cursed-object-panel.tsx` and register it
    - Radio group of item texts following `SeanceBoardPanel`'s structure, substituting the submission shape `{ selectedId }` and the Removed_Item disabling
    - Add `'cursed-object': CursedObjectPanel` to `LOCK_PANELS`
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7, 7.8, 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.9, 8.10, 8.12, 9.1, 9.2_
  - [ ] 12.2 Write `cursed-object-panel.test.tsx` (keyboard-only)
    - Complete a correct and a wrong choice with Tab, Arrow and Enter only; assert the removed item is disabled and unreachable by arrow navigation
    - **Property 5: No early answer leak**
    - **Validates: Requirements 13.9**
    - _Requirements: 13.2, 13.9_

- [ ] 13. Registry completeness, unplayable-path cleanup and remaining unit tests
  - [ ] 13.1 Write the registry-completeness test and update stale "unplayable" expectations
    - `lock-panel-registry.test.ts`: `Object.keys(LOCK_PANELS).sort()` equals `[...LOCK_TYPES].sort()`
    - Update every existing test (room-screen, final-door, question-panel, seance/rune panel suites) that expected the Unplayable_Panel for one of the four types to now expect that type's Lock_Panel
    - Add one test that renders an Unknown_Type (a type string outside `LOCK_TYPES`) and still gets the Unplayable_Panel and its Skip button
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 9.7_
  - [ ] 13.2 Write the art-presence tests for the four types
    - Unit test that `locks/<type>/closed.webp`, `closed@2x.webp`, `open.webp`, `open@2x.webp` exist for each New_Lock_Type (extends the existing art-presence test file)
    - Unit test that each Art_Room's `scene.json` already lists the lock entry with all four Lock_Layers and the Light_Pass for each New_Lock_Type
    - _Requirements: 10.5, 10.7, 10.8_
  - [ ] 13.3 Write the hotspot/transparency and close-up tests for the four types
    - Extend the existing hotspot-CSS test (`hotspot-css.test.ts`/`crypt-css.test.ts`) to cover the four new lock buttons; extend `lock-closeup.test.tsx` to cover `bone-ordering`/`bound-threads`/`combination-dial`/`cursed-object`
    - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.6_
  - [ ] 13.4 Checkpoint: panels and registry
    - Run `pnpm --filter @escape-the-crypt/web test` (targeted to the new/changed files) plus `pnpm typecheck` and `pnpm lint`
    - `git pull --rebase` before committing
    - _Requirements: 14.1, 14.6_

- [ ] 14. Sample picker
  - [ ] 14.1 Add `sample-picker.tsx` and `sample-crypt-sources.ts`
    - `SamplePicker` as a labelled, keyboard-operable radio group of the three sample names, default `human-heart`, each target at least 44×44 px
    - `features/crypt/sample-crypt-sources.ts` wraps `buildHttpsSampleCrypt`/`buildPrintingPressSampleCrypt` with their own `?raw`/JSON sample-file imports, mirroring `state/sample-crypt-source.ts`
    - _Requirements: 12.9, 12.10, 12.11_
  - [ ] 14.2 Wire the picker into `start-view.tsx` and `crypt-flow.tsx`
    - Add the optional `samplePicker` prop to `StartView`; hold `SampleId` state in `crypt-flow.tsx` and switch `buildCrypt` on it; keep the existing sample-crypt line and label unedited
    - Write a component test that selecting each radio option and activating "Enter the crypt" builds that sample (mock `buildCrypt`'s three branches)
    - _Requirements: 12.9, 12.10, 12.16, 13.12_
  - [ ] 14.3 Record the resume limitation
    - Add a short code comment at `restoreRun`'s call site (read-only edit is not needed; this is a comment in `features/crypt/` code that calls it, or a note in this plan) stating that resuming a saved run on the https or printing-press sample returns `record-unreadable`, and confirm this is reported to the user once in this task's output
    - _Requirements: 12.12_

- [ ] 15. End-to-end, phone, axe and final checkpoint
  - [ ] 15.1 Write one Playwright test per New_Lock_Type (chromium)
    - Open the lock, answer correctly by keyboard only, check the Evidence_Panel shows the result, excerpt and "Source excerpt matched"
    - _Requirements: 13.3_
  - [ ] 15.2 Duplicate the four tests across firefox and pixel projects
    - Reuse the same spec files with Playwright's existing multi-project run; add the phone-tap variant per type checking 44×44 px targets on the Phone_Project
    - _Requirements: 13.3, 13.4_
  - [ ] 15.3 Write one axe check per New_Lock_Type
    - Extend `crypt-axe.e2e.ts`'s pattern with the Lock_Panel open for each of the four types; assert no violations
    - _Requirements: 13.5_
  - [ ] 15.4 Write the three sample-crypt escape Playwright tests (all correct)
    - One test per Sample_Crypt_Entry: select it via the Sample_Picker, answer every question correctly reading keys from the manifest fixture in test code, reach "escaped"
    - **Property 7: Sample crypts are complete and escapable**
    - **Validates: Requirements 12.15**
    - _Requirements: 13.6, 12.15_
  - [ ] 15.5 Write the three sample-crypt escape Playwright tests (all skipped/challenged)
    - One test per Sample_Crypt_Entry: skip or challenge every question and reach "escaped"
    - **Property 7: Sample crypts are complete and escapable**
    - **Validates: Requirements 12.15**
    - _Requirements: 13.6, 12.15_
  - [ ] 15.6 Checkpoint: full suite and build log
    - `git pull --rebase`; run `pnpm test` (full, `--maxWorkers=50%`) and `pnpm e2e -- --workers=2` (full); run `pnpm lint` and `pnpm typecheck`
    - Append the real pass/fail/skip counts to `docs/build-log.md` in the existing table format
    - _Requirements: 14.2, 14.3, 14.5, 14.6_

## Notes

- Every property test cites its design Property number and the requirements it validates, per the project's PBT convention.
- No task adds the label "Human-reviewed" or "Blind model review passed"; no task calls an AI provider or touches a recorded cassette.
- Task 1 and the "`git pull --rebase` before committing" line in tasks 7.5, 13.4 and 15.6 are the only places this plan enforces the coordination requirement; the same rule applies before every other commit even where not repeated.
