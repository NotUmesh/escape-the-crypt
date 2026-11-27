# How Kiro was used: write-up skeleton

First draft for review. Each section lists the evidence that already exists in the repo, with paths, build-log entries and commit hashes. Anything that cannot be shown from the repo yet is marked **TODO (capture)**: a screenshot, a recording, or the author's own account of what happened.

**Where numbers come from.** Every number below is one of: a count from a command shown next to it, a value copied from a file in the repo (`eval/results/*.json`, `docs/build-log.md`), or a commit hash from `git log`. Counts were taken on 2026-11-27 at HEAD `6be0ebc` plus uncommitted edits. TODO (capture): re-run the commands on the final commit and update the figures.

**Sessions.** TODO (capture): which work was done in Kiro spec sessions and which in vibe sessions, if you want to name them.

## Evidence index

| Kiro feature | Where it shows in the repo | Status |
| --- | --- | --- |
| Specs | `.kiro/specs/` (6 folders), `docs/briefs/` | Strong |
| Steering | `.kiro/steering/` (8 files, all three inclusion modes) | Strong |
| Hooks | `.kiro/hooks/` (1 hook) | Thin: one hook |
| Property-based testing | fast-check across `packages/core`, `apps/web`, `apps/worker`; build-log entry on Property 12 | Strong |
| Custom agents | none in the repo | TODO (capture) |
| MCP | none in the repo | TODO (capture) |
| Powers | none in the repo; `packages/core` is built to be packageable | TODO (capture) |
| Skills | `.kiro/skills/evaluation/SKILL.md` and the files it produced | Strong |
| Surfaces | git history only | TODO (capture) |

---

## 1. Specs

**What they were used for.** Each major part of the game started as requirements, then design, then a task list, before code. All six folders use the requirements-first workflow (`workflowType` in each `.config.kiro`). Some specs began as a hand-written brief in `docs/briefs/`, which Kiro then turned into requirements.

| Spec | Folder | Commits |
| --- | --- | --- |
| 1 Ingestion and evidence | `.kiro/specs/ingestion-and-evidence/` | `4268dae` requirements, design, tasks; `60d29d2` "Spec 1 complete" |
| 2 Room runtime | `.kiro/specs/room-runtime/` | `2e455b9` brief and requirements; `84693b1` design and tasks; `702dccc` "spec 2 complete" |
| 3 Generation and evaluation | `.kiro/specs/generation-and-evaluation/` | `646704a` phase 1; `9baf6f0` phase 1 complete; `8b8061d` design and tasks for phases 2 and 3; `974395c` phase 3 built; `e3b6b39` phase 5 design and tasks; `c055c8f` phase 5 built |
| Room play | `.kiro/specs/room-play/` | `c7351de` requirements, design, tasks; `e69e1fc` reconciliation; `337c163` task 13 checkpoint |
| 4 Persistence | `.kiro/specs/persistence/` | `6a38f27` brief with addendum; `f2d3471` design and tasks; `f67a049`, `13ef593`, `b0bcbfd` phases 1 to 4 |
| Lock types | `.kiro/specs/lock-types/` | `1e4c0f7` requirements, design, tasks (in progress) |

