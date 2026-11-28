import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { makeMockLedger } from '../budget/mock-ledger';
import type { AuthoringQuestion } from '../authoring/schema';
import { cryptTargetFor } from '../run-length';
import { twoConceptSameLabel } from '../test-support/conflict-code-arbitraries';
import { assembleCrypt } from './crypt-assembly';
import { runConflictStage, type ConflictStageOptions } from './conflict-stage';
import { HEART, heart } from './generation-fixtures';
import { runRoomPipeline } from './orchestrator';
import { makePipelineOptions, makeScriptedProvider, userMessageOf, type StageHandler } from './orchestrator-fixtures';
import type { AssemblyConcept } from './room-assembly';
import { concept, heart as docHeart, hh } from './room-assembly-heart-fixtures';

const stub: StageHandler = () => ({});
const options: ConflictStageOptions = {
  modelId: 'test-model',
  maxOutputTokens: 1000,
  timeoutMs: 5000,
  retryLimit: 0,
  worstCaseUsd: 0.001,
  costOf: () => 0.0005,
};
const assemble = (concepts: readonly AssemblyConcept[]) =>
  assembleCrypt({ manifestId: 'crypt-abc', document: docHeart, concepts }, cryptTargetFor('short'));

const rune = (id: string, conceptId: string) => hh(id, { conceptId, role: 'primary' });
// Rooms: k1 + k3, k2 + k4. k5 has no room.
const five = (): AssemblyConcept[] => [
  concept('k1', rune('hh-q08', 'k1')),
  concept('k2', rune('hh-q12', 'k2')),
  concept('k3', rune('hh-q02', 'k3')),
  concept('k4', rune('hh-q06', 'k4')),
  concept('k5', rune('hh-q04', 'k5')),
];
const IDS = ['k1', 'k2', 'k3', 'k4', 'k5'] as const;
const promptOf = (conceptId: string): string => five().find((c) => c.conceptId === conceptId)!.primary!.prompt.slice(0, 30);

function otherPassage(): { paragraph: number; quote: string } {
  const ordinals = [...docHeart.quotableChunksByOrdinal.keys()];
  const paragraph = ordinals[ordinals.length - 1]!;
  const words = docHeart.quotableChunksByOrdinal.get(paragraph)!.text.split(/\s+/).filter(Boolean);
  return { paragraph, quote: words.slice(0, 8).join(' ') };
}

/** Replies "conflict" for every question whose text contains one of `flagged`, "clean" otherwise. */
const conflictOn =
  (flagged: readonly string[]): StageHandler =>
  (request) => {
    const other = otherPassage();
    const sections = userMessageOf(request).split(/(?=Question q\d+)/).slice(1);
    return {
      results: sections.map((section) => {
        const questionId = /^Question (q\d+)/.exec(section)![1]!;
        return flagged.some((f) => section.includes(f))
          ? { questionId, conflict: true, paragraph: other.paragraph, quote: other.quote }
          : { questionId, conflict: false, paragraph: null, quote: null };
      }),
    };
  };

describe('pipeline-level conflict behaviour (properties)', () => {
  // Feature: generation-and-evaluation, Property 32: Excluded concepts never reach the published output
  it('Property 32: no excluded concept appears in the published manifest, content or unplaced questions', async () => {
    // **Validates: Requirements 18.4, 16.3**
    await fc.assert(
      fc.asyncProperty(
        fc.subarray([...IDS]),
        fc.boolean(),
        async (flaggedIds, withCodeConflict) => {
          const pair = twoConceptSameLabel('orbital period', 'Orbital  Period');
          const concepts = withCodeConflict
            ? [concept('concept-1', rune('hh-q08', 'concept-1')), concept('concept-2', rune('hh-q12', 'concept-2')), ...five().slice(2)]
            : five();
          const provider = makeScriptedProvider({
            'concept-extraction': stub,
            generation: stub,
            review: stub,
            'conflict-check': conflictOn(flaggedIds.map(promptOf)),
          });
          const out = await runConflictStage({
            concepts,
            extracted: withCodeConflict ? pair.concepts : [],
            doc: withCodeConflict ? pair.doc : heart,
            assemble,
            provider,
            ledger: makeMockLedger({ dailyCapUsd: 1000 }),
            options,
          });
          if (!out.ok) return;
          const { assembly, excluded } = out.value;
          const bad = new Set(excluded.map((e) => e.conceptId));
          const published = [
            ...assembly.manifest.rooms.flatMap((r) => r.lockSlots.map((s) => s.conceptId)),
            ...assembly.manifest.finalDoor.slots.map((s) => s.conceptId),
            ...Object.keys(assembly.content.concepts),
            ...assembly.unplacedAccepted.map((u) => u.conceptId),
          ];
          for (const id of published) expect(bad.has(id)).toBe(false);
          for (const key of Object.keys(assembly.content.questions)) {
            for (const id of bad) expect(key.startsWith(`${id}-`)).toBe(false);
          }
          for (const e of excluded) {
            expect(e.passages).toHaveLength(2);
            for (const p of e.passages) {
              expect(p.chunkId.length).toBeGreaterThan(0);
              expect(p.quote.length).toBeGreaterThan(0);
            }
          }
        },
      ),
      { numRuns: 25 },
    );
  });
});

