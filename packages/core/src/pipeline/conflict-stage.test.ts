import { describe, expect, it } from 'vitest';
import { makeMockLedger } from '../budget/mock-ledger';
import type { Provider } from '../provider/types';
import { cryptTargetFor } from '../run-length';
import type { CryptManifest } from '../runtime/manifest-types';
import { twoConceptSameLabel } from '../test-support/conflict-code-arbitraries';
import { assembleCrypt } from './crypt-assembly';
import { runConflictStage, type ConflictStageOptions } from './conflict-stage';
import { makeScriptedProvider, userMessageOf, type StageHandler } from './orchestrator-fixtures';
import type { AssemblyConcept, RoomAssembly } from './room-assembly';
import { concept, heart, hh } from './room-assembly-heart-fixtures';

const stub: StageHandler = () => ({});
const providerOf = (handler: StageHandler) =>
  makeScriptedProvider({ 'concept-extraction': stub, generation: stub, review: stub, 'conflict-check': handler });

const options: ConflictStageOptions = {
  modelId: 'test-model',
  maxOutputTokens: 1000,
  timeoutMs: 5000,
  retryLimit: 0,
  worstCaseUsd: 0.001,
  costOf: () => 0.0005,
};
const newLedger = () => makeMockLedger({ dailyCapUsd: 1000 });
const FAILURE = { ok: false, error: { kind: 'provider-error', retryable: true } };

const assemble = (concepts: readonly AssemblyConcept[]) =>
  assembleCrypt({ manifestId: 'crypt-abc', document: heart, concepts }, cryptTargetFor('short'));

const rune = (id: string, conceptId: string) => hh(id, { conceptId, role: 'primary' });
// Rooms: k1 (rune) + k3 (séance), k2 (rune) + k4 (séance). k5 has no room.
const five = (): AssemblyConcept[] => [
  concept('k1', rune('hh-q08', 'k1')),
  concept('k2', rune('hh-q12', 'k2')),
  concept('k3', rune('hh-q02', 'k3')),
  concept('k4', rune('hh-q06', 'k4')),
  concept('k5', rune('hh-q04', 'k5')),
];
const four = (): AssemblyConcept[] => five().slice(0, 4);

const promptOf = (conceptId: string): string => {
  const q = five().find((c) => c.conceptId === conceptId)!.primary!;
  return q.prompt.slice(0, 30);
};
/** The last passage of the heart notes: no flagged question cites it as its own evidence. */
function otherPassage(): { paragraph: number; quote: string } {
  const ordinals = [...heart.quotableChunksByOrdinal.keys()];
  const paragraph = ordinals[ordinals.length - 1]!;
  const words = heart.quotableChunksByOrdinal.get(paragraph)!.text.split(/\s+/).filter(Boolean);
  return { paragraph, quote: words.slice(0, 8).join(' ') };
}

/** Replies "conflict" for the question whose prompt contains `flagged`, "clean" for the others. */
const conflictOn =
  (flagged: string | null, failFor: string | null = null): StageHandler =>
  (request) => {
    const text = userMessageOf(request);
    if (failFor !== null && text.includes(failFor)) return FAILURE;
    const other = otherPassage();
    const sections = text.split(/(?=Question q\d+)/).slice(1);
    return {
      results: sections.map((section) => {
        const questionId = /^Question (q\d+)/.exec(section)![1]!;
        return flagged !== null && section.includes(flagged)
          ? { questionId, conflict: true, paragraph: other.paragraph, quote: other.quote }
          : { questionId, conflict: false, paragraph: null, quote: null };
      }),
    };
  };

const conceptsOf = (a: RoomAssembly): string[] =>
  a.manifest.rooms.flatMap((r) => r.lockSlots.map((s) => s.conceptId)).sort();

const run = (concepts: AssemblyConcept[], provider: Provider, extra: Partial<Parameters<typeof runConflictStage>[0]> = {}) =>
  runConflictStage({
    concepts,
    extracted: [],
    doc: heart,
    assemble,
    provider,
    ledger: newLedger(),
    options,
    ...extra,
  });

