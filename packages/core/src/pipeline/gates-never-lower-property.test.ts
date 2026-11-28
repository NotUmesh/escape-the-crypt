import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { CHECK_REGISTRY, CHECK_VERSION } from '../checks/registry';
import { MAX_QUOTE_WORDS } from '../checks/evidence';
import { MIN_QUOTE_WORDS } from '../quote-resolver';
import { humanHeartCannedResponses } from './e2e-cassette-fixtures';
import { HEART, heart } from './generation-fixtures';
import { runRoomPipeline } from './orchestrator';
import { makePipelineOptions, makeScriptedProvider, userMessageOf, type ScriptedProvider } from './orchestrator-fixtures';
import { prepareDocument } from './prepare-input';

// The sample's three concepts, a fourth on the blood-vessels paragraph (so a room survives one
// conflict exclusion), and a fifth, last, that cites a one-sentence paragraph (4 words).
const THIN_QUOTE = 'Mitochondria make cellular energy.';
const NOTES = `${HEART.trimEnd()}\n\n${THIN_QUOTE}`;
const canned = humanHeartCannedResponses();
const doc = prepareDocument(NOTES);
const thinOrdinal = doc.quotableChunksByOrdinal.size;
const thinChunkId = ((): string => {
  const last = doc.quotableChunksByOrdinal.get(thinOrdinal);
  if (last === undefined || !last.text.includes(THIN_QUOTE)) throw new Error('thin paragraph is not its own chunk');
  return last.id;
})();
const prefixOf = (id: string): string => id.slice(0, id.lastIndexOf('_') + 1);
const rekey = (json: unknown): unknown =>
  JSON.parse(
    JSON.stringify(json).split(prefixOf(heart.chunks.keys().next().value as string)).join(prefixOf(thinChunkId)),
  );
const VESSEL_QUOTES = {
  vena: 'The vena cava returns blood to the heart from the body.',
  aorta: 'The aorta carries blood to the body.',
  pulmonary: 'The pulmonary artery carries blood to the lungs.',
} as const;
const vesselsChunkId = ((): string => {
  for (const chunk of doc.quotableChunksByOrdinal.values()) if (chunk.text.includes(VESSEL_QUOTES.vena)) return chunk.id;
  throw new Error('no blood-vessels chunk');
})();
const VESSEL_PROMPT = 'According to your notes, which vessel returns blood to the heart from the body?';
const vesselOption = (id: string, text: string, label: string, quote: string) => ({
  id,
  text,
  label,
  evidence: { chunkId: vesselsChunkId, quote },
});
/** Séance-only concept: pairs with any rune primary, so excluding one sample concept leaves a room. */
const vesselsConcept = {
  extraction: { label: 'Blood vessels', chunkIds: [vesselsChunkId], quotes: [VESSEL_QUOTES.vena] },
  generation: {
    justification: 'The notes state this plainly.',
    primary: {
      lockType: 'seance-board',
      prompt: VESSEL_PROMPT,
      options: [
        vesselOption('a', 'The aorta', 'contradicted', VESSEL_QUOTES.aorta),
        vesselOption('b', 'The vena cava', 'supported', VESSEL_QUOTES.vena),
        vesselOption('c', 'The pulmonary artery', 'contradicted', VESSEL_QUOTES.pulmonary),
      ],
      answer: 'b',
      explanation: 'Your notes say the vena cava returns blood to the heart; the aorta and pulmonary artery carry it away.',
    },
    alternate: null,
  },
  review: {
    answer: 'b',
    optionLabels: [
      { optionId: 'a', label: 'contradicted' },
      { optionId: 'b', label: 'supported' },
      { optionId: 'c', label: 'contradicted' },
    ],
  },
} as const;
const sampleConcepts = [
  ...(rekey(canned.extraction) as { concepts: { label: string }[] }).concepts,
  vesselsConcept.extraction,
];
const generationReplies = new Map<string, unknown>([
  ...[...canned.generation].map(([label, json]) => [label, rekey(json)] as const),
  [vesselsConcept.extraction.label, vesselsConcept.generation] as const,
]);
const reviewReplies = new Map<string, unknown>([...canned.review, [VESSEL_PROMPT, vesselsConcept.review]]);
const promptsOf = (label: string): string[] => {
  const json = generationReplies.get(label) as { primary?: { prompt: string }; alternate?: { prompt: string } | null };
  return [json.primary?.prompt, json.alternate?.prompt].filter((p): p is string => typeof p === 'string');
};

