---
name: evaluation
description: The only route to paid model calls for evaluation in Escape the Crypt. Use when recording or re-recording dev-set cassettes, measuring question rejections per lock type or Check_ID, comparing assembly policies, benchmarking a provider or model, or any run that would spend API money. Enforces a per-task spending cap through callWithBudget, keeps the API key in the user's shell, writes eval/results files, and never touches the final test set.
---

# Evaluation skill

The Evaluation_Skill (generation-and-evaluation Requirement 21) is the only path to a real
Provider call for evaluation. Tests and the Worker never use it; tests replay cassettes only.

## Rules

- **Dev set only.** Tune prompts, models and verifiers on `eval/dev/` only. `record` and `replay`
  take no other set. Never read, tune against or summarise the final test set until the
  configuration is frozen. The only way to run it is `eval holdout` (below), once.
- **Key stays in the user's shell.** `record` reads `OPENAI_API_KEY` (or `GEMINI_API_KEY` with
  `--provider gemini`) from the environment of the shell that runs it. Never write the key to a file, a command line, a log or a chat
  message. If the agent's shell has no key, give the user the exact command to run in their own
  shell; never ask them to paste the key.
- **Budget first.** Every call reserves its worst case through `callWithBudget` against a capped
  ledger file in `eval/results/`. The cap covers every run of one task. A run that is refused a
  reservation stops after that note and exits with code 2: report it, do not raise the cap.
  Raising a cap is the user's decision; the runner refuses a cap different from the file's.
- **Replay is free.** Cassette hits replay at zero cost; only misses are called live. After a
  prompt change, a `record` run re-records exactly the calls whose Prompt_Digest changed.
- **Report real numbers**, including rejections and failures (evidence-and-honesty steering).

## Commands (run from the repository root)

Record or re-record the dev set (spends money; the user runs this in their own shell):

```powershell
pnpm --filter @escape-the-crypt/worker eval record --model <model-id> --input-usd-per-mtok <price> --output-usd-per-mtok <price> --cap-usd <cap> --ledger <task-ledger>.json
```

Replay at no cost (no key needed, writes nothing); compare assembly policies; print séance
question texts for reading:

```powershell
pnpm --filter @escape-the-crypt/worker eval replay --model <model-id> --policy both
pnpm --filter @escape-the-crypt/worker eval replay --model <model-id> --inspect
```

Add `--provider gemini` (record and replay; default `openai`) to run against Gemini. Use a
billing-enabled Gemini project and a bare model ID for `--model`. Gemini cassettes go to their own
folder per model, so a Gemini run never rewrites or replays the OpenAI cassettes.

Add `--only "dev-01,dev-07"` to limit the notes (quote it in PowerShell).
Add `--allowed-lock-types "rune-cipher,seance-board"` to choose the lock types (record and replay; default is the evaluation list in `config.ts`).
Add `--conflict-check on|off` (default off) to run the Phase 6 conflict check (one extra model call per provisional room) in record and replay. Replay of cassettes recorded without it must use off, or the conflict-check calls will miss the cassette. The flag is recorded in the result file as `conflictCheck`.

The dev cassettes were re-recorded with the conflict check on (commit 21d1cf1, "Dev re-record with conflict check on (six types)"), so replaying the dev set now needs `--conflict-check on` and all six `--allowed-lock-types`.

## Rater tooling (no model calls, no key)

Honest quality numbers need a human verdict per question. Two raters label the questions of a
result file; the tool counts Wrong_Accepted and Correct_Rejected per lock type.

```powershell
pnpm --filter @escape-the-crypt/worker eval export-ratings --result <result>.json
pnpm --filter @escape-the-crypt/worker eval import-ratings --result <result>.json --csv <rater-1>.csv --csv <rater-2>.csv
```

- **Export** writes `<result>-ratings.csv` in the results folder: one row per accepted or rejected
  question (not `not-reviewed`), with lock type, prompt, the answer key, options and cited quotes,
  and blank `rater`, `verdict` (`correct`, `wrong`, `unsure`) and `comment` columns. **It is blind by
  default**: there are no `result` or `rejection_reason` columns and the rows are shuffled in a
  repeatable order, so a rater cannot tell which questions the pipeline rejected. `--with-results`
  adds those columns and keeps the original order; use it only to check the export, never for
  raters. Each rater gets their own copy and fills in their name. It never overwrites an existing
  CSV. A note whose cassette does not line up with the result file (a retried call, a re-recorded
  cassette) is skipped with a reason, never guessed.- **Import** takes one or two filled CSVs, joins each row to the result file by note, concept index and
  role (accepted or rejected comes from the result file, never from the CSV), and writes
  `<result>-rated.json`: a copy of the run data plus a `ratings` section. Any bad row (unknown verdict,
  unknown question, duplicate, wrong run, two rater names in one file) stops the import and writes
  nothing. Blank verdicts are counted as unrated, not dropped.
- **Definitions.** Wrong_Accepted rate: accepted questions rated `wrong` over accepted questions rated.
  Correct_Rejected rate: rejected questions rated `correct` over rejected questions rated. `unsure` is
  not counted in either; the `...Max` rates count every `unsure` against the pipeline (worst case).
- **Two raters:** rates are given per rater and for the questions both rated alike (consensus), plus
  agreement rate, Cohen's kappa, and every disagreement listed with both verdicts. Disagreements are
  never averaged. Rater comments are read by nobody and never copied into a result file.
- **The CSV holds question text.** `eval/results/*.csv` is git-ignored. Never commit it.

## The holdout set runs once

```powershell
pnpm --filter @escape-the-crypt/worker eval holdout --confirm-final-run --provider <openai|gemini> --model <id> --input-usd-per-mtok <n> --output-usd-per-mtok <n> --cap-usd <n>
```

Only after the configuration is frozen (evidence-and-honesty steering). It refuses to start when the
results folder already holds a result with `set: "holdout"`, or the ledger `ledger-holdout.json` (a run
cut off after spending is still a run), or a file it cannot read. It takes no `--only` and no
`--ledger`. It writes `holdout-<date>.json` and records cassettes inside the git-ignored holdout
folder. No other mode reads the holdout notes. `export-ratings` reads holdout cassettes only when the
result file it is given says `set: "holdout"`. To run the holdout again on purpose, a person deletes
the holdout result and ledger; no flag does it. The notes are assumed to sit in a `notes` subfolder
there, like `eval/dev/notes`.

## What it writes

- Cassettes: `packages/core/src/test-support/cassettes/dev/<note>.json` (OpenAI) or
  `packages/core/src/test-support/cassettes/dev-gemini/<model-id>/<note>.json` (Gemini), `origin: recorded`.
- Result file: `eval/results/<date>.json` (`-2`, `-3` when taken). Run facts only: provider,
  model ID, temperature, Check_Version, Prompt_Digests, timings, tokens, cost, and per question
  the lock type, role, Check_IDs, review reason and placement. No notes text, prompts, model
  responses or credentials (Requirement 21.4). Schema: `apps/worker/src/evaluation/result-file.ts`.
- Budget ledger: `eval/results/<task-ledger>.json`, spend in micro-dollars per run.

Code: `apps/worker/src/evaluation/` (`cli.ts` entry point).
