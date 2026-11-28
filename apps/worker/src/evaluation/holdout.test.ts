import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Provider } from '@escape-the-crypt/core';
import { afterEach, describe, expect, it } from 'vitest';
import { main, type Io } from './cli';
import { HOLDOUT_LEDGER, holdoutGuard } from './holdout';
import { evaluationPaths } from './paths';
import { parseEvaluationResult } from './result-file';

const roots: string[] = [];
afterEach(() => {
  for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true });
});

function io(): Io & { lines: string[] } {
  const lines: string[] = [];
  return { lines, out: (l) => void lines.push(l), now: () => 0, date: () => new Date('2026-11-27T12:00:00Z') };
}

/** A temp repo with an empty results folder; `withNotes` adds one holdout note. */
function repo(withNotes: boolean) {
  const root = mkdtempSync(join(tmpdir(), 'holdout-'));
  roots.push(root);
  const paths = evaluationPaths(root);
  mkdirSync(paths.resultsDir, { recursive: true });
  if (withNotes) {
    mkdirSync(paths.holdoutNotesDir, { recursive: true });
    writeFileSync(join(paths.holdoutNotesDir, 'h-01.txt'), 'Held out text.');
  }
  return { root, paths };
}

const HOLDOUT = ['holdout', '--confirm-final-run', '--model', 'm-1', '--input-usd-per-mtok', '1', '--output-usd-per-mtok', '4', '--cap-usd', '1'];
const failing: Provider = { complete: () => Promise.resolve({ ok: false, error: { kind: 'provider-error', retryable: false } }) };
const resultFiles = (dir: string): string[] => readdirSync(dir).sort();

describe('holdoutGuard', () => {
  it('allows a results folder with dev results and ordinary ledgers, and one that does not exist', () => {
    const { paths } = repo(false);
    writeFileSync(join(paths.resultsDir, '2026-11-27.json'), JSON.stringify({ set: 'dev' }));
    writeFileSync(join(paths.resultsDir, 'ledger-six-types.json'), JSON.stringify({ capMicroUsd: 1, spentMicroUsd: 0, runs: [] }));
    expect(holdoutGuard(paths.resultsDir)).toEqual({ ok: true });
    expect(holdoutGuard(join(paths.resultsDir, 'nope'))).toEqual({ ok: true });
  });

  it('refuses a holdout result, the holdout ledger, and a file it cannot read', () => {
    const { paths } = repo(false);
    writeFileSync(join(paths.resultsDir, 'x.json'), JSON.stringify({ set: 'holdout' }));
    expect(holdoutGuard(paths.resultsDir)).toMatchObject({ ok: false, message: expect.stringContaining('x.json is already a holdout result') });
    rmSync(join(paths.resultsDir, 'x.json'));
    writeFileSync(join(paths.resultsDir, HOLDOUT_LEDGER), '{}');
    expect(holdoutGuard(paths.resultsDir)).toMatchObject({ ok: false, message: expect.stringContaining('already been run') });
    rmSync(join(paths.resultsDir, HOLDOUT_LEDGER));
    writeFileSync(join(paths.resultsDir, 'broken.json'), '{not json');
    expect(holdoutGuard(paths.resultsDir)).toMatchObject({ ok: false, message: expect.stringContaining('broken.json cannot be read') });
  });
});

describe('eval holdout refuses before reading or spending anything', () => {
  it('without --confirm-final-run', async () => {
    const { root, paths } = repo(true);
    const out = io();
    expect(await main(HOLDOUT.filter((a) => a !== '--confirm-final-run'), {}, root, out, { live: failing })).toBe(1);
    expect(out.lines[0]).toContain('--confirm-final-run');
    expect(resultFiles(paths.resultsDir)).toEqual([]);
  });

  it('when a holdout result already exists, without ever reading the notes (they are not even there)', async () => {
    const { root, paths } = repo(false);
    writeFileSync(join(paths.resultsDir, 'holdout-2026-11-20.json'), JSON.stringify({ set: 'holdout' }));
    const out = io();
    expect(await main(HOLDOUT, {}, root, out, { live: failing })).toBe(1);
    expect(out.lines).toEqual(['holdout-2026-11-20.json is already a holdout result: the holdout set runs once. Nothing was read or spent.']);
  });

  it('when the holdout ledger exists, because a run cut off after spending is still a run', async () => {
    const { root, paths } = repo(true);
    writeFileSync(join(paths.resultsDir, HOLDOUT_LEDGER), '{}');
    const out = io();
    expect(await main(HOLDOUT, {}, root, out, { live: failing })).toBe(1);
    expect(out.lines[0]).toContain('already been run');
  });

  it('for a model ID that is not a plain folder name, and for an unknown provider', async () => {
    const { root } = repo(true);
    expect(await main(['holdout', '--confirm-final-run', '--model', '../escape'], {}, root, io(), { live: failing })).toBe(1);
    const out = io();
    expect(await main([...HOLDOUT, '--provider', 'claude'], {}, root, out, { live: failing })).toBe(1);
    expect(out.lines[0]).toContain('Unknown provider');
  });

  it('with no key in the shell, before reading the notes', async () => {
    const { root, paths } = repo(false);
    const out = io();
    expect(await main(HOLDOUT, {}, root, out)).toBe(1);
    expect(out.lines).toEqual(['OPENAI_API_KEY is not set in this shell. Nothing was called.']);
    expect(resultFiles(paths.resultsDir)).toEqual([]);
  });
});

describe('eval holdout runs once', () => {
  it('writes a holdout result and the holdout ledger, then refuses a second run', async () => {
    const { root, paths } = repo(true);
    const first = io();
    expect(await main(HOLDOUT, {}, root, first, { live: failing })).toBe(0);
    expect(resultFiles(paths.resultsDir)).toEqual(['holdout-2026-11-27.json', HOLDOUT_LEDGER]);
    const written = parseEvaluationResult(JSON.parse(readFileSync(join(paths.resultsDir, 'holdout-2026-11-27.json'), 'utf8')) as unknown);
    expect(written.ok && written.value.set).toBe('holdout');
    expect(written.ok && written.value.notes.map((n) => n.note)).toEqual(['h-01.txt']);
    expect(existsSync(join(paths.resultsDir, '2026-11-27.json'))).toBe(false);

    const before = resultFiles(paths.resultsDir);
    const second = io();
    expect(await main(HOLDOUT, {}, root, second, { live: failing })).toBe(1);
    expect(second.lines[0]).toContain('holdout set runs once');
    expect(resultFiles(paths.resultsDir)).toEqual(before);
  });
});
