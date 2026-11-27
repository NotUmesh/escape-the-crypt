import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { filePathFromArgs, filePathFromInput, readStdin, repoRelative } from './hook-input.ts';
import { checkTasksFormat, formatViolation } from './tasks-format.ts';

// Hook: on editing a .kiro/specs/<spec>/tasks.md, check its format. Reads one file; fast.
// Also runnable by hand: `node scripts/hooks/check-tasks-format.ts --all`.

const TASKS_PATH = /^\.kiro\/specs\/[^/]+\/tasks\.md$/;

function allTasksFiles(root: string): string[] {
  const specs = join(root, '.kiro', 'specs');
  if (!existsSync(specs)) return [];
  return readdirSync(specs, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => `.kiro/specs/${entry.name}/tasks.md`)
    .filter((rel) => existsSync(join(root, rel)))
    .sort();
}

async function main(): Promise<number> {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
  let targets: string[];
  if (process.argv.includes('--all')) {
    targets = allTasksFiles(root);
  } else {
    const given = filePathFromArgs(process.argv) ?? filePathFromInput(await readStdin());
    const rel = given === undefined ? undefined : repoRelative(root, given);
    if (rel === undefined || !TASKS_PATH.test(rel)) return 0;
    targets = [rel];
  }
  let problems = 0;
  for (const rel of targets) {
    for (const violation of checkTasksFormat(readFileSync(join(root, rel), 'utf8'))) {
      process.stderr.write(`${formatViolation(rel, violation)}\n`);
      problems += 1;
    }
  }
  if (problems === 0) {
    process.stdout.write(`[tasks-format] ${targets.length} tasks file(s) checked, no problems.\n`);
    return 0;
  }
  process.stderr.write(`[tasks-format] ${problems} problem(s). Fix them so Kiro can read the task list.\n`);
  return 1;
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1]) {
  process.exitCode = await main();
}
