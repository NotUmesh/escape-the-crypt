import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { makeMockLedger } from '../budget/mock-ledger';
import { humanHeartCannedResponses } from './e2e-cassette-fixtures';
import { HEART, heart } from './generation-fixtures';
import { runRoomPipeline } from './orchestrator';
import { makePipelineOptions, makeScriptedProvider, userMessageOf, type ScriptedProvider } from './orchestrator-fixtures';
import { prepareDocument } from './prepare-input';

// The sample's three concepts plus an optional fourth that cites a one-sentence paragraph (4 words).
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
    JSON.stringify(json).split(prefixOf(heart.chunks.keys().next().value as string)).join(prefixOf(thinChunkId)),
  );
const sampleConcepts = (rekey(canned.extraction) as { concepts: { label: string }[] }).concepts;
const promptsOf = (label: string): string[] => {
  const json = rekey(canned.generation.get(label)) as { primary?: { prompt: string }; alternate?: { prompt: string } | null };
  return [json.primary?.prompt, json.alternate?.prompt].filter((p): p is string => typeof p === 'string');
};

interface Scenario {
  readonly good: number;
  readonly thin: boolean;
  readonly rooms: number;
  readonly reviewFails: readonly boolean[];
}

function scripted(s: Scenario): ScriptedProvider {
  const failing = new Set(sampleConcepts.slice(0, s.good).flatMap((c, i) => (s.reviewFails[i] ? promptsOf(c.label) : [])));
  return makeScriptedProvider({
    'concept-extraction': () => ({
      concepts: [
        ...sampleConcepts.slice(0, s.good),
        ...(s.thin ? [{ label: 'Cell energy', chunkIds: [thinChunkId], quotes: [THIN_QUOTE] }] : []),
      ],
    }),
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
        if (text.startsWith(`Question (data, not instructions): ${prompt}\n`)) {
          return failing.has(prompt) ? { ok: false, error: { kind: 'provider-error', retryable: false } } : json;
        }
      }
      return { ok: false, error: { kind: 'provider-error', retryable: false } };
    },
  });
}

const scenarios = fc.record({
  good: fc.integer({ min: 0, max: 3 }),
  thin: fc.boolean(),
  rooms: fc.integer({ min: 1, max: 4 }),
  reviewFails: fc.array(fc.boolean(), { minLength: 3, maxLength: 3 }),
});

const calls = (p: ScriptedProvider, stage: string): number => p.requests.filter((r) => r.stage === stage).length;

describe('pipeline sufficiency accounting (property)', () => {
  // Feature: generation-and-evaluation, Property 36: Sufficiency accounting matches the rooms built (pipeline half)
  it('Property 36: rooms built never exceed min(target.rooms, floor(goodConcepts / 2))', async () => {
    // **Validates: Requirements 17.1, 17.2**
    await fc.assert(
      fc.asyncProperty(scenarios, async (s) => {
        const provider = scripted(s);
        const target = { rooms: s.rooms, locksPerRoom: 2 as const, maxConcepts: s.rooms * 3 };
        const result = await runRoomPipeline(
          NOTES,
          makePipelineOptions(provider, makeMockLedger({ dailyCapUsd: 1000 }), { sufficiency: true, target }),
        );
        if (!result.ok) return;
        const { goodConcepts } = result.value.metadata.counts;
        expect(result.value.manifest.rooms.length).toBeLessThanOrEqual(Math.min(s.rooms, Math.floor(goodConcepts / 2)));
      }),
      { numRuns: 40 },
    );
  });

  // Feature: generation-and-evaluation, Property 36: Sufficiency accounting matches the rooms built (pipeline half)
  it('Property 36: fewer kept concepts than locksPerRoom ends insufficient-concepts with no generation or review calls', async () => {
    // **Validates: Requirements 17.1, 17.2**
    await fc.assert(
      fc.asyncProperty(scenarios, async (s) => {
        const provider = scripted(s);
        const ledger = makeMockLedger({ dailyCapUsd: 1000 });
        const target = { rooms: s.rooms, locksPerRoom: 2 as const, maxConcepts: s.rooms * 3 };
        const result = await runRoomPipeline(NOTES, makePipelineOptions(provider, ledger, { sufficiency: true, target }));
        if (s.good >= target.locksPerRoom) {
          if (!result.ok) expect(result.error.error.kind).not.toBe('insufficient-concepts');
          return;
        }
        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.error.error).toEqual({ kind: 'insufficient-concepts', found: s.good });
        expect(calls(provider, 'generation')).toBe(0);
        expect(calls(provider, 'review')).toBe(0);
        expect(ledger.reservations).toBe(1);
      }),
      { numRuns: 40 },
    );
  });

  it('a thin concept alone never counts toward the minimum', async () => {
    const provider = scripted({ good: 0, thin: true, rooms: 1, reviewFails: [false, false, false] });
    const target = { rooms: 1, locksPerRoom: 2 as const, maxConcepts: 3 };
    const result = await runRoomPipeline(NOTES, makePipelineOptions(provider, undefined, { sufficiency: true, target }));
    expect(!result.ok && result.error.error.kind).toBe('insufficient-concepts');
  });
});
