# Implementation Plan: Persistence

## Overview

The plan follows the required order: (1) database version 2, stores, restore and the S1, S2 and S4 properties; (2) write-before-animate, the save banner and the S3 and S6 properties; (3) Web Locks single-tab ownership; (4) the resume entry point and the reload Playwright tests; (5) export.

All code is TypeScript. All work is in `apps/web` (`apps/web/src/state/`, `apps/web/src/state/storage/`, `apps/web/src/features/`), with one exception: task 1.4 adds the one-line `isEvent` re-export to `packages/core/src/index.ts`. `packages/core` is not touched anywhere else, and not before task 1.4. Earlier tasks type the event guard as a parameter so they compile without the export.

Test names use hyphens. Storage tests run on `fake-indexeddb` with a fresh `IDBFactory` per run. Zod is imported as `z` from `@escape-the-crypt/core`. No test calls an AI provider or a worker endpoint. Each property test carries the tag comment `// Feature: persistence, Property N: <text>`.

## Tasks

- [x] 1. Phase 1: database version 2, stores, repositories and restore
  - [x] 1.1 Create the storage foundation
    - Add `fake-indexeddb` as a dev dependency of `apps/web`
    - Create `state/storage/storage-error.ts` with `StorageErrorKind`, `StorageError` (kind only) and `StorageResult<T>` over core's `Result`
    - Create `state/storage/db.ts` with `DB_NAME`, `DB_VERSION = 2`, `STORES`, `openDb(factory)` and the additive `upgrade(db, oldVersion)` that never reads or writes `notes`
    - Map `VersionError` to `unsupported-version`; map an undefined factory, a throwing `open`, `onerror` and `onblocked` to `storage-unavailable`
    - Create the `by-status` index on `runs`
    - Change `features/ingest/notes-store-idb.ts` to open through `openDb` and re-export `DB_NAME` and `NOTES_STORE_NAME` so existing notes tests keep their imports; its behaviour and `NotesStore` interface do not change
    - Create `state/storage/persistence-arbitraries.ts` (persistence-only arbitraries: reducer-accepted event sequences built by stepping the real reducer, and failure-injection plans)
    - _Requirements: 1.1, 1.2, 1.4, 1.5, 1.6, 1.7, 11.1, 11.2, 11.5, 11.6_

  - [x] 1.2 Write property test for the notes upgrade and the upgrade unit test
    - **Property 1: Notes records survive the v1-to-v2 upgrade**
    - **Validates: Requirements 1.3**
    - Also add the unit test that upgrades a version 1 database holding generated notes records and asserts every record is deep-equal afterwards
    - _Requirements: 1.3, 12.6_

  - [x] 1.3 Create the run-settings schema and record codecs
    - Create `state/storage/run-settings-schema.ts` with a Zod schema checked by `satisfies z.ZodType<RunSettings>`
    - Create `state/storage/records.ts` with `CryptRecord`, `RunRecord`, `EventRow`, `parseCryptRecord`, `parseRunRecord` and `parseEventRow`; `schemaVersion` is the literal `1`
    - `parseCryptRecord` validates `manifest` and `content` through core's `parseCryptBundle`
    - `parseEventRow` takes the event guard as a parameter; the Zod envelope holds no text fields
    - Create `state/storage/event-guard.ts` as the single seam, exporting a guard typed from the parameter shape for now
    - _Requirements: 2.8, 3.7, 4.5, 4.7, 5.3, 11.4_

  - [x] 1.4 Add the `isEvent` re-export to core and bind the seam
    - Re-read `packages/core/src/index.ts` first, because another chat is editing it, so no concurrent edit is overwritten
    - Add one export line that re-exports `isEvent` from `./runtime/event-guard`; make no other change in `packages/core`
    - Point `state/storage/event-guard.ts` at the core export
    - Run the typecheck for `packages/core` and `apps/web`
    - _Requirements: 5.3, 11.6_

  - [x] 1.5 Write the record round-trip property test
    - A `CryptRecord`, a `RunRecord` and an `EventRow` each parse back to a value equal to the one written
    - Reject an unknown `schemaVersion` with `record-unreadable`
    - _Requirements: 4.7, 12.7_

  - [x] 1.6 Implement the crypt repository
    - Create `state/storage/crypt-repository.ts` with `saveCrypt` and `loadCrypt`
    - `saveCrypt` calls `parseCryptBundle` first (`crypt-invalid`, nothing written), then one readwrite transaction: `add` when absent, no-op success on a canonical-JSON match, `manifest-conflict` otherwise
    - Sample and generated crypts use the same function; a generated crypt records `documentDigest`
    - Store content exactly as `parseCryptBundle` accepts it
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8, 2.9_

  - [x] 1.7 Write property test for the crypt round trip
    - **Property 2: Crypt save-then-load round trip**
    - **Validates: Requirements 2.1, 2.2, 2.3, 2.9, 4.7**
    - _Requirements: 2.1, 2.2, 2.3, 2.9, 4.7_

  - [x] 1.8 Write property test for invalid crypts
    - **Property 3: Invalid crypts are never written**
    - **Validates: Requirements 2.4, 2.5**
    - _Requirements: 2.4, 2.5_

  - [x] 1.9 Write property test S4 for the manifest conflict check
    - **Property 4: Saving under an existing manifestId is conflict-checked**
    - **Validates: Requirements 2.6, 2.7**
    - Covers acceptance criterion 12.4 (S4)
    - _Requirements: 2.6, 2.7, 12.4_

  - [x] 1.10 Write property test for corrupted stored crypts
    - **Property 5: Corrupted stored crypts are rejected on read**
    - **Validates: Requirements 2.8**
    - _Requirements: 2.8_

  - [x] 1.11 Implement the run repository
    - Create `state/storage/run-repository.ts` with `createRun`, `setRunStatus`, `findResumable`, `appendEvent`, `loadEvents` and `deleteCrypt`
    - `createRun` checks the crypt exists in the same transaction (`record-unreadable` otherwise) and takes `runId` and `createdAt` from the caller
    - `setRunStatus` replaces only `status`; a missing run returns `run-not-found`
    - `appendEvent` reads the next `seq` and `add`s the row in one readwrite transaction; a missing run returns `run-not-found`; no update or single-row delete function exists
    - `loadEvents` returns rows ordered by key, parses each, and checks seqs are exactly `0..n-1` (`event-log-gap`)
    - `deleteCrypt` removes events, runs and the crypt in one transaction
    - `findResumable` returns the `active` run with the greatest `createdAt`, or `null`
    - _Requirements: 3.1, 3.2, 3.5, 3.6, 3.7, 4.1, 4.2, 4.3, 4.4, 4.6, 4.8, 5.4, 8.1, 8.2, 8.3, 10.1_

  - [x] 1.12 Write property test for run creation
    - **Property 6: Run creation requires an existing crypt and round-trips its fields**
    - **Validates: Requirements 3.1, 3.2, 4.7**
    - _Requirements: 3.1, 3.2, 4.7_

  - [x] 1.13 Write property test for status changes
    - **Property 7: Status changes touch only status**
    - **Validates: Requirements 3.5, 3.6**
    - _Requirements: 3.5, 3.6_

  - [x] 1.14 Write property test for the append-only log
    - **Property 9: The event log is a gapless, race-free, append-only sequence**
    - **Validates: Requirements 4.1, 4.8, 8.1, 8.2**
    - Include the deliberately raced variant with a documented fixed set of interleavings
    - _Requirements: 4.1, 4.8, 8.1, 8.2_

  - [x] 1.15 Write property test for crypt deletion
    - **Property 10: Deleting a crypt removes exactly its own rows**
    - **Validates: Requirements 4.4**
    - _Requirements: 4.4_

  - [x] 1.16 Write property test S2 for event-row immutability
    - For any sequence of repository operations other than `deleteCrypt`, every existing `EventRow` is unchanged and none is removed
    - Assert the repository exports no function that updates or deletes a single event row
    - **Property 9: The event log is a gapless, race-free, append-only sequence**
    - **Validates: Requirements 4.2, 4.3**
    - Covers acceptance criterion 12.2 (S2)
    - _Requirements: 4.2, 4.3, 12.2_

  - [x] 1.17 Implement restore
    - Create `state/storage/restore-run.ts` with `restoreRun(deps, runId)`
    - Read run, crypt and events; parse each with the codecs; check seq continuity; fold with `initial` then `apply` only (no other path into the reducer)
    - A rejected stored event returns `event-log-rejected` and writes nothing
    - For a generated crypt, load the notes record through the notes store by `documentDigest` and rebuild chunks with the chunker room-play uses; a missing or unreadable record returns `notes-unavailable`
    - Return `{ run, crypt, events, model, assets }`
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 5.8, 5.9_

  - [x] 1.18 Write property test S1 for the restore round trip
    - **Property 11: Restoring a run folds its stored log to the live state**
    - **Validates: Requirements 5.2**
    - Close and reopen the `fake-indexeddb` database between writing and restoring; compare option order, hints used and candle count
    - Covers acceptance criterion 12.1 (S1)
    - _Requirements: 5.2, 12.1_

  - [x] 1.19 Write property test for untrusted stored records and the gap and rejection unit tests
    - **Property 12: Restore rejects what it cannot trust and changes nothing**
    - **Validates: Requirements 5.3, 5.4, 5.5, 5.6**
    - Add hand-written unit tests: a stored log with a missing seq returns `event-log-gap`; a stored event the reducer rejects returns `event-log-rejected`
    - _Requirements: 5.3, 5.4, 5.5, 5.6, 12.8_

  - [x] 1.20 Write property test for rebuilt citation chunks
    - **Property 13: Citation chunks are rebuilt, not stored, and match the source**
    - **Validates: Requirements 5.7, 5.8**
    - _Requirements: 5.7, 5.8_

  - [x] 1.21 Write property test that storage functions never throw
    - **Property 17: Storage functions never throw and never carry content**
    - **Validates: Requirements 7.6, 7.7, 11.5**
    - Inject throws and request rejections at the IndexedDB layer for every exported function of the opener, both repositories and restore
    - _Requirements: 7.6, 7.7, 11.5_

