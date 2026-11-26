# Requirements Document

## Introduction

This spec turns a learner's chunked notes into published room manifests. The model proposes concepts and questions. Code checks and a blind model review decide what is accepted. Every acceptance and rejection is measured on the development set.

The spec produces the runtime's `CryptManifest` (`packages/core/src/runtime/manifest-types.ts`). No second manifest type exists. The authoring format (`eval/dev/questions/*.json`, `samples/questions/*.json`) is a separate input format that a pure mapping converts into `QuestionSpec` values.

The work is phased. **Phase 1 is the first task group and is the Gate 1 deliverable.** It covers the Zod schemas, the code checks for rune cipher and séance board, the dev, samples and adversarial tests, and the Gate 1 fallback: a one-room sample crypt built from `samples/human-heart` (Requirement 27). Phase 1 has no dependency on provider, budget, cassette or network code. Later phases add the provider interface and cassettes, the pipeline for rune and séance, evaluation, the other four lock types, and the conflict check, sufficiency, final-door reservation and release flags.

Requirements are tagged with their phase in the heading. Phases:

- **P1**: schemas, rune/séance code checks and the Gate 1 sample crypt (no provider code).
- **P2**: provider interface, cassettes, budget-reservation hook.
- **P3**: pipeline for rune cipher and séance board, one room published.
- **P4**: evaluation run on `eval/dev` and provider choice.
- **P5**: bone ordering, bound threads, cursed object, combination dial.
- **P6**: conflict check, sufficiency, final-door reservation, release flags.

Out of scope: `eval/holdout` (not read, not referenced, not requested), streaming later rooms into a running game (recorded as an open point, Requirement 22), accounts, server-side storage of private uploads beyond the job TTL, and any claim of learning gains.

## Glossary

- **Pipeline**: the staged process that turns chunks into published room manifests (prepare input, concept extraction, sufficiency, typed generation, code checks, blind review, conflict check, room assembly, publish).
- **Core**: the `packages/core` package. It depends on no React, database or AI SDK.
- **Worker**: the `apps/worker` service that runs generation jobs.
- **Chunk**: a unit of notes text with a code-assigned chunk ID, produced by the ingestion spec's chunker. A heading-only chunk is context and is not quotable.
- **Quote**: a short exact excerpt of a chunk, copied by the model, that code resolves to a chunk and character offsets.
- **Quote_Resolver**: the Core function `resolveQuote` that resolves a quote against chunks and returns a typed result.
- **Concept**: a unit of study content with `conceptId`, `label`, `chunkIds` and `quotes`.
- **Concept_Extractor**: the Pipeline stage that calls the model once per document to propose concepts.
- **Generator**: the Pipeline stage that calls the model once per concept to propose a primary question and an optional alternate.
- **Authoring_Question**: a question in the authoring format (prompt, options with labels and evidence by paragraph number). It is not a `QuestionSpec`.
- **Authoring_Schema**: the Zod schema for Authoring_Question and for each lock type's authoring payload.
- **Manifest_Schema**: the Zod schema for `CryptManifest`, including per-lock-type payload and `HintEffectSpec` validation.
- **QuestionSpec**: the runtime type in `manifest-types.ts` (`questionId`, `lockType`, `payload`, `evidenceRefs`, `hintEffect`).
- **CryptManifest**: the runtime manifest type in `manifest-types.ts`. The only manifest type.
- **Manifest_Mapper**: the pure function that converts accepted Authoring_Questions into `QuestionSpec` values and assembles a `CryptManifest`.
- **Manifest_Check**: the spec 2 function `manifestCheck` that validates a manifest structurally.
- **Code_Check**: a pure function with a stable Check ID that returns pass, or fail with that Check ID.
- **Check_ID**: a stable string identifier for a Code_Check, such as `quote-not-found`.
- **Check_Version**: a version string for the set of Code_Checks, recorded with each evaluation run.
- **Blind_Reviewer**: the Pipeline stage that calls the model once per question without the key, labels or explanation.
- **Conflict_Checker**: the Pipeline stage that finds passages that contradict an accepted answer, using code first and then one model call per room.
- **Leak_Scan**: the Code_Check pass at room assembly that finds a rune answer in another concept's visible text.
- **Provider**: the single model-call interface with timeout, token limit and retry limit parameters.
- **Cassette**: a recorded provider response keyed by prompt digest, used by tests in place of a real provider.
- **Prompt_Digest**: a hash of the full prompt text and parameters of a model call.
- **Budget_Ledger**: the transactional Postgres ledger described in the security rules. P2 uses a mock.
- **Lock_Type**: one of `rune-cipher`, `seance-board`, `bone-ordering`, `bound-threads`, `cursed-object`, `combination-dial`.
- **Dev_Set**: the notes and gold questions in `eval/dev/`.
- **Sample_Set**: the notes and questions in `samples/`.
- **Adversarial_Set**: the fixtures in `eval/adversarial/fixtures.json`. Each fixture names an expected layer: `code:<check-id>`, `review:*` or `pipeline:conflict-check`.
- **Evaluation_Skill**: the paid, capped skill that is the only path to real provider calls for evaluation.
- **Wrong_Accepted**: a question accepted by the Pipeline that a human rater marks wrong or ambiguous. The headline metric.
- **Correct_Rejected**: a question rejected by the Pipeline that a human rater marks fine.
- **Release_Status**: per Lock_Type, `released` or `samples-only`, driven by the last evaluation.
- **Notes_Record_Parser**: the Core function `parseNotesRecord` in `packages/core/src/notes-record.ts`.
- **Job**: one generation run on the Worker, from one anonymous session and one notes text, with a status and a result.
- **Job_Store**: the Worker's in-memory store of Jobs and results, deleted after the Job_TTL.
- **Job_TTL**: the stated time after which a finished Job's notes text and result are deleted. The value is 30 minutes after the Job reaches a terminal status.
- **Tombstone**: the content-free record `{ jobId, sessionHash, idempotencyKeyHash, requestDigest, status: 'expired', expiredAt }` that the Worker keeps after the Job_TTL. The `idempotencyKeyHash` is the sha-256 of the idempotency key, and the record is bound to the session hash and the request digest.
- **Tombstone_TTL**: the time after which a Tombstone is deleted. The value is 24 hours after `expiredAt`.
- **Session_Token**: the anonymous random value (at least 128 bits, from `crypto.getRandomValues`) that the web app creates, keeps in `sessionStorage` and sends in the `X-Session-Token` request header, and that binds Job retrieval and cancellation to that browser.
- **Interim_Ledger**: the Worker's in-memory Budget_Ledger with a daily hard cap, used until spec 6 provides the Postgres ledger.
- **Crypt_Bundle**: the published output of the Pipeline: a `CryptManifest` plus its Crypt_Content.
- **Heading_Chunk**: a Chunk whose text is a single line that satisfies the chunker's own heading rule (`isAllCapsHeading` in `chunker-split.ts`: at most 80 characters, no terminal punctuation, at least one letter, all caps), as classified by `isHeadingOnlyChunk`. It is passed to the model as context and is never quotable.

