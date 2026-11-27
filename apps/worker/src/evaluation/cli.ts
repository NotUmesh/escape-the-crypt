import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  CHECK_VERSION,
  RUN_LENGTHS,
  cryptTargetFor,
  DEFAULT_ASSEMBLY_POLICY,
  LEGACY_ASSEMBLY_POLICY,
  makeMockLedger,
  parseCassetteFile,
  type AssemblyPolicy,
  type CassetteFile,
  type RunLength,
  type LockType,
  type Provider,
  type ProviderUsage,
} from '@escape-the-crypt/core';
import { costOfUsage, worstCaseUsd, type TokenPrices } from '../budget/interim-ledger';
import {
  EVAL_ALLOWED_LOCK_TYPES,
  GENERATION_TEMPERATURE,
  INPUT_TOKENS_BOUND,
  MAX_OUTPUT_TOKENS,
  PROVIDER_RETRY_LIMIT,
  PROVIDER_TIMEOUT_MS,
} from '../config';
import type { PipelineSettings } from '../http/job-runner';
import { makeOpenAiProvider } from '../provider/openai-provider';
import { openCappedLedger } from './capped-ledger';
import { makeInspector } from './inspect';
import { evaluationPaths, isPlainJsonName } from './paths';
import { summarise } from './report';
import { EvaluationResultSchema, resultFileName, type EvaluationResult } from './result-file';
import { runDevSet, type DevNote } from './run-dev-set';

/** Calls in flight per stage. Lower than production's 4 to stay clear of rate limits; digests do not depend on it. */
const EVAL_CONCURRENCY = 2;

export interface Io {
  readonly out: (line: string) => void;
  readonly now: () => number;
  readonly date: () => Date;
}

type Args = Readonly<Record<string, string>>;

function parseArgs(argv: readonly string[]): { mode: string; args: Args } {
  const [mode = '', ...rest] = argv;
  const args: Record<string, string> = {};
  for (let i = 0; i < rest.length; i += 1) {
    const key = rest[i] ?? '';
    if (!key.startsWith('--')) continue;
    const value = rest[i + 1];
    if (value === undefined || value.startsWith('--')) args[key.slice(2)] = 'true';
    else {
      args[key.slice(2)] = value;
      i += 1;
    }
  }
  return { mode, args };
}

