# Requirements Document

## Introduction

Room play is Gate 1 of Escape the Crypt: a learner confirms notes in the ingest flow, enters a crypt, answers questions at lock objects, reads the evidence for each answer, escapes through the final door and reads a plain Autopsy.

Generation from the learner's own notes is not built yet. This spec therefore plays the **sample crypt** built by `buildHumanHeartSampleCrypt` in `packages/core/src/sample-crypt/human-heart.ts`. That crypt has one room (`hh-room-1`) with two Lock_Slots (`hh-slot-1` rune cipher, `hh-slot-2` séance board), each with an Alternate, and three Reserved_Final_Door_Questions (`hh-final-1` to `hh-final-3`). The sample questions file records `status` "draft", so `isHumanReviewed` is false and no screen may show "Human-reviewed".

The game rules stay in the room-runtime (`initial`, `apply`, selectors in `packages/core/src/runtime/`). This spec adds the React binding in `apps/web/src/state/`, the room screen built from the layered art described in `docs/art/asset-contract.md` (v1.3) and Prompt 2 of `docs/briefs/art-kiro-prompts.md`, the question panels for rune cipher and séance board, the evidence panel, ghosts and the final door, the escape, and the Autopsy.

The room runtime's manifest payloads hold answer keys and option IDs but not prompt text, option text, quotes or explanations. The runtime stays text-free. Requirement 6 therefore adds a generic Crypt_Content type with a Zod schema in `packages/core`. The spec 3 Manifest_Mapper produces one `content.questions[questionId]` entry alongside each QuestionSpec, and `buildHumanHeartSampleCrypt` returns `{ manifest, content }`. Any later crypt, generated or not, can use the same type.

Spec 4 will persist the Crypt_Content together with the manifest. That persistence is out of scope here.

Because the sample has one room with two locks and `GHOST_DELAY` is 3, a missed concept returns only at the final door. The binding and screens must still handle Return_Slots inside a room, because later specs will produce larger crypts.

## Glossary

- **Room_Play**: The feature specified here: the "Enter the crypt" step, the Room_Binding, the Room_Screen, the panels, the final door, the escape and the Autopsy.
- **Sample_Crypt**: The CryptManifest in the `manifest` field of the result of `buildHumanHeartSampleCrypt(notesText, questionsJson)`, with manifest ID `human-heart-sample`. The `content` field of the same result is the Sample_Content.
- **Manifest_Mapper**: The spec 3 function that maps checked questions to manifest QuestionSpecs and, for each QuestionSpec, produces its `content.questions[questionId]` entry.
- **Runtime**: The pure reducer `initial(manifest, settings)` and `apply(state, event)` in `packages/core/src/runtime/`, plus its selectors.
- **State**: The runtime `State` type from `packages/core/src/runtime/state-types.ts`.
- **Event_Log**: The ordered list of runtime Events for the current run.
- **Outcome_Notice**: A runtime notice of kind `candleLit`, `ghostSpawned`, `ghostLaidToRest`, `sealCracked`, `roomCleared` or `escaped`.
- **Room_Binding**: The React binding in `apps/web/src/state/` that holds the Event_Log in memory, folds it with the Runtime, dispatches Events and exposes State and notices. It contains no game rules.
- **Room_Screen**: The screen that draws the current room, or the final door, from the layered art and State.
- **Scene_File**: The file `apps/web/public/art/rooms/<art-room>/scene.json` described in section 4 of `docs/art/asset-contract.md`.
- **Art_Room**: One of `burial-chamber`, `library-of-bones` or `sunken-chapel`. Room 1 of a run uses `burial-chamber`, room 2 uses `library-of-bones`, room 3 uses `sunken-chapel`. The Art_Room never comes from the manifest `roomId`.
- **Lock_Layer**: One of the four images of a lock: `lock-<lock>.webp`, `lock-<lock>-hover.webp`, `lock-<lock>-solved.webp`, `lock-<lock>-solved-hover.webp`.
- **Light_Pass**: The image `light-<lock>.webp` of a lock, or `light-door.webp`, composited additively.
- **Hotspot_Button**: A native `button` positioned over a lock's `hotspot` polygon in a Scene_File.
- **Flame**: A candle flame drawn by code at a lock's `candle` point, an `ambientCandles` point or a Spirit_Candle.
- **Ghost_Anchor**: An entry of `ghostAnchors` in a Scene_File.
- **Question_Panel**: The panel that shows one question and its controls for the slot being played.
- **Evidence_Panel**: The panel shown after a judged answer, with the cited excerpt, its Citation_Label, the explanation and the label "Source excerpt matched".
- **Citation_Label**: The text returned by `citationLabel(chunk, source)` in `packages/core/src/citation-labeller.ts`.
- **Citation_Source**: The optional second argument of `citationLabel`. The value `notes` is the default and gives the learner-notes wording. The value `sample` gives the sample wording "Paragraph N of the sample notes".
- **Crypt_Content**: The value `{ questions, concepts }` defined with a Zod schema in `packages/core`. The field `questions` is `Record<QuestionId, { prompt, options?: Record<OptionId, text>, excerpts: { chunkId, quote, optionId? }[], explanation }>`. The field `concepts` is `Record<conceptId, { title: string }>`, where each title is plain text. Crypt_Content holds all text a screen shows for a question or a concept and no answer key.
- **RoomAssets**: The value `{ content, chunks, firstQuestionByConcept }` that the Room_Binding builds once per run. The field `content` is the Crypt_Content, `chunks` is the chunk map and `firstQuestionByConcept` is `Record<conceptId, questionId>`, which names the primary question of each concept in the manifest.
- **Option_Excerpt**: An entry of `excerpts` that carries an `optionId`. It is the evidence of that one séance board option. An entry without `optionId` is a question-level excerpt.
- **Sample_Content**: The Crypt_Content of the Sample_Crypt.
- **Lantern_Setting**: The remembered on or off value of Lantern_Mode, stored in the browser's `localStorage` under one key.
- **Draft_Answer**: Typed letters or a highlighted option that the learner has not submitted. It exists only in interface state.
- **Return_Slot**: A runtime slot for a returning concept, as defined in the room-runtime spec. It is not a lock station.
- **Final_Door_Slot**: A slot of `State.finalDoor.slots`, drawn as a seal on the final door.
- **Autopsy_View**: The result of `selectAutopsy(state)`.
- **Final_Door_Section**: The part of the Autopsy that lists each question of `State.finalDoor.slots` with its final status.
- **Lantern_Mode**: The accessibility setting that removes the atmosphere overlay and shows everything fully lit, defined in `.kiro/steering/accessibility.md`.
- **Phone_Viewport**: A viewport whose width divided by height is below 0.75.
- **Crop_Mapping**: The pure function that maps a Scene_File coordinate (hotspot, candle or anchor) to a viewport coordinate when the desktop art is shown with `object-fit: cover` centred on the union of the lock hotspots.
- **Banned_Phrases**: The strings in `BANNED_COPY_PHRASES` in `packages/core/src/copy.ts`.

