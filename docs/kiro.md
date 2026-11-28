# How Kiro was used: write-up skeleton

First draft for review. Each section lists the evidence that already exists in the repo, with paths, build-log entries and commit hashes. Anything that cannot be shown from the repo yet is marked **TODO (capture)**: a screenshot, a recording, or the author's own account of what happened.

**Where numbers come from.** Every number below is one of: a count from a command shown next to it, a value copied from a file in the repo (`eval/results/*.json`, `docs/build-log.md`), or a commit hash from `git log`. Counts were taken on 2026-11-27 at HEAD `6be0ebc` plus uncommitted edits. TODO (capture): re-run the commands on the final commit and update the figures.

**Sessions.** TODO (capture): which work was done in Kiro spec sessions and which in vibe sessions, if you want to name them.

## Evidence index

| Kiro feature | Where it shows in the repo | Status |
| --- | --- | --- |
| Specs | `.kiro/specs/` (6 folders), `docs/briefs/` | Strong |
| Steering | `.kiro/steering/` (8 files, all three inclusion modes) | Strong |
| Hooks | `.kiro/hooks/` (3 hooks, all tested in `scripts/hooks/`; the original full-suite hook is retired) | Strong; each needs one captured run |
| Property-based testing | fast-check across `packages/core`, `apps/web`, `apps/worker`; build-log entry on Property 12 | Strong |
| Custom agents | `.kiro/agents/crypt-keeper.md`, `.kiro/agents/design-critic.md` | Written; each needs one captured run on real output |
| MCP | `.kiro/settings/mcp.json` (Playwright server, pinned) | Configured and started once against a local page; needs a captured run in Kiro |
| Powers | `powers/grounded-quiz/` (Grounded Quiz: quote resolver, normaliser and evidence checks from `packages/core`) | Built and tested; needs one captured install and run in Kiro |
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
| Banned wording and learning-gain claims | `evidence-and-honesty.md` | `packages/core/src/copy-banned-words.test.ts`; `apps/web/src/features/start/new-copy-wording.test.ts` (Property 20); `packages/core/src/copy-share.test.ts`; `packages/core/src/copy-front-of-house.test.ts` |
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

**What they are used for.** Three hooks give fast feedback on save. CI stays the release gate. None runs a whole package: each runs the one or two test files, or the one check, that belongs to the file just saved. The first hook ever written here (`run-core-tests-on-save`, commit `5f6b32e`, extended in `702dccc`) ran the whole core suite on most core saves. It is retired: its two files were deleted when the related-tests hook replaced it, because a full core run took 24.36 s on 2026-11-27 (149 files, 1,177 tests in the `pnpm test` run that day) and that is too slow to run on every save. Its history stays in `docs/build-log.md` ("First Kiro hook", "Hook change").

| Hook | File | Fires on | Runs | Tested by |
| --- | --- | --- | --- | --- |
| Run related core tests on save | `.kiro/hooks/related-core-tests-on-save.json`, script `scripts/hooks/related-tests.ts` | a `.ts` or `.tsx` save under `packages/core/src` | the tests named after the file, the tests that import it, the tests that import a module that imports it, or the tests named after that module, whichever set is first non-empty and at most 12 files | `scripts/hooks/related-tests.test.ts` |
| Check tasks.md format on edit | `.kiro/hooks/check-tasks-format-on-edit.json`, script `scripts/hooks/check-tasks-format.ts` | any `.kiro/specs/*/tasks.md` | the format check on that one file (checkbox syntax, numbering at three levels, parent and child consistency, requirement lines, garbled characters) | `scripts/hooks/tasks-format.test.ts` |
| Run the wording test on copy edit | `.kiro/hooks/banned-words-on-copy-edit.json`, script `scripts/hooks/banned-words-tests.ts` | a `copy*.ts` or `*-copy.ts` file in core or web, or its test | `packages/core/src/copy-banned-words.test.ts` for core copy; the test named after the file for web copy; a message when a web copy file has no test | `scripts/hooks/banned-words-tests.test.ts` |

All three use `PostFileSave` and a `command` action, and were made with Kiro's `createHook` tool. `scripts/hooks/hook-definitions.test.ts` reads every file in `.kiro/hooks/` and checks that exactly these three exist, that each matcher accepts and rejects the right paths (in both slash styles), that each command names a script that exists, and that none calls `pnpm`, `vitest` or `--run`. These tests run under `pnpm test` (the `scripts` project).

