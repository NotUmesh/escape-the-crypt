import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runAll } from './structure-checks.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const violations = runAll(root);
if (violations.length > 0) {
  process.stderr.write(`Structure checks failed (${violations.length}):\n`);
  for (const v of violations) process.stderr.write(`  [${v.rule}] ${v.file}: ${v.detail}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write('Structure checks passed.\n');
}