- [x] 2. Checkpoint - Phase 1 complete
  - Ensure all tests pass, ask the user if questions arise.

- [x] 3. Phase 2: write-before-animate, save banner and failure handling
  - [x] 3.1 Implement the write queue
    - Create `state/storage/event-writer.ts` with `enqueue`, `retry` and `unsaved`, and the `WriteOutcome` type
    - One promise chain per run; after a failed append the writer is blocked and later events stay in memory in order, resolving `skipped`
    - `retry` re-attempts the oldest unsaved event, then drains the rest in order, stopping at the first failure
    - An undefined `indexedDB` starts the writer blocked with `storage-unavailable`
    - Wrap each call in `try/catch` mapping anything unexpected to `write-failed`; the writer never throws
    - _Requirements: 6.3, 7.1, 7.4, 7.5, 7.6, 8.5, 8.6_

  - [x] 3.2 Wire persistence into the binding
    - Create `state/persisted-room.ts`, a hook taking `factory`, `now`, `newRunId`, `locks`, `channelFactory` and `animate` as parameters with browser-global defaults
    - Enqueue the newest event when `eventLog` grows by one; a rejected action enqueues nothing
    - Add the optional `heldNotices` output to `useRoomBinding` in `room-binding.ts` without changing `bindingReducer` or `stepBinding` behaviour; release notices only after the writer settles (saved or failed)
    - Show in-memory state immediately whether or not the append succeeds
    - On the escaped state, call `setRunStatus(runId, 'escaped')`; a failure shows the banner and does not block play
    - `playAgain` sets the old run to `left`, creates a new run and writer, and persists the four start events as ordinary events
    - Save the sample or generated crypt and create the run before the first append
    - _Requirements: 3.1, 3.3, 3.4, 5.9, 6.1, 6.2, 6.4, 6.5, 7.1, 7.3_

  - [x] 3.3 Create the save banner
    - Create `features/start/save-banner.tsx` as a `role="status"` live region with the exact text "Your progress isn't being saved on this device. Export a copy to keep it."
    - Render it in normal flow above the room, not over the Question_Panel or Evidence_Panel
    - Render it from the persisted-room hook when the writer reports a failure; leave a slot for the export control added in task 9.2
    - _Requirements: 7.2, 7.5, 7.8_

  - [x] 3.4 Write property test and unit test for write-before-animate
    - **Property 14: Notices never precede a settled write, and state never waits for one**
    - **Validates: Requirements 6.1, 6.2, 6.5, 7.3**
    - Add the unit test with an injected `animate` spy and a manually resolved append promise: no call before resolution, one call after
    - _Requirements: 6.1, 6.2, 6.5, 7.3, 12.9_

  - [x] 3.5 Write property test for concurrent accepts
    - **Property 15: Concurrent accepts are written once, in order, only for accepted events**
    - **Validates: Requirements 6.3, 6.4**
    - _Requirements: 6.3, 6.4_

  - [x] 3.6 Write property test for escape and start-again status
    - **Property 8: Reaching escaped or starting again sets status without losing events**
    - **Validates: Requirements 3.3, 3.4**
    - _Requirements: 3.3, 3.4_

  - [x] 3.7 Write property test S3 for crash consistency
    - **Property 16: A run survives a storage failure and never writes past it**
    - **Validates: Requirements 7.1, 7.2, 7.4, 7.5, 8.3, 8.4, 8.5, 8.6**
    - This test covers the prefix rule: for any prefix of writes interrupted after event k, the reopened state equals the fold of events 0 to k, and no seq above a failed one is written before a retry stores it
    - Covers acceptance criterion 12.3 (S3)
    - _Requirements: 8.3, 8.4, 8.5, 8.6, 12.3_

  - [x] 3.8 Write property test S6 for failures that keep play going
    - **Property 16: A run survives a storage failure and never writes past it**
    - **Validates: Requirements 7.1, 7.2, 7.4, 7.5, 8.3, 8.4, 8.5, 8.6**
    - Inject an undefined `indexedDB`, a rejected open, an aborted transaction and a quota error; assert the run keeps accepting events in memory in order and the Save_Banner appears
    - Covers acceptance criterion 12.5 (S6)
    - _Requirements: 7.1, 7.2, 7.4, 7.5, 12.5_

  - [x] 3.9 Write the axe check for the save banner
    - Expect no violations; confirm the banner does not overlap the Question_Panel or Evidence_Panel
    - _Requirements: 7.8, 12.13_

