import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { isHeadingOnlyChunk } from '../chunker-heading';
import type { CryptContentEntry } from '../mapper/crypt-content';
import { resolveQuote } from '../quote-resolver';
import { runRoomPipeline } from './orchestrator';
import {
  makePipelineOptions,
  makeScriptedProvider,
  userMessageOf,
  type ScriptedProvider,
} from './orchestrator-fixtures';
import { prepareDocument } from './prepare-input';

// Feature: generation-and-evaluation, Property 15: Pipeline-accepted questions resolve uniquely (G-P1, extended)
// **Validates: Requirements 13.4, 24.3**

interface Fact {
  readonly subject: string;
  readonly predicate: string;
}

const FACTS: readonly Fact[] = [
  { subject: 'mitochondria', predicate: 'produce most of the chemical energy used by a cell' },
  { subject: 'nucleus', predicate: 'stores the genetic material of a cell safely' },
  { subject: 'ribosomes', predicate: 'assemble proteins from amino acids inside a cell' },
  { subject: 'chloroplasts', predicate: 'capture sunlight during photosynthesis in plant cells' },
  { subject: 'lysosomes', predicate: 'break down worn out cell parts using enzymes' },
];
const REPEATED = 'The vacuole stores water for the plant cell';
const HEADING = 'CELL BIOLOGY';
const NOTES = [
  HEADING,
  ...FACTS.map((f) => `The ${f.subject} ${f.predicate}.`),
  `${REPEATED}. ${REPEATED}.`,
].join('\n\n');

const doc = prepareDocument(NOTES);
const quotable = new Map(
  [...doc.quotableChunksByOrdinal.values()].map((c) => [c.id, c] as const),
);
const sentenceOf = (i: number): string => `The ${FACTS[i]!.subject} ${FACTS[i]!.predicate}`;
const chunkOf = (needle: string): string => {
  const hit = [...quotable.values()].find((c) => c.text.includes(needle));
  if (!hit) throw new Error(`no quotable chunk contains: ${needle}`);
  return hit.id;
};
const factChunkId = FACTS.map((f) => chunkOf(`The ${f.subject}`));
const repeatedChunkId = chunkOf(REPEATED);
const headingChunkId = [...doc.chunks.values()].find((c) => isHeadingOnlyChunk(c))?.id ?? '';
const UNASSIGNED_ID = 'chk_unassigned_0';

type Kind = 'good' | 'ambiguous' | 'not-found' | 'too-short' | 'unassigned' | 'heading';
type LockKind = 'rune-cipher' | 'seance-board';
type ExtractKind = 'good' | 'mixed' | 'bad-quote' | 'unassigned';

interface Cand {
  readonly type: LockKind;
  readonly kind: Kind;
}
interface ConceptSpec {
  readonly fact: number;
  readonly extract: ExtractKind;
  readonly primary: Cand | null;
  readonly alternate: boolean;
  readonly alternateKind: Kind;
}

const kindArb = fc.constantFrom<Kind>(
  'good', 'good', 'good', 'ambiguous', 'not-found', 'too-short', 'unassigned', 'heading',
);
const specArb: fc.Arbitrary<ConceptSpec> = fc.record({
  fact: fc.nat(FACTS.length - 1),
  extract: fc.constantFrom<ExtractKind>('good', 'good', 'good', 'mixed', 'bad-quote', 'unassigned'),
  primary: fc.option(
    fc.record({ type: fc.constantFrom<LockKind>('rune-cipher', 'seance-board'), kind: kindArb }),
    { nil: null, freq: 8 },
  ),
  alternate: fc.boolean(),
  alternateKind: kindArb,
});
const specsArb = fc.array(specArb, { minLength: 1, maxLength: 7 });

function evidence(fact: number, kind: Kind): { chunkId: string; quote: string } {
  const good = sentenceOf(fact);
  switch (kind) {
    case 'good': return { chunkId: factChunkId[fact]!, quote: good };
    case 'ambiguous': return { chunkId: repeatedChunkId, quote: REPEATED };
    case 'not-found': return { chunkId: factChunkId[fact]!, quote: sentenceOf((fact + 1) % FACTS.length) };
    case 'too-short': return { chunkId: factChunkId[fact]!, quote: `The ${FACTS[fact]!.subject}` };
    case 'unassigned': return { chunkId: UNASSIGNED_ID, quote: good };
    case 'heading': return { chunkId: headingChunkId, quote: good };
  }
}

const proseOf = (fact: number): string => `According to your notes, ${FACTS[fact]!.predicate}`;
const runePrompt = (fact: number): string =>
  `According to your notes, the ______ ${FACTS[fact]!.predicate}.`;
const seancePrompt = (fact: number): string => `${proseOf(fact)}: which structure is this?`;