## Requirements

### Requirement 1: Authoring_Schema (P1)

**User Story:** As a developer, I want a validated authoring format, so that dev, sample and generated questions are checked the same way.

#### Acceptance Criteria

1. THE Authoring_Schema SHALL be a Zod schema in Core, and the TypeScript type for Authoring_Question SHALL be derived from that schema.
2. THE Authoring_Schema SHALL define the rune cipher and séance board authoring payloads in P1 and SHALL leave the other four Lock_Types to P5.
3. WHEN a value matching the shape of an `eval/dev/questions/*.json` or `samples/questions/*.json` rune cipher or séance board question is parsed, THE Authoring_Schema SHALL return a typed success.
4. IF a value does not match the Authoring_Schema, THEN THE Authoring_Schema parser SHALL return a typed error result that carries the failing field path, and SHALL NOT throw.
5. THE Authoring_Schema SHALL reject a question whose `lockType` is not one of the six Lock_Types.
6. FOR ALL valid Authoring_Questions, serialising to JSON then parsing SHALL produce an equal Authoring_Question with the same option order (round-trip property).
7. THE Authoring_Schema SHALL contain no field for character offsets, so that the model cannot supply them.

### Requirement 2: Manifest_Schema (P1)

**User Story:** As a developer, I want a Zod schema for the runtime manifest, so that no unchecked manifest is published.

#### Acceptance Criteria

1. THE Manifest_Schema SHALL describe the runtime's `CryptManifest`, and a compile-time test SHALL fail the build if the type inferred from the Manifest_Schema differs from `CryptManifest`.
2. THE Core SHALL NOT export any manifest type other than `CryptManifest` and its member types from `manifest-types.ts`.
3. WHEN a `QuestionSpec` is parsed, THE Manifest_Schema SHALL validate its `payload` against the payload shape that the judge in `packages/core/src/locks/<lockType>.ts` expects.
4. WHEN a `QuestionSpec` is parsed, THE Manifest_Schema SHALL validate its `hintEffect` against the `HintEffectSpec` shape allowed for its Lock_Type, or accept `null`, as narrowed by criteria 13 to 15.
5. THE Manifest_Schema SHALL validate rune cipher payloads (`answer`, `aliases`, `caseSensitive`) and séance board payloads (`optionIds`, `keyOptionId`) in P1, and the other four payload shapes in P5.
6. THE Manifest_Schema SHALL require `questionId` values to be unique within a manifest.
7. THE Manifest_Schema SHALL require at most one lock slot per Lock_Type in each room.
8. THE Manifest_Schema SHALL require each slot's `alternateQuestion` to have a Lock_Type different from its `primaryQuestion`.
9. THE Manifest_Schema SHALL require 0 to 4 entries in `finalDoor.slots`, each with `slotId`, `conceptId` and a full `question`.
10. IF a value does not match the Manifest_Schema, THEN THE Manifest_Schema parser SHALL return a typed error result, and SHALL NOT throw.
11. FOR ALL manifests produced by `manifestArb` from `packages/core/src/test-support/`, serialising to JSON then parsing SHALL produce an equal manifest with identical option order and identical hint effects (round-trip property).
12. WHEN the Manifest_Schema accepts a manifest, THE Pipeline SHALL pass the manifest to Manifest_Check before publishing, and IF Manifest_Check fails, THEN THE Pipeline SHALL NOT publish that manifest.
13. THE Core SHALL add the `HintEffectSpec` kind `reveal-first-letter` with the fields `firstLetter` (a string of exactly 1 character) and `length` (a positive integer) in `packages/core/src/types.ts`, and the rune judge SHALL continue to ignore hints, so that judging is unchanged.
14. WHERE a `QuestionSpec` has the Lock_Type `rune-cipher`, THE Manifest_Schema SHALL accept only a `hintEffect` of kind `reveal-first-letter` or `null`.
15. WHERE a `QuestionSpec` has the Lock_Type `seance-board`, THE Manifest_Schema SHALL accept only a `hintEffect` of kind `remove-option` or `null`, SHALL require the removed `optionId` to be in the payload's `optionIds`, and SHALL require the removed `optionId` to differ from `keyOptionId`.
16. IF a rune cipher `hintEffect` is not `reveal-first-letter` or `null`, THEN THE Manifest_Schema parser SHALL return a typed error result, and a test SHALL cover this rejection.
17. IF a séance board `remove-option` hint names an `optionId` that is not in `optionIds`, or names the `keyOptionId`, THEN THE Manifest_Schema parser SHALL return a typed error result, and a test SHALL cover each of the two rejections.
18. WHEN `manifestCheck` validates hint kinds, THE Manifest_Check SHALL accept `reveal-first-letter` with the same rules as criterion 13.
19. THE fixture builder and `manifestArb` in `packages/core/src/test-support/` SHALL produce `reveal-first-letter` hints for rune cipher questions, and the manifest serialisation round-trip test SHALL cover them.

### Requirement 3: Code_Check framework (P1)

**User Story:** As a developer, I want every check to be a pure function with a stable ID, so that metrics, fixtures and tests refer to the same names.

#### Acceptance Criteria

