# Requirements Document

## Introduction

Spec 4 saves a learner's run on their own device so that a reload restores the same screen. It covers phases 1 to 3 of `docs/briefs/spec4-persistence-brief.md` (database version 2 with the crypt, run and event stores; write-before-animate with a save banner; single-tab ownership through Web Locks), the "Continue your crypt" entry point on the start screen, and one Playwright reload test. A small, clearly separated Export group closes the document.

The room-runtime reducer in `packages/core` stays the single source of truth for game state. This spec stores the inputs to the reducer (crypt, settings, events) and never the state it computes. Everything lives in `apps/web/src/state/` and the start screen. Nothing talks to the worker, and nothing leaves the device.

### Assumptions and constraints

**Core dependency, read this first.** This spec needs one small addition to `packages/core`, and no other:

- A stored event row must be validated at the storage boundary. `packages/core` has the runtime guard `isEvent` (`packages/core/src/runtime/event-guard.ts`) but does not export it from `packages/core/src/index.ts`. Only the `Event` type is exported. This spec assumes **`isEvent` is re-exported from the core index** (one export line, no new logic). If the user prefers a Zod `EventSchema` in core instead, Requirement 5 criterion 3 changes to use that schema and nothing else changes.
- If neither export is added, the persistence layer would validate only the row envelope with Zod and leave payload validation to `apply`, which rejects malformed events with `malformed-event`. That fallback is weaker and is not the plan.

Everything else is already exported from core and is used as is: `CryptManifest`, `RunSettings`, `CryptContent`, `CryptBundle`, `parseCryptBundle`, `initial`, `apply`, `parseNotesRecord`, `NotesRecord`, `Result` and `z`. The Zod schema for `RunSettings` is defined in `apps/web/src/state/`, because core exports only the type.

**Other constraints.**

- Zod is imported as `z` from `@escape-the-crypt/core`, never from `zod` (lint enforces this).
- The Lantern_Setting stays in `localStorage` (room-play Requirement 12). It is not moved.
- No file exceeds about 300 lines. File names use kebab-case, and test file names use hyphens.
- Import, the review store, the settings store, the Haunting, `navigator.storage.persist()` and the storage-used display are out of scope. Import is a stretch goal and is excluded.

## Glossary

- **Persistence_Layer**: The code in `apps/web/src/state/` that opens the database, reads and writes records and returns typed results. It holds no game rules.
- **Run_Binding**: The existing React binding in `apps/web/src/state/room-binding.ts` that applies events through the reducer and exposes state to the screens.
- **Reducer**: The room-runtime `apply` function and `initial` function from `packages/core`. The Reducer is the single source of truth for game state.
- **Database**: The IndexedDB database named `escape-the-crypt`.
- **Notes_Store**: The existing `notes` object store, keyed by `documentDigest`, holding `NotesRecord` values.
- **Crypt_Store**: The new `crypts` object store, keyed by `manifestId`.
- **Run_Store**: The new `runs` object store, keyed by `runId`.
- **Event_Store**: The new `events` object store, keyed by `[runId, seq]`.
- **Crypt_Record**: A record in the Crypt_Store. It holds the `schemaVersion`, the `CryptManifest`, the `CryptContent`, the crypt `source` (`sample` or `generated`) and, for a generated crypt, the `documentDigest` of its notes.
- **Run_Record**: A record in the Run_Store. It holds the `schemaVersion`, `runId`, `manifestId`, the `RunSettings`, `createdAt` and `status`.
- **Run_Status**: One of `active`, `escaped` or `left`.
- **Event_Row**: A record in the Event_Store. It holds the `schemaVersion`, `runId`, `seq` and one runtime `Event`.
- **Seq**: The zero-based position of an Event_Row within its run. The first event has Seq 0, and Seq increases by 1 per event.
- **Accepted_Event**: An event for which the Reducer returned a new state without rejection.
- **Restored_State**: The state produced by folding the stored events of a run with the Reducer, starting from `initial(manifest, settings)`.
- **Save_Failure**: Any failure to open the Database or to complete a write, including an undefined `indexedDB`, a rejected open request, an aborted transaction and a quota error.
- **Save_Banner**: The visible message "Your progress isn't being saved on this device. Export a copy to keep it." shown after a Save_Failure.
- **Notice_Animation**: The candle, ghost or other result animation that follows an Accepted_Event.
- **Run_Lock**: The Web Locks API lock named `run:<runId>` that grants one tab control of a run.
- **Read_Only_Screen**: The screen that reads "This crypt is open in another tab" with a "Take over here" button.
- **Resume_Entry**: The "Continue your crypt" and "Start again" buttons on the start screen.
- **Export_File**: The JSON file produced by the Export group.
- **Storage_Error**: A typed result with a `kind` field and no message text taken from stored content or from an underlying error.
- **Test_Suite**: The Vitest, fast-check and Playwright tests for this spec. Storage tests use `fake-indexeddb`.

