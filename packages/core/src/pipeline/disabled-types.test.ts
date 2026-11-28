/**
 * Feature: generation-and-evaluation, Property 40: A disabled type is never asked of the
 * generator or published.
 *
 * **Validates: Requirements 14.9, 23.5, 25.3**
 *
 * With a scripted generator that proposes any type as primary and alternate and a reduced
 * `allowedLockTypes` (at least two types), the generation system prompt and response schema name
 * no disabled type, and no question in the manifest, content or unplacedAccepted has a disabled
 * lockType. Scripted provider and mock ledger only.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { LOCK_TYPES } from '../types';
import type { LockType } from '../types';
import { buildGenerationSystemPrompt } from './generation-prompt';
import { buildGenerationResponseSchema } from './generation-schema';
import { toModelJsonSchema } from '../provider/model-json-schema';
import { runRoomPipeline } from './orchestrator';
import {
  makePipelineOptions,
  makeScriptedProvider,
  userMessageOf,
  type ScriptedProvider,
} from './orchestrator-fixtures';

// ---------------------------------------------------------------------------
// Notes: a small corpus with four distinguishable facts (two per concept so
// each concept has evidence for a primary and an alternate).
// ---------------------------------------------------------------------------
const FACTS: readonly { readonly subject: string; readonly predicate: string }[] = [
  { subject: 'nucleus', predicate: 'contains the genetic material of a cell' },
  { subject: 'ribosome', predicate: 'synthesises proteins from messenger RNA' },
  { subject: 'mitochondria', predicate: 'produce ATP via cellular respiration' },
  { subject: 'lysosome', predicate: 'digest cellular waste using enzymes' },
];

const NOTES = FACTS.map((f) => `The ${f.subject} ${f.predicate}.`).join('\n\n');

// ---------------------------------------------------------------------------
// Arbitrary: pick a subset of LOCK_TYPES with at least 2 types (Property 40
// requirement: "reduced allowedLockTypes (at least two types)").
// ---------------------------------------------------------------------------
const atLeastTwoTypesArb: fc.Arbitrary<readonly LockType[]> = fc
  .subarray([...LOCK_TYPES] as LockType[], { minLength: 2 })
  .filter((s) => s.length >= 2);

// ---------------------------------------------------------------------------
// Helpers to build scripted provider responses for every lock type.
// The provider proposes any allowed type as primary and a different allowed
// type as alternate; it may also propose null.
// ---------------------------------------------------------------------------

function chunkIdForFact(doc: ReturnType<typeof import('../pipeline/prepare-input').prepareDocument>, factIndex: number): string {
  for (const [id, chunk] of doc.quotableChunksByOrdinal) {
    void id;
    if (chunk.text.includes(FACTS[factIndex]!.subject)) return chunk.id;
  }
  return 'chk_fallback';
}

/** Build a valid generated question object for the given type and fact index. */
function makeGenerated(type: LockType, factIndex: number, chunkId: string): unknown {
  const f = FACTS[factIndex]!;
  const quote = `The ${f.subject} ${f.predicate}`;
  const otherFact = FACTS[(factIndex + 1) % FACTS.length]!;
  const otherQuote = `The ${otherFact.subject} ${otherFact.predicate}`;
  const otherChunkId = chunkId; // same chunk acceptable for the alternate

  switch (type) {
    case 'rune-cipher':
      return {
        lockType: 'rune-cipher',
        prompt: `The ______ ${f.predicate}.`,
        answer: f.subject,
        aliases: [],
        caseSensitive: false,
        evidence: [{ chunkId, quote }],
        explanation: 'Directly stated.',
        hint: null,
      };
    case 'seance-board':
      return {
        lockType: 'seance-board',
        prompt: `According to your notes, what ${f.predicate}?`,
        options: [
          { id: 'a', text: f.subject, label: 'supported', evidence: { chunkId, quote } },
          { id: 'b', text: otherFact.subject, label: 'contradicted', evidence: { chunkId: otherChunkId, quote: otherQuote } },
          { id: 'c', text: 'vacuole', label: 'contradicted', evidence: { chunkId, quote } },
        ],
        answer: 'a',
        explanation: 'Directly stated.',
      };
    case 'bone-ordering':
      return {
        lockType: 'bone-ordering',
        prompt: `According to your notes, put these steps in order.`,
        steps: ['First step stated in notes', 'Next step stated in notes', 'Final step stated in notes'],
        evidence: [{ chunkId, quote }],
        explanation: 'Sequence stated in notes.',
      };
    case 'bound-threads':
      return {
        lockType: 'bound-threads',
        prompt: `According to your notes, match these pairs.`,
        pairs: [
          { left: 'Item A', right: 'Value A', evidence: { chunkId, quote } },
          { left: 'Item B', right: 'Value B', evidence: { chunkId, quote } },
          { left: 'Item C', right: 'Value C', evidence: { chunkId, quote } },
        ],
        explanation: 'Pairings stated in notes.',
      };
    case 'cursed-object':
      return {
        lockType: 'cursed-object',
        prompt: `According to your notes, which of these is NOT a cell organelle?`,
        items: [f.subject, otherFact.subject, 'ribosome', 'virus'],
        answer: 'virus',
        categoryRule: 'cell organelles',
        evidence: [{ chunkId, quote }],
        explanation: 'Virus is not an organelle.',
      };
    case 'combination-dial':
      return {
        lockType: 'combination-dial',
        prompt: `According to your notes, how many processes does ${f.subject} perform?`,
        answer: { kind: 'exact', value: 1 },
        units: 'processes',
        evidence: [{ chunkId, quote }],
        explanation: 'Directly stated.',
      };
  }
}

