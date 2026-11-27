import { describe, expect, it } from 'vitest';
import { makeCassetteProvider } from '../cassette/cassette-provider';
import { parseCassetteFile } from '../cassette/types';
import { HUMAN_HEART_E2E_CASSETTE_PATH, HUMAN_HEART_E2E_OPTIONS, humanHeartE2eLedger } from './e2e-cassette-fixtures';
import { HEART } from './generation-fixtures';
import { runRoomPipeline } from './orchestrator';
import { progressReporter, type PipelineProgress } from './pipeline-progress';

const [fsName]: string[] = ['node:fs'];
const fs = (await import(fsName!)) as unknown as { readFileSync(p: string, enc: string): string };

async function run(onProgress?: (p: PipelineProgress) => void) {
  const parsed = parseCassetteFile(JSON.parse(fs.readFileSync(HUMAN_HEART_E2E_CASSETTE_PATH, 'utf8')));
  if (!parsed.ok) throw new Error('cassette does not parse');
  return runRoomPipeline(HEART, {
    ...HUMAN_HEART_E2E_OPTIONS,
    provider: makeCassetteProvider(parsed.value),
    ledger: humanHeartE2eLedger(),
    ...(onProgress === undefined ? {} : { onProgress }),
  });
}

describe('pipeline progress', () => {
  it('reports the stages in order, with real counts for generation and review', async () => {
    const seen: PipelineProgress[] = [];
    const result = await run((p) => seen.push(p));
    expect(result.ok).toBe(true);
    // The human-heart cassette: 3 concepts generated, then 5 questions reviewed.
    expect(seen).toEqual([
      { stage: 'extracting' },
      { stage: 'generating', done: 0, total: 3 },
      { stage: 'generating', done: 1, total: 3 },
      { stage: 'generating', done: 2, total: 3 },
      { stage: 'generating', done: 3, total: 3 },
      { stage: 'reviewing', done: 0, total: 5 },
      { stage: 'reviewing', done: 1, total: 5 },
      { stage: 'reviewing', done: 2, total: 5 },
      { stage: 'reviewing', done: 3, total: 5 },
      { stage: 'reviewing', done: 4, total: 5 },
      { stage: 'reviewing', done: 5, total: 5 },
      { stage: 'assembling' },
    ]);
  });

  it('changes nothing about the run, and a throwing callback cannot break it', async () => {
    const plain = await run();
    const loud = await run(() => {
      throw new Error('a broken progress listener');
    });
    expect(loud.ok && plain.ok && loud.value.manifest).toEqual(plain.ok && plain.value.manifest);
    expect(loud.ok && loud.value.metadata.promptDigests).toEqual(plain.ok && plain.value.metadata.promptDigests);
  });

  it('never counts past the total', () => {
    const seen: PipelineProgress[] = [];
    const step = progressReporter((p) => seen.push(p)).counted('reviewing', 1);
    step();
    step();
    expect(seen.at(-1)).toEqual({ stage: 'reviewing', done: 1, total: 1 });
  });
});
