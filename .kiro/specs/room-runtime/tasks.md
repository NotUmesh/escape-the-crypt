# Implementation Plan: room-runtime

## Overview

This plan builds the pure room runtime in `packages/core` (TypeScript, strict, Vitest, fast-check). It follows the phasing in `docs/briefs/room-runtime-spec-brief.md` section 7 as adjusted by the author. Each top-level task can be committed on its own and ends with a verification sub-task that runs `pnpm --filter @escape-the-crypt/core exec vitest run ...`, `pnpm lint` and `pnpm typecheck`.

All paths are under `packages/core/src/` unless stated otherwise. File names follow `design.md`. No file may exceed about 300 lines; split by responsibility. No test calls a real AI provider. No task is optional.

Ordering notes where the fixed phasing and the code dependencies meet:

- Escape needs the Final_Door (task 6) and Concept outcomes need `outcomes.ts` (task 7). So the parts of properties that need them are completed in the task that first makes them testable: the escape bound of Property 1 in sub-task 6.9, Property 10 in sub-task 7.4, and Property 9 parts (b) and (c) in sub-task 7.5. Task 5 builds the harness and completes Properties 6 and 15 and the room-play part of Property 1.
- Named sequences "all wrong" and "all challenged" are written in task 4 and assert slots, ghosts and candles. Their escape and Autopsy outcome assertions are added in 6.5 and 7.6.
- Properties 2, 8 and 14 are written in task 3 as standalone fast-check tests (own files). Sub-task 5.1 folds the same invariants into the `fc.commands` model.
- Property 5 is written in task 1 for the skeleton and re-checked for every event kind by the model harness in 5.1.
- Property 13 is in task 1, where the Manifest_Check first exists.

## Tasks