**How the related-tests hook stays small.** It reads the files under `packages/core/src` once, builds the import map, and picks the first set that is not empty and fits under 12 test files. A test in `scripts/hooks/related-tests.test.ts` plans every real non-test file in `packages/core/src` and asserts none gets more than 12. Run by hand on 2026-11-27 (this machine, one run each):

| Saved file | What the hook did |
| --- | --- |
| `packages/core/src/runtime/apply.ts` | 30 test files reach it, over the cap, so it ran the 2 named after it: 2 files, 26 tests, 0.677 s wall time |
| `packages/core/src/chunker-rebalance.ts` | 24 test files reach it and none is named after it, so it ran the 10 named after the modules that import it (`chunker*.test.ts`) |
| `packages/core/src/types.ts` | 147 test files reach it, so it ran nothing and said so |

The wording hook on `packages/core/src/copy.ts` ran 1 test file, 9 tests, 0.482 s wall time. On `apps/web/src/features/share/share-card-copy.ts` it ran 1 file, 5 tests (vitest reported 891 ms). That file has since moved to `packages/core/src/copy-share.ts`, where the hook runs the shared core test and `copy-share.test.ts`.

**What the tasks hook found.** `node scripts/hooks/check-tasks-format.ts --all` reports 22 lines with garbled characters in `.kiro/specs/generation-and-evaluation/tasks.md` (UTF-8 text saved as Windows-1252, for example "â€“" where an en dash was meant). The other task lists pass. That file belongs to the generation work and the fix is left to that session's next checkpoint. The hook also taught its own rules: its first version knew only two levels of tasks, and `.kiro/specs/haunting-polish/tasks.md` (Kiro's "4.2.1 Property 1" tasks) failed it, so it now accepts three levels.

**Requirements.** Node 22.18 or newer (the scripts are TypeScript run by `node` directly, like `scripts/check-structure.ts`), and a restart of the Kiro session so it picks up new hook files. The room-runtime brief (`docs/briefs/room-runtime-spec-brief.md`, line 144) records that file hooks fire on agent edits and not on manual edits in the editor, so capture a hook by asking Kiro's chat to make the edit.

**Capture recipes (TODO (capture): one screenshot each, saved in `docs/captures/`).**
1. Related tests: ask Kiro to add and then remove a blank line in `packages/core/src/chunker-rebalance.ts`. Capture the hook's output. By hand: `node scripts/hooks/related-tests.ts --file packages/core/src/chunker-rebalance.ts`.
2. Tasks format: ask Kiro to re-save `.kiro/specs/room-play/tasks.md` (clean result), then `.kiro/specs/generation-and-evaluation/tasks.md` (the garbled lines). By hand: `node scripts/hooks/check-tasks-format.ts --all`.
3. Wording: ask Kiro to re-save `packages/core/src/copy.ts` unchanged (green). Then, on a scratch branch, ask it to add the word "mastered" inside any string: the test should fail. Discard with `git checkout -- packages/core/src/copy.ts`.

**Gaps.**
- TODO (capture): the three screenshots above, and one real moment where a hook caught something you did not expect.
- TODO (capture): a screenshot of the three hooks listed in Kiro's hooks panel.

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
- What happened (draft from the session record; put it in your own words): crypts generated live from a real PDF of study notes showed words such as "hetero-sexual" in questions, answers and evidence. Kiro traced it before changing anything: `assemblePageText` keeps every hard wrap (`exam-\nple`), `chunkDocument` passed that text unchanged, and `buildNotesBlock` put it straight into the prompt, so the model saw `hetero-\nsexual` and wrote it back with a hyphen. Quote matching still worked, because `normalise.ts` joined the hyphen break only while matching, which is why it never showed up as a failed check.
- The property that pins the fix (`reflow.test.ts`): a paragraph wrapped at a random width from 8 to 90 characters, with or without soft hyphens, trailing spaces and broken page ranges, must reflow back to exactly the unwrapped paragraph; its chunks and chunk IDs must equal those of the unwrapped text; a quote copied from the unwrapped text must resolve; and reflowing twice changes nothing.
- Measured effect (`line-break-eval.test.ts` with `EVAL_REPORT=1`): artifacts in what the model is sent went from 3 hyphen / 3 mid-word / 11 mid-sentence to 0 / 0 / 0 for dev-11, and from 2 / 2 / 16 to 0 / 0 / 0 for dev-12. dev-01 to dev-10 were 0 before and after.
- Known limit, stated in the commit: a compound the PDF wraps at its own hyphen (`well-\nknown`) becomes "wellknown"; no rule can tell it from a soft hyphen.
- TODO (capture): your own two sentences on seeing it in the live crypt, and a build-log entry with the same title as the commit.