1. THE Core SHALL implement each Code_Check as a pure function, with no I/O, timer, randomness or provider dependency.
2. THE Core SHALL expose a `CHECK_VERSION` constant with the exact value `'2026-11-25.1'`, and SHALL change that value whenever the set or behaviour of Code_Checks changes.
3. WHEN a Code_Check fails, THE Core SHALL return a typed result that carries the Check_ID and the question identifier, and SHALL NOT throw.
4. THE Core SHALL provide a registry that lists every Check_ID, its Lock_Type scope, and whether it is blocking or advisory.
5. THE Core SHALL use exactly the following Check_IDs, which include `lock-type-not-supported`: `quote-not-found`, `quote-ambiguous`, `quote-too-short`, `quote-too-long`, `unknown-paragraph/chunk`, `missing-according-to-your-notes`, `negative-question`, `banned-phrase`, `answer-not-in-quote`, `rune-needs-one-blank`, `answer-leak-in-prompt`, `answer-leak-in-room`, `option-count`, `option-not-supported-or-contradicted`, `option-without-evidence`, `not-exactly-one-supported`, `key-not-the-supported-option`, `duplicate-options`, `step-count`, `duplicate-steps`, `no-explicit-sequence-marker-in-quotes`, `pair-count`, `not-one-to-one`, `item-count`, `answer-not-an-item`, `missing-category-rule`, `needs-category-and-outside-quotes`, `missing-units`, `number-not-in-quote`, `range-not-in-quote`, `template-not-allowlisted`, `template-input-not-in-quote`, `template-value-mismatch`, `model-written-expression`, `alternate-same-lock-type`, `max-one-alternate`, `dial-range-prompt`, `alternate-off-concept`, `lock-type-not-supported`.
6. THE Core SHALL treat `alternate-off-concept` as advisory and every other Check_ID, including `quote-too-long`, as blocking.
7. THE Core SHALL implement the Code_Checks fresh in `packages/core`, without copying the overnight checker.
8. WHERE a Lock_Type's checks are not yet implemented, THE Core SHALL reject questions of that Lock_Type with a blocking `lock-type-not-supported` Check_ID result and SHALL NOT accept them.
9. FOR ALL rooms, THE Code_Checks SHALL return the same verdicts for any permutation of the room's questions (order-independence property, G-P2).
10. FOR ALL questions, running the Code_Checks twice on the same input SHALL return equal results (idempotence property).
11. THE Core SHALL keep each Lock_Type's generation rules and checks in `packages/core/src/locks/<type>.ts` with a matching `<type>.test.ts`, and SHALL keep each file under about 300 lines. WHERE `<type>.ts` would pass about 300 lines, THE Core MAY place that Lock_Type's checks in `packages/core/src/locks/<type>-checks.ts` next to the judge, with the tests in `<type>-checks.test.ts` or `<type>.test.ts`.
12. THE registry test SHALL compare the set of registry Check_IDs against the list in criterion 5, and SHALL fail on any missing or extra ID.
13. THE Core SHALL cover `quote-too-long` by a unit test that checks a Quote of 26 words fails with exactly `quote-too-long` and a Quote of 25 words does not.
14. THE registry test SHALL verify that every Check_ID scoped to `rune-cipher`, `seance-board` or shared has an implementation that `runChecks` calls, and that every Check_ID scoped to `bone-ordering`, `bound-threads`, `cursed-object` or `combination-dial` is explicitly marked not implemented yet in the registry, so that a question of those four Lock_Types can fail only with `lock-type-not-supported` until P5.

### Requirement 4: Shared evidence checks (P1)

**User Story:** As a learner, I want every question tied to an exact passage from my notes, so that I can see why an answer is right.

#### Acceptance Criteria

1. THE Authoring_Question SHALL cite one or more code-assigned chunk (or paragraph) identifiers and one or more Quotes.
2. WHEN a Quote is checked, THE Quote_Resolver SHALL resolve it to exactly one location in a quotable chunk.
3. IF a Quote does not appear in the cited text, THEN THE Code_Check SHALL fail with `quote-not-found`.
4. IF a Quote appears at more than one location in the cited text, THEN THE Code_Check SHALL fail with `quote-ambiguous`.
5. IF a Quote has fewer than 4 words, THEN THE Code_Check SHALL fail with `quote-too-short`.
6. IF a Quote has more than 25 words, THEN THE Code_Check SHALL fail with `quote-too-long`.
7. IF a question cites a paragraph or chunk that does not exist or is heading-only, THEN THE Code_Check SHALL fail with `unknown-paragraph/chunk`.
8. IF a question prompt, option, explanation or hint contains a phrase on the banned-language list from the evidence-and-honesty rule, THEN THE Code_Check SHALL fail with `banned-phrase`.
9. IF a question prompt contains a negative framing other than a cursed object "which one is not" prompt, THEN THE Code_Check SHALL fail with `negative-question`.
10. WHEN a Quote is resolved, THE Quote_Resolver SHALL be the only source of character offsets, and the model SHALL NOT supply offsets.
11. WHERE the learner edited text that was extracted from a PDF, THE Core SHALL label citations "Your edited notes, originally extracted from PDF page X".

### Requirement 5: Rune cipher checks (P1)

**User Story:** As a learner, I want a cloze question whose blank has one clear answer from my notes, so that the lock is fair.

#### Acceptance Criteria

1. IF a rune cipher prompt does not contain exactly one blank, THEN THE Code_Check SHALL fail with `rune-needs-one-blank`.
2. IF the rune cipher answer does not appear in the answer Quote, THEN THE Code_Check SHALL fail with `answer-not-in-quote`.
3. IF the rune cipher answer appears in the visible prompt text outside the blank, THEN THE Code_Check SHALL fail with `answer-leak-in-prompt`.
4. WHEN a room is assembled, THE Leak_Scan SHALL fail with `answer-leak-in-room` for any rune cipher answer that appears in another concept's visible text in that room.
5. THE rune cipher check SHALL apply the same normalisation that the rune judge in `packages/core/src/locks/rune-cipher.ts` applies, so that a check and the judge agree on whether an answer matches.
6. IF a rune cipher question has a missing or empty answer, THEN THE Authoring_Schema SHALL reject it before any Code_Check runs.
7. FOR ALL generated rune cipher candidates in the accepted set, every Quote SHALL resolve uniquely (G-P1).
8. THE `answer-not-in-quote` Code_Check, and any other Code_Check that reads a Quote's text as evidence (including `alternate-off-concept`), SHALL evaluate only Quotes that resolved uniquely; IF no Quote of the question resolved, THEN THE Code_Check SHALL NOT run, because the Quote failure (`quote-not-found`, `quote-ambiguous`, `quote-too-short` or `unknown-paragraph/chunk`) already blocks the question and one root cause is reported once.

### Requirement 6: Séance board checks (P1)

**User Story:** As a learner, I want choice questions framed "According to your notes" with each option backed by evidence, so that wrong options are wrong for a stated reason.

#### Acceptance Criteria

1. IF a séance board prompt does not begin with the phrase "According to your notes", THEN THE Code_Check SHALL fail with `missing-according-to-your-notes`.
2. IF a séance board question does not have exactly 3 or exactly 4 options, THEN THE Code_Check SHALL fail with `option-count`.
3. IF two options have equal text after normalisation, THEN THE Code_Check SHALL fail with `duplicate-options`.
4. IF an option is not labelled `supported` or `contradicted`, THEN THE Code_Check SHALL fail with `option-not-supported-or-contradicted`.
5. IF an option has no evidence Quote of its own, THEN THE Code_Check SHALL fail with `option-without-evidence`.
6. IF a séance board question does not have exactly one `supported` option, THEN THE Code_Check SHALL fail with `not-exactly-one-supported`.
7. IF the key option is not the `supported` option, THEN THE Code_Check SHALL fail with `key-not-the-supported-option`.
8. THE Manifest_Mapper SHALL preserve option order when it maps a séance board question to `optionIds` and `keyOptionId`.
9. THE Core SHALL NOT accept an option whose only basis is that the notes do not mention it.

