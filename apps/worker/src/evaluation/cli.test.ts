import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { EVAL_ALLOWED_LOCK_TYPES } from '../config';
import { main, parseAllowedLockTypes, settingsFor, type Io } from './cli';
import { DEV_CASSETTES_DIR, DEV_GEMINI_CASSETTES_DIR, DEV_NOTES_DIR, RESULTS_DIR, evaluationPaths } from './paths';

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

  describe('--allowed-lock-types', () => {
    it('parses a valid comma-separated list, trimming repeats', () => {
      expect(parseAllowedLockTypes('rune-cipher,seance-board')).toEqual({ ok: true, value: ['rune-cipher', 'seance-board'] });
      expect(parseAllowedLockTypes('cursed-object rune-cipher,rune-cipher')).toEqual({ ok: true, value: ['cursed-object', 'rune-cipher'] });
    });

    it('returns a typed error for an unknown or empty value', () => {
      expect(parseAllowedLockTypes('rune-cipher,ghost')).toEqual({ ok: false, error: { kind: 'invalid-lock-type', value: 'ghost' } });
      expect(parseAllowedLockTypes('')).toEqual({ ok: false, error: { kind: 'empty-lock-type-list' } });
    });

    it('defaults to the evaluation list, and settingsFor carries the chosen list', () => {
      const prices = { inputUsdPerMTok: 0, outputUsdPerMTok: 0 };
      expect(parseAllowedLockTypes(undefined)).toEqual({ ok: true, value: EVAL_ALLOWED_LOCK_TYPES });
      expect(settingsFor('m', prices).allowedLockTypes).toEqual(EVAL_ALLOWED_LOCK_TYPES);
      expect(settingsFor('m', prices, ['rune-cipher', 'seance-board']).allowedLockTypes).toEqual(['rune-cipher', 'seance-board']);
      expect(EVAL_ALLOWED_LOCK_TYPES).not.toEqual(['rune-cipher', 'seance-board']);
    });

    it('record rejects an invalid value with exit 1 before reading the key', async () => {
      const out = io();
      expect(await main([...RECORD, '--allowed-lock-types', 'ghost'], { OPENAI_API_KEY: 'k' }, fakeRepo(), out)).toBe(1);
      expect(out.lines[0]).toBe('Unknown lock type "ghost". Nothing was called.');
      expect(out.lines.join('\n')).toContain('--allowed-lock-types');
    });

    it('record accepts a valid value and moves on to the key check', async () => {
      const out = io();
      expect(await main([...RECORD, '--allowed-lock-types', 'rune-cipher,seance-board'], {}, fakeRepo(), out)).toBe(1);
      expect(out.lines).toEqual(['OPENAI_API_KEY is not set in this shell. Nothing was called.']);
    });

    it('replay rejects an invalid value with exit 1 and accepts a valid one', async () => {
      const bad = io();
      expect(await main(['replay', '--model', 'm', '--allowed-lock-types', 'rune-cipher,nope'], {}, fakeRepo(), bad)).toBe(1);
      expect(bad.lines[0]).toBe('Unknown lock type "nope". Nothing was called.');
      expect(await main(['replay', '--model', 'm', '--allowed-lock-types', 'rune-cipher,seance-board'], {}, fakeRepo(), io())).toBe(0);
    });

    it('replay with all six types reproduces the recorded dev-01 prompt digests', async () => {
      const realRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
      const replay = async (extra: readonly string[]): Promise<{ promptDigests: string[]; liveCalls: number; replayedCalls: number }> => {
        const out = io();
        const code = await main(['replay', '--model', 'gpt-5.4-mini', '--only', 'dev-01', ...extra], {}, realRoot, out);
        expect(code).toBe(0);
        const json = out.lines.find((l) => l.startsWith('{')) ?? '{}';
        const parsed = JSON.parse(json) as { notes: { promptDigests: string[]; liveCalls: number; replayedCalls: number }[] };
        return parsed.notes[0] ?? { promptDigests: [], liveCalls: 0, replayedCalls: 0 };
      };
      const cassette = JSON.parse(readFileSync(join(realRoot, 'packages/core/src/test-support/cassettes/dev/dev-01-vaccines.json'), 'utf8')) as { entries: { digest: string }[] };
      const recorded = new Set(cassette.entries.map((e) => e.digest));
      const two = await replay(['--allowed-lock-types', 'rune-cipher,seance-board,bone-ordering,bound-threads,cursed-object,combination-dial']);
      expect(two.promptDigests.length).toBeGreaterThan(0);
      expect(two.promptDigests.every((d) => recorded.has(d))).toBe(true);
      expect(two.replayedCalls).toBeGreaterThan(0);
      expect(two.liveCalls).toBe(0);
    });
  });

  describe('--provider', () => {
    it('record with gemini reads GEMINI_API_KEY only, and calls nothing without it', async () => {
      const root = fakeRepo();
      const out = io();
      expect(await main([...RECORD, '--provider', 'gemini'], { OPENAI_API_KEY: 'sk-other' }, root, out)).toBe(1);
      expect(out.lines).toEqual(['GEMINI_API_KEY is not set in this shell. Nothing was called.']);
      expect(existsSync(join(root, RESULTS_DIR))).toBe(false);
    });

    it('rejects an unknown provider and a Gemini model ID that is not bare', async () => {
      const bad = io();
      expect(await main(['replay', '--model', 'm', '--provider', 'claude'], {}, fakeRepo(), bad)).toBe(1);
      expect(bad.lines[0]).toBe('Unknown provider "claude"; use openai or gemini. Nothing was called.');
      const path = io();
      expect(await main(['replay', '--model', '../dev', '--provider', 'gemini'], {}, fakeRepo(), path)).toBe(1);
      expect(path.lines[0]).toContain('bare model ID');
    });

    it('keeps each provider and model in its own cassette folder', () => {
      const paths = evaluationPaths('/repo');
      expect(paths.cassettesDirFor('openai', 'gpt-5.4-mini')).toBe(join('/repo', DEV_CASSETTES_DIR));
      expect(paths.cassettesDirFor('gemini', 'gemini-3.8-flash')).toBe(join('/repo', DEV_GEMINI_CASSETTES_DIR, 'gemini-3.8-flash'));
    });

    it('gemini replay never reads the OpenAI cassettes, even for the same model ID', async () => {
      const realRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
      const out = io();
      expect(await main(['replay', '--provider', 'gemini', '--model', 'gpt-5.4-mini', '--only', 'dev-01'], {}, realRoot, out)).toBe(0);
      const json = out.lines.find((l) => l.startsWith('{')) ?? '{}';
      const note = (JSON.parse(json) as { notes: { ok: boolean; liveCalls: number; replayedCalls: number }[] }).notes[0];
      expect(note).toMatchObject({ ok: false, liveCalls: 0, replayedCalls: 0 });
    });
  });

  it('replay writes no files and needs no key', async () => {
    const root = fakeRepo();
    const out = io();
    expect(await main(['replay', '--model', 'm'], {}, root, out)).toBe(0);
    expect(existsSync(join(root, RESULTS_DIR))).toBe(false);
    expect(out.lines.some((l) => l.includes('dev-01-x.txt: failed'))).toBe(true);
  });
});