**Story: model-based runtime tests.** `packages/core/src/runtime/runtime-model.test.ts` with `packages/core/src/test-support/runtime-model-harness.ts` drives the reducer with random command sequences. Build-log notes under "Bugs caught in review (spec 2)": Property 2 was flaky because random runs rarely got far enough, and model runs ran below 100 iterations with no proof they reached ghosts, so coverage counters were added. The escape-coverage run is pinned with `seed: 424242, numRuns: 300` in that test file.

**Other examples to cite (files exist):** judges never throw on any input (`packages/core/src/test-support/judge-totality.ts`); room assembly never places two concepts with the same answer (`packages/core/src/pipeline/room-assembly-duplicates-property.test.ts`); stored notes round-trip (`packages/core/src/notes-record-roundtrip.test.ts`); export round-trip (`apps/web/src/state/storage/export-run-property.test.ts`); the share card carries no study text (`apps/web/src/features/share/share-card-no-leak.test.tsx`).

**Story: the `answerKey` idempotence counterexample.** While the per-type duplicate-answer checks were extended to the combination dial (2026-11-27, late evening), the property "`answerKey` is idempotent" in `packages/core/src/checks/duplicate-answers*.test.ts` failed with the shrunk input `"A A 0"`. One pass removed one leading article and gave `"a 0"`; a second pass gave `"0"`. The bug had existed since commit `38e0c61`, where the duplicate-answer check was introduced, and every example-based test had passed. Its effect was narrow (two answers that both start with a repeated article might not be recognised as duplicates), but it was a real logic error no hand-written case had covered. Fix: `LEADING_ARTICLE` in `packages/core/src/checks/duplicate-answers.ts` now strips every leading article (`/^(?:(?:a|an|the) )+/`). Landed in commit `745f33d`.
- TODO (capture): a screenshot of the failing property output if you can reproduce it by reverting the regex locally (do not commit the revert).

---

## 5. Custom agents

**What they are used for.** Two read-only reviewers, one for the evidence rules and one for the design rules. Each is a Markdown agent file in `.kiro/agents/` (front matter for the configuration, the body is the system prompt).

| Agent | File | Reads | Can do | Cannot do |
| --- | --- | --- | --- | --- |
| crypt-keeper | `.kiro/agents/crypt-keeper.md` | the steering files `evidence-and-honesty.md`, `product.md`, `tone.md`; whatever file you name | read files, search | write, shell, web, sub-agents, MCP (`tools: ["read"]`, `excludedTools`, `includeMcpJson: false`, and deny rules for file writes, shell, web) |
| design-critic | `.kiro/agents/design-critic.md` | `design-system.md`, `accessibility.md`, `tone.md`, `evidence-and-honesty.md`; source files; the live page | read files, search, and the Playwright browser tools (`tools: ["read", "@playwright"]`) | write files, shell, web, sub-agents |

**crypt-keeper** reviews a generated crypt or an evaluation result against the evidence rules: the quote resolves exactly once in the notes (and is neither too short nor too long), the answer is supported, nothing leaks the answer, choice questions are framed "According to your notes" with options that are supported or contradicted, the copy is honest, and nothing claims a review label it does not have. It uses the check IDs from `packages/core/src/checks/registry.ts`. Given an `eval/results` file it checks structure only, because those files hold no question text. It reports in a fixed format, says what it could not check, and never edits a file or grants "Human-reviewed".

**design-critic** reviews one screen. In source mode it reads the components and the CSS and computes contrast from the design tokens. In live mode it drives the page through the Playwright MCP server (section 6): it resizes to 1280x800 and 390x844, tabs through the controls and writes down the focus order, reads computed colours and sizes, checks 44 px targets, tries reduced motion, and saves screenshots into `docs/captures/`. It reports blockers, should-fixes and nits with the steering rule behind each.

**How to use each once and capture it.** In Kiro, choose the agent from the picker at the bottom of the chat input (Kiro CLI: `kiro-cli --agent crypt-keeper`). Then paste a prompt below.

