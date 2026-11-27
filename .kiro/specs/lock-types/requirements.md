# Requirements Document

## Introduction

Lock types makes the four remaining lock types playable: bone ordering, bound threads, combination dial and cursed object. Their judges and payload types already exist and are tested in `packages/core/src/locks/`. Room play (spec 5) shipped panels for rune cipher and séance board only, and shows an "unplayable" message for every other type.

This spec adds one panel per type, registered in `apps/web/src/features/crypt/lock-panel-registry.ts` next to the rune and séance panels. It also widens the manifest so that questions of these types can be published, and it ships three sample crypts (human heart, HTTPS, printing press) that each place all six types across their rooms and final door, so that a judge can pick any of the three.

Live generation of these four types is another machine's work and is not touched here. That work edits `packages/core/src/pipeline/**`, `checks/**`, `mapper/**`, `apps/worker/**`, `eval/**` and `apps/web/src/state/**`. This spec must not edit those paths, with the single narrow exception in Requirement 2.

Six other files are being edited by the other machine right now for multi-room play and the rune letter count: `room-screen.tsx`, `art-room.ts`, `question-controls.tsx`, `rune-cipher-panel.tsx`, `room-panel.tsx` and `lock-panel-context.ts`. Requirement 1 sequences this work behind that push.

Findings from reading the code that shape these requirements:

- `payloadSchemaFor` in `runtime/manifest-schema.ts` returns `null` for the three types without a payload schema, so the manifest rejects them with `lock-type-not-supported`. Bone ordering already has a schema.
- `narrowHint` in `runtime/manifest-hints.ts` handles four types. The mapper plan for generation gives bound threads a `tie-thread` hint, cursed object a `remove-option` hint and combination dial no hint (`null`). This spec matches that plan so the two machines agree on one manifest shape.
- The bone ordering and bound threads mappers (existing and planned) emit `itemIds` equal to `keyOrder` and `leftIds` aligned with `rightIds` in key order. A panel that lists them as given would show the answer, so each panel must shuffle its display order in a controlled way (Requirement 3).
- The authoring schema and mapper in `packages/core/src/authoring` and `mapper/` have no arm for bound threads, cursed object or combination dial yet. The sample builders therefore need a sample-only mapping that does not touch `mapper/**` (Requirement 12).
- `samples/questions/https.json` holds no rune cipher question, so that sample needs one added question to place all six types.
- `restoreRun` in `apps/web/src/state/storage/restore-run.ts` rebuilds only the bundled human-heart sample. Resume of a run on another sample is therefore an open item (Requirement 12, criterion 12).

## Glossary

- **Lock_Types_Feature**: The feature specified here: the four new lock panels, their pure interaction models, the manifest widening and the three sample crypts.
- **New_Lock_Types**: The four lock types `bone-ordering`, `bound-threads`, `combination-dial` and `cursed-object`.
- **Lock_Panel**: A React component registered in `LOCK_PANELS` that renders one lock type's question controls inside the Question_Panel. It follows the pattern of `RuneCipherPanel` and `SeanceBoardPanel`.
- **Lock_Panel_Registry**: The `LOCK_PANELS` map in `lock-panel-registry.ts`.
- **Question_Panel**: The shell in `question-panel.tsx` that wraps a Lock_Panel with heading, focus handling and Hint, Skip and Challenge controls.
- **Unplayable_Panel**: The `UnplayablePanel` component shown for a question type that has no Lock_Panel.
- **Unknown_Type**: A question type string that is not a key of the Lock_Panel_Registry.
- **Interaction_Model**: A pure TypeScript module in `packages/core/src/locks/` named `<type>-interaction.ts`. It holds the draft of one lock panel as a plain value, exposes the operations the controls perform, and converts the draft to the submission the judge expects. It uses no React, no timers, no randomness and no I/O.
- **Judge**: The pure `judge` function of a lock type in `packages/core/src/locks/<type>.ts`. These files are read-only for this spec.
- **Submission**: The JSON value that the Lock_Panel passes in `submitAnswer`: `{ order }` for bone ordering, `{ pairs }` for bound threads, `{ rawInput }` for combination dial and `{ selectedId }` for cursed object.
- **Display_Order**: The order in which a panel shows the items of a question. It is derived by code from the question ID and the payload and is never taken from `keyOrder` or `keyPairs`.
- **Order_Seed**: The question ID, used as the seed of the Display_Order function so that the same question shows the same order on every render and on every remount.
- **Pinned_Bone**: The bone named by an applied `lock-first-bone` hint. The Judge requires it at its key position.
- **Hinted_Pair**: The pair named by an applied `tie-thread` hint. The Judge requires it in the submitted pairs.
- **Removed_Item**: The item named by an applied `remove-option` hint on a cursed object question.
- **Thread**: One pair of a left item and a right item in a bound threads draft.
- **Wheel**: One digit control of the combination dial, with values 0 to 9.
- **Typed_Entry**: The text input of the combination dial in which the learner types the number.
- **Live_Announcer**: The single polite live region of the Room_Screen (`LiveRegion`) and the `announce` function that adds one message to its queue.
- **Transparent_Hotspot_Rule**: The rule in `art-stage.css` that every `.room-hotspot` button has a transparent background, no border and no padding, so no grey box covers the art.
- **Lock_Closeup**: The `LockCloseUp` component that shows `locks/<type>/closed.webp` or `open.webp` behind a Question_Panel.
- **Sample_Crypt_Entry**: One of the three bundled sample crypts: `human-heart`, `https` and `printing-press`. Each has a notes file in `samples/`, a questions file in `samples/questions/` and a builder in `packages/core/src/sample-crypt/`.
- **Sample_Questions_File**: A file `samples/questions/<sample>.json`.
- **Sample_Mapping**: The sample-only mapping in `packages/core/src/sample-crypt/` that turns the bound threads, cursed object and combination dial questions of a Sample_Questions_File into QuestionSpecs and Crypt_Content entries, without using `mapper/**`.
- **Sample_Picker**: The control on the start view that lets the learner choose which Sample_Crypt_Entry to play.
- **Crypt_Bundle_Parser**: `parseCryptBundle` in `packages/core/src/mapper/crypt-bundle-parse.ts`.
- **Manifest_Schema**: `CryptManifestSchema` and its payload schemas in `packages/core/src/runtime/manifest-schema.ts`.
- **Other_Machine**: The second development machine that owns the paths listed in the Introduction.
- **Checkpoint**: A point in the task list where the full unit suite or the full end-to-end suite is run.
- **Phone_Project**: The Playwright project `pixel` (Pixel 7 device).
- **Banned_Phrases**: The strings in `BANNED_COPY_PHRASES` in `packages/core/src/copy.ts`.

