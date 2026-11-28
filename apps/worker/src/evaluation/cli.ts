import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  CHECK_VERSION,
  RUN_LENGTHS,
  DEFAULT_ASSEMBLY_POLICY,
  LEGACY_ASSEMBLY_POLICY,
  makeMockLedger,
  parseCassetteFile,
  type AssemblyPolicy,
  type CassetteFile,
} from '@escape-the-crypt/core';
import { evalProviderErrorText, liveEvalProvider, parseEvalProvider, type EvalOverrides } from './eval-provider';
import { loadNotes, parseAllowedLockTypes, parseConflictCheck, settingsFor } from './eval-settings';
import { runExportRatings } from './export-ratings';
import { runHoldout } from './holdout';
import { runImportRatings } from './import-ratings';
import { makeInspector } from './inspect';
import { evaluationPaths } from './paths';
import { runRecord } from './record-run';
import { summarise } from './report';
import { runDevSet } from './run-dev-set';

// Kept importable from here: tests and the Gemini contract test use them.
export { parseAllowedLockTypes, parseConflictCheck, settingsFor } from './eval-settings';
export type { ConflictCheckError, LockTypeListError } from './eval-settings';

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

const USAGE = [
  'Usage (from the repository root):',
  '  pnpm --filter @escape-the-crypt/worker eval record [--provider openai|gemini] --model <id> --input-usd-per-mtok <n> --output-usd-per-mtok <n> --cap-usd <n> --ledger <name.json> [--only dev-01,dev-02] [--allowed-lock-types rune-cipher,seance-board] [--conflict-check on|off]',
  '  pnpm --filter @escape-the-crypt/worker eval replay [--provider openai|gemini] --model <id> [--policy default|legacy|both] [--length short|standard|long] [--inspect [seance-board|rune-cipher]] [--only ...] [--allowed-lock-types ...] [--conflict-check on|off]',
  '--conflict-check on|off (default off) runs the conflict check stage; off keeps the recorded cassettes replaying exactly as before. It applies to record and replay.',
  '--allowed-lock-types takes a comma-separated list of rune-cipher, seance-board, bone-ordering, bound-threads, cursed-object, combination-dial. Default: the evaluation list in config.ts. It applies to record and replay.',
  '--provider openai|gemini (default openai) applies to record and replay. Gemini cassettes live in cassettes/dev-gemini/<model>/, OpenAI ones in cassettes/dev/; replay reads only its own folder.',
  'record reads OPENAI_API_KEY or GEMINI_API_KEY from the environment and never writes it anywhere.',
  'Rater tooling (dev or holdout result files; no model calls):',
  '  eval export-ratings --result <result.json> [--out <ratings.csv>] [--with-results]',
  '  eval import-ratings --result <result.json> --csv <rater-1.csv> [--csv <rater-2.csv>]',
  'The final test set has its own once-only mode, `eval holdout`; run it with no arguments to read its usage.',
].join('\n');

/**
 * Returns the process exit code: 0 done, 2 stopped by the budget cap or a partial export,
 * 1 usage or setup error. `overrides` is a test seam: production never passes it.
 */
export async function main(
  argv: readonly string[],
  env: Readonly<Record<string, string | undefined>>,
  repoRoot: string,
  io: Io,
  overrides: EvalOverrides = {},
): Promise<number> {
  const { mode, args } = parseArgs(argv);
  // These three never read the dev notes. Only `holdout` ever reads the holdout set.
  if (mode === 'export-ratings') return runExportRatings(argv.slice(1), repoRoot, io);
  if (mode === 'import-ratings') return runImportRatings(argv.slice(1), repoRoot, io);
  if (mode === 'holdout') return runHoldout(argv.slice(1), env, repoRoot, io, overrides);
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
  const conflict = parseConflictCheck(args['conflict-check']);
  if (!conflict.ok) {
    io.out(`Unknown --conflict-check value "${conflict.error.value}"; use on or off. Nothing was called.`);
    io.out(USAGE);
    return 1;
  }
  const providerChoice = parseEvalProvider(args['provider'], modelId);
  if (!providerChoice.ok) {
    io.out(evalProviderErrorText(providerChoice.error));
    io.out(USAGE);
    return 1;
  }
  const providerName = providerChoice.value;
  const notes = loadNotes(paths.notesDir, args['only']);
  const cassettesDir = paths.cassettesDirFor(providerName, modelId);
  const cassettePath = (note: string): string => join(cassettesDir, note.replace(/\.txt$/, '.json'));
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
        settings: settingsFor(modelId, prices, lockTypes.value, length, conflict.value),
        providerName,
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

  return runRecord({
    args,
    io,
    paths,
    providerName,
    modelId,
    lockTypes: lockTypes.value,
    conflictCheck: conflict.value,
    set: 'dev',
    ledgerName: args['ledger'],
    cassettesDir,
    notes: () => notes,
    live: liveEvalProvider(providerName, env, overrides),
    usage: USAGE,
  });
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