### Requirement 7: Alternate and slot checks (P1)

**User Story:** As a learner, I want a replacement question of a different kind when I challenge or skip, so that a settled lock can still be replaced.

#### Acceptance Criteria

1. IF a concept's alternate question has the same Lock_Type as its primary, THEN THE Code_Check SHALL fail with `alternate-same-lock-type`.
2. IF a concept has more than one alternate, THEN THE Code_Check SHALL fail with `max-one-alternate`.
3. IF an alternate's answer Quote does not come from the concept's own Quotes, THEN THE Code_Check SHALL return an advisory `alternate-off-concept` result and SHALL NOT reject the question for that reason alone.
4. THE Generator SHALL accept `null` as a valid alternate.

### Requirement 8: Manifest_Mapper (P1)

**User Story:** As a developer, I want a pure, tested mapping from accepted authoring questions to runtime questions, so that nothing is lost between the check format and the game.

#### Acceptance Criteria

1. THE Manifest_Mapper SHALL be a pure function in Core that converts an accepted Authoring_Question into a `QuestionSpec`.
2. THE Manifest_Mapper SHALL map paragraph numbers to ingestion-spec chunk IDs through the existing chunker and citation labeller.
3. THE Manifest_Mapper SHALL assign a `questionId` unique within the manifest.
4. THE Manifest_Mapper SHALL set `hintEffect` to a valid effect for the Lock_Type, or to `null`, for each primary, alternate and final-door question.
5. THE Manifest_Mapper SHALL produce `payload` values that the Manifest_Schema accepts and the judge for the Lock_Type can evaluate.
6. WHEN a mapped manifest is built from accepted Dev_Set questions, THE Manifest_Check SHALL pass it.
7. IF a paragraph number has no chunk ID, THEN THE Manifest_Mapper SHALL return a typed error and SHALL NOT produce a partial `QuestionSpec`.
8. WHEN the Manifest_Mapper maps a rune cipher Authoring_Question, THE Manifest_Mapper SHALL always set `hintEffect` to `reveal-first-letter`, with `firstLetter` and `length` computed from the answer, even when the Authoring_Question has no hint.
9. THE Authoring_Schema SHALL define no hint marker for séance board questions, and WHEN the Manifest_Mapper maps a séance board Authoring_Question that has at least one option labelled `contradicted`, THE Manifest_Mapper SHALL set `hintEffect` to `remove-option` for the first `contradicted` option in authoring order, decided in code.
10. THE Manifest_Mapper SHALL rely on the fact that an accepted séance board question has exactly one `supported` option and 3 to 4 options, so it always has at least two `contradicted` options, and its `hintEffect` is therefore always `remove-option` on the first `contradicted` option in authoring order. IF a question with no `contradicted` option reaches the mapper, THEN THE Manifest_Mapper SHALL return a typed `check-failed` error and SHALL NOT produce a `QuestionSpec`.
11. IF a rune cipher Authoring_Question carries a hint that disagrees with the hint computed from its answer, THEN THE Manifest_Mapper SHALL return a typed hint-mismatch error that names the question and SHALL NOT produce a `QuestionSpec`.

### Requirement 9: Phase 1 acceptance against data sets (P1)

**User Story:** As the developer reaching Gate 1, I want measurable pass conditions on the existing data, so that I know phase 1 is done.

#### Acceptance Criteria

1. WHEN the Code_Checks run on every rune cipher and séance board question in the Dev_Set and the Sample_Set, THE Code_Checks SHALL pass all 56 questions (26 rune cipher, 30 séance board).
2. WHEN the Code_Checks run on each of the 10 existing rune cipher and séance board `code:*` fixtures in the Adversarial_Set, THE Code_Checks SHALL fail each fixture with exactly its expected Check_ID and no other blocking Check_ID.
3. WHEN the Code_Checks run on each of the 4 rune cipher and séance board `review:*` fixtures in the Adversarial_Set, THE Code_Checks SHALL pass each fixture, so that the fixture measures the Blind_Reviewer.
4. IF the counts of questions or fixtures found in the data differ from 56 questions, 10 `code:*` fixtures and 4 `review:*` fixtures, THEN THE test suite SHALL fail with a message that states the expected and actual counts.
5. THE phase 1 tests SHALL read only `eval/dev/`, `samples/` and `eval/adversarial/`, and SHALL NOT read, reference or require `eval/holdout/`.
6. THE Adversarial_Set in `eval/adversarial/fixtures.json` SHALL stay unchanged by this spec, and the phase 1 tests SHALL cover `quote-too-long` by the unit test in Requirement 3, criterion 13.
7. WHEN the Gate 1 sample crypt of Requirement 27 is built, THE phase 1 tests SHALL check that it passes the Manifest_Schema and Manifest_Check.
8. THE phase 1 code and tests SHALL import no Provider, Cassette, Budget_Ledger, network or AI SDK module.
9. THE phase 1 tests SHALL run in CI with `pnpm test`, `pnpm lint` and `pnpm typecheck` and SHALL make no real model call.

### Requirement 10: Notes record migration (P1)

**User Story:** As a developer, I want the notes record parser to use the same schema tool as every other boundary, so that stored records are validated consistently.

#### Acceptance Criteria

1. THE Notes_Record_Parser SHALL be reimplemented with a Zod schema, with the same exported name, the same signature `(value: unknown) => Result<NotesRecord, { kind: 'invalid-record' }>`, and no thrown errors.
2. THE migrated Notes_Record_Parser SHALL accept every record that the hand-checked version accepted and SHALL reject every record that the hand-checked version rejected.
3. FOR ALL records created by `makeNotesRecord`, parsing the record, and parsing its JSON round-trip, SHALL return the original record (round-trip property).
4. WHEN the migration is complete, THE existing tests in `notes-record.test.ts` SHALL pass without weakening any assertion.
5. WHEN the migration is complete, THE note in the tech rule that `parseNotesRecord` is hand-checked SHALL be updated to say it was migrated.

### Requirement 11: Provider interface (P2)

**User Story:** As a developer, I want one interface for every model call, so that timeout, token limit and retry limit apply everywhere.

#### Acceptance Criteria