/**
 * A scripted provider that proposes a primary of `primaryType` and an alternate of
 * `alternateType`. Both are always proposed regardless of whether they are in `allowed`
 * — this is deliberate: the pipeline must filter them out.
 */
function makeProposingProvider(
  primaryType: LockType,
  alternateType: LockType,
  doc: ReturnType<typeof import('../pipeline/prepare-input').prepareDocument>,
): ScriptedProvider {
  const chunkId = chunkIdForFact(doc, 0);
  return makeScriptedProvider({
    'concept-extraction': () => ({
      concepts: [
        {
          label: 'concept-0',
          chunkIds: [chunkId],
          quotes: [`The ${FACTS[0]!.subject} ${FACTS[0]!.predicate}`],
        },
        {
          label: 'concept-1',
          chunkIds: [chunkId],
          quotes: [`The ${FACTS[1]!.subject} ${FACTS[1]!.predicate}`],
        },
      ],
    }),
    generation: () => ({
      justification: 'proposing any type',
      primary: makeGenerated(primaryType, 0, chunkId),
      alternate: makeGenerated(alternateType, 0, chunkId),
    }),
    review: (request) => {
      const msg = userMessageOf(request);
      // Accept any question the reviews sees: return the right key shape.
      if (msg.includes('Options:')) {
        return { answer: 'a', optionLabels: [{ optionId: 'a', label: 'supported' }, { optionId: 'b', label: 'contradicted' }, { optionId: 'c', label: 'contradicted' }] };
      }
      if (msg.includes('Steps:')) {
        return { answer: 'correct', optionLabels: null };
      }
      if (msg.includes('Pairs:')) {
        return { answer: 'correct', optionLabels: null };
      }
      if (msg.includes('Items:')) {
        return { answer: 'virus', optionLabels: null };
      }
      // rune-cipher and combination-dial
      return { answer: FACTS[0]!.subject, optionLabels: null };
    },
  });
}

// ---------------------------------------------------------------------------
// Property 40
// ---------------------------------------------------------------------------