describe('runConflictStage', () => {
  it('returns the provisional assembly unchanged when every room is clean', async () => {
    const provider = providerOf(conflictOn(null));
    const out = await run(four(), provider);
    if (!out.ok) throw new Error(out.error.kind);
    const expected = assemble(four());
    if (!expected.ok) throw new Error('fixture');
    expect(out.value.assembly).toEqual(expected.value);
    expect(out.value.excluded).toEqual([]);
    expect(out.value.counts).toEqual({
      conflictRoomsChecked: 2,
      conflictRoomsUnchecked: 0,
      conceptsExcludedByConflict: 0,
      conflictReportsIgnored: 0,
    });
    expect(provider.requests).toHaveLength(2);
  });

  it('excludes both concepts of a code conflict without a model call for them', async () => {
    const { concepts: pair, doc } = twoConceptSameLabel('orbital period', 'Orbital  Period');
    const all = [
      concept('concept-1', rune('hh-q08', 'concept-1')),
      concept('concept-2', rune('hh-q12', 'concept-2')),
      ...five().slice(2).map((c) => ({ ...c })),
    ];
    const provider = providerOf(conflictOn(null));
    const out = await run(all, provider, { extracted: pair, doc });
    if (!out.ok) throw new Error(out.error.kind);
    expect(out.value.excluded.map((e) => [e.conceptId, e.source]).sort()).toEqual([
      ['concept-1', 'code'],
      ['concept-2', 'code'],
    ]);
    expect(out.value.excluded[0]!.passages[0].chunkId).toBe('chk_a');
    expect(out.value.excluded[1]!.passages[0].chunkId).toBe('chk_b');
    expect(conceptsOf(out.value.assembly)).not.toContain('concept-1');
    expect(conceptsOf(out.value.assembly)).not.toContain('concept-2');
    expect(provider.requests).toHaveLength(1);
    expect(out.value.counts.conceptsExcludedByConflict).toBe(2);
  });

  it('runs the code scan before the first provisional assembly', async () => {
    const { concepts: pair, doc } = twoConceptSameLabel('orbital period', 'Orbital  Period');
    const all = [
      concept('concept-1', rune('hh-q08', 'concept-1')),
      concept('concept-2', rune('hh-q12', 'concept-2')),
      ...five().slice(2),
    ];
    const calls: string[][] = [];
    const spy = (cs: readonly AssemblyConcept[]) => {
      calls.push(cs.map((c) => c.conceptId));
      return assemble(cs);
    };
    const out = await run(all, providerOf(conflictOn(null)), { extracted: pair, doc, assemble: spy });
    expect(out.ok).toBe(true);
    // The very first assembly already lacks the code-excluded concepts: the scan had run.
    expect(calls.length).toBeGreaterThan(0);
    expect(calls[0]).not.toContain('concept-1');
    expect(calls[0]).not.toContain('concept-2');
    expect(calls[0]).toEqual(['k3', 'k4', 'k5']);
  });

  it('excludes a model-confirmed concept and re-assembles from the checked questions', async () => {
    const provider = providerOf(conflictOn(promptOf('k1')));
    const out = await run(five(), provider);
    if (!out.ok) throw new Error(out.error.kind);
    const [only] = out.value.excluded;
    expect(out.value.excluded).toHaveLength(1);
    expect(only!.conceptId).toBe('k1');
    expect(only!.source).toBe('model');
    expect(only!.passages[1].quote).toBe(otherPassage().quote);
    expect(conceptsOf(out.value.assembly)).not.toContain('k1');
    expect(out.value.assembly.manifest.rooms.length).toBeGreaterThan(0);
    // k5 had no room and stays in the bundle unchecked; it is never in the manifest.
    expect(out.value.assembly.unplacedAccepted.map((u) => u.conceptId)).toContain('k5');
    expect(conceptsOf(out.value.assembly)).not.toContain('k5');
    expect(out.value.counts.conceptsExcludedByConflict).toBe(1);
    expect(provider.requests).toHaveLength(2);
  });

  it('removes excluded concepts from the unplaced questions that are carried over', async () => {
    const provider = providerOf(conflictOn(promptOf('k1')));
    const withK1Unplaced = (cs: readonly AssemblyConcept[]) => {
      const r = assemble(cs);
      if (!r.ok) return r;
      const spare = r.value.manifest.rooms[0]!.lockSlots[0]!;
      const copy = {
        conceptId: 'k1',
        conceptTitle: 'Label k1',
        question: spare.primaryQuestion,
        content: r.value.content.questions[spare.primaryQuestion.questionId]!,
      };
      return { ...r, value: { ...r.value, unplacedAccepted: [...r.value.unplacedAccepted, copy] } };
    };
    const out = await run(five(), provider, { assemble: withK1Unplaced });
    if (!out.ok) throw new Error(out.error.kind);
    expect(out.value.assembly.unplacedAccepted.map((u) => u.conceptId)).not.toContain('k1');
  });

  it('leaves an unchecked room out of the crypt and counts it', async () => {
    const provider = providerOf(conflictOn(null, promptOf('k2')));
    const out = await run(four(), provider);
    if (!out.ok) throw new Error(out.error.kind);
    expect(out.value.counts.conflictRoomsChecked).toBe(1);
    expect(out.value.counts.conflictRoomsUnchecked).toBe(1);
    expect(conceptsOf(out.value.assembly)).toEqual(['k1', 'k3']);
    expect(out.value.assembly.manifest.rooms).toHaveLength(1);
  });

  it('returns conflict-check-failed when every room is unchecked', async () => {
    const out = await run(four(), providerOf(() => FAILURE));
    expect(out).toEqual({ ok: false, error: { kind: 'conflict-check-failed' } });
  });

  it('returns an empty-room result as it is, with no call', async () => {
    const provider = providerOf(conflictOn(null));
    const out = await run([concept('k1', rune('hh-q08', 'k1'))], provider);
    expect(out).toEqual({ ok: false, error: { kind: 'empty-room' } });
    expect(provider.requests).toHaveLength(0);
  });

  it('stops on a refused reservation and on an abort, starting no further call', async () => {
    const refused = providerOf(conflictOn(null));
    const a = await run(four(), refused, { ledger: makeMockLedger({ dailyCapUsd: 1000, refuseAfter: 0 }) });
    expect(a).toEqual({ ok: false, error: { kind: 'budget-exhausted' } });
    const aborted = providerOf(conflictOn(null));
    const b = await run(four(), aborted, { options: { ...options, signal: { aborted: true } } });
    expect(b).toEqual({ ok: false, error: { kind: 'cancelled' } });
    expect(aborted.requests).toHaveLength(0);
  });

  it('keeps at most four checks in flight and keeps room order', async () => {
    const concepts = Array.from({ length: 6 }, (_, i) => concept(`c${i}`, rune('hh-q08', `c${i}`)));
    const fake: RoomAssembly = {
      manifest: {
        manifestId: 'm',
        rooms: concepts.map((c, i) => ({
          roomId: `room-${i + 1}`,
          lockSlots: [{ slotId: `s${i}`, conceptId: c.conceptId, primaryQuestion: { questionId: `${c.conceptId}-primary` }, alternateQuestion: null }],
        })),
        finalDoor: { slots: [] },
      } as unknown as CryptManifest,
      content: { questions: {}, concepts: {} },
      unplacedAccepted: [],
      mapperRejections: [],
      leakDroppedConceptIds: [],
      duplicateSkipped: [],
    };
    const inner = providerOf(conflictOn(null));
    let current = 0;
    let max = 0;
    const provider: Provider = {
      async complete(request) {
        current += 1;
        max = Math.max(max, current);
        for (let i = 0; i < 5; i += 1) await Promise.resolve();
        const result = await inner.complete(request);
        current -= 1;
        return result;
      },
    };
    const out = await run(concepts, provider, { assemble: () => ({ ok: true, value: fake }) });
    expect(out.ok && out.value.counts.conflictRoomsChecked).toBe(6);
    expect(max).toBeLessThanOrEqual(4);
    expect(max).toBeGreaterThan(1);
    expect(inner.requests).toHaveLength(6);
  });
});