## Requirements

### Requirement 1: Delivery order and coordination with the other machine

**User Story:** As the project owner, I want this work to start only after the other machine's changes are pushed and to stay out of its files, so that the two machines never produce merge conflicts or overwrite each other.

#### Acceptance Criteria

1. THE Lock_Types_Feature SHALL start implementation only after the user has confirmed that the Other_Machine's work on multi-room play and the rune letter count is pushed.
2. WHEN implementation of any task begins, THE implementer SHALL run `git pull --rebase` and confirm that the pull succeeded before editing any file.
3. WHEN a commit is about to be created, THE implementer SHALL run `git pull --rebase` immediately before the commit.
4. IF `git pull --rebase` reports a conflict, THEN THE implementer SHALL stop, report the conflicting files to the user and make no further edits until the user decides.
5. THE Lock_Types_Feature SHALL NOT edit any file under `packages/core/src/pipeline/`, `packages/core/src/checks/`, `packages/core/src/mapper/`, `apps/worker/`, `eval/` or `apps/web/src/state/`, except as Requirement 2 criterion 7 allows.
6. THE Lock_Types_Feature SHALL NOT edit any existing file in `packages/core/src/locks/`, and SHALL add new files there only for Interaction_Models and their tests.
7. THE Lock_Types_Feature SHALL NOT change live generation, the worker, the authoring schema, the prompts or the checks for any lock type.
8. WHEN the pull has succeeded, THE implementer SHALL read the current contents of `room-screen.tsx`, `art-room.ts`, `question-controls.tsx`, `rune-cipher-panel.tsx`, `room-panel.tsx` and `lock-panel-context.ts` before changing any of them.
9. WHERE an edit to one of the files in criterion 8 is needed, THE Lock_Types_Feature SHALL keep the edit to the smallest change that the requirement needs and SHALL leave multi-room behaviour and the rune letter count unchanged.

### Requirement 2: Manifest widening for the three missing payloads

**User Story:** As a developer, I want the manifest to accept bound threads, cursed object and combination dial questions with the same payload shapes as their judges, so that a sample crypt can be published and played.

#### Acceptance Criteria

1. THE Manifest_Schema SHALL accept a `bound-threads` payload `{ leftIds, rightIds, keyPairs }` WHEN `leftIds` and `rightIds` each hold 3 to 4 unique non-empty IDs, both have the same length, and `keyPairs` is a one-to-one matching that uses every left ID and every right ID exactly once.
2. THE Manifest_Schema SHALL accept a `cursed-object` payload `{ optionIds, oddOneOutId }` WHEN `optionIds` holds exactly 4 unique non-empty IDs and `oddOneOutId` is one of them.
3. THE Manifest_Schema SHALL accept a `combination-dial` payload that matches `CombinationDialQuestion` with `kind` `exact`, `range` or `tolerance`, with the fields that the kind needs, finite numbers, a non-empty `unit`, `min` not greater than `max` for `range`, and `tolerance` not below 0.
4. THE `narrowHint` function SHALL accept for `bound-threads` only a `tie-thread` hint whose pair is one of the payload's `keyPairs`, or `null`.
5. THE `narrowHint` function SHALL accept for `cursed-object` only a `remove-option` hint whose option ID is in `optionIds` and is not `oddOneOutId`, or `null`.
6. THE `narrowHint` function SHALL accept for `combination-dial` only `null`, because the Judge ignores hints for that type.
7. WHERE the Crypt_Bundle_Parser needs a change so that a bundle holding the three new payloads and their Crypt_Content entries parses, THE Lock_Types_Feature SHALL change only `packages/core/src/mapper/crypt-bundle-parse.ts` and, if the Crypt_Content schema blocks the new entries, `packages/core/src/mapper/crypt-content.ts`, and SHALL report the change to the user.
8. THE Manifest_Schema SHALL keep the limits of at most one Lock_Slot per lock type per room, at most 4 final-door questions and an Alternate of a different lock type from its primary.
9. IF a payload of one of the three types fails its schema, THEN THE Manifest_Schema SHALL return a `manifest-schema-invalid` error that names the payload path and holds no payload content.
10. FOR ALL valid payloads of the three types, serialising a manifest to JSON and parsing it with the Manifest_Schema SHALL produce an equal manifest (round-trip property).
11. FOR ALL valid payloads of the six lock types and all hints that `narrowHint` accepts, THE Manifest_Schema SHALL accept the QuestionSpec, and FOR ALL hints of a kind that `narrowHint` does not accept for that type, THE Manifest_Schema SHALL reject it.
12. THE payload shapes for the three types SHALL stay identical to the shapes that `locks/bound-threads.ts`, `locks/cursed-object.ts` and `locks/combination-dial.ts` already define, so that `judge` consumes a parsed payload without conversion.