function positive(value: string | undefined): number | undefined {
  const n = value === undefined ? Number.NaN : Number(value);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

/** Exhaustive over the six Lock_Types: adding a type to core fails the type-check here. */
const LOCK_TYPE_NAMES: Readonly<Record<LockType, true>> = {
  'rune-cipher': true,
  'seance-board': true,
  'bone-ordering': true,
  'bound-threads': true,
  'cursed-object': true,
  'combination-dial': true,
};

export type LockTypeListError =
  | { readonly kind: 'invalid-lock-type'; readonly value: string }
  | { readonly kind: 'empty-lock-type-list' };

function isLockType(value: string): value is LockType {
  return Object.prototype.hasOwnProperty.call(LOCK_TYPE_NAMES, value);
}

/** Parses `--allowed-lock-types`. Absent means the evaluation default. Commas or spaces separate (PowerShell passes an unquoted `a,b` as `a b`). */
export function parseAllowedLockTypes(
  raw: string | undefined,
): { readonly ok: true; readonly value: readonly LockType[] } | { readonly ok: false; readonly error: LockTypeListError } {
  if (raw === undefined) return { ok: true, value: EVAL_ALLOWED_LOCK_TYPES };
  const parts = raw.split(/[\s,]+/).filter(Boolean);
  if (parts.length === 0) return { ok: false, error: { kind: 'empty-lock-type-list' } };
  const out: LockType[] = [];
  for (const part of parts) {
    if (!isLockType(part)) return { ok: false, error: { kind: 'invalid-lock-type', value: part } };
    if (!out.includes(part)) out.push(part);
  }
  return { ok: true, value: out };
}

export function settingsFor(modelId: string, prices: TokenPrices, allowedLockTypes: readonly LockType[] = EVAL_ALLOWED_LOCK_TYPES, length?: RunLength): PipelineSettings {
  return {
    ...(length === undefined ? {} : { target: cryptTargetFor(length) }),
    modelId,
    temperature: GENERATION_TEMPERATURE,
    maxOutputTokens: MAX_OUTPUT_TOKENS,
    timeoutMs: PROVIDER_TIMEOUT_MS,
    retryLimit: PROVIDER_RETRY_LIMIT,
    worstCaseUsd: worstCaseUsd({ inputTokensEstimate: INPUT_TOKENS_BOUND, maxOutputTokens: MAX_OUTPUT_TOKENS }, prices),
    costOf: (usage: ProviderUsage) => costOfUsage(usage, prices),
    allowedLockTypes,
    concurrency: EVAL_CONCURRENCY,
  };
}

function loadNotes(notesDir: string, only: string | undefined): DevNote[] {
  // Commas or spaces: PowerShell passes an unquoted `a,b` as `a b`.
  const wanted = only?.split(/[\s,]+/).filter(Boolean);
  return readdirSync(notesDir)
    .filter((n) => n.endsWith('.txt'))
    .filter((n) => wanted === undefined || wanted.some((w) => n.startsWith(w)))
    .sort()
    .map((name) => ({ name, text: readFileSync(join(notesDir, name), 'utf8') }));
}

const USAGE = [
  'Usage (from the repository root):',
  '  pnpm --filter @escape-the-crypt/worker eval record --model <id> --input-usd-per-mtok <n> --output-usd-per-mtok <n> --cap-usd <n> --ledger <name.json> [--only dev-01,dev-02] [--allowed-lock-types rune-cipher,seance-board]',
  '  pnpm --filter @escape-the-crypt/worker eval replay --model <id> [--policy default|legacy|both] [--length short|standard|long] [--inspect [seance-board|rune-cipher]] [--only ...] [--allowed-lock-types ...]',
  '--allowed-lock-types takes a comma-separated list of rune-cipher, seance-board, bone-ordering, bound-threads, cursed-object, combination-dial. Default: the evaluation list in config.ts. It applies to record and replay.',
  'record reads OPENAI_API_KEY from the environment and never writes it anywhere.',
].join('\n');

/** Returns the process exit code: 0 done, 2 stopped by the budget cap, 1 usage or setup error. */
export async function main(argv: readonly string[], env: Readonly<Record<string, string | undefined>>, repoRoot: string, io: Io): Promise<number> {
  const { mode, args } = parseArgs(argv);
  const paths = evaluationPaths(repoRoot);
  const modelId = args['model'];
  if ((mode !== 'record' && mode !== 'replay') || modelId === undefined) {
    io.out(USAGE);
    return 1;
  }
  const lockTypes = parseAllowedLockTypes(args['allowed-lock-types']);
  if (!lockTypes.ok) {
    io.out(
      lockTypes.error.kind === 'invalid-lock-type'
        ? `Unknown lock type "${lockTypes.error.value}". Nothing was called.`
        : 'The lock type list is empty. Nothing was called.',
    );
    io.out(USAGE);
    return 1;
  }
  const notes = loadNotes(paths.notesDir, args['only']);
  const cassettePath = (note: string): string => join(paths.cassettesDir, note.replace(/\.txt$/, '.json'));
  const loadCassette = (note: string): CassetteFile | null => {
    const path = cassettePath(note);
    if (!existsSync(path)) return null;
    const parsed = parseCassetteFile(JSON.parse(readFileSync(path, 'utf8')));
    return parsed.ok ? parsed.value : null;
  };

  if (mode === 'replay') {
    const prices = { inputUsdPerMTok: 0, outputUsdPerMTok: 0 };
    const length = RUN_LENGTHS.find((l) => l === args['length']);
    const which = args['policy'] ?? 'default';
    const policies: [string, AssemblyPolicy][] =
      which === 'both'
        ? [['legacy', LEGACY_ASSEMBLY_POLICY], ['default', DEFAULT_ASSEMBLY_POLICY]]
        : [[which, which === 'legacy' ? LEGACY_ASSEMBLY_POLICY : DEFAULT_ASSEMBLY_POLICY]];
    for (const [name, policy] of policies) {
      const inspector = args['inspect'] === undefined ? null : makeInspector(io.out);
      const run = await runDevSet({
        notes,
        loadCassette: (note) => {
          inspector?.startNote(note);
          return loadCassette(note);
        },
        saveCassette: () => undefined,
        live: null,
        ledger: makeMockLedger({ dailyCapUsd: 1_000_000 }),
        settings: settingsFor(modelId, prices, lockTypes.value, length),
        providerName: 'openai',
        checkVersion: CHECK_VERSION,
        policy,
        now: io.now,
        log: io.out,
        ...(inspector === null ? {} : { wrap: inspector.wrap }),
      });
      inspector?.report(run.notes, args['inspect'] === 'true' ? undefined : args['inspect']);
      io.out(`=== replay, assembly policy: ${name} ===`);
      io.out(JSON.stringify({ policy: name, summary: summarise(run.notes), notes: run.notes }, null, 2));
    }
    return 0;
  }

  const prices = { inputUsdPerMTok: positive(args['input-usd-per-mtok']), outputUsdPerMTok: positive(args['output-usd-per-mtok']) };
  const capUsd = positive(args['cap-usd']);
  const ledgerName = args['ledger'];
  if (prices.inputUsdPerMTok === undefined || prices.outputUsdPerMTok === undefined || capUsd === undefined || capUsd <= 0 || ledgerName === undefined || !isPlainJsonName(ledgerName)) {
    io.out(USAGE);
    return 1;
  }
  const apiKey = env['OPENAI_API_KEY'];
  if (apiKey === undefined || apiKey.length === 0) {
    io.out('OPENAI_API_KEY is not set in this shell. Nothing was called.');
    return 1;
  }
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
  const live: Provider = makeOpenAiProvider({ apiKey });
  const settings = settingsFor(modelId, { inputUsdPerMTok: prices.inputUsdPerMTok, outputUsdPerMTok: prices.outputUsdPerMTok }, lockTypes.value);
  mkdirSync(paths.cassettesDir, { recursive: true });
  const run = await runDevSet({
    notes,
    loadCassette,
    saveCassette: (note, file) => writeFileSync(cassettePath(note), `${JSON.stringify(file, null, 2)}\n`),
    live,
    ledger: budget.ledger,
    settings,
    providerName: 'openai',
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
    set: 'dev',
    provider: 'openai',
    modelId,
    temperature: settings.temperature,
    checkVersion: CHECK_VERSION,
    assemblyPolicy: DEFAULT_ASSEMBLY_POLICY,
    prices: { inputUsdPerMTok: prices.inputUsdPerMTok, outputUsdPerMTok: prices.outputUsdPerMTok },
    budget: { capUsd: budget.capUsd, spentBeforeUsd: budget.spentBeforeUsd, spentThisRunUsd: budget.spentThisRunUsd(), reservationRefused: budget.refused() },
    stopped,
    notes: run.notes,
  });
  const name = resultFileName(started.toISOString().slice(0, 10), (n) => existsSync(join(paths.resultsDir, n)));
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

const entry = process.argv[1];
if (entry !== undefined && import.meta.url === pathToFileURL(resolve(entry)).href) {
  // dist/evaluation.js sits in apps/worker/dist.
  const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
  const io: Io = { out: (line) => console.log(line), now: () => performance.now(), date: () => new Date() };
  main(process.argv.slice(2), process.env, repoRoot, io).then(
    (code) => process.exit(code),
    () => {
      console.log('The evaluation run failed unexpectedly.');
      process.exit(1);
    },
  );
}
