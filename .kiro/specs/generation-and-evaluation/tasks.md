# Implementation Plan: Generation and Evaluation (Phase 1, Gate 1)

## Overview

This plan covers Phase 1 only. It delivers the Gate 1 sample crypt as early as possible, then proves it against the datasets, and migrates `parseNotesRecord` last. Everything is TypeScript in `packages/core`. No task adds provider, cassette, budget, network or AI SDK code. Phases 2 to 6 are not planned here.

Order: schemas (authoring, manifest, hint type change, fixture builder) → checks → Manifest_Mapper → sample crypt → dataset acceptance → `parseNotesRecord` Zod migration.

## Tasks

- [x] 1. Schemas and hint type
  - [x] 1.1 Add Zod and the `reveal-first-letter` hint kind
    - Add `zod` as a pinned dependency in `packages/core/package.json`
    - Add `{ kind: 'reveal-first-letter'; firstLetter: string; length: number }` to `HintEffectSpec` in `packages/core/src/types.ts`
    - Fix any exhaustive `switch` over `HintEffectSpec` that `pnpm typecheck` reports, adding a case only (no behaviour change; the rune judge keeps ignoring hints)
    - Add a `reveal-first-letter` arm to `anyHintSpec` in `judge-totality.ts` so every judge is still tested against every hint kind
    - _Requirements: 2.13_

  - [x] 1.2 Implement the Authoring_Schema and parser
    - Create `packages/core/src/authoring/schema.ts` with strict-object rune cipher and séance board arms in a discriminated union on `lockType`, and the types derived from it
    - Create `packages/core/src/authoring/parse.ts` with `parseAuthoringQuestion` returning a typed `Result` with the failing field path, never throwing
    - Include no offset field anywhere, and no hint field on séance board questions (the mapper decides that hint in code)
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.7, 5.6_

  - [x] 1.3 Write unit tests for the Authoring_Schema
    - Parse every real rune cipher and séance board question in `eval/dev/questions/*.json` and `samples/questions/*.json`
    - Reject malformed values with the expected `path`, an unknown `lockType`, empty rune answers, and unknown keys such as `offset`
    - _Requirements: 1.3, 1.4, 1.5, 1.7, 5.6_

  - [x] 1.4 Write property test for Authoring_Question round-trip
    - Add `authoringQuestionArb` (rune cipher and séance board, quotes built as exact substrings of generated chunk text) in `packages/core/src/test-support/`
    - **Property 1: Authoring_Question round-trip**
    - **Validates: Requirements 1.6**

  - [x] 1.5 Implement the Manifest_Schema, hint narrowing and parser
    - Create `packages/core/src/runtime/manifest-schema.ts` with `HintEffectSchema`, rune cipher and séance board payload schemas, `payloadSchemaFor` (returns `null` for the other four types so they are rejected with `lock-type-not-supported`), `QuestionSpecSchema` with `superRefine`, slot, room (one slot per type) and `CryptManifestSchema` (unique `questionId`, 0 to 4 final-door slots, alternate type differs from primary)
    - Add `narrowHint`: rune cipher accepts only `reveal-first-letter` or `null`; séance board accepts only `remove-option` or `null`, with `optionId` in `optionIds` and not equal to `keyOptionId`. Move it to `manifest-hints.ts` if the file nears 300 lines
    - Add a `parseManifest` wrapper returning a typed `Result`, never throwing
    - Export only `CryptManifest` and its member types from `manifest-types.ts`; add no second manifest type
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8, 2.9, 2.10, 2.14, 2.15, 2.16, 2.17_

  - [x] 1.6 Update the fixture builder and `manifestArb` for rune hints
    - Change `question-payloads.ts` in `packages/core/src/test-support/` to emit `{ kind: 'reveal-first-letter', firstLetter, length }` for rune cipher questions, derived from the generated `answer`
    - Update tests in other specs that assert a rune question has `hintEffect: null`
    - Add a test that `manifestCheck` accepts a manifest containing a `reveal-first-letter` hint (no change to `manifest-check.ts` is expected)
    - _Requirements: 2.18, 2.19_

  - [x] 1.7 Write unit tests for the Manifest_Schema
    - Add the compile-time two-way assignability check between `z.infer<typeof CryptManifestSchema>` and `CryptManifest`
    - Cover accept and reject examples for payload shapes, alternate type, final-door slot count and typed errors
    - Cover each hint rejection: rune cipher with `remove-option`; séance with `remove-option` naming an id not in `optionIds`; séance with `remove-option` naming `keyOptionId`; séance with `reveal-first-letter`; `reveal-first-letter` with a 2-character `firstLetter` or non-positive `length`
    - _Requirements: 2.1, 2.3, 2.4, 2.5, 2.8, 2.9, 2.10, 2.16, 2.17_

  - [x] 1.8 Write property test for manifest serialisation round-trip
    - Use `buildManifest` restricted to `rune-cipher` and `seance-board`, including `reveal-first-letter` hints
    - **Property 2: Manifest round-trip**
    - **Validates: Requirements 2.11, 2.19**

  - [x] 1.9 Write property tests for manifest structural rejections
    - **Property 3: Manifest_Schema rejects duplicate question IDs**
    - **Validates: Requirements 2.6**
    - **Property 4: Manifest_Schema rejects a second slot of the same Lock_Type in one room**
    - **Validates: Requirements 2.7**

  - [x] 1.10 Write property test for hint narrowing
    - **Property 13: Manifest_Schema narrows hints per lock type**
    - **Validates: Requirements 2.4, 2.14, 2.15, 2.16, 2.17**

  - [x] 1.11 Implement `validateManifestForPublish`
    - Create `packages/core/src/runtime/publish-manifest.ts`: `parseManifest` then the existing `manifestCheck`, returning a typed `Result`, never publishing on either failure
    - _Requirements: 2.10, 2.12_

  - [x] 1.12 Write unit tests for `validateManifestForPublish`
    - Assert the ordering (schema, then `manifestCheck`) and that a failure in either blocks publishing
    - _Requirements: 2.12_

