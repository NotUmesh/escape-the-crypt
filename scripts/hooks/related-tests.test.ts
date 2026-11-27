import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { MAX_RELATED_TESTS, planRelatedTests } from './related-tests.ts';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const CORE = join(REPO, 'packages', 'core');

const TESTS = [
  'src/chunker.test.ts',
  'src/chunker-size.test.ts',
  'src/chunker-merge-helpers.test.ts',
  'src/pipeline/orchestrator.test.ts',
  'src/pipeline/room-assembly.test.ts',
  'src/runtime/apply.test.ts',
];
const SOURCE_FILES = [
  'src/chunker.ts',
  'src/chunker-merge.ts',
  'src/chunker-rebalance.ts',
  'src/pipeline/orchestrator.ts',
  'src/runtime/index.ts',
  'src/runtime/apply.ts',
  'src/orphan.ts',
  'src/hub.ts',
];
const FILES = [...SOURCE_FILES, ...TESTS];
const TEXT: Record<string, string> = {
  'src/chunker.ts': "import { rebalance } from './chunker-rebalance';\nimport { merge } from './chunker-merge';",
  'src/pipeline/orchestrator.ts': "import { chunk } from '../chunker';",
  'src/chunker.test.ts': "import { chunk } from './chunker';",
  'src/chunker-size.test.ts': "import fc from 'fast-check';\nimport { chunk } from './chunker';",
  'src/chunker-merge-helpers.test.ts': "import { mergeSmall } from './chunker-merge';",
  'src/pipeline/orchestrator.test.ts': "import { run } from './orchestrator';",
  'src/pipeline/room-assembly.test.ts': "import type { Room } from '../runtime';\nvi.mock('../chunker.ts');",
  'src/runtime/apply.test.ts': "const x = await import('./apply');",
};
const read = (path: string): string => TEXT[path] ?? '';

describe('planRelatedTests', () => {
  it('runs the tests named after the file and the tests that import it', () => {
    const plan = planRelatedTests('src/chunker.ts', FILES, read);
    expect(plan.tests).toEqual([
      'src/chunker-merge-helpers.test.ts',
      'src/chunker-size.test.ts',
      'src/chunker.test.ts',
      'src/pipeline/room-assembly.test.ts',
    ]);
  });

  it('finds a direct import written as a dynamic import, and a name match', () => {
    expect(planRelatedTests('src/runtime/apply.ts', FILES, read).tests).toEqual(['src/runtime/apply.test.ts']);
    expect(planRelatedTests('src/chunker-merge.ts', FILES, read).tests).toEqual(['src/chunker-merge-helpers.test.ts']);
  });

  it('resolves an import of a folder to its index file', () => {
    expect(planRelatedTests('src/runtime/index.ts', FILES, read).tests).toEqual(['src/pipeline/room-assembly.test.ts']);
  });

  it('reaches a test through the module that imports the file, when no test is closer', () => {
    const plan = planRelatedTests('src/chunker-rebalance.ts', FILES, read);
    expect(plan.tests).toEqual(['src/chunker-size.test.ts', 'src/chunker.test.ts', 'src/pipeline/room-assembly.test.ts']);
    expect(plan.message).toContain('through a module that imports it');
  });

  it('falls back to the tests named after the modules that import a helper, when too many tests reach it', () => {
    const many = Array.from({ length: 14 }, (_, i) => `src/x/spec-${i}.test.ts`);
    const files = ['src/helper.ts', 'src/wrapper.ts', 'src/wrapper.test.ts', 'src/wrapper-edge.test.ts', ...many];
    const text = (path: string): string =>
      path === 'src/wrapper.ts' ? "import { h } from './helper';" : path.startsWith('src/x/') ? "import { w } from '../wrapper';" : '';
    const plan = planRelatedTests('src/helper.ts', files, text);
    expect(plan.tests).toEqual(['src/wrapper-edge.test.ts', 'src/wrapper.test.ts']);
    expect(plan.message).toContain('named after the modules that import it');
  });

  it('runs a test file by itself', () => {
    expect(planRelatedTests('src/chunker.test.ts', FILES, read)).toEqual({
      tests: ['src/chunker.test.ts'],
      message: 'A test file: running it.',
    });
  });

  it('runs nothing, and says so, when no test names, imports or reaches the file', () => {
    const plan = planRelatedTests('src/orphan.ts', FILES, read);
    expect(plan.tests).toEqual([]);
    expect(plan.message).toContain('Nothing to run');
  });

  it('runs nothing for files that are not core source', () => {
    for (const file of ['README.md', 'src/data.json', 'src/types.d.ts', 'docs/a.ts']) {
      expect(planRelatedTests(file, FILES, read).tests).toEqual([]);
    }
  });

  it('caps a widely imported file at the tests named after it', () => {
    const many = Array.from({ length: 30 }, (_, i) => `src/x/spec-${i}.test.ts`);
    const plan = planRelatedTests('src/hub.ts', ['src/hub.ts', 'src/hub.test.ts', ...many], (path) =>
      path.startsWith('src/x/') ? "import { h } from '../hub';" : '',
    );
    expect(plan.tests).toEqual(['src/hub.test.ts']);
    expect(plan.message).toContain('over the cap');
  });

  it('runs nothing for a widely imported file with no test of its own name', () => {
    const many = Array.from({ length: 20 }, (_, i) => `src/x/spec-${i}.test.ts`);
    const plan = planRelatedTests('src/hub.ts', ['src/hub.ts', ...many], () => "import { h } from '../hub';");
    expect(plan.tests).toEqual([]);
    expect(plan.message).toContain('over the cap');
  });

  it('does not count a file that imports itself', () => {
    expect(planRelatedTests('src/loop.ts', ['src/loop.ts'], () => "import './loop';").tests).toEqual([]);
  });
});

