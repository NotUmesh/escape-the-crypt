# Implementation Plan: Lock Types

## Overview

TypeScript throughout (strict, Node 22, Vitest, fast-check, Playwright, axe). The work runs in four phases with two hard stops between them.

- **Phase 1 (task 1 to 6, start now):** coordination gate, shared foundation, four Interaction_Models, four panel files with keyboard-only tests, manifest widening, checkpoint. No Shared_Panel_File is edited and no panel test imports `lock-panel-registry.ts`.
- **HOLD (task 7):** the user confirms the Other_Machine's work is pushed. Nothing after task 7 runs before that go-ahead.
- **Phase 2 (task 8 and 9):** registry, `payloadFor`, unplayable-path cleanup, registry-dependent tests, checkpoint.
- **Phase 3 (task 10 to 16):** mapper gate first. If any mapper arm is missing, stop and report; no workaround. Then the sample builders, the Sample_Registry and the sample sources.
- **Phase 4 (task 17 to 20):** Playwright per type, axe per panel, full escape per sample, final checkpoint.

Rules for every task:

- Run `git pull --rebase` before the first edit of a task and immediately before every commit. On a conflict, stop and report the files; make no further edit.
- Do not edit `packages/core/src/pipeline/`, `checks/`, `mapper/`, `apps/worker/`, `eval/` or `apps/web/src/state/`. The only exception is the narrow `mapper/crypt-bundle-parse.ts` or `mapper/crypt-content.ts` change that Requirement 2.7 allows (task 5.4 or 11), which must be reported.
- Do not edit any existing file in `packages/core/src/locks/`. New `*-interaction.ts`, `display-order.ts` and their tests are allowed.
- Do not edit `apps/web/src/features/desk/sample-list.ts` or other Sample_Hub files unless unavoidable, and report it if so.
- No sample picker, no sample-only mapping layer, no local mapper.
- During a task, run only the targeted Vitest file (`vitest run <file>`) or a single Playwright file on one project. Start no dev server or watcher. Full suites run only at Checkpoint tasks (`--maxWorkers=50%` for Vitest, `--workers=2` for Playwright).
- Every property test runs at least 100 iterations and carries the comment `Feature: lock-types, Property N: <title>`.

## Tasks

- [x] 1. Coordination gate (Phase 1, read-only, no go-ahead needed)
  - [x] 1.1 Pull and report the differences in the six shared files
    - Run `git pull --rebase`. On a conflict, stop and report the files.
    - Read `room-screen.tsx`, `art-room.ts`, `question-controls.tsx`, `rune-cipher-panel.tsx`, `room-panel.tsx` and `lock-panel-context.ts` as they now stand. Edit none of them.
    - Compare against the design's assumptions: generic `LOCK_PANELS[type]` dispatch in `RoomPanel`/`question-panel.tsx`, type-agnostic `QuestionControls`, scene files that already list all six lock types, and the `LockPanelContext` shape (dispatch, rejection, content, `appliedHintFor`, announcer).
    - Report to the user, in the task output, every assumption that no longer holds and the smallest adjustment each needs.
    - _Requirements: 1.2, 1.8, 1.10_