- [x] 4. Checkpoint - Phase 2 complete
  - Ensure all tests pass, ask the user if questions arise.

- [x] 5. Phase 3: Web Locks single-tab ownership
  - [x] 5.1 Implement the run lock
    - Create `state/storage/run-lock.ts` with `acquireRunLock(deps, runId)` returning `state`, `takeOver`, `release` and `subscribe`
    - With `navigator.locks`: `request('run:<runId>', { ifAvailable: true }, cb)`; a `null` grant means `waiting`; a granted lock stays held until `release()` or tab close
    - `takeOver()` requests with `steal: true`; a stolen lock sets `lost`
    - Without `navigator.locks`: a `BroadcastChannel` named `run:<runId>` with `hello`, `owned` and `takeover` messages
    - Without both: state `single-tab`
    - _Requirements: 9.1, 9.3, 9.4, 9.5, 9.6, 9.7_

  - [x] 5.2 Gate writes on the lock
    - In `persisted-room.ts`, request the lock before the first append and enable writes only while the state is `held` or `single-tab`
    - When the state becomes `lost` or `waiting`, stop the writer and write nothing; an in-flight transaction is allowed to finish
    - On `takeOver`, restore the run from the database
    - _Requirements: 9.1, 9.2, 9.3, 9.4_

  - [x] 5.3 Create the read-only screen
    - Create `features/start/read-only-screen.tsx` with the text "This crypt is open in another tab" and a "Take over here" button that receives focus on mount
    - Show the crypt at the last stored event, built by restoring from the database, with no click handlers on lock objects
    - _Requirements: 9.2, 9.3, 9.8, 9.9_

  - [x] 5.4 Write property test for lock-gated writes
    - **Property 18: Writes happen only while the run lock is held or unneeded**
    - **Validates: Requirements 9.1, 9.2, 9.4**
    - Use a fixed documented set of interleavings for lock grant, loss and steal
    - _Requirements: 9.1, 9.2, 9.4_

  - [x] 5.5 Write the lock unit tests
    - With a stubbed `navigator.locks` two-tab model: the second tab shows the Read_Only_Screen and "Take over here" restores the run
    - Cover the BroadcastChannel fallback, the single-tab path, and acquisition by a waiting tab after the holder releases
    - _Requirements: 9.2, 9.3, 9.5, 9.6, 9.7, 12.10_

  - [x] 5.6 Write the axe check for the read-only screen
    - Expect no violations; assert focus lands on "Take over here"
    - _Requirements: 9.8, 12.13_

