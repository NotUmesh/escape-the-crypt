import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { filePathFromArgs, filePathFromInput, readStdin, repoRelative } from './hook-input.ts';
import { runVitest, vitestCommand } from './run-vitest.ts';

// Hook: on editing a copy file (the strings a learner reads), run the wording test for that file.
// One or two test files at most; never a whole package.

/** The core test that holds the banned-wording list for the shared copy files. */
export const CORE_WORDING_TEST = 'src/copy-banned-words.test.ts';

const COPY_NAME = /(?:^|\/)(?:copy[^/]*|[^/]*-copy)(\.test)?\.ts$/;

export interface WordingPlan {
  /** The package folder, relative to the repository root. */
  readonly packageDir: string;
  /** Test files to run, relative to that package folder. */
  readonly tests: readonly string[];
  readonly message: string;
}

/** True for `copy.ts`, `copy-room-play.ts`, `share-card-copy.ts` and their tests, in core or web. */
export function isCopyFile(rel: string): boolean {
  return /^(?:packages\/core|apps\/web)\/src\//.test(rel) && COPY_NAME.test(rel);
}

/**
 * Which wording test covers a copy file. Core copy files share one test. A web copy file is covered by
 * the test named after it (`share-card-copy.ts` by `share-card-copy.test.ts`); without one, the plan says so
 * instead of pretending another test covers it. `exists` checks a repository-relative path. Pure.
 */
export function planWordingTests(rel: string, exists: (repoPath: string) => boolean): WordingPlan | undefined {
  if (!isCopyFile(rel)) return undefined;
  const isTest = rel.endsWith('.test.ts');
  if (rel.startsWith('packages/core/')) {
    const tests = isTest ? [rel.slice('packages/core/'.length)] : [CORE_WORDING_TEST];
    return { packageDir: 'packages/core', tests, message: `Core copy file: running ${tests.join(', ')}.` };
  }
  const own = isTest ? rel : rel.replace(/\.ts$/, '.test.ts');
  if (exists(own)) {
    const tests = [own.slice('apps/web/'.length)];
    return { packageDir: 'apps/web', tests, message: `Web copy file: running ${tests[0]}.` };
  }
  return {
    packageDir: 'apps/web',
    tests: [],
    message: `No wording test next to ${rel}. Add ${own} (see share-card-copy.test.ts) so this copy is checked.`,
  };
}

async function main(): Promise<number> {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
  const dryRun = process.argv.includes('--dry-run');
  const given = filePathFromArgs(process.argv) ?? filePathFromInput(await readStdin());
  const rel = given === undefined ? undefined : repoRelative(root, given);
  if (rel === undefined) return 0;
  const plan = planWordingTests(rel, (path) => existsSync(join(root, path)));
  if (plan === undefined) return 0;
  process.stdout.write(`[banned-words] ${plan.message}\n`);
  if (plan.tests.length === 0) return 0;
  if (dryRun) {
    process.stdout.write(`${vitestCommand(plan.packageDir, plan.tests)}\n`);
    return 0;
  }
  return runVitest(root, plan.packageDir, plan.tests);
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1]) {
  process.exitCode = await main();
}