| Run | Prompt | What a sound report contains (so you can tell it is not made up) |
| --- | --- | --- |
| crypt-keeper on a sample | `Review samples/questions/https.json against samples/https.txt.` | 9 questions: 3 séance board, 2 bound threads, 2 combination dial, 1 bone ordering, 1 cursed object. A one-off script run while drafting found all 6 question-level `evidence` quotes in the notes exactly once; the agent should agree, and should also check the quotes that sit inside options, steps and pairs. The file's `status` says it is a draft, so the report must not call it reviewed. |
| crypt-keeper on a result file | `Review eval/results/2026-11-27.json.` | `checkVersion` is `2026-11-27.1` while the code is at `2026-11-27.2`; 11 of 12 notes assembled 2 locks and `dev-12-pdf-feedback-and-motivation.txt` assembled 1; `duplicateAnswers` is 0 for every note; spend $0.330291 of the $1.20 cap; rejections by Check_ID. |
| design-critic on the notes screen | Start `pnpm dev`, then: `Review the notes screen at http://localhost:5173/ingest in live mode, desktop and phone, then read apps/web/src/features/ingest/ for the source rules.` | A Tab sequence for the screen, measured contrast for the main text pairs, 44 px checks on the buttons, a reduced-motion check, screenshots saved under `docs/captures/design-critic-ingest-*.png`. |

**First real runs (2026-11-28, one Kiro session, screen-recorded).**

*crypt-keeper* read `eval/results/2026-11-27-3.json` (six lock types) and its dev cassettes. Its own report says it read only part of the data (44 of 132 accepted questions in full), so its counts are a sample. What it found, and what happened next:
- **A dial whose units gave the answer away** (dev-04 concept 5 alternate: answer 20, units "July 20"), and **no prompt-leak check for bone ordering**. Both became Code_Checks the same day: `units-reveal-number` and `steps-listed-in-prompt` (commit `7c7e328`, `CHECK_VERSION 2026-11-28.1`). A free replay showed the units check removing exactly that question.
- **Odd-one-out prompts ("Which item is not…") rejected as negative questions.** The cursed-object exemption was widened in the same commit.
- **A suggestion we rejected.** It proposed rejecting any contradicted séance option that cites the supported option's own quote. Tested against the dev and sample questions, that rule rejected good questions: one sentence ("The heart has four chambers") legitimately supports "four" and contradicts "three". The remaining séance cases it flagged are judgement calls left to the blind review. Recorded in `docs/build-log.md`.

*design-critic* reviewed three live screens through Playwright MCP (below): the desk hub, the notes book and the first room of the HTTPS sample, on desktop and phone sizes. Real findings, fixed in commit `5e238bc`: lock-panel and resume buttons rendering as browser-default grey; the accessible status of a lock answered wrongly reading "settled, excluded from score", which was untrue (now "settled, not solved"); no `h1` on the room screen; no visible Close control on an open lock for touch users; a stale "Questions from your own notes are coming later" line; struck-through unavailable length options. One false alarm: a "1.78 px" focus ring came from the browser window's 0.9 device-pixel ratio, not from the 2 px token.

- TODO (capture): your own one line on a finding you agreed with and one you did not.

---

## 6. MCP

**What it is used for.** The Playwright MCP server lets a Kiro agent drive a real browser: open the app, read the page as an accessibility tree, press keys, take screenshots. It is used to play the sample crypt for the demo evidence and to feed the design-critic agent.

**The config.** `.kiro/settings/mcp.json`, a workspace file Kiro merges with the user config:

| Setting | Value | Why |
| --- | --- | --- |
| `command`, `args` | `npx -y @playwright/mcp@0.0.86 …` | Pinned to one version, so the tool list does not change under you |
| `--browser chromium` | | The browser the server uses (it installs as "chrome-for-testing") |
| `--isolated` | | The profile stays in memory; nothing is saved to disk |
| `--viewport-size 1280x800` | | Desktop size for captures; resize for the phone layout |
| `--output-dir docs/captures` | | Screenshots without a file name land here |
| `--allowed-origins` | `http://localhost:5173;http://localhost:4173;https://escape-the-crypt.pages.dev` | Dev server, preview build, live app. The Playwright MCP docs say this is not a security boundary, so it is housekeeping, not protection |
| `disabledTools` | `browser_run_code_unsafe` | Arbitrary code execution is off |
| `autoApprove` | `browser_snapshot`, `browser_take_screenshot`, `browser_console_messages`, `browser_network_requests`, `browser_wait_for`, `browser_click`, `browser_hover`, `browser_type`, `browser_press_key`, `browser_resize`, `browser_emulate_media` | Reading and interacting with the page. `browser_navigate` and `browser_evaluate` still ask each time |

