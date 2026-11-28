import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Io } from './cli';
import { evalProviderErrorText, liveEvalProvider, parseEvalProvider, type EvalOverrides } from './eval-provider';
import { loadNotes, parseAllowedLockTypes } from './eval-settings';
import { parseFlags } from './flags';
import { evaluationPaths, isSafeModelId } from './paths';
import { runRecord } from './record-run';

/** One ledger file for the one holdout run. A second run would reopen it, so it is refused while it exists. */
export const HOLDOUT_LEDGER = 'ledger-holdout.json';

export const HOLDOUT_USAGE = [
  'Usage (from the repository root). This is the final test set and it runs ONCE, after the configuration is frozen:',
  '  pnpm --filter @escape-the-crypt/worker eval holdout --confirm-final-run [--provider openai|gemini] --model <id> --input-usd-per-mtok <n> --output-usd-per-mtok <n> --cap-usd <n> [--allowed-lock-types ...]',
  'It refuses to start when the results folder already holds a holdout result or the holdout ledger.',
  'It takes no --only and no --ledger: it runs every holdout note, against the ledger named ledger-holdout.json.',
].join('\n');

export type HoldoutGuard = { readonly ok: true } | { readonly ok: false; readonly message: string };

/**
 * The once-only rule. Looks only at the results folder, never at the holdout set. Refuses when any
 * result file there says `set: "holdout"`, when the holdout ledger exists (a run that was cut off
 * after spending is still a run), or when a file cannot be read, because it might be a holdout result.
 */
export function holdoutGuard(resultsDir: string): HoldoutGuard {
  if (!existsSync(resultsDir)) return { ok: true };
  for (const name of readdirSync(resultsDir).filter((n) => n.endsWith('.json')).sort()) {
    if (name === HOLDOUT_LEDGER) return { ok: false, message: `${name} exists: the holdout set has already been run. Nothing was read or spent.` };
    let set: unknown;
    try {
      set = (JSON.parse(readFileSync(join(resultsDir, name), 'utf8')) as { set?: unknown } | null)?.set;
    } catch {
      return { ok: false, message: `${name} cannot be read, so it might be a holdout result. Fix or move it first. Nothing was read or spent.` };
    }
    if (set === 'holdout') return { ok: false, message: `${name} is already a holdout result: the holdout set runs once. Nothing was read or spent.` };
  }
  return { ok: true };
}

/** Returns the exit code, like `record`: 0 done, 2 stopped by the cap, 1 refused or setup error. */
export async function runHoldout(
  argv: readonly string[],
  env: Readonly<Record<string, string | undefined>>,
  repoRoot: string,
  io: Io,
  overrides: EvalOverrides,
): Promise<number> {
  const flags = parseFlags(argv);
  const args = Object.fromEntries(Object.entries(flags).map(([k, v]) => [k, v[0] ?? 'true'] as const));
  const modelId = args['model'];
  if (modelId === undefined || !isSafeModelId(modelId)) {
    io.out(HOLDOUT_USAGE);
    return 1;
  }
  if (args['confirm-final-run'] !== 'true') {
    io.out('The holdout set runs once. Pass --confirm-final-run when the configuration is frozen. Nothing was read or spent.');
    io.out(HOLDOUT_USAGE);
    return 1;
  }
  const paths = evaluationPaths(repoRoot);
  const guard = holdoutGuard(paths.resultsDir);
  if (!guard.ok) {
    io.out(guard.message);
    return 1;
  }
  const lockTypes = parseAllowedLockTypes(args['allowed-lock-types']);
  const provider = parseEvalProvider(args['provider'], modelId);
  if (!lockTypes.ok || !provider.ok) {
    io.out(!provider.ok ? evalProviderErrorText(provider.error) : 'The lock type list is not valid. Nothing was called.');
    io.out(HOLDOUT_USAGE);
    return 1;
  }
  return runRecord({
    args,
    io,
    paths,
    providerName: provider.value,
    modelId,
    lockTypes: lockTypes.value,
    set: 'holdout',
    ledgerName: HOLDOUT_LEDGER,
    cassettesDir: paths.holdoutCassettesDir(provider.value, modelId),
    notes: () => loadNotes(paths.holdoutNotesDir, undefined),
    live: liveEvalProvider(provider.value, env, overrides),
    usage: HOLDOUT_USAGE,
  });
}