## Requirements

### Requirement 1: Enter the crypt after the notes preview

**User Story:** As a learner, I want a clear step after I confirm my notes that takes me into a crypt, so that I can play without wondering what happens to my notes.

#### Acceptance Criteria

1. WHEN the learner has confirmed notes in the ingest flow, THE Room_Play SHALL show an "Enter the crypt" button.
2. WHEN the learner activates the "Enter the crypt" button, THE Room_Play SHALL start a run of the Sample_Crypt and show the Room_Screen for room 1.
3. WHILE the "Enter the crypt" button is shown, THE Room_Play SHALL show a line that says generating questions from the learner's own notes comes later and that this crypt is a sample crypt.
4. THE Room_Play SHALL take the text of the line in criterion 3 from `packages/core/src/copy.ts`.
5. THE Room_Play SHALL keep the learner's confirmed notes unchanged and unused by the run, because the Sample_Crypt is built from `samples/human-heart.txt`.
6. WHILE the run is on screen, THE Room_Play SHALL show a visible text label that the crypt is a sample crypt.

### Requirement 2: Build the sample crypt

**User Story:** As a developer, I want the sample crypt built once from its source files with typed failures, so that a broken sample never starts a half-working run.

#### Acceptance Criteria

1. WHEN a run starts, THE Room_Binding SHALL call `buildHumanHeartSampleCrypt` with the text of `samples/human-heart.txt` and the parsed contents of `samples/questions/human-heart.json`, and SHALL read the Sample_Crypt from the `manifest` field and the Sample_Content from the `content` field of the result.
2. WHEN `buildHumanHeartSampleCrypt` returns an error, THE Room_Play SHALL show a message that states what happened and what the learner can do next, and SHALL start no run.
3. THE Room_Play SHALL include the sample files in the web build so that no request to another origin is needed to start a run.
4. THE Room_Binding SHALL leave the Sample_Crypt and the Sample_Content unchanged for the whole run.
5. WHEN a run starts, THE Room_Binding SHALL build RoomAssets from the Sample_Crypt and the Sample_Content, where `firstQuestionByConcept` maps every conceptId of the manifest to the Question_Id of that concept's primary question in the manifest.
6. THE Room_Binding SHALL hold the RoomAssets unchanged for the whole run, including `firstQuestionByConcept`.

### Requirement 3: Honest labels for the sample

**User Story:** As a learner, I want labels that say only what is true, so that I can trust what the crypt tells me about its questions.

#### Acceptance Criteria

1. WHILE `isHumanReviewed` returns false for the sample questions file, THE Room_Play SHALL show the label "Human-reviewed" nowhere.
2. THE Room_Play SHALL show the label "Blind model review passed" nowhere, because the sample crypt has no blind model review result.
3. WHEN the Evidence_Panel shows an excerpt that the Quote Resolver resolved against its chunk, THE Evidence_Panel SHALL show the label "Source excerpt matched".
4. IF the Quote Resolver cannot resolve a cited quote against its chunk, THEN THE Evidence_Panel SHALL show the chunk text and the Citation_Label without the label "Source excerpt matched".
5. WHEN a challenged slot is shown, THE Room_Screen SHALL show the label "Challenged: excluded from score".
6. THE Room_Play SHALL contain none of the Banned_Phrases in any learner-facing text, and SHALL make no claim of mastery, exam readiness or learning gain.
7. THE Room_Play SHALL define every learner-facing string it adds in `packages/core/src/copy.ts` in the tone of `.kiro/steering/tone.md`, so that the banned-words test covers it.
8. THE `citationLabel` function SHALL accept an optional Citation_Source argument with the values `notes` and `sample`, and SHALL use `notes` when the argument is absent.
9. WHEN `citationLabel` receives a paste chunk and the Citation_Source `sample`, THE `citationLabel` function SHALL return "Paragraph N of the sample notes", where N is the chunk's paragraph number.
10. WHEN `citationLabel` receives a chunk and the Citation_Source `notes` or no Citation_Source, THE `citationLabel` function SHALL return the same text as before this spec.
11. THE Room_Play SHALL define the sample wording of criterion 9 in `packages/core/src/copy.ts`.
12. WHILE the run is on screen, THE Room_Play SHALL show no Citation_Label that ends in "of your notes".

### Requirement 4: React binding over the runtime

**User Story:** As a developer, I want one thin binding between React and the runtime, so that the interface never changes game state directly.

#### Acceptance Criteria

1. THE Room_Binding SHALL reside in `apps/web/src/state/` and SHALL contain no game rules.
2. THE Room_Binding SHALL hold the Event_Log in memory only.
3. THE Room_Binding SHALL derive State by folding the Event_Log with `initial` and `apply`, starting from the Sample_Crypt and the run settings of Requirement 5.
4. WHEN the interface dispatches an action, THE Room_Binding SHALL turn it into one runtime Event and call `apply` with the current State.
5. WHEN `apply` succeeds, THE Room_Binding SHALL append the Event to the Event_Log, replace State with the new State and expose the returned Outcome_Notices once, in the order returned.
6. IF `apply` returns a Typed_Rejection, THEN THE Room_Binding SHALL leave the Event_Log and State unchanged and expose the rejection kind to the interface.
7. THE Room_Binding SHALL expose State, the latest Outcome_Notices, the latest rejection and a read-only `eventLog` holding the in-memory Event_Log to the interface.
8. THE Room_Binding SHALL keep Draft_Answer values out of the Event_Log and out of State.
9. THE Room_Play SHALL change the game state only by dispatching Events through the Room_Binding.
10. WHERE the page is reloaded, THE Room_Play SHALL start from the notes preview with no run, because saving runs belongs to spec 4.
11. THE Runtime index in `packages/core/src/runtime/` SHALL export the type `FinalDoorSlotState`, so that the Room_Binding and the screens import it from the Runtime index.