- [x] 2. Shared foundation (Phase 1)
  - [x] 2.1 Add `locks/display-order.ts` and its test
    - Export `displayOrder(items, seed)` (seeded Fisher-Yates, integer hash of the seed, no random source) and `displayOrderAvoiding(items, seed, avoid)` (retry with suffixes `:1` to `:5`, then rotate by one).
    - Write `display-order.test.ts`: deterministic for the same input and seed, returns a permutation, `displayOrderAvoiding` never returns a candidate that `avoid` rejects for 3-item lists where a rotation avoids it.
    - **Property 3: Display_Order is a deterministic permutation that avoids the key**
    - **Validates: Requirements 3.2, 3.3, 3.5**
    - _Requirements: 3.1, 3.2_
  - [x] 2.2 Add accessible-name helpers to `accessible-names.ts`
    - Add `boneMoveName(action, text, position, total)`, `threadStateName(text, state, partnerText?)` and `wheelName(action, place, digit)` beside the existing helpers. Add the matching cases to `accessible-names.test.ts`.
    - _Requirements: 4.2, 5.10, 6.2, 8.6_
  - [x] 2.3 Add `packages/core/src/copy-lock-panels.ts`
    - Export one `*_LABELS` object like `copy-room-play.ts`: move labels, shortcut line, refusal messages, "Fixed by hint", "Tied by hint", "no hint to give", `payloadMissing`, `itemTextMissing`, wheel name templates, empty-draft messages and the dial `invalid-submission` message. Reuse the existing "Removed by hint" label. Follow `.kiro/steering/tone.md`.
    - Read the banned-phrases test first. If it uses a fixed import list, add `copy-lock-panels.ts` to it; if it finds files by reflection, confirm that it finds this one.
    - _Requirements: 8.11, 15.1_
  - [x] 2.4 Add the payload hook and a test-support provider
    - Create `apps/web/src/features/crypt/lock-panel-payload.ts` with `LockPayloadByType`, `LockPayloadSource`, `LockPayloadContext` and `useLockPayload(slotId, questionId, type)` returning the payload or `null` for a missing or other-typed payload.
    - Create `apps/web/src/test-support/lock-panel-test-provider.tsx`: one provider that supplies a test-local `LockPanelContext` value (dispatch spy, rejection, content, `appliedHintFor`, announcer spy) and a `LockPayloadContext` source. It must not import `lock-panel-registry.ts`.
    - Write a small test for `useLockPayload` (returns the payload, returns `null` for a wrong type and for a missing entry).
    - _Requirements: 1.12, 1.13, 8.3_
  - [x] 2.5 Add fast-check arbitraries for the new payloads
    - Extend `packages/core/src/test-support/arbitraries.ts` with arbitraries for valid `BoneOrderingQuestion`, `BoundThreadsQuestion`, `CursedObjectQuestion` and `CombinationDialQuestion` (kinds `exact`, `range`, `tolerance`) and for the hints that `narrowHint` accepts per type.
    - Later tasks only import these; they do not edit the file.
    - _Requirements: 13.1, 13.11_