## Requirements

### Requirement 1: Database version 2 and stores

**User Story:** As a learner, I want my crypts, runs and events to have a place on my device, so that a reload can restore them.

#### Acceptance Criteria

1. THE Persistence_Layer SHALL open the Database at version 2.
2. WHEN the Database upgrades from version 1 to version 2, THE Persistence_Layer SHALL create the Crypt_Store keyed by `manifestId`, the Run_Store keyed by `runId` and the Event_Store keyed by `[runId, seq]`.
3. WHEN the Database upgrades from version 1 to version 2, THE Persistence_Layer SHALL leave every record in the Notes_Store unchanged.
4. WHEN the Database is created fresh at version 2, THE Persistence_Layer SHALL create the Notes_Store, the Crypt_Store, the Run_Store and the Event_Store.
5. THE Persistence_Layer SHALL create an index on the Run_Store by `status` so that unfinished runs can be listed.
6. THE Persistence_Layer SHALL keep the existing `DB_NAME` and the `notes` store name unchanged.
7. WHERE the Database is at a version higher than 2, THE Persistence_Layer SHALL return a Storage_Error of kind `unsupported-version` and leave the Database unchanged.

### Requirement 2: Crypt storage and manifest immutability

**User Story:** As a learner, I want my saved crypt to show the same questions after a reload, so that the evidence I saw stays the evidence I get.

#### Acceptance Criteria

1. WHEN a crypt is saved, THE Persistence_Layer SHALL write one Crypt_Record holding the whole `CryptManifest` and the whole `CryptContent` under the `manifestId`.
2. THE Persistence_Layer SHALL save the sample crypt and a generated crypt through the same function.
3. WHEN a generated crypt is saved, THE Persistence_Layer SHALL record the `documentDigest` of the notes the crypt was generated from in the Crypt_Record.
4. WHEN a crypt is saved, THE Persistence_Layer SHALL validate the manifest and the content with `parseCryptBundle` before writing.
5. IF `parseCryptBundle` rejects the crypt, THEN THE Persistence_Layer SHALL write nothing and return a Storage_Error of kind `crypt-invalid`.
6. WHEN a crypt is saved under a `manifestId` that already exists with identical content, THE Persistence_Layer SHALL leave the existing record unchanged and return success.
7. IF a crypt is saved under a `manifestId` that already exists with different content, THEN THE Persistence_Layer SHALL reject the save with a Storage_Error of kind `manifest-conflict` and leave the existing record unchanged.
8. WHEN a Crypt_Record is read, THE Persistence_Layer SHALL parse it with Zod, run `parseCryptBundle` on its manifest and content, and return a Storage_Error of kind `record-unreadable` when either check rejects.
9. THE Persistence_Layer SHALL store the `CryptContent` exactly as `parseCryptBundle` accepts it, with no answer key added.

### Requirement 3: Run records

**User Story:** As a learner, I want each attempt at a crypt to be its own run, so that I can continue one and start another.

#### Acceptance Criteria

1. WHEN a run starts, THE Persistence_Layer SHALL write one Run_Record with Run_Status `active`, the `manifestId`, the `RunSettings`, a new `runId` and the creation time.
2. THE Persistence_Layer SHALL write the Run_Record only after the Crypt_Record for its `manifestId` exists.
3. WHEN the Run_Binding reaches the escaped state, THE Persistence_Layer SHALL set the Run_Status of that run to `escaped`.
4. WHEN the learner chooses "Start again" on the Resume_Entry, THE Persistence_Layer SHALL set the Run_Status of the previous run to `left` and keep its events.
5. THE Persistence_Layer SHALL change no field of a Run_Record other than `status`.
6. IF a Run_Status change names a run that does not exist, THEN THE Persistence_Layer SHALL return a Storage_Error of kind `run-not-found`.
7. THE Persistence_Layer SHALL parse each Run_Record with Zod when reading it, including a schema for `RunSettings` defined in `apps/web/src/state/`.