### Requirement 5: Run start sequence

**User Story:** As a learner, I want the first room ready the moment I enter, so that I can start answering without extra steps.

#### Acceptance Criteria

1. WHEN a run starts, THE Room_Binding SHALL create State with `initial(manifest, settings)` using the run settings `length` "short", `difficulty` "apprentice" and `hintAllowance` 2.
2. WHEN a run starts, THE Room_Binding SHALL apply these Events in this order: `RunStarted` with the Sample_Crypt manifest ID, `RoomPublished` for `hh-room-1`, `CryptFinalised` with a final room count of 1, and `RoomEntered` for `hh-room-1`.
3. IF any Event of criterion 2 is rejected, THEN THE Room_Play SHALL show a message that states what happened and what the learner can do next, and SHALL leave the learner on the notes preview.
4. WHEN the run starts, THE Room_Screen SHALL show the remaining hint count from State.

### Requirement 6: Crypt content for question text

**User Story:** As a learner, I want to read each question, its options and its evidence as real text, so that I never answer from an image or from guesswork.

#### Acceptance Criteria

1. THE Crypt_Content type and its Zod schema SHALL reside in `packages/core`, import nothing from React, the database or an AI SDK, and define `content.questions[questionId]` for each Question_Id with a `prompt`, an optional `options` record from option ID to text, a list `excerpts` of `{ chunkId, quote, optionId? }` and an `explanation`, where the optional `optionId` marks an Option_Excerpt.
2. THE Crypt_Content schema SHALL define no field for an answer key in `questions` or `concepts`, so that a Question_Panel reads no key from the content.
3. THE Runtime and the manifest SHALL stay free of prompt text, option text, quotes and explanations.
4. WHEN the Manifest_Mapper produces a QuestionSpec, THE Manifest_Mapper SHALL produce the `content.questions[questionId]` entry of that question's Question_Id in the same call.
5. WHEN `buildHumanHeartSampleCrypt` succeeds, THE `buildHumanHeartSampleCrypt` function SHALL return `{ manifest, content }`, where `content` is a Crypt_Content that passes the Crypt_Content schema.
6. FOR ALL questions of the Sample_Crypt, THE Sample_Content SHALL hold a `content.questions[questionId]` entry for every Question_Id in the manifest, including every Alternate and every Reserved_Final_Door_Question.
7. FOR EACH séance board question, THE Sample_Content SHALL hold, in `content.questions[questionId].options`, an option text for every option ID of the manifest payload, and THE Question_Panel SHALL show the options in manifest order.
8. THE Sample_Content SHALL take chunk IDs from the same chunk maps that `buildHumanHeartSampleCrypt` uses, so that every `evidenceRefs` ID of a question appears as the `chunkId` of one of its excerpts.
9. THE Room_Play SHALL compute the Citation_Label of an excerpt from the chunk named by its `chunkId`, using the Citation_Source `sample`.
10. THE Manifest_Mapper and `buildHumanHeartSampleCrypt` SHALL return a typed result and throw no exception for any input.
11. FOR ALL Crypt_Content values that pass the Crypt_Content schema, parsing the JSON serialisation of the value with the schema SHALL produce an equal value (round-trip property).
12. IF a Crypt_Content value fails the Crypt_Content schema, THEN THE Manifest_Mapper SHALL return a typed error and no content.
13. THE Crypt_Content schema SHALL accept an excerpt without `optionId`, and SHALL accept an excerpt with an `optionId` only WHERE the same entry has an `options` record that holds that option ID.
14. FOR EACH séance board question, WHEN the Manifest_Mapper produces the `content.questions[questionId]` entry, THE Manifest_Mapper SHALL create one Option_Excerpt per option from that option's own evidence, carrying the `chunkId` and `quote` of that evidence and the `optionId` of that option.
15. FOR EACH séance board question, THE Manifest_Mapper SHALL keep the question-level evidence as excerpts without `optionId`.
16. IF a séance board option has no evidence of its own, THEN THE Manifest_Mapper SHALL return a typed error and no content.
17. FOR ALL séance board questions of the Sample_Crypt, THE Sample_Content SHALL hold exactly one Option_Excerpt in `content.questions[questionId].excerpts` for every option ID of the manifest payload.
18. FOR ALL Crypt_Content values that pass the Crypt_Content schema and include Option_Excerpts, parsing the JSON serialisation of the value SHALL preserve every `optionId` (round-trip property).
19. THE Crypt_Content schema SHALL define `concepts` as a record from conceptId to `{ title: string }`, with the title as plain text.
20. THE Crypt_Content schema SHALL import `z` from `packages/core/src/zod.ts` and SHALL NOT import from `zod` directly, as the project lint rule requires.
21. WHEN the Manifest_Mapper produces Crypt_Content for a generated crypt, THE Manifest_Mapper SHALL fill `concepts` with one entry per conceptId of the manifest, taking each title from the label of that concept.
22. THE `buildHumanHeartSampleCrypt` function SHALL hold a fixed concept title table next to its fixed selection and SHALL fill `content.concepts` from that table, leaving `samples/questions/human-heart.json` unedited.
23. FOR ALL Crypt_Content values that pass the Crypt_Content schema, THE Crypt_Content SHALL hold a title for every conceptId of its manifest, and parsing the JSON serialisation of the value SHALL preserve every concept title (round-trip property).
24. IF a conceptId of the manifest has no title in `concepts`, THEN THE Manifest_Mapper SHALL return a typed error and no content.

### Requirement 7: Room art chosen by room order

**User Story:** As a learner, I want each room to look like its own place, so that moving through the crypt feels like going somewhere.

#### Acceptance Criteria

