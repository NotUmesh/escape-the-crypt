import { join } from 'node:path';

/**
 * Repository-relative paths of the Evaluation_Skill (P4). This is the only module under
 * apps/worker/src that names the results folder; `no-eval-results-writes.test.ts` allowlists it.
 * Only the dev set is wired: the final test set is added once the configuration is frozen.
 */
export const RESULTS_DIR = 'eval/results';
export const DEV_NOTES_DIR = 'eval/dev/notes';
export const DEV_CASSETTES_DIR = 'packages/core/src/test-support/cassettes/dev';

export interface EvaluationPaths {
  readonly resultsDir: string;
  readonly notesDir: string;
  readonly cassettesDir: string;
  /** The task's budget ledger file, inside the results folder. */
  ledgerFile(name: string): string;
}

/** Absolute paths for one repository root. `name` must be a plain file name. */
export function evaluationPaths(repoRoot: string): EvaluationPaths {
  return {
    resultsDir: join(repoRoot, RESULTS_DIR),
    notesDir: join(repoRoot, DEV_NOTES_DIR),
    cassettesDir: join(repoRoot, DEV_CASSETTES_DIR),
    ledgerFile: (name) => join(repoRoot, RESULTS_DIR, name),
  };
}

/** True for a plain `.json` file name with no folder parts. */
export function isPlainJsonName(name: string): boolean {
  return /^[a-z0-9][a-z0-9._-]*\.json$/i.test(name) && !name.includes('..');
}