- [x] 2. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 3. Code_Check framework and checks
  - [x] 3.1 Implement check types, registry and `CHECK_VERSION`
    - Create `packages/core/src/checks/types.ts` (`CheckId` including `lock-type-not-supported`, `CheckFailure`, `CheckRegistration`) and `registry.ts` with the Phase 1 registrations, `alternate-off-concept` as the only advisory entry, and `CHECK_VERSION = '2026-11-25.1'` (exact value)
    - Register every Check_ID in the Req 3.5 list, which includes `lock-type-not-supported`
    - Add an `implemented: boolean` field to `CheckRegistration`: `true` for every id scoped to `rune-cipher`, `seance-board` or `'shared'`, `false` for every id scoped to `bone-ordering`, `bound-threads`, `cursed-object` or `combination-dial` (Phase 5 ids; P5 flips each flag when it adds that check function)
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.14_

  - [x] 3.14 Write registry test
    - Compare registry ids with the literal Req 3.5 list (which already includes `lock-type-not-supported`) and nothing else; fail on any missing or extra id
    - Assert `CHECK_VERSION === '2026-11-25.1'` and only `alternate-off-concept` is advisory
    - Implementation-status test (Req 3.14): every registry entry scoped to `rune-cipher`, `seance-board` or `'shared'` has `implemented: true` and an implementation that `runChecks` calls (run `runChecks` on a question that trips each such id, using the adversarial `code:*` fixture where one exists, otherwise a synthetic question, and assert the id appears in the result); every entry scoped to a Phase 5 lock type has `implemented: false`; for a generated question of each Phase 5 lock type, `runChecks` returns exactly one failure, `lock-type-not-supported`, and no Phase 5 Check_ID
    - _Requirements: 3.2, 3.4, 3.5, 3.6, 3.12, 3.14_

  - [x] 3.2 Implement shared evidence checks
    - Create `packages/core/src/checks/evidence.ts`: `checkQuote` mapping `resolveQuote` errors to `quote-not-found`, `quote-ambiguous`, `quote-too-short`, `unknown-paragraph/chunk`; `quote-too-long` above 25 words; `banned-phrase` using `BANNED_COPY_PHRASES` from `copy.ts` over prompt, option text and explanation; `negative-question` on the prompt only, with the cursed-object "which one is not" exemption
    - _Requirements: 3.5, 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8, 4.9, 4.10, 26.2_

  - [x] 3.3 Write unit tests for shared evidence checks, including `quote-too-long`
    - A 26-word quote fails with exactly `quote-too-long`; a 25-word quote does not (quotes built from a resolvable passage in the test)
    - One case per `QuoteError` kind mapped to its Check_ID; `banned-phrase` for each phrase in `BANNED_COPY_PHRASES`; `negative-question` denylist and exemption
    - This test is required because Req 3.13 mandates it
    - _Requirements: 3.13, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8, 4.9_

  - [x] 3.4 Implement rune cipher checks
    - Extract `normaliseRuneAnswer(value, caseSensitive)` from `packages/core/src/locks/rune-cipher.ts` and have the judge import it (no change to matching behaviour)
    - Create `packages/core/src/locks/rune-cipher-checks.ts` with `rune-needs-one-blank`, `answer-not-in-quote` (answer only; aliases exempt) and `answer-leak-in-prompt` (word-boundary match)
    - _Requirements: 5.1, 5.2, 5.3, 5.5, 5.6_

  - [x] 3.5 Write unit tests for rune cipher checks
    - Run against the rune fixtures in the dev, sample and adversarial sets and assert each fixture's exact expected Check_ID
    - _Requirements: 5.1, 5.2, 5.3_

  - [x] 3.6 Write property test for rune normalisation agreement
    - **Property 7: Rune cipher check and judge agree on normalisation**
    - **Validates: Requirements 5.5**

  - [x] 3.7 Implement séance board checks
    - Create `packages/core/src/locks/seance-board-checks.ts` with `missing-according-to-your-notes`, `option-count`, `duplicate-options` (via `normalise.ts`), `option-not-supported-or-contradicted`, `option-without-evidence`, `not-exactly-one-supported`, `key-not-the-supported-option`, and run `checkQuote` on each option's own evidence
    - Accept raw pre-schema input for the two defensive checks so the `adv-10` fixture yields exactly its expected id
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 6.9_

  - [x] 3.8 Write unit tests for séance board checks
    - Assert each séance fixture's exact expected Check_ID (for example `adv-06`, `adv-10`, `adv-25`) and no other blocking id
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 6.9_

  - [x] 3.9 Implement alternate checks and Leak_Scan
    - Create `packages/core/src/checks/alternate.ts` with `alternate-same-lock-type`, `max-one-alternate` and advisory `alternate-off-concept`
    - Create `packages/core/src/checks/leak-scan.ts` with `leakScanRoom`, keyed by `conceptId`, returning `answer-leak-in-room`
    - _Requirements: 5.4, 7.1, 7.2, 7.3, 7.4_

  - [x] 3.10 Write unit tests for alternate checks and Leak_Scan
    - `adv-11` for `alternate-same-lock-type`; a synthetic two-alternate case; an off-concept case that returns an advisory result and never appears in the blocking-only list; `adv-05` for `answer-leak-in-room`
    - _Requirements: 5.4, 7.1, 7.2, 7.3_

  - [x] 3.11 Write property test for Leak_Scan
    - **Property 10: Leak_Scan finds no cross-concept rune leak unless one is injected**
    - **Validates: Requirements 24.4**

  - [x] 3.12 Implement `runChecks`
    - Create `packages/core/src/checks/run-checks.ts` combining shared, per-lock-type and alternate checks into `readonly CheckFailure[]`; return `lock-type-not-supported` for the other four lock types; never throw
    - _Requirements: 3.1, 3.3, 3.8, 3.11_

  - [x] 3.13 Write property tests for `runChecks`
    - **Property 5: Code_Checks are order-independent**
    - **Validates: Requirements 3.9**
    - **Property 6: Code_Checks are idempotent**
    - **Validates: Requirements 3.10**
    - **Property 8: Accepted rune-cipher candidates resolve uniquely**
    - **Validates: Requirements 5.7**