- [x] 6. Checkpoint - Phase 3 complete
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 7. Resume entry point and reload tests
  - [~] 7.1 Create the resume entry and wire the start screen
    - Create `features/start/resume-entry.tsx` with "Continue your crypt" and "Start again", each at least 44 by 44 px with an accessible name and keyboard access
    - On the start screen, call `findResumable` and render the entry beside the existing buttons only when an `active` run exists; on a lookup error show only the existing buttons
    - "Continue your crypt" restores under task 1.17 and shows the screen the restored state describes
    - "Start again" sets the previous run to `left`, keeps its events and begins a new run on the same crypt
    - On a restore error show a plain sentence that the saved crypt could not be opened and offer "Start again"; for `notes-unavailable` show that the notes for this crypt are missing from this device; leave stored records unchanged
    - _Requirements: 3.4, 5.8, 10.1, 10.2, 10.3, 10.4, 10.5, 10.6, 10.7, 10.8_

  - [~] 7.2 Write property test for the resumable run lookup
    - **Property 19: The resumable run is the most recent active one**
    - **Validates: Requirements 10.1**
    - _Requirements: 10.1_

  - [~] 7.3 Write the Playwright reload test
    - Play 3 events on the sample crypt, reload the page, continue, and find the same screen state
    - Use the existing e2e build; call no provider and no worker endpoint
    - _Requirements: 5.2, 10.3, 12.11, 12.14_

  - [~] 7.4 Write the Playwright resume-entry test
    - The Resume_Entry appears after a reload of an unfinished run and does not appear after the run escapes
    - _Requirements: 10.2, 10.5, 12.12, 12.14_

  - [~] 7.5 Write the axe check for the resume entry
    - Expect no violations; assert the 44 by 44 px target size and keyboard reachability
    - _Requirements: 10.8, 12.13_