1. THE Core SHALL define a Provider interface that every model call passes through, with timeout, maximum output tokens and retry limit parameters, and SHALL import no AI SDK.
2. THE Core SHALL receive Provider implementations as arguments, so that Core stays packageable as a Kiro Power.
3. WHEN a Provider call fails or times out, THE Provider SHALL return a typed error result, and SHALL NOT throw a string.
4. THE Worker SHALL supply the real Provider implementation and SHALL read credentials only from environment variables.
5. THE Provider SHALL set the Blind_Reviewer temperature to 0.
6. THE Provider SHALL bound concurrency to a configured cap, with a default of 4.
7. THE Core SHALL never include model output, notes text or credentials in error messages or logs.

### Requirement 12: Cassettes and budget hook (P2)

**User Story:** As a developer, I want deterministic tests that fail when a prompt changes, so that stale recordings are caught in CI.

#### Acceptance Criteria

1. THE Cassette store SHALL key each recorded response by Prompt_Digest.
2. WHEN a test requests a response whose Prompt_Digest has no Cassette, THE Cassette Provider SHALL return a typed `cassette-missing` error and the test SHALL fail.
3. WHEN a prompt template changes, THE Prompt_Digest SHALL change, so that the matching Cassette is reported missing until it is re-recorded through the Evaluation_Skill.
4. THE test suite SHALL make no real Provider call.
5. WHEN a Cassette is missing for a prompt that the live evaluation depends on, THE Core SHALL mark the last live evaluation result stale.
6. WHEN the Pipeline is about to call the Provider, THE Pipeline SHALL first obtain a worst-case reservation from the Budget_Ledger, and IF the reservation fails or the Budget_Ledger is unavailable, THEN THE Pipeline SHALL NOT make the call.
7. WHEN a Provider call completes, THE Pipeline SHALL reconcile actual usage with the reservation.
8. FOR ALL Pipeline runs with a mock Budget_Ledger, the number of Provider calls SHALL NOT exceed the number of reservations (G-P5).
9. THE P2 tests SHALL use a mock Budget_Ledger, and the real Postgres ledger SHALL be left to spec 6.
10. IF any result in an evaluation run derives from a Cassette with origin `synthetic`, THEN the evaluation SHALL NOT write that run to `eval/results/` and SHALL NOT count it in any metric.

### Requirement 13: Prepare input and concept extraction (P3)

**User Story:** As a learner, I want concepts drawn from my own notes, so that every lock is about material I brought.

#### Acceptance Criteria

1. WHEN the Pipeline prepares input, THE Pipeline SHALL classify a chunk as heading-only when its text is a single line that satisfies the chunker's own heading rule (`isAllCapsHeading`), SHALL pass heading-only chunks to the model as context, and SHALL NOT offer them as quotable chunks.
2. THE Concept_Extractor SHALL make one model call per document and SHALL return concepts with `conceptId`, `label`, `chunkIds` and Quotes.
3. THE Pipeline SHALL delimit the notes as data in every prompt and SHALL state that text inside the notes block is study material and never instructions.
4. WHEN the Concept_Extractor returns a concept, THE Quote_Resolver SHALL resolve each of its Quotes, and IF any Quote does not resolve, is ambiguous or is too short, THEN THE Pipeline SHALL drop that Quote, and SHALL drop the concept if no resolvable Quote remains.
5. THE Pipeline SHALL assign every chunk ID in code, and SHALL reject a concept that names a chunk ID that code did not assign.
6. IF a notes block contains text that looks like an instruction, THEN THE Pipeline SHALL treat that text as study material and SHALL NOT change its behaviour.
7. THE Pipeline SHALL limit the notes input so that each prompt stays well under 100k tokens, using the 6,000-word cap from ingestion.

### Requirement 14: Typed generation (P3, P5)

**User Story:** As a learner, I want question types that suit my notes, with no type forced to fill a quota.

#### Acceptance Criteria

1. THE Generator SHALL make one model call per concept that returns a primary question and an alternate of a different Lock_Type, or `null` for the alternate.
2. THE Generator SHALL ask for Quotes copied exactly, 4 to 25 words each, plus chunk IDs, and SHALL NOT ask for offsets.
3. THE Generator SHALL propose a Lock_Type with a one-line justification, and the Core SHALL veto the proposal when the cheap structural signals for that type are absent.
4. THE Core SHALL apply a veto only to reject a Lock_Type, and SHALL NOT change a proposed Lock_Type to another one.
5. THE Generator prompt SHALL state the "generated only when" rule for each Lock_Type and SHALL allow the model to choose no lock for a concept.
6. IF a concept supports no Lock_Type, THEN THE Pipeline SHALL set the concept aside and SHALL NOT force a type to fill a quota.
7. THE Pipeline SHALL validate each Generator response with the Authoring_Schema.
8. IF a Generator response fails the Authoring_Schema, THEN THE Pipeline SHALL retry once with the validation error included, and IF the retry also fails, THEN THE Pipeline SHALL set the item aside and count it as `schema-rejected`.
9. WHERE a Lock_Type's Release_Status is `samples-only`, THE Generator SHALL NOT be asked to produce that Lock_Type for learner notes.
10. THE Pipeline SHALL NOT execute any model-written code or expression.

### Requirement 15: Blind review (P3)

**User Story:** As a learner, I want a second reader to answer each question without seeing the key, so that ambiguous questions are set aside.

#### Acceptance Criteria

1. THE Blind_Reviewer SHALL make one model call per question.
2. THE Blind_Reviewer prompt SHALL contain the question text, the options or steps in manifest order, and the full text of each cited chunk.
3. THE Blind_Reviewer prompt SHALL NOT contain the key, any option label, the explanation or the generator's intent.
4. THE Blind_Reviewer SHALL answer first and then label each option or step, and SHALL use `unknown` where the notes do not say.
5. IF the Blind_Reviewer's answer differs from the key, THEN THE Pipeline SHALL reject the question.
6. IF the Blind_Reviewer labels any option or step `unknown`, THEN THE Pipeline SHALL reject the question.
7. WHEN a question passes review, THE Pipeline SHALL describe it to the learner as "Blind model review passed" and SHALL NOT use the words on the banned-language list.
8. IF the Blind_Reviewer response fails its Zod schema, THEN THE Pipeline SHALL retry once and, on a second failure, SHALL reject the question.
9. WHEN the Pipeline accepts a question, THE Pipeline SHALL describe the evidence as "Source excerpt matched".
10. THE Blind_Reviewer and the Generator SHALL use separate prompts, and the Blind_Reviewer SHALL NOT see Generator output beyond the question itself.

### Requirement 16: Room assembly and publish (P3)

**User Story:** As a learner, I want rooms that open only when they are complete and checked.

#### Acceptance Criteria

