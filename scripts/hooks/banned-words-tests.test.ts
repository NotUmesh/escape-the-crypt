import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { CORE_WORDING_TEST, isCopyFile, planWordingTests } from './banned-words-tests.ts';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const has = (...present: string[]) => (path: string): boolean => present.includes(path);

describe('isCopyFile', () => {
  it('accepts the copy files of core and web, and their tests', () => {
    for (const rel of [
      'packages/core/src/copy.ts',
      'packages/core/src/copy-room-play.ts',
      'packages/core/src/copy-banned-words.test.ts',
      'apps/web/src/features/share/share-card-copy.ts',
      'apps/web/src/features/desk/front-of-house-copy.test.ts',
    ]) {
      expect(isCopyFile(rel), rel).toBe(true);
    }
  });

  it('rejects other files, other folders and look-alikes', () => {
    for (const rel of [
      'packages/core/src/copyright.md',
      'packages/core/src/copy.tsx',
      'packages/core/src/chunker.ts',
      'apps/worker/src/http/copy.ts',
      'docs/copy.ts',
      'apps/web/src/features/crypt/copy-editor.tsx',
      'apps/web/src/features/start/resume-entry.tsx',
    ]) {
      expect(isCopyFile(rel), rel).toBe(false);
    }
  });
});

describe('planWordingTests', () => {
  it('sends every core copy file to the core banned-words test', () => {
    for (const rel of ['packages/core/src/copy.ts', 'packages/core/src/copy-room-play.ts']) {
      expect(planWordingTests(rel, has())).toMatchObject({ packageDir: 'packages/core', tests: [CORE_WORDING_TEST] });
    }
  });

  it('runs a core copy test by itself', () => {
    expect(planWordingTests('packages/core/src/copy-counts.test.ts', has())?.tests).toEqual(['src/copy-counts.test.ts']);
  });

  it('sends a web copy file to the test named after it', () => {
    const plan = planWordingTests(
      'apps/web/src/features/share/share-card-copy.ts',
      has('apps/web/src/features/share/share-card-copy.test.ts'),
    );
    expect(plan).toMatchObject({ packageDir: 'apps/web', tests: ['src/features/share/share-card-copy.test.ts'] });
  });

  it('says a web copy file has no wording test instead of borrowing another test', () => {
    const plan = planWordingTests('apps/web/src/features/new/new-copy.ts', has());
    expect(plan?.tests).toEqual([]);
    expect(plan?.message).toContain('No wording test next to apps/web/src/features/new/new-copy.ts');
  });

  it('is undefined for files that are not copy files', () => {
    expect(planWordingTests('packages/core/src/chunker.ts', has())).toBeUndefined();
  });

  it('plans one test file at most', () => {
    expect(planWordingTests('packages/core/src/copy.ts', has())?.tests.length).toBeLessThanOrEqual(1);
  });
});

describe('the copy files in the repository', () => {
  const exists = (rel: string): boolean => existsSync(join(REPO, rel));

  it('the core wording test exists', () => {
    expect(exists(`packages/core/${CORE_WORDING_TEST}`)).toBe(true);
  });

  it('the front-of-house and share copy files have the wording tests the hook would run', () => {
    for (const rel of ['apps/web/src/features/desk/front-of-house-copy.ts', 'apps/web/src/features/share/share-card-copy.ts']) {
      const plan = planWordingTests(rel, exists);
      expect(plan?.tests.length, rel).toBe(1);
      expect(exists(`apps/web/${plan?.tests[0]}`), rel).toBe(true);
    }
  });
});

describe('the command line', () => {
  const run = (...args: string[]): string =>
    execFileSync(process.execPath, [join(REPO, 'scripts/hooks/banned-words-tests.ts'), ...args], { cwd: REPO, encoding: 'utf8' });

  it('prints the plan and the command for a copy file with --dry-run', () => {
    const out = run('--file', 'packages/core/src/copy.ts', '--dry-run');
    expect(out).toContain('[banned-words]');
    expect(out).toContain('src/copy-banned-words.test.ts');
  });

  it('is silent for a file that is not a copy file', () => {
    expect(run('--file', 'packages/core/src/chunker.ts', '--dry-run')).toBe('');
  });
});
