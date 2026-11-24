# Requirements Document

## Introduction

The room runtime is the rule engine for one play-through of a crypt. It is a pure reducer over an event log: `state = events.reduce(apply, initial(manifest))`. It lives in `packages/core/src/runtime/`. It decides what each learner action does: which locks open, which candles light, which ghosts appear and return, when a room is cleared, when the final door opens, and how each concept is reported in the Autopsy.

Answers are judged by pure functions in `packages/core/src/locks/<type>.ts`. The model is never involved during play. The runtime has no timers, randomness or I/O. Ghost returns are scheduled by the count of judged answers, not by time. Option and bone order come from the manifest and never change.

This spec covers the reducer, the event rules, the answer judges for all six lock types, concept outcomes and the Autopsy labels. It also covers the lock type IDs, the one-lock-per-type room rule with its pure manifest check, the per-room state the interface reads, and a manifest fixture builder for tests. It does not cover storage, visuals, the lock interfaces or question generation (see Out of Scope).

Decisions D0 to D8 and the confirmed choices (one decimal place on the combination dial, Autopsy reached on escape only) are final inputs from `docs/briefs/room-runtime-spec-brief.md`. They are not reopened here.

## Glossary

- **Runtime**: The pure reducer and its helper functions in `packages/core/src/runtime/`. Exposes `initial(manifest, settings)` and `apply(state, event)`.
- **Manifest**: The immutable `CryptManifest` produced by the generation spec. It holds rooms, each room's locks, concepts, evidence references, the final-door set and the Hint_Effect carried by each question.
- **QuestionSpec**: The Manifest record of one question: a primary question, an Alternate or a Reserved_Final_Door_Question. Each QuestionSpec carries a Question_Id, its LockType, its answer data and its Hint_Effect or none.
- **Question_Id**: The `questionId` string carried by every QuestionSpec. It is unique within the Manifest across all primary questions, Alternates and Reserved_Final_Door_Questions.
- **Run_Settings**: The learner's choices for one run: length (short, standard, long), difficulty (Apprentice, Gravedigger, Lich) and hint allowance.
- **Event**: A serialisable record of one learner or job action, defined in `packages/core/src/types.ts`.
- **Event_Log**: The ordered list of Events for one run. The Event_Log and the Manifest are all that persistence needs to restore a run.
- **State**: The Runtime's complete picture of a run, derived only from the Manifest, Run_Settings and Event_Log.
- **Typed_Rejection**: The result `{ ok: false, error: { kind } }` returned for an invalid Event. The `kind` is a member of a closed union of string literals.
- **Outcome_Notice**: A record of something that happened, returned with a successful `apply` result so the interface can react. The notice kinds are `candleLit`, `ghostSpawned`, `ghostLaidToRest`, `sealCracked`, `roomCleared` and `escaped`.
- **Concept**: One idea from the learner's notes. It has a primary question, at most one alternate question of a different lock type, and evidence references.
- **Alternate**: The optional second question of a Concept.
- **LockType**: The closed union `'rune-cipher' | 'seance-board' | 'bone-ordering' | 'bound-threads' | 'cursed-object' | 'combination-dial'`, defined in `packages/core/src/types.ts`. These are the IDs used by lock files, events, State fields and Outcome_Notices.
- **Lock_Slot**: One lock station in a room. It holds one question for one Concept at a time. A room has at most one Lock_Slot of each LockType. A Return_Slot is not a Lock_Slot.
- **Station_Type**: The LockType of the primary question of a Lock_Slot. It is fixed when the Lock_Slot is created and never changes.
- **Current_Question_Type**: The LockType of the question that a slot holds now. For a Lock_Slot it equals the Station_Type until a challenge replaces the question with the Alternate, and then it is the Alternate's LockType.
- **Return_Slot**: A separate slot that the Runtime adds to a room or to the Final_Door when a Ghost or deferred skip becomes due. It holds the Return question. It has no Station_Type and is not a lock station.
- **Slot_Status**: One of exactly `open`, `solved`, `settled` or `challenged`. `settled` means finished by a wrong answer or a skip. `challenged` means settled by a challenge with no further question. A slot whose question was replaced by the Alternate after a challenge stays `open`.
- **Spirit_Candle**: A candle lit in a room, or at the Final_Door, by a correct answer on a Return. It belongs to the place where the Return is answered and is not the candle of any Lock_Slot.
- **Manifest_Check**: The pure function in `packages/core/src/runtime/` that tests whether a Manifest respects the one-lock-per-type rule and carries unique Question_Ids.
- **Hint_Effect**: The effect of a hint on one question, fixed in the Manifest as a field of that question (for example removing an option, locking the first bone or tying a thread). Each primary question, Alternate and Reserved_Final_Door_Question carries its own Hint_Effect or none. A Hint_Effect belongs to the question, not to the slot that shows it.
- **Applied_Hint**: The Hint_Effect of the question currently shown in a slot, once `HintUsed` has been applied for that question, or none if no hint was used on it. State records it per slot and question. A hint spent on a question that is later challenged stays spent and does not apply to the Alternate.
- **Judge**: A pure function in `packages/core/src/locks/<type>.ts`, called as `judge(question, submission, appliedHint)`, that returns correct, wrong or invalid for one submission to one question of that LockType, taking account of the Applied_Hint of that question. The six Judges are Rune_Cipher_Judge, Seance_Board_Judge, Bone_Ordering_Judge, Bound_Threads_Judge, Cursed_Object_Judge and Combination_Dial_Judge.
- **Open_Slot**: A Lock_Slot or Return_Slot that is neither solved nor settled.
- **Solved**: A Lock_Slot or Return_Slot whose current question was judged correct.
- **Settled**: A Lock_Slot or Return_Slot that is finished without a correct answer: judged wrong, skipped, or challenged with no replacement shown. A settled slot is excluded from the candle count. Slot_Status `settled` and `challenged` are both Settled.
- **Judged_Answer**: A valid `AnswerSubmitted` event that the judge marked correct or wrong.
- **Invalid_Submission**: A submission that cannot be judged, such as an empty answer or an option ID from another question. It is not a wrong answer.
- **Ghost**: A pending return of a Concept after a wrong answer. A Ghost has a return number (1 or 2).
- **Return**: A later question for a Concept shown in a Return_Slot because of a Ghost or a deferred skip. Return 1 uses the Alternate when one is unused. Return 2 reuses one of the Concept's questions and is always labelled "Review". A Return is labelled "Review" when its question was already shown for the Concept earlier in the run, and has no label otherwise.
- **Lingering_Spirit**: A Concept that was answered wrong on return 2. It is reported as review due.
- **GHOST_DELAY**: The named constant `3`. The number of other Judged_Answers that must pass before a Ghost or deferred skip becomes due.
- **Cleared**: A room in which every Lock_Slot and every due Return_Slot is solved or settled.
- **Final_Door**: The last stage. Its slots are the 2 to 4 final-door questions fixed in the Manifest, plus every outstanding Ghost and deferred skip.
- **Escaped**: The run status after the Final_Door is open with all its slots solved or settled.
- **Concept_Outcome**: The single reported result for a Concept: Challenged, Review due, Retried, Assisted or First-try correct.
- **Autopsy_Label**: The learner-facing text for a Concept_Outcome, kept in `packages/core/src/copy.ts`.
- **Draft_Answer**: Unsubmitted input such as typed letters or a planchette position. It exists only in interface state.
- **Fixture_Builder**: A function in `packages/core/src/test-support/`, next to `arbitraries.ts`, that builds a valid Manifest for tests.
- **Review_Due_Flag**: A flag on a Concept recording that the Concept needs another look. It is an input to the Concept_Outcome and does not itself decide the outcome. Requirement 22 alone decides each Concept_Outcome.
- **Reserved_Final_Door_Question**: One of the 2 to 4 questions that the Manifest fixes for the Final_Door. Returns shown at the Final_Door are not Reserved_Final_Door_Questions.