1. WHEN the Room_Screen shows the room at position 1, 2 or 3 in `State.rooms`, THE Room_Screen SHALL use the Art_Room `burial-chamber`, `library-of-bones` or `sunken-chapel` respectively.
2. THE Room_Screen SHALL choose the Art_Room only from the position of the room in `State.rooms` and SHALL ignore the manifest `roomId`.
3. WHEN the Room_Screen loads an Art_Room, THE Room_Screen SHALL read the layout from that Art_Room's Scene_File.
4. THE Room_Screen SHALL stack these full-frame layers at position 0,0 in this order: background, one Lock_Layer per drawn lock, Light_Passes, the door layer, foreground.
5. WHEN the screen is a high-DPI screen, THE Room_Screen SHALL use `background@2x.webp` in place of `background.webp`.
6. THE Room_Screen SHALL draw a lock only if the current room holds a Lock_Slot whose Station_Type equals that lock's type, so that the sample crypt draws the rune cipher and séance board locks only.
7. THE Room_Screen SHALL give every drawn art layer empty alternative text, because nothing needed to answer a question exists only in an image.

### Requirement 8: Lock layers and their states

**User Story:** As a learner, I want each lock to look different when it is available, hovered, focused and solved, so that I can see what I can try and what is done.

#### Acceptance Criteria

1. WHILE a Lock_Slot has status `open`, THE Room_Screen SHALL draw `lock-<lock>.webp` for that lock.
2. WHILE a Lock_Slot has status `solved` or `settled` or `challenged`, THE Room_Screen SHALL draw `lock-<lock>-solved.webp` for that lock.
3. WHEN the pointer is over a lock's Hotspot_Button or the button has keyboard focus, THE Room_Screen SHALL crossfade to the matching `-hover` image of the lock's current state over 200 ms, and crossfade back on leave or blur.
4. THE Room_Screen SHALL make no interaction depend on hover.
5. WHEN a lock becomes solved, THE Room_Screen SHALL crossfade the lock layer to its `-solved` image over about 600 ms, in step with its Light_Pass.
6. WHILE a Lock_Slot has status `settled` or `challenged`, THE Room_Screen SHALL draw no Flame and no Light_Pass for that lock, and SHALL keep its Hotspot_Button name stating the status.

### Requirement 9: Candles, light passes and flames

**User Story:** As a learner, I want a correct answer to bring warm light into the room, so that I can see my progress.

#### Acceptance Criteria

1. WHILE a Lock_Slot has `candleLit` false, THE Room_Screen SHALL draw no Flame at that lock's `candle` point and no Light_Pass for that lock.
2. WHEN the Room_Binding exposes a `candleLit` Outcome_Notice that names a slot, THE Room_Screen SHALL draw a gold Flame at that lock's `candle` point as a short flare followed by a gentle flicker.
3. WHEN the Room_Binding exposes a `candleLit` Outcome_Notice that names a slot, THE Room_Screen SHALL fade that lock's Light_Pass from opacity 0 to 1 over about 600 ms.
4. THE Room_Screen SHALL composite every Light_Pass with `mix-blend-mode: plus-lighter` and fall back to `screen` where `plus-lighter` is not supported.
5. WHEN several locks are solved, THE Room_Screen SHALL show their Light_Passes added together.
6. THE Room_Screen SHALL draw a small gold Flame on every `ambientCandles` point from the first frame of the room.
7. THE Room_Screen SHALL draw no teal Flame.
8. WHEN a Room_Screen is drawn for a State in which a Lock_Slot already has `candleLit` true, THE Room_Screen SHALL show that lock's Flame and Light_Pass at once with no animation, so that the drawing depends only on State.

### Requirement 10: Hotspot buttons

**User Story:** As a learner who uses a keyboard, a screen reader or a touch screen, I want a real control on every lock, so that I can open any lock in any way.

#### Acceptance Criteria

1. THE Room_Screen SHALL place one Hotspot_Button over the `hotspot` polygon of every drawn lock.
2. THE Room_Screen SHALL make every Hotspot_Button at least 44 by 44 px.
3. THE Room_Screen SHALL give every Hotspot_Button an accessible name that states the lock's name and status, for example "Rune tablet: rune cipher, unsolved".
4. WHERE hotspots overlap, THE Room_Screen SHALL put the Hotspot_Button of the lock with the smaller `depth` on top.
5. THE Room_Screen SHALL order the Hotspot_Buttons in the tab order by their position on screen, left to right.
6. WHEN the learner activates a Hotspot_Button of an open Lock_Slot, THE Room_Binding SHALL dispatch `LockOpened` for that slot and THE Room_Screen SHALL open the Question_Panel for it.
7. WHEN the Question_Panel opens, THE Room_Screen SHALL move keyboard focus into the Question_Panel.
8. WHEN the Question_Panel closes, THE Room_Screen SHALL return keyboard focus to the control that opened it.
9. THE Room_Screen SHALL show a visible focus outline of 2px in `--spectre-300` with an offset on every focused control.
10. WHEN the learner activates a Hotspot_Button of a solved, settled or challenged Lock_Slot, THE Room_Screen SHALL show a short text that states the slot's status, and SHALL dispatch no Event.

### Requirement 11: Phone framing

**User Story:** As a learner on a phone, I want to see and tap every lock, so that I can play on the device I have.

#### Acceptance Criteria

1. WHILE the viewport is a Phone_Viewport and the Scene_File has a `mobile` block, THE Room_Screen SHALL use the `mobile/` image set and the `mobile` block.
2. WHILE the viewport is a Phone_Viewport and the Scene_File has no `mobile` block, THE Room_Screen SHALL show the desktop layers with `object-fit: cover`, centred on the union of the hotspots of the locks drawn in the room.
3. WHILE the desktop art is cropped, THE Room_Screen SHALL map every hotspot, candle, ambient candle, Ghost_Anchor and door coordinate through the Crop_Mapping.
4. THE Crop_Mapping SHALL be a pure function in `apps/web/src/features/crypt/` with a unit test.
5. FOR ALL viewport sizes and all points inside the union of the drawn hotspots, THE Crop_Mapping SHALL return a point inside the viewport.
6. WHILE the desktop art is cropped, THE Room_Screen SHALL keep every drawn Hotspot_Button at least 44 by 44 px and fully reachable.

### Requirement 12: Motion, reduced motion and lantern mode

**User Story:** As a learner who is sensitive to motion, I want a calm room, so that I can play comfortably.

#### Acceptance Criteria