Briefs that fed specs: `docs/briefs/room-runtime-spec-brief.md`, `docs/briefs/spec3-generation-and-evaluation-brief.md`, `docs/briefs/spec4-persistence-brief.md`. Each spec's design lists numbered correctness properties: 109 headings in total (`grep -cE '^(###? |\*\*)?Property [0-9]+' .kiro/specs/*/design.md`, summed over the six files: 29, 23, 11, 21, 10, 15).

**Story: the spec caught bugs before code.** `docs/build-log.md`, "Room runtime: reducer, judges, ghosts, final door, outcomes (spec room-runtime, task 7.8)", lists 14 problems found in review, by stage:

- Requirements (3): a wrong return 1 at the final door would have left the concept with no outcome; the Challenged outcome was unreachable; job events were rejected before RunStarted.
- Design (4): bound-threads used a `Set`, which JSON drops, so answers would vanish on reload; reserved final-door questions had no content; judges could not see which hint was applied; a challenged primary followed by a correct alternate matched none of the five outcomes.
- Code review (4), tests (2), process (1): see the entry.

**Story: the spec was revised when the code taught something.** `docs/build-log.md`, "Property 12 caught a design flaw in the chunker merge step", ends with "Design step 4 updated" (see section 4). Room-play has a reconciliation commit (`e69e1fc`) and the persistence spec has a brief addendum (`6a38f27`, "aligned to the built runtime and room-play").

**Gaps.**
- TODO (capture): a screenshot of Kiro's spec view for one spec (requirements, design and task list), ideally with a task being run.
- TODO (capture): one moment where Kiro's requirements or design pushed back on the brief, in the author's words.
- TODO (capture): `docs/build-log.md` has an empty first entry (2026-11-23: "Kiro:" and "Broke / caught:" are blank) and no entries for specs 3, 4 and room-play. Add them from memory or from the commit messages.

---

## 2. Steering

**What it was used for.** Eight steering files hold the rules every session must follow. They use all three inclusion modes, which is a good thing to show:

| File | Inclusion | Purpose |
| --- | --- | --- |
| `.kiro/steering/product.md` | always | What the game is, the core loop, non-goals |
| `.kiro/steering/evidence-and-honesty.md` | always | Quote and chunk-ID rules, labels we use, wording we never use |
| `.kiro/steering/structure.md` | always | Repo layout, file-size and naming rules |
| `.kiro/steering/tech.md` | always | Stack, commands, testing rules |
| `.kiro/steering/design-system.md` | file match (`apps/web/src/**/*.tsx`, `*.css`, `apps/web/public/art/**`) | Palette, type, art rules, lock objects, motion |
| `.kiro/steering/accessibility.md` | file match (`apps/web/src/**/*.tsx`, `*.css`) | Lantern mode, keyboard, screen readers, touch |
| `.kiro/steering/security.md` | file match (`apps/worker/**/*.ts`, `packages/core/**/*.ts`) | Untrusted input, budget, privacy, secrets |
| `.kiro/steering/tone.md` | auto (by description) | Voice for UI copy, errors, README |

First committed in `392b7ed` "Add steering docs". It was edited as the build went: `a257ab5` (focus ring on parchment, ember rule), `17a42f7` (Zod migration note), `9baf6f0`, `2e455b9`, `38e0c61` (evaluation command added to `tech.md`).

**Story: steering rules became tests.** The rules are not only read; most are checked by code:

| Rule | Steering file | Check in the repo |
| --- | --- | --- |
| Banned wording and learning-gain claims | `evidence-and-honesty.md` | `packages/core/src/copy-banned-words.test.ts`; `apps/web/src/features/start/new-copy-wording.test.ts` (Property 20); `apps/web/src/features/share/share-card-copy.test.ts` |
| Colour literals only in `tokens.css`; no cross-origin URLs | `design-system.md`, `security.md` | `apps/web/src/features/ingest/style-guard-rules.ts` and `style-guard.test.ts`; `apps/web/src/styles/tokens.test.ts` |
| Files under about 300 lines, kebab-case names, core imports, shared types in one file | `structure.md`, `tech.md` | `scripts/check-structure.ts` (run by `pnpm lint`) and `scripts/structure-checks.test.ts` |
| `packages/core` has no React, database or AI SDK | `tech.md` | `packages/core/src/boundary.test.ts`; `apps/worker/src/boundary.test.ts` |
| Dev set only; tests never write evaluation results | `evidence-and-honesty.md` | `packages/core/src/cassette/no-eval-results-writes.test.ts`, `recorded-only.test.ts` |
| 44 px targets, keyboard, axe | `accessibility.md` | `apps/web/e2e/ingest-layout.e2e.ts`, `crypt-axe.e2e.ts`, `resume-entry-axe.e2e.ts` and the other `*-axe.e2e.ts` files |

**Story: steering shaped a design.** `docs/briefs/front-of-house-design.md` (commit `bace3df` for the code) was written under the design-system, accessibility, evidence-and-honesty and tone rules. It follows the always-lit rule, the single live region and the 44 px targets, and it places the art styles outside `features/ingest/` because the style guard forbids `url()` and viewport units there.

**Gaps.**
- TODO (capture): one before/after where a steering rule changed what Kiro produced (for example the banned-words test failing on a draft string).
- TODO (capture): a screenshot of the steering list in Kiro.

---

## 3. Hooks

**What it was used for.** One hook runs the core tests when a file in `packages/core/src` is saved. CI stays the release gate; the hook is fast feedback.

| Item | Path or commit |
| --- | --- |
| Hook definition (`PostFileSave`, matcher `packages[/\\]core[/\\]src[/\\]`) | `.kiro/hooks/run-core-tests-on-save.json` |
| Script | `.kiro/hooks/run-core-tests.mjs` |
| Added | `5f6b32e` "Add core tests hook on save (task 8)" |
| Changed | `702dccc`: a save under `runtime/` or `locks/` runs only those folders; other core saves run the full core suite; saves outside core are skipped |
| Build-log entries | "First Kiro hook: run core tests on save (spec ingestion-and-evidence, task 8)"; the "Hook change" bullet in the room-runtime entry |

The build log notes that the hook was created with Kiro's `createHook` tool, that the script reads its stdin defensively, and that it writes no logs or content under `.kiro/`.

**Gaps.**
- Only one hook exists. TODO: decide whether to add one more before submission (for example a prompt hook that reminds the agent of the banned-wording list, or a save hook for the web package). Do not describe hooks that are not in the repo.
- TODO (capture): a screenshot or recording of the hook firing on save, and one time it caught a failure.

---

## 4. Property-based testing

**What it was used for.** fast-check is used across the engine, the web app and the worker, including a model-based test of the room runtime.

| Count | Command | Result |
| --- | --- | --- |
| Files that import fast-check | `grep -rl "fast-check" --include=*.ts --include=*.tsx apps packages \| grep -v node_modules \| wc -l` | 121 |
| Files that run a property or command sequence | `grep -rl "fc.assert\|fc.property\|fc.asyncProperty\|fc.commands" --include=*.ts --include=*.tsx apps packages \| grep -v node_modules \| wc -l` | 111 |
| Files that mention a numbered "Property N" | `grep -rln "Property [0-9]*" --include=*.ts packages apps \| grep -v node_modules \| wc -l` | 83 |

**Story: the chunker counterexample.** `docs/build-log.md`, "Property 12 caught a design flaw in the chunker merge step (spec ingestion-and-evidence, task 4.7)".
- Caught: the chunk-size property test, seed `1973783039`, fed one sentence of about 2,400 characters and got chunks of 1,199, 1,200 and 21 characters. A short last piece was merged backward, the merged text was over 1,200 characters, and splitting again cut at the same word boundary, so the short tail came back. The design said a merged piece is never merged again, so nothing fixed it.
- Fixed: when the second split leaves a tail under 40 characters, the last two pieces are rebalanced. Code: `packages/core/src/chunker-rebalance.ts`. Property 12 and requirement 6.14 stayed as written; design step 4 was updated.
- Commit: `70654d4` "Chunker with offset-based splitting and rebalance (task 4)". Test: `packages/core/src/chunker-size.test.ts`.
- TODO (capture): a screenshot of the failing shrunk counterexample, and your own one-line account of how it felt to find a design flaw this way.

**Story: the PDF line-break repair.** Commit `716b9ca` "Reflow PDF line breaks before chunking; property tests and dev notes 11-12".
- Evidence in the commit: `packages/core/src/reflow.ts` (and `reflow.test.ts`, 165 lines added in that commit), generators in `packages/core/src/test-support/wrap-arbitraries.ts` and `line-break-artifacts.ts`, `packages/core/src/chunker-sentence-integrity.test.ts`, `packages/core/src/pipeline/line-break-eval.test.ts`, and two dev notes written to look like PDF text: `eval/dev/notes/dev-11-pdf-sleep-and-memory.txt` and `dev-12-pdf-feedback-and-motivation.txt` (dev-12 contains a hyphenated line break, "im-" then "prove").
- What the code says it does (header of `reflow.ts`): it undoes hard line wrapping so the text the model reads and the text a quote is resolved against are the same string. It joins hyphen breaks, turns other single line breaks inside a paragraph into spaces, leaves blank lines alone, and keeps headings and list items. It is pure and idempotent.
- TODO (capture): the story itself. The build log has no entry for this. Write one (what you saw in the PDF output, which test or quote failure showed it, how the property generators were chosen) and add a build-log entry with the same title as the commit.

**Story: model-based runtime tests.** `packages/core/src/runtime/runtime-model.test.ts` with `packages/core/src/test-support/runtime-model-harness.ts` drives the reducer with random command sequences. Build-log notes under "Bugs caught in review (spec 2)": Property 2 was flaky because random runs rarely got far enough, and model runs ran below 100 iterations with no proof they reached ghosts, so coverage counters were added. The escape-coverage run is pinned with `seed: 424242, numRuns: 300` in that test file.

**Other examples to cite (files exist):** judges never throw on any input (`packages/core/src/test-support/judge-totality.ts`); room assembly never places two concepts with the same answer (`packages/core/src/pipeline/room-assembly-duplicates-property.test.ts`); stored notes round-trip (`packages/core/src/notes-record-roundtrip.test.ts`); export round-trip (`apps/web/src/state/storage/export-run-property.test.ts`); the share card carries no study text (`apps/web/src/features/share/share-card-no-leak.test.tsx`).

**Gaps.** TODO (capture): one more counterexample story from the room runtime or persistence tests, if one exists in your memory; the build log only records one.

---

## 5. Custom agents

Nothing in the repo yet: `.kiro/` has no agents folder, and no commit mentions one.

- TODO (capture): decide whether a custom agent is worth adding before submission. A natural candidate is a "reviewer" that checks new copy and new questions against `evidence-and-honesty.md`. If one is added, commit it and describe only what it did.
- If none is added, leave this section out of the submission rather than inventing one.

---

## 6. MCP

Nothing in the repo yet: there is no `.kiro/settings/mcp.json` and no commit that adds one.

- One related fact, with a boundary: `docs/art/asset-contract.md` says the Blender scenes and renders were made by the author, set up with Claude through a Blender MCP server. That is the art track, not Kiro. Do not present it as Kiro MCP use unless that is true.
- TODO (capture): if an MCP server is used in Kiro before submission, commit its config (without secrets) and describe the task it served.

---

## 7. Powers

Nothing installed or committed. What exists is the groundwork:

- `.kiro/steering/tech.md` says `packages/core` holds the shared engine and "must not depend on React, the database or any AI SDK directly (pass providers in), so it can be packaged as a Kiro Power".
- `packages/core/src/boundary.test.ts` and `scripts/check-structure.ts` check that boundary (core imports only `@noble/hashes` and relative files, and uses no DOM global; see the build-log entry "Integration and structure checks").
- TODO (capture): decide whether to package the engine (quote resolver, contracts, lock checks) as a Power before submission. If not, say plainly that the boundary is prepared and no Power was built.

---

## 8. Skills

**What it was used for.** The evaluation skill is the only route to paid model calls, and it protects the rules around them.

| Item | Path or commit |
| --- | --- |
| The skill | `.kiro/skills/evaluation/SKILL.md` |
| Added | `38e0c61` "…evaluation skill + recorded dev cassettes; seance prompt v2" |
| Runner and capped ledger | `apps/worker/src/evaluation/cli.ts`, `capped-ledger.ts`, `run-dev-set.ts`, `result-file.ts` and their tests |
| Recorded dev cassettes | `packages/core/src/test-support/cassettes/dev/` (12 files) |
| Result files | `eval/results/2026-11-27.json`, `eval/results/2026-11-27-2.json` |

What the skill enforces (from `SKILL.md`): dev set only; the API key stays in the user's shell; every call reserves its worst case against a capped ledger and a refused reservation stops the run; replay is free; result files hold run facts and no notes text, prompts, model output or credentials.

**Facts from the two recorded dev runs** (copied from the result files; these describe a tuning run on the dev set and are not a quality result):

| Field | `2026-11-27.json` | `2026-11-27-2.json` |
| --- | --- | --- |
| Run ID | `2026-11-27T11-46-45-014Z-record` | `2026-11-27T12-20-31-095Z-record` |
| Model, temperature | gpt-5.4-mini, 0.2 | gpt-5.4-mini, 0.2 |
| Check_Version | 2026-11-27.1 | 2026-11-27.1 |
| Budget cap, spent this run | $1.20, $0.330291 | $1.20, $0.259938 (after $0.330291 spent before) |
| Notes in the run (`notes[]`) | 12, all `ok` | 12, all `ok` |
| Live calls / replayed calls (summed from `notes[]`) | 264 / 0 | 185 / 57 |

The current `CHECK_VERSION` is `2026-11-27.2` (`packages/core/src/checks/registry.ts`), so these results predate the latest check changes. TODO: re-record on the final configuration before reporting any number from them.

**Story: the single-lock room.** Commit `38e0c61` is titled "Fix single-lock rooms (promote alternates, hint recompute, leak refill); duplicate-answer check; …". What the repo shows:
- In `eval/results/2026-11-27.json`, 11 of the 12 dev notes assembled a room with 2 locks; `dev-12-pdf-feedback-and-motivation.txt` assembled 1. In `eval/results/2026-11-27-2.json`, all 12 notes assembled 2 locks, and every note reports `duplicateAnswers: 0`.
- The fix and its tests are in the same commit: `packages/core/src/pipeline/room-assembly-select.ts`, `room-assembly-promotion.test.ts`, `room-assembly-duplicates-property.test.ts`, `packages/core/src/checks/duplicate-answers.ts`, and the `replay --policy both` option of the evaluation CLI, which compares assembly policies on recorded cassettes at no cost.
- TODO (capture): the account of how replaying recorded cassettes exposed the bug, in your words: which note, what you saw, what the policy comparison showed, and what changed. The result files alone do not say what came first, so do not state a cause here until you have written it.

**Gaps.**
- TODO (capture): a screenshot of the skill being used in Kiro, with the spend cap in view.
- TODO (capture): the final held-out run through the same skill, once the configuration is frozen. The README's "Measured quality" table is waiting for it.

---

## 9. Surfaces

The repo shows work done in the Kiro IDE (spec folders, hooks created with `createHook`, steering with inclusion modes, a skill). Nothing in the repo shows which other Kiro surfaces were used.

- TODO (capture): list every surface used (IDE chat, spec view, hooks panel, autopilot or supervised mode, CLI if any), with one screenshot each.
- TODO (capture): the time split between spec sessions and vibe sessions, if you want to state it. Do not state a ratio that is not recorded.

---

## Submission checklist for this document

- [ ] Re-run the counting commands on the final commit and update every figure.
- [ ] Fill each TODO (capture), or delete the sentence it sits under.
- [ ] Add the missing build-log entries (first entry blank fields, PDF line breaks, specs 3, 4, room-play, evaluation skill).
- [ ] Remove sections 5 to 7 from the submission unless something real is added to the repo.
- [ ] Link this file from the README.