## Requirements

### Requirement 1: Pure reducer and module boundaries

**User Story:** As a developer, I want the game rules in one pure function in the core package, so that the interface, the tests and a future Kiro Power all share one source of truth.

#### Acceptance Criteria

1. THE Runtime SHALL expose `initial(manifest, settings)` and `apply(state, event)` as pure functions that return the same output for the same input.
2. THE Runtime SHALL reside in `packages/core/src/runtime/` and import nothing from React, the database or an AI SDK.
3. THE Runtime SHALL perform no timer calls, random number generation, clock reads or I/O.
4. THE Runtime SHALL derive State only from the Manifest, Run_Settings and Event_Log.
5. WHEN `apply` returns successfully, THE Runtime SHALL return a new State object and leave the input State unmodified.
6. THE Runtime SHALL return all failures as Typed_Rejection values and throw no exceptions for any input sequence.
7. THE Runtime SHALL keep each source file at or below approximately 300 lines by splitting files by responsibility.

### Requirement 2: Initial state

**User Story:** As a learner, I want a new run to start from a clear position, so that the first room is ready to play.

#### Acceptance Criteria

1. WHEN `initial(manifest, settings)` is called, THE Runtime SHALL return a State with status "not started", zero candles, no Ghosts, and no room entered.
2. WHEN `RunStarted` is applied with the Manifest ID matching the Manifest, THE Runtime SHALL record the Run_Settings, set the status to "in progress" and set the remaining hint count equal to the hint allowance in the Run_Settings.
3. IF `RunStarted` carries a Manifest ID that differs from the Manifest, THEN THE Runtime SHALL return a Typed_Rejection with kind `manifest-mismatch`.
4. IF `RunStarted` is applied to a run that has already started, THEN THE Runtime SHALL return a Typed_Rejection with kind `run-already-started`.
5. IF any Event other than `RunStarted`, `RoomPublished`, `CryptFinalised` and `CryptShortened` is applied before `RunStarted`, THEN THE Runtime SHALL return a Typed_Rejection with kind `run-not-started`.
6. IF `RunStarted` is applied with a Manifest that fails the Manifest_Check, THEN THE Runtime SHALL return the `invalid-manifest` error that the Manifest_Check returns and leave State unchanged. Callers still run the Manifest_Check before publishing a Manifest, so this criterion is a backstop for stored Manifests.
7. THE Runtime SHALL make `initial(manifest, settings)` return a State and throw no exception for any Manifest, including a Manifest that fails the Manifest_Check, so that the check is applied only through criterion 6.

### Requirement 3: Typed rejection of invalid events

**User Story:** As a developer, I want every invalid event to fail in a predictable, harmless way, so that a bad event can never corrupt a run.

#### Acceptance Criteria

1. IF an Event is invalid for the current State, THEN THE Runtime SHALL return a Typed_Rejection and leave the State deep-equal to the State before the call.
2. THE Runtime SHALL define the Typed_Rejection kinds as a closed union of string literals in `packages/core/src/types.ts`.
3. IF an Event names a room, lock, concept or option that does not exist in the Manifest, THEN THE Runtime SHALL return a Typed_Rejection with kind `unknown-reference`.
4. IF a learner Event is applied while the run status is "left", THEN THE Runtime SHALL return a Typed_Rejection with kind `run-left`, except for `RunResumed` and `RunLeft` (`RunLeft` while left returns `cannot-leave`, see Requirement 21.4).
5. IF any Event, including `RunLeft` and `RunResumed`, is applied after the run has Escaped, THEN THE Runtime SHALL return a Typed_Rejection with kind `run-finished`.
6. IF an Event targets a Lock_Slot that is solved or settled and the Event requires an Open_Slot, THEN THE Runtime SHALL return a Typed_Rejection with kind `lock-already-settled`.
7. IF an Event is malformed or has a type the Runtime does not recognise, THEN THE Runtime SHALL return a Typed_Rejection with kind `malformed-event`.

### Requirement 4: Serialisable log and replay determinism

**User Story:** As a learner, I want a reload to bring me back to exactly where I was, so that I lose nothing.

#### Acceptance Criteria