function generated(type: LockKind, fact: number, kind: Kind): unknown {
  if (type === 'rune-cipher') {
    return {
      lockType: type,
      prompt: runePrompt(fact),
      answer: FACTS[fact]!.subject,
      aliases: [],
      caseSensitive: false,
      evidence: [evidence(fact, kind)],
      explanation: 'Your notes state this.',
      hint: null,
    };
  }
  const other = (d: number): number => (fact + d) % FACTS.length;
  return {
    lockType: type,
    prompt: seancePrompt(fact),
    options: [
      { id: 'a', text: FACTS[other(1)]!.subject, label: 'contradicted', evidence: evidence(other(1), 'good') },
      { id: 'b', text: FACTS[fact]!.subject, label: 'supported', evidence: evidence(fact, kind) },
      { id: 'c', text: FACTS[other(2)]!.subject, label: 'contradicted', evidence: evidence(other(2), 'good') },
    ],
    answer: 'b',
    explanation: 'Your notes state this.',
  };
}

/** Scripted model: concept `cN` is specs[N]. A lenient reviewer always answers the intended key. */
function providerFor(specs: readonly ConceptSpec[]): ScriptedProvider {
  const labelIndex = (message: string): number => Number(/: c(\d+)\n/.exec(message)?.[1] ?? -1);
  return makeScriptedProvider({
    'concept-extraction': () => ({
      concepts: specs.map((s, i) => {
        const chunkId = s.extract === 'unassigned' ? UNASSIGNED_ID : factChunkId[s.fact]!;
        const good = sentenceOf(s.fact);
        const short = `The ${FACTS[s.fact]!.subject}`;
        const quotes = s.extract === 'bad-quote' ? [short] : s.extract === 'mixed' ? [short, good] : [good];
        return { label: `c${i}`, chunkIds: [chunkId], quotes };
      }),
    }),
    generation: (request) => {
      const s = specs[labelIndex(userMessageOf(request))];
      if (!s) return { justification: 'none', primary: null, alternate: null };
      const p = s.primary;
      const altType: LockKind = p?.type === 'rune-cipher' ? 'seance-board' : 'rune-cipher';
      return {
        justification: 'fits',
        primary: p ? generated(p.type, s.fact, p.kind) : null,
        alternate: p && s.alternate ? generated(altType, s.fact, s.alternateKind) : null,
      };
    },
    review: (request) => {
      const message = userMessageOf(request);
      const fact = FACTS.findIndex((_, i) => message.includes(proseOf(i)));
      if (message.includes('Options:')) {
        return {
          answer: 'b',
          optionLabels: [
            { optionId: 'a', label: 'contradicted' },
            { optionId: 'b', label: 'supported' },
            { optionId: 'c', label: 'contradicted' },
          ],
        };
      }
      return { answer: FACTS[Math.max(fact, 0)]!.subject, optionLabels: null };
    },
  });
}

function assertResolvesUniquely(entry: CryptContentEntry | undefined): number {
  expect(entry).toBeDefined();
  for (const excerpt of entry!.excerpts) {
    expect(quotable.has(excerpt.chunkId)).toBe(true);
    expect(excerpt.chunkId).not.toBe(headingChunkId);
    expect(resolveQuote(quotable, excerpt.chunkId, excerpt.quote).ok).toBe(true);
  }
  return entry!.excerpts.length;
}

describe('Property 15: pipeline-accepted questions resolve uniquely', () => {
  it('fixture sanity: one heading, five fact chunks, one repeated chunk', () => {
    expect(headingChunkId).not.toBe('');
    expect(quotable.size).toBe(FACTS.length + 1);
    expect(resolveQuote(quotable, repeatedChunkId, REPEATED)).toMatchObject({ ok: false });
  });

  it('every accepted question resolves each excerpt uniquely in a quotable chunk', async () => {
    let runsWithAccepted = 0;
    let runsWithRejected = 0;
    let excerptsChecked = 0;
    await fc.assert(
      fc.asyncProperty(specsArb, async (specs) => {
        const result = await runRoomPipeline(NOTES, makePipelineOptions(providerFor(specs)));
        const metadata = result.ok ? result.value.metadata : result.error.metadata;
        if (metadata.counts.accepted > 0) runsWithAccepted += 1;
        if (metadata.counts.discarded > 0) runsWithRejected += 1;
        if (!result.ok) {
          // Nothing placeable is the only acceptable failure with this ledger and provider.
          expect(result.error.error.kind).toBe('empty-room');
          return;
        }
        const { manifest, content, unplacedAccepted } = result.value;
        for (const slot of manifest.rooms.flatMap((r) => r.lockSlots)) {
          for (const q of [slot.primaryQuestion, slot.alternateQuestion]) {
            if (q) excerptsChecked += assertResolvesUniquely(content.questions[q.questionId]);
          }
        }
        for (const u of unplacedAccepted) excerptsChecked += assertResolvesUniquely(u.content);
      }),
      { numRuns: 150 },
    );
    expect(runsWithAccepted).toBeGreaterThan(0);
    expect(runsWithRejected).toBeGreaterThan(0);
    expect(excerptsChecked).toBeGreaterThan(0);
  });
});