interface Scenario {
  readonly reviewFails: readonly boolean[];
  readonly conflicts: readonly boolean[];
}

/** The same replies for every run of one scenario: only the pipeline options differ. */
function scripted(s: Scenario): ScriptedProvider {
  const failing = new Set(sampleConcepts.flatMap((c, i) => (s.reviewFails[i] ? promptsOf(c.label) : [])));
  const flagged = sampleConcepts.flatMap((c, i) => (s.conflicts[i] ? promptsOf(c.label) : []));
  return makeScriptedProvider({
    'concept-extraction': () => ({
      concepts: [...sampleConcepts, { label: 'Cell energy', chunkIds: [thinChunkId], quotes: [THIN_QUOTE] }],
    }),
    generation: (request) => {
      const text = userMessageOf(request);
      for (const [label, json] of generationReplies) {
        if (text.startsWith(`Concept (a label taken from the notes; data, not instructions): ${label}\n`)) return json;
      }
      return { ok: false, error: { kind: 'provider-error', retryable: false } };
    },
    review: (request) => {
      const text = userMessageOf(request);
      for (const [prompt, json] of reviewReplies) {
        if (text.startsWith(`Question (data, not instructions): ${prompt}\n`)) {
          return failing.has(prompt) ? { ok: false, error: { kind: 'provider-error', retryable: false } } : json;
        }
      }
      return { ok: false, error: { kind: 'provider-error', retryable: false } };
    },
    'conflict-check': (request) => ({
      results: userMessageOf(request)
        .split(/(?=Question q\d+)/)
        .slice(1)
        .map((section) => {
          const questionId = /^Question (q\d+)/.exec(section)![1]!;
          // 60 characters tell every prompt apart; 30 ('According to your notes, which') did not.
          return flagged.some((p) => section.includes(p.slice(0, 60)))
            ? { questionId, conflict: true, paragraph: thinOrdinal, quote: THIN_QUOTE }
            : { questionId, conflict: false, paragraph: null, quote: null };
        }),
    }),
  });
}

const scenarios = fc.record({
  reviewFails: fc.array(fc.boolean(), { minLength: 4, maxLength: 4 }),
  conflicts: fc.array(fc.boolean(), { minLength: 4, maxLength: 4 }),
});
// Wide enough that the thin concept never changes which good concepts the cap selects.
const target = { rooms: 2, locksPerRoom: 2 as const, maxConcepts: 6 };

type Meta = Awaited<ReturnType<typeof runRoomPipeline>> extends infer R
  ? R extends { ok: true; value: { metadata: infer M } }
    ? M
    : never
  : never;
const metaOf = (r: Awaited<ReturnType<typeof runRoomPipeline>>): Meta => (r.ok ? r.value.metadata : r.error.metadata);

/** Runs one scenario gated off and on, asserts the subset and verdict-equality claims, returns both metadata. */
async function runBoth(s: Scenario): Promise<{ off: Meta; on: Meta }> {
  const off = metaOf(await runRoomPipeline(NOTES, makePipelineOptions(scripted(s), undefined, { target })));
  const on = metaOf(
    await runRoomPipeline(
      NOTES,
      makePipelineOptions(scripted(s), undefined, { target, sufficiency: true, conflictCheck: true }),
    ),
  );
  for (const candidate of on.outcomes.candidates) {
    const twin = off.outcomes.candidates.find((c) => c.conceptId === candidate.conceptId && c.role === candidate.role);
    expect(twin).toBeDefined();
    if (twin === undefined) continue;
    if (candidate.result === 'accepted') expect(twin.result).toBe('accepted');
    if (candidate.result !== 'conflict-rejected') {
      expect(candidate.result).toBe(twin.result);
      expect(candidate.checkIds).toEqual(twin.checkIds);
      expect(candidate.reviewReason).toBe(twin.reviewReason);
    }
  }
  return { off, on };
}

