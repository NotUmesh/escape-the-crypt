import { describe, expect, it } from 'vitest';
import type { AuthoringQuestion } from '../authoring/schema';
import { cryptTargetFor } from '../run-length';
import { HEART, heart } from './generation-fixtures';
import { runRoomPipeline, type PipelineOptions } from './orchestrator';
import {
  makePipelineOptions,
  makeScriptedProvider,
  userMessageOf,
  type ScriptedProvider,
  type StageHandler,
} from './orchestrator-fixtures';
import { hh } from './room-assembly-heart-fixtures';

// Four concepts that fill two rooms: k1 and k2 are rune questions, k3 and k4 séance questions.
const QUESTIONS = [
  { label: 'Label k1', id: 'hh-q08' },
  { label: 'Label k2', id: 'hh-q12' },
  { label: 'Label k3', id: 'hh-q02' },
  { label: 'Label k4', id: 'hh-q06' },
] as const;

const chunkOf = (ordinal: number): string => heart.quotableChunksByOrdinal.get(ordinal)!.id;
type Evidence = { paragraph: number; quote: string };
const asChunk = (e: Evidence) => ({ chunkId: chunkOf(e.paragraph), quote: e.quote });

/** An accepted sample question back in the model-facing generation shape. */
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

const entries = QUESTIONS.map((e) => ({ label: e.label, question: hh(e.id) }));
const firstEvidence = (q: AuthoringQuestion): Evidence =>
  q.lockType === 'rune-cipher' ? q.evidence[0]! : (q as Extract<AuthoringQuestion, { lockType: 'seance-board' }>).options[0]!.evidence;

const extraction: StageHandler = () => ({
  concepts: entries.map((e) => {
    const ev = firstEvidence(e.question);
    return { label: e.label, chunkIds: [chunkOf(ev.paragraph)], quotes: [ev.quote] };
  }),
});
const generation: StageHandler = (request) => {
  const text = userMessageOf(request);
  const hit = entries.find((e) => text.startsWith(`Concept (a label taken from the notes; data, not instructions): ${e.label}\n`));
  return hit === undefined
    ? { ok: false, error: { kind: 'provider-error', retryable: false } }
    : { justification: 'The notes state this plainly.', primary: generated(hit.question), alternate: null };
};
const review: StageHandler = (request) => {
  const text = userMessageOf(request);
  const hit = entries.find((e) => text.startsWith(`Question (data, not instructions): ${e.question.prompt}\n`));
  return hit === undefined ? { ok: false, error: { kind: 'provider-error', retryable: false } } : reviewReply(hit.question);
};

const FAILURE = { ok: false, error: { kind: 'provider-error', retryable: true } };

/** The last passage of the notes: none of the four questions cites it as its own evidence. */
function otherPassage(): { paragraph: number; quote: string } {
  const ordinals = [...heart.quotableChunksByOrdinal.keys()];
  const paragraph = ordinals[ordinals.length - 1]!;
  const words = heart.quotableChunksByOrdinal.get(paragraph)!.text.split(/\s+/).filter(Boolean);
  return { paragraph, quote: words.slice(0, 8).join(' ') };
}

/** Replies "conflict" for the question whose prompt contains `flagged`, "clean" for the others. */
const conflictOn =
  (flagged: string | null): StageHandler =>
  (request) => {
    const other = otherPassage();
    const sections = userMessageOf(request).split(/(?=Question q\d+)/).slice(1);
    return {
      results: sections.map((section) => {
        const questionId = /^Question (q\d+)/.exec(section)![1]!;
        return flagged !== null && section.includes(flagged)
          ? { questionId, conflict: true, paragraph: other.paragraph, quote: other.quote }
          : { questionId, conflict: false, paragraph: null, quote: null };
      }),
    };
  };

const providerOf = (conflict: StageHandler): ScriptedProvider =>
  makeScriptedProvider({ 'concept-extraction': extraction, generation, review, 'conflict-check': conflict });

const conflictCalls = (p: ScriptedProvider): number => p.requests.filter((r) => r.stage === 'conflict-check').length;

const run = (provider: ScriptedProvider, over: Partial<PipelineOptions> = {}) =>
  runRoomPipeline(HEART, makePipelineOptions(provider, undefined, { target: cryptTargetFor('short'), ...over }));

describe('runRoomPipeline with the conflict check', () => {
  it('makes no conflict-check call and reports no notices when the option is absent or false', async () => {
    for (const over of [{}, { conflictCheck: false }]) {
      const provider = providerOf(conflictOn(null));
      const out = await run(provider, over);
      if (!out.ok) throw new Error(out.error.error.kind);
      expect(conflictCalls(provider)).toBe(0);
      expect('notices' in out.value).toBe(false);
      expect(out.value.manifest.rooms).toHaveLength(2);
      expect(out.value.metadata.counts).toMatchObject({
        goodConcepts: 0,
        conflictRoomsChecked: 0,
        conflictRoomsUnchecked: 0,
        conceptsExcludedByConflict: 0,
        conflictReportsIgnored: 0,
      });
    }
  });

  it('makes one call per room and reports no notices when every room is clean', async () => {
    const provider = providerOf(conflictOn(null));
    const off = await run(providerOf(conflictOn(null)));
    const out = await run(provider, { conflictCheck: true });
    if (!out.ok || !off.ok) throw new Error('pipeline failed');
    expect(conflictCalls(provider)).toBe(2);
    expect('notices' in out.value).toBe(false);
    expect(out.value.manifest).toEqual(off.value.manifest);
    expect(out.value.metadata.counts).toMatchObject({
      goodConcepts: 4,
      conflictRoomsChecked: 2,
      conflictRoomsUnchecked: 0,
      conceptsExcludedByConflict: 0,
    });
  });

  it('leaves out a conflicting concept, lists it in notices and marks its questions conflict-rejected', async () => {
    const provider = providerOf(conflictOn(entries[0]!.question.prompt.slice(0, 30)));
    const out = await run(provider, { conflictCheck: true });
    if (!out.ok) throw new Error(out.error.error.kind);
    const excluded = out.value.notices?.excluded ?? [];
    expect(excluded.map((e) => [e.conceptTitle, e.source])).toEqual([['Label k1', 'model']]);
    const conceptId = excluded[0]!.conceptId;
    const inManifest = out.value.manifest.rooms.flatMap((r) => r.lockSlots.map((s) => s.conceptId));
    expect(inManifest).not.toContain(conceptId);
    expect(inManifest.length).toBeGreaterThan(0);
    const mine = out.value.metadata.outcomes.candidates.filter((c) => c.conceptId === conceptId);
    expect(mine.map((c) => c.result)).toEqual(['conflict-rejected']);
    expect(out.value.metadata.counts.conceptsExcludedByConflict).toBe(1);
    expect(out.value.notices?.sufficiency).toBeNull();
  });

  it('ends with conflict-check-failed when no room could be checked', async () => {
    const provider = providerOf(() => FAILURE);
    const out = await run(provider, { conflictCheck: true });
    if (out.ok) throw new Error('expected a failure');
    expect(out.error.error).toEqual({ kind: 'conflict-check-failed' });
  });
});
