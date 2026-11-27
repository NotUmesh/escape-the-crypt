import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { main, type Io } from './cli';
import { DEV_NOTES_DIR, RESULTS_DIR } from './paths';

const roots: string[] = [];
function fakeRepo(): string {
  const root = mkdtempSync(join(tmpdir(), 'eval-cli-'));
  roots.push(root);
  mkdirSync(join(root, DEV_NOTES_DIR), { recursive: true });
  writeFileSync(join(root, DEV_NOTES_DIR, 'dev-01-x.txt'), 'Some notes.');
  return root;
}
afterEach(() => {
  for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true });
});

function io(): Io & { lines: string[] } {
  const lines: string[] = [];
  return { lines, out: (l) => void lines.push(l), now: () => 0, date: () => new Date('2026-11-27T12:00:00Z') };
}

const RECORD = ['record', '--model', 'm', '--input-usd-per-mtok', '0.75', '--output-usd-per-mtok', '4.5', '--cap-usd', '1.20', '--ledger', 'ledger-x.json'];

describe('evaluation CLI', () => {
  it('prints usage and exits 1 for an unknown mode or missing flags', async () => {
    const out = io();
    expect(await main(['bogus'], {}, fakeRepo(), out)).toBe(1);
    expect(await main(['record', '--model', 'm'], {}, fakeRepo(), out)).toBe(1);
    expect(out.lines.join('\n')).toContain('Usage');
  });

  it('refuses a ledger name with folder parts', async () => {
    const args = [...RECORD.slice(0, -1), '../ledger.json'];
    expect(await main(args, { OPENAI_API_KEY: 'k' }, fakeRepo(), io())).toBe(1);
  });

  it('without a key, calls nothing and writes nothing', async () => {
    const root = fakeRepo();
    const out = io();
    expect(await main(RECORD, {}, root, out)).toBe(1);
    expect(out.lines).toEqual(['OPENAI_API_KEY is not set in this shell. Nothing was called.']);
    expect(existsSync(join(root, RESULTS_DIR))).toBe(false);
  });

  it('never prints the key', async () => {
    const root = fakeRepo();
    const out = io();
    // A cap that differs from an existing ledger file stops the run before any call.
    mkdirSync(join(root, RESULTS_DIR), { recursive: true });
    writeFileSync(join(root, RESULTS_DIR, 'ledger-x.json'), JSON.stringify({ capMicroUsd: 600000, spentMicroUsd: 0, runs: [] }));
    expect(await main(RECORD, { OPENAI_API_KEY: 'sk-secret-value' }, root, out)).toBe(1);
    expect(out.lines.join('\n')).not.toContain('sk-secret-value');
    expect(readdirSync(join(root, RESULTS_DIR))).toEqual(['ledger-x.json']);
  });

  it('replay writes no files and needs no key', async () => {
    const root = fakeRepo();
    const out = io();
    expect(await main(['replay', '--model', 'm'], {}, root, out)).toBe(0);
    expect(existsSync(join(root, RESULTS_DIR))).toBe(false);
    expect(out.lines.some((l) => l.includes('dev-01-x.txt: failed'))).toBe(true);
  });
});