### Requirement 3: Interaction models and display order

**User Story:** As a developer, I want the draft logic of each panel in a pure module, so that I can prove with property tests that the interaction the learner performs builds the answer the judge accepts.

#### Acceptance Criteria

1. THE Lock_Types_Feature SHALL provide one Interaction_Model per New_Lock_Type in `packages/core/src/locks/`, each with a matching `.test.ts`, and a shared pure Display_Order function with its own test.
2. THE Display_Order function SHALL be deterministic for a given list of IDs and Order_Seed, SHALL return a permutation of the input and SHALL use no random source.
3. FOR ALL bone ordering payloads with `itemIds` equal to `keyOrder`, THE bone ordering Interaction_Model SHALL create an initial draft whose order is not equal to `keyOrder`.
4. WHILE a `lock-first-bone` hint is applied, THE bone ordering Interaction_Model SHALL create an initial draft that holds the Pinned_Bone at its key position and every other bone in an order that differs from `keyOrder`.
5. FOR ALL bound threads payloads with `rightIds` aligned with `leftIds` in key order, THE bound threads Interaction_Model SHALL create a Display_Order of `rightIds` in which no right item stands on the row of its key partner.
6. THE Interaction_Models SHALL expose no function that returns `keyOrder`, `keyPairs`, `oddOneOutId` or `exactValue`, `min`, `max`, `value` or `tolerance` to the panel, except through the Judge.
7. THE bone ordering Interaction_Model SHALL provide operations that move one bone up and move one bone down, and SHALL keep the Pinned_Bone in its place on every operation.
8. WHEN an operation would move a bone beyond the first or last position, THE bone ordering Interaction_Model SHALL return the draft unchanged.
9. THE bound threads Interaction_Model SHALL provide operations that select a left item, select a right item, tie the selected pair and undo one Thread, and SHALL keep every draft one-to-one.
10. IF the learner selects a right item that is already tied or a left item that is already tied, THEN THE bound threads Interaction_Model SHALL leave the draft unchanged and SHALL report which item was refused.
11. WHILE a `tie-thread` hint is applied, THE bound threads Interaction_Model SHALL hold the Hinted_Pair as a Thread that no operation can undo.
12. THE combination dial Interaction_Model SHALL hold the draft as one text value, SHALL provide operations that step one Wheel up, step one Wheel down and set the text from Typed_Entry, and SHALL keep the Wheels and the text in agreement.
13. THE combination dial Interaction_Model SHALL create a Wheel row with a count of Wheels of at least 3 and at least as many as the integer digits of the largest number the question states, and SHALL add a tenths Wheel only WHERE a stated number has a decimal place.
14. WHEN a Wheel passes 9 going up or 0 going down, THE combination dial Interaction_Model SHALL wrap that Wheel and leave the other Wheels unchanged.
15. THE cursed object Interaction_Model SHALL provide operations that choose one item and clear the choice, and SHALL refuse to choose the Removed_Item.
16. FOR ALL Interaction_Models, converting a draft to a Submission SHALL return the shape listed in the glossary for that type, and SHALL return a typed "not ready" result instead of a Submission WHEN the draft is incomplete (a bound threads draft with an untied left item, a dial with empty text, a cursed object with no choice).
17. FOR ALL Interaction_Models, THE Interaction_Model SHALL return a typed result and throw no exception for any input.

### Requirement 4: Bone ordering panel

**User Story:** As a learner, I want to put steps in order with buttons or the keyboard, so that I can answer without dragging.

#### Acceptance Criteria