- [x] 1. Types, fixture builder, manifest check, reducer skeleton and serialisation test
  - [x] 1.1 Define shared types
    - In `types.ts` add `LockType`, `JudgeResult`, `HintEffectSpec`, `ThreadPair`, the `Event` union (all 14 variants), `RuntimeErrorKind`, `Typed_Rejection`. `HintEffectSpec` and `ThreadPair` live here so `locks/` depends only on `types.ts`.
    - In `runtime/manifest-types.ts` add `CryptManifest`, `RoomSpec`, `LockSlotSpec`, `QuestionSpec`, `FinalDoorSlotSpec`, `RunSettings`.
    - In `runtime/state-types.ts` add `State`, `RoomState`, `LockSlotState`, `ReturnSlotState`, `FinalDoorSlotState`, `FinalDoorState`, `GhostState`, `SpiritCandleState`, `ConceptRecord`, `AppliedHintState`, `SlotStatus`, `ConceptOutcome`, `RunStatus`.
    - In `runtime/notices.ts` add the `Outcome_Notice` type only (ordering logic comes in 3.1).
    - All types are plain JSON shapes: no `Set`, `Map`, `Date`, function or `undefined`.
    - _Requirements: 3.2, 4.1, 4.2, 6.1, 27.1, 27.2, 29.3, 31.12_

  - [x] 1.2 Implement the Manifest_Check
    - Create `runtime/manifest-check.ts` and `runtime/manifest-check.test.ts`.
    - Accept only when each room holds at most one Lock_Slot per Station_Type; exempt the Final_Door; ignore Return_Slots; return `{ ok: false, error: { kind: 'invalid-manifest', room, lockType } }` for the first room and first repeated type; also reject a lock type outside `LockType`; never throw.
    - Also require every QuestionSpec (primary, Alternate, reserved final-door) to carry a non-empty `questionId`, unique within the manifest. A missing or empty one returns `{ ok: false, error: { kind: 'invalid-manifest', questionId: '', slotId } }`; the first duplicate returns `{ kind: 'invalid-manifest', questionId }`. Passes run in order: lock types, then Station_Types, then question IDs, so a repeated Station_Type is reported before a duplicate `questionId`.
    - Unit tests: the exact error shape, Final_Door repeats allowed, unknown lock type, empty rooms, malformed input; missing or empty `questionId` on a primary, an Alternate and a reserved final-door question; a `questionId` duplicated between a primary and an Alternate, across two rooms, and between a room question and a reserved question; a manifest with both a repeated Station_Type and a duplicate `questionId` reports the Station_Type error.
    - _Requirements: 27.4, 28.1, 28.2, 28.3, 28.4, 28.5, 28.6, 28.8, 28.9, 28.10_

  - [x] 1.3 Implement the Fixture_Builder and manifest arbitraries
    - Create `test-support/manifest-fixture.ts` with `buildManifest(options)` and `test-support/manifest-fixture.test.ts`.
    - Options: rooms 1 to 5, concepts per room 1 to 6 with distinct primary types per room, alternate yes/no per concept, question lock types, optional `hintEffect` per primary, Alternate and reserved final-door question, optional `lockTypes` list (default all six), optional seed. Same options give the same manifest. Fictional content only. Alternates differ in type from the primary. Final door has 2 to 4 full `FinalDoorSlotSpec`s across rooms. Every primary, Alternate and reserved question gets a non-empty `questionId` that is unique within the manifest (generated from a counter).
    - With a `lockTypes` list shorter than six, cap concepts per room at the list length; with one type, build no Alternates.
    - Extend `test-support/arbitraries.ts` with `manifestArb` (all six types, a share of 4 to 6 slot rooms, plain JSON payloads, every `questionId` unique) and `eventArb`.
    - Tests: every built and generated manifest passes `manifestCheck`; every `questionId` is non-empty and unique in built and generated manifests; determinism; the `lockTypes` cap and single-type rules.
    - _Requirements: 25.1, 25.2, 25.3, 25.4, 25.5, 25.6, 25.7, 25.8, 25.9, 25.10, 25.11, 25.12, 25.13, 20.1_

  - [x] 1.4 Implement the reducer skeleton with typed rejections
    - Create `runtime/initial.ts`, `runtime/apply.ts`, `runtime/handlers-run.ts` (only `RunStarted` for now), `runtime/index.ts`, with `initial.test.ts`, `apply.test.ts` and `handlers-run.test.ts`.
    - `initial(manifest, settings)` returns status "not started", zero candles, no ghosts, no room entered; it never throws and never runs the Manifest_Check, even for a bad manifest.
    - `apply` returns `{ ok, state, notices }` or `{ ok: false, error }`. Guards: `malformed-event` (unknown type or lock type not in `LockType`), `run-not-started` (before `RunStarted`, except `RoomPublished`, `CryptFinalised`, `CryptShortened`), `run-finished`, `run-left`, `unknown-reference`, `lock-already-settled`. Other event kinds are dispatched to handlers added in later tasks and return `malformed-event`-free placeholders only until then; do not leave orphaned code, so wire each new handler through `apply.ts` in the task that adds it.
    - `RunStarted`: `manifest-mismatch`, `run-already-started`, run the Manifest_Check and return its `invalid-manifest` error with State unchanged, otherwise record settings, set "in progress", set remaining hints from the allowance.
    - New State object on success, input never mutated, no exceptions for any input.
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 3.1, 3.3, 3.4, 3.5, 3.6, 3.7, 5.1, 5.2, 5.3, 27.3, 28.7_

  - [x] 1.5 Write property test for one lock per type per room
    - In `runtime/manifest-check.test.ts`.
    - Also assert unique, non-empty `questionId`s for accepted manifests, and that a missing or duplicated `questionId` is rejected with `invalid-manifest` carrying it.
    - **Property 13: One lock per type per room, unique question IDs**
    - **Validates: Requirements 25.12, 25.13, 28.1, 28.3, 28.8, 28.9, 28.10**

  - [x] 1.6 Write property test for invalid events as no-ops
    - New file `runtime/apply-properties.test.ts`. Generate arbitrary and malformed events against started and unstarted states; assert a typed rejection, State deep-equal to before, and no throw. Covers the event kinds handled so far; 5.1 extends it to every kind.
    - **Property 5: Invalid events are no-ops**
    - **Validates: Requirements 3.1, 3.6, 3.7**

  - [x] 1.7 Write the serialisation test
    - Create `runtime/serialisation.test.ts`. Build one example of every `Event` variant (and one `AnswerSubmitted` per lock type, bound-threads as tuple arrays) and assert `JSON.parse(JSON.stringify(e))` deep-equals `e`. Assert `eventArb` events and `initial(...)` State survive the same round trip, with no `Set`, `Map` or `undefined`.
    - _Requirements: 4.1, 4.2, 5.1_

  - [x] 1.8 Verify task 1
    - Run `pnpm --filter @escape-the-crypt/core exec vitest run src/runtime src/test-support`, `pnpm lint` and `pnpm typecheck`. All pass.
    - _Requirements: 1.7_