1. THE Room_Screen SHALL move the background, lock and foreground layers by a few pixels only, following the `parallax` factors, in response to the pointer or device tilt.
2. WHILE the browser reports `prefers-reduced-motion: reduce`, THE Room_Screen SHALL turn off parallax and Flame flicker and make every crossfade and fade instant.
3. WHILE the browser reports `prefers-reduced-motion: reduce` and no Lantern_Setting has been stored, THE Room_Screen SHALL start in Lantern_Mode.
4. WHILE Lantern_Mode is on, THE Room_Screen SHALL show no darkness, vignette, grain or mist overlay and SHALL show every layer fully lit.
5. THE Room_Screen SHALL offer a control that turns Lantern_Mode on and off.
6. THE Room_Screen SHALL give every atmosphere layer `pointer-events: none` and keep every atmosphere layer from covering a Question_Panel or an Evidence_Panel.
7. THE Room_Screen SHALL cause no flashing, no jump scare and no screen shake.
8. WHEN the learner turns Lantern_Mode on or off, THE Room_Play SHALL write the new value as the Lantern_Setting to `localStorage` under one key, inside a try/catch block.
9. WHEN the Room_Screen starts, THE Room_Play SHALL read the Lantern_Setting from `localStorage` inside a try/catch block and use the stored value as the initial Lantern_Mode.
10. IF reading the Lantern_Setting throws, finds no value or finds a value other than the two written by criterion 8, THEN THE Room_Play SHALL start with Lantern_Mode off, except where criterion 3 applies.
11. IF writing the Lantern_Setting throws, THEN THE Room_Play SHALL keep the chosen Lantern_Mode for the current session and show no error to the learner.
12. THE Room_Play SHALL store nothing but the Lantern_Setting in `localStorage`, and SHALL leave run data to spec 4.

### Requirement 13: Lock close-up and panel placement

**User Story:** As a learner, I want the question beside the lock I opened, so that I can see which lock I am answering.

#### Acceptance Criteria

1. WHEN the Question_Panel is open for a lock, THE Room_Screen SHALL open it on the `panelSide` of that lock's entry in the Scene_File.
2. WHEN the Question_Panel is open for a lock, THE Room_Screen SHALL show `locks/<lock>/closed.webp` behind the panel for an open slot and `locks/<lock>/open.webp` for a solved slot.
3. THE Room_Screen SHALL keep the Question_Panel fully lit and readable with a text contrast of at least 4.5:1 over the art.
4. WHILE a Question_Panel is open and the viewport is a Phone_Viewport, THE Room_Screen SHALL show the panel full width.
5. WHEN the learner presses the Escape key while the Question_Panel is open and no judged answer is waiting for Continue, THE Room_Screen SHALL close the panel with no Event and keep the Draft_Answer for that slot.

### Requirement 14: Rune cipher panel

**User Story:** As a learner, I want to type my answer into a rune cipher and have it judged fairly, so that spacing and capitals do not cost me a candle.

#### Acceptance Criteria

1. WHEN the Question_Panel is open for a slot whose Current_Question_Type is `rune-cipher`, THE Question_Panel SHALL show `content.questions[questionId].prompt` as plain text and a labelled text input.
2. WHEN the learner submits with the Enter key or the "Submit answer" button, THE Room_Binding SHALL dispatch `AnswerSubmitted` with the submission `{ text }` holding the typed string.
3. IF the typed string is empty after trimming, THEN THE Question_Panel SHALL show a short message that asks for an answer and SHALL dispatch no Event.
4. IF the Room_Binding exposes the rejection kind `invalid-submission`, THEN THE Question_Panel SHALL show a short message that asks for an answer, keep the Draft_Answer and keep the slot open.
5. WHILE the slot's Applied_Hint is `reveal-first-letter`, THE Question_Panel SHALL show the first letter and the length of the answer from the hint.
6. THE Question_Panel SHALL keep the typed string as a Draft_Answer in interface state until `AnswerSubmitted` is accepted or the slot's current question changes.
7. THE Question_Panel SHALL be fully operable with the keyboard and need no drag.

### Requirement 15: Séance board panel

**User Story:** As a learner, I want to choose one option on the séance board, so that my choice is judged against my notes.

#### Acceptance Criteria

1. WHEN the Question_Panel is open for a slot whose Current_Question_Type is `seance-board`, THE Question_Panel SHALL show the prompt as plain text and the option texts in manifest order as a group of radio inputs with a visible group label.
2. WHEN the learner submits with the "Submit answer" button, THE Room_Binding SHALL dispatch `AnswerSubmitted` with the submission `{ selectedOptionId }`.
3. IF no option is chosen, THEN THE Question_Panel SHALL show a short message that asks the learner to choose an option and SHALL dispatch no Event.
4. WHILE the slot's Applied_Hint is `remove-option`, THE Question_Panel SHALL show the removed option as removed with a text label and SHALL disable it.
5. THE Question_Panel SHALL keep the chosen option as a Draft_Answer in interface state until `AnswerSubmitted` is accepted or the slot's current question changes.
6. THE Question_Panel SHALL be fully operable with the keyboard, with arrow keys moving between options, and need no drag.
7. THE Question_Panel SHALL frame the question as "According to your notes" by showing the prompt text unchanged.

### Requirement 16: Hint, Skip and Challenge

**User Story:** As a learner, I want to ask for a hint, skip, or challenge a question I think is unfair, so that I stay in control and trust the game.

#### Acceptance Criteria

1. THE Question_Panel SHALL show a "Hint" button, a "Skip" button and a "Challenge" button for an open slot whose judged answer is not waiting for Continue.
2. WHEN the learner activates the "Hint" button, THE Room_Binding SHALL dispatch `HintUsed` for the slot.
3. WHILE the remaining hint count in State is 0, THE Question_Panel SHALL disable the "Hint" button and show the text "No hints left".
4. WHILE the slot's current question already has an Applied_Hint, THE Question_Panel SHALL disable the "Hint" button.
5. THE Question_Panel SHALL show the remaining hint count from State next to the "Hint" button.
6. WHEN the learner activates the "Skip" button, THE Room_Binding SHALL dispatch `Skipped` for the slot and THE Room_Screen SHALL close the Question_Panel.
7. WHEN the learner activates the "Challenge" button, THE Room_Binding SHALL dispatch `Challenged` for the slot.
8. WHEN the Room_Binding exposes a `sealCracked` Outcome_Notice for a slot whose State status is `open`, THE Question_Panel SHALL show the Alternate question of the slot, clear the Draft_Answer and move focus to the panel heading.
9. WHEN the Room_Binding exposes a `sealCracked` Outcome_Notice for a slot whose State status is `challenged`, THE Room_Screen SHALL close the Question_Panel and show the label "Challenged: excluded from score" on that lock.
10. THE Question_Panel SHALL state that a skipped or challenged question costs no penalty and is excluded from the score.
11. THE Room_Screen SHALL send nothing to any server when a question is challenged.