1. WHEN the Question_Panel is open for a slot whose Current_Question_Type is `bone-ordering`, THE Bone_Ordering_Panel SHALL show the prompt as plain text and an ordered list of the bones, using the texts in `content.questions[questionId].options` and the Display_Order.
2. THE Bone_Ordering_Panel SHALL give every bone a "Move up" button and a "Move down" button whose accessible names include the bone text and its current position, for example "Move up: Tricuspid valve, position 2 of 4".
3. WHILE a bone is in the first position, THE Bone_Ordering_Panel SHALL disable that bone's "Move up" button, and WHILE a bone is in the last position, THE Bone_Ordering_Panel SHALL disable that bone's "Move down" button.
4. WHEN the learner activates a move button, THE Bone_Ordering_Panel SHALL move the bone one position, keep keyboard focus on the same move button of the moved bone and announce the new position through the Live_Announcer.
5. WHEN a bone has keyboard focus and the learner presses Alt with the Up or Down arrow key, THE Bone_Ordering_Panel SHALL move that bone one position up or down, keep focus on the bone and announce the new position.
6. WHEN a bone has keyboard focus and the learner presses the Up or Down arrow key without Alt, THE Bone_Ordering_Panel SHALL move focus to the previous or next bone without changing the order.
7. THE Bone_Ordering_Panel SHALL show a visible line that names the Alt and arrow key shortcut and the move buttons.
8. WHILE the slot's Applied_Hint is `lock-first-bone` for the current question, THE Bone_Ordering_Panel SHALL show the Pinned_Bone with the text label "Fixed by hint", disable both of its move buttons and keep it in place.
9. WHEN the learner activates "Submit answer", THE Bone_Ordering_Panel SHALL dispatch `submitAnswer` with the submission `{ order }` holding the bone IDs in the displayed order.
10. THE Bone_Ordering_Panel SHALL keep the displayed order as a Draft_Answer in the panel only, and SHALL NOT put it in the Event_Log or in State.
11. THE Bone_Ordering_Panel SHALL need no drag and SHALL give every control a target of at least 44 by 44 px, including on the Phone_Project.
12. THE Bone_Ordering_Panel SHALL show the Hint, Skip and Challenge controls of the Question_Panel and SHALL accept a Skip and a Challenge at any time before the answer is judged.
13. FOR ALL valid bone ordering payloads and ALL applicable hints, the Submission that the move operations build WHEN the learner reaches `keyOrder` SHALL be judged `correct` by the core Judge, and FOR ALL other permutations the Judge SHALL judge it `wrong` (property test).

### Requirement 5: Bound threads panel

**User Story:** As a learner, I want to connect each left item to its right item by choosing one and then the other, and to undo a connection, so that I can answer a matching question without dragging.

#### Acceptance Criteria

1. WHEN the Question_Panel is open for a slot whose Current_Question_Type is `bound-threads`, THE Bound_Threads_Panel SHALL show the prompt as plain text, a left column in manifest order and a right column in the Display_Order, using texts from `content.questions[questionId].options`.
2. WHEN the learner activates an untied left item, THE Bound_Threads_Panel SHALL mark it as selected with a text label and `aria-pressed`, and SHALL announce "Selected: <text>. Choose a matching item on the right." through the Live_Announcer.
3. WHEN a left item is selected and the learner activates an untied right item, THE Bound_Threads_Panel SHALL tie the two as a Thread, clear the selection, show the Thread as a text line that names both items and announce the new Thread.
4. WHEN no left item is selected and the learner activates an untied right item, THE Bound_Threads_Panel SHALL select nothing and SHALL show a short message that asks the learner to choose a left item first.
5. WHEN the learner activates a left item that is already selected, THE Bound_Threads_Panel SHALL clear the selection.
6. THE Bound_Threads_Panel SHALL show an "Undo" button for every Thread that the learner tied, with an accessible name that names both items, and WHEN the learner activates it THE Bound_Threads_Panel SHALL remove that Thread, return both items to untied and announce the removal.
7. WHILE the slot's Applied_Hint is `tie-thread` for the current question, THE Bound_Threads_Panel SHALL show the Hinted_Pair as tied with the text label "Tied by hint" and SHALL offer no Undo button for it.
8. WHEN the learner activates "Submit answer" while every left item is tied, THE Bound_Threads_Panel SHALL dispatch `submitAnswer` with the submission `{ pairs }` holding one `[leftId, rightId]` pair per Thread.
9. IF the learner activates "Submit answer" while a left item is untied, THEN THE Bound_Threads_Panel SHALL show a message that asks the learner to tie every item and SHALL dispatch no Event.
10. THE Bound_Threads_Panel SHALL show, for every item, a text state of "untied", "selected" or "tied to <partner text>", so that colour is not the only signal.
11. THE Bound_Threads_Panel SHALL keep the Threads and the selection as a Draft_Answer in the panel only.
12. THE Bound_Threads_Panel SHALL need no drag and SHALL give every control a target of at least 44 by 44 px, including on the Phone_Project.
13. THE Bound_Threads_Panel SHALL show the Hint, Skip and Challenge controls of the Question_Panel.
14. FOR ALL valid bound threads payloads and ALL applicable hints, the Submission that the select, tie and undo operations build WHEN the learner ties every pair of `keyPairs` SHALL be judged `correct` by the core Judge, and FOR ALL other complete one-to-one matchings the Judge SHALL judge it `wrong` (property test).
15. FOR ALL sequences of select, tie and undo operations, THE bound threads Interaction_Model SHALL keep every left item and every right item in at most one Thread (invariant property test).

### Requirement 6: Combination dial panel