- [ ] 2. Six answer judges and the judge registry
  - [ ] 2.1 Implement the rune cipher judge
    - `locks/rune-cipher.ts` and `locks/rune-cipher.test.ts`. Trim, collapse spaces, case-insensitive unless flagged, exact match on answer or reviewed alias; empty after trim is invalid; never throws.
    - Tests: `"  Atrioventricular "` correct; "AV" correct as alias; "atrio-ventricular" wrong; "NA" wrong for case-sensitive "Na"; empty and whitespace-only invalid; a fast-check test that any string input returns a typed result.
    - _Requirements: 11.1, 11.2, 11.3, 11.4, 11.5, 11.6, 11.7, 11.8, 11.9_

  - [ ] 2.2 Implement the séance board judge
    - `locks/seance-board.ts` and `locks/seance-board.test.ts`. Signature `judge(question, submission, appliedHint)`. Key is correct; listed, not removed, not key is wrong; unlisted, null, or an option removed by an applied `remove-option` hint is invalid.
    - Tests: stale option ID from another question is invalid; hint-removed option is invalid; same submission judges normally with `appliedHint: null`; a hint of another kind is ignored.
    - _Requirements: 12.1, 12.2, 12.3, 12.4, 12.5, 12.6_

  - [ ] 2.3 Implement the bone ordering judge
    - `locks/bone-ordering.ts` and `locks/bone-ordering.test.ts`. Exact key is correct; another permutation is wrong; not a permutation (duplicates, missing items) is invalid; a submission that moves a bone locked by an applied `lock-first-bone` hint is invalid.
    - _Requirements: 26.1, 26.2, 26.9, 26.10_

  - [ ] 2.4 Implement the bound threads judge
    - `locks/bound-threads.ts` and `locks/bound-threads.test.ts`. Compare sorted, de-duplicated pair sets; equal is correct; every left item tied once but not the key is wrong; an untied left item is invalid; a missing pair tied by an applied `tie-thread` hint is invalid. Same pairs in any order give the same result.
    - _Requirements: 26.3, 26.4, 26.9, 26.10_

  - [ ] 2.5 Implement the cursed object judge
    - `locks/cursed-object.ts` and `locks/cursed-object.test.ts`. Odd one is correct; a listed object not removed by the hint and not the odd one is wrong; unlisted, null, or hint-removed is invalid.
    - _Requirements: 26.5, 26.9, 26.10_

  - [ ] 2.6 Implement the combination dial judge
    - `locks/combination-dial.ts` and `locks/combination-dial.test.ts`. Kinds `exact`, `range` (inclusive) and `tolerance` (value ± tolerance, inclusive). Parse `rawInput` as at most one decimal place, compare on integer tenths. Non-numeric or more than one decimal place is invalid.
    - Tests: `60` and `100` correct for 60 to 100; `59.9` wrong; `21.5` correct for exact 21.5; for 21.5 ± 0.5, `21.0` and `22.0` correct, `22.1` and `20.9` wrong, `22.15` invalid; `tolerance: 0`; one-decimal rule for each kind; non-numeric invalid.
    - _Requirements: 26.6, 26.7, 26.8, 26.9, 26.10_

  - [ ] 2.7 Implement the judge registry
    - `locks/judge-registry.ts` with the per-type question and submission types, the `Judge` interface and `judgeRegistry: Record<LockType, Judge>`; create `locks/lock-types.test.ts` asserting the registry has exactly the six `LockType` IDs, every lock file name matches an ID, and no other spelling appears.
    - _Requirements: 27.1, 27.2, 29.5_

  - [ ] 2.8 Verify task 2
    - Run `pnpm --filter @escape-the-crypt/core exec vitest run src/locks`, `pnpm lint` and `pnpm typecheck`. All pass.
    - _Requirements: 11.1, 26.9_

