# Implementation Plan: Generation and Evaluation (Phase 1, Gate 1; Phase 5 appended)

## Overview

This plan covers Phase 1, Phase 2 and Phase 3. Phase 1 is complete and shipped (tasks 1–10, all checked); its tasks are kept unchanged below for history. Phase 2 (Provider interface, cassettes, the interim Budget_Ledger) and Phase 3 (the rune-cipher/séance-board pipeline, room assembly, publish, and the Worker's minimal job API) are now planned as tasks 11 onward. Phase 5 (live generation, checks and room assembly for bone-ordering, bound-threads, cursed-object and combination-dial) is planned as tasks 28 to 40 and is not started. Phases 4 and 6 are still not planned here.

Phase 1 order: schemas (authoring, manifest, hint type change, fixture builder) → checks → Manifest_Mapper → sample crypt → dataset acceptance → `parseNotesRecord` Zod migration.

Phase 2/3 order: Provider interface and Prompt_Digest → cassette store and mock ledger (test-support) → the narrowed boundary test → heading detection → the pipeline stages in pipeline order (prepare input → concept extraction → generation → blind review → room assembly/publish) → the cassette-driven end-to-end test → the Worker (OpenAI Provider, Interim_Ledger, job store, HTTP server, process entry point) → Worker integration tests.

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

- [x] 8. Dataset acceptance
  - [x] 8.1 Write the Phase 1 acceptance test
    - Create `phase1-acceptance.test.ts` that reads `eval/dev/questions/*.json`, `samples/questions/*.json` and `eval/adversarial/fixtures.json` at test time
    - Assert counts against named constants (56 questions: 26 rune cipher and 30 séance board; 10 `code:*` fixtures; 4 `review:*` fixtures), failing with a message that states expected and actual counts
    - Assert all 56 questions pass the blocking checks, each `code:*` fixture fails with exactly its expected Check_ID and no other blocking id, each `review:*` fixture passes, and the sample crypt passes the schema and `manifestCheck`
    - Do not edit `eval/adversarial/fixtures.json`
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.6, 9.7, 9.9_

  - [x] 8.2 Write the boundary and no-holdout tests
    - Create `boundary.test.ts` that scans Phase 1 module sources for `fetch`, `http`, `net`, provider, cassette, budget-ledger and AI SDK imports
    - Assert no Phase 1 test or source file references `eval/holdout`
    - _Requirements: 9.5, 9.8, 27.7_

- [x] 9. `parseNotesRecord` Zod migration
  - [x] 9.1 Reimplement `parseNotesRecord` with Zod
    - Keep the exported name and signature `(value: unknown) => Result<NotesRecord, { kind: 'invalid-record' }>`, with no thrown errors
    - The existing `notes-record.test.ts` must pass unchanged
    - _Requirements: 10.1, 10.4_

  - [x] 9.2 Write the differential migration test
    - Create `notes-record-migration.test.ts` with the pre-migration logic inlined as a private reference, and run a fixed edge-case corpus through both versions, asserting identical accept and reject verdicts
    - Delete the reference copy once the migration is accepted
    - _Requirements: 10.2_

  - [x] 9.3 Write property test for NotesRecord round-trip
    - Reuse the `Chunk` arbitrary in `packages/core/src/test-support/arbitraries.ts`
    - **Property 11: NotesRecord round-trip through the migrated parser**
    - **Validates: Requirements 10.3**

  - [x] 9.4 Update the tech rule note
    - In `.kiro/steering/tech.md` (line 16), change the note "parseNotesRecord is hand-checked and tested; migrate to Zod in spec 3" to say it was migrated to Zod
    - _Requirements: 10.5_

- [x] 10. Final checkpoint - Ensure all tests pass
  - Run `pnpm test`, `pnpm lint` and `pnpm typecheck`. Ensure all pass, ask the user if questions arise.

- [x] 11. Provider interface, Prompt_Digest and narrowed boundary test
  - [x] 11.1 Implement the Provider interface and types
    - Create `packages/core/src/provider/types.ts`: `ProviderStage`, `ProviderRequest`, `ProviderUsage`, `ProviderSuccess`, `ProviderErrorKind`, `ProviderFailure`, `ProviderResult`, `Provider`
    - No field is OpenAI-specific; `jsonSchema` is a plain JSON Schema object
    - _Requirements: 11.1, 11.2, 11.3, 11.7_

  - [x] 11.2 Implement the concurrency limiter
    - Create `packages/core/src/pipeline/concurrency.ts` with `runWithConcurrency(tasks, limit)`, default limit 4, no timers
    - _Requirements: 11.6_

  - [x] 11.3 Write unit tests for the Provider interface and concurrency limiter
    - A fake `Provider` never throws across every failure path
    - A cassette-backed provider run through `runWithConcurrency(..., 4)` never exceeds 4 simultaneous in-flight calls
    - _Requirements: 11.3, 11.6_

  - [x] 11.4 Implement Prompt_Digest
    - Create `packages/core/src/provider/prompt-digest.ts`: `promptDigest(request)` using `sha256`/`utf8ToBytes` from `digest.ts` over a canonical JSON string of `{ stage, promptVersion, modelId, system, messages, temperature, maxOutputTokens, jsonSchema }`, excluding `timeoutMs` and `retryLimit`
    - _Requirements: 12.1, 12.3_

  - [x] 11.5 Write property test for Prompt_Digest
    - **Property 18: Prompt_Digest is a canonical function of the semantic request**
    - **Validates: Requirements 12.1, 12.3**

  - [x] 11.6 Write unit test pinning a known request to a known digest
    - A regression anchor so a digest algorithm change is deliberate
    - _Requirements: 12.1_

  - [x] 11.7 Narrow the Phase 1 boundary test
    - In `packages/core/src/boundary.test.ts`, exempt paths under `core/src/provider/`, `core/src/cassette/`, `core/src/budget/` and `core/src/pipeline/` from the name-based `provider|providers|cassette|cassettes|budget-ledger|budget` ban, while keeping every other rule (no `fetch`/`http`/`net`/`ws`, no AI SDK specifier, no `eval/holdout` reference) applying to those folders too
    - Keep the full original ban verbatim for `authoring/`, `checks/`, `locks/`, `mapper/`, `runtime/`, `sample-crypt/`
    - Add an assertion that `packages/core` still imports no `openai`-shaped specifier anywhere, including inside the exempted folders
    - _Requirements: 9.8, 27.7_

  - [x] 11.8 Implement `toModelJsonSchema`
    - Create `packages/core/src/provider/model-json-schema.ts`: a pure `toModelJsonSchema(schema)` that wraps Zod 4's `z.toJSONSchema()` and returns the plain JSON Schema object used as `ProviderRequest.jsonSchema`
    - No new dependency and no SDK import in Core; the worker passes the result through as `response_format: { type: 'json_schema', json_schema: { name, strict: true, schema } }`
    - Model-facing schemas written later (concept extraction, generation, review) must be strict-compatible: every property required, `.nullable()` instead of `.optional()`, `additionalProperties: false` on every object (use `z.strictObject`)
    - _Requirements: 11.1, 11.2_

- [x] 12. Cassette store and mock Budget_Ledger (test-support)
  - [x] 12.1 Implement the cassette store
    - Create `packages/core/src/cassette/types.ts` (`CassetteEntry`, `CassetteFile`, `CassetteProviderErrorKind`) and `cassette/cassette-provider.ts` (`makeCassetteProvider`) that looks up `promptDigest(request)` and returns a typed `cassette-missing` failure on a miss
    - Create `cassette/staleness.ts` with `isCassetteStale(file, request)`
    - _Requirements: 12.2, 12.5_

  - [x] 12.2 Write unit tests for the cassette store
    - Hit and miss behaviour; `isCassetteStale` true/false examples
    - _Requirements: 12.2, 12.5_

  - [x] 12.3 Implement the Budget_Ledger interface and mock ledger
    - Create `packages/core/src/budget/types.ts` (`BudgetReservation`, `BudgetErrorKind`, `BudgetResult`, `BudgetLedger`)
    - Create `budget/mock-ledger.ts`: `makeMockLedger({ dailyCapUsd, refuseAfter? })` and `countingProvider(inner)` wrapper, none throwing
    - _Requirements: 12.6, 12.9, 28.1_

  - [x] 12.4 Write unit tests for the mock ledger
    - reserve/reconcile/release examples; `refuseAfter` fault injection; `ledger-unavailable` treated the same as `budget-exhausted` by a calling stage
    - _Requirements: 12.6, 12.9_

  - [x] 12.5 Write property test for budget reservation vs. calls
    - **Property 17: Provider calls never exceed budget reservations (G-P5)**
    - **Validates: Requirements 12.6, 12.7, 12.8**

  - [x] 12.6 Implement `assertRecordedOnly`
    - Create `packages/core/src/cassette/recorded-only.ts`: pure `assertRecordedOnly(entries)` returning a typed `synthetic-cassette-in-evaluation` error (with the offending digests) when any entry has `origin: 'synthetic'`, and `ok` otherwise; no throw
    - This is the seam the P4 results writer must call before it writes to `eval/results/` or counts any metric
    - _Requirements: 12.10, 21.3_

  - [x] 12.7 Write unit tests for `assertRecordedOnly`
    - A run mixing synthetic and recorded entries is rejected with `synthetic-cassette-in-evaluation`; an all-recorded run passes
    - _Requirements: 12.10_

  - [x] 12.8 Write a static test that nothing in P2/P3 writes to `eval/results/`
    - Create `packages/core/src/cassette/no-eval-results-writes.test.ts`: scan every source and test file under `packages/core/src` and `apps/worker/src` (except the scan itself) and fail if any mentions `eval/results`; the allowlist is empty here and P4 extends it deliberately with its results-writer path
    - The scan never reads `eval/holdout`
    - _Requirements: 12.10, 21.3_

- [x] 13. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 14. Heading detection and prepare-input
  - [x] 14.1 Implement `isHeadingOnlyChunk`
    - In `packages/core/src/chunker-split.ts`, export `isAllCapsHeading` with no behaviour change; the existing chunker tests and fixtures must stay green unchanged
    - Create `packages/core/src/chunker-heading.ts`: pure `isHeadingOnlyChunk(chunk)` = the chunk text is a single line AND `isAllCapsHeading(chunk.text)`; no second heuristic and no new field on `Chunk`, `NotesRecord` or any fixture
    - _Requirements: 13.1_

  - [x] 14.2 Write unit tests for `isHeadingOnlyChunk`
    - True for an all-caps single line within 80 characters; false for mixed-case "The human heart" (human-heart paragraph 1, so it stays quotable and a quote from it still fails `quote-too-short`), a short non-heading sentence, a line with terminal punctuation, a multi-line chunk (including a short heading merged into the next block by `mergeShort`) and a normal paragraph
    - _Requirements: 13.1_

  - [x] 14.3 Implement `prepareDocument`
    - Create `packages/core/src/pipeline/prepare-input.ts`: `PreparedDocument` with `quotableChunksByOrdinal` (code-assigned ordinal over quotable chunks only, 1-based), `ordinalByChunkId`, `chunks`, `headingContext`
    - Reject (typed) a chunk ID not present in `ordinalByChunkId`; translate a present one to its ordinal
    - Do not change `buildDocumentChunkMaps` in `manifest-mapper.ts`
    - _Requirements: 13.1, 13.3, 13.5_

  - [x] 14.4 Write unit tests for `prepareDocument`
    - Build from a small synthetic notes string with an all-caps heading line: the heading is absent from `quotableChunksByOrdinal` and present in `headingContext`; build from `samples/human-heart.txt`: "The human heart" is not in `headingContext` and its text stays quotable
    - _Requirements: 13.1, 13.3_

  - [x] 14.5 Write property test for chunk ID translation
    - **Property 20: Prepared documents reject chunk IDs code did not assign**
    - **Validates: Requirements 13.5**

  - [x] 14.6 Write the chunker agreement test
    - Create `packages/core/src/chunker-heading-agreement.test.ts`: for every chunk of every notes file under `eval/dev/` and every `samples/*.txt`, run `chunkDocument`; assert `isHeadingOnlyChunk(chunk)` is true exactly when `candidateSpans` over that chunk's paragraph or unit text emitted the chunk's exact text as a single-line span satisfying `isAllCapsHeading`
    - The test never reads `eval/holdout`
    - _Requirements: 13.1_

- [x] 15. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 16. Pipeline: concept extraction
  - [x] 16.1 Implement `extractConcepts`
    - Create `packages/core/src/pipeline/concept-extraction.ts`: one `Provider.complete` call per document, with the system prompt's data-delimiter line and the quotable-chunk list plus heading context in the user message
    - Validate the response with `ConceptExtractionResponseSchema`; retry once with the Zod error on failure, else fail the document
    - Make `ConceptExtractionResponseSchema` strict-compatible (every property required, `.nullable()` not `.optional()`, `z.strictObject`) and build `ProviderRequest.jsonSchema` with `toModelJsonSchema`
    - Reject any concept citing a chunk ID not in `ordinalByChunkId`
    - Drop quotes that `resolveQuote` cannot resolve uniquely; drop a concept with none left
    - Reserve budget via `BudgetLedger.reserve` before the call; return typed `budget-exhausted` on refusal
    - _Requirements: 13.2, 13.4, 13.5, 13.6, 13.7, 12.6_

  - [x] 16.2 Write unit tests for `extractConcepts`
    - A cassette-driven call against `samples/human-heart.txt` returning known concepts; the data-delimiter line present in the built prompt; one call per document; the 6,000-word cap reused; a chunk-ID-not-assigned rejection example
    - _Requirements: 13.1, 13.2, 13.3, 13.5, 13.6, 13.7_

  - [x] 16.3 Write property test for quote-dropping in concept extraction
    - **Property 19: Concept extraction keeps only uniquely-resolving quotes**
    - **Validates: Requirements 13.4**

- [x] 17. Pipeline: typed generation
  - [x] 17.1 Implement `generateForConcept`
    - Create `packages/core/src/pipeline/generation.ts`: `GenerationResponseSchema` with rune cipher and séance board arms mirroring `AuthoringQuestionSchema`'s arms minus `id`/`conceptId`/`role`
    - Make `GenerationResponseSchema` strict-compatible: any field the Authoring_Schema treats as optional (for example a rune hint) is `.nullable()` here and `null` values are dropped before the re-parse with `AuthoringQuestionSchema`; build `ProviderRequest.jsonSchema` with `toModelJsonSchema`
    - One call per concept; `primary: null` short-circuits to `Ok(null)`; attach `id`/`conceptId`/`role` after a successful parse and re-parse with the real `AuthoringQuestionSchema`
    - Defensively drop a proposed alternate that shares its primary's `lockType` (set to `null`, never replaced with a different type)
    - On a schema failure, retry once with the Zod error, else set the concept's question aside as `schema-rejected`
    - Reserve budget via `BudgetLedger.reserve` before each call
    - _Requirements: 14.1, 14.2, 14.3, 14.4, 14.5, 14.6, 14.7, 14.8, 14.9, 14.10, 12.6_

  - [x] 17.2 Write unit test asserting generated questions always parse as AuthoringQuestion
    - For both lock-type arms, attaching `id`/`conceptId`/`role` to a parsed `GenerationResponse` arm and re-parsing with `AuthoringQuestionSchema` always succeeds
    - _Requirements: 14.1_

  - [x] 17.3 Write unit tests for `generateForConcept`
    - `null` primary short-circuit; schema-failure-then-retry-then-set-aside; an alternate sharing its primary's Lock_Type dropped to `null`; the "generated only when" rule text present in the built prompt; no executable-expression field exists
    - _Requirements: 14.2, 14.3, 14.4, 14.5, 14.6, 14.7, 14.8, 14.9, 14.10_

- [x] 18. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 19. Pipeline: blind review
  - [x] 19.1 Implement `blindReview`
    - Create `packages/core/src/pipeline/blind-review.ts`: `ReviewResponseSchema` (strict-compatible: `optionLabels` is `.nullable()`, `null` for rune cipher, and `jsonSchema` comes from `toModelJsonSchema`); builds a request with temperature `0`, the question text, options/steps in manifest order, and the full text of every cited chunk from `doc.chunks`; never the key, a label or the explanation
    - Run `runChecks` first and skip the reviewer call entirely for a question with a blocking failure
    - Rejection rule: `answer` disagrees with the key, or any `optionLabels` entry is `unknown`
    - Retry once on a schema failure, else reject on the second failure
    - Reserve budget via `BudgetLedger.reserve` before the call
    - _Requirements: 15.1, 15.2, 15.3, 15.4, 15.5, 15.6, 15.8, 15.10, 15.11, 12.6_

  - [x] 19.2 Add the "Blind model review passed" and "Source excerpt matched" label usage
    - Add `REVIEW_PASSED_LABEL = 'Blind model review passed'` beside the existing `excerptMatched` constant in `copy.ts` or `copy-room-play.ts`; assert it contains no banned phrase in `copy-banned-words.test.ts`
    - _Requirements: 15.7, 15.9, 31.4_

  - [x] 19.3 Write unit tests for `blindReview`
    - The rune and séance `review:*` adversarial fixtures via cassette, each asserted `rejected`; one `passed` example; the temperature-0 request assertion; the retry-then-reject-on-second-failure example; label-mismatch and incomplete-labels examples; a blocking-Code_Check question never reaching the reviewer call
    - _Requirements: 15.1, 15.2, 15.3, 15.4, 15.5, 15.6, 15.8, 15.11, 24.1, 24.2_

  - [x] 19.4 Write the strict-compatibility test for model-facing schemas
    - Create `packages/core/src/provider/model-json-schema.test.ts`: for each model-facing schema (concept extraction, generation, review), walk the `z.toJSONSchema()` output and assert every object has `additionalProperties: false` and a `required` array equal to all of its property keys, with no optional property anywhere
    - _Requirements: 11.1, 11.2_

- [x] 20. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 21. Pipeline: room assembly, publish and orchestrator
  - [x] 21.1 Implement room assembly
    - Create `packages/core/src/pipeline/room-assembly.ts`: build at most one lock slot per Lock_Type (rune cipher, séance board) from accepted primaries/alternates; the first accepted question per Lock_Type in extraction order takes the room slot, and every other accepted concept goes to `unplacedAccepted` (`{ conceptId, conceptTitle, question, content }`), validated with the same schemas and kept out of `manifest.rooms` and `manifest.finalDoor`
    - Run `leakScanRoom` over tentative slots plus alternates; on failure, swap in a leak-free accepted alternate, else drop the concept; re-run until clean or no slots remain
    - Final door is always `[]` in Phase 3
    - Return a typed `empty-room` result when no slots remain; never publish that case
    - _Requirements: 16.1, 16.2, 16.5, 16.6, 19.3, 19.5, 31.6_

  - [x] 21.2 Write unit tests for room assembly
    - An end-to-end 2-slot assembly example; a leak-injected swap-then-drop-then-rescan example; an all-concepts-set-aside `empty-room` example; an empty-final-door manifest still accepted by `validateManifestForPublish`; an unplaced accepted concept appears in `unplacedAccepted` and not in `manifest.rooms` or `manifest.finalDoor`
    - _Requirements: 16.1, 16.2, 16.5, 16.6, 31.6_

  - [x] 21.3 Write property test for pipeline-assembled room leak scanning
    - **Property 16: Pipeline-assembled rooms have no cross-concept rune leak unless injected (G-P3, extended)**
    - **Validates: Requirements 16.2, 24.4**

  - [x] 21.4 Implement `runRoomPipeline` and the run metadata
    - Create `packages/core/src/pipeline/orchestrator.ts`: wires prepare-input, concept extraction, generation, Code_Checks, blind review and room assembly together with `runWithConcurrency`; maps accepted questions through `mapAuthoringQuestionToSpec` (unchanged) into `{ manifest, content }`; gates publish through `validateManifestForPublish` (unchanged)
    - Build `PipelineRunMetadata`: provider, model ID, every call's Prompt_Digest, temperature, `CHECK_VERSION`, per-stage timings, token counts, cost, and the counts of candidates/schema-rejected/Code_Check rejections by Check_ID/review rejections/accepted/discarded; return `unplacedAccepted` beside `manifest` and `content`
    - Never include notes text, prompt text, model responses or credentials in `PipelineRunMetadata` or in any thrown value (there are none; every path returns a typed `Result`)
    - Export `runRoomPipeline`, `toModelJsonSchema`, `assertRecordedOnly`, the `Provider`/`BudgetLedger` types, and cassette/mock test-support types from `packages/core/src/index.ts`
    - _Requirements: 16.3, 16.4, 21.3, 31.1, 31.2, 31.3, 31.5, 31.6, 25.1, 25.2, 25.3, 25.4, 25.8_

  - [x] 21.5 Write property test for pipeline quote resolution
    - **Property 15: Pipeline-accepted questions resolve uniquely (G-P1, extended)**
    - **Validates: Requirements 13.4, 24.3**

  - [x] 21.6 Author the synthetic end-to-end cassette fixture
    - Create `packages/core/src/test-support/cassettes/human-heart-e2e.json` from `samples/human-heart.txt` and `samples/questions/human-heart.json` only, every entry marked `"origin": "synthetic"`
    - Write a test asserting every entry's `digest` equals `promptDigest` recomputed from a request built the way the pipeline actually builds it for that stage
    - _Requirements: none beyond the cassette mechanism itself (test-support for Requirement 12 and the end-to-end test below)_

  - [x] 21.7 Write the cassette-driven end-to-end pipeline test
    - `runRoomPipeline` over `samples/human-heart.txt` with `makeCassetteProvider(humanHeartE2eCassettes)` and `makeMockLedger`; assert one published room with the expected rune/séance slot, non-empty `CryptContent`, a `PipelineRunMetadata` whose `promptDigests.length` equals the number of cassette hits and that carries no notes text, any extra accepted concept in `unplacedAccepted` and not in the manifest, and `assertRecordedOnly` over the cassette's entries returning `synthetic-cassette-in-evaluation` (this test must not write to `eval/results/`)
    - _Requirements: 16.3, 21.3, 25.8, 31.6, 12.10_

- [x] 22. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 23. Worker: OpenAI Provider and Interim_Ledger
  - [x] 23.1 Set up `apps/worker` dependencies
    - Add `openai` to `apps/worker/package.json`; no other new dependency (JSON Schema comes from Core's `toModelJsonSchema`, built on Zod 4's `z.toJSONSchema()`)
    - _Requirements: 11.4_

  - [x] 23.2 Implement the OpenAI Provider
    - Create `apps/worker/src/provider/openai-provider.ts`: `makeOpenAiProvider(config)` implementing Core's `Provider`; reads `OPENAI_API_KEY` once at construction; uses `response_format: { type: 'json_schema', json_schema: { name: <stage>, strict: true, schema: request.jsonSchema } }`, passing the Core-built schema through unchanged
    - Wrap the SDK call in `try`/`catch`; map timeout/rate-limit/other errors to `ProviderErrorKind`; log only stage, model ID, elapsed ms and token counts, never the request or response body
    - _Requirements: 11.1, 11.3, 11.4, 11.5, 11.7, 25.8_

  - [x] 23.3 Write unit tests for the OpenAI Provider
    - Against a mocked SDK/`fetch` client (no real provider call): the `response_format` request shape; SDK-error-to-`ProviderErrorKind` mapping; nothing logged beyond stage/model/elapsed/tokens
    - _Requirements: 11.3, 11.7, 25.8_

  - [x] 23.4 Implement the Interim_Ledger
    - Create `apps/worker/src/budget/interim-ledger.ts`: `makeInterimLedger(config)` implementing `BudgetLedger`; in-memory daily cap from `DAILY_BUDGET_USD`; worst-case cost from input/output token estimates and prices; reconcile moves reserved to spent; release returns the reservation; UTC day rollover resets totals; missing/non-positive `DAILY_BUDGET_USD` makes Jobs refuse to start
    - _Requirements: 28.1, 28.2, 28.3, 28.4, 28.5, 28.6, 28.7, 28.9_

  - [x] 23.5 Write unit tests for the Interim_Ledger
    - Cap enforcement; reconcile/release arithmetic; day rollover; missing-env refusal
    - _Requirements: 28.2, 28.3, 28.4, 28.5, 28.6, 28.7, 28.9_

  - [x] 23.6 Write the worker-local boundary test
    - Create `apps/worker/src/boundary.test.ts` confirming `apps/worker` is the only package whose source imports an `openai`-shaped specifier, and that `packages/core` imports none
    - _Requirements: 9.8, 27.7_

- [x] 24. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 25. Worker: job store, HTTP server and process entry point
  - [x] 25.1 Implement the Job_Store
    - Create `apps/worker/src/jobs/job-store.ts`: `Job` (with `sessionHash`, the sha-256 of the token; the raw token is never stored), `Tombstone` (`{ jobId, sessionHash, idempotencyKeyHash, requestDigest, status: 'expired', expiredAt }`, no content), `JobStatus`, `JobFailureKind`, `JobStore` with `create` (new/replay/replay-expired/conflict, looked up by `(sessionHash, sha-256(idempotencyKey))` over live Jobs and unswept Tombstones; a different digest is a conflict for a Job or a Tombstone; a different session never matches), `get` (returns `null` identically for a missing ID, a wrong session and a swept tombstone), `setStatus`, `sweepExpired` (after 30 minutes deletes notes text, result and the raw idempotency key and writes the Tombstone with the key hash and request digest; after 24 hours deletes the Tombstone, which forgets the key)
    - Add `MAX_RUN_MS` (10 minutes): `sweepExpired` fails a job still queued or running that long after `createdAt` with `generation-failed`, starting its terminal time then. Add `MAX_ACTIVE_JOBS_PER_SESSION = 1` and `MAX_LIVE_JOBS = 20` (non-tombstoned jobs of any status): after the replay, replay-expired and conflict checks, `create` returns `{ kind: 'session-busy' }` or `{ kind: 'capacity' }`. The store makes no reservation and no Provider call, so the HTTP layer (25.3) must call `create` first
    - _Requirements: 29.3, 29.4, 29.5, 29.10, 29.11, 29.13, 29.15, 29.16, 29.17_

  - [x] 25.2 Write unit tests for the Job_Store
    - Create/replay/conflict; `get` returning `null` identically for wrong session and missing ID; only the token hash is stored; expired + right session reads as `expired`; expired + wrong session reads the same as missing; the Tombstone holds no content; after the 24-hour Tombstone sweep the read is the same as missing
    - Idempotency after expiry: a repeated create after the Job_TTL with the same session, key and digest returns the expired job (`{ jobId, status: 'expired' }`), with zero budget reservations and zero Provider calls (counted with the mock ledger and a counting provider); after the Tombstone sweep the same create starts a new job; the same key with a different digest after the Job_TTL gives a conflict; a different session with the same key starts its own job (keys are bound to the session); the Tombstone holds only the key hash, never the raw key
    - Max run time fails a stuck job (and a late pipeline result does not overwrite it); session-busy; capacity; replay still answered when busy
    - _Requirements: 29.3, 29.4, 29.5, 29.10, 29.11, 29.13, 29.15, 29.16, 29.17_

  - [x] 25.3 Implement the HTTP server
    - Create `apps/worker/src/http/server.ts`: `POST /jobs` (Zod-validated body, a required well-formed `X-Session-Token` header with a typed error for a missing or malformed one, idempotency key handling including `{ jobId, status: 'expired' }` for a replay-expired result before any reservation or Provider call, 202 response without awaiting the pipeline, background `runRoomPipeline` call wired to the real `Provider` and `Interim_Ledger`), `GET /jobs/:id` (session-bound by token hash; a wrong session answers exactly like a missing job; `{ status: 'expired' }` with the right session after the TTL), `GET /health` (no Job data), CORS restricted to `WEB_ORIGIN` that allows the `X-Session-Token` header and no credentials, `Cache-Control: private, no-store` on every Job-carrying response, no notes/prompt/response content logged
    - Call `create` before any reservation or Provider call, and answer `session-busy` and `capacity` with `429` and a typed body
    - _Requirements: 29.1, 29.2, 29.3, 29.6, 29.7, 29.8, 29.9, 29.10, 29.12, 29.13, 29.15, 29.17, 25.8, 25.9_

  - [x] 25.4 Write unit tests for the HTTP server
    - In-process request tests (no external network) covering the full `POST /jobs` → `GET /jobs/:id` happy path with the cassette provider and mock ledger; a missing or malformed `X-Session-Token` rejected with a typed error; a wrong session answered identically to a missing job (status, body, headers); `{ status: 'expired' }` with `Cache-Control: private, no-store` for the right session after the TTL; CORS allowing only `WEB_ORIGIN` and the `X-Session-Token` header with no `Access-Control-Allow-Credentials`; `Cache-Control: private, no-store` on Job-carrying responses; request-size/word-count rejection before any Provider call; the typed failure body for each `JobFailureKind`; a repeated `POST /jobs` after the TTL with the same session, key and digest answering `{ jobId, status: 'expired' }` with zero reservations and zero Provider calls
    - 429 for session-busy and capacity, with zero reservations and zero provider calls
    - _Requirements: 29.1, 29.2, 29.3, 29.6, 29.7, 29.8, 29.9, 29.10, 29.12, 29.13, 29.15, 29.17_

  - [x] 25.5 Implement the process entry point
    - Create/update `apps/worker/src/index.ts`: read `OPENAI_API_KEY`, `WEB_ORIGIN`, `OPENAI_MODEL`, `PRICE_INPUT_USD_PER_MTOK`, `PRICE_OUTPUT_USD_PER_MTOK`, `DAILY_BUDGET_USD`, `JOB_TTL_MINUTES` (default 30), `PORT` (default 8787); construct the real `Provider`, `Interim_Ledger` and `JobStore`; start the HTTP server; start the sweep timer running at least once a minute (it deletes expired Jobs, writes Tombstones and deletes Tombstones after the fixed 24-hour Tombstone_TTL, which is a constant and not an environment variable)
    - Exit non-zero on a missing `OPENAI_API_KEY`, `WEB_ORIGIN` or `OPENAI_MODEL`; refuse to start Jobs (not the process) on a missing/invalid `DAILY_BUDGET_USD` or price
    - _Requirements: 28.9, 28.10, 29.10, 29.11, 29.12_

  - [x] 25.6 Write a smoke test for the process entry point
    - Starting with all required env vars present succeeds and `GET /health` responds `ok`; starting without `DAILY_BUDGET_USD` still serves `/health` but `POST /jobs` returns `budget-exhausted`
    - _Requirements: 28.9, 29.12_

- [x] 26. Final checkpoint - Ensure all tests pass
  - Run `pnpm test`, `pnpm lint` and `pnpm typecheck` across `packages/core` and `apps/worker`. Ensure all pass, ask the user if questions arise.

- [x] 27. Worker: job cancellation (DELETE /jobs/:id)
  - [x] 27.1 Add `signal` support to `runRoomPipeline` and the `cancelled` error
    - In `packages/core/src/pipeline/orchestrator.ts`, add `signal?: AbortSignalLike` to `PipelineOptions`, where `AbortSignalLike` is a minimal structural type `{ readonly aborted: boolean }` declared in core (core's `lib` is `ES2022` with `types: []`, so it does not name the `AbortSignal` global; a real `AbortSignal` satisfies the type). Treat `signal.aborted` like `halt` before every reservation and Provider call, including extraction if it has not started. Never pass the signal to the Provider: calls in flight finish and `callWithBudget` reconciles or releases them
    - Add the `cancelled` kind (with metadata) to `PipelineJobError`; when the run ends after an abort, return it instead of a manifest and publish nothing. Add no exception path. Export the new type from `packages/core/src/index.ts`
    - _Requirements: 16.7, 12.6, 12.7_

  - [x] 27.2 Write core tests for cancellation
    - Example tests: abort before the run (zero reservations, zero calls, `cancelled`); abort while extraction is in flight (the call reconciles, no generation call starts); abort during generation and review (no new calls, in-flight calls counted); an unaborted signal leaves results unchanged
    - **Property 21: Cancellation never starts a call after abort and leaves no reservation outstanding.** Use a deferred scripted Provider and the mock ledger, abort at an arbitrary point, and assert: calls started after the abort equal 0; every reservation is reconciled or released; the result is `cancelled` and never a published manifest; nothing throws
    - **Validates: Requirements 16.7, 12.6, 12.7**

  - [x] 27.3 Implement cancellation in the Job_Store
    - In `apps/worker/src/jobs/job-store.ts`, add `cancelling` to `JobStatus`; add `requestCancel(jobId, sessionHash)` returning `not-found` (identical for missing, wrong session and swept), `expired` (unswept Tombstone, right session), `terminal` (with the current status, unchanged), or `cancelling` (for a queued, running or already `cancelling` Job, which marks the Job cancel-requested)
    - Count `cancelling` as active for `session-busy` and `MAX_LIVE_JOBS`. `sweepExpired` ends a Job stuck in `cancelling` after `MAX_RUN_MS` as `cancelled` with failure kind `cancelled`. A pipeline result that arrives for a cancel-requested Job is discarded: the Job ends `cancelled`, the bundle is never stored, and the Job_TTL clock starts then. `setStatus` still keeps the first terminal outcome
    - _Requirements: 29.18, 29.19, 29.20, 29.21, 29.22, 29.23_

  - [x] 27.4 Write unit tests for the Job_Store cancellation
    - `requestCancel` on queued, running, `cancelling`, each terminal status and an unswept Tombstone; identical `not-found` for a wrong session and a missing ID; session-busy while `cancelling`; the `MAX_RUN_MS` sweep ends a `cancelling` Job as `cancelled`; a late success is discarded and no bundle is stored; the first terminal outcome is kept
    - _Requirements: 29.18, 29.19, 29.20, 29.21, 29.22, 29.23_

  - [x] 27.5 Implement the `DELETE /jobs/:id` route
    - In `apps/worker/src/http/routes-jobs.ts`, add `DELETE /jobs/:id` using `requestCancel`: `202 { jobId, status: 'cancelling' }` for a queued, running or `cancelling` Job, `200 { jobId, status }` for a terminal Job, `200 { jobId, status: 'expired' }` for a Tombstone, the identical `404` used by `GET` for missing, wrong-session and swept, and the same `400` as `GET` for a missing or malformed `X-Session-Token`. Send `Cache-Control: private, no-store` on every response. Log `job-cancel-requested` and the final status, with no Job ID, token or content
    - In `apps/worker/src/http/job-runner.ts`, create one `AbortController` per Job, pass its `signal` to `runRoomPipeline`, abort it when the cancel is requested, and map a `cancelled` pipeline result and a discarded late success to a terminal `cancelled` Job through `mapFailure`
    - In `apps/worker/src/http/cors.ts`, change `ALLOWED_METHODS` to `GET, POST, DELETE, OPTIONS`
    - _Requirements: 29.18, 29.19, 29.20, 29.21, 29.24, 29.25, 29.26, 29.3, 29.9_

  - [x] 27.6 Write HTTP tests for cancellation
    - In-process on loopback: cancel while a deferred Provider call is in flight (the in-flight call reconciles, no further calls start, a final `GET` returns `cancelled` with failure kind `cancelled`, and the ledger's outstanding amount is 0)
    - The session is still busy while `cancelling` (a new `POST /jobs` gets the `session-busy` `429`, then succeeds after the Job ends); an identical `404` for a wrong session and a missing Job (status, body and headers except `Date`); the `400` for a bad token; the terminal and expired idempotent responses and a second `DELETE` on a `cancelling` Job; the preflight lists `DELETE`; `Cache-Control: private, no-store` on every response; captured logs carry no IDs, tokens or content
    - _Requirements: 29.18, 29.19, 29.20, 29.21, 29.22, 29.24, 29.25, 29.26_

  - [x] 27.7 Checkpoint - Ensure all tests pass
    - Run `pnpm test`, `pnpm lint` (including the structure check) and `pnpm typecheck` for `packages/core` and `apps/worker` only, not `apps/web`, and run the worker build (`pnpm --filter ./apps/worker build`). Ensure all pass, ask the user if questions arise.

- [x] 28. Phase 5 baseline: re-read the live checks package and record results
  - [x] 28.1 Re-read `packages/core/src/checks/` and confirm it is settled
    - First step, before anything else: run `git status --porcelain -- packages/core/src/checks/`. If it shows any uncommitted change (modified, staged or untracked), STOP at once, report it to the user and do nothing else (no other read, edit or command); the user will get the other chat's work committed and then restart this task
    - Only when that check is clean: re-read `.kiro/specs/generation-and-evaluation/requirements.md` (including the Check_ID list in 3.5 and `duplicate-answer-in-room` in 4a), `.kiro/steering/tech.md` and `.kiro/specs/generation-and-evaluation/design.md`, because another chat edited `requirements.md` and `tech.md`. Never overwrite, revert or reformat those edits, and do not edit those three files in Phase 5
    - Then re-read `registry.ts`, `types.ts`, `run-checks.ts`, `evidence.ts`, `alternate.ts`, `duplicate-answers.ts`, `leak-scan.ts`, `room-assembly-select.ts` (in `pipeline/`) and their neighbours, and run `git log` over `packages/core/src/checks/` to confirm the parallel change there is committed
    - If the work is still moving, stop and ask the user; do not edit under `packages/core` until it is settled. Note any difference between the current files and the design's Phase 5 snippets in `docs/build-log.md` (names and shapes only, no content)
    - _Requirements: 3.1, 3.5, 22.1, 22.2, 22.3, 22.4_

  - [x] 28.2 Record baseline test, lint and typecheck results
    - Run `pnpm test`, `pnpm lint` and `pnpm typecheck` for `packages/core` and `apps/worker`, plus the cassette end-to-end tests `e2e-pipeline.test.ts` and `e2e-cassette-digest.test.ts`, and write the pass/fail counts into `docs/build-log.md` as the Phase 5 baseline. Report failures that already exist as failures, not as Phase 5 regressions
    - CPU rule (checkpoint): run Vitest with `--maxWorkers=50%` (for example `pnpm exec vitest run --maxWorkers=50%`); run no Playwright suite in this task. Between checkpoints, run targeted tests only
    - _Requirements: 22.9_

  - [x] 28.3 Pin `allowedLockTypes` in the existing cassette end-to-end options
    - In the existing `HUMAN_HEART_E2E_OPTIONS`, set `allowedLockTypes` explicitly to `['rune-cipher', 'seance-board']` so the recorded prompts and their Prompt_Digests do not change if `DEFAULT_ALLOWED_LOCK_TYPES` widens later (task 39.6); re-run `e2e-pipeline.test.ts` and `e2e-cassette-digest.test.ts` and confirm they pass unchanged
    - Do not edit the cassette file or any digest
    - _Requirements: 12.1, 22.9_

- [x] 29. Phase 5: bone-ordering
  - [x] 29.1 Authoring schema and generation response arm
    - In `packages/core/src/authoring/schema.ts`, append `BoneOrderingAuthoringSchema` to the `AuthoringQuestionSchema` union: strict object, `steps` of 3 to 5 non-empty strings in answer order, `evidence`, optional `lock-first-bone` hint, no offset field
    - Add the matching arm to `GeneratedQuestionSchema` in `packages/core/src/pipeline/generation-schema.ts` (strict-compatible: every property required, `.nullable()` not `.optional()`) and the `steps` evidence-translation branch in `toAuthoringQuestion`
    - Extend `schema.test.ts` with the real `bone-ordering` dev and sample fixtures and `generation-schema.test.ts` with the shared "parses as AuthoringQuestion after id/role/conceptId attachment" test
    - _Requirements: 22.1, 14.1_

  - [x] 29.2 Code_Checks and registry entries
    - Create `packages/core/src/locks/bone-ordering-checks.ts` with `step-count`, `duplicate-steps` and `no-explicit-sequence-marker-in-quotes` (resolved quotes only); each returns `readonly CheckFailure[]` and never throws
    - Flip the `bone-ordering` `later(...)` registry entries to `implemented: true` without changing any Check_ID string, widen `isSupported` and `visibleTextOf` in `run-checks.ts` for this type (the `isSupported` and `later(...)` helpers change in step with this type's schema arm; a type-aware helper is fine), bump `CHECK_VERSION` once for this group, and update the registry test (these entries are now `implemented: true` and called by `runChecks`; a comment marks the flip as deliberate)
    - With the bump, update any result-file or cassette test that compares the version; if the cassette tests compare `checkVersion`, change only that field in cassette files (prompt digests and responses untouched)
    - _Requirements: 22.1, 3.2, 3.4, 3.6, 3.11, 3.14_

  - [x] 29.3 Generation prompt section
    - Add the `bone-ordering` entry to `LOCK_RULES` in `packages/core/src/pipeline/generation-prompt.ts`. Generated only when the notes state an explicit sequence (numbering or first/next/then/finally wording); never for a cycle or a process with no fixed start; `steps` lists the 3 to 5 items in the correct order
    - Extend `generation-prompt.test.ts` so the rule text is present when the type is allowed
    - _Requirements: 22.1, 14.5_

  - [x] 29.4 Blind-review rule
    - Add `bone-ordering` branches to `citedChunks` and `buildBlindReviewUserMessage` (`blind-review-prompt.ts`) and to `decideReview`/`hasCompleteLabels` (`blind-review.ts`); the reviewer sees the steps in manifest order and never the key, a label or the explanation. Rune cipher and séance board branches are unchanged
    - Extend `blind-review.test.ts` with the `bone-ordering` `review:*` adversarial fixtures via cassette, each `rejected` with the stated reason, and one `passed` example
    - _Requirements: 22.1, 15.1, 15.3, 15.4, 15.6_

  - [x] 29.5 Mapper to the judge payload
    - In `packages/core/src/locks/bone-ordering.ts`, add a pure, additive `mapBoneOrderingPayload` export producing `{ itemIds, keyOrder }` (one generated item ID per step, `keyOrder` in authoring order) and the `lock-first-bone` hint pinned to `keyOrder[0]`; leave the judge function and its types unchanged. If the file would pass ~300 lines, put the mapper in `locks/bone-ordering-mapper.ts` and re-export it
    - Add the `mapSpec` and `evidenceParagraphs` branches in `mapper/manifest-mapper.ts` (dispatch only), the content branch in `mapper/build-content.ts`, `BoneOrderingPayloadSchema` in `runtime/manifest-schema.ts` (`payloadSchemaFor`) and the `lock-first-bone` branch in `narrowHint` (`runtime/manifest-hints.ts`; `boneId` must be in `itemIds`)
    - Unit-test the `hh-q05` mapping and feed the payload plus the fixture's correct submission to the real judge, expecting `correct`
    - _Requirements: 22.1, 8.2, 8.4, 22.8_

  - [x] 29.6 Add `bone-ordering` to the test and eval allow-lists only
    - Create `packages/core/src/test-support/phase5-lock-types.ts` exporting `PHASE5_TEST_ALLOWED_LOCK_TYPES` (`['rune-cipher', 'seance-board', 'bone-ordering']`), and pass it as `allowedLockTypes` in the `bone-ordering` cassette test (task 29.8) and any other Phase 5 test that needs the type allowed
    - In `apps/worker/src/config.ts`, add `EVAL_ALLOWED_LOCK_TYPES` (the two current types plus `'bone-ordering'`) and make `apps/worker/src/evaluation/cli.ts` use it for `allowedLockTypes` instead of `ALLOWED_LOCK_TYPES`. Add any worker test that needs the type allowed through its own explicit options, not through `ALLOWED_LOCK_TYPES`
    - Do NOT change `DEFAULT_ALLOWED_LOCK_TYPES` in `generation-prompt.ts` or `ALLOWED_LOCK_TYPES` in `apps/worker/src/config.ts` (the one `start.ts` gives the worker for learner notes). Add assertions to `generation-prompt.test.ts` and the worker config test that both still equal `['rune-cipher', 'seance-board']`, and a test that `EVAL_ALLOWED_LOCK_TYPES` includes `bone-ordering`. Task 39.6 is the only task that widens the learner allow-list
    - _Requirements: 22.1, 14.9_

  - [x] 29.7 Write property tests for bone-ordering
    - **Property 22: Count checks reject out-of-range counts and accept in-range counts** (`step-count`, 3 to 5)
    - **Validates: Requirements 22.1**
    - **Property 28: The Manifest_Schema validates every six-Lock_Type payload and hint shape, and rejects every mismatch** (bone-ordering part: `keyOrder` is a permutation of `itemIds`; `lock-first-bone` names an existing item)
    - **Validates: Requirements 22.8**
    - Mapper property: for any generated `steps` list, `keyOrder` maps back to the same step order and the mapped payload is accepted by `CryptManifestSchema`
    - **Property 29: Every Dev_Set and Sample_Set question of the four new types passes Code_Checks, and every `code:*` adversarial fixture of those types fails with exactly its expected Check_ID** (bone-ordering part: read `eval/dev/questions/*.json`, `samples/questions/*.json` and `eval/adversarial/fixtures.json` at test time, filter by `lockType`; never `eval/holdout`)
    - **Validates: Requirements 22.9**
    - Example test (one line, in the duplicate-answer suite): `bone-ordering` contributes no duplicate-answer key, because its answer is a structure and two equal structures across concepts are not a learner-facing duplicate

  - [x] 29.8 Write the cassette test for bone-ordering
    - Add a cassette fixture under `packages/core/src/test-support/cassettes/` that drives `runRoomPipeline` (cassette provider and mock ledger, no real provider) with a `bone-ordering` primary; assert it is generated, passes Code_Checks and blind review, maps, and the manifest passes `validateManifestForPublish`; assert each entry's `digest` equals `promptDigest` of a pipeline-built request
    - Mark entries `origin: 'synthetic'` unless recorded; never write to `eval/results/`
    - _Requirements: 22.1, 12.2, 16.3_

- [x] 30. Checkpoint - bone-ordering group
  - Ensure all tests pass, ask the user if questions arise.
  - CPU rule: run the full core and worker suites with `--maxWorkers=50%`; no e2e here

- [x] 31. Phase 5: bound-threads
  - [x] 31.1 Authoring schema and generation response arm
    - Append `BoundThreadsAuthoringSchema` to `AuthoringQuestionSchema` (strict object, `pairs` of 3 to 4 `{ left, right }` entries, `evidence`, optional `tie-thread` hint, no offset field), the matching strict-compatible arm to `GeneratedQuestionSchema`, and the `pairs` branch in `toAuthoringQuestion`
    - Extend `schema.test.ts` with the real `bound-threads` dev and sample fixtures (for example `hh-q07`) and `generation-schema.test.ts` with the shared re-parse test
    - _Requirements: 22.2, 14.1_

  - [x] 31.2 Code_Checks and registry entries
    - Create `packages/core/src/locks/bound-threads-checks.ts` with `pair-count` and `not-one-to-one` (a repeated left or right text, after case and whitespace normalisation, fails); each returns `readonly CheckFailure[]` and never throws
    - Flip the `bound-threads` registry entries to `implemented: true`, widen `isSupported` and `visibleTextOf` for this type (the `isSupported` and `later(...)` helpers change in step with this type's schema arm), bump `CHECK_VERSION` once for this group, and update the registry test
    - With the bump, update any result-file or cassette test that compares the version; if the cassette tests compare `checkVersion`, change only that field in cassette files (prompt digests and responses untouched)
    - _Requirements: 22.2, 3.2, 3.4, 3.6, 3.11, 3.14_

  - [x] 31.3 Generation prompt section
    - Add the `bound-threads` entry to `LOCK_RULES`. Generated only when the notes state explicit pairings that are strictly one-to-one with no shared left or right item; never infer a pairing the notes do not state
    - Extend `generation-prompt.test.ts` so the rule text is present when the type is allowed
    - _Requirements: 22.2, 14.5_

  - [x] 31.4 Blind-review rule
    - Add `bound-threads` branches to `citedChunks`, `buildBlindReviewUserMessage`, `decideReview` and `hasCompleteLabels`; the reviewer sees both columns in manifest order, never the key pairs, a label or the explanation
    - Extend `blind-review.test.ts` with the `bound-threads` `review:*` adversarial fixtures via cassette and one `passed` example
    - _Requirements: 22.2, 15.1, 15.3, 15.4, 15.6_

  - [x] 31.5 Mapper to the judge payload
    - In `packages/core/src/locks/bound-threads.ts`, add a pure, additive `mapBoundThreadsPayload` export producing `{ leftIds, rightIds, keyPairs }` (`keyPairs` in authoring order) and the `tie-thread` hint choosing one pair from `keyPairs` in code; leave the judge unchanged (or use `locks/bound-threads-mapper.ts` if the file would pass ~300 lines)
    - Add the `mapSpec`/`evidenceParagraphs` branches, the `build-content.ts` branch, `BoundThreadsPayloadSchema` and the `tie-thread` branch in `narrowHint` (the pair must be one of `keyPairs`, compared as an unordered membership check)
    - Unit-test the `hh-q07` mapping and feed the payload plus the fixture's correct submission to the real judge, expecting `correct`
    - _Requirements: 22.2, 8.2, 8.4, 22.8_

  - [x] 31.6 Add `bound-threads` to the test and eval allow-lists only
    - Add `'bound-threads'` to `PHASE5_TEST_ALLOWED_LOCK_TYPES` (`test-support/phase5-lock-types.ts`) and to `EVAL_ALLOWED_LOCK_TYPES` (`apps/worker/src/config.ts`); use the former in the `bound-threads` cassette test (task 31.8)
    - Do NOT change `DEFAULT_ALLOWED_LOCK_TYPES` or `ALLOWED_LOCK_TYPES`; the assertions from task 29.6 that both still equal `['rune-cipher', 'seance-board']` must keep passing, and the eval test asserts `bound-threads` is in `EVAL_ALLOWED_LOCK_TYPES`
    - _Requirements: 22.2, 14.9_

  - [x] 31.7 Write property tests for bound-threads
    - **Property 22: Count checks reject out-of-range counts and accept in-range counts** (`pair-count`, 3 to 4)
    - **Validates: Requirements 22.2**
    - **Property 26: Bound threads are rejected unless every left and every right item is distinct**
    - **Validates: Requirements 22.2**
    - **Property 28: The Manifest_Schema validates every six-Lock_Type payload and hint shape, and rejects every mismatch** (bound-threads part: `tie-thread` names a pair in `keyPairs`)
    - **Validates: Requirements 22.8**
    - Mapper property: for any generated `pairs` list, `keyPairs` preserves every left/right pairing and authoring order, and the mapped payload is accepted by `CryptManifestSchema`
    - **Property 29: Every Dev_Set and Sample_Set question of the four new types passes Code_Checks, and every `code:*` adversarial fixture of those types fails with exactly its expected Check_ID** (bound-threads part; reads only `eval/dev`, `samples` and `eval/adversarial`, never `eval/holdout`)
    - **Validates: Requirements 22.9**
    - Example test (one line, in the duplicate-answer suite): `bound-threads` contributes no duplicate-answer key, because its answer is a structure and two equal structures across concepts are not a learner-facing duplicate

  - [x] 31.8 Write the cassette test for bound-threads
    - Add a cassette fixture driving `runRoomPipeline` (cassette provider and mock ledger only) with a `bound-threads` primary; assert generation, Code_Checks, blind review, mapping and `validateManifestForPublish`; assert each entry's `digest` against `promptDigest`
    - _Requirements: 22.2, 12.2, 16.3_

  - [x] 31.9 Add `--allowed-lock-types` flag to the eval CLI
    - In `apps/worker/src/evaluation/cli.ts`, parse a comma-separated `--allowed-lock-types` list validated against the six Lock_Types; an invalid value is a typed error and a non-zero exit, never a thrown raw string. Default to `EVAL_ALLOWED_LOCK_TYPES` when the flag is absent; the flag applies to both `record` and `replay`
    - Add unit tests in the CLI tests (valid list, invalid value, default, both subcommands); no real provider call
    - _Requirements: 22.1, 14.9_

  - [x] 31.10 Reject an authored bone-ordering `hint.boneId` that disagrees with `keyOrder[0]`
    - In the mapper (`mapBoneOrderingPayload` in `locks/bone-ordering.ts` or `locks/bone-ordering-mapper.ts`, and the dispatch in `mapper/manifest-mapper.ts`), return a typed mapper error, as rune cipher does, when an authored `hint.boneId` disagrees with the derived `keyOrder[0]`-pinned hint. Add tests: a hand-written sample with a disagreeing hint is rejected; an agreeing or absent hint is accepted; the 11 existing bone-ordering questions still map
    - _Requirements: 22.1, 8.4_

- [x] 32. Checkpoint - bound-threads group
  - Ensure all tests pass, ask the user if questions arise.
  - CPU rule: run the full core and worker suites with `--maxWorkers=50%`; no e2e here

- [x] 33. Phase 5: cursed-object
  - [x] 33.1 Authoring schema and generation response arm
    - Append `CursedObjectAuthoringSchema` to `AuthoringQuestionSchema` (strict object, `items` of exactly 4, an answer naming the odd item, a `categoryRule`, `evidence`, no offset field), the matching strict-compatible arm to `GeneratedQuestionSchema`, and the `items` branch in `toAuthoringQuestion`
    - Extend `schema.test.ts` with the real `cursed-object` dev and sample fixtures (for example `hh-q09`) and `generation-schema.test.ts` with the shared re-parse test
    - _Requirements: 22.3, 14.1_

  - [x] 33.2 Write the `adv-20` fixture-literal test, then implement the cursed-object Code_Checks
    - First, before any check code: create `packages/core/src/locks/cursed-object-checks.test.ts` with fixture-literal unit tests for `needs-category-and-outside-quotes` using hand-written cursed-object questions (category quote missing fails, odd item not explicitly outside fails, a passing question passes), plus a test that `adv-20` read from `eval/adversarial/fixtures.json` at test time (file not edited) passes all cursed-object code checks. `adv-20` stays a review fixture: its expectedCatch is `review:odd-item-not-explicitly-outside`, a blind-review reason, so it is rejected only at blind review in task 33.5. Run the tests against a stub and see the hand-written failing cases fail first
    - Then create `packages/core/src/locks/cursed-object-checks.ts` with `item-count` (exactly 4), `answer-not-an-item`, `missing-category-rule` and `needs-category-and-outside-quotes`, and tighten the `needs-category-and-outside-quotes` heuristic until the hand-written cases pass with no false positives on every real cursed-object dev and sample question (the design flags this check as a conservative heuristic). Each function returns `readonly CheckFailure[]` and never throws
    - Do not touch the registry, `run-checks.ts` or `CHECK_VERSION` in this task: the check is not trusted until task 33.3
    - _Requirements: 22.3, 4.9, 3.2, 3.4, 3.6_

  - [x] 33.3 Flip the cursed-object registry entries (only after the `adv-20` test passes)
    - Precondition: the fixture-literal tests from task 33.2 pass. If it does not, stop and do not flip anything
    - Flip the `cursed-object` registry entries to `implemented: true` without changing any Check_ID string, widen `isSupported` and `visibleTextOf` in `run-checks.ts` (the `isSupported` and `later(...)` helpers change in step with this type's schema arm), bump `CHECK_VERSION` once for this group, and update the registry test (a comment marks the flip as deliberate)
    - With the bump, update any result-file or cassette test that compares the version; if the cassette tests compare `checkVersion`, change only that field in cassette files (prompt digests and responses untouched)
    - Confirm the "which one is not" exemption in `negative-question` now applies to a real cursed-object prompt
    - _Requirements: 22.3, 4.9, 3.2, 3.4, 3.6, 3.11, 3.14_

  - [x] 33.4 Generation prompt section
    - Add the `cursed-object` entry to `LOCK_RULES`. Generated only when the notes give an explicit category and exactly one item outside it, with the exclusion supported by the quoted evidence; never infer the odd item from outside knowledge
    - Extend `generation-prompt.test.ts` so the rule text is present when the type is allowed
    - _Requirements: 22.3, 14.5_

  - [x] 33.5 Blind-review rule
    - Add `cursed-object` branches to `citedChunks`, `buildBlindReviewUserMessage`, `decideReview` and `hasCompleteLabels`; the reviewer sees the four items in manifest order and the category rule only as the question states it, never the odd-item key, a label or the explanation
    - Extend `blind-review.test.ts` with the `cursed-object` `review:*` adversarial fixtures via cassette (including the `adv-20` case where relevant) and one `passed` example
    - _Requirements: 22.3, 15.1, 15.3, 15.4, 15.6_

  - [x] 33.6 Mapper to the judge payload
    - In `packages/core/src/locks/cursed-object.ts`, add a pure, additive `mapCursedObjectPayload` export producing `{ optionIds, oddOneOutId }` (option order preserved) and the hint that removes one non-odd item, chosen in code; leave the judge unchanged (or use `locks/cursed-object-mapper.ts` if the file would pass ~300 lines)
    - Add the `mapSpec`/`evidenceParagraphs` branches, the `build-content.ts` branch, `CursedObjectPayloadSchema` and the `narrowHint` branch (the removed item must be in `optionIds` and not the odd one)
    - Unit-test the `hh-q09` mapping and feed the payload plus the fixture's correct submission to the real judge, expecting `correct`
    - _Requirements: 22.3, 8.2, 8.4, 22.8_

  - [x] 33.7 Add `cursed-object` to the test and eval allow-lists only
    - Add `'cursed-object'` to `PHASE5_TEST_ALLOWED_LOCK_TYPES` and `EVAL_ALLOWED_LOCK_TYPES`; use the former in the `cursed-object` cassette test (task 33.9)
    - Do NOT change `DEFAULT_ALLOWED_LOCK_TYPES` or `ALLOWED_LOCK_TYPES`; the assertions from task 29.6 must keep passing
    - _Requirements: 22.3, 14.9_

  - [x] 33.8 Write property tests for cursed-object
    - **Property 22: Count checks reject out-of-range counts and accept in-range counts** (`item-count`, exactly 4)
    - **Validates: Requirements 22.3**
    - **Property 28: The Manifest_Schema validates every six-Lock_Type payload and hint shape, and rejects every mismatch** (cursed-object part: `oddOneOutId` is in `optionIds`; the removed-item hint never names it)
    - **Validates: Requirements 22.8**
    - Mapper property: for any generated `items` list, `optionIds` preserves item order, `oddOneOutId` maps to the named item, and the mapped payload is accepted by `CryptManifestSchema`
    - **Property 29: Every Dev_Set and Sample_Set question of the four new types passes Code_Checks, and every `code:*` adversarial fixture of those types fails with exactly its expected Check_ID** (cursed-object part; reads only `eval/dev`, `samples` and `eval/adversarial`, never `eval/holdout`)
    - **Validates: Requirements 22.9**

  - [x] 33.9 Write the cassette test for cursed-object
    - Add a cassette fixture driving `runRoomPipeline` (cassette provider and mock ledger only) with a `cursed-object` primary; assert generation, Code_Checks, blind review, mapping and `validateManifestForPublish`; assert each entry's `digest` against `promptDigest`
    - _Requirements: 22.3, 12.2, 16.3_

  - [x] 33.10 Extend the duplicate-answer keys for cursed-object
    - Extend `answerKeysOfAuthoring` and `answerKeysOf` in `packages/core/src/checks/duplicate-answers.ts` so a `cursed-object` question contributes one key: the cursed item's text, normalised the same way rune answers are
    - Add ONE property test for this type to the duplicate suite (`packages/core/src/checks/duplicate-answers.test.ts` or a sibling file): for any two `cursed-object` questions in different concepts whose cursed items are equal after normalisation, `duplicate-answer-in-room` is reported, and for any two whose normalised items differ it is not
    - _Requirements: 22.3, 4.9_

- [x] 34. Checkpoint - cursed-object group
  - Ensure all tests pass, ask the user if questions arise.
  - CPU rule: run the full core and worker suites with `--maxWorkers=50%`; no e2e here

- [x] 35. Phase 5: combination-dial
  - [x] 35.1 Authoring schema and generation response arm
    - Append `CombinationDialAuthoringSchema` to `AuthoringQuestionSchema`: strict object whose answer is `exact`, `range`, or `template` (`difference` or `percent-change` with numeric inputs and a `value`); no expression or code field anywhere, so a `template` answer with an extra `expression` key is rejected by the schema itself
    - Add the matching strict-compatible arm to `GeneratedQuestionSchema` and the numeric-answer branch in `toAuthoringQuestion`
    - Extend `schema.test.ts` with the real `combination-dial` dev and sample fixtures (`hh-q10`, `hh-q11`, `d06-q07`, `d07-q06`) and `generation-schema.test.ts` with the shared re-parse test
    - _Requirements: 22.4, 22.5, 22.6, 14.1_

  - [x] 35.2 Code_Checks, registry entries and removal of the unsupported branch
    - The combination-dial group uses exactly the Check_IDs of Requirement 22.4 and does not reuse the rune cipher's `answer-not-in-quote` (a dial answer is a number, checked by `number-not-in-quote` or `range-not-in-quote`); no dial task, test or fixture expects `answer-not-in-quote`
    - Create `packages/core/src/locks/combination-dial-checks.ts` with `missing-units`, `number-not-in-quote`, `range-not-in-quote`, `template-not-allowlisted`, `template-input-not-in-quote`, `template-value-mismatch` (recomputed by code with `computeTemplate`, never the model's value), `model-written-expression` and `dial-range-prompt`; a number matches a resolved quote verbatim after thousands-separator normalisation. Write the fixture-literal unit tests for the dial `code:*` fixtures first
    - Flip the `combination-dial` registry entries to `implemented: true`, bump `CHECK_VERSION` once for this group, and update the registry test so every entry in the registry is `implemented: true`
    - With the bump, update any result-file or cassette test that compares the version; if the cassette tests compare `checkVersion`, change only that field in cassette files (prompt digests and responses untouched)
    - Because this is the last type, widen `isSupported` to all six, remove the `lock-type-not-supported` branch and the `UnsupportedQuestion` path from `run-checks.ts`, and update `run-checks.test.ts` to assert `runChecks` never returns `lock-type-not-supported` for any of the six types (keep `lock-type-not-supported` registered)
    - _Requirements: 22.4, 22.5, 22.6, 22.7, 3.2, 3.4, 3.6, 3.11, 3.14_

  - [x] 35.3 Generation prompt section
    - Add the `combination-dial` entry to `LOCK_RULES`. Generated only when the answer is a number or range stated verbatim in the notes, or one of the two allowlisted templates over numbers stated in the notes; the model never computes or writes an expression, and a range prompt asks for one value
    - Extend `generation-prompt.test.ts` so the rule text is present when the type is allowed and no executable-expression field exists in the generation schema
    - _Requirements: 22.4, 22.5, 22.6, 22.7, 14.5_

  - [x] 35.4 Blind-review rule
    - Add `combination-dial` branches to `citedChunks`, `buildBlindReviewUserMessage`, `decideReview` and `hasCompleteLabels`; the reviewer sees the question and cited chunks and gives the number it derives, never the key or the explanation
    - Extend `blind-review.test.ts` with the `combination-dial` `review:*` adversarial fixtures via cassette and one `passed` example
    - _Requirements: 22.4, 15.1, 15.3, 15.4, 15.6_

  - [x] 35.5 Mapper to the judge payload
    - In `packages/core/src/locks/combination-dial.ts`, add a pure, additive `mapCombinationDialPayload` export producing the `CombinationDialQuestion` shape (`exact`, `range`, or a template value computed by code) with `hintEffect: null` always; the mapper never produces `tolerance` or `reveal-digit`. Leave the judge unchanged (or use `locks/combination-dial-mapper.ts` if the file would pass ~300 lines)
    - Add the `mapSpec`/`evidenceParagraphs` branches, `CombinationDialPayloadSchema`, and a `narrowHint` branch that rejects any non-`null` hint for this type
    - Unit-test the `hh-q10` and `hh-q11` mappings and feed each payload plus its correct submission to the real judge, expecting `correct`
    - _Requirements: 22.4, 22.5, 22.6, 8.2, 22.8_

  - [x] 35.6 Add `combination-dial` to the test and eval allow-lists only
    - Add `'combination-dial'` to `PHASE5_TEST_ALLOWED_LOCK_TYPES` and `EVAL_ALLOWED_LOCK_TYPES` (both now all six); use the former in the `combination-dial` cassette test (task 35.8)
    - Do NOT change `DEFAULT_ALLOWED_LOCK_TYPES` or `ALLOWED_LOCK_TYPES`; the assertions from task 29.6 must keep passing
    - _Requirements: 22.4, 14.9_

  - [x] 35.7 Write property tests for combination-dial
    - **Property 23: A stated number or range endpoint not present in any resolved quote is always rejected**
    - **Validates: Requirements 22.4**
    - **Property 24: Only the two allowlisted templates are ever accepted**
    - **Validates: Requirements 22.5**
    - **Property 25: A template's computed value must match code's own computation**
    - **Validates: Requirements 22.5, 22.6**
    - **Property 27: A range answer's prompt never asks for more than one value**
    - **Validates: Requirements 22.7**
    - **Property 28: The Manifest_Schema validates every six-Lock_Type payload and hint shape, and rejects every mismatch** (combination-dial part: any non-null hint is rejected)
    - **Validates: Requirements 22.8**
    - Mapper property: for any generated exact, range or template answer, the mapped payload equals the code-computed value and is accepted by `CryptManifestSchema`
    - **Property 29: Every Dev_Set and Sample_Set question of the four new types passes Code_Checks, and every `code:*` adversarial fixture of those types fails with exactly its expected Check_ID** (combination-dial part; reads only `eval/dev`, `samples` and `eval/adversarial`, never `eval/holdout`)
    - **Validates: Requirements 22.9**

  - [x] 35.8 Write the cassette test for combination-dial
    - Add a cassette fixture driving `runRoomPipeline` (cassette provider and mock ledger only) with a `combination-dial` primary, one `exact` and one `template` case; assert generation, Code_Checks, blind review, mapping and `validateManifestForPublish`; assert each entry's `digest` against `promptDigest`
    - _Requirements: 22.4, 22.5, 12.2, 16.3_

  - [x] 35.9 Extend the duplicate-answer keys for combination-dial
    - Extend `answerKeysOfAuthoring` and `answerKeysOf` in `packages/core/src/checks/duplicate-answers.ts` so a `combination-dial` question contributes one key: the normalised value plus its unit, with a range written as `low-high unit`
    - Add ONE property test for this type to the duplicate suite (`packages/core/src/checks/duplicate-answers.test.ts` or a sibling file): for any two `combination-dial` questions in different concepts whose normalised value and unit (or `low-high unit` for a range) are equal, `duplicate-answer-in-room` is reported, and for any two that differ it is not
    - _Requirements: 22.4, 4.9_

- [x] 36. Checkpoint - combination-dial group
  - Ensure all tests pass, ask the user if questions arise.
  - CPU rule: run the full core and worker suites with `--maxWorkers=50%`; no e2e here
  - After the checkpoint passes, give the user the exact paid re-record command (all six types via `--allowed-lock-types`, through the evaluation skill with its spending cap). Do not run it; the user runs it in their own shell

- [ ] 37. Phase 5: room assembly across six types
  - [ ] 37.1 Add a six-type room assembly example
    - Using the existing `room-assembly-heart-fixtures.ts` pattern, add a test in `pipeline/room-assembly.test.ts` that assembles one room from accepted candidates of all six Lock_Types and asserts at most one slot per type and every alternate has a different type from its primary
    - Make no change to `pipeline/room-assembly.ts` or `room-assembly-select.ts` unless the test shows a defect; if it does, stop and ask the user
    - _Requirements: 16.1, 22.8_

  - [ ] 37.2 Write property tests for six-type room assembly
    - Add an arbitrary of accepted concepts across all six Lock_Types in `packages/core/src/test-support/`, and test that for any such input the assembled `RoomSpec` has at most one lock of each type, no alternate shares its primary's type, and `validateManifestForPublish` accepts it
    - **Property 4: Manifest_Schema rejects a second slot of the same Lock_Type in one room** (re-run across all six types)
    - **Validates: Requirements 2.7**
    - **Property 28: The Manifest_Schema validates every six-Lock_Type payload and hint shape, and rejects every mismatch** (alternate type differs from primary, across all six)
    - **Validates: Requirements 16.1, 22.8**

- [ ] 38. Phase 5: concurrency and budget unchanged
  - [ ] 38.1 Write tests that concurrency stays at 4 and budget rules are unchanged
    - Test only; no behaviour change. With a deferred Provider and the mock ledger, run `runRoomPipeline` over concepts that propose all six types and assert in-flight calls never exceed 4, every Provider call has a prior reservation, and every reservation is reconciled or released (the Property 17 pattern); assert no new ledger method or reservation-sizing code was introduced (the `BudgetLedger` interface keys are unchanged)
    - _Requirements: 11.6, 12.6, 22.8_

- [ ] 39. Phase 5: phase-wide acceptance
  - [ ] 39.1 Write the six-type Manifest_Schema acceptance test
    - Create `packages/core/src/runtime/manifest-schema-six-types.test.ts` (keep it under ~300 lines): a manifest built with `buildManifest` over all six Lock_Types round-trips through `CryptManifestSchema`, and each type rejects a payload of another type, a missing field and a hint that does not reference its payload
    - **Property 28: The Manifest_Schema validates every six-Lock_Type payload and hint shape, and rejects every mismatch**
    - **Validates: Requirements 22.8**

  - [ ] 39.2 Write the Phase 5 dataset acceptance test
    - Create `packages/core/src/phase5-acceptance.test.ts` that reads `eval/dev/questions/*.json`, `samples/questions/*.json` and `eval/adversarial/fixtures.json` at test time, runs `runChecks` over every question of the four new types and asserts no blocking failure, and asserts every `code:*` fixture of those types fails with exactly its expected Check_ID and no other blocking id
    - Assert counts against named constants taken from the files as they stand, failing with a message that states expected and actual counts; do not edit `eval/adversarial/fixtures.json`; never reference `eval/holdout`; extend the existing no-holdout scan so it covers the new test files
    - **Property 29: Every Dev_Set and Sample_Set question of the four new types passes Code_Checks, and every `code:*` adversarial fixture of those types fails with exactly its expected Check_ID**
    - **Validates: Requirements 22.9**

  - [ ] 39.3 Confirm the existing cassette end-to-end tests still pass
    - Re-run `e2e-pipeline.test.ts` and `e2e-cassette-digest.test.ts` (targeted: `pnpm exec vitest run <file>`) with the pinned options from task 28.3, and add one assertion that the pinned options, not the default, determine the recorded prompts. The default allow-list is unchanged at this point; task 39.6 re-runs both files after any widening
    - _Requirements: 12.1, 22.9_

  - [ ] 39.4 Record the streaming open point and the dial hint in the build log
    - Append a short entry to `docs/build-log.md` recording that streaming a new room into a running game (Req 16.4, 22.10) remains deferred and unchanged by Phase 5
    - Append a second entry recording that the combination dial's `reveal-digit` hint stays unreachable for now: the mapper always produces `hintEffect: null` and `narrowHint` rejects any non-`null` dial hint (tasks 35.5, 35.7)
    - Record only; no behaviour or code change
    - _Requirements: 22.10, 22.4_

  - [ ] 39.5 Check that a play panel exists for each of the four new types (read-only)
    - Read `apps/web/src/features/**/lock-panel-registry.ts` (currently `apps/web/src/features/crypt/lock-panel-registry.ts`) and list which of `bone-ordering`, `bound-threads`, `cursed-object` and `combination-dial` have a key in `LOCK_PANELS`. Another chat is building the panels, so read the file as it is now and do not edit anything under `apps/web`
    - If any of the four panels is missing, STOP and report to the user which types are missing and which are present; the missing types must not be widened in task 39.6. Write the present and missing lists into `docs/build-log.md`
    - _Requirements: 14.9, 22.8_

  - [ ] 39.6 Widen `DEFAULT_ALLOWED_LOCK_TYPES` and the worker allow-list, per type, for types with panels
    - Precondition: task 39.5 has run and listed the present and missing panels. Generating a type the app cannot play would ship unplayable rooms, so widen only the types whose panel exists in `LOCK_PANELS`, one type at a time (all four, or a subset); if none is present, make no change
    - For each present type, add it to `DEFAULT_ALLOWED_LOCK_TYPES` in `packages/core/src/pipeline/generation-prompt.ts` and to `ALLOWED_LOCK_TYPES` in `apps/worker/src/config.ts`, and update `generation-prompt.test.ts` and the worker config test (replace the task 29.6 assertions that both equal the two original types with assertions of the exact widened lists)
    - Record in `docs/build-log.md` which types were widened and which were left out (and why: panel missing). Release_Status gating (Req 14.9, 23.5) stays in P6; no gating code here
    - Re-run `e2e-pipeline.test.ts` and `e2e-cassette-digest.test.ts` to confirm the pinned options still produce unchanged prompts and digests; do not edit any cassette or digest
    - CPU rule (checkpoint): run the full core and worker suites with `--maxWorkers=50%`; no Playwright suite is needed for this task, but if one is run, first check that port 4173 is free (wait if busy) and use `--workers=2`
    - _Requirements: 14.9, 22.1, 22.2, 22.3, 22.4_

- [ ] 40. Final checkpoint - Phase 5
  - Run `pnpm test`, `pnpm lint` (including the structure check) and `pnpm typecheck` for `packages/core` and `apps/worker`, and run the worker build (`pnpm --filter ./apps/worker build`). Ensure all pass, ask the user if questions arise.
  - CPU rule: run Vitest with `--maxWorkers=50%`. If e2e is run, first check that port 4173 is free and wait if it is busy, then run Playwright with `--workers=2`

## Notes

- All tasks are required, including every unit test and property test. No task is optional.
- Phase 1, Phase 2 and Phase 3 are now planned. Evaluation, conflict check, sufficiency, final-door reservation and release flags (P4 to P6) remain out of scope.
- No task reads or references `eval/holdout/`, and none edits `eval/adversarial/fixtures.json`.
- No task adds a real provider, network or AI SDK import to `packages/core`; the OpenAI SDK is used only in `apps/worker`.
- Room-play follow-up (not a task here): the web app creates and keeps the session ID (at least 128 bits from `crypto.getRandomValues`, in `sessionStorage`, sent as `X-Session-Token`, no cookies).
- Room-play follow-up (not a task here): the web app can call `DELETE /jobs/:id` when the learner leaves the generate screen; `connect-src` is unchanged.
- Phase 5 (tasks 28 to 40) must not be executed until the user says so. Task 28.1 first confirms that the parallel change under `packages/core/src/checks/` is committed and settled.
- Decision by the user for Phase 5 (replaces the earlier decision that each group widens the default): each type group adds its type only to the test and eval allow-lists (`PHASE5_TEST_ALLOWED_LOCK_TYPES` in `packages/core/src/test-support/phase5-lock-types.ts` and `EVAL_ALLOWED_LOCK_TYPES` in `apps/worker/src/config.ts`, which only `evaluation/cli.ts` uses). `DEFAULT_ALLOWED_LOCK_TYPES` and the worker's `ALLOWED_LOCK_TYPES` (used by `start.ts` for learner notes) stay at rune cipher and séance board until task 39.6, which widens them per type, only for types whose panel exists in `apps/web/src/features/**/lock-panel-registry.ts` (task 39.5, read-only), and records any type left out in `docs/build-log.md`. Release_Status gating (Req 14.9, 23.5) stays in P6. The existing cassette end-to-end options pin `allowedLockTypes` (task 28.3) so recorded prompt digests do not change.
- The combination-dial `reveal-digit` hint stays unreachable for now (mapper always `hintEffect: null`); task 39.4 records this in `docs/build-log.md`.
- Task 28.1 must stop and report, doing nothing else, if `git status` shows uncommitted changes under `packages/core/src/checks/`; it re-reads `requirements.md`, `.kiro/steering/tech.md` and `design.md` first and no Phase 5 task edits those three files or overwrites another chat's edits.
- CPU rule for every task: during work, run targeted tests only (for example `pnpm exec vitest run <file>`). Run the full suite and e2e only at checkpoints (28.2, 30, 32, 34, 36, 39.6, 40), with `--maxWorkers=50%` for Vitest and `--workers=2` for Playwright. Before e2e, check that port 4173 is free and wait if it is busy.
- Per-type payload mappers live in `packages/core/src/locks/<type>.ts` as additive exports, as the user asked. The design says the judges are not modified; the judge functions and their types stay unchanged, and a mapper moves to `locks/<type>-mapper.ts` if a file nears ~300 lines. `mapper/manifest-mapper.ts` only dispatches.
- Phase 5 tests read only `eval/dev/`, `samples/` and `eval/adversarial/`, never `eval/holdout/`, and never call a real provider.
- Eval replay rule (Phase 5): until the end of Phase 5, replay of the recorded dev cassettes uses `--allowed-lock-types rune-cipher,seance-board`. Recorded dev cassettes are not re-recorded per group. One paid re-record over the dev set happens after the combination-dial group (task 36) with all six types allowed, run by the user in their own shell through the evaluation skill.
- Requirement 30 is withdrawn (covered by G8 and Requirement 21.3), so no task references it.
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
    { "id": 18, "tasks": ["10"] },
    { "id": 19, "tasks": ["11.1", "11.2"] },
    { "id": 20, "tasks": ["11.3", "11.4", "11.7", "11.8"] },
    { "id": 21, "tasks": ["11.5", "11.6"] },
    { "id": 22, "tasks": ["12.1", "12.3"] },
    { "id": 23, "tasks": ["12.2", "12.4", "12.6"] },
    { "id": 24, "tasks": ["12.5", "12.7", "12.8"] },
    { "id": 25, "tasks": ["13"] },
    { "id": 26, "tasks": ["14.1"] },
    { "id": 27, "tasks": ["14.2", "14.3", "14.6"] },
    { "id": 28, "tasks": ["14.4", "14.5"] },
    { "id": 29, "tasks": ["15"] },
    { "id": 30, "tasks": ["16.1"] },
    { "id": 31, "tasks": ["16.2", "16.3", "17.1"] },
    { "id": 32, "tasks": ["17.2", "17.3"] },
    { "id": 33, "tasks": ["18"] },
    { "id": 34, "tasks": ["19.1"] },
    { "id": 35, "tasks": ["19.2", "19.3", "19.4"] },
    { "id": 36, "tasks": ["20"] },
    { "id": 37, "tasks": ["21.1"] },
    { "id": 38, "tasks": ["21.2", "21.3", "21.4"] },
    { "id": 39, "tasks": ["21.5", "21.6"] },
    { "id": 40, "tasks": ["21.7"] },
    { "id": 41, "tasks": ["22"] },
    { "id": 42, "tasks": ["23.1"] },
    { "id": 43, "tasks": ["23.2", "23.4"] },
    { "id": 44, "tasks": ["23.3", "23.5", "23.6"] },
    { "id": 45, "tasks": ["24"] },
    { "id": 46, "tasks": ["25.1"] },
    { "id": 47, "tasks": ["25.2", "25.3"] },
    { "id": 48, "tasks": ["25.4", "25.5"] },
    { "id": 49, "tasks": ["25.6"] },
    { "id": 50, "tasks": ["26"] },
    { "id": 51, "tasks": ["27.1"] },
    { "id": 52, "tasks": ["27.2", "27.3"] },
    { "id": 53, "tasks": ["27.4", "27.5"] },
    { "id": 54, "tasks": ["27.6"] },
    { "id": 55, "tasks": ["27.7"] },
    { "id": 56, "tasks": ["28.1"] },
    { "id": 57, "tasks": ["28.2"] },
    { "id": 58, "tasks": ["28.3"] },
    { "id": 59, "tasks": ["29.1"] },
    { "id": 60, "tasks": ["29.2", "29.3", "29.4", "29.5"] },
    { "id": 61, "tasks": ["29.6"] },
    { "id": 62, "tasks": ["29.7", "29.8"] },
    { "id": 63, "tasks": ["30"] },
    { "id": 64, "tasks": ["31.1", "31.9", "31.10"] },
    { "id": 65, "tasks": ["31.2", "31.3", "31.4", "31.5"] },
    { "id": 66, "tasks": ["31.6"] },
    { "id": 67, "tasks": ["31.7", "31.8"] },
    { "id": 68, "tasks": ["32"] },
    { "id": 69, "tasks": ["33.1"] },
    { "id": 70, "tasks": ["33.2", "33.4", "33.5", "33.6"] },
    { "id": 71, "tasks": ["33.3"] },
    { "id": 72, "tasks": ["33.7"] },
    { "id": 73, "tasks": ["33.8", "33.9", "33.10"] },
    { "id": 74, "tasks": ["34"] },
    { "id": 75, "tasks": ["35.1"] },
    { "id": 76, "tasks": ["35.2", "35.3", "35.4", "35.5"] },
    { "id": 77, "tasks": ["35.6"] },
    { "id": 78, "tasks": ["35.7", "35.8", "35.9"] },
    { "id": 79, "tasks": ["36"] },
    { "id": 80, "tasks": ["37.1"] },
    { "id": 81, "tasks": ["37.2", "38.1"] },
    { "id": 82, "tasks": ["39.1", "39.2", "39.3", "39.4"] },
    { "id": 83, "tasks": ["39.5"] },
    { "id": 84, "tasks": ["39.6"] },
    { "id": 85, "tasks": ["40"] }
  ]
}
```
