import { join } from 'node:path';

/**
 * Repository-relative paths of the Evaluation_Skill (P4). This is the only module under
 * apps/worker/src that names the results folder or the holdout folder;
 * `no-eval-results-writes.test.ts` allowlists it for the first and `holdout-isolation.test.ts`
 * pins the second. Every other module goes through `evaluationPaths`.
 */
export const RESULTS_DIR = 'eval/results';
export const DEV_NOTES_DIR = 'eval/dev/notes';
export const DEV_CASSETTES_DIR = 'packages/core/src/test-support/cassettes/dev';
/**
 * Gemini cassettes, one folder per model: `dev-gemini/<model-id>/<note>.json`. The folder records
 * which provider and model produced them, and replay reads only the folder for its own provider
 * and model, so providers never mix. OpenAI keeps `dev/` unchanged.
 */
export const DEV_GEMINI_CASSETTES_DIR = 'packages/core/src/test-support/cassettes/dev-gemini';
/**
 * The final test set. Git-ignored until the configuration is frozen. Only the `holdout` mode reads
 * the notes; `export-ratings` reads the cassettes only when the result file it is given says
 * `set: "holdout"`. Cassettes sit inside the ignored folder so held-out model output is never committed.
 * The `notes` subfolder mirrors `eval/dev/notes` (an assumption: confirm before the final run).
 */
export const HOLDOUT_DIR = 'eval/holdout';

export type EvalProviderName = 'openai' | 'gemini';

export interface EvaluationPaths {
  readonly resultsDir: string;
  readonly notesDir: string;
  /** The OpenAI cassette folder. */
  readonly cassettesDir: string;
  /** Cassette folder for one provider and model. `modelId` must already be checked for Gemini. */
  cassettesDirFor(provider: EvalProviderName, modelId: string): string;
  readonly holdoutNotesDir: string;
  /** `modelId` must already be checked with `isSafeModelId`: it becomes a folder name. */
  holdoutCassettesDir(provider: EvalProviderName, modelId: string): string;
  /** The task's budget ledger file, inside the results folder. */
  ledgerFile(name: string): string;
}

/** Absolute paths for one repository root. `name` must be a plain file name. */
export function evaluationPaths(repoRoot: string): EvaluationPaths {
  return {
    resultsDir: join(repoRoot, RESULTS_DIR),
    notesDir: join(repoRoot, DEV_NOTES_DIR),
    cassettesDir: join(repoRoot, DEV_CASSETTES_DIR),
    cassettesDirFor: (provider, modelId) =>
      provider === 'gemini' ? join(repoRoot, DEV_GEMINI_CASSETTES_DIR, modelId) : join(repoRoot, DEV_CASSETTES_DIR),
    holdoutNotesDir: join(repoRoot, HOLDOUT_DIR, 'notes'),
    holdoutCassettesDir: (provider, modelId) => join(repoRoot, HOLDOUT_DIR, 'cassettes', provider, modelId),
    ledgerFile: (name) => join(repoRoot, RESULTS_DIR, name),
  };
}

/** True for a plain `.json` file name with no folder parts. */
export function isPlainJsonName(name: string): boolean {
  return /^[a-z0-9][a-z0-9._-]*\.json$/i.test(name) && !name.includes('..');
}

/** True for a plain `.csv` file name with no folder parts. */
export function isPlainCsvName(name: string): boolean {
  return /^[a-z0-9][a-z0-9._-]*\.csv$/i.test(name) && !name.includes('..');
}

/** A model ID that is safe as a folder name: letters, digits, dot, underscore, hyphen. */
export function isSafeModelId(value: string): boolean {
  return /^[a-z0-9][a-z0-9._-]{0,99}$/i.test(value) && !value.includes('..');
}