### Requirement 4: Append-only event log

**User Story:** As a learner, I want every move I make to be recorded in order, so that my run can be replayed exactly.

#### Acceptance Criteria

1. WHEN an Accepted_Event is saved, THE Persistence_Layer SHALL add one Event_Row whose Seq equals the number of Event_Rows already stored for that run.
2. THE Persistence_Layer SHALL add each Event_Row with an add operation, so that a write to an existing `[runId, seq]` key fails.
3. THE Persistence_Layer SHALL provide no operation that updates or deletes a single Event_Row.
4. WHEN the learner deletes a whole crypt, THE Persistence_Layer SHALL delete the Event_Rows and Run_Records of its runs and the Crypt_Record in one transaction.
5. THE Event_Row SHALL hold identifiers and answers only, and SHALL hold no question text, option text, excerpt text or concept title.
6. THE Persistence_Layer SHALL store no Reducer state, no Draft_Answer and no derived value in any store.
7. THE Persistence_Layer SHALL write the `schemaVersion` on every Crypt_Record, Run_Record and Event_Row.
8. IF a save names a run that has no Run_Record, THEN THE Persistence_Layer SHALL write nothing and return a Storage_Error of kind `run-not-found`.

### Requirement 5: Restore by folding events

**User Story:** As a learner, I want a reload to bring me back to exactly where I was, so that nothing I did is lost.

#### Acceptance Criteria

1. WHEN a run is restored, THE Persistence_Layer SHALL read the Run_Record, the Crypt_Record and the Event_Rows ordered by Seq.
2. WHEN a run is restored, THE Run_Binding SHALL compute the Restored_State by folding the stored events with the Reducer, starting from `initial(manifest, settings)`.
3. WHEN an Event_Row is read, THE Persistence_Layer SHALL validate its envelope with Zod and its `event` with `isEvent` from `packages/core`.
4. IF the stored Seq values of a run are not exactly 0 to n-1 in order, THEN THE Persistence_Layer SHALL return a Storage_Error of kind `event-log-gap` and restore nothing.
5. IF the Reducer rejects a stored event during the fold, THEN THE Run_Binding SHALL stop the restore, return a Storage_Error of kind `event-log-rejected` and leave every stored row unchanged.
6. IF any record of the run fails Zod parsing, THEN THE Persistence_Layer SHALL return a Storage_Error of kind `record-unreadable` and leave every stored record unchanged.
7. WHEN a generated crypt is restored, THE Run_Binding SHALL rebuild its citation labels from the Notes_Store record found through the `documentDigest` of the Crypt_Record, with the same chunker that room-play uses.
8. IF a generated crypt is restored and the Notes_Store holds no readable record for its `documentDigest`, THEN THE Run_Binding SHALL return a Storage_Error of kind `notes-unavailable`, show a message that the notes for this crypt are missing from this device and offer "Start again".
9. THE Run_Binding SHALL apply no event to the Reducer other than through the Reducer's `apply` function.

### Requirement 6: Write before animate

**User Story:** As a learner, I want a candle or ghost to appear only after my progress is saved, so that what I see matches what is stored.

#### Acceptance Criteria

1. WHEN the Reducer accepts an event, THE Run_Binding SHALL append the Event_Row before it shows any Notice_Animation or notice text for that event.
2. WHEN the append succeeds, THE Run_Binding SHALL show the Notice_Animation of the Accepted_Event.
3. WHILE an append is pending, THE Run_Binding SHALL queue further events and write them in the order the Reducer accepted them.
4. WHEN the Reducer rejects an event, THE Run_Binding SHALL write no Event_Row for it.
5. THE Run_Binding SHALL keep the in-memory state produced by the Reducer as the state shown to the learner, whether or not the append succeeds.

### Requirement 7: Save failures keep play going

**User Story:** As a learner, I want to keep playing when my browser cannot save, so that a storage problem does not end my run.

#### Acceptance Criteria

