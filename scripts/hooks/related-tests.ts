import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, posix, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { filePathFromArgs, filePathFromInput, readStdin, repoRelative } from './hook-input.ts';
import { runVitest, vitestCommand } from './run-vitest.ts';

// Hook: on saving a file under packages/core/src, run the tests that belong to that file.
// Quick by design: it never runs a whole package. CI stays the release gate.

const CORE_DIR = 'packages/core';
const CORE_SRC = `${CORE_DIR}/src/`;
/** More tests than this means the file is a hub (types, copy, index): run only the tests named after it. */
export const MAX_RELATED_TESTS = 12;

const TEST_FILE = /\.test\.tsx?$/;
const SOURCE_FILE = /\.tsx?$/;
const IMPORT_SPECIFIER = /(?:from|import|mock|importActual|importOriginal)\s*\(?\s*['"](\.{1,2}\/[^'"]*)['"]/g;

export interface RelatedPlan {
  /** Test files to run, relative to packages/core. */
  readonly tests: readonly string[];
  readonly message: string;
}

const stem = (path: string): string => path.replace(/\.(?:tsx?|mjs|js)$/, '');

/** Tests in the same folder named after the file: `foo.ts` gets `foo.test.ts` and `foo-*.test.ts`. */
function namedTests(file: string, allTests: readonly string[]): string[] {
  const dir = posix.dirname(file);
  const base = posix.basename(stem(file));
  return allTests.filter((test) => {
    if (posix.dirname(test) !== dir) return false;
    const name = posix.basename(test).replace(/\.test\.tsx?$/, '');
    return name === base || name.startsWith(`${base}-`);
  });
}

/** Files (tests and sources) that import each file, by one relative import. Built once per plan. */
function importerMap(allFiles: readonly string[], read: (path: string) => string): Map<string, Set<string>> {
  const byStem = new Map(allFiles.map((path) => [stem(path), path]));
  const importers = new Map<string, Set<string>>();
  for (const importer of allFiles) {
    for (const match of read(importer).matchAll(IMPORT_SPECIFIER)) {
      const resolved = stem(posix.normalize(posix.join(posix.dirname(importer), match[1] ?? '')));
      const target = byStem.get(resolved) ?? byStem.get(`${resolved}/index`);
      if (target === undefined || target === importer) continue;
      const set = importers.get(target) ?? new Set<string>();
      set.add(importer);
      importers.set(target, set);
    }
  }
  return importers;
}

/**
 * Which tests to run for a saved core file. `file` and `allFiles` (every .ts/.tsx under src, tests
 * included) are paths relative to packages/core, such as `src/runtime/apply.ts`. A test file runs itself.
 *
 * Tiers, widest last: tests named after the file, tests that import it, tests that import a module that
 * imports it, then tests named after those modules (a helper such as `chunker-rebalance.ts` is covered by
 * the `chunker*.test.ts` files). The first set that is not empty and fits under `cap` wins; a file that
 * half the suite depends on falls back to the tests named after it, or to nothing. Pure.
 */
export function planRelatedTests(
  file: string,
  allFiles: readonly string[],
  read: (path: string) => string,
  cap = MAX_RELATED_TESTS,
): RelatedPlan {
  if (!file.startsWith('src/') || !SOURCE_FILE.test(file) || file.endsWith('.d.ts')) {
    return { tests: [], message: `${file} is not a core source file. No tests run.` };
  }
  if (TEST_FILE.test(file)) return { tests: [file], message: 'A test file: running it.' };
  const tests = allFiles.filter((path) => TEST_FILE.test(path));
  const importers = importerMap(allFiles, read);
  const isTest = (path: string): boolean => TEST_FILE.test(path);
  const named = namedTests(file, tests);
  const direct = [...(importers.get(file) ?? [])];
  const viaSource = direct
    .filter((path) => !isTest(path))
    .flatMap((path) => [...(importers.get(path) ?? [])])
    .filter(isTest);
  const unique = (list: readonly string[]): string[] => [...new Set(list)].sort();
  const near = unique([...named, ...direct.filter(isTest)]);
  const wide = unique([...near, ...viaSource]);
  const neighbours = unique(direct.filter((path) => !isTest(path)).flatMap((path) => namedTests(path, tests)));
  if (near.length > 0 && near.length <= cap) {
    return { tests: near, message: `${near.length} related test file(s): named after ${file} or importing it.` };
  }
  if (near.length === 0 && wide.length > 0 && wide.length <= cap) {
    return { tests: wide, message: `${wide.length} test file(s) reach ${file} through a module that imports it.` };
  }
  if (near.length === 0 && neighbours.length > 0 && neighbours.length <= cap) {
    return {
      tests: neighbours,
      message: `${wide.length} test files reach ${file}, over the cap of ${cap}. Running the ${neighbours.length} named after the modules that import it.`,
    };
  }
  if (named.length > 0) {
    const reach = Math.max(near.length, wide.length);
    return {
      tests: unique(named),
      message: `${reach} test files reach ${file}, over the cap of ${cap}. Running the ${named.length} named after it; CI runs the rest.`,
    };
  }
  if (wide.length === 0) {
    return { tests: [], message: `No test names, imports or reaches ${file}. Nothing to run; CI runs the full suite.` };
  }
  return {
    tests: [],
    message: `${wide.length} test files reach ${file}, over the cap of ${cap}, and none is named after it. Nothing to run; use CI or run the suite by hand.`,
  };
}

function listSources(root: string, dir = join(root, CORE_SRC), out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== 'node_modules') listSources(root, full, out);
    } else if (SOURCE_FILE.test(entry.name) && !entry.name.endsWith('.d.ts')) {
      out.push(full);
    }
  }
  return out;
}

async function main(): Promise<number> {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
  const dryRun = process.argv.includes('--dry-run');
  const given = filePathFromArgs(process.argv) ?? filePathFromInput(await readStdin());
  const rel = given === undefined ? undefined : repoRelative(root, given);
  if (rel === undefined || !rel.startsWith(CORE_SRC)) return 0;
  const inPackage = (path: string): string => path.slice(`${CORE_DIR}/`.length);
  const all = listSources(root).map((p) => repoRelative(root, p) ?? p).map(inPackage);
  const plan = planRelatedTests(inPackage(rel), all, (p) => readFileSync(join(root, CORE_DIR, p), 'utf8'));
  process.stdout.write(`[related-tests] ${plan.message}\n`);
  if (plan.tests.length === 0) return 0;
  if (dryRun) {
    process.stdout.write(`${vitestCommand(CORE_DIR, plan.tests)}\n`);
    return 0;
  }
  return runVitest(root, CORE_DIR, plan.tests);
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1]) {
  process.exitCode = await main();
}