1. THE Runtime SHALL define every Event as a plain JSON-serialisable record containing no functions, dates, class instances or `undefined` values.
2. THE Runtime SHALL keep State JSON-serialisable.
3. WHEN the same Event_Log is folded from the same Manifest and Run_Settings, THE Runtime SHALL produce deep-equal State each time.
4. WHEN an Event_Log is serialised to JSON and parsed back before folding, THE Runtime SHALL produce State deep-equal to folding the original Event_Log.
5. WHEN a prefix of an Event_Log is folded and the remaining Events are then applied to the resulting State, THE Runtime SHALL produce State deep-equal to folding the whole Event_Log at once.
6. WHEN a rejected Event appears in a replayed Event_Log, THE Runtime SHALL reject it again with the same Typed_Rejection kind and leave State unchanged.

### Requirement 5: Draft answers stay out of the log

**User Story:** As a learner, I want half-typed answers to stay private and temporary, so that nothing unfinished is saved.

#### Acceptance Criteria

1. THE Runtime SHALL define no Event type that carries a Draft_Answer.
2. THE Runtime SHALL record an answer only through `AnswerSubmitted`, which carries the final submitted answer.
3. THE Runtime SHALL keep Draft_Answer values out of State.

### Requirement 6: Order fixed by the manifest

**User Story:** As a learner, I want options and bones in the same order after a reload, so that nothing reshuffles under me.

#### Acceptance Criteria

1. THE Runtime SHALL expose option order and bone order in State exactly as the Manifest specifies.
2. THE Runtime SHALL use no source of randomness to order options, bones or locks.
3. WHEN any Event is applied, THE Runtime SHALL leave the option order and bone order of every published question unchanged.

### Requirement 7: Publishing and shortening rooms

**User Story:** As a learner, I want rooms to open as they finish generating, so that I can start before the whole crypt is ready.

#### Acceptance Criteria

1. WHEN `RoomPublished` is applied for a room in the Manifest that is not yet published, THE Runtime SHALL mark the room published.
2. WHEN `RoomPublished` is applied for a room that is already published, THE Runtime SHALL return an unchanged State as a successful no-op.
3. WHEN a published room exists, THE Runtime SHALL keep its locks, option order and the Hint_Effect of each question unchanged for the rest of the run.
4. WHEN `CryptFinalised` is applied, THE Runtime SHALL record the final room count.
5. WHEN `CryptShortened` is applied with a final room count at or above the number of published rooms, THE Runtime SHALL record the new final room count and leave every published room unchanged.
6. IF `CryptShortened` carries a final room count below the number of published rooms, THEN THE Runtime SHALL return a Typed_Rejection with kind `cannot-shorten-published`.
7. WHEN the final room count is recorded and every room up to that count is Cleared, THE Runtime SHALL make the Final_Door available.

### Requirement 8: Room progression and waiting state

**User Story:** As a learner, I want to move through rooms in order, and to be told when the next room is still being prepared.

#### Acceptance Criteria

1. WHEN `RoomEntered` is applied for room 1 and room 1 is published, THE Runtime SHALL set room 1 as the current room.
2. WHEN `RoomEntered` is applied for room k+1, room k is Cleared and room k+1 is published, THE Runtime SHALL set room k+1 as the current room.
3. IF `RoomEntered` targets a room that is not published, THEN THE Runtime SHALL return a Typed_Rejection with kind `room-not-published`.
4. IF `RoomEntered` targets room k+1 while room k is not Cleared, THEN THE Runtime SHALL return a Typed_Rejection with kind `room-not-cleared`.
5. IF `RoomEntered` skips a room, THEN THE Runtime SHALL return a Typed_Rejection with kind `room-out-of-order`.
6. WHILE the current room is Cleared, the next room is within the final room count or the final room count is not yet known, and the next room is not published, THE Runtime SHALL report the status "waiting for next room" in State.

### Requirement 9: Opening a lock

**User Story:** As a learner, I want to pick any open lock in my room, so that I choose what to try first.

#### Acceptance Criteria

1. WHEN `LockOpened` is applied for an Open_Slot in the current room, THE Runtime SHALL record the slot as the focused lock.
2. IF `LockOpened` targets a Lock_Slot outside the current room, THEN THE Runtime SHALL return a Typed_Rejection with kind `lock-not-in-room`.
3. IF `LockOpened` targets a solved or settled Lock_Slot, THEN THE Runtime SHALL return a Typed_Rejection with kind `lock-already-settled`.
4. THE Runtime SHALL accept `AnswerSubmitted`, `HintUsed`, `Skipped` and `Challenged` for an Open_Slot whether or not a `LockOpened` Event precedes them.
5. IF `LockOpened`, `HintUsed`, `AnswerSubmitted`, `Skipped` or `Challenged` targets a slot that is not in the current room (or, while at the Final_Door, not a Final_Door slot), including before any `RoomEntered`, THEN THE Runtime SHALL return a Typed_Rejection with kind `lock-not-in-room` and leave State unchanged. `EvidenceContinued` is exempt, so it may close the panel of the slot just judged. Due Return_Slots in the current room count as in the room. The check runs after the unknown-reference check and before the `lock-already-settled` check.

### Requirement 10: Answer submission, one judged submit per question

**User Story:** As a learner, I want each question judged once, so that the evidence I read afterwards is not a free retry.

#### Acceptance Criteria

1. WHEN `AnswerSubmitted` is applied for an Open_Slot, THE Runtime SHALL run the Judge for the slot's Current_Question_Type, chosen from the six Judges by LockType, inside the reducer, pass the question actually shown and the Applied_Hint of that question, and store the result in State.
2. WHEN the judge marks a submission correct, THE Runtime SHALL mark the Lock_Slot solved.
3. WHEN the judge marks a submission wrong, THE Runtime SHALL mark the Lock_Slot settled and spawn a Ghost for the Concept under Requirement 14.
4. WHEN a Judged_Answer is stored, THE Runtime SHALL open the evidence panel for that Lock_Slot in State until `EvidenceContinued` is applied.
5. IF the judge reports an Invalid_Submission, THEN THE Runtime SHALL return a Typed_Rejection with kind `invalid-submission`, spawn no Ghost and leave State unchanged.
6. IF `AnswerSubmitted` targets a Lock_Slot that already has a Judged_Answer for its current question, THEN THE Runtime SHALL return a Typed_Rejection with kind `lock-already-settled`.
7. WHEN `EvidenceContinued` is applied while the evidence panel is open, THE Runtime SHALL close the evidence panel.
8. IF `EvidenceContinued` is applied while no evidence panel is open, THEN THE Runtime SHALL return a Typed_Rejection with kind `no-evidence-open`.
9. THE Runtime SHALL perform judging with no call to a model, network or external service.

