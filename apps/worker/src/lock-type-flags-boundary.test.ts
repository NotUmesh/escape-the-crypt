import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// The task text says lock-type-flags.ts is the only reader of DISABLED_LOCK_TYPES. In the code, that file
// is a pure parser: it receives the raw value. config.ts is the one place that reads the environment
// (process.env at module load, and the injected env in loadConfig) and hands the value to the parser.
// So the honest assertion is: only config.ts reads the variable, and only config.ts and
// lock-type-flags.ts mention it at all. The evaluation CLI never touches it.
const SRC = dirname(fileURLToPath(import.meta.url));
const VARIABLE = ['DISABLED', 'LOCK', 'TYPES'].join('_');

function listSources(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listSources(full));
    else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) out.push(full);
  }
  return out;
}
const rel = (f: string): string => relative(SRC, f).replace(/\\/g, '/');
const sources = listSources(SRC);

describe(`${VARIABLE} boundary`, () => {
  it('only config.ts and lock-type-flags.ts mention the variable', () => {
    const mentions = sources.filter((f) => readFileSync(f, 'utf8').includes(VARIABLE)).map(rel).sort();
    expect(mentions).toEqual(['config.ts', 'lock-type-flags.ts']);
  });
  it('only config.ts reads it from an environment object', () => {
    const read = new RegExp(`\\[\\s*['"]${VARIABLE}['"]\\s*\\]|\\.${VARIABLE}\\b`);
    const readers = sources.filter((f) => read.test(readFileSync(f, 'utf8'))).map(rel);
    expect(readers).toEqual(['config.ts']);
  });
  it('lock-type-flags.ts and the evaluation folder never read process environment', () => {
    const envRead = new RegExp(['process', 'env'].join('\\.'));
    const offenders = sources
      .filter((f) => rel(f) === 'lock-type-flags.ts' || rel(f).startsWith('evaluation/'))
      // cli.ts passes its own process env to main() at the entry point; it never names the variable.
      .filter((f) => rel(f) !== 'evaluation/cli.ts')
      .filter((f) => envRead.test(readFileSync(f, 'utf8')))
      .map(rel);
    expect(offenders).toEqual([]);
  });
});