- [~] 8. Checkpoint - Resume entry complete
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 9. Export
  - [~] 9.1 Implement the export builder
    - Create `state/storage/export-run.ts` with `buildExport` and a strict Zod `ExportFile` schema holding schema version, notes chunks (or `null`), manifest, content, settings and events, with no field for an original file, file name or PDF bytes
    - Take events from the in-memory accepted events so unsaved events are included
    - _Requirements: 13.1, 13.2, 13.5, 13.6_

  - [~] 9.2 Add the export control
    - Add a download-only export control (Blob download) labelled to say the file contains the learner's notes
    - Show it inside the Save_Banner slot from task 3.3
    - When the notes for a generated crypt are unavailable, export without chunks and say so on screen
    - Build no import
    - _Requirements: 13.3, 13.4, 13.6, 13.8_

  - [~] 9.3 Write property test for export
    - **Property 21: Export reflects the in-memory run, not just what was saved**
    - **Validates: Requirements 13.1, 13.2, 13.5, 13.6**
    - _Requirements: 13.1, 13.2, 13.5, 13.6_

  - [~] 9.4 Write the export unit tests
    - The file parses with the strict Zod schema and holds no file name
    - Its events equal the accepted events, including a case where the last events failed to save
    - _Requirements: 13.2, 13.5, 13.7_

  - [~] 9.5 Write the copy property test
    - **Property 20: New feature copy avoids banned wording**
    - **Validates: Requirements 10.9, 12.15**
    - Import the copy constants for every `StorageErrorKind` and every string added to the Resume_Entry, Read_Only_Screen, Save_Banner and export control; assert none contains "verified", "guaranteed", "100% accurate", "hallucination-free", "mastered" or "exam-ready" and none claims learning gains
    - Add the matching example unit test
    - _Requirements: 10.9, 12.15_

- [~] 10. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- No task or sub-task is optional. Every test and property task is part of the plan.
- Task 1.4 is the only task that touches `packages/core`. It re-reads `packages/core/src/index.ts` first and adds one export line.
- Acceptance criteria 12.1 to 12.5 map to the design properties as follows: S1 is Property 11, S2 is Property 9, S3 and S6 are Property 16, S4 is Property 4.
- Each task references specific requirements for traceability.
- Checkpoints ensure incremental validation.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2", "1.3"] },
    { "id": 2, "tasks": ["1.4", "1.6"] },
    { "id": 3, "tasks": ["1.5", "1.7", "1.8", "1.9", "1.10", "1.11"] },
    { "id": 4, "tasks": ["1.12", "1.13", "1.14", "1.15", "1.16", "1.17"] },
    { "id": 5, "tasks": ["1.18", "1.19", "1.20", "1.21"] },
    { "id": 6, "tasks": ["2"] },
    { "id": 7, "tasks": ["3.1"] },
    { "id": 8, "tasks": ["3.2", "3.3"] },
    { "id": 9, "tasks": ["3.4", "3.5", "3.6", "3.7", "3.8", "3.9"] },
    { "id": 10, "tasks": ["4"] },
    { "id": 11, "tasks": ["5.1"] },
    { "id": 12, "tasks": ["5.2", "5.3"] },
    { "id": 13, "tasks": ["5.4", "5.5", "5.6"] },
    { "id": 14, "tasks": ["6"] },
    { "id": 15, "tasks": ["7.1"] },
    { "id": 16, "tasks": ["7.2", "7.3", "7.4", "7.5"] },
    { "id": 17, "tasks": ["8"] },
    { "id": 18, "tasks": ["9.1"] },
    { "id": 19, "tasks": ["9.2", "9.3", "9.4"] },
    { "id": 20, "tasks": ["9.5"] },
    { "id": 21, "tasks": ["10"] }
  ]
}
```