1. IF a Save_Failure occurs, THEN THE Run_Binding SHALL keep the in-memory state and continue accepting events.
2. IF a Save_Failure occurs, THEN THE Run_Binding SHALL show the Save_Banner.
3. IF a Save_Failure occurs on an append, THEN THE Run_Binding SHALL show the Notice_Animation of that event after the failure is known.
4. WHILE the Save_Banner is shown, THE Run_Binding SHALL keep every Accepted_Event in memory in order.
5. WHERE the browser has no `indexedDB`, THE Run_Binding SHALL start the run with the in-memory state only and show the Save_Banner.
6. THE Persistence_Layer SHALL convert every thrown error and rejected request into a Storage_Error and SHALL throw nothing to its callers.
7. THE Persistence_Layer SHALL log no stored content and no underlying error message, and SHALL carry only the `kind` of a Storage_Error.
8. THE Save_Banner SHALL be announced to assistive technology through a live region and SHALL NOT cover the Question_Panel or the Evidence_Panel.

### Requirement 8: Crash consistency

**User Story:** As a learner, I want a crash or closed tab to leave my run in a state I actually reached, so that a reload never shows a half-written move.

#### Acceptance Criteria

1. THE Persistence_Layer SHALL write each Event_Row in its own single readwrite transaction.
2. THE Persistence_Layer SHALL read the next Seq inside the same transaction that adds the Event_Row.
3. IF a transaction aborts, THEN THE Persistence_Layer SHALL leave the stored events as they were before that transaction.
4. WHEN a run is restored after a failure at any point in the write sequence, THE Run_Binding SHALL produce a Restored_State equal to the fold of some prefix of the Accepted_Events, and SHALL NOT produce any state outside those prefixes.
5. WHEN a Save_Failure interrupts a run and later events are accepted in memory, THE Persistence_Layer SHALL write no later event until every earlier event of that run is stored.
6. IF an append for Seq k fails, THEN THE Persistence_Layer SHALL write no Event_Row with a Seq above k for that run in the same session unless the append for Seq k has been stored by a retry.

### Requirement 9: Single-tab ownership

**User Story:** As a learner, I want only one tab to play a given crypt, so that two tabs cannot write conflicting moves.

#### Acceptance Criteria

1. WHEN a run is opened, THE Run_Binding SHALL request the Run_Lock through `navigator.locks.request` before it appends any event.
2. WHILE the Run_Lock is held by another tab, THE Run_Binding SHALL show the Read_Only_Screen and write no event.
3. WHEN the learner chooses "Take over here", THE Run_Binding SHALL request the Run_Lock with the `steal` option and then restore the run from the Database.
4. WHEN another tab steals the Run_Lock, THE Run_Binding SHALL show the Read_Only_Screen and stop writing events.
5. WHEN the tab that holds the Run_Lock closes, THE Run_Binding in a waiting tab SHALL be able to acquire the Run_Lock.
6. WHERE `navigator.locks` is unavailable, THE Run_Binding SHALL use a BroadcastChannel named for the run to detect another open tab and show the Read_Only_Screen.
7. WHERE neither `navigator.locks` nor BroadcastChannel is available, THE Run_Binding SHALL continue as a single-tab run.
8. THE Read_Only_Screen SHALL move keyboard focus to the "Take over here" button when it appears.
9. THE Read_Only_Screen SHALL show the crypt as it was at the last stored event and SHALL NOT offer any lock to open.

### Requirement 10: Resume entry point

**User Story:** As a learner, I want the start screen to offer my unfinished crypt, so that I can pick up where I stopped.

#### Acceptance Criteria

1. WHEN the start screen opens, THE Persistence_Layer SHALL look up the most recently created Run_Record with Run_Status `active`.
2. WHERE an `active` run exists, THE start screen SHALL show the Resume_Entry beside the existing buttons.
3. WHEN the learner chooses "Continue your crypt", THE Run_Binding SHALL restore the run under Requirement 5 and show the screen that the Restored_State describes.
4. WHEN the learner chooses "Start again", THE Persistence_Layer SHALL apply Requirement 3 criterion 4 and THE start screen SHALL begin a new run on the same crypt.
5. IF no `active` run exists, THEN THE start screen SHALL show no Resume_Entry.
6. IF the lookup returns a Storage_Error, THEN THE start screen SHALL show no Resume_Entry and SHALL show the existing start buttons.
7. IF restoring the run returns a Storage_Error, THEN THE start screen SHALL show a plain message that the saved crypt could not be opened and offer "Start again", and SHALL leave the stored records unchanged.
8. THE Resume_Entry buttons SHALL have an accessible name, be reachable by keyboard and be at least 44 by 44 px.
9. THE Resume_Entry SHALL use none of the words "verified", "guaranteed", "mastered" or "exam-ready" and make no claim of learning gains.

### Requirement 11: Privacy and boundaries