### Requirement 17: Evidence panel

**User Story:** As a learner, I want to see exactly where my notes support the answer after every attempt, so that I can trust the question and learn from it.

#### Acceptance Criteria

1. WHEN `State` holds `evidencePanelOpen` true for a slot, THE Room_Screen SHALL show the Evidence_Panel for that slot. THE Room_Screen SHALL show it after every judged answer, including the answer that escapes the run, which leaves `evidencePanelOpen` true in the escaped `State`.
2. THE Evidence_Panel SHALL show the result of the judged answer as text and an icon, so that colour is not the only signal. For a Lock_Slot the result comes from `judgedResult`. For a Return_Slot or a Final_Door_Slot, which have no `judgedResult`, the result text comes from the slot `status`: `solved` shows the correct result text, `settled` shows the wrong result text, and `challenged` shows no result text.
3. THE Evidence_Panel SHALL show every cited excerpt of the question from `content.questions[questionId].excerpts` exactly once, as plain text, each with the Citation_Label of its chunk in the form "Paragraph N of the sample notes".
4. WHERE the question is a séance board question, THE Evidence_Panel SHALL show the text of the option the learner chose and the text of the key option, both taken from `content.questions[questionId].options`, and SHALL show the excerpts in this order: the Option_Excerpt of the chosen option, then the Option_Excerpt of the key option, then every remaining excerpt in `content.questions[questionId].excerpts` order.
5. THE Evidence_Panel SHALL show `content.questions[questionId].explanation`.
6. WHEN the excerpt is resolved against its chunk, THE Evidence_Panel SHALL show the label "Source excerpt matched" under criterion 3 of Requirement 3.
7. WHEN the judged answer is wrong (for a Return_Slot or a Final_Door_Slot, WHEN the slot `status` is `settled`), THE Evidence_Panel SHALL open with a kind sentence that begins the explanation, for example "Not this time. Here's what your notes say."
8. THE Evidence_Panel SHALL show a "Continue" button.
9. WHEN the learner activates the "Continue" button, THE Room_Binding SHALL dispatch `EvidenceContinued` for the slot and THE Room_Screen SHALL close the Evidence_Panel. WHERE the run has status "escaped", the "Continue" button SHALL only close the Evidence_Panel locally and SHALL dispatch no Event, because the runtime rejects every Event after the escape.
10. WHEN the Evidence_Panel closes, THE Room_Screen SHALL return keyboard focus to the Hotspot_Button of the slot, or to the next control that the State makes available when the slot's lock is no longer shown. WHEN the Evidence_Panel of the escaping answer closes, THE Room_Screen SHALL move keyboard focus to the "Open the Autopsy" button of the escape view.
11. THE Evidence_Panel SHALL offer no way to submit a second answer to the same question.
12. WHEN the Evidence_Panel is open, THE Room_Screen SHALL move keyboard focus into it.
13. WHERE the chosen option is the key option of a séance board question, THE Evidence_Panel SHALL show its Option_Excerpt once, first, followed by the remaining excerpts in `content.questions[questionId].excerpts` order.
14. WHERE the question is not a séance board question, THE Evidence_Panel SHALL show the excerpts in `content.questions[questionId].excerpts` order.
15. THE Evidence_Panel SHALL determine the chosen option from the accepted `AnswerSubmitted` Event in the Room_Binding's `eventLog` and the key option from the manifest payload, and SHALL read neither from `content.questions`.
16. FOR ALL séance board questions of the Sample_Crypt and FOR ALL chosen options, THE Evidence_Panel SHALL show each excerpt exactly once, with the chosen option's Option_Excerpt first and the key option's Option_Excerpt next (property test).

### Requirement 18: Ghosts and return slots

**User Story:** As a learner, I want a missed idea to come back as a ghost I can see, so that I know it will return and can lay it to rest.

#### Acceptance Criteria

1. WHILE `selectGhosts(state)` returns a pending ghost, THE Room_Screen SHALL draw one ghost for that ghost at a Ghost_Anchor of the current Art_Room's Scene_File.
2. THE Room_Screen SHALL assign Ghost_Anchors to ghosts in the order of `selectGhosts(state)`, using the anchor at position `index modulo the number of anchors`.
3. THE Room_Screen SHALL give every ghost a text label that names its return number, so that the ghost is not shown by colour or shape alone.
4. WHEN the Room_Binding exposes a `ghostSpawned` Outcome_Notice, THE Room_Screen SHALL show the ghost rising, and THE Room_Play SHALL announce it under Requirement 21.
5. WHEN the Room_Binding exposes a `ghostLaidToRest` Outcome_Notice, THE Room_Screen SHALL remove that ghost with a fade.
6. WHEN State holds a lit Spirit_Candle for the current room or the final door, THE Room_Screen SHALL draw a small gold Flame at a Ghost_Anchor for it, with no Light_Pass.
7. WHEN State holds a due Return_Slot in the current room, THE Room_Screen SHALL show a control for it that opens its Question_Panel, with an accessible name that states it is a returning question and, when `label` is "review", the text "Review".
8. THE Room_Screen SHALL draw Return_Slots as separate controls and not as lock stations, and SHALL leave the Lock_Layers unchanged.
9. WHEN a pending ghost is not yet due, THE Room_Screen SHALL show its place in the sequence as text, for example "This ghost returns later."
10. WHEN the Room_Screen draws a ghost, THE Room_Screen SHALL keep the ghost from covering any Hotspot_Button, Question_Panel or Evidence_Panel and SHALL give the ghost `pointer-events: none`.
11. WHEN the Room_Binding exposes a `roomCleared` Outcome_Notice, THE Room_Screen SHALL crossfade `door-closed.webp` to `door-open.webp` and fade `light-door.webp` in additively over about 600 ms.

