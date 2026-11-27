import { describe, expect, it } from 'vitest';
import { parseCassetteFile } from '../cassette/types';
import { CHECK_VERSION } from '../checks/registry';
import {
  HUMAN_HEART_E2E_CASSETTE_PATH,
  captureHumanHeartE2e,
} from './e2e-cassette-fixtures';

const [fsName]: string[] = ['node:fs'];
const fs = (await import(fsName!)) as unknown as { readFileSync(p: string, enc: string): string };
const env = (globalThis as unknown as { process?: { env: Record<string, string | undefined> } })
  .process?.env;

function loadCassette() {
  const parsed = parseCassetteFile(JSON.parse(fs.readFileSync(HUMAN_HEART_E2E_CASSETTE_PATH, 'utf8')));
  if (!parsed.ok) throw new Error('human-heart-e2e.json does not parse as a cassette');
  return parsed.value;
}

describe('human-heart end-to-end cassette', () => {
  it('prints the cassette JSON when REGENERATE is set (never writes a file)', async () => {
    if (env?.REGENERATE === undefined) return;
    const { entries } = await captureHumanHeartE2e();
    const file = { checkVersion: CHECK_VERSION, entries };
    const out = (globalThis as unknown as { console: { log(s: string): void } }).console;
    out.log(`<<<CASSETTE\n${JSON.stringify(file, null, 2)}\nCASSETTE>>>`);
  });

  it('is a synthetic cassette at the current check version', () => {
    const file = loadCassette();
    expect(file.checkVersion).toBe(CHECK_VERSION);
    expect(file.entries.length).toBeGreaterThan(0);
    expect(file.entries.every((e) => e.origin === 'synthetic')).toBe(true);
  });

  it('holds exactly one entry per call the pipeline makes, with matching digests and responses', async () => {
    const file = loadCassette();
    const { entries, stages, result } = await captureHumanHeartE2e();

    // 1 extraction, 3 generation (one per concept), 5 review (one per question past Code_Checks).
    expect(stages).toEqual([
      'concept-extraction',
      'generation',
      'generation',
      'generation',
      'review',
      'review',
      'review',
      'review',
      'review',
    ]);

    const recorded = entries.map((e) => e.digest);
    expect(new Set(recorded).size).toBe(recorded.length);
    expect(file.entries.map((e) => e.digest)).toEqual(recorded);
    expect(file.entries.map((e) => e.response)).toEqual(entries.map((e) => e.response));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.unplacedAccepted.map((u) => u.conceptId)).toEqual(['concept-3']);
  });
});