// Property 33 drives the whole pipeline over the same four-question crypt as orchestrator-conflict.test.ts.
const LABELS = [
  { label: 'Label k1', id: 'hh-q08' },
  { label: 'Label k2', id: 'hh-q12' },
  { label: 'Label k3', id: 'hh-q02' },
  { label: 'Label k4', id: 'hh-q06' },
] as const;
const chunkOf = (ordinal: number): string => heart.quotableChunksByOrdinal.get(ordinal)!.id;
const asChunk = (e: { paragraph: number; quote: string }) => ({ chunkId: chunkOf(e.paragraph), quote: e.quote });

function generated(q: AuthoringQuestion): Record<string, unknown> {
  if (q.lockType === 'rune-cipher') {
    return {
      lockType: q.lockType,
      prompt: q.prompt,
      answer: q.answer,
      aliases: [...q.aliases],
      caseSensitive: q.caseSensitive,
      evidence: q.evidence.map(asChunk),
      explanation: q.explanation,
      hint: q.hint ?? null,
    };
  }
  if (q.lockType !== 'seance-board') throw new Error('fixture uses rune and séance only');
  return {
    lockType: q.lockType,
    prompt: q.prompt,
    options: q.options.map((o) => ({ id: o.id, text: o.text, label: o.label, evidence: asChunk(o.evidence) })),
    answer: q.answer,
    explanation: q.explanation,
  };
}
function reviewReply(q: AuthoringQuestion): unknown {
  if (q.lockType === 'rune-cipher') return { answer: q.answer, optionLabels: null };
  if (q.lockType !== 'seance-board') throw new Error('fixture uses rune and séance only');
  return {
    answer: q.answer,
    optionLabels: q.options.map((o) => ({ optionId: o.id, label: o.id === q.answer ? 'supported' : 'contradicted' })),
  };
}
const allEntries = LABELS.map((e) => ({ label: e.label, question: hh(e.id) }));
const firstEvidence = (q: AuthoringQuestion) =>
  q.lockType === 'rune-cipher' ? q.evidence[0]! : (q as Extract<AuthoringQuestion, { lockType: 'seance-board' }>).options[0]!.evidence;

const cleanReply: StageHandler = (request) => ({
  results: userMessageOf(request)
    .split(/(?=Question q\d+)/)
    .slice(1)
    .map((s) => ({ questionId: /^Question (q\d+)/.exec(s)![1]!, conflict: false, paragraph: null, quote: null })),
});

describe('conflict stage with nothing to exclude (property)', () => {
  // Feature: generation-and-evaluation, Property 33: With nothing to exclude, the conflict stage changes nothing
  it('Property 33: clean replies and no code conflicts give the same manifest and content as the check off', async () => {
    // **Validates: Requirements 18.2**
    await fc.assert(
      fc.asyncProperty(fc.shuffledSubarray(allEntries, { minLength: 3, maxLength: 4 }), async (entries) => {
        const make = () =>
          makeScriptedProvider({
            'concept-extraction': () => ({
              concepts: entries.map((e) => {
                const ev = firstEvidence(e.question);
                return { label: e.label, chunkIds: [chunkOf(ev.paragraph)], quotes: [ev.quote] };
              }),
            }),
            generation: (request) => {
              const text = userMessageOf(request);
              const hit = entries.find((e) => text.startsWith(`Concept (a label taken from the notes; data, not instructions): ${e.label}\n`));
              return hit === undefined
                ? { ok: false, error: { kind: 'provider-error', retryable: false } }
                : { justification: 'The notes state this plainly.', primary: generated(hit.question), alternate: null };
            },
            review: (request) => {
              const text = userMessageOf(request);
              const hit = entries.find((e) => text.startsWith(`Question (data, not instructions): ${e.question.prompt}\n`));
              return hit === undefined ? { ok: false, error: { kind: 'provider-error', retryable: false } } : reviewReply(hit.question);
            },
            'conflict-check': cleanReply,
          });
        const over = { target: cryptTargetFor('short') };
        const off = await runRoomPipeline(HEART, makePipelineOptions(make(), undefined, over));
        const on = await runRoomPipeline(HEART, makePipelineOptions(make(), undefined, { ...over, conflictCheck: true }));
        if (!off.ok || !on.ok) {
          expect(on.ok).toBe(off.ok);
          if (!off.ok && !on.ok) expect(on.error.error.kind).toBe(off.error.error.kind);
          return;
        }
        expect(on.value.manifest).toEqual(off.value.manifest);
        expect(on.value.content).toEqual(off.value.content);
        expect('notices' in on.value).toBe(false);
      }),
      { numRuns: 12 },
    );
  });
});