describe('the real core tree', () => {
  const walk = (dir: string, out: string[] = []): string[] => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full, out);
      else out.push(full);
    }
    return out;
  };
  const files = walk(join(CORE, 'src')).map((f) => f.slice(CORE.length + 1).split('\\').join('/'));
  const code = files.filter((f) => /\.tsx?$/.test(f) && !f.endsWith('.d.ts'));
  const tests = code.filter((f) => /\.test\.tsx?$/.test(f));
  const sources = code.filter((f) => !/\.test\.tsx?$/.test(f));
  const cache = new Map<string, string>();
  const readReal = (path: string): string => {
    let text = cache.get(path);
    if (text === undefined) {
      text = readFileSync(join(CORE, path), 'utf8');
      cache.set(path, text);
    }
    return text;
  };

  it('never plans more than the cap for any saved file, so a save never runs the full suite', () => {
    expect(tests.length).toBeGreaterThan(100);
    let most = 0;
    for (const file of sources) {
      const plan = planRelatedTests(file, code, readReal);
      most = Math.max(most, plan.tests.length);
      expect(plan.tests.length, file).toBeLessThanOrEqual(MAX_RELATED_TESTS);
    }
    expect(most).toBeGreaterThan(0);
  });

  it('reaches the chunker size property test from the rebalance file', () => {
    expect(planRelatedTests('src/chunker-rebalance.ts', code, readReal).tests).toContain('src/chunker-size.test.ts');
  });
});

describe('the command line', () => {
  const run = (...args: string[]): string =>
    execFileSync(process.execPath, [join(REPO, 'scripts/hooks/related-tests.ts'), ...args], {
      cwd: REPO,
      encoding: 'utf8',
    });

  it('prints the plan and the command for a core file with --dry-run', () => {
    const out = run('--file', 'packages/core/src/runtime/apply.ts', '--dry-run');
    expect(out).toContain('[related-tests]');
    expect(out).toContain('vitest run');
    expect(out).toContain('src/runtime/apply');
  });

  it('is silent for a file outside packages/core/src', () => {
    expect(run('--file', 'apps/web/src/app.tsx', '--dry-run')).toBe('');
    expect(run('--file', 'README.md', '--dry-run')).toBe('');
  });
});