### Requirement 11: Rune cipher judge

**User Story:** As a learner, I want my typed answer judged fairly, so that harmless spacing or capital letters do not cost me a candle.

#### Acceptance Criteria

1. THE Rune_Cipher_Judge SHALL be a pure function in `packages/core/src/locks/rune-cipher.ts` with matching tests in `rune-cipher.test.ts`.
2. WHEN a submission is compared with the answer or a reviewed alias, THE Rune_Cipher_Judge SHALL trim the submission and collapse each run of spaces to one space.
3. WHERE the question is not flagged case-sensitive, THE Rune_Cipher_Judge SHALL compare without regard to letter case.
4. WHERE the question is flagged case-sensitive, THE Rune_Cipher_Judge SHALL compare with letter case preserved.
5. WHEN the normalised submission exactly equals the normalised answer or any reviewed alias, THE Rune_Cipher_Judge SHALL return correct.
6. WHEN the normalised submission matches neither the answer nor any reviewed alias, THE Rune_Cipher_Judge SHALL return wrong.
7. IF the submission is empty after trimming, THEN THE Rune_Cipher_Judge SHALL return invalid.
8. THE Rune_Cipher_Judge SHALL treat `"  Atrioventricular "` as correct for the answer "Atrioventricular", treat "AV" as correct when "AV" is a reviewed alias, treat "atrio-ventricular" as wrong unless it is a reviewed alias, and treat "NA" as wrong for the case-sensitive answer "Na".
9. THE Rune_Cipher_Judge SHALL return a typed result and throw no exception for any string input.

### Requirement 12: Séance board judge

**User Story:** As a learner, I want my chosen option judged against the key, so that the result matches what the evidence says.

#### Acceptance Criteria

1. THE Seance_Board_Judge SHALL be a pure function in `packages/core/src/locks/seance-board.ts` with matching tests in `seance-board.test.ts`.
2. WHEN the selected option ID equals the key option ID, THE Seance_Board_Judge SHALL return correct.
3. WHEN the selected option ID is a listed option ID of the question, is not removed by the Applied_Hint and differs from the key option ID, THE Seance_Board_Judge SHALL return wrong.
4. IF the selected option ID is not a listed option ID of the question, or is an option removed by the Applied_Hint, THEN THE Seance_Board_Judge SHALL return invalid.
5. IF the submission has no selected option ID, THEN THE Seance_Board_Judge SHALL return invalid.
6. THE Seance_Board_Judge SHALL accept the signature `judge(question, submission, appliedHint)`, return a typed result and throw no exception for any input.

### Requirement 13: Candles

**User Story:** As a learner, I want each correct answer to bring light back, so that progress is visible.

#### Acceptance Criteria

1. WHEN a Judged_Answer is correct on a question that is not challenged, THE Runtime SHALL increase the candle count by exactly one and emit a `candleLit` Outcome_Notice of the kind given in criteria 5 and 6.
2. THE Runtime SHALL count a correct answer given after a hint, a correct answer on a Return, and a correct answer at the Final_Door as one candle each.
3. THE Runtime SHALL leave the candle count unchanged for wrong answers, skips, challenges, hints, and all Events other than a correct `AnswerSubmitted`.
4. THE Runtime SHALL keep the candle count equal to the number of correct Judged_Answers on non-challenged questions.
5. WHEN a Judged_Answer is correct on a Lock_Slot or on a Reserved_Final_Door_Question, THE Runtime SHALL light the own candle of that slot and emit `candleLit` naming that slot.
6. WHEN a Judged_Answer is correct on a Return_Slot, THE Runtime SHALL light a Spirit_Candle in the room where the Return is answered, or at the Final_Door when it is answered there, and emit `candleLit` naming that room or the Final_Door.
7. WHEN a Return is judged correct, THE Runtime SHALL leave the own candle of the Lock_Slot that held the missed question unlit.

### Requirement 14: Wrong answers and ghosts

**User Story:** As a learner, I want a missed idea to come back as a different question, so that I get a fresh chance without being punished.

#### Acceptance Criteria

1. WHEN a first-asked question of a Concept is judged wrong, THE Runtime SHALL spawn a Ghost for the Concept with return number 1 and emit a `ghostSpawned` Outcome_Notice.
2. WHEN a Ghost with return number 1 becomes due and the Concept has an unused Alternate, THE Runtime SHALL schedule the Alternate as the Return question.
3. WHEN a Ghost with return number 1 becomes due and the Concept has no unused Alternate, THE Runtime SHALL schedule one of the Concept's earlier questions as the Return question and label it "Review".
4. WHEN a return 1 question is judged wrong, THE Runtime SHALL spawn a Ghost with return number 2, scheduled as a Return question labelled "Review".
5. WHEN a return 2 question is judged wrong, THE Runtime SHALL mark the Concept as a Lingering_Spirit and set the Review_Due_Flag.
6. WHEN a Return is judged correct, THE Runtime SHALL emit a `ghostLaidToRest` Outcome_Notice.
7. THE Runtime SHALL hold at most one pending Ghost per Concept at any time.
8. THE Runtime SHALL cap the return number of any Ghost at 2.
9. WHEN a Return question was already shown for the Concept earlier in the run, THE Runtime SHALL label it "Review".
10. WHEN a Return question was not shown for the Concept earlier in the run, THE Runtime SHALL show no label on it.

### Requirement 15: Ghost schedule by answer count

**User Story:** As a learner, I want ghosts to return after a few more questions, so that the return feels spaced rather than immediate.

#### Acceptance Criteria