No secrets are in the file. The server was not run headless in the config, so you can watch the browser; add `--headless` to hide it.

**What was checked while writing this.** On 2026-11-27 the pinned server was started with these arguments (plus `--headless`) and driven over stdio against a local test page. It reported 25 tools, and `browser_navigate`, `browser_snapshot` and `browser_take_screenshot` worked; a navigation to `https://example.com/` was blocked by the origin list (`ERR_BLOCKED_BY_CLIENT`). That run did not go through Kiro itself. TODO (capture): the same check in Kiro's MCP panel, as a screenshot of the server connected.

**One-time setup.**
1. In Kiro, make sure MCP support is on (settings, search "MCP"). Saving `mcp.json` reconnects the servers.
2. Install the browser the server uses: `npx @playwright/mcp@0.0.86 install-browser chrome-for-testing`. Without it, every browser tool returns a "browser is not installed" error that names this command.
3. Start the app in a terminal: `pnpm dev` (the dev server listens on `http://localhost:5173` unless that port is taken; if it prints another port, add it to `--allowed-origins`).

**Play the sample crypt through MCP and take screenshots.** In a Kiro chat, with the default agent or design-critic, paste:

> Use the Playwright tools to play the sample crypt on http://localhost:5173/ingest. Paste a short paragraph of notes, press "Confirm notes", then "Enter the crypt". In the first room, open each lock in turn, answer from the sample notes in samples/human-heart.txt as a learner would, and deliberately answer one question wrong so a ghost appears. Read the evidence panel after each answer. Take a screenshot of the room before the first answer (docs/captures/mcp-sample-crypt-room.png), of an evidence panel (docs/captures/mcp-sample-crypt-evidence.png), and of the Autopsy at the end (docs/captures/mcp-sample-crypt-autopsy.png). Report what each screenshot shows and any control you could not reach by keyboard.

Notes for the run:
- The first approval prompt is for `browser_navigate`. Approve it for the session.
- Lock buttons have accessible names such as "Coffin lock: rune cipher, unsolved" (accessibility steering), so the agent can find them in a snapshot. Answers are typed into the panel's input or chosen from its options.
- The live app at https://escape-the-crypt.pages.dev can be used instead of the dev server. Do not paste personal notes into it through a browser tool.
- The entry is the desk hub: start from `/`, then choose a sample crypt from the shelf.
- The server also writes `page-*.yml` snapshots into `docs/captures/`. They are git-ignored; only the screenshots you name are kept.

**Gaps.**
- Screenshots from the 2026-11-28 design-critic run are in `docs/captures/`: `design-critic-desk*.png`, `design-critic-ingest*.png` and `design-critic-room*.png` (desktop, Lantern mode and phone width).
- **What it showed that unit tests could not:** the computed look of the buttons (unit tests checked class names and roles, and passed, while the real browser drew unstyled grey buttons); focus moving into the lock panel and back after Escape and Continue in the full app flow; the phone layout of the length options once every screen was put together.

---

## 7. Powers

**What it is.** `powers/grounded-quiz/` is a Kiro Power, **Grounded Quiz**. It lets someone make a quiz from their own notes in their own Kiro, where every question cites an exact quote and code checks the quote. It packages three parts of `packages/core`: the quote resolver (`quote-resolver.ts`), the normaliser (`normalise.ts`) and the evidence code checks (`checks/` and the per-lock-type checks in `locks/`), plus the document preparation they need (`pipeline/prepare-input.ts`, which includes the line-break repair from section 4). Kiro's model drafts the questions. The tools say whether each one stands.

**Format.** Kiro's current docs build powers on the Agent Plugins specification, so the Power uses `plugin.json`, `mcp.json` and `skills/`, not the older `POWER.md` (which the docs say still works but do not describe). `powers/grounded-quiz/test/manifest.test.ts` checks both manifests against the key sets in the published JSON schemas (`agent-plugins.org/schemas/1.0.0/plugin.schema.json` and `mcp.schema.json`, which were read while building it).