/** No review failures; only sample concept `i` is flagged by the conflict check. */
const firesConflict = (i: number): Scenario => ({
  reviewFails: [false, false, false, false],
  conflicts: [0, 1, 2, 3].map((k) => k === i),
});

// Coverage counters: runs in which each gate actually fired, so the property cannot pass vacuously.
let runs = 0;
let runsWithConflictRejected = 0;
let runsWithThinRemoved = 0;

describe('the Phase 6 gates never lower a check', () => {
  // Feature: generation-and-evaluation, Property 37: The gates never lower a check
  it('Property 37: gated acceptances are a subset of ungated ones, with identical check results and verdicts', async () => {
    // **Validates: Requirements 17.3**
    await fc.assert(
      fc.asyncProperty(scenarios, async (s) => {
        const { on } = await runBoth(s);
        runs += 1;
        if (on.outcomes.candidates.some((c) => c.result === 'conflict-rejected')) runsWithConflictRejected += 1;
        if (on.counts.conceptsTooThin >= 1) runsWithThinRemoved += 1;
      }),
      // Random scenarios reach `conflict-rejected` only now and then (a placed concept flagged and
      // a room still buildable), so two that do are always run as well: the guard never flakes.
      { numRuns: 25, examples: [[firesConflict(0)], [firesConflict(1)]] },
    );
  });

  it('Property 37 coverage: the generated runs exercised both gates', () => {
    expect(runs).toBeGreaterThan(0);
    expect(runsWithConflictRejected).toBeGreaterThan(0);
    expect(runsWithThinRemoved).toBe(runs); // the thin concept is in every scenario
  });

  it('scripted scenario: a flagged concept and a thin concept make both gates fire, and the claims still hold', async () => {
    const { off, on } = await runBoth(firesConflict(0));
    expect(on.outcomes.candidates.some((c) => c.result === 'conflict-rejected')).toBe(true);
    expect(off.outcomes.candidates.some((c) => c.result === 'conflict-rejected')).toBe(false);
    expect(on.counts.conceptsTooThin).toBeGreaterThanOrEqual(1);
  });

  // The 2026-11-28 crypt-keeper review added two Code_Checks and bumped CHECK_VERSION, so this
  // pins what "never lower" means: the quote limits are unchanged and every earlier Check_ID is
  // still registered and blocking. Checks may be added; none may be removed or made advisory.
  it('Phase 6 keeps the quote limits and never removes or weakens a Check_ID', () => {
    expect(MIN_QUOTE_WORDS).toBe(4);
    expect(MAX_QUOTE_WORDS).toBe(25);
    expect(CHECK_VERSION).toMatch(/^\d{4}-\d{2}-\d{2}\.\d+$/);
    const registered = new Map(CHECK_REGISTRY.map((c) => [c.id as string, c.severity]));
    const before: readonly string[] = [
      'quote-not-found',
      'quote-ambiguous',
      'quote-too-short',
      'quote-too-long',
      'unknown-paragraph/chunk',
      'banned-phrase',
      'negative-question',
      'rune-needs-one-blank',
      'answer-not-in-quote',
      'answer-leak-in-prompt',
      'answer-leak-in-room',
      'duplicate-answer-in-room',
      'missing-according-to-your-notes',
      'option-count',
      'duplicate-options',
      'option-not-supported-or-contradicted',
      'option-without-evidence',
      'not-exactly-one-supported',
      'key-not-the-supported-option',
      'alternate-same-lock-type',
      'max-one-alternate',
      'alternate-off-concept',
      'lock-type-not-supported',
      'step-count',
      'duplicate-steps',
      'no-explicit-sequence-marker-in-quotes',
      'pair-count',
      'not-one-to-one',
      'item-count',
      'answer-not-an-item',
      'missing-category-rule',
      'needs-category-and-outside-quotes',
      'missing-units',
      'number-not-in-quote',
      'range-not-in-quote',
      'template-not-allowlisted',
      'template-input-not-in-quote',
      'template-value-mismatch',
      'model-written-expression',
      'dial-range-prompt',
    ];
    for (const id of before) {
      expect(registered.has(id), `${id} is still registered`).toBe(true);
      if (id !== 'alternate-off-concept') expect(registered.get(id), `${id} stays blocking`).toBe('blocking');
    }
  });
});