1. THE Runtime SHALL define GHOST_DELAY as a named constant with the value 3.
2. WHEN a Ghost is spawned, THE Runtime SHALL record the count of Judged_Answers at that moment.
3. WHEN GHOST_DELAY other Judged_Answers have been stored since a Ghost was spawned, THE Runtime SHALL mark the Ghost due and add a Return_Slot to the current room under Requirement 30.
4. THE Runtime SHALL count only Judged_Answers when scheduling, and SHALL ignore elapsed time, hints, skips, challenges and Invalid_Submissions.
5. WHEN a room is Cleared while Ghosts are pending and not yet due, THE Runtime SHALL carry those Ghosts into the next room unchanged.
6. WHILE a Return slot is due in the current room, THE Runtime SHALL count that Return slot as an Open_Slot until it is solved or settled.

### Requirement 16: Skip

**User Story:** As a learner, I want to skip a question I cannot place, so that I can move on without being penalised.

#### Acceptance Criteria

1. WHEN `Skipped` is applied for an Open_Slot, THE Runtime SHALL mark the slot settled and exclude it from the candle count.
2. WHEN `Skipped` is applied, THE Runtime SHALL emit no `ghostSpawned` Outcome_Notice and show no ghost.
3. WHEN `Skipped` is applied for a Lock_Slot or Return_Slot and the Concept has an unused Alternate, THE Runtime SHALL queue a deferred return for the Concept that uses the Alternate and becomes due under Requirement 15.
4. WHEN `Skipped` is applied for a Lock_Slot or Return_Slot and the Concept has no unused Alternate, THE Runtime SHALL set the Review_Due_Flag on the Concept.
5. WHEN a deferred-skip Return is judged correct, THE Runtime SHALL count the Concept as retried.
6. IF a deferred-skip Return is judged wrong, THEN THE Runtime SHALL treat the result as a return 1 wrong answer under Requirement 14.
7. WHEN `Skipped` is applied for a Reserved_Final_Door_Question, THE Runtime SHALL settle the slot, queue no deferred Return, set no Review_Due_Flag and leave the Concept_Outcome of its Concept unchanged, consistent with Requirement 20, criteria 4 and 10.

### Requirement 17: Challenge

**User Story:** As a learner, I want to challenge a question I think is unfair and move on at no cost, so that I can trust the game.

#### Acceptance Criteria

1. WHEN `Challenged` is applied for an Open_Slot whose Concept has an unused Alternate, THE Runtime SHALL replace the question in the same Lock_Slot with the Alternate, mark the replaced question challenged and emit a `sealCracked` Outcome_Notice.
2. WHEN `Challenged` is applied for an Open_Slot whose Concept has no unused Alternate, THE Runtime SHALL mark the Lock_Slot settled with no further question, mark the question challenged and emit a `sealCracked` Outcome_Notice.
3. WHEN `Challenged` is applied to a replacement question, THE Runtime SHALL mark the Lock_Slot settled with no further question, mark the question challenged and emit a `sealCracked` Outcome_Notice.
4. WHEN `Challenged` is applied to a Return question, THE Runtime SHALL settle the Return slot with no further question and mark the question challenged. WHERE the Concept has an earlier unchallenged wrong answer or skip, THE Runtime SHALL assign the Concept the outcome Review due under the precedence in Requirement 22.
5. THE Runtime SHALL exclude every challenged question from the candle count, the ghost schedule and the correct counts, and SHALL take every Concept_Outcome only from the precedence in Requirement 22.
6. THE Runtime SHALL store a challenge in the Event_Log and State only, and send nothing to any server.
7. WHEN `Challenged` is applied, THE Runtime SHALL spawn no Ghost, light no candle and count no wrong answer for the challenged question.

### Requirement 18: Hints

**User Story:** As a learner, I want a limited number of candle hints, so that I can get help and still see what I did unaided.

#### Acceptance Criteria

1. WHEN `HintUsed` is applied for an Open_Slot and the remaining hint count is above 0, THE Runtime SHALL reduce the remaining hint count by 1 and apply the Hint_Effect that the Manifest fixes on the question shown in that slot, and record it as the Applied_Hint of that question.
2. IF `HintUsed` is applied while the remaining hint count is 0, THEN THE Runtime SHALL return a Typed_Rejection with kind `no-hints-left`.
3. IF `HintUsed` targets a solved or settled Lock_Slot, THEN THE Runtime SHALL return a Typed_Rejection with kind `lock-already-settled`.
4. THE Runtime SHALL keep the remaining hint count at or above 0.
5. WHEN a question that had a hint applied is judged correct, THE Runtime SHALL record the answer as assisted.
6. IF `HintUsed` is applied to a question for which a hint was already used, THEN THE Runtime SHALL return a Typed_Rejection with kind `hint-already-used`.
7. WHEN `Challenged` is applied to a question that had a hint applied, THE Runtime SHALL leave the remaining hint count unchanged and refund no hint.
8. WHEN a challenged question is replaced by an Alternate, THE Runtime SHALL carry no Applied_Hint over to the Alternate.

### Requirement 19: Settling locks and clearing rooms

**User Story:** As a learner, I want to leave a room once I have dealt with every lock, so that one hard idea cannot trap me.

#### Acceptance Criteria

1. WHEN every Lock_Slot and every due Return_Slot in a room is solved or settled, THE Runtime SHALL mark the room Cleared.
2. THE Runtime SHALL make room clearing independent of whether any answer was correct.
3. WHEN a room becomes Cleared, THE Runtime SHALL leave its Lock_Slots unchanged.

### Requirement 20: Final door

**User Story:** As a learner, I want a final door that mixes ideas from every room, and I want to always be able to get through it.

#### Acceptance Criteria