### Requirement 19: Final door and escape

**User Story:** As a learner, I want a final door that mixes in the ideas I missed, and I want to be able to get through it every time.

#### Acceptance Criteria

1. WHILE `selectFinalDoor(state).available` is false, THE Room_Screen SHALL show the door closed with no control to enter the final door.
2. WHEN `selectFinalDoor(state).available` becomes true, THE Room_Screen SHALL show a button over the door's `hotspot` with an accessible name that offers to open the final door.
3. WHEN the learner activates the final door button, THE Room_Binding SHALL dispatch `FinalDoorEntered`.
4. WHILE `State.atFinalDoor` is true, THE Room_Screen SHALL draw one seal on the door for every Final_Door_Slot, placed inside the door's `hotspot` polygon.
5. WHEN a Final_Door_Slot becomes solved, settled or challenged, THE Room_Screen SHALL show its seal broken, with a text label that states the status.
6. WHILE `State.atFinalDoor` is true, THE Room_Screen SHALL give every open Final_Door_Slot a control that opens its Question_Panel, and SHALL open that panel on the right side of the frame.
7. WHILE `State.atFinalDoor` is true, THE Question_Panel, the Evidence_Panel, the hint, skip and challenge controls and the ghost drawing SHALL work as they do in a room.
8. IF a slot's Current_Question_Type is a lock type for which Room_Play has no Question_Panel, THEN THE Room_Screen SHALL show a message that this question type is not playable in this version and SHALL offer the "Skip" button for that slot, so that the escape stays possible.
9. WHEN the Room_Binding exposes an `escaped` Outcome_Notice, THE Room_Screen SHALL show the open door with its Light_Pass and an escape message, and SHALL offer a button that opens the Autopsy.
10. WHEN State has status "escaped", THE Room_Screen SHALL accept no further answer, hint, skip or challenge. WHEN the escaping answer opened an Evidence_Panel, THE Room_Screen SHALL keep showing that Evidence_Panel with only its "Continue" button, and SHALL show the escape view of criterion 9 only after the learner dismisses it.
11. FOR ALL sequences of learner actions on open slots in the Sample_Crypt that include answering wrong, skipping or challenging every question, THE Room_Play SHALL reach the status "escaped" after at most the number of prompts that the runtime bound in the room-runtime spec allows.

### Requirement 20: Autopsy

**User Story:** As a learner, I want a plain summary of how I did on each idea, with a way back to my notes, so that I know what to look at again.

#### Acceptance Criteria

1. WHEN State has status "escaped", THE Room_Play SHALL show the Autopsy built from `selectAutopsy(state)`.
2. WHILE State does not have status "escaped", THE Room_Play SHALL show no Autopsy.
3. THE Autopsy SHALL list one entry for every concept in `State.concepts`, which is two entries for the Sample_Crypt, each with its concept title, taken from `content.concepts[conceptId].title` and rendered as plain text, where the web layer joins the title to the entry and the runtime AutopsyEntry stays text-free, and the outcome label from `AUTOPSY_LABELS` in `packages/core/src/copy.ts`.
4. THE Autopsy SHALL show the five outcome counts from the Autopsy_View.
5. THE Autopsy SHALL show each outcome as text and an icon, so that colour is not the only signal.
6. WHEN the learner activates the link of an Autopsy entry, THE Autopsy SHALL find the first question of that concept through `RoomAssets.firstQuestionByConcept` and show that question's first cited excerpt from `content.questions[questionId].excerpts` with its Citation_Label in the form "Paragraph N of the sample notes".
7. WHERE an outcome is "Challenged: excluded from score", THE Autopsy SHALL state that the concept is excluded from the score.
8. THE Autopsy SHALL contain no claim of mastery, exam readiness or learning gain, and no Banned_Phrases.
9. THE Autopsy SHALL show a "Play again" button, and WHEN the learner activates it, THE Room_Binding SHALL start a new run with an empty Event_Log.
10. THE Autopsy SHALL list only the concepts that `State.concepts` holds and only the questions that `State.finalDoor.slots` holds, add none of its own, and need no change to the Runtime.
11. THE Autopsy SHALL show a Final_Door_Section that lists each question of `State.finalDoor.slots` with its prompt from `content.questions[questionId].prompt` and its final status as a text label taken from `packages/core/src/copy.ts`.
12. THE Autopsy SHALL show each final status of criterion 11 as text and an icon, so that colour is not the only signal.
13. WHERE a final door slot has the status `settled` or `challenged`, THE Final_Door_Section SHALL state that the question is excluded from the score.

### Requirement 21: Announcements and accessible names

**User Story:** As a screen reader user, I want every change in the crypt announced, so that I always know what happened.

#### Acceptance Criteria

1. THE Room_Screen SHALL contain one polite live region.
2. WHEN the Room_Binding exposes an Outcome_Notice, THE Room_Screen SHALL announce one message for it in the live region, with text taken from `packages/core/src/copy.ts`.
3. THE Room_Screen SHALL announce a message for each of these: a candle lit, a ghost spawned, a ghost laid to rest, a seal cracked, a room cleared and an escape.
4. WHEN a slot becomes solved, settled or challenged, THE Room_Screen SHALL announce its new status in the live region.
5. WHEN an Evidence_Panel opens, THE Room_Screen SHALL announce whether the answer was correct or not correct.
6. THE Room_Screen SHALL give every Hotspot_Button, final door button, seal and ghost an accessible name that includes its status in words.
7. THE Room_Screen SHALL use real text for every question, option, excerpt and explanation.

### Requirement 22: Safe rendering and copy rules

**User Story:** As a learner, I want my screen to show only text the app intended, so that nothing in the data can change the page.

#### Acceptance Criteria

1. THE Room_Play SHALL render every question, option, excerpt, explanation and concept title as plain React text.
2. THE Room_Play SHALL use no `dangerouslySetInnerHTML`.
3. THE Room_Play SHALL place every colour literal in `apps/web/src/styles/tokens.css` and refer to no origin other than the app's own.
4. THE Room_Play SHALL use Crimson Pro at 18px or larger on desktop and 16px or larger on phones for question text, and Cinzel only for titles.
5. THE Room_Play SHALL keep each source file at or below approximately 300 lines, name files in kebab-case, name components in PascalCase and keep room-play screens under `apps/web/src/features/crypt/`.
6. THE Room_Play SHALL keep lock-type logic in `packages/core/src/locks/<type>.ts` and put no judging code in `apps/web`.