- [ ] 3. Single room: answers, evidence, skip, challenge, hints and candles
  - [ ] 3.1 Implement notices, room clearing and selectors
    - `runtime/notices.ts`: notice builders and one ordering list `candleLit, ghostLaidToRest, ghostSpawned, sealCracked, roomCleared, escaped`; `roomCleared` at most once per room. `runtime/room-clearing.ts`: the Cleared check (every Lock_Slot and due Return_Slot solved or settled), independent of correctness, leaving Lock_Slots unchanged. `runtime/selectors.ts`: read-only projections of every slot kind, ghosts, spirit candles, cleared flag, with `appliedHint` and `evidencePanelOpen`. Add `notices.test.ts`, `room-clearing.test.ts`, `selectors.test.ts`.
    - _Requirements: 19.1, 19.2, 19.3, 24.1, 24.2, 24.3, 24.4, 24.6, 24.7, 24.8, 29.1, 29.2, 29.3, 31.1, 31.2, 31.3, 31.4, 31.5, 31.6, 31.7, 31.8, 31.9, 31.10, 31.11, 31.12_

  - [ ] 3.2 Implement room and lock handlers for a single room
    - `runtime/handlers-room.ts` with `handlers-room.test.ts`: `RoomPublished` (idempotent no-op on a duplicate), `RoomEntered` for room 1 with `room-not-published`, and `LockOpened` (focus; `lock-not-in-room`, `lock-already-settled`). Wire into `apply.ts`. Order checks for later rooms are added in 6.1.
    - _Requirements: 7.1, 7.2, 8.1, 8.3, 9.1, 9.2, 9.3, 9.4_

  - [ ] 3.3 Implement answer submission and evidence
    - `runtime/handlers-answer.ts` with `handlers-answer.test.ts`. `AnswerSubmitted` resolves the applied hint only when it was recorded for the question shown, calls `judgeRegistry` for the Current_Question_Type, stores the result, opens the evidence panel, increments `judgedAnswerCount` for correct and wrong only. Correct: slot `solved`, `candleLit`, candle count plus one, `candleLit` notice naming the slot; set `ConceptRecord.hintUsedOnCorrectQuestion` to true only when the slot's applied hint was recorded for the question judged correct (Req 18.5). Wrong: slot `settled` (ghost spawning arrives in 4.2). Invalid: `invalid-submission`, State unchanged. Second judged submit on the same question: `lock-already-settled`. `EvidenceContinued` closes the panel or returns `no-evidence-open`. Judge result per event is a pure function of State and event; no model, network or service call. Wire into `apply.ts`.
    - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.5, 10.6, 10.7, 10.8, 10.9, 13.1, 13.2, 13.3, 13.4, 13.5, 15.4, 29.5, 31.3, 31.4_

  - [ ] 3.4 Implement hints
    - `runtime/handlers-hint.ts` with `handlers-hint.test.ts`. `HintUsed` on any open slot: reduce remaining hints, record `{ questionId, effect }` from the question shown. `HintUsed` writes no concept record field; the hint is recorded only on the slot. Assisted is decided at judging time (see 3.3): `hintUsedOnCorrectQuestion` is set only when the question judged correct had the hint applied. The spent hint is never refunded. Rejections: `no-hints-left`, `lock-already-settled`, `hint-already-used`. A question with `hintEffect: null` still consumes a hint. A hint on a question later replaced does not carry to the replacement. Wire into `apply.ts`.
    - Tests: after a hint on a primary question, `Challenged` leaves `remainingHints` unchanged (no refund) and the Alternate's slot has `appliedHint: null`; a hint on the Alternate is accepted afterwards (a different question); a correct answer on a hinted question sets `hintUsedOnCorrectQuestion`, a correct answer on an unhinted Alternate after a hinted challenged primary does not.
    - _Requirements: 18.1, 18.2, 18.3, 18.4, 18.5, 18.6, 18.7, 18.8_

  - [ ] 3.5 Implement skip and challenge for Lock_Slots
    - `runtime/handlers-skip-challenge.ts` with `handlers-skip-challenge.test.ts`. `Skipped` settles the slot, no candle, no ghost notice. `Challenged` with an unused Alternate replaces the question in place (Station_Type fixed, Current_Question_Type becomes the Alternate's, status stays `open`, applied hint cleared, `sealCracked`); with no Alternate, or on a replacement, status `challenged` and `sealCracked`. A challenge lights no candle, spawns no ghost and adds no wrong answer. Challenges are stored in the log and State only. Deferred returns, Review_Due_Flag and challenge on Return_Slots are added in 4.3. Wire into `apply.ts`.
    - _Requirements: 16.1, 16.2, 17.1, 17.2, 17.3, 17.5, 17.6, 17.7, 29.4, 31.2, 31.5_

  - [ ] 3.6 Write property test for candles
    - New file `runtime/runtime-candles-properties.test.ts`. Random event sequences over `manifestArb`; the candle count equals the number of correct judged answers on non-challenged questions, and no other event changes it.
    - **Property 2: Candles track non-challenged correct answers only**
    - **Validates: Requirements 13.1, 13.2, 13.3, 13.4**

  - [ ] 3.7 Write property test for hints
    - New file `runtime/runtime-hints-properties.test.ts`. Remaining hints never drop below 0; `HintUsed` on a solved or settled slot or a second hint on one question is rejected; a correct answer on a question that had a hint applied sets `hintUsedOnCorrectQuestion`; `Challenged` on a hinted question leaves `remainingHints` unchanged and the replacement Alternate has no applied hint; a hint on a challenged primary followed by a correct unhinted Alternate does not set `hintUsedOnCorrectQuestion`.
    - **Property 8: Hints stay within allowance and mark answers assisted**
    - **Validates: Requirements 18.1, 18.2, 18.3, 18.4, 18.5, 18.6, 18.7, 18.8, 22.7, 22.8, 22.11**

  - [ ] 3.8 Write property test for slot status and candle flag
    - New file `runtime/runtime-slots-properties.test.ts`. Status follows judged history; `candleLit` is true if and only if status is `solved`.
    - **Property 14: Slot status and candle flag follow judged history**
    - **Validates: Requirements 31.2, 31.3, 31.4, 31.5, 31.6**

  - [ ] 3.9 Write property test for challenge isolation, part (a)
    - In `runtime/runtime-properties.test.ts`. For a challenged Lock_Slot question: the event adds no wrong answer, lights no candle, spawns no ghost, leaves `judgedAnswerCount` and `candleCount` unchanged, and emits only `sealCracked` (plus `roomCleared` where it settles the last slot). Parts (b) and (c) need outcomes and are written in 7.5; the Return_Slot case is added in 4.7.
    - **Property 9: Challenging is free, isolated and follows the outcome precedence** (part a)
    - **Validates: Requirements 17.1, 17.2, 17.3, 17.5, 17.7**

  - [ ] 3.10 Verify task 3
    - Run `pnpm --filter @escape-the-crypt/core exec vitest run src/runtime src/locks`, `pnpm lint` and `pnpm typecheck`. All pass.
    - _Requirements: 1.7, 13.4_

- [ ] 4. Ghost queue, returns and return slots
  - [ ] 4.1 Implement the ghost queue
    - `runtime/ghost-queue.ts` with `ghost-queue.test.ts`. Export `GHOST_DELAY = 3` (re-exported from `runtime/index.ts`). Spawn with the judged-answer count at that moment; due when `judgedAnswerCount - atSpawn >= GHOST_DELAY`; one pending ghost per concept; return number capped at 2; not-yet-due ghosts carry into the next room unchanged. Return 1 uses the unused Alternate, otherwise the primary; return 2 uses the primary. Label "Review" when the question ID is already in `shownQuestionIds`, else none; append to `shownQuestionIds` when shown (primary when a Lock_Slot is first shown, Alternate after a replacement; reserved final-door questions are not tracked). Only judged answers count; time, hints, skips, challenges and invalid submissions are ignored.
    - _Requirements: 14.1, 14.2, 14.3, 14.4, 14.7, 14.8, 14.9, 14.10, 15.1, 15.2, 15.3, 15.4, 15.5_

  - [ ] 4.2 Wire ghosts and Return_Slots into answering and clearing
    - Update `handlers-answer.ts` and `room-clearing.ts`: a wrong first answer spawns a ghost (`ghostSpawned`); due ghosts become Return_Slots in the current room before the Cleared check (the same call site for every handler that can settle a last slot); a Return_Slot is not a Lock_Slot and keeps the room uncleared while open. Return judged correct: slot `solved`, Spirit_Candle in that room, `candleLit` naming the room, `ghostLaidToRest`, own candle of the missed Lock_Slot stays unlit, concept record updated. Return 1 wrong spawns return 2; return 2 wrong sets `isLingeringSpirit` and `reviewDueFlag`. Update `handlers-answer.test.ts` and `room-clearing.test.ts`.
    - _Requirements: 10.3, 13.5, 13.6, 13.7, 14.1, 14.4, 14.5, 14.6, 15.3, 15.5, 15.6, 19.1, 30.1, 30.2, 30.3, 30.4, 30.5, 31.7, 31.9_

  - [ ] 4.3 Add deferred skips and challenges on Return_Slots
    - Update `handlers-skip-challenge.ts` and its test. `Skipped` on a Lock_Slot or Return_Slot with an unused Alternate queues a deferred return 1 under the same due rule; with none it sets `reviewDueFlag`. A deferred return judged correct counts as retried; judged wrong follows return 1 wrong. `Challenged` on a Return question settles that Return_Slot as `challenged` with no further question; if an earlier unchallenged wrong answer or skip exists, record it so the outcome is Review due. Reserved Final_Door skips are handled in 6.3.
    - _Requirements: 16.3, 16.4, 16.5, 16.6, 17.4_

  - [ ] 4.4 Write the named sequences for ghosts
    - New file `runtime/runtime-sequences.test.ts`. Against a fixed fixture manifest: (1) all wrong: miss, return 1 on the Alternate with no label wrong, return 2 labelled "Review" wrong, lingering spirit, zero candles; (2) all challenged with alternates: every question and replacement challenged, zero candles, no wrong answer recorded; (3) no alternates at all: wrong answers and skips go straight to a primary Return labelled "Review" and then Review due flags. Assert slots, ghosts, candles and notices. Outcome and escape assertions are added in 6.5 and 7.6.
    - _Requirements: 14.2, 14.3, 14.4, 14.5, 14.9, 14.10, 16.4, 17.1, 17.2, 17.3, 17.5_

  - [ ] 4.5 Write property test for ghost cap
    - New file `runtime/runtime-ghosts-properties.test.ts`. At most one pending ghost per concept at any time; return number never above 2.
    - **Property 3: At most one pending ghost per concept, capped at return 2**
    - **Validates: Requirements 14.7, 14.8**

  - [ ] 4.6 Write property test for return question choice and label
    - In `runtime/runtime-properties.test.ts`. Return 1 uses the unused Alternate (a different lock type from the primary) when one exists, otherwise the primary; the label is "Review" if and only if the question was shown earlier for the concept; return 2 is always "Review".
    - **Property 4: Return question choice and Review label follow show history**
    - **Validates: Requirements 14.2, 14.3, 14.4, 14.9, 14.10**

  - [ ] 4.7 Extend the challenge isolation test to Return_Slots
    - In `runtime/runtime-properties.test.ts`: part (a) of Property 9 for a challenged Return question (no wrong answer, candle or ghost from the challenge).
    - **Property 9: Challenging is free, isolated and follows the outcome precedence** (part a, Return_Slots)
    - **Validates: Requirements 17.4, 17.5, 17.7**

  - [ ] 4.8 Verify task 4
    - Run `pnpm --filter @escape-the-crypt/core exec vitest run src/runtime`, `pnpm lint` and `pnpm typecheck`. All pass.
    - _Requirements: 15.1, 30.5_

- [ ] 5. Model-based harness, replay determinism and reload sequence
  - [ ] 5.1 Build the fc.commands harness
    - Create `runtime/runtime-model.test.ts`: the counter `Model`, one command per event kind handled so far, and deliberately invalid variants (wrong order, stale slot, double submit, hint at zero) that assert the expected `kind` and State unchanged. Learner policies: all wrong, all skip, all challenge, seeded random. Fold in the invariants of Properties 2, 3, 5, 8 and 14 and extend `apply-properties.test.ts` coverage to every event kind. Commands for room progression, final door, leave and resume are added in 6.9.
    - **Property 5: Invalid events are no-ops** (every event kind)
    - **Property 2, Property 3, Property 8, Property 14** (as model invariants)
    - **Validates: Requirements 3.1, 3.6, 3.7, 13.4, 14.7, 14.8, 18.4, 31.6**

  - [ ] 5.2 Write property test for replay determinism
    - In `runtime/serialisation.test.ts`. For any generated event log: each event survives a JSON round trip; folding the log equals folding its JSON round trip; folding a prefix then the rest equals folding all at once; every intermediate State survives a JSON round trip; a rejected event is rejected again with the same kind on replay.
    - **Property 6: Replay determinism**
    - **Validates: Requirements 4.3, 4.4, 4.5, 4.6**

  - [ ] 5.3 Write property test for notices
    - In `runtime/runtime-model.test.ts`. Replaying a log twice emits the same notices in the same order; each notice is emitted once per causing event; one event's notices follow `candleLit, ghostLaidToRest, ghostSpawned, sealCracked, roomCleared, escaped`; the event log never contains notices.
    - **Property 15: Notices are emitted once, in a fixed order, and identically on replay**
    - **Validates: Requirements 24.5, 24.7, 24.8**

  - [ ] 5.4 Write the reload-after-every-event sequence
    - New file `runtime/runtime-reload.test.ts`. For a fixed 40-event run on a fixture manifest, for every prefix length 1 to 40: fold the prefix, serialise and parse, apply the remaining events, and assert deep-equality with the uninterrupted fold.
    - _Requirements: 4.3, 4.4, 4.5_

  - [ ] 5.5 Write property test for termination of room play
    - In `runtime/runtime-model.test.ts`. For every policy over `manifestArb` runs, every published room becomes Cleared within `(totalConcepts × 4)` judged prompts, with all four policies including all wrong and all challenged. The escape part of the bound is added in 6.9.
    - **Property 1: Termination** (room play; escape part in 6.9)
    - **Validates: Requirements 19.1, 19.2, 20.7**

  - [ ] 5.6 Checkpoint - Ensure all tests pass
    - Run `pnpm --filter @escape-the-crypt/core exec vitest run src/runtime src/locks`, `pnpm lint` and `pnpm typecheck`. The model-based tests pass for all wrong, all challenged and reload. Ensure all tests pass, ask the user if questions arise.

- [ ] 6. Multiple rooms, publishing, shortening, final door, leave and resume
  - [ ] 6.1 Implement room progression and the waiting state
    - Update `handlers-room.ts` and its test: `RoomEntered(k+1)` only when room k is Cleared and room k+1 published (`room-not-cleared`, `room-not-published`, `room-out-of-order`); status "waiting for next room" while the current room is Cleared, the next room is within the final count or the count is unknown, and the next room is unpublished. Published rooms never change.
    - _Requirements: 7.3, 8.2, 8.3, 8.4, 8.5, 8.6_

  - [ ] 6.2 Implement crypt finalising and shortening
    - Update `handlers-run.ts` and its test: `CryptFinalised` records the final room count; `CryptShortened` at or above the published count records it and leaves published rooms unchanged, below it returns `cannot-shorten-published`; the Final_Door becomes available when every room up to the count is Cleared.
    - _Requirements: 7.4, 7.5, 7.6, 7.7_

  - [ ] 6.3 Implement the final door
    - `runtime/handlers-final-door.ts` with `handlers-final-door.test.ts`. `FinalDoorEntered` (`final-door-unavailable` otherwise) makes every outstanding ghost and deferred skip due and adds them as Final_Door Return slots; GHOST_DELAY is waived at the door, so a ghost spawned there is due at once and a wrong return 1 there spawns a due return 2. Reserved questions are exactly the manifest's 2 to 4; a wrong answer or a skip settles with no Return, no deferred return, no Review_Due_Flag and no change to the concept record; a correct answer lights one candle; a challenge follows Requirement 17. Final door slots accept answer, skip, challenge and hint like room slots. All slots solved or settled sets status Escaped and emits `escaped` once. Update `handlers-skip-challenge.ts` for reserved-question skips.
    - _Requirements: 16.7, 20.1, 20.2, 20.3, 20.4, 20.5, 20.6, 20.8, 20.9, 20.10, 30.6, 31.11_

  - [ ] 6.4 Implement leave and resume
    - Update `handlers-run.ts` and its test, and change the "left" guard in `apply.ts` to exempt `RunLeft` as well as `RunResumed` (so a second `RunLeft` reaches the handler and returns `cannot-leave`): `RunLeft` changes only the status to "left" (`cannot-leave` when already left; before `RunStarted` it returns `run-not-started` from the existing guard, Req 2.5); `RunResumed` changes only the status back (`run-not-left` otherwise); nothing else in State changes between them; after Escaped every event, including these, returns `run-finished`; a left run reports as unfinished. The Autopsy is available only at Escaped (selector added in 7.3).
    - _Requirements: 3.4, 3.5, 21.1, 21.2, 21.3, 21.4, 21.5_

  - [ ] 6.5 Write the multi-room named sequences
    - In `runtime/runtime-sequences.test.ts`: (4) crypt shortened mid-run: `CryptShortened` after 2 of 5 rooms are published, remaining rooms publish and clear, the Final_Door opens after the new final count; (5) next room not yet published: room 1 Cleared, room 2 unpublished, State reports "waiting for next room", then `RoomPublished` and `RoomEntered` succeed. Also add escape assertions to the all wrong and all challenged sequences from 4.4 (escape with zero candles).
    - _Requirements: 7.5, 7.7, 8.6, 20.5_

  - [ ] 6.6 Write property test for immutable published rooms
    - In `runtime/runtime-properties.test.ts`. Duplicate or late `RoomPublished` leaves a published room's locks, option order and hint effects unchanged.
    - **Property 7: Published rooms are immutable**
    - **Validates: Requirements 7.2, 7.3**

  - [ ] 6.7 Write property test for room progression
    - In `runtime/runtime-properties.test.ts`. `RoomEntered(k+1)` is accepted only when room k is Cleared and room k+1 is published; a shortened crypt still reaches an available Final_Door.
    - **Property 11: Room progression and crypt shortening**
    - **Validates: Requirements 7.5, 7.7, 8.1, 8.2, 8.3, 8.4, 8.5**

  - [ ] 6.8 Write property test for order fixed by the manifest
    - In `runtime/runtime-properties.test.ts`. After every event of any log, option order and bone order in State equal the manifest's.
    - **Property 12: Order fixed by the manifest**
    - **Validates: Requirements 6.1, 6.2, 6.3**

  - [ ] 6.9 Extend the model harness to escape
    - In `runtime/runtime-model.test.ts`: add commands for room progression, publishing, shortening, final door, leave and resume; complete the escape part of the termination bound `(totalConcepts × 4) + reservedFinalDoorQuestionCount` for all four policies.
    - **Property 1: Termination** (escape)
    - **Validates: Requirements 20.5, 20.7, 20.8, 20.9**

  - [ ] 6.10 Verify task 6
    - Run `pnpm --filter @escape-the-crypt/core exec vitest run src/runtime src/locks`, `pnpm lint` and `pnpm typecheck`. All pass.
    - _Requirements: 20.7, 21.1_

- [ ] 7. Outcomes, Autopsy labels, hook update and build log
  - [ ] 7.1 Implement concept outcome derivation
    - `runtime/outcomes.ts` with `outcomes.test.ts`: `deriveConceptOutcome` and `deriveAllOutcomes` with the precedence Challenged, Review due, Retried, Assisted, First-try correct. A replacement answered after a challenge takes the Alternate's result; a challenged Return after an earlier unchallenged miss gives Review due; reserved final-door results never change an outcome; one outcome per concept; no mastery or exam-readiness claim.
    - Assisted means `hintUsedOnCorrectQuestion` is true: a hint was applied to the question judged correct. The spent hint is never refunded.
    - Unit cases: first question correct with a hint is Assisted; first question correct with no hint is First-try correct; hint on a primary, `Challenged`, Alternate correct with no hint is First-try correct and `hintUsedOnCorrectQuestion` is false (Req 22.11, 18.7, 18.8); hint on the Alternate then correct is Assisted; a hint on a Return answered correctly still gives Retried (higher precedence).
    - _Requirements: 18.5, 18.7, 18.8, 20.10, 20.11, 22.1, 22.2, 22.3, 22.4, 22.5, 22.6, 22.7, 22.8, 22.9, 22.10, 22.11_

  - [ ] 7.2 Add Autopsy labels and the banned-words test
    - Extend `copy.ts` with the labels "First-try correct", "Assisted", "Retried", "Challenged: excluded from score", "Review due" and the Return label "Review", in the tone of `.kiro/steering/tone.md` (load that steering file before writing). Add or extend the banned-words test over `copy.ts` for "verified", "guaranteed", "100% accurate", "hallucination-free", "mastered", "exam-ready".
    - _Requirements: 23.1, 23.2, 23.3, 23.4, 23.5, 22.10_

  - [ ] 7.3 Expose outcomes and Autopsy availability
    - Update `runtime/selectors.ts`, `selectors.test.ts` and `runtime/index.ts`: Autopsy available only at Escaped; outcomes, labels and counts exposed to the interface; export `initial`, `apply`, selectors and `GHOST_DELAY`.
    - _Requirements: 21.6, 22.1, 23.1_

  - [ ] 7.4 Write property test for one outcome per concept
    - In `runtime/runtime-model.test.ts`. Every escaped run gives each concept exactly one outcome and the five counts sum to the manifest's concept count, for all four policies.
    - **Property 10: Exactly one outcome per concept, outcomes sum to the concept count**
    - **Validates: Requirements 22.1, 22.9, 20.11**

  - [ ] 7.5 Write paired-run property test for challenges, parts (b) and (c)
    - In `runtime/runtime-properties.test.ts`. A shared driver with a policy table keyed by concept, return number and lock type. Run A challenges the first question shown for concept Q; run B skips it. Assert every other concept's outcome is equal across runs (b); an arm that challenges every question of Q gives Challenged, otherwise Q's outcome matches an independent oracle computed from the log (c).
    - **Property 9: Challenging is free, isolated and follows the outcome precedence** (parts b and c)
    - **Validates: Requirements 17.5, 22.2, 22.3, 22.4**

  - [ ] 7.6 Add outcome assertions to the named sequences
    - In `runtime/runtime-sequences.test.ts`: all wrong escapes with every concept Review due and zero candles; all challenged escapes with every concept Challenged, zero candles and zero wrong answers; no alternates ends in Review due flags; the five counts sum to the concept count.
    - _Requirements: 22.1, 22.3, 22.5, 22.9_

  - [ ] 7.7 Update the hook script
    - In `.kiro/hooks/run-core-tests.mjs`, choose the suite from the saved path: under `packages/core/src/runtime/` or `packages/core/src/locks/` run `pnpm --filter @escape-the-crypt/core exec vitest run src/runtime src/locks`; any other path under `packages/core/src/` runs the full core suite as today. Do not add a second hook and do not change the matcher in `run-core-tests-on-save.json`. Verify by running the script with a sample payload for each path kind (command construction only; no logs or user content written under `.kiro/`).
    - _Requirements: 1.7_

  - [ ] 7.8 Add the build-log entry
    - Append an entry to `docs/build-log.md` describing the room-runtime work: the reducer, six judges, ghost queue, final door, outcomes and the hook change. Report real test counts and any known failures. Use no claims of learning gains and none of the banned words.
    - _Requirements: 23.4_

  - [ ] 7.9 Checkpoint - Ensure all tests pass
    - Check that the string `handler-not-wired` no longer appears in non-test code under `packages/core/src` (for example `rg handler-not-wired packages/core/src --glob "!*.test.ts"` returns nothing). Run `pnpm --filter @escape-the-crypt/core exec vitest run src/runtime src/locks src/test-support`, the full core suite, `pnpm lint` and `pnpm typecheck`. Ensure all tests pass, ask the user if questions arise.

## Notes

- No task is marked optional. Every property test and unit test must be implemented.
- Each task references granular requirement clauses and design property numbers for traceability.
- Properties appear in the task that first makes them testable: P13, P5 in task 1; P2, P8, P14 and P9(a) in task 3; P3, P4 in task 4; P6, P15 and the room-play part of P1 in task 5; P7, P11, P12 and the escape part of P1 in task 6; P10 and P9(b)(c) in task 7.
- Tests never call a real AI provider; the judges and reducer never call one.
- Property tests run at least 100 iterations and carry the tag `Feature: room-runtime, Property N: <text>`.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2"] },
    { "id": 2, "tasks": ["1.3", "1.4"] },
    { "id": 3, "tasks": ["1.5", "1.6", "1.7"] },
    { "id": 4, "tasks": ["1.8"] },
    { "id": 5, "tasks": ["2.1", "2.2", "2.3", "2.4", "2.5", "2.6"] },
    { "id": 6, "tasks": ["2.7"] },
    { "id": 7, "tasks": ["2.8"] },
    { "id": 8, "tasks": ["3.1"] },
    { "id": 9, "tasks": ["3.2"] },
    { "id": 10, "tasks": ["3.3"] },
    { "id": 11, "tasks": ["3.4"] },
    { "id": 12, "tasks": ["3.5"] },
    { "id": 13, "tasks": ["3.6", "3.7", "3.8", "3.9"] },
    { "id": 14, "tasks": ["3.10"] },
    { "id": 15, "tasks": ["4.1"] },
    { "id": 16, "tasks": ["4.2"] },
    { "id": 17, "tasks": ["4.3"] },
    { "id": 18, "tasks": ["4.4"] },
    { "id": 19, "tasks": ["4.5", "4.6"] },
    { "id": 20, "tasks": ["4.7"] },
    { "id": 21, "tasks": ["4.8"] },
    { "id": 22, "tasks": ["5.1"] },
    { "id": 23, "tasks": ["5.2", "5.3", "5.4"] },
    { "id": 24, "tasks": ["5.5"] },
    { "id": 25, "tasks": ["5.6"] },
    { "id": 26, "tasks": ["6.1"] },
    { "id": 27, "tasks": ["6.2"] },
    { "id": 28, "tasks": ["6.3"] },
    { "id": 29, "tasks": ["6.4"] },
    { "id": 30, "tasks": ["6.5", "6.6", "6.9"] },
    { "id": 31, "tasks": ["6.7"] },
    { "id": 32, "tasks": ["6.8"] },
    { "id": 33, "tasks": ["6.10"] },
    { "id": 34, "tasks": ["7.1", "7.2", "7.7"] },
    { "id": 35, "tasks": ["7.3"] },
    { "id": 36, "tasks": ["7.4", "7.5", "7.6", "7.8"] },
    { "id": 37, "tasks": ["7.9"] }
  ]
}
```