1. WHEN the Pipeline assembles a room, THE Pipeline SHALL include at most one lock of each Lock_Type.
2. WHEN the Pipeline assembles a room, THE Leak_Scan SHALL run over the whole room, and IF it fails, THEN THE Pipeline SHALL swap in an accepted question or drop the question, and SHALL re-run the Leak_Scan.
3. WHEN a manifest has passed the Manifest_Schema and the Manifest_Check, THE Pipeline SHALL publish it, and THE published manifest SHALL be immutable.
4. THE Pipeline SHALL mark a room playable with a `RoomPublished` event, and SHALL leave streaming a new room into a running game as an open point.
5. THE Pipeline SHALL, for Gate 1, generate the complete one-room crypt before the run starts.
6. IF a room has no accepted questions, THEN THE Pipeline SHALL NOT publish that room.

### Requirement 17: Sufficiency (P6)

**User Story:** As a learner, I want an honest message when my notes cannot support the run I asked for.

#### Acceptance Criteria

1. WHEN concept extraction finishes, THE Pipeline SHALL compute in code the number of good concepts against the chosen length.
2. IF the number of good concepts is below the chosen length's requirement, THEN THE Pipeline SHALL offer a shorter run with a message that states the number found.
3. THE Pipeline SHALL NOT lower any Code_Check, reviewer rule or Quote rule to reach the chosen length.

### Requirement 18: Conflict check (P6)

**User Story:** As a learner, I want concepts whose notes contradict each other left out, with a reason.

#### Acceptance Criteria

1. WHEN two concepts share a label and give different numbers with the same unit in different chunks, THE Conflict_Checker SHALL mark them as conflicting in code before any model call.
2. WHEN code finds no conflict, THE Conflict_Checker SHALL make one model call per room asking whether any other passage contradicts each accepted answer, and requiring a Quote.
3. IF a model-reported conflict has no Quote that the Quote_Resolver resolves, THEN THE Conflict_Checker SHALL ignore that report.
4. IF a conflict is confirmed, THEN THE Pipeline SHALL exclude the concept before publishing and SHALL tell the learner which passages conflict.
5. WHEN the `pipeline:conflict-check` fixture runs, THE Code_Checks SHALL pass it and THE Conflict_Checker SHALL reject it.

### Requirement 19: Final door (P6)

**User Story:** As a learner, I want a final door that mixes concepts from every room and can always be escaped.

#### Acceptance Criteria

1. WHEN rooms are assembled, THE Pipeline SHALL reserve 0 to 4 final-door questions from leftover accepted concepts.
2. WHERE at least 2 leftover accepted concepts exist, THE Pipeline SHALL reserve 2 to 4 final-door questions.
3. IF fewer than 2 leftover accepted concepts exist, THEN THE Pipeline SHALL produce a final door with ghosts only and SHALL still allow escape.
4. THE Pipeline SHALL emit each final-door question as a full slot spec with `slotId`, `conceptId` and `question`, and Lock_Types MAY repeat across final-door slots.
5. THE Core SHALL assume that the runtime escapes at once when the final door is entered with nothing open.

### Requirement 20: Metrics (P4)

**User Story:** As the developer, I want each number defined once, so that every report uses the same terms.

#### Acceptance Criteria

1. THE evaluation SHALL report, per Lock_Type and overall, candidates, accepted, Wrong_Accepted, Correct_Rejected and concepts covered.
2. THE evaluation SHALL define candidates as questions the Generator returned after schema validation.
3. THE evaluation SHALL define accepted as passing the Code_Checks, the Blind_Reviewer and the Conflict_Checker.
4. THE evaluation SHALL report the number of generated crypts with at least one bad question, out of N crypts generated.
5. THE evaluation SHALL report a verifier ablation, with Wrong_Accepted with review against without review, over the same candidates rescored.
6. THE evaluation SHALL report adversarial results as fixtures rejected by the expected layer over total fixtures.
7. THE evaluation SHALL report cost and latency per playable crypt, counting discarded candidates, with p50 and p90 time to first playable room.
8. THE evaluation SHALL report Wrong_Accepted, Correct_Rejected and failures with their real counts.
9. THE evaluation SHALL tune prompts, model choice and verifier experiments on `eval/dev/` only.
10. THE evaluation SHALL NOT read, tune against or summarise `eval/holdout/` until the configuration is frozen, and SHALL read it once, for the final run.

### Requirement 21: Evaluation runs and records (P4)

**User Story:** As the developer, I want each paid run recorded with enough detail to reproduce it, and capped in cost.

#### Acceptance Criteria

1. THE Evaluation_Skill SHALL be the only path to a real Provider call for evaluation.
2. THE Evaluation_Skill SHALL reserve budget before each call and SHALL stop when the cap is reached.
3. WHEN an evaluation run finishes, THE Evaluation_Skill SHALL write a result to `eval/results/<date>.json` with provider, model ID, Prompt_Digests, temperature, Check_Version, timings, token counts and cost, and SHALL NOT write a run that fails Requirement 12, criterion 10.
4. THE result file SHALL NOT contain notes text, prompts, model responses beyond the question under test, or credentials.
5. THE evaluation SHALL record the provider choice and its reason after the Dev_Set run.
6. THE result file SHALL be parseable by a Zod schema, and FOR ALL valid result objects, serialising then parsing SHALL return an equal object (round-trip property).

### Requirement 22: Remaining lock types (P5)

**User Story:** As a learner, I want bone ordering, bound threads, cursed object and combination dial when my notes support them.

#### Acceptance Criteria

1. THE Core SHALL implement bone ordering with checks `step-count`, `duplicate-steps` and `no-explicit-sequence-marker-in-quotes`, and SHALL generate it only from an explicit sequence.
2. THE Core SHALL implement bound threads with checks `pair-count` and `not-one-to-one`, and SHALL generate it only for strict one-to-one pairs.
3. THE Core SHALL implement cursed object with checks `item-count`, `answer-not-an-item`, `missing-category-rule` and `needs-category-and-outside-quotes`, and SHALL generate it only from an explicit category.
4. THE Core SHALL implement combination dial with checks `missing-units`, `number-not-in-quote`, `range-not-in-quote`, `template-not-allowlisted`, `template-input-not-in-quote`, `template-value-mismatch`, `model-written-expression` and `dial-range-prompt`.
5. THE Core SHALL allow only the templates `difference(a, b)` and `percent-change(from, to)`, each with units carried from the Quote and bounded inputs, and SHALL reject any other template.
6. THE Core SHALL compute combination dial values in code, and the model SHALL NOT compute numbers.
7. IF a range answer asks for more than one value, THEN THE Code_Check SHALL fail with `dial-range-prompt`.
8. WHEN P5 is complete, THE Manifest_Schema SHALL validate the payload and hint shapes of all six Lock_Types.
9. WHEN P5 is complete, THE Code_Checks SHALL pass every Dev_Set and Sample_Set question and SHALL fail each `code:*` fixture with exactly its expected Check_ID.
10. THE open point on streaming later rooms into a running game SHALL be recorded in the design and SHALL NOT be solved in this spec.