**User Story:** As a learner, I want to set a number on a dial or type it, so that I can answer a question whose answer is a stated number.

#### Acceptance Criteria

1. WHEN the Question_Panel is open for a slot whose Current_Question_Type is `combination-dial`, THE Combination_Dial_Panel SHALL show the prompt as plain text, the unit from the payload as visible text next to the dial, a row of Wheels and a labelled Typed_Entry.
2. THE Combination_Dial_Panel SHALL give every Wheel an "Increase" button and a "Decrease" button whose accessible names state the Wheel's place value and current digit, for example "Increase digit, tens place, currently 4".
3. WHEN the learner activates a Wheel button, THE Combination_Dial_Panel SHALL step that Wheel, update the Typed_Entry text to match and announce the new number through the Live_Announcer.
4. WHEN a Wheel has keyboard focus and the learner presses the Up or Down arrow key, THE Combination_Dial_Panel SHALL step that Wheel up or down, and WHEN the learner presses the Left or Right arrow key THE Combination_Dial_Panel SHALL move focus to the next Wheel to the left or right.
5. WHEN the learner types in the Typed_Entry, THE Combination_Dial_Panel SHALL update the Wheels to match every typed digit that fits the Wheel row, and SHALL keep the typed text unchanged.
6. WHEN the learner presses Enter in the Typed_Entry or activates "Submit answer", THE Combination_Dial_Panel SHALL dispatch `submitAnswer` with the submission `{ rawInput }` holding the current text.
7. IF the text is empty after trimming, THEN THE Combination_Dial_Panel SHALL show a message that asks for a number and SHALL dispatch no Event.
8. IF the Room_Binding exposes the rejection kind `invalid-submission` for the slot, THEN THE Combination_Dial_Panel SHALL show a message that asks for a number written with digits and at most one decimal place, keep the draft and keep the slot open.
9. THE Combination_Dial_Panel SHALL accept a negative number or a decimal number in the Typed_Entry WHERE the Judge accepts it, and SHALL leave the Wheels at their last value for characters that the Wheels cannot show.
10. WHEN the learner activates "Hint", THE Question_Panel SHALL apply the hint as the runtime defines, AND WHILE the slot's Applied_Hint for the current question has no effect, THE Combination_Dial_Panel SHALL show a message that this lock has no hint to give.
11. THE Combination_Dial_Panel SHALL NOT show a digit, a range, a tolerance or any value taken from the payload before the answer is judged, except the unit.
12. THE Combination_Dial_Panel SHALL keep the draft text as a Draft_Answer in the panel only.
13. THE Combination_Dial_Panel SHALL need no drag and SHALL give every control a target of at least 44 by 44 px, including on the Phone_Project.
14. THE Combination_Dial_Panel SHALL show the Hint, Skip and Challenge controls of the Question_Panel.
15. FOR ALL valid dial payloads of kind `exact`, `range` and `tolerance`, the text that the Wheels or Typed_Entry build WHEN set to an accepted value SHALL be judged `correct` by the core Judge, and FOR ALL values outside the accepted set THE Judge SHALL judge the text `wrong` (property test).
16. FOR ALL dial drafts, setting the Wheels to the digits of a text and reading the text back through the Interaction_Model SHALL produce the same number (round-trip property).

### Requirement 7: Cursed object panel

**User Story:** As a learner, I want to pick the item that does not belong, so that I can answer an odd-one-out question.

#### Acceptance Criteria

1. WHEN the Question_Panel is open for a slot whose Current_Question_Type is `cursed-object`, THE Cursed_Object_Panel SHALL show the prompt as plain text and the item texts in manifest order as a group of radio inputs with a visible group label, using texts from `content.questions[questionId].options`.
2. WHEN the learner activates "Submit answer" with an item chosen, THE Cursed_Object_Panel SHALL dispatch `submitAnswer` with the submission `{ selectedId }`.
3. IF no item is chosen, THEN THE Cursed_Object_Panel SHALL show a message that asks the learner to choose an item and SHALL dispatch no Event.
4. WHILE the slot's Applied_Hint is `remove-option` for the current question, THE Cursed_Object_Panel SHALL show the Removed_Item as removed with a text label and SHALL disable it.
5. WHEN the learner presses an arrow key in the group, THE Cursed_Object_Panel SHALL move the choice to the next or previous enabled item and move focus to it.
6. THE Cursed_Object_Panel SHALL keep the choice as a Draft_Answer in the panel only.
7. THE Cursed_Object_Panel SHALL need no drag and SHALL give every control a target of at least 44 by 44 px, including on the Phone_Project.
8. THE Cursed_Object_Panel SHALL show the Hint, Skip and Challenge controls of the Question_Panel.
9. FOR ALL valid cursed object payloads and ALL applicable hints, the Submission that the choose operation builds WHEN the learner chooses `oddOneOutId` SHALL be judged `correct` by the core Judge, and FOR ALL other enabled items the Judge SHALL judge it `wrong` (property test).
10. FOR ALL valid cursed object payloads with a hint, THE Cursed_Object_Panel SHALL never allow the Removed_Item to be chosen.

### Requirement 8: Shared behaviour of the four panels