- [x] 4. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 5. Manifest_Mapper
  - [x] 5.1 Implement `mapAuthoringQuestionToSpec`
    - Create `packages/core/src/mapper/manifest-mapper.ts` and a paragraph-to-chunk map builder using `chunkDocument` (first chunk wins for a paragraph number)
    - Resolve every paragraph to a chunk ID or return `paragraph-not-found`; re-run blocking checks and return `check-failed`; build rune and séance payloads, preserving option order; set `evidenceRefs` de-duplicated in order
    - Rune hint: always set `reveal-first-letter` with `firstLetter` and `length` computed from the answer (by code point), even when the authoring question has no hint; return `hint-mismatch` (naming the question, no `QuestionSpec`) when an authoring hint disagrees with the computed values
    - Séance hint: the authoring format has no hint marker; always set `remove-option` for the first `contradicted` option in authoring order, decided in code (an accepted question always has at least two contradicted options)
    - Return typed `MapperError`; never produce a partial `QuestionSpec`
    - _Requirements: 6.8, 8.1, 8.2, 8.3, 8.4, 8.5, 8.7, 8.8, 8.9_

  - [x] 5.2 Write unit tests for the Manifest_Mapper
    - One mapping example per Phase 1 lock type from `samples/questions/human-heart.json`; the `paragraph-not-found` and `hint-mismatch` errors; a rune question with no authoring hint still maps to `reveal-first-letter`; a séance question maps to `remove-option` for its first `contradicted` option (no `contradicted` option gives `check-failed`); each row of the hint table; the first-chunk-wins choice; a mapped manifest of accepted dev questions passes `manifestCheck`
    - _Requirements: 8.2, 8.4, 8.5, 8.6, 8.7, 8.8, 8.9_

  - [x] 5.3 Write property tests for the Manifest_Mapper
    - **Property 9: Manifest_Mapper preserves séance-board option order**
    - **Validates: Requirements 6.8**
    - **Property 14: Mapper hint rules**
    - **Validates: Requirements 8.4, 8.8, 8.9, 8.10, 8.11**