1. THE Runtime SHALL take the 2 to 4 final-door questions from the Manifest and add no final-door question that the Manifest does not contain.
2. WHEN `FinalDoorEntered` is applied and the Final_Door is available, THE Runtime SHALL make every outstanding Ghost and deferred skip due, whatever the Judged_Answer count.
3. IF `FinalDoorEntered` is applied while the Final_Door is not available, THEN THE Runtime SHALL return a Typed_Rejection with kind `final-door-unavailable`.
4. WHEN a Reserved_Final_Door_Question is judged wrong, THE Runtime SHALL settle the slot, schedule no Return for it and leave the Concept_Outcome of its Concept unchanged.
5. WHEN every Final_Door slot is solved or settled, THE Runtime SHALL set the run status to Escaped.
6. WHILE the run is at the Final_Door, THE Runtime SHALL accept `AnswerSubmitted`, `Skipped`, `Challenged` and `HintUsed` for Open_Slots under the same rules as in a room.
7. THE Runtime SHALL reach Escaped within at most (total Concepts × 4) + (number of Reserved_Final_Door_Questions) judged prompts, for every Manifest and every learner policy (all wrong, all skip, all challenge, random) in which the learner keeps acting on Open_Slots.
8. WHILE the run is at the Final_Door, THE Runtime SHALL waive GHOST_DELAY, so that a Ghost spawned at the Final_Door is due immediately.
9. WHEN a Return at the Final_Door is judged wrong, THE Runtime SHALL apply Requirements 14 and 16 unchanged, so that a wrong return 1 spawns a return 2 that is due immediately under criterion 8.
10. THE Runtime SHALL leave the Concept_Outcome of a Concept unchanged by the result of any Reserved_Final_Door_Question for that Concept, while a correct answer still lights one candle under Requirement 13.
11. WHEN the run has Escaped, THE Runtime SHALL assign every Concept exactly one Concept_Outcome, including Concepts whose Returns were answered at the Final_Door.

### Requirement 21: Leaving and resuming

**User Story:** As a learner, I want to leave mid-run and come back to the same place, so that I can study in short sessions.

#### Acceptance Criteria

1. WHEN `RunLeft` is applied during a run that is in progress, THE Runtime SHALL set the run status to "left" and keep all other State unchanged.
2. WHEN `RunResumed` is applied while the run status is "left", THE Runtime SHALL set the run status to "in progress" and restore the State from before `RunLeft`.
3. IF `RunResumed` is applied while the run status is not "left", THEN THE Runtime SHALL return a Typed_Rejection with kind `run-not-left`.
4. IF `RunLeft` is applied while the run status is already "left", THEN THE Runtime SHALL return a Typed_Rejection with kind `cannot-leave`.
5. WHILE the run status is "left", THE Runtime SHALL report the run as unfinished in State.
6. THE Runtime SHALL make the Autopsy available only when the run status is Escaped.

### Requirement 22: Concept outcomes

**User Story:** As a learner, I want one clear result for each idea at the end, so that I know what to look at again.

#### Acceptance Criteria

1. WHEN the run has Escaped, THE Runtime SHALL assign each Concept exactly one Concept_Outcome.
2. THE Runtime SHALL assign the Concept_Outcome by this precedence, highest first: Challenged, Review due, Retried, Assisted, First-try correct.
3. WHEN every question asked for a Concept was challenged, THE Runtime SHALL assign the outcome Challenged and exclude the Concept from the score (candle count and correct counts), while still counting the Concept in the total under criterion 9.
4. WHEN a challenged question is replaced by an Alternate that is then answered, THE Runtime SHALL assign the outcome from the Alternate's result.
5. WHEN a Concept is a Lingering_Spirit, was skipped with no Alternate left, or has a challenged Return after an earlier unchallenged wrong answer or skip, THE Runtime SHALL assign the outcome Review due, unless criterion 3 applies.
6. WHEN a Concept was answered correctly on a Return after a wrong answer or a skip, THE Runtime SHALL assign the outcome Retried.
7. WHEN a Concept was answered correctly with no earlier wrong answer or skip for the Concept, and the question judged correct had an Applied_Hint, THE Runtime SHALL assign the outcome Assisted.
8. WHEN a Concept was answered correctly with no earlier wrong answer or skip for the Concept, and the question judged correct had no Applied_Hint, THE Runtime SHALL assign the outcome First-try correct.
9. THE Runtime SHALL make the sum of the five Concept_Outcome counts, Challenged included, equal to the number of Concepts in the Manifest.
10. THE Runtime SHALL make no claim of mastery, exam readiness or learning gain in any Concept_Outcome or its label.
11. WHEN a primary question that had an Applied_Hint is challenged and replaced by an Alternate that is judged correct with no Applied_Hint on the Alternate, THE Runtime SHALL assign the outcome First-try correct, because the hint was applied to the challenged question and not to the question judged correct.

### Requirement 23: Autopsy labels in the copy catalogue

**User Story:** As a project owner, I want every Autopsy phrase in one catalogue, so that the banned-words test covers all of it.

#### Acceptance Criteria

1. THE Runtime SHALL expose one Autopsy_Label for each Concept_Outcome, defined in `packages/core/src/copy.ts`.
2. THE Autopsy_Label for each outcome SHALL be "First-try correct", "Assisted", "Retried", "Challenged: excluded from score" and "Review due" for the respective outcomes.
3. THE Runtime SHALL expose the Return label "Review" from `packages/core/src/copy.ts`.
4. WHEN the banned-words test runs over `packages/core/src/copy.ts`, THE Test_Suite SHALL fail if any label contains "verified", "guaranteed", "100% accurate", "hallucination-free", "mastered" or "exam-ready".
5. THE Runtime SHALL write every learner-facing label in the tone defined in `.kiro/steering/tone.md`, with short plain sentences and no shaming language.

### Requirement 24: Outcome notices

**User Story:** As an interface developer, I want the runtime to say what happened, so that the visuals can react without reading rules.

#### Acceptance Criteria

1. WHEN `apply` succeeds, THE Runtime SHALL return the new State and a list of zero or more Outcome_Notices.
2. THE Runtime SHALL emit each Outcome_Notice kind only in these cases: `candleLit` under Requirement 13; `ghostSpawned` when a Ghost is spawned under Requirement 14; `ghostLaidToRest` when a Return is judged correct under Requirement 14; `sealCracked` under Requirement 17, criteria 1 to 3; `roomCleared` on the Event that makes a room Cleared; `escaped` on the Event that sets the run status to Escaped.
3. THE Runtime SHALL define each Outcome_Notice as a plain serialisable record that names the notice kind and the affected Concept, Lock_Slot or room ID. A `candleLit` notice SHALL state whether it lit the own candle of a slot (naming the slot) or a Spirit_Candle (naming the room or the Final_Door).
4. THE Runtime SHALL leave the Event_Log free of Outcome_Notices.
5. WHEN the same Event_Log is replayed, THE Runtime SHALL emit the same Outcome_Notices in the same order.
6. THE Runtime SHALL make no reference to animation, colour, sound or layout in any Outcome_Notice.
7. THE Runtime SHALL emit each Outcome_Notice exactly once for each Event that causes it, and emit `roomCleared` at most once per room and `escaped` at most once per run.
8. WHEN one Event causes several Outcome_Notices, THE Runtime SHALL return them in the order `candleLit`, `ghostLaidToRest`, `ghostSpawned`, `sealCracked`, `roomCleared`, `escaped`.