**User Story:** As a learner who uses a keyboard, a screen reader or a phone, I want the four new panels to behave like the rune and séance panels, so that I know what to expect.

#### Acceptance Criteria

1. THE Lock_Types_Feature SHALL implement one Lock_Panel per New_Lock_Type, each in its own file under `apps/web/src/features/crypt/` named `<type>-panel.tsx`, each at or below approximately 300 lines.
2. THE Lock_Types_Feature SHALL register the four Lock_Panels in the Lock_Panel_Registry under the keys `bone-ordering`, `bound-threads`, `combination-dial` and `cursed-object`.
3. THE Lock_Panels SHALL read the prompt and all texts from `content.questions[questionId]` through the Lock_Panel context, and SHALL render them as plain React text.
4. THE Lock_Panels SHALL use no `dangerouslySetInnerHTML`, no drag-and-drop API and no pointer-only gesture.
5. EVERY control of a Lock_Panel SHALL be reachable with Tab and Shift+Tab, operable with Enter or Space, and show the 2 px `--spectre-300` focus outline with an offset.
6. EVERY control of a Lock_Panel SHALL have an accessible name, and every state that a control shows (selected, tied, fixed by hint, removed, position) SHALL also be present in its accessible name or description.
7. WHEN a Lock_Panel changes its draft, THE Lock_Panel SHALL announce the change through the Live_Announcer and SHALL NOT create a second live region.
8. WHEN the Room_Binding exposes a `sealCracked` Outcome_Notice for a slot whose status is `open`, THE Question_Panel SHALL remount the Lock_Panel for the Alternate question with an empty draft, as it does for the rune and séance panels.
9. WHEN the Escape key is pressed while a Lock_Panel is open and no judged answer waits for Continue, THE Question_Panel SHALL close with no Event and keep the draft, as it does for the rune and séance panels.
10. WHEN a judged answer opens the Evidence_Panel for a question of a New_Lock_Type, THE Evidence_Panel SHALL show every excerpt of the question once, in stored order, with its Citation_Label, the explanation and the label "Source excerpt matched" WHERE the quote resolves.
11. THE Lock_Panels SHALL show every learner-facing string from `packages/core/src/copy-lock-panels.ts` and those strings SHALL contain no Banned_Phrases and no claim of mastery, exam readiness or learning gain.
12. THE Lock_Panels SHALL use Crimson Pro at 18 px or larger on desktop and 16 px or larger on phones for question text, and SHALL place every colour literal in `apps/web/src/styles/tokens.css`.
13. WHILE the viewport is a Phone_Viewport, THE Question_Panel SHALL show each Lock_Panel at full width with no horizontal scrolling and every control at least 44 by 44 px.

### Requirement 9: Registry and the unplayable path

**User Story:** As a developer, I want the unplayable path removed for the four types and kept for any other type, so that an unexpected type never breaks the escape.

#### Acceptance Criteria

1. THE Lock_Panel_Registry SHALL hold a Lock_Panel for all six lock types.
2. WHEN the Current_Question_Type of a slot is one of the six lock types, THE Room_Screen and THE final door SHALL show the Lock_Panel and SHALL NOT show the Unplayable_Panel.
3. IF the Current_Question_Type of a slot is an Unknown_Type, THEN THE Room_Screen and THE final door SHALL show the Unplayable_Panel with the message from `ROOM_PLAY_LABELS.unplayableType` and a "Skip" button.
4. THE Lock_Types_Feature SHALL keep `UnplayablePanel`, `ROOM_PLAY_LABELS.unplayableType` and the fallback branch in `question-panel.tsx` and `final-door.tsx`.
5. THE Test_Suite SHALL include a unit test that renders an Unknown_Type and checks that the Unplayable_Panel and its Skip button appear.
6. THE Test_Suite SHALL include a unit test that the Lock_Panel_Registry has one entry for each value of `LOCK_TYPES`.
7. THE Lock_Types_Feature SHALL update every existing test that expected an unplayable message for one of the four types so that it expects the Lock_Panel instead.

### Requirement 10: Lock art, close-ups and hotspots

**User Story:** As a learner, I want each of the four locks to look like a lock in the room and to show its close-up behind its panel, so that the crypt feels consistent.

#### Acceptance Criteria

1. WHEN the current room holds a Lock_Slot of a New_Lock_Type, THE Room_Screen SHALL draw that lock's four Lock_Layers, its Light_Pass and one Hotspot_Button from the Scene_File of the current Art_Room, with no change to the Scene_File format.
2. WHEN the Question_Panel opens for a New_Lock_Type, THE Lock_Closeup SHALL show `locks/<type>/closed.webp` for an open slot and `locks/<type>/open.webp` for a solved slot, using the existing images.
3. THE Hotspot_Button of each New_Lock_Type SHALL follow the Transparent_Hotspot_Rule, so that the computed background is transparent and the computed border width is 0.
4. THE Hotspot_Button of each New_Lock_Type SHALL be at least 44 by 44 px and SHALL have the accessible name that `lockName` returns for its type and status.
5. THE Lock_Types_Feature SHALL add no new image and SHALL NOT edit any file under `apps/web/public/art/`.
6. IF a close-up or lock layer fails to load, THEN THE Room_Screen SHALL log it once with the file name and error type only and keep the Lock_Panel usable.
7. THE Test_Suite SHALL include a unit test that, for each New_Lock_Type, the files `locks/<type>/closed.webp`, `closed@2x.webp`, `open.webp` and `open@2x.webp` exist.
8. THE Test_Suite SHALL include a unit test that, for each Art_Room and each New_Lock_Type, the Scene_File holds the lock entry with all four Lock_Layer files and the Light_Pass file.

