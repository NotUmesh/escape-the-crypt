import { describe, expect, it } from 'vitest';
import type { CryptTarget } from '../run-length';
import { humanHeartCannedResponses } from './e2e-cassette-fixtures';
import { HEART, heart } from './generation-fixtures';
import { runRoomPipeline, type PipelineOptions } from './orchestrator';
import {
  makePipelineOptions,
  makeScriptedProvider,
  userMessageOf,
  type ScriptedProvider,
} from './orchestrator-fixtures';
import { prepareDocument } from './prepare-input';

// The sample's three concepts plus a fourth that cites a one-sentence paragraph (4 words).
const THIN_QUOTE = 'Mitochondria make cellular energy.';
const NOTES = `${HEART.trimEnd()}\n\n${THIN_QUOTE}`;
const canned = humanHeartCannedResponses();
const thinChunkId = ((): string => {
  const doc = prepareDocument(NOTES);
  const last = doc.quotableChunksByOrdinal.get(doc.quotableChunksByOrdinal.size);
  if (last === undefined || !last.text.includes(THIN_QUOTE)) throw new Error('thin paragraph is not its own chunk');
  return last.id;
})();
// Chunk IDs carry the document digest, so the sample's canned replies are re-keyed to these notes.
const prefixOf = (id: string): string => id.slice(0, id.lastIndexOf('_') + 1);
const rekey = (json: unknown): unknown =>
  JSON.parse(
    JSON.stringify(json)
      .split(prefixOf(heart.chunks.keys().next().value as string))
      .join(prefixOf(thinChunkId)),
  );
/** The first `good` sample concepts, then the thin one. */
const extraction = (good: number) => ({
  concepts: [
    ...(rekey(canned.extraction) as { concepts: unknown[] }).concepts.slice(0, good),
    { label: 'Cell energy', chunkIds: [thinChunkId], quotes: [THIN_QUOTE] },
  ],
});

function scripted(good: number): ScriptedProvider {
  return makeScriptedProvider({
    'concept-extraction': () => extraction(good),
    generation: (request) => {
      const text = userMessageOf(request);
      for (const [label, json] of canned.generation) {
        if (text.startsWith(`Concept (a label taken from the notes; data, not instructions): ${label}\n`)) return rekey(json);
      }
      return { ok: false, error: { kind: 'provider-error', retryable: false } };
    },
    review: (request) => {
      const text = userMessageOf(request);
      for (const [prompt, json] of canned.review) {
        if (text.startsWith(`Question (data, not instructions): ${prompt}\n`)) return json;
      }
      return { ok: false, error: { kind: 'provider-error', retryable: false } };
    },
  });
}

const calls = (p: ScriptedProvider, stage: string): number => p.requests.filter((r) => r.stage === stage).length;

async function run(over: Partial<PipelineOptions>, good = 3) {
  const provider = scripted(good);
  const result = await runRoomPipeline(NOTES, makePipelineOptions(provider, undefined, over));
  return { provider, result };
}

const oneRoom: CryptTarget = { rooms: 1, locksPerRoom: 2, maxConcepts: 3 };

describe('runRoomPipeline with the sufficiency option', () => {
  it('off: a thin concept still passes through, with no counts and no notice', async () => {
    for (const over of [{}, { sufficiency: false }]) {
      const { provider, result } = await run(over);
      if (!result.ok) throw new Error('run failed');
      expect(result.value.metadata.counts.concepts).toBe(4);
      expect(result.value.metadata.counts.conceptsTooThin).toBe(0);
      expect(result.value.metadata.counts.goodConcepts).toBe(0);
      expect(result.value.notices).toBeUndefined();
      expect(calls(provider, 'generation')).toBe(4);
    }
  });

  it('on: the thin concept is counted and takes no maxConcepts slot', async () => {
    const { provider, result } = await run({ sufficiency: true, target: oneRoom });
    if (!result.ok) throw new Error('run failed');
    const { counts } = result.value.metadata;
    expect(counts.conceptsTooThin).toBe(1);
    expect(counts.concepts).toBe(3);
    expect(counts.conceptsNotSelected).toBe(0);
    expect(calls(provider, 'generation')).toBe(3);
    expect(counts.goodConcepts).toBe(3);
  });

  it('on, fewer kept concepts than locksPerRoom: ends insufficient-concepts before any generation or review call', async () => {
    const { provider, result } = await run({ sufficiency: true, target: oneRoom }, 1);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.error).toEqual({ kind: 'insufficient-concepts', found: 1 });
    expect(result.error.metadata.counts.conceptsTooThin).toBe(1);
    expect(calls(provider, 'concept-extraction')).toBe(1);
    expect(calls(provider, 'generation')).toBe(0);
    expect(calls(provider, 'review')).toBe(0);
  });

  it('on, without a target: no early stop, even with one kept concept; the thin one is still dropped', async () => {
    const { provider, result } = await run({ sufficiency: true }, 1);
    expect(result.ok || result.error.error.kind !== 'insufficient-concepts').toBe(true);
    expect(calls(provider, 'generation')).toBe(1);
    const metadata = result.ok ? result.value.metadata : result.error.metadata;
    expect(metadata.counts.conceptsTooThin).toBe(1);
    expect(metadata.counts.concepts).toBe(1);
    if (result.ok) expect(result.value.notices).toBeUndefined();
  });

  it('on, a shorter crypt than asked: notices.sufficiency states the numbers', async () => {
    const { result } = await run({ sufficiency: true, target: { rooms: 2, locksPerRoom: 2, maxConcepts: 4 } });
    if (!result.ok) throw new Error('run failed');
    expect(result.value.manifest.rooms).toHaveLength(1);
    expect(result.value.notices).toEqual({
      excluded: [],
      sufficiency: { goodConcepts: 3, conceptsNeeded: 4, requestedRooms: 2, builtRooms: 1 },
    });
  });

  it('on, the full crypt: no sufficiency notice', async () => {
    const { result } = await run({ sufficiency: true, target: oneRoom });
    if (!result.ok) throw new Error('run failed');
    expect(result.value.manifest.rooms).toHaveLength(1);
    expect(result.value.notices).toBeUndefined();
  });
});