### Requirement 25: Manifest fixture builder

**User Story:** As a developer, I want a simple way to build test crypts, so that every test in this spec and later specs starts from a valid manifest, including rooms large enough for Returns to happen inside a room.

#### Acceptance Criteria

1. THE Fixture_Builder SHALL reside in `packages/core/src/test-support/` next to `arbitraries.ts` and build a valid Manifest from a small set of options.
2. THE Fixture_Builder SHALL accept the number of rooms (1 to 5), the number of Concepts per room (1 to 6) with a distinct primary LockType for each Concept within the same room, whether each Concept has an Alternate, the LockType of each question, an optional Hint_Effect for each primary question, Alternate and Reserved_Final_Door_Question (carried on the question, not on the slot), and an optional `lockTypes` list that defaults to all six LockTypes.
3. THE Fixture_Builder SHALL build Alternates with a lock type different from the primary question.
4. THE Fixture_Builder SHALL build a final-door set of 2 to 4 questions drawn from Concepts across rooms.
5. THE Fixture_Builder SHALL produce the same Manifest for the same options and call no source of randomness unless a seed is supplied.
6. THE Fixture_Builder SHALL build only fictional notes content and no real user content.
7. THE Fixture_Builder SHALL build only Manifests for which the Manifest_Check returns ok.
8. THE manifest arbitraries in `arbitraries.ts` SHALL generate only Manifests for which the Manifest_Check returns ok.
9. WHERE the `lockTypes` list holds fewer than six LockTypes, THE Fixture_Builder SHALL draw every primary and Alternate LockType only from that list and SHALL cap the number of Concepts per room at the number of LockTypes in the list.
10. WHERE the `lockTypes` list holds one LockType, THE Fixture_Builder SHALL build no Alternates, because an Alternate needs a LockType different from its primary question.
11. THE manifest arbitraries SHALL draw from all six LockTypes and SHALL generate rooms of 4 to 6 Lock_Slots in a share of cases, so that a Return_Slot becomes due inside a room under Requirement 15 and Requirement 30.
12. THE Fixture_Builder SHALL give every QuestionSpec it builds, including every Alternate and every Reserved_Final_Door_Question, a Question_Id that is unique within the Manifest.
13. THE manifest arbitraries SHALL generate only Manifests in which every Question_Id is unique within the Manifest.

### Requirement 26: Judges for the other four lock types

**User Story:** As a learner, I want all six lock types judged by the same rules as the rune cipher and séance board, so that every lock behaves predictably.

#### Acceptance Criteria

1. THE Bone_Ordering_Judge SHALL return correct only when the submitted permutation equals the key exactly, and SHALL return invalid for a submission that is not a permutation of the items.
2. WHEN the Applied_Hint locks the first bone, THE Bone_Ordering_Judge SHALL return invalid for a submission that moves that bone.
3. THE Bound_Threads_Judge SHALL return correct only when the set of submitted pairs equals the key set, and SHALL return invalid when any left item is not tied.
4. WHEN the Applied_Hint ties a thread, THE Bound_Threads_Judge SHALL return invalid for a submission that removes that thread.
5. THE Cursed_Object_Judge SHALL return correct when the selected ID equals the odd-one-out ID, SHALL return wrong when the selected ID is a listed object that the Applied_Hint does not remove and differs from the odd-one-out ID, and SHALL return invalid when the selected ID is not listed or is an object removed by the Applied_Hint.
6. THE Combination_Dial_Judge SHALL return correct for an exact value or a value inside the stated range or tolerance, with units fixed by the question and at most one decimal place supported.
7. THE Combination_Dial_Judge SHALL return invalid for non-numeric input or input with more than one decimal place, and SHALL return wrong for `59.9` against a range of 60 to 100.
8. THE Combination_Dial_Judge SHALL return correct for `60` and `100` against a range of 60 to 100, and for `21.5` against a key of 21.5.
9. THE Judge for each of these four lock types SHALL reside in `packages/core/src/locks/<type>.ts` with a matching `<type>.test.ts`, where `<type>` is `bone-ordering`, `bound-threads`, `cursed-object` or `combination-dial`.
10. THE Judge for each of these four lock types SHALL be a pure function with the signature `judge(question, submission, appliedHint)` that returns a typed result and throws no exception for any input.

### Requirement 27: Lock type IDs

**User Story:** As a developer, I want one fixed set of lock type IDs, so that the runtime, the generation spec and the art files all name each lock the same way.

#### Acceptance Criteria

1. THE Runtime SHALL define LockType in `packages/core/src/types.ts` as exactly the closed union `'rune-cipher' | 'seance-board' | 'bone-ordering' | 'bound-threads' | 'cursed-object' | 'combination-dial'`.
2. THE Runtime SHALL use these LockType IDs, and no other spelling, in every lock file name under `packages/core/src/locks/` and in every Event, State field and Outcome_Notice that names a lock type.
3. IF an Event carries a lock type that is not a member of LockType, THEN THE Runtime SHALL return a Typed_Rejection with kind `malformed-event`.
4. IF a Manifest carries a lock type that is not a member of LockType, THEN THE Manifest_Check SHALL return an `invalid-manifest` error.

### Requirement 28: One lock per type in each room

**User Story:** As a learner, I want each room to show each kind of lock at most once, so that every lock has its own station in the room.

#### Acceptance Criteria