### Requirement 11: Crypt_Content conventions for the four types

**User Story:** As a developer, I want one agreed way to carry item texts for the four types in Crypt_Content, so that the generator on the other machine and this spec produce the same shape.

#### Acceptance Criteria

1. THE Sample_Mapping SHALL store the item texts of a New_Lock_Type question in `content.questions[questionId].options`, keyed by the item ID that the payload uses: the step ID for bone ordering, both `leftIds` and `rightIds` for bound threads and `optionIds` for cursed object.
2. THE Sample_Mapping SHALL use the ID conventions `<questionId>-step-<i>` for bone ordering steps, `<questionId>-l<i>` and `<questionId>-r<i>` for bound threads and `<questionId>-o<i>` for cursed object items, where `<i>` is the zero-based authoring index.
3. THE Sample_Mapping SHALL store no item text for combination dial and SHALL carry the unit only in the payload.
4. THE Sample_Mapping SHALL give every excerpt a `chunkId` of a chunk of the sample notes and a quote that the Quote Resolver resolves against that chunk.
5. FOR ALL questions of the three Sample_Crypt_Entries, every item ID of the payload that has display text SHALL have an entry in `content.questions[questionId].options`, and no entry SHALL name an ID that the payload does not hold.
6. THE Crypt_Content of every sample question SHALL contain no field that holds an answer key.

### Requirement 12: Three sample crypts and the picker

**User Story:** As a judge, I want to pick any of three sample crypts and play all six lock types in it, so that I can see every lock without writing notes.

#### Acceptance Criteria

1. THE Lock_Types_Feature SHALL provide a builder for each Sample_Crypt_Entry in `packages/core/src/sample-crypt/`: the existing `buildHumanHeartSampleCrypt` (changed) and new builders for `https` and `printing-press`, each returning `{ manifest, content, chunks }` as a typed result.
2. FOR ALL three Sample_Crypt_Entries, THE builder SHALL return a manifest that holds a Lock_Slot or a final-door question of each of the six lock types, counting the primary question of every Lock_Slot and every final-door question.
3. FOR ALL three Sample_Crypt_Entries, THE manifest SHALL pass `validateManifestForPublish` and `parseCryptBundle` of its `{ manifest, content }`.
4. FOR ALL three Sample_Crypt_Entries, THE builder SHALL place Lock_Slots in at least two rooms and at least one question in the final door, and SHALL use at most 3 rooms.
5. THE builders SHALL select questions from the Sample_Questions_File with a fixed selection table in code, and SHALL NOT search for or reorder questions.
6. THE Sample_Mapping SHALL map the bound threads, cursed object and combination dial questions of a Sample_Questions_File, and SHALL use the existing mapper only for rune cipher, séance board and bone ordering questions.
7. THE Lock_Types_Feature SHALL add one rune cipher question to `samples/questions/https.json`, quoted from `samples/https.txt`, so that the HTTPS sample can place all six types, and SHALL record it with the same `draft` status as the other questions.
8. THE Sample_Questions_Files SHALL keep `status` set to a draft value, so that `isHumanReviewed` is false and no screen shows "Human-reviewed" or "Blind model review passed" for any sample.
9. WHEN the learner sees the start view, THE start view SHALL show a Sample_Picker with the three sample names, SHALL keep "Enter the crypt" as the way to start, and SHALL start a run of the chosen sample.
10. THE Sample_Picker SHALL be a labelled radio group, operable by keyboard, with a default of the human-heart sample and each target at least 44 by 44 px.
11. THE Lock_Types_Feature SHALL provide the Sample_Picker and the builder choice through the existing `buildCrypt` parameter of `useRoomBinding` and files under `apps/web/src/features/crypt/`, and SHALL NOT edit `apps/web/src/state/`.
12. IF a saved run belongs to a sample other than the human-heart sample, THEN THE Lock_Types_Feature SHALL leave resume of that run to the existing typed error `record-unreadable` and SHALL report this limit to the user, because `restoreRun` in `apps/web/src/state/` rebuilds only the human-heart sample.
13. THE Lock_Types_Feature SHALL update the human-heart builder and every existing test, fixture and end-to-end test that depends on the old shape of the human-heart sample (one room, two Lock_Slots, three final-door questions).
14. FOR ALL three Sample_Crypt_Entries, every `evidenceRefs` ID of every question SHALL appear as the `chunkId` of one of that question's excerpts, and every quote SHALL resolve against its chunk.
15. FOR ALL three Sample_Crypt_Entries, a play-through that skips or challenges every question SHALL reach the status "escaped" (escape is always possible).
16. THE start view SHALL keep the existing sample-crypt line and label and SHALL NOT claim that the questions were generated from the learner's notes.
17. THE builders SHALL take concept titles from a fixed table in code, as the human-heart builder does, and SHALL leave the Sample_Questions_Files without concept titles.