### Requirement 23: Release status (P6)

**User Story:** As a learner, I want only Lock_Types that tested well on my own notes, with weaker types kept to human-reviewed samples.

#### Acceptance Criteria

1. THE Core SHALL hold a Release_Status per Lock_Type as configuration that the last evaluation drives.
2. WHERE the last evaluation meets the release rule in criterion 4 for a Lock_Type, THE Core SHALL set its Release_Status to `released`.
3. WHERE the last evaluation does not meet the release rule in criterion 4 for a Lock_Type, THE Core SHALL set its Release_Status to `samples-only`.
4. THE Core SHALL set a Lock_Type's Release_Status to `released` only WHERE, on the Dev_Set, its Wrong_Accepted is at most 5 percent of the rated accepted questions for that Lock_Type AND at least 10 accepted questions of that Lock_Type have been rated; WHERE fewer than 10 rated accepted questions exist for that Lock_Type, THE Core SHALL set its Release_Status to `samples-only`.
5. WHERE a Lock_Type is `samples-only`, THE Pipeline SHALL include it only in Human-reviewed sample crypts.
6. THE sample crypt UI copy SHALL use the label "Human-reviewed" only for sample crypts.

### Requirement 24: Pipeline-wide adversarial tests (P3, P6)

**User Story:** As the developer, I want the reviewer and the conflict check measured against known-bad questions.

#### Acceptance Criteria

1. WHEN the P3 pipeline tests run with Cassettes, THE Pipeline SHALL reject each rune cipher and séance board `review:*` fixture at the review layer.
2. WHEN the P3 pipeline tests run with Cassettes, THE Pipeline SHALL reject any question whose Quote does not resolve before it reaches the Blind_Reviewer.
3. FOR ALL candidate sets, THE Pipeline SHALL accept only questions whose Quotes resolve uniquely (G-P1).
4. FOR ALL accepted rooms, THE Leak_Scan SHALL find no rune cipher answer in another concept's visible text (G-P3).
5. THE test suite SHALL report fixtures rejected by an unexpected layer as failures.

### Requirement 25: Security and privacy (P2 onward)

**User Story:** As a learner, I want my notes treated as private data that no instruction inside them can redirect.

#### Acceptance Criteria

1. THE Pipeline SHALL treat uploaded text and every model response as untrusted data.
2. THE Pipeline SHALL validate every model response with Zod and SHALL reject any response outside the schema.
3. THE Pipeline SHALL decide in code the allowed Lock_Types, chunk membership, answer keys and everything that affects scoring.
4. THE Pipeline SHALL give the model no tools, network access or secrets.
5. THE Worker SHALL bound output tokens, retries, concurrency and calls per job.
6. THE Worker SHALL enforce request size and token limits on the server.
7. THE Worker SHALL bind job retrieval and cancellation to the originating anonymous session, and SHALL bind idempotency keys to the session and the request digest.
8. THE Worker SHALL log only status, counts, timings and error types, and SHALL NOT log notes text, prompts, model responses or access codes.
9. WHEN the Worker returns a response that carries user content, THE Worker SHALL set `Cache-Control: private, no-store`.
10. THE Worker SHALL delete job source text and results after a stated TTL.
11. THE React app SHALL render question text, options and excerpts as plain text, and SHALL NOT use `dangerouslySetInnerHTML` with model or user content.

### Requirement 26: Honest language and build log (P1 onward)

**User Story:** As a reader of the code, UI and docs, I want plain claims that match what was measured.

#### Acceptance Criteria

1. THE Core, UI copy, docs and README text produced by this spec SHALL NOT contain the banned phrases from the evidence-and-honesty rule.
2. THE Core SHALL expose the banned-phrase list as one data constant that `banned-phrase` and a repository lint test both use.
3. WHEN this spec adds user-facing labels, THE labels SHALL be drawn from "Source excerpt matched", "Blind model review passed", "Human-reviewed", "Challenged: excluded from score" and "Review due".
4. WHEN the build log is updated for this spec, THE entry SHALL state that the planning briefs and the eval dev, adversarial and sample sets were drafted with Claude outside Kiro, and that all specs, code, tests and hooks are authored by Kiro.
5. THE evaluation write-up SHALL report real numbers, including Wrong_Accepted and failures.

### Requirement 27: Gate 1 sample crypt (P1)

**User Story:** As the developer reaching Gate 1, I want a playable one-room crypt built from the human-heart sample without any provider, so that the game has a working crypt if generation is not ready.

#### Acceptance Criteria

1. THE Manifest_Mapper SHALL build a one-room `CryptManifest` from the `samples/human-heart` notes (`samples/human-heart.txt`) and its rune cipher and séance board questions in `samples/questions/`, mapping paragraph numbers to chunk IDs through the ingestion chunker.
2. THE Manifest_Mapper SHALL include 0 to 4 reserved final-door questions in that manifest, each a full slot spec with `slotId`, `conceptId` and `question`, drawn from `samples/human-heart` questions that are not used as room locks.
3. WHEN the sample crypt is built, THE Manifest_Schema SHALL accept it and Manifest_Check SHALL pass it.
4. IF a sample question fails a Code_Check or cannot be mapped to a chunk ID, THEN THE Manifest_Mapper SHALL return a typed error that names the question and SHALL NOT produce a partial manifest.
5. THE Core SHALL export the built manifest, or a function that builds it, for the app as the sample crypt.
6. THE sample crypt SHALL carry the label "Human-reviewed" only after a human has reviewed its questions, and the review status SHALL be recorded as data in the sample files, not inferred by code.
7. THE sample crypt code and tests SHALL import no Provider, Cassette, Budget_Ledger, network or AI SDK module, and SHALL make no model call.
8. FOR ALL builds of the sample crypt from the same input files, THE Manifest_Mapper SHALL produce an equal manifest (determinism property).
9. THE sample crypt SHALL carry the mapped hints of Requirement 8, criteria 8 to 10, so that every sample rune cipher question has `reveal-first-letter` and every sample séance board question with a `contradicted` option has `remove-option`.

### Requirement 28: Interim Worker Budget_Ledger (P2)

**User Story:** As the developer, I want a hard spending cap on real model calls before spec 6 exists, so that a bug or abuse cannot run up the bill.