### Requirement 23: Missing art keeps the game playable

**User Story:** As a developer, I want a missing image to degrade quietly, so that the real renders can replace placeholders without breaking play.

#### Acceptance Criteria

1. IF an art file named by the Scene_File or the asset contract fails to load, THEN THE Room_Screen SHALL log one message for that file, draw nothing in its place and continue to show every control.
2. IF an art file fails to load, THEN THE Room_Screen SHALL leave every Hotspot_Button, Question_Panel and Evidence_Panel usable.
3. IF a Scene_File fails to load or fails validation with Zod, THEN THE Room_Screen SHALL show a plain list of the open locks as buttons with the same accessible names, so that the run stays playable.
4. THE Room_Screen SHALL log the file name and the error type only, and no learner content.

### Requirement 24: Art tests

**User Story:** As a builder, I want tests that catch missing or mismatched art, so that a bad render never ships unnoticed.

#### Acceptance Criteria

1. THE Test_Suite SHALL include a unit test that every file named by each Art_Room's Scene_File exists under `apps/web/public/art/rooms/<art-room>/`.
2. THE Test_Suite SHALL include a unit test that, for every lock in each Scene_File, all four Lock_Layers and the Light_Pass exist.
3. THE Test_Suite SHALL include a unit test that the three Art_Rooms are chosen by room position and not by `roomId`.
4. THE Test_Suite SHALL include a unit test for the Crop_Mapping, including a property-based test with fast-check for Requirement 11, criterion 5.
5. THE Test_Suite SHALL include a Playwright test that hovering and focusing a Hotspot_Button swaps the lock layer to its `-hover` image.
6. THE Test_Suite SHALL include a Playwright test that solving a lock adds its Light_Pass and its Flame, and that a settled lock adds neither.
7. THE Test_Suite SHALL include a Playwright test that a missing art file logs once and leaves the game playable.
8. THE Test_Suite SHALL include a unit test that a lock type absent from the current room draws no Lock_Layer, Light_Pass or Hotspot_Button.

### Requirement 25: Play-through, keyboard, accessibility and motion tests

**User Story:** As a builder, I want end-to-end tests of the whole loop, so that Gate 1 is proven with real clicks and keys.

#### Acceptance Criteria

1. THE Test_Suite SHALL include a Playwright test that plays the Sample_Crypt with every answer correct, from "Enter the crypt" through the Evidence_Panels and the final door to the Autopsy, and checks that the two concept entries have an outcome label from `AUTOPSY_LABELS` and that the Final_Door_Section lists every door question with a final status.
2. THE Test_Suite SHALL include a Playwright test that plays the Sample_Crypt with every answer wrong, checks that ghosts appear and return at the final door, reaches the final door and reaches the escape.
3. THE Test_Suite SHALL include a Playwright test that plays the Sample_Crypt, including a hint, a skip and a challenge, using the keyboard only.
4. THE Test_Suite SHALL include a Playwright test that checks that focus moves into each panel and returns to the opening control.
5. THE Test_Suite SHALL include an axe check on the Room_Screen with the Question_Panel open, with the Evidence_Panel open, at the final door and on the Autopsy, and the check SHALL report no violations.
6. THE Test_Suite SHALL include a Playwright test with `prefers-reduced-motion: reduce` that checks that Lantern_Mode is on, that no parallax transform or flicker animation runs and that crossfades are instant.
7. THE Test_Suite SHALL include a Playwright test that the labels "Human-reviewed" and "Blind model review passed" appear nowhere during a run.
8. THE Test_Suite SHALL include a Playwright test on a Phone_Viewport that every drawn Hotspot_Button is at least 44 by 44 px and a lock can be opened and answered.
9. THE Test_Suite SHALL include a Playwright test that makes no network request to another origin during a run.
10. THE Test_Suite SHALL read the correct answers for the Playwright tests from the Sample_Crypt manifest and call no AI provider.
11. THE Test_Suite SHALL include a unit test that `buildHumanHeartSampleCrypt` returns a `content` that passes the Crypt_Content schema and holds a `content.questions[questionId]` entry for every Question_Id of the manifest.
12. THE Test_Suite SHALL include a unit test for `citationLabel` that the Citation_Source `sample` returns "Paragraph N of the sample notes" and that the default returns the learner-notes wording.
13. THE Test_Suite SHALL include a Playwright test that the Lantern_Setting survives a page reload, and a unit test that a throwing `localStorage` leaves Lantern_Mode off without an error.
14. THE Test_Suite SHALL include a Playwright test that every Citation_Label shown during a run reads "Paragraph N of the sample notes".
15. THE Test_Suite SHALL include a unit test that the `content` returned by `buildHumanHeartSampleCrypt` holds a `concepts` title for every conceptId of the manifest, and a property-based test of the concept-title round trip of Requirement 6, criterion 23.
16. THE Test_Suite SHALL include a unit test that `firstQuestionByConcept` of the RoomAssets maps every conceptId of the Sample_Crypt manifest to a Question_Id of that concept's primary question.

## Out of Scope

- Saving runs, the event log and review state across sessions: spec 4. A reload ends the run in this spec. The Lantern_Setting is the one exception and is kept in `localStorage` under Requirement 12.
- Persisting the Crypt_Content together with the manifest: spec 4. Spec 4 must store both, because the manifest alone cannot show a question.
- Generating questions from the learner's own notes: later spec. The learner's confirmed notes are not used for the run.
- The desk, the book stack, the title and the motion clips (descent, room-to-room, final door, escape) and their poster stills.
- The lock interfaces for bone ordering, bound threads, cursed object and combination dial. Their Judges exist in the runtime, but the sample crypt has no such slot.
- Rooms 2 and 3 as playable rooms: the Art_Room mapping and art tests cover them, but the Sample_Crypt has one room.
- The mobile art set: phones use the cropped desktop art until `scene.json` has a `mobile` block.
- Sound.
- The "Human-reviewed" label: it needs a human review of `samples/questions/human-heart.json`, which is not part of this spec.