**User Story:** As a learner, I want my notes and answers to stay on my device, so that I stay in control of them.

#### Acceptance Criteria

1. THE Persistence_Layer SHALL make no network request.
2. THE Persistence_Layer SHALL write run data only to the Database, and SHALL write nothing to `localStorage` or `sessionStorage`.
3. THE Persistence_Layer SHALL leave the Lantern_Setting in `localStorage` as room-play stores it.
4. THE Persistence_Layer SHALL keep Zod parsing for every record it reads, using `z` imported from `@escape-the-crypt/core`.
5. THE Persistence_Layer SHALL export typed results (`Result` with a Storage_Error) and no function that throws.
6. THE Persistence_Layer SHALL leave `packages/core` free of any database, DOM or React dependency.

### Requirement 12: Test suite and correctness properties

**User Story:** As a developer, I want the storage rules checked by property-based tests, so that a reload keeps restoring exactly.

#### Acceptance Criteria

1. THE Test_Suite SHALL include a fast-check property S1 that, for any run built from generated crypts and valid events, writing all events, closing and reopening the Database on `fake-indexeddb`, and folding yields a state deep-equal to the in-memory state, including option order, hints used and candle count.
2. THE Test_Suite SHALL include a fast-check property S2 that no persistence operation other than deleting a whole crypt changes or removes an existing Event_Row.
3. THE Test_Suite SHALL include a fast-check property S3 that, for any prefix of writes interrupted after event k, the reopened state equals the fold of events 0 to k.
4. THE Test_Suite SHALL include a fast-check property S4 that saving a crypt under an existing `manifestId` with different content is rejected and leaves the stored crypt unchanged.
5. THE Test_Suite SHALL include a fast-check property S6 that, with injected failures (undefined `indexedDB`, rejected open, aborted transaction and quota error), the run continues and the Save_Banner appears.
6. THE Test_Suite SHALL include a unit test that upgrading a version 1 Database holding Notes_Store records leaves every notes record equal to its value before the upgrade.
7. THE Test_Suite SHALL include a round-trip property that a Crypt_Record, a Run_Record and an Event_Row each parse back to a value equal to the one written.
8. THE Test_Suite SHALL include a unit test that a stored event with a gap in its Seq values returns `event-log-gap` and that a stored event the Reducer rejects returns `event-log-rejected`.
9. THE Test_Suite SHALL include a unit test that, for a given event, no Notice_Animation call happens before the append resolves.
10. THE Test_Suite SHALL include a unit test with a stubbed `navigator.locks` that a second tab sees the Read_Only_Screen and that "Take over here" restores the run.
11. THE Test_Suite SHALL include a Playwright test that plays 3 events, reloads the page and finds the same screen state.
12. THE Test_Suite SHALL include a Playwright test that the Resume_Entry appears after a reload of an unfinished run and does not appear after the run escapes.
13. THE Test_Suite SHALL include an axe check on the Resume_Entry, the Read_Only_Screen and the Save_Banner, and the check SHALL report no violations.
14. THE Test_Suite SHALL call no real AI provider and no worker endpoint.
15. THE Test_Suite SHALL include a unit test that every Storage_Error `kind` and every message this spec adds to the interface avoids the words "verified", "guaranteed", "100% accurate", "mastered" and "exam-ready".

### Requirement 13: Export (final, small group)

**User Story:** As a learner, I want to export a copy of my run, so that I can keep my progress when my browser cannot save.

#### Acceptance Criteria

1. WHEN the learner chooses the export control, THE Persistence_Layer SHALL produce one Export_File as JSON holding the schema version, the notes chunks, the manifest, the content, the settings and the events of the run.
2. THE Export_File SHALL hold no original uploaded file, no original file name and no PDF binary data.
3. THE export control SHALL be labelled to say that the file contains the learner's notes.
4. WHERE the Save_Banner is shown, THE Save_Banner SHALL offer the export control.
5. WHEN the Export_File is built, THE Persistence_Layer SHALL take events from the in-memory Accepted_Events so that events that failed to save are included.
6. IF the notes for a generated crypt are unavailable, THEN THE Persistence_Layer SHALL export the file without the notes chunks and say so on screen.
7. THE Test_Suite SHALL include a unit test that the Export_File parses with Zod and holds no file name, and a unit test that its events equal the Accepted_Events of the run.
8. THE Export_File SHALL be a download only. Import of an Export_File is out of scope for this spec.