#### Acceptance Criteria

1. THE Core SHALL define a Budget_Ledger interface with `reserve`, `reconcile` and `release` operations that return typed results and never throw.
2. THE Worker SHALL provide an Interim_Ledger that implements the Budget_Ledger interface in memory, with a daily hard cap in USD read from the environment variable `DAILY_BUDGET_USD`.
3. WHEN the Pipeline requests a reservation, THE Interim_Ledger SHALL compute the worst-case cost as input tokens times the input price plus the requested maximum output tokens times the output price, and SHALL grant the reservation only when the day's reserved and spent total plus that cost stays within the daily hard cap.
4. IF a reservation would exceed the daily hard cap, THEN THE Interim_Ledger SHALL return a typed `budget-exhausted` result and the Pipeline SHALL NOT make the call.
5. WHEN a Provider call completes, THE Pipeline SHALL reconcile the reservation with the actual token usage, and THE Interim_Ledger SHALL replace the reserved amount with the actual cost.
6. IF a Provider call fails before any usage is reported, THEN THE Pipeline SHALL release the reservation, and THE Interim_Ledger SHALL return the reserved amount to the day's remaining budget.
7. WHEN the UTC date changes, THE Interim_Ledger SHALL start a new daily total at zero.
8. THE Worker documentation SHALL state that the Interim_Ledger resets when the Worker restarts, that this deviates from the transactional ledger in the security rule, and that a monthly spending limit on the provider account is the backstop until spec 6.
9. IF the environment variable `DAILY_BUDGET_USD` is missing or is not a positive number, THEN THE Worker SHALL refuse to start Jobs and SHALL return a typed `budget-exhausted` result.

### Requirement 29: Worker job API contract (P3)

**User Story:** As a learner, I want to start a generation job from my notes and fetch the result privately, so that nobody else can read my crypt.

#### Acceptance Criteria

1. WHEN a client sends `POST /jobs` with a valid body, THE Worker SHALL create a Job, start the Pipeline in the background and respond with the Job identifier and status without waiting for the Pipeline to finish.
2. WHEN a client sends `GET /jobs/:id` with the Session_Token that created the Job, THE Worker SHALL respond with the Job status, and with the Crypt_Bundle once the Job has completed.
3. IF a client sends a Job request with a missing or malformed `X-Session-Token` header, THEN THE Worker SHALL reject the request with a typed error, and IF a client sends `GET /jobs/:id` or a cancellation with a well-formed Session_Token that differs from the one that created the Job, THEN THE Worker SHALL respond identically to the response for a Job that does not exist.
4. WHEN a client sends `POST /jobs` with an idempotency key that the same session already used with the same request digest, THE Worker SHALL return the existing Job and SHALL NOT start new work.
5. IF a client sends `POST /jobs` with an idempotency key that the same session already used with a different request digest, THEN THE Worker SHALL respond with a typed conflict error and SHALL NOT start new work.
6. IF the request body is larger than the configured byte limit, or the notes text is above the 6,000-word cap, THEN THE Worker SHALL reject the request with a typed error before any model call.
7. THE Worker SHALL validate the `POST /jobs` body with Zod, and SHALL accept only notes text and a requested run length.
8. THE Worker SHALL answer cross-origin requests only for the origin in the environment variable `WEB_ORIGIN`, SHALL allow the `X-Session-Token` request header, and SHALL NOT allow credentials.
9. WHEN a Job fails, THE Worker SHALL report one of the typed learner-visible failures `budget-exhausted`, `not-enough-material`, `generation-failed`, `cancelled` or `expired`, with a plain-language message and without any notes text, prompt or model output.
10. WHEN the Job_TTL has passed since a Job reached a terminal status, THE Worker SHALL delete the Job's notes text and result and keep a Tombstone, and a later `GET /jobs/:id` with the Session_Token that created the Job SHALL respond with `{ status: 'expired' }` and `Cache-Control: private, no-store`.
11. THE Worker SHALL delete expired Jobs and Tombstones by a periodic sweep that runs at least once every minute, and WHEN the Tombstone_TTL has passed, THE Worker SHALL delete the Tombstone, after which `GET /jobs/:id` SHALL respond identically to the response for a Job that does not exist.
12. WHEN the Worker starts, THE Worker SHALL respond to `GET /health` with a status that carries no Job data.
13. THE Worker SHALL store only a hash of the Session_Token with each Job and Tombstone, and a Tombstone SHALL hold no notes text, result or prompt.
14. THE Worker SHALL meet the privacy rules of Requirement 25 (no content in logs, `Cache-Control: private, no-store`, session binding), and this requirement adds no further privacy rule.
15. WHEN a client sends `POST /jobs` with a session, an idempotency key and a request digest that match a Tombstone that has not been swept, THE Worker SHALL return `{ jobId, status: 'expired' }` for the existing Job, and SHALL NOT start new work, make a budget reservation or make a Provider call; and WHEN the Tombstone has been swept, THE Worker SHALL treat the idempotency key as unused and start a new Job as normal. Criterion 29.5 applies to a matching Tombstone with a different request digest, and a different session never matches the Tombstone.

### Requirement 30: Withdrawn (P3)

**User Story:** Withdrawn, so that the numbering of Requirements 28, 29 and 31 stays stable.

#### Acceptance Criteria

1. Withdrawn: covered by G8 and Requirement 21.3.

### Requirement 31: Crypt_Bundle (P3)

**User Story:** As a learner, I want the finished crypt to carry its question text and source excerpts, so that every lock shows its evidence.

#### Acceptance Criteria

1. WHEN the Pipeline publishes a room, THE Pipeline SHALL produce a Crypt_Bundle that holds the `CryptManifest` and the Crypt_Content for every question in it, built from the Manifest_Mapper output.
2. THE Pipeline SHALL pass the manifest through `validateManifestForPublish` and the Crypt_Content through its Zod schema before it returns a Crypt_Bundle.
3. THE Crypt_Content SHALL hold no answer key or option label.
4. THE Core SHALL expose the label "Blind model review passed" as one constant in Core copy, and the label SHALL NOT contain any phrase on the banned-language list.
5. WHEN the learner edited extracted PDF text, THE Crypt_Bundle citations SHALL use the label of Requirement 4, criterion 11.
6. WHEN a concept has an accepted question that does not receive a room slot, THE Crypt_Bundle SHALL keep that concept, its `QuestionSpec` and its Crypt_Content entry in `unplacedAccepted`, validated with the same schemas, and THE Crypt_Bundle SHALL NOT include it in the manifest rooms or final door, SHALL NOT make it playable, and SHALL NOT count it as published.