- [x] 6. Gate 1 sample crypt
  - [x] 6.1 Implement `buildHumanHeartSampleCrypt`
    - Create `packages/core/src/sample-crypt/human-heart.ts`: pure function taking the notes text and parsed questions file
    - Fixed selection: room locks from `hh-c01` (rune primary `hh-q01`, séance alternate `hh-q02`) and `hh-c02` (séance primary `hh-q03`, rune alternate `hh-q04`); final-door slots from `hh-c03` (`hh-q06`), `hh-c04` (`hh-q08`) and `hh-c07` (`hh-q12`), each a full slot spec
    - Map every question through the mapper, assemble one room, and validate with `validateManifestForPublish`; return a typed error naming the question on any failure, never a partial manifest
    - Add `isHumanReviewed(file)` that reads `status === 'human-reviewed'` as data
    - Add a comment that ghosts return only at the final door (2 locks, `GHOST_DELAY` is 3)
    - Export the builder from `packages/core/src/index.ts`
    - _Requirements: 19.1, 19.2, 19.4, 27.1, 27.2, 27.3, 27.4, 27.5, 27.6, 27.7, 27.9_

  - [x] 6.2 Write tests for the sample crypt
    - Build from the real `samples/human-heart.txt` and `samples/questions/human-heart.json`; assert the schema and `manifestCheck` accept it (Req 27.3), the exact room and final-door concept split, and that every sample rune cipher question has `reveal-first-letter` and every séance question with a `contradicted` option has `remove-option`
    - Do not expect an in-room ghost return
    - _Requirements: 27.1, 27.2, 27.3, 27.9_

  - [x] 6.3 Write property test for sample crypt determinism
    - **Property 12: Sample crypt build is deterministic**
    - **Validates: Requirements 27.8**

