import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Provider } from '@escape-the-crypt/core';
import { afterEach, describe, expect, it, vi } from 'vitest';

// Every path handed to a reading function of node:fs by the evaluation code while a test runs.
const reads = vi.hoisted(() => [] as string[]);
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  const spy = <F>(fn: F): F =>
    ((...args: unknown[]) => {
      reads.push(String(args[0]));
      return (fn as unknown as (...a: unknown[]) => unknown)(...args);
    }) as unknown as F;
  return { ...actual, readFileSync: spy(actual.readFileSync), readdirSync: spy(actual.readdirSync), existsSync: spy(actual.existsSync), statSync: spy(actual.statSync) };
});

import { main, type Io } from './cli';
import { DEV_NOTES_DIR, evaluationPaths } from './paths';
import { FIXTURE_RESULT, fakeRepoWithFixture } from './ratings-test-support';

const roots: string[] = [];
afterEach(() => {
  for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true });
  reads.length = 0;
});

const io = (): Io => ({ out: () => undefined, now: () => 0, date: () => new Date('2026-11-27T12:00:00Z') });
const failing: Provider = { complete: () => Promise.resolve({ ok: false, error: { kind: 'provider-error', retryable: false } }) };
const touchesHoldout = (): string[] => reads.filter((p) => /holdout/i.test(p.replace(/\\/g, '/').split('/').slice(-6).join('/')));

/** A repo that has the fixture dev run AND a populated holdout folder with a cassette in it. */
function repoWithHoldoutData() {
  const { root, resultsDir } = fakeRepoWithFixture();
  roots.push(root);
  const paths = evaluationPaths(root);
  mkdirSync(paths.holdoutNotesDir, { recursive: true });
  writeFileSync(join(paths.holdoutNotesDir, 'h-01.txt'), 'Held out text.');
  mkdirSync(paths.holdoutCassettesDir('openai', 'gpt-fixture'), { recursive: true });
  writeFileSync(join(paths.holdoutCassettesDir('openai', 'gpt-fixture'), 'h-01.json'), '{}');
  writeFileSync(join(resultsDir, 'rater.csv'), readFileSync(new URL('./test-fixtures/rater-ann.csv', import.meta.url), 'utf8'));
  return { root, paths, resultsDir };
}

describe('the holdout folder is read by `holdout` and by nothing else', () => {
  it('replay, record, export-ratings, import-ratings and a refused holdout never read it', async () => {
    const { root, resultsDir } = repoWithHoldoutData();
    reads.length = 0;
    const RECORD = ['record', '--model', 'm', '--input-usd-per-mtok', '1', '--output-usd-per-mtok', '1', '--cap-usd', '1', '--ledger', 'ledger-iso.json'];
    expect(await main(['replay', '--model', 'gpt-fixture'], {}, root, io())).toBe(0);
    expect(await main(RECORD, {}, root, io(), { live: failing })).toBe(0);
    expect(await main(['export-ratings', '--result', FIXTURE_RESULT], {}, root, io())).toBe(0);
    expect(await main(['import-ratings', '--result', FIXTURE_RESULT, '--csv', 'rater.csv'], {}, root, io())).toBe(0);
    expect(await main(['holdout', '--model', 'm'], {}, root, io(), { live: failing })).toBe(1);
    expect(readdirSync(resultsDir)).toContain('fixture-rated.json');
    // The spy works: the dev notes were read during this run...
    expect(reads.some((p) => p.replace(/\\/g, '/').endsWith(DEV_NOTES_DIR))).toBe(true);
    // ...and nothing under the holdout folder was.
    expect(touchesHoldout()).toEqual([]);
  });

  it('control: the holdout mode does read the holdout notes (so the check above can fail)', async () => {
    const { root } = repoWithHoldoutData();
    reads.length = 0;
    const args = ['holdout', '--confirm-final-run', '--model', 'gpt-fixture', '--input-usd-per-mtok', '1', '--output-usd-per-mtok', '1', '--cap-usd', '1'];
    expect(await main(args, {}, root, io(), { live: failing })).toBe(0);
    expect(touchesHoldout().length).toBeGreaterThan(0);
  });
});

describe('only the paths module names the holdout folder', () => {
  it('no other file under apps/worker/src contains its path', () => {
    const literal = ['eval', 'holdout'].join('/');
    const src = fileURLToPath(new URL('../', import.meta.url));
    const files: string[] = [];
    const walk = (dir: string): void => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        if (e.isDirectory()) walk(join(dir, e.name));
        else if (e.name.endsWith('.ts')) files.push(join(dir, e.name));
      }
    };
    walk(src);
    expect(files.length).toBeGreaterThan(50);
    const offenders = files.filter((f) => readFileSync(f, 'utf8').includes(literal)).map((f) => relative(src, f).replace(/\\/g, '/'));
    expect(offenders).toEqual(['evaluation/paths.ts']);
  });
});
