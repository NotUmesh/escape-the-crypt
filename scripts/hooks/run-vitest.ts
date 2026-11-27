import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

/** The path of vitest's own entry file, found from the repository root. No shell and no pnpm needed. */
export function vitestEntry(root: string): string {
  const require = createRequire(join(root, 'package.json'));
  const manifestPath = require.resolve('vitest/package.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as { bin?: string | Record<string, string> };
  const bin = typeof manifest.bin === 'string' ? manifest.bin : manifest.bin?.['vitest'];
  if (bin === undefined) throw new Error('vitest has no bin entry');
  return join(dirname(manifestPath), bin);
}

/** The command a run would use, for `--dry-run` and tests. */
export function vitestCommand(packageDir: string, files: readonly string[]): string {
  return `vitest run ${files.join(' ')}  (in ${packageDir})`;
}

/**
 * Runs the given test files once, from the package folder, and returns the exit code.
 * Only the listed files run; nothing here ever runs a whole package.
 */
export function runVitest(root: string, packageDir: string, files: readonly string[]): number {
  if (files.length === 0) return 0;
  const result = spawnSync(process.execPath, [vitestEntry(root), 'run', ...files], {
    cwd: join(root, packageDir),
    stdio: 'inherit',
  });
  return typeof result.status === 'number' ? result.status : 1;
}