- [x] 7. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 8. Dataset acceptance
  - [~] 8.1 Write the Phase 1 acceptance test
    - Create `phase1-acceptance.test.ts` that reads `eval/dev/questions/*.json`, `samples/questions/*.json` and `eval/adversarial/fixtures.json` at test time
    - Assert counts against named constants (56 questions: 26 rune cipher and 30 séance board; 10 `code:*` fixtures; 4 `review:*` fixtures), failing with a message that states expected and actual counts
    - Assert all 56 questions pass the blocking checks, each `code:*` fixture fails with exactly its expected Check_ID and no other blocking id, each `review:*` fixture passes, and the sample crypt passes the schema and `manifestCheck`
    - Do not edit `eval/adversarial/fixtures.json`
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.6, 9.7, 9.9_

  - [~] 8.2 Write the boundary and no-holdout tests
    - Create `boundary.test.ts` that scans Phase 1 module sources for `fetch`, `http`, `net`, provider, cassette, budget-ledger and AI SDK imports
    - Assert no Phase 1 test or source file references `eval/holdout`
    - _Requirements: 9.5, 9.8, 27.7_

- [ ] 9. `parseNotesRecord` Zod migration
  - [~] 9.1 Reimplement `parseNotesRecord` with Zod
    - Keep the exported name and signature `(value: unknown) => Result<NotesRecord, { kind: 'invalid-record' }>`, with no thrown errors
    - The existing `notes-record.test.ts` must pass unchanged
    - _Requirements: 10.1, 10.4_

  - [~] 9.2 Write the differential migration test
    - Create `notes-record-migration.test.ts` with the pre-migration logic inlined as a private reference, and run a fixed edge-case corpus through both versions, asserting identical accept and reject verdicts
    - Delete the reference copy once the migration is accepted
    - _Requirements: 10.2_

  - [~] 9.3 Write property test for NotesRecord round-trip
    - Reuse the `Chunk` arbitrary in `packages/core/src/test-support/arbitraries.ts`
    - **Property 11: NotesRecord round-trip through the migrated parser**
    - **Validates: Requirements 10.3**

  - [~] 9.4 Update the tech rule note
    - In `.kiro/steering/tech.md` (line 16), change the note "parseNotesRecord is hand-checked and tested; migrate to Zod in spec 3" to say it was migrated to Zod
    - _Requirements: 10.5_

- [~] 10. Final checkpoint - Ensure all tests pass
  - Run `pnpm test`, `pnpm lint` and `pnpm typecheck`. Ensure all pass, ask the user if questions arise.

## Notes

- All tasks are required, including every unit test and property test. No task is optional.
- Phase 1 only. Provider, cassette, budget, pipeline, evaluation, the other four lock types, conflict check, sufficiency, final-door reservation and release flags (P2 to P6) are out of scope.
- No task reads or references `eval/holdout/`, and none edits `eval/adversarial/fixtures.json`.
- Each task references specific requirements for traceability. Property tests validate universal correctness properties; unit tests cover fixed examples and fixtures.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2", "1.5"] },
    { "id": 2, "tasks": ["1.3", "1.4", "1.6", "1.11"] },
    { "id": 3, "tasks": ["1.7", "1.8", "1.12"] },
    { "id": 4, "tasks": ["1.9", "1.10"] },
    { "id": 5, "tasks": ["2"] },
    { "id": 6, "tasks": ["3.1"] },
    { "id": 7, "tasks": ["3.14", "3.2", "3.4", "3.7", "3.9"] },
    { "id": 8, "tasks": ["3.3", "3.5", "3.6", "3.8", "3.10", "3.11", "3.12"] },
    { "id": 9, "tasks": ["3.13"] },
    { "id": 10, "tasks": ["4"] },
    { "id": 11, "tasks": ["5.1"] },
    { "id": 12, "tasks": ["5.2", "5.3", "6.1"] },
    { "id": 13, "tasks": ["6.2", "6.3"] },
    { "id": 14, "tasks": ["7"] },
    { "id": 15, "tasks": ["8.1", "8.2"] },
    { "id": 16, "tasks": ["9.1"] },
    { "id": 17, "tasks": ["9.2", "9.3", "9.4"] },
    { "id": 18, "tasks": ["10"] }
  ]
}
```