- [x] 3. Interaction models and property tests (Phase 1, one pair of tasks per type)
  - [x] 3.1 Add `locks/bone-ordering-interaction.ts` and its unit test
    - Export `BoneOrderingDraft`, `initBoneOrderingDraft(payload, hint, seed)`, `moveBone(draft, boneId, direction)` and `boneOrderingSubmission(draft)`.
    - Initial order via `displayOrderAvoiding` against `keyOrder`. With `lock-first-bone`, the pinned bone sits at its key index and the others avoid the key order. A move past an end, of an unknown ID or of the pinned bone returns the draft unchanged; the pinned bone never leaves its index.
    - Write `bone-ordering-interaction.test.ts` for these cases and for "no export returns `keyOrder`".
    - _Requirements: 3.3, 3.4, 3.6, 3.7, 3.8, 3.16, 3.17_
  - [x] 3.2 Write property tests for bone ordering
    - **Property 1: Judge agreement** (driving moves to `keyOrder` is judged `correct`, other permutations `wrong`, with and without a hint)
    - **Property 3: Display_Order avoids the key** (initial draft differs from `keyOrder`; with a hint the pin holds its key index)
    - **Property 4: Bone moves are bounded and keep the pin**
    - **Validates: Requirements 3.3, 3.4, 3.7, 3.8, 4.13**
    - _Requirements: 4.13_
  - [x] 3.3 Add `locks/bound-threads-interaction.ts` and its unit test
    - Export `BoundThreadsDraft`, `ThreadRefusal`, `TieResult`, `initBoundThreadsDraft`, `selectLeft`, `tieRight`, `undoThread` and `boundThreadsSubmission(draft, leftIds)`.
    - `rightOrder` from `displayOrderAvoiding` so no right item stands on its key partner's row. Threads are checked for uniqueness on both sides before insertion. Refusals are typed (`already-tied`, `no-left-selected`). A hinted pair is pre-tied and `undoThread` leaves it. The submission is `{ ready: false }` while any left item is untied.
    - Write `bound-threads-interaction.test.ts` for these cases and for "no export returns `keyPairs`".
    - _Requirements: 3.5, 3.6, 3.9, 3.10, 3.11, 3.16, 3.17_
  - [x] 3.4 Write property tests for bound threads
    - **Property 1: Judge agreement** (tying every key pair is `correct`, any other complete one-to-one matching is `wrong`)
    - **Property 2: Bound threads stay one-to-one** (random select, tie and undo sequences, including on tied, refused and hinted items; the hinted pair is never removed)
    - **Property 3: Display_Order avoids the key** (no right item on its key partner's row)
    - **Validates: Requirements 3.5, 3.9, 3.10, 3.11, 5.14, 5.15**
    - _Requirements: 5.14, 5.15_
  - [x] 3.5 Add `locks/combination-dial-interaction.ts` and its unit test
    - Export `CombinationDialDraft`, `initCombinationDialDraft(payload)`, `wheelsOf`, `stepWheel`, `setTypedEntry` and `combinationDialSubmission`.
    - The text is the only stored value. `integerWheels` is at least 3 and at least the integer digits of the largest stated number; `hasTenths` only when a stated number has a decimal place. `wheelsOf` uses the same tolerant number reading as `locks/combination-dial.ts`. `stepWheel` wraps only its own Wheel and keeps a leading minus. The submission is `{ ready: false }` for empty trimmed text. No export returns a payload number.
    - Write `combination-dial-interaction.test.ts` for these cases.
    - _Requirements: 3.6, 3.12, 3.13, 3.14, 3.16, 3.17_
  - [x] 3.6 Write property tests for the combination dial
    - **Property 1: Judge agreement** (for `exact`, `range` and `tolerance`, an accepted value is `correct`, a value outside the accepted set is `wrong`)
    - **Property 5: Dial text and Wheels agree** (`wheelsOf(setTypedEntry(draft, text))` matches the digits of the text; step up then down returns the same text; a step wraps only its own Wheel)
    - **Validates: Requirements 3.12, 3.14, 6.15, 6.16**
    - _Requirements: 6.15, 6.16_
  - [x] 3.7 Add `locks/cursed-object-interaction.ts` and its unit test
    - Export `CursedObjectDraft`, `initCursedObjectDraft(hint)`, `chooseItem`, `clearChoice` and `cursedObjectSubmission`. `chooseItem` returns the draft unchanged for the removed item. The submission is `{ ready: false }` while nothing is chosen. No export returns `oddOneOutId`.
    - Write `cursed-object-interaction.test.ts` for these cases.
    - _Requirements: 3.6, 3.15, 3.16, 3.17_
  - [x] 3.8 Write property tests for the cursed object
    - **Property 1: Judge agreement** (choosing `oddOneOutId` is `correct`, any other enabled item `wrong`)
    - **Property 6: Cursed object never submits the removed item**
    - **Validates: Requirements 3.15, 7.9, 7.10**
    - _Requirements: 7.9, 7.10_
  - [x] 3.9 Write the totality property test across the four models
    - **Property 7: Interaction models are total** (any draft and any input to any operation returns a typed value and does not throw; unknown IDs, out-of-range wheel indexes and empty text included)
    - **Validates: Requirements 3.17**
    - _Requirements: 3.17_

- [x] 4. Lock panels and keyboard-only tests (Phase 1, one pair of tasks per type, buildable in parallel after task 2 and 3)
  - [x] 4.1 Implement `bone-ordering-panel.tsx`
    - In `apps/web/src/features/crypt/`, follow `RuneCipherPanel` and `SeanceBoardPanel`. Read context for dispatch, rejection, content, `appliedHintFor` and the announcer, and read the payload through `useLockPayload`.
    - `<ol>` of bones with "Move up" and "Move down" buttons named by `boneMoveName`. Alt+Arrow moves the focused bone, plain Arrow moves focus (roving tabindex). A visible line names the shortcut. The pinned bone shows "Fixed by hint" with both buttons disabled. "Submit answer" dispatches `{ order }`. Draft lives in `useState` only. Do not import `lock-panel-registry.ts`; do not register the panel yet.
    - Show `payloadMissing` and `itemTextMissing` strings where needed. Keep Skip and Challenge working. File at or below about 300 lines.
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8, 4.9, 4.10, 4.11, 4.12, 8.1, 8.3, 8.4, 8.5, 8.6, 8.7, 8.12_
  - [x] 4.2 Write `bone-ordering-panel.test.tsx` (keyboard only)
    - Using the test-support provider, complete a correct and a wrong answer with Tab, Alt+Arrow and Enter only, and no pointer events. Check the announced position text, the pinned bone staying fixed, the empty-draft remount when the question changes, and the `payloadMissing` fallback.
    - **Property 8: Panels do not show the key before judging** (the DOM shows the Display_Order, not `keyOrder`)
    - **Validates: Requirements 4.1, 13.9**
    - _Requirements: 13.2, 13.9_
  - [x] 4.3 Implement `bound-threads-panel.tsx`
    - Left column in manifest order, right column in `rightOrder`. Left buttons use `aria-pressed`. Each item shows a text state (untied, selected, tied to a named partner). A list of tied threads with "Undo" buttons named for both items. A hinted pair shows "Tied by hint" and no Undo. Refusals show a message line. "Submit answer" dispatches `{ pairs }`, or shows the "tie every item" message and dispatches nothing. Announce each change through the existing announcer.
    - Do not register the panel yet. File at or below about 300 lines.
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 5.8, 5.9, 5.10, 5.11, 5.12, 5.13, 8.1, 8.3, 8.4, 8.5, 8.6, 8.7, 8.12_
  - [x] 4.4 Write `bound-threads-panel.test.tsx` (keyboard only)
    - Complete a correct and a wrong matching, undo and retie a thread, using Tab and Enter only. Check that the hinted pair has no Undo button, that a right item with no left selected shows the refusal message, and that an untied left item blocks submission with a message.
    - **Property 8: Panels do not show the key before judging** (no `keyPairs` pairing in the DOM)
    - **Validates: Requirements 5.1, 13.9**
    - _Requirements: 13.2, 13.9_
  - [x] 4.5 Implement `combination-dial-panel.tsx`
    - Wheel row with Increase and Decrease buttons named by `wheelName`, a visible unit from the payload, and a labelled `<input type="text" inputMode="decimal">`. Up and Down arrows step a Wheel, Left and Right move focus. Enter in the input submits `{ rawInput }`. Empty text shows the "type a number" message and dispatches nothing. An `invalid-submission` rejection shows the digits message and keeps the draft. When the hint had no effect, show "no hint to give". Show no payload number except the unit.
    - Do not register the panel yet. File at or below about 300 lines.
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 6.8, 6.9, 6.10, 6.11, 6.12, 6.13, 6.14, 8.1, 8.3, 8.4, 8.5, 8.6, 8.7, 8.12_
  - [x] 4.6 Write `combination-dial-panel.test.tsx` (keyboard only)
    - Complete a correct value by stepping Wheels only, then by typing only, and a wrong value, using Tab, arrow keys and Enter. Check the visible unit, the empty-text message, the `invalid-submission` message with the draft kept, and the "no hint to give" line.
    - **Property 8: Panels do not show the key before judging** (no dial value from the payload in the DOM; the unit excepted)
    - **Validates: Requirements 6.11, 13.9**
    - _Requirements: 13.2, 13.9_
  - [x] 4.7 Implement `cursed-object-panel.tsx`
    - A `role="radiogroup"` of radio inputs with a visible group label, arrow keys moving to the next enabled item. The removed item shows its text label and is disabled and skipped by arrow keys. "Submit answer" dispatches `{ selectedId }`, or shows the "choose an item" message and dispatches nothing.
    - Do not register the panel yet. File at or below about 300 lines.
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7, 7.8, 8.1, 8.3, 8.4, 8.5, 8.6, 8.7, 8.12_
  - [x] 4.8 Write `cursed-object-panel.test.tsx` (keyboard only)
    - Complete a correct and a wrong choice with Tab, Arrow and Enter only. Check that the removed item is disabled and unreachable by arrow keys, and that submitting with nothing chosen shows the message.
    - **Property 8: Panels do not show the key before judging** (no `oddOneOutId` marker in the DOM)
    - **Validates: Requirements 7.1, 13.9**
    - _Requirements: 13.2, 13.9_

- [ ] 5. Manifest widening (Phase 1)
  - [ ] 5.1 Add the three payload schemas to `runtime/manifest-schema.ts`
    - First run `git pull --rebase` and check that the Other_Machine has not changed the same lines of `manifest-schema.ts`, `manifest-hints.ts` or `mapper/crypt-bundle-parse.ts`. Report any collision before editing.
    - Add `BoundThreadsPayloadSchema`, `CursedObjectPayloadSchema` and `CombinationDialPayloadSchema` exactly as designed and make `payloadSchemaFor` return them. Keep the existing limits and the `manifest-schema-invalid` error shape.
    - Extend `manifest-schema.test.ts` with an accept case and a corrupted case per type (wrong arity, non-one-to-one `keyPairs`, `oddOneOutId` not in `optionIds`, `min > max`, negative `tolerance`, non-finite number), and a check that the error holds a path and no payload content.
    - _Requirements: 2.1, 2.2, 2.3, 2.8, 2.9, 2.12, 2.13_
  - [ ] 5.2 Add the `narrowHint` branches in `runtime/manifest-hints.ts`
    - `bound-threads`: only `tie-thread` with a pair from `keyPairs`, or `null`. `cursed-object`: only `remove-option` with an ID in `optionIds` that is not `oddOneOutId`, or `null`. `combination-dial`: only `null`.
    - Extend the hint tests with accept and reject cases for each branch, including a non-null hint on a combination dial question and an unknown pair or option.
    - _Requirements: 2.4, 2.5, 2.6, 2.13_
  - [ ] 5.3 Write property tests for the manifest
    - **Property 9: Manifest round trip for the three new payloads** (JSON round trip through the Manifest_Schema gives an equal manifest)
    - **Property 10: Hint narrowing** (for all six types, accepted hints pass the schema; other kinds, unknown pairs or options and a `remove-option` of `oddOneOutId` are rejected)
    - **Validates: Requirements 2.4, 2.5, 2.6, 2.10, 2.11**
    - _Requirements: 2.10, 2.11, 13.8, 13.11_
  - [ ] 5.4 Check that the Crypt_Bundle_Parser needs no change
    - Add a test in `crypt-bundle-parse.test.ts` with a bundle that holds a `bound-threads`, a `cursed-object` and a `combination-dial` question (the last with no `options`) and assert that `parseCryptBundle` accepts it unmodified.
    - Only if the test fails, make the smallest change to `mapper/crypt-bundle-parse.ts` or `mapper/crypt-content.ts` and report it to the user.
    - _Requirements: 2.7, 2.12_

- [x] 6. Checkpoint - Phase 1
  - Run only the targeted test files of tasks 2 to 5 (display-order, accessible-names, copy, payload hook, four interaction tests, four panel tests, manifest tests, bundle-parse test), then `pnpm typecheck` and `pnpm lint`. Confirm the structure check passes.
  - Run `git pull --rebase` immediately before committing. Ensure all tests pass, ask the user if questions arise.
  - _Requirements: 14.1, 14.6, 1.3_

- [x] 7. HOLD: wait for the user's go-ahead
  - Ask the user, with the `user_input` tool, to confirm that the Other_Machine's multi-room play and rune letter count work is pushed.
  - Do not start task 8 or any later task, and do not edit any Shared_Panel_File, until the user says yes. If the user says it is not pushed, stop and report that Phase 2 is waiting.
  - _Requirements: 1.11, 1.14_

- [x] 8. Registry, payload access and unplayable path (Phase 2, after the go-ahead)
  - [x] 8.1 Pull and re-read the six shared files
    - Run `git pull --rebase`; on a conflict, stop and report. Re-read `room-screen.tsx`, `art-room.ts`, `question-controls.tsx`, `rune-cipher-panel.tsx`, `room-panel.tsx` and `lock-panel-context.ts`, `lock-panel-registry.ts`, `question-panel.tsx` and `final-door.tsx`. Report differences from the design's assumptions and note the smallest edit each later task needs.
    - _Requirements: 1.14, 1.8_
  - [x] 8.2 Add `payloadFor` and switch the payload hook to it
    - Add the read-only `payloadFor(slotId, questionId)` accessor to `LockPanelContextValue` in `lock-panel-context.ts`, and supply it at the single call site in `room-panel.tsx` from the manifest it already holds (primary and Alternate). Make the smallest change; leave multi-room behaviour and the rune letter count alone.
    - Make `useLockPayload` read `payloadFor` and remove `LockPayloadContext`. Update the test-support provider so it supplies `payloadFor` through the test-local `LockPanelContext` value. The panel files and their tests keep working through the provider.
    - Write a unit test that `payloadFor` returns the primary question's payload and the Alternate's payload after a seal crack, and `null` for an unknown ID.
    - _Requirements: 1.9, 1.14, 8.8_
  - [x] 8.3 Register the four panels in `lock-panel-registry.ts`
    - Add `'bone-ordering'`, `'bound-threads'`, `'combination-dial'` and `'cursed-object'` entries so that `LOCK_PANELS` has one panel per lock type.
    - _Requirements: 8.2, 9.1_
  - [x] 8.4 Remove the unplayable path for the four types and keep it for unknown types
    - Check `question-panel.tsx` and `final-door.tsx`: a question of any of the six types renders its Lock_Panel. `UnplayablePanel`, `ROOM_PLAY_LABELS.unplayableType` and the fallback branch stay for a type string that is not a key of the registry. Edit only if the re-read shows a type-specific branch.
    - Add a unit test that renders an Unknown_Type in the Room_Screen and in the final door and finds the Unplayable_Panel message and its Skip button.
    - _Requirements: 9.2, 9.3, 9.4, 9.5_
  - [x] 8.5 Write the registry-completeness test
    - In `lock-panel-registry.test.ts`, assert that `Object.keys(LOCK_PANELS).sort()` equals `[...LOCK_TYPES].sort()`.
    - _Requirements: 9.1, 9.6_
  - [x] 8.6 Update stale unplayable tests
    - Find every existing test (room-screen, final-door, question-panel and panel suites, and any e2e file) that expects the unplayable message for bone ordering, bound threads, combination dial or cursed object, and change it to expect that type's Lock_Panel. Do not touch tests for an unknown type.
    - _Requirements: 9.7_
  - [x] 8.7 Write the art, hotspot and close-up tests
    - Extend the existing art-presence test: for each new type, `locks/<type>/closed.webp`, `closed@2x.webp`, `open.webp` and `open@2x.webp` exist, and each Art_Room scene file lists the lock with its four Lock_Layer files and the Light_Pass file.
    - Extend the hotspot CSS test so the four lock buttons have a transparent background, border width 0 and a 44 by 44 px minimum. Extend `lock-closeup.test.tsx` for the four types (closed for an open slot, open for a solved slot, one logged error on a failed load).
    - Add no image and edit nothing under `apps/web/public/art/`.
    - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.5, 10.6, 10.7, 10.8_

- [x] 9. Checkpoint - Phase 2
  - Run only the targeted tests of task 8 and the panel tests from task 4 (now through the registry-backed context), then `pnpm typecheck` and `pnpm lint`.
  - Run `git pull --rebase` immediately before committing. Ensure all tests pass, ask the user if questions arise.
  - _Requirements: 14.1, 14.6, 1.3_

- [x] 10. Mapper gate (Phase 3, first task)
  - Run `git pull --rebase`; on a conflict, stop and report.
  - Read `packages/core/src/mapper/manifest-mapper.ts` and confirm it has an arm for each of `bone-ordering`, `bound-threads`, `cursed-object` and `combination-dial`, and that the output for each matches the "Item texts" table of the design (item texts in `content.questions[id].options` keyed by payload IDs; none for the dial).
  - If any arm is missing, or the output shape differs, STOP. Report the missing types or the difference to the user. Do not add a local mapper, a sample-only mapping or any workaround, and do not start task 11 or later.
  - _Requirements: 1.15, 1.16, 11.1, 11.4, 12.6_

- [x] 11. Widen manifest limits or the bundle parser only if the samples need it (Phase 3)
  - Only if a sample layout in the design cannot pass `validateManifestForPublish` or `parseCryptBundle` with the mapper's output, make the smallest change to the manifest limits or, as Requirement 2.7 allows, to `mapper/crypt-bundle-parse.ts` or `mapper/crypt-content.ts`. Add a test for the change and report it to the user.
  - If no change is needed, record "no change needed" in the task output and edit nothing.
  - _Requirements: 2.7, 2.8, 2.13_

- [x] 12. Human-heart sample widened to six types (Phase 3) (closed by decision: not widened, human-heart stays the two-type starter)
  - [x] 12.1 Widen `sample-crypt/human-heart.ts` (not done by decision)
    - Read `samples/questions/human-heart.json`, then set the fixed selection tables to the design's layout: two rooms with two Lock_Slots each (rune-cipher and séance-board; bone-ordering and bound-threads) and a final door with cursed-object, combination-dial and one more question. Choose the question IDs by reading the file; add Alternates of a different type where the file holds suitable questions.
    - Build every question through the Core_Mapper. Keep `status` as a draft value. Return a typed error that names the question ID if a quote does not resolve. Split a `human-heart-layout.ts` constants file if the builder passes about 300 lines.
    - _Requirements: 12.1, 12.2, 12.4, 12.5, 12.6, 12.8, 12.17, 15.5_
  - [x] 12.2 Update `human-heart.test.ts` and dependent tests and fixtures (not needed: the shape is unchanged)
    - Update every test, fixture and e2e file that assumes one room, two Lock_Slots and three final-door questions (including `apps/web/src/test-support/` bundle fixtures and any Playwright helper that reads only `hh-slot-1` and `hh-slot-2`).
    - Add a property test: **Property 11: Sample crypts are complete, resolvable and escapable** for this sample (passes `validateManifestForPublish` and `parseCryptBundle`, all six types present, every `evidenceRefs` ID is an excerpt chunk ID, every quote resolves, options entries match payload IDs with display text and none for the dial, skipping every question reaches `escaped`).
    - **Validates: Requirements 11.5, 12.2, 12.3, 12.14, 12.15**
    - _Requirements: 11.5, 11.6, 12.3, 12.13, 12.14, 12.15_

- [x] 13. HTTPS sample (Phase 3)
  - [x] 13.1 Add the rune cipher question to `samples/questions/https.json`
    - Read `samples/https.txt` and the existing questions. Add one `rune-cipher` question with `role: primary`, its own concept, a `draft` status and a short exact quote from the notes. Check that the quote resolves against its paragraph before using it. Leave existing concepts and roles as authored.
    - _Requirements: 12.7, 12.8_
  - [x] 13.2 Add `sample-crypt/https.ts`
    - Follow `human-heart.ts`: fixed room and final-door selection tables per the design (bone-ordering and cursed-object; bound-threads and rune-cipher; final door with combination-dial, combination-dial or another, and séance-board), a fixed concept-title table, `buildHttpsSampleCrypt(notesText, questionsFile)` returning the typed result, every question through the Core_Mapper. Choose IDs by reading the file. File at or below about 300 lines.
    - _Requirements: 12.1, 12.2, 12.4, 12.5, 12.6, 12.8, 12.17, 15.5_
  - [x] 13.3 Write `https.test.ts`
    - **Property 11: Sample crypts are complete, resolvable and escapable** for the HTTPS sample, including the new rune question and a corrupted-payload case that the schema rejects.
    - **Validates: Requirements 11.5, 12.2, 12.3, 12.14, 12.15**
    - _Requirements: 11.5, 12.3, 12.14, 12.15, 13.8_

- [x] 14. Printing-press sample (Phase 3)
  - [x] 14.1 Add `sample-crypt/printing-press.ts` and `printing-press.test.ts`
    - Same shape as task 13.2 and 13.3, with the layout from the design (bone-ordering and cursed-object; bound-threads and rune-cipher; final door with a bound-threads or combination-dial question, combination-dial and séance-board). Fixed selection and concept-title tables, every question through the Core_Mapper, draft status.
    - Test **Property 11: Sample crypts are complete, resolvable and escapable** for this sample.
    - **Validates: Requirements 11.5, 12.2, 12.3, 12.14, 12.15**
    - _Requirements: 12.1, 12.2, 12.3, 12.4, 12.5, 12.6, 12.8, 12.14, 12.15, 12.17, 15.5_

- [x] 15. Sample registry and sample sources (Phase 3)
  - [x] 15.1 Add the Sample_Registry in `packages/core/src/sample-crypt/sample-registry.ts`
    - Export `SampleId`, `SampleSources`, `SampleBuilder`, `UnknownSampleError`, `SAMPLE_IDS` and `getSampleBuilder(id)`, which returns a builder for each of `human-heart`, `https` and `printing-press` and a typed `unknown-sample` error for any other string, never a default.
    - Write `sample-registry.test.ts`: a builder for each ID in `SAMPLE_LIST`, `SAMPLE_IDS` equals the IDs of `SAMPLE_LIST`, a typed error for an unknown ID. Do not edit `sample-list.ts`.
    - _Requirements: 12.9, 13.12_
  - [x] 15.2 Add `apps/web/src/features/crypt/sample-sources.ts`
    - Import the raw notes and question files of all three samples at build time (as `state/sample-crypt-source.ts` does for human-heart) and export `buildCryptForSample(id): BuildCrypt` in the shape that `useRoomBinding` already accepts. No picker, no start-view control, no crypt-flow edit and no edit under `apps/web/src/state/`. Nothing leaves the origin.
    - Write a unit test that `buildCryptForSample` builds a crypt for each sample ID and returns a typed error for an unknown ID. Add a code comment that resume of an https or printing-press run fails with the existing `record-unreadable` error.
    - _Requirements: 12.9, 12.10, 12.11, 12.12, 15.3_

- [x] 16. Checkpoint - Phase 3
  - Run only the targeted tests of tasks 11 to 15, then `pnpm typecheck` and `pnpm lint`. Confirm the structure check passes.
  - Report to the user that resume of a saved https or printing-press run returns `record-unreadable` because `restoreRun` in `apps/web/src/state/` rebuilds only human-heart, and that the Sample_Hub wiring that passes the chosen ID to `buildCryptForSample` is the hub integration's job.
  - Run `git pull --rebase` immediately before committing. Ensure all tests pass, ask the user if questions arise.
  - _Requirements: 12.12, 14.1, 14.6, 1.3_

- [x] 17. Playwright per lock type (Phase 4)
  - [x] 17.1 Write the bone ordering e2e test
    - Open the lock, answer correctly by keyboard (Tab, Alt+Arrow, Enter), check the Evidence_Panel shows the excerpt, explanation and "Source excerpt matched". Run on `chromium`, `firefox` and `pixel`. On `pixel`, answer by tap and check every control is at least 44 by 44 px.
    - _Requirements: 13.3, 13.4_
  - [x] 17.2 Write the bound threads e2e test
    - Same checks as 17.1 for the select, tie and undo flow.
    - _Requirements: 13.3, 13.4_
  - [x] 17.3 Write the combination dial e2e test
    - Same checks as 17.1, using the Wheels and the typed entry.
    - _Requirements: 13.3, 13.4_
  - [x] 17.4 Write the cursed object e2e test
    - Same checks as 17.1 for the radio group.
    - _Requirements: 13.3, 13.4_

- [x] 18. Accessibility checks (Phase 4)
  - [x] 18.1 Write the axe check for each new panel
    - Follow `crypt-axe.e2e.ts`: open each of the four Lock_Panels and assert no axe violations.
    - _Requirements: 13.5_

- [x] 19. Sample crypt end-to-end (Phase 4)
  - [x] 19.1 Write the all-correct escape test for each sample
    - For `human-heart`, `https` and `printing-press`: start the run through `buildCryptForSample` (the same path the Sample_Hub uses; no picker), answer every question correctly with answers read from the manifest in test code and not from the screen, and reach `escaped`. Put shared helpers in a new helper file.
    - **Property 11: Sample crypts are complete, resolvable and escapable**
    - **Validates: Requirements 12.15**
    - _Requirements: 13.6, 12.15_
  - [x] 19.2 Write the all-skipped escape test for each sample
    - For the same three samples, skip or challenge every question and reach `escaped`. Reuse the helpers from 19.1.
    - **Property 11: Sample crypts are complete, resolvable and escapable**
    - **Validates: Requirements 12.15**
    - _Requirements: 13.6, 12.15_

- [x] 20. Final checkpoint
  - Run `git pull --rebase`. Run the full Vitest suite with `pnpm test -- --maxWorkers=50%` and the full Playwright suite with `pnpm e2e -- --workers=2`. Run `pnpm lint`, `pnpm typecheck` and the structure check.
  - Append one row per run to `docs/build-log.md` with the real pass, fail and skip counts, failures included.
  - Run `git pull --rebase` immediately before committing. Ensure all tests pass, ask the user if questions arise.
  - _Requirements: 14.2, 14.3, 14.5, 14.6, 1.3_

## Notes

- Test sub-tasks are not marked optional because Requirement 13 makes them mandatory.
- Each property test cites its design Property number and the requirements it validates.
- No task adds a sample picker, a sample-only mapping layer or a local mapper, and no task calls an AI provider or uses a cassette.
- No task adds the labels "Human-reviewed" or "Blind model review passed".
- Task 7 is a hard stop. Task 10 is a hard stop if a mapper arm is missing.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["2.1", "2.2", "2.3", "2.4", "2.5"] },
    { "id": 2, "tasks": ["3.1", "3.3", "3.5", "3.7", "5.1"] },
    { "id": 3, "tasks": ["3.2", "3.4", "3.6", "3.8", "4.1", "4.3", "4.5", "4.7", "5.2"] },
    { "id": 4, "tasks": ["3.9", "4.2", "4.4", "4.6", "4.8", "5.3", "5.4"] },
    { "id": 5, "tasks": ["6"] },
    { "id": 6, "tasks": ["7"] },
    { "id": 7, "tasks": ["8.1"] },
    { "id": 8, "tasks": ["8.2"] },
    { "id": 9, "tasks": ["8.3", "8.4", "8.7"] },
    { "id": 10, "tasks": ["8.5", "8.6"] },
    { "id": 11, "tasks": ["9"] },
    { "id": 12, "tasks": ["10"] },
    { "id": 13, "tasks": ["11"] },
    { "id": 14, "tasks": ["12.1", "13.1", "14.1"] },
    { "id": 15, "tasks": ["12.2", "13.2"] },
    { "id": 16, "tasks": ["13.3"] },
    { "id": 17, "tasks": ["15.1"] },
    { "id": 18, "tasks": ["15.2"] },
    { "id": 19, "tasks": ["16"] },
    { "id": 20, "tasks": ["17.1", "17.2", "17.3", "17.4", "18.1"] },
    { "id": 21, "tasks": ["19.1"] },
    { "id": 22, "tasks": ["19.2"] },
    { "id": 23, "tasks": ["20"] }
  ]
}
```