describe('Property 40: a disabled type is never asked of the generator or published', () => {
  let published = 0;
  it(
    'generation system prompt and response schema name no disabled type, and no question in manifest/content/unplacedAccepted has a disabled lockType',
    async () => {
      await fc.assert(
        fc.asyncProperty(
          atLeastTwoTypesArb,
          fc.constantFrom<LockType>(...LOCK_TYPES),
          fc.constantFrom<LockType>(...LOCK_TYPES),
          async (allowed, primaryType, alternateType) => {
            // --- Part 1: static checks on prompt and schema ---
            const prompt = buildGenerationSystemPrompt(allowed);
            const disabled = LOCK_TYPES.filter((t) => !allowed.includes(t));

            for (const type of disabled) {
              // The system prompt must not name any disabled type.
              expect(prompt).not.toContain(type);
              // The JSON schema must not name any disabled type.
              const schemaResult = toModelJsonSchema(buildGenerationResponseSchema(allowed));
              expect(schemaResult.ok).toBe(true);
              if (schemaResult.ok) {
                const schemaStr = JSON.stringify(schemaResult.value);
                expect(schemaStr).not.toContain(type);
              }
            }

            // --- Part 2: dynamic check — run the pipeline and inspect output ---
            const { prepareDocument } = await import('./prepare-input');
            const doc = prepareDocument(NOTES);
            const provider = makeProposingProvider(primaryType, alternateType, doc);
            const options = makePipelineOptions(provider, undefined, { allowedLockTypes: allowed });
            const result = await runRoomPipeline(NOTES, options);

            if (result.ok) published += 1;
            if (!result.ok) {
              // empty-room is acceptable (e.g. the proposed types are not in the allowed list,
              // so every proposal is filtered and nothing gets assembled). Any other error means
              // the test infrastructure is broken.
              expect(result.error.error.kind).toBe('empty-room');
              return;
            }

            const { manifest, content, unplacedAccepted } = result.value;

            // Check manifest room questions.
            for (const room of manifest.rooms) {
              for (const slot of room.lockSlots) {
                for (const q of [slot.primaryQuestion, slot.alternateQuestion]) {
                  if (q) {
                    expect(disabled).not.toContain(q.lockType);
                  }
                }
              }
            }

            // Check manifest final door.
            for (const slot of manifest.finalDoor.slots) {
              expect(disabled).not.toContain(slot.question.lockType);
            }

            // Check content question entries against their questionIds.
            for (const qId of Object.keys(content.questions)) {
              // Find the question in the manifest to get its lockType.
              for (const room of manifest.rooms) {
                for (const lockSlot of room.lockSlots) {
                  for (const q of [lockSlot.primaryQuestion, lockSlot.alternateQuestion]) {
                    if (q && q.questionId === qId) {
                      expect(disabled).not.toContain(q.lockType);
                    }
                  }
                }
              }
            }

            // Check unplacedAccepted.
            for (const u of unplacedAccepted) {
              expect(disabled).not.toContain(u.question.lockType);
            }
          },
        ),
        { numRuns: 100 },
      );
      // Not vacuous: some runs must have published a room, or the manifest checks proved nothing.
      expect(published).toBeGreaterThan(0);
    },
  );

  it('publishes a rune-cipher primary and drops a disabled alternate type', async () => {
    const { prepareDocument } = await import('./prepare-input');
    const doc = prepareDocument(NOTES);
    const allowed: LockType[] = ['rune-cipher', 'bone-ordering'];
    const provider = makeProposingProvider('rune-cipher', 'seance-board', doc);
    const result = await runRoomPipeline(NOTES, makePipelineOptions(provider, undefined, { allowedLockTypes: allowed }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const slot = result.value.manifest.rooms[0]?.lockSlots[0];
    expect(slot?.primaryQuestion.lockType).toBe('rune-cipher');
    expect(slot?.alternateQuestion).toBeNull();
  });
});
