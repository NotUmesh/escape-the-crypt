import { describe, expect, it } from 'vitest';
import { makeCassetteProvider } from '../cassette/cassette-provider';
import { parseCassetteFile } from '../cassette/types';
import {
  HUMAN_HEART_E2E_CASSETTE_PATH,
  HUMAN_HEART_E2E_OPTIONS,
  humanHeartE2eLedger,
} from './e2e-cassette-fixtures';
import { HEART } from './generation-fixtures';
import { runRoomPipeline } from './orchestrator';
import { LEGACY_ASSEMBLY_POLICY } from './room-assembly';

const [fsName]: string[] = ['node:fs'];
const fs = (await import(fsName!)) as unknown as { readFileSync(p: string, enc: string): string };

async function run(legacy = false) {
  const parsed = parseCassetteFile(JSON.parse(fs.readFileSync(HUMAN_HEART_E2E_CASSETTE_PATH, 'utf8')));
  if (!parsed.ok) throw new Error('cassette does not parse');
  const result = await runRoomPipeline(HEART, {
    ...HUMAN_HEART_E2E_OPTIONS,
    provider: makeCassetteProvider(parsed.value),
    ledger: humanHeartE2eLedger(),
    ...(legacy ? { assemblyPolicy: LEGACY_ASSEMBLY_POLICY } : {}),
  });
  if (!result.ok) throw new Error(`pipeline failed: ${result.error.error.kind}`);
  return result.value;
}

describe('run metadata: per-concept and per-question outcomes', () => {
  it('records a positive source word count per concept, without text', async () => {
    const { metadata } = await run();
    expect(metadata.outcomes.concepts.length).toBeGreaterThan(0);
    for (const c of metadata.outcomes.concepts) {
      expect(Number.isInteger(c.sourceWords)).toBe(true);
      expect(c.sourceWords).toBeGreaterThan(0);
    }
  });

  it('records lock type, role, result and placement for every generated question', async () => {
    const { metadata } = await run();
    expect(metadata.outcomes.concepts.map((c) => [c.conceptId, c.generation])).toEqual([
      ['concept-1', 'questions'],
      ['concept-2', 'questions'],
      ['concept-3', 'questions'],
    ]);
    expect(
      metadata.outcomes.candidates.map((c) => [c.conceptId, c.role, c.lockType, c.result, c.placement]),
    ).toEqual([
      ['concept-1', 'primary', 'rune-cipher', 'accepted', 'slot-lead'],
      ['concept-1', 'alternate', 'seance-board', 'accepted', 'slot-alternate'],
      ['concept-2', 'primary', 'seance-board', 'accepted', 'slot-lead'],
      ['concept-2', 'alternate', 'rune-cipher', 'accepted', 'slot-alternate'],
      ['concept-3', 'primary', 'rune-cipher', 'accepted', 'unplaced'],
    ]);
    expect(metadata.outcomes.candidates.every((c) => c.checkIds.length === 0 && c.reviewReason === null)).toBe(true);
  });

  it('holds IDs and closed-set names only, never question or notes text', async () => {
    const { metadata, content } = await run();
    const json = JSON.stringify(metadata.outcomes);
    for (const entry of Object.values(content.questions)) {
      expect(json).not.toContain(entry.prompt);
      for (const text of Object.values(entry.options ?? {})) expect(json).not.toContain(`"${text}"`);
    }
    expect(json).not.toContain(HEART.slice(0, 40));
  });

  it('the assembly policy changes placement only, never the provider calls', async () => {
    const current = await run();
    const legacy = await run(true);
    expect(legacy.metadata.promptDigests).toEqual(current.metadata.promptDigests);
    expect(legacy.manifest).toEqual(current.manifest);
  });
});
