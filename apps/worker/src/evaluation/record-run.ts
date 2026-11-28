import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CHECK_VERSION, DEFAULT_ASSEMBLY_POLICY, parseCassetteFile, type CassetteFile, type LockType, type Provider } from '@escape-the-crypt/core';
import type { Io } from './cli';
import { openCappedLedger } from './capped-ledger';
import { positive, settingsFor } from './eval-settings';
import { isPlainJsonName, type EvaluationPaths, type EvalProviderName } from './paths';
import { summarise } from './report';
import { EvaluationResultSchema, resultFileName, type EvaluationResult } from './result-file';
import { runDevSet, type DevNote } from './run-dev-set';

export interface RecordContext {
  readonly args: Readonly<Record<string, string>>;
  readonly io: Io;
  readonly paths: EvaluationPaths;
  readonly providerName: EvalProviderName;
  readonly modelId: string;
  readonly lockTypes: readonly LockType[];
  /** Runs the conflict check stage. Absent means off. */
  readonly conflictCheck?: boolean;
  /** Which set this run belongs to; it is written into the result file. */
  readonly set: 'dev' | 'holdout';
  /** The ledger file name inside the results folder. */
  readonly ledgerName: string | undefined;
  readonly cassettesDir: string;
  /** Called once, after the arguments and the key are checked and before the ledger is opened. */
  readonly notes: () => readonly DevNote[];
  readonly live: { readonly ok: true; readonly value: Provider } | { readonly ok: false; readonly message: string };
  readonly usage: string;
}

/**
 * The paid pass of `record` (and of the one-shot `holdout` mode): one live run over the notes, each
 * call reserved against a capped ledger file. Returns 0 done, 2 stopped by the cap, 1 setup error.
 */
export async function runRecord(ctx: RecordContext): Promise<number> {
  const { args, io, paths, providerName, modelId } = ctx;
  const prices = { inputUsdPerMTok: positive(args['input-usd-per-mtok']), outputUsdPerMTok: positive(args['output-usd-per-mtok']) };
  const capUsd = positive(args['cap-usd']);
  const ledgerName = ctx.ledgerName;
  if (prices.inputUsdPerMTok === undefined || prices.outputUsdPerMTok === undefined || capUsd === undefined || capUsd <= 0 || ledgerName === undefined || !isPlainJsonName(ledgerName)) {
    io.out(ctx.usage);
    return 1;
  }
  if (!ctx.live.ok) {
    io.out(ctx.live.message);
    return 1;
  }
  let notes: readonly DevNote[];
  try {
    notes = ctx.notes();
  } catch {
    io.out('The notes could not be read. Nothing was spent.');
    return 1;
  }
  const cassettePath = (note: string): string => join(ctx.cassettesDir, note.replace(/\.txt$/, '.json'));
  const loadCassette = (note: string): CassetteFile | null => {
    const path = cassettePath(note);
    if (!existsSync(path)) return null;
    const parsed = parseCassetteFile(JSON.parse(readFileSync(path, 'utf8')));
    return parsed.ok ? parsed.value : null;
  };
  const started = io.date();
  const runId = `${started.toISOString().replace(/[:.]/g, '-')}-record`;
  mkdirSync(paths.resultsDir, { recursive: true });
  const ledgerPath = paths.ledgerFile(ledgerName);
  const capped = openCappedLedger(
    {
      load: () => (existsSync(ledgerPath) ? (JSON.parse(readFileSync(ledgerPath, 'utf8')) as unknown) : null),
      save: (state) => writeFileSync(ledgerPath, `${JSON.stringify(state, null, 2)}\n`),
    },
    capUsd,
    runId,
  );
  if (!capped.ok) {
    io.out(capped.error.kind === 'cap-mismatch' ? `The ledger file's cap is $${capped.error.fileCapUsd}; refusing to run with a different cap.` : 'The ledger file does not parse; refusing to run.');
    return 1;
  }
  const budget = capped.value;
  io.out(`Budget: cap $${budget.capUsd.toFixed(2)}, spent before $${budget.spentBeforeUsd.toFixed(4)}, remaining $${budget.remainingUsd().toFixed(4)}.`);
  const settings = settingsFor(modelId, { inputUsdPerMTok: prices.inputUsdPerMTok, outputUsdPerMTok: prices.outputUsdPerMTok }, ctx.lockTypes, undefined, ctx.conflictCheck ?? false);
  mkdirSync(ctx.cassettesDir, { recursive: true });
  const run = await runDevSet({
    notes,
    loadCassette,
    saveCassette: (note, file) => writeFileSync(cassettePath(note), `${JSON.stringify(file, null, 2)}\n`),
    live: ctx.live.value,
    ledger: budget.ledger,
    settings,
    providerName,
    checkVersion: CHECK_VERSION,
    now: io.now,
    log: io.out,
  });
  const stopped = run.stopped === 'budget-refused' || budget.refused() ? 'budget-refused' : 'completed';
  const result: EvaluationResult = EvaluationResultSchema.parse({
    schemaVersion: 1,
    runId,
    startedAt: started.toISOString(),
    finishedAt: io.date().toISOString(),
    set: ctx.set,
    provider: providerName,
    modelId,
    temperature: settings.temperature,
    checkVersion: CHECK_VERSION,
    conflictCheck: ctx.conflictCheck ?? false,
    assemblyPolicy: DEFAULT_ASSEMBLY_POLICY,
    prices: { inputUsdPerMTok: prices.inputUsdPerMTok, outputUsdPerMTok: prices.outputUsdPerMTok },
    budget: { capUsd: budget.capUsd, spentBeforeUsd: budget.spentBeforeUsd, spentThisRunUsd: budget.spentThisRunUsd(), reservationRefused: budget.refused() },
    stopped,
    notes: run.notes,
  });
  const name = resultFileName(`${ctx.set === 'holdout' ? 'holdout-' : ''}${started.toISOString().slice(0, 10)}`, (n) => existsSync(join(paths.resultsDir, n)));
  writeFileSync(join(paths.resultsDir, name), `${JSON.stringify(result, null, 2)}\n`);
  io.out(JSON.stringify(summarise(run.notes), null, 2));
  io.out(`Spent this run: $${budget.spentThisRunUsd().toFixed(4)}; remaining under the cap: $${budget.remainingUsd().toFixed(4)}.`);
  io.out(`Result file: ${name}`);
  if (stopped === 'budget-refused') {
    io.out('STOPPED: the ledger refused a reservation. Later notes were not run.');
    return 2;
  }
  return 0;
}