| File | Role |
| --- | --- |
| `powers/grounded-quiz/plugin.json` | Name `grounded-quiz`, version, description, author, keywords that activate it, repository, MIT licence |
| `powers/grounded-quiz/mcp.json` | One stdio server: `node ${PLUGIN_ROOT}/server/index.mjs` |
| `powers/grounded-quiz/skills/grounded-quiz/SKILL.md` | The workflow: prepare, choose, draft, check, repair or set aside, present with sources and the limits |
| `powers/grounded-quiz/skills/grounded-quiz/references/` | `question-formats.md` (five lock types, with real sample questions) and `worked-example.md` (a real run on `samples/human-heart.txt`) |
| `powers/grounded-quiz/README.md` | What it is and is not, install, tools, privacy, how it is built |
| `powers/grounded-quiz/server/index.mjs` | The server and everything it imports from core, bundled into one file (851,289 bytes) so the installed Power needs nothing else |
| `powers/grounded-quiz/src/`, `test/`, `scripts/build.mjs` | Source, tests, and the build |

**The tools** (a small MCP server that holds your notes in memory only): `prepare_notes` (numbered paragraphs and a `notesId`), `resolve_quote`, `check_question`, `check_quiz` (adds the checks that compare questions: leaks and repeated answers), `normalise_text`, `list_checks`. Five lock types are checked: rune cipher, séance board, bone ordering, bound threads, cursed object. Combination dial is not checked in core yet, so the Power says it is unsupported.

**It imports core and changes none of it.** Core's public index does not export `runChecks`, the check registry or the authoring schema, so the Power imports core's source files through one file, `src/core-imports.ts`, and a test asserts that is the only file naming `packages/core`. Nothing under `packages/core` was edited. When core moved on during this work (bound-threads and cursed-object checks landed, and `CHECK_VERSION` went from `2026-11-27.2` to `2026-11-27.4`), the Power's own tests failed in the right places: the bundle's check version no longer matched core's, and a new check had no help text. The Power was extended to match.

**Tests** (`pnpm test`, in the `scripts` project; 7 files, 89 tests on 2026-11-27):
- `tools.test.ts`, `checks.test.ts`: every tool on `samples/human-heart.txt`: the sample crypt's ten supported questions all pass `check_quiz`; a wrong quote, a leaked answer, a negative question, two supported options, a repeated right-hand item, an odd item that is not among the items, and a duplicate answer across questions all fail with the right Check_ID.
- `server.test.ts`: the protocol (initialize, tools/list, tools/call, errors, notifications, split and batched lines).
- `bundle.test.ts`: runs the committed `server/index.mjs` over stdio on the sample notes; asserts it imports nothing but Node's `readline` (no files, no network, no processes), serves the same tool list as the source, and reports the same `CHECK_VERSION` as core.
- `manifest.test.ts`, `docs.test.ts`: the manifests, the skill front matter, banned wording in every document, and the examples in `question-formats.md` and `worked-example.md` run as written against the tools.
- `hygiene.test.ts`: 300-line and kebab-case rules for the Power's own files.
`pnpm typecheck` also runs `tsc -p powers/grounded-quiz`, and `eslint.config.js` ignores the generated bundle.

**Install and use (for the write-up and the video).** In Kiro: Powers panel, **Add Custom Power**, **Import power from a folder**, choose `powers/grounded-quiz` (or **Import power from GitHub** with `https://github.com/NotUmesh/escape-the-crypt/tree/main/powers/grounded-quiz`). Needs Node 20 or newer on the PATH. Then say: "Make a quiz from these notes, with fill-in-the-blank and multiple-choice questions", and paste the text of `samples/human-heart.txt`. Rebuild after core changes with `node powers/grounded-quiz/scripts/build.mjs`.

**Honest limits.** The Power does not generate questions itself and does not run the blind model review. A question that passes is not thereby a good one; the tool results say so in `notChecked`. The committed bundle is a copy of core's code at build time: the tests catch a changed `CHECK_VERSION` or tool list, not every edit to core.

**Gaps.**
- TODO (capture): install the Power in Kiro from the folder, a screenshot of it listed in the Powers panel, and a short recording of one quiz made from `samples/human-heart.txt` with one question failing a check and being repaired. The server has been run over stdio by the tests, not yet inside Kiro, so how Kiro expands `${PLUGIN_ROOT}` is not yet observed here.
- TODO (decision): whether to publish the Power from this repository's `powers/` folder as it stands, or to give it its own repository.