### Requirement 13: Tests

**User Story:** As a builder, I want tests that prove each lock works with every input method and that the three samples can be finished, so that I can trust the release.

#### Acceptance Criteria

1. THE Test_Suite SHALL include one fast-check property test per New_Lock_Type that checks that the answer the correct interaction builds is judged `correct` by the core Judge and that wrong interactions are judged `wrong` (Requirements 4.13, 5.14, 6.15, 7.9).
2. THE Test_Suite SHALL include a keyboard-only component test per Lock_Panel that completes a correct answer and a wrong answer with Tab, Enter, Space and arrow keys and no pointer event.
3. THE Test_Suite SHALL include one Playwright test per New_Lock_Type that opens the lock, answers it correctly by the keyboard and checks the Evidence_Panel, and SHALL run each on the `chromium`, `firefox` and `pixel` projects.
4. THE Test_Suite SHALL include a Playwright test on the Phone_Project per New_Lock_Type that answers by tap and checks that every control is at least 44 by 44 px.
5. THE Test_Suite SHALL include an axe check per New_Lock_Type with its Lock_Panel open, and the check SHALL report no violations.
6. THE Test_Suite SHALL include one Playwright test per Sample_Crypt_Entry that plays the crypt to the escape with every question answered correctly, reading the correct answers from the manifest and not from the screen, and SHALL include one that plays each sample to the escape by skipping every question.
7. THE Test_Suite SHALL include Interaction_Model unit tests for the invariants in Requirement 3, including the Display_Order tests of criteria 3 to 5.
8. THE Test_Suite SHALL include a unit test that the manifest of each sample is accepted by the Manifest_Schema and that a manifest with a corrupted payload of each of the three new types is rejected (Requirement 2).
9. THE Test_Suite SHALL include a test that shows each Lock_Panel renders none of `keyOrder`, `keyPairs`, `oddOneOutId` or a dial value in its DOM before the answer is judged.
10. THE Test_Suite SHALL call no AI provider and SHALL use no recorded cassette.
11. THE Test_Suite SHALL include the round-trip properties of Requirements 2.10 and 6.16 and the invariant property of Requirement 5.15.
12. THE Test_Suite SHALL include a test that the Sample_Picker is a keyboard-operable radio group and starts the chosen sample.

### Requirement 14: Verification discipline and CPU limits

**User Story:** As the project owner, I want the test runs to stay small during development, so that the machine stays usable while the work goes on.

#### Acceptance Criteria

1. WHILE a task is in progress, THE implementer SHALL run only the targeted test files for that task, with a Vitest filter or a single Playwright file and a single project.
2. WHEN a Checkpoint is reached, THE implementer SHALL run the full Vitest suite with `--maxWorkers=50%` and the full Playwright suite with `--workers=2`.
3. THE implementer SHALL NOT run the full unit suite or the full end-to-end suite outside a Checkpoint.
4. THE implementer SHALL start no development server or watcher through a shell command, and SHALL use the Playwright configuration's own web server for end-to-end runs.
5. WHEN a Checkpoint passes, THE implementer SHALL record the real counts, including failures and skips, in `docs/build-log.md`.
6. THE Lock_Types_Feature SHALL keep `pnpm lint`, `pnpm typecheck` and the existing structure check passing at every Checkpoint.

### Requirement 15: Honesty, tone and safety of the new copy

**User Story:** As a learner, I want the new panels to speak plainly and kindly and to claim only what is true, so that I can trust them.

#### Acceptance Criteria

1. THE Lock_Types_Feature SHALL define every new learner-facing string in `packages/core/src/copy-lock-panels.ts` in the tone of `.kiro/steering/tone.md`, so that the banned-words test covers it.
2. THE Lock_Panels SHALL show the questions as the prompt states them, which already carry the framing "According to your notes" for the samples.
3. THE Lock_Panels SHALL send nothing to any server and SHALL make no request to another origin.
4. THE Sample_Crypt_Entries SHALL show the existing sample label and SHALL NOT show the labels "Human-reviewed" or "Blind model review passed".
5. IF a sample question's quote does not resolve against its chunk, THEN THE builder SHALL return a typed error that names the question ID and SHALL NOT publish the crypt.
6. THE Lock_Types_Feature SHALL keep each source file at or below approximately 300 lines, name files in kebab-case and keep lock-type interaction logic in `packages/core/src/locks/` with no judging code in `apps/web`.

## Out of Scope

- Live generation, checks, prompts, the authoring schema and the mapper for the four types (the Other_Machine).
- Multi-room play, the rune letter count and the files listed in the Introduction, except for the small edits that Requirement 1 criterion 9 allows.
- Drag and drop, even as an optional extra.
- A hint for the combination dial (the manifest allows `null` only).
- New art, new scene files and new motion clips.
- Persisting or resuming a run on the https or printing-press sample (Requirement 12 criterion 12).
- A change to the Judges.
- Showing the correct order, pairs or number after a wrong answer beyond the explanation and cited excerpts that the Evidence_Panel already shows.
- Sound, accounts and any server-side storage.
