---
name: evaluation
description: The only route to paid model calls for evaluation in Escape the Crypt. Use when recording or re-recording dev-set cassettes, measuring question rejections per lock type or Check_ID, comparing assembly policies, benchmarking a provider or model, or any run that would spend API money. Enforces a per-task spending cap through callWithBudget, keeps the API key in the user's shell, writes eval/results files, and never touches the final test set.
---

# Evaluation skill

The Evaluation_Skill (generation-and-evaluation Requirement 21) is the only path to a real
Provider call for evaluation. Tests and the Worker never use it; tests replay cassettes only.

## Rules

- **Dev set only.** Tune prompts, models and verifiers on `eval/dev/` only. The runner has no
  option for any other set. Never read, tune against or summarise the final test set until the
  configuration is frozen; holdout support is added to the runner only then.
- **Key stays in the user's shell.** `record` reads `OPENAI_API_KEY` from the environment of
  the shell that runs it. Never write the key to a file, a command line, a log or a chat
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

Add `--only "dev-01,dev-07"` to limit the notes (quote it in PowerShell).

## What it writes

- Cassettes: `packages/core/src/test-support/cassettes/dev/<note>.json`, `origin: recorded`.
- Result file: `eval/results/<date>.json` (`-2`, `-3` when taken). Run facts only: provider,
  model ID, temperature, Check_Version, Prompt_Digests, timings, tokens, cost, and per question
  the lock type, role, Check_IDs, review reason and placement. No notes text, prompts, model
  responses or credentials (Requirement 21.4). Schema: `apps/worker/src/evaluation/result-file.ts`.
- Budget ledger: `eval/results/<task-ledger>.json`, spend in micro-dollars per run.

Code: `apps/worker/src/evaluation/` (`cli.ts` entry point).