---

## 8. Skills

**What it was used for.** The evaluation skill is the only route to paid model calls, and it protects the rules around them.

| Item | Path or commit |
| --- | --- |
| The skill | `.kiro/skills/evaluation/SKILL.md` |
| Added | `38e0c61` "…evaluation skill + recorded dev cassettes; seance prompt v2" |
| Runner and capped ledger | `apps/worker/src/evaluation/cli.ts`, `capped-ledger.ts`, `run-dev-set.ts`, `result-file.ts` and their tests |
| Recorded dev cassettes | `packages/core/src/test-support/cassettes/dev/` (12 files) |
| Result files | `eval/results/2026-11-27.json`, `eval/results/2026-11-27-2.json` (rune cipher and séance board only), `eval/results/2026-11-27-3.json` (all six lock types) |

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

These two runs predate the later check changes. The six-type re-record after phase 5, `eval/results/2026-11-27-3.json`, ran at Check_Version `2026-11-27.5`: 12 of 12 dev notes published a crypt, 203 live calls, $0.37 spent against a $2.00 cap, p50 10.4 s and p90 14.3 s per note across all stages. Per lock type (candidates / accepted / placed in a room): rune cipher 83 / 65 / 12, séance board 35 / 29 / 9, bone ordering 13 / 12 / 9, bound threads 4 / 3 / 3, cursed object 7 / 4 / 4, combination dial 30 / 19 / 7 (10 of the dial's rejections were `number-not-in-quote`). These are dev-set tuning numbers, not a quality result: no human ratings exist yet, so Wrong_Accepted is unknown.

**Story: the single-lock room.** Commit `38e0c61` is titled "Fix single-lock rooms (promote alternates, hint recompute, leak refill); duplicate-answer check; …". What the repo shows:
- In `eval/results/2026-11-27.json`, 11 of the 12 dev notes assembled a room with 2 locks; `dev-12-pdf-feedback-and-motivation.txt` assembled 1. In `eval/results/2026-11-27-2.json`, all 12 notes assembled 2 locks, and every note reports `duplicateAnswers: 0`.
- The fix and its tests are in the same commit: `packages/core/src/pipeline/room-assembly-select.ts`, `room-assembly-promotion.test.ts`, `room-assembly-duplicates-property.test.ts`, `packages/core/src/checks/duplicate-answers.ts`, and the `replay --policy both` option of the evaluation CLI, which compares assembly policies on recorded cassettes at no cost.
- What the session record shows (draft; put it in your own words): live crypts in production kept coming out with a single lock per room, and the first guess was that séance-board questions were being rejected. The first recorded run disproved it: séance questions were accepted 74 of 83 times. Replaying the same recorded calls through the old and the new assembly (`eval replay --policy both`, free) gave rooms with 1 lock / 2 locks of **9 / 3 before and 0 / 12 after**, and rooms with a séance lock went from 4 of 12 to 12 of 12. The cause was in room assembly, not generation: the model chose rune cipher as the primary for 85 of 92 concepts and séance board as the alternate for 76, and the old assembly only ever placed a séance *primary*, so every accepted séance alternate was thrown away. The same replay data exposed two more single-lock causes, both fixed in this commit: the mapper rejected 13 accepted rune questions whose model-written hint length disagreed with the answer (the hint is now recomputed from the answer for generated questions), and when the leak scan dropped a concept its replacement was never tried (selection now re-runs until the scan drops nothing).
- Why it matters for the write-up: the evaluation skill turned a wrong hypothesis into a measured, free before/after on identical model output.

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
- [ ] Fill each TODO (capture), or delete the sentence it sits under. Screenshots go in `docs/captures/` (see its README for the planned names).
- [ ] Hooks: one captured run for each of the three hooks; the garbled characters the tasks hook found are fixed by the owner of that spec.
- [ ] Agents: one captured report from each of crypt-keeper and design-critic, on real output.
- [ ] MCP: the server connected in Kiro, and the sample-crypt run with its screenshots.
- [ ] Add the missing build-log entries (first entry blank fields, PDF line breaks, specs 3, 4, room-play, evaluation skill, the three hooks, the two agents, the MCP server).
- [ ] Powers: the Power installed in Kiro from the folder, with a screenshot and a short recording (section 7); rebuild the bundle if core changed since.
- [ ] After the paid re-record, update section 8 with the new run files.
- [ ] Link this file from the README.