1. THE Manifest_Check SHALL accept a Manifest only when each room holds at most one Lock_Slot of each Station_Type, so that a room holds at most six Lock_Slots.
2. THE Manifest_Check SHALL apply the one-lock-per-type rule to the Lock_Slots of rooms and exempt the Final_Door, whose slots may repeat LockTypes.
3. IF a room holds two Lock_Slots with the same Station_Type, THEN THE Manifest_Check SHALL return `{ ok: false, error: { kind: 'invalid-manifest', room, lockType } }` naming the first such room and the first repeated LockType found.
4. THE Manifest_Check SHALL be a pure function in `packages/core/src/runtime/` with matching tests, return a typed result for every input and throw no exception.
5. THE Runtime SHALL include `invalid-manifest` in the closed union of Typed_Rejection kinds defined under Requirement 3.
6. THE Manifest_Check SHALL ignore Return_Slots, because Return_Slots are not part of the Manifest.
7. WHEN `RunStarted` is applied, THE Runtime SHALL apply the Manifest_Check to the Manifest as stated in Requirement 2, criterion 6, and `initial(manifest, settings)` SHALL NOT apply it and SHALL NOT throw for a Manifest that fails it.
8. THE Manifest_Check SHALL require every QuestionSpec, including every Alternate and every Reserved_Final_Door_Question, to carry a Question_Id.
9. IF two QuestionSpecs in the Manifest carry the same Question_Id, THEN THE Manifest_Check SHALL return `{ ok: false, error: { kind: 'invalid-manifest', questionId } }` naming the first duplicated Question_Id found.
10. IF a Manifest has both a repeated Station_Type in a room and a duplicated Question_Id, THEN THE Manifest_Check SHALL report the repeated Station_Type under criterion 3.

### Requirement 29: Station type and current question type

**User Story:** As an interface developer, I want to know both which station a lock is and which question it holds now, so that the art shows the right station while the panel shows the right question.

#### Acceptance Criteria

1. WHEN a Lock_Slot is created from the Manifest, THE Runtime SHALL set its Station_Type to the LockType of its primary question.
2. THE Runtime SHALL keep the Station_Type of a Lock_Slot unchanged for the whole run.
3. THE Runtime SHALL expose the Current_Question_Type of every Lock_Slot in State, separately from its Station_Type.
4. WHEN `Challenged` is applied under Requirement 17, criterion 1, THE Runtime SHALL set the Current_Question_Type of the Lock_Slot to the LockType of the Alternate and leave the Station_Type unchanged.
5. THE Runtime SHALL judge every `AnswerSubmitted` with the judge for the Current_Question_Type of the slot, which differs from the judge for the Station_Type after a challenge replacement.
6. THE Runtime SHALL give each Return_Slot a Current_Question_Type equal to the LockType of its Return question and no Station_Type.

### Requirement 30: Return slots are not lock stations

**User Story:** As a learner, I want a returning idea to appear as its own slot, so that room clearing stays honest and no lock station is taken over.

#### Acceptance Criteria

1. WHEN a Ghost or deferred skip becomes due, THE Runtime SHALL add a Return_Slot to the current room as a slot separate from every Lock_Slot.
2. THE Runtime SHALL leave the Lock_Slots of the room and their Station_Types unchanged when a Return_Slot is added.
3. THE Runtime SHALL exclude Return_Slots from the one-lock-per-type rule in Requirement 28.
4. WHILE a Return_Slot in a room is neither solved nor settled, THE Runtime SHALL keep that room from being Cleared, as stated in Requirement 15, criterion 6.
5. WHEN one Event settles the last open slot of a room and also makes a Ghost or deferred skip due, THE Runtime SHALL add the Return_Slot before it decides whether the room is Cleared.
6. WHEN a Ghost or deferred skip is due at the Final_Door, THE Runtime SHALL treat its Return_Slot as a Final_Door slot under Requirement 20.

### Requirement 31: State exposed to the interface

**User Story:** As an interface developer, I want each room's slots, candles, ghosts and clearing status in State, so that the screens draw the crypt from State alone.

#### Acceptance Criteria

1. THE Runtime SHALL expose, for every published room, each Lock_Slot with its slot ID, Station_Type, Current_Question_Type, Slot_Status and candle-lit flag.
2. THE Runtime SHALL set the Slot_Status of a slot to `open` while the slot is neither solved nor settled, including after a challenge replaced the question with the Alternate.
3. WHEN a slot is judged correct, THE Runtime SHALL set its Slot_Status to `solved`.
4. WHEN a slot is judged wrong or skipped, THE Runtime SHALL set its Slot_Status to `settled`.
5. WHEN a slot is settled by a challenge with no further question under Requirement 17, criteria 2 to 4, THE Runtime SHALL set its Slot_Status to `challenged`.
6. THE Runtime SHALL set the candle-lit flag of a Lock_Slot to true only while its Slot_Status is `solved`.
7. THE Runtime SHALL expose, for every room, the due Return_Slots with their slot ID, Concept, return number, Current_Question_Type and Slot_Status.
8. THE Runtime SHALL expose the list of pending Ghosts, each with its Concept, return number and a flag saying whether it is due.
9. THE Runtime SHALL expose, for every room, the Spirit_Candles lit there by correct Returns, each naming its Concept and Return_Slot.
10. THE Runtime SHALL expose, for every room, whether the room is Cleared.
11. THE Runtime SHALL expose, for the Final_Door, each slot with its slot ID, whether it is a Reserved_Final_Door_Question or a Return_Slot, its Current_Question_Type, its Slot_Status, and the Spirit_Candles lit there.
12. THE Runtime SHALL derive all of these values from the Manifest, Run_Settings and Event_Log only, and keep them JSON-serialisable.
## Out of Scope

The following belong to other specs or to later work. This spec does not implement them.

- Storage: IndexedDB, single-tab handling, save errors and export belong to spec 4. This spec only makes State foldable and serialisable.
- Animation and visuals belong to spec 5. This spec emits what happened as Outcome_Notices, and the interface decides how it looks.
- Question generation, the real manifest builder, chunking and evidence checks belong to spec 3. This spec uses only the Fixture_Builder.
- The React binding in `apps/web/src/state/` and all screens.
- The lock interfaces (the interaction and art) for bone ordering, bound threads, cursed object and combination dial. Their Judges in Requirement 26 are in scope.
- Deciding who calls the Manifest_Check before publishing. Spec 3 calls it before publishing a Manifest. The check in `RunStarted` (Requirement 2, criterion 6) is only a backstop for stored Manifests.
- Timers, scores that depend on speed, leaderboards and any server-side storage of runs or challenges.
