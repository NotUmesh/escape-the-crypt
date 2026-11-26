import { describe, expect, it } from 'vitest';
import type { FinalDoorSlotState, LockSlotState, ReturnSlotState, SlotStatus } from '@escape-the-crypt/core';

import fc from 'fast-check';
import type { Chunk } from '@escape-the-crypt/core';

import { evidenceResult, orderExcerpts, resolveExcerpt } from './evidence-text';
import type { EvidenceResult, Excerpt } from './evidence-text';

const QUOTE = 'the heart pumps blood around the body';
const chunk: Chunk = {
  id: 'c1',
  documentDigest: 'd',
  position: 1,
  text: `Note: ${QUOTE} every minute.`,
  location: { sourceType: 'paste', paragraphNumber: 3 },
  edited: false,
} as unknown as Chunk;
const assets = { chunks: new Map([['c1', chunk]]) };

describe('resolveExcerpt', () => {
  it('matches a quote found once in a known chunk and labels it', () => {
    const r = resolveExcerpt(assets, { chunkId: 'c1', quote: QUOTE }, 'sample');
    expect(r).toEqual({ quote: QUOTE, citationLabel: 'Paragraph 3 of the sample notes', matched: true });
  });

  it('is unmatched, not thrown, for a quote the chunk does not hold', () => {
    const r = resolveExcerpt(assets, { chunkId: 'c1', quote: 'a quote that is not in the notes' }, 'sample');
    expect(r.matched).toBe(false);
    expect(r.citationLabel).toBe('Paragraph 3 of the sample notes');
  });

  it('is total for an unknown chunkId', () => {
    expect(resolveExcerpt(assets, { chunkId: 'nope', quote: QUOTE }, 'sample')).toEqual({
      quote: QUOTE,
      citationLabel: '',
      matched: false,
    });
  });
});

const ex = (chunkId: string, optionId?: string): Excerpt =>
  optionId === undefined ? { chunkId, quote: `q ${chunkId}` } : { chunkId, quote: `q ${chunkId}`, optionId };

describe('orderExcerpts', () => {
  const list = [ex('q'), ex('a', 'A'), ex('b', 'B'), ex('c', 'C')];

  it('puts chosen, then key, then the rest in stored order', () => {
    expect(orderExcerpts(list, 'C', 'B').map((e) => e.chunkId)).toEqual(['c', 'b', 'q', 'a']);
  });

  it('shows the excerpt once when chosen is the key', () => {
    expect(orderExcerpts(list, 'B', 'B').map((e) => e.chunkId)).toEqual(['b', 'q', 'a', 'c']);
  });

  it('keeps stored order without option ids (non-séance)', () => {
    const plain = [ex('x'), ex('y')];
    expect(orderExcerpts(plain)).toEqual(plain);
    expect(orderExcerpts(plain, undefined, undefined)).toEqual(plain);
  });

  it('skips an option with no Option_Excerpt', () => {
    expect(orderExcerpts(list, 'Z', 'B').map((e) => e.chunkId)).toEqual(['b', 'q', 'a', 'c']);
    expect(orderExcerpts(list, 'A', 'Z').map((e) => e.chunkId)).toEqual(['a', 'q', 'b', 'c']);
  });
});

describe('Property 10: Séance evidence ordering shows each excerpt once, chosen first, then key', () => {
  /** Validates: Requirements 17.3, 17.4, 17.13, 17.14, 17.16 */
  it('holds for any excerpts and option ids', () => {
    const ids = ['A', 'B', 'C', 'D', 'Z'];
    const excerptArb = fc
      .record({ n: fc.nat(3), opt: fc.option(fc.constantFrom('A', 'B', 'C', 'D'), { nil: undefined }) })
      .map(({ n, opt }) => ex(`k${n}`, opt));
    fc.assert(
      fc.property(
        fc.array(excerptArb, { maxLength: 8 }),
        fc.option(fc.constantFrom(...ids), { nil: undefined }),
        fc.option(fc.constantFrom(...ids), { nil: undefined }),
        (excerpts, chosen, key) => {
          const out = orderExcerpts(excerpts, chosen, key);
          // same elements (by identity), each once
          expect(out).toHaveLength(excerpts.length);
          expect(new Set(out).size).toBe(out.length);
          for (const e of out) expect(excerpts).toContain(e);
          const chosenAt = excerpts.findIndex((e) => chosen !== undefined && e.optionId === chosen);
          const keyAt = excerpts.findIndex((e) => key !== undefined && e.optionId === key);
          let next = 0;
          if (chosenAt >= 0) expect(out[next++]).toBe(excerpts[chosenAt]);
          if (keyAt >= 0 && keyAt !== chosenAt) expect(out[next++]).toBe(excerpts[keyAt]);
          const rest = excerpts.filter((_e, i) => i !== chosenAt && i !== keyAt);
          expect(out.slice(next)).toEqual(rest);
        },
      ),
    );
  });
});

const lockSlot = (judgedResult: LockSlotState['judgedResult'], status: SlotStatus = 'settled'): LockSlotState => ({
  slotId: 'r1-l1',
  stationType: 'rune-cipher',
  currentQuestionId: 'q1',
  currentQuestionType: 'rune-cipher',
  status,
  candleLit: status === 'solved',
  appliedHint: null,
  evidencePanelOpen: true,
  judgedResult,
});

const returnSlot = (status: SlotStatus): ReturnSlotState => ({
  slotId: 'ret-1',
  conceptId: 'c1',
  returnNumber: 1,
  currentQuestionId: 'q2',
  currentQuestionType: 'rune-cipher',
  label: 'review',
  status,
  candleLit: status === 'solved',
  appliedHint: null,
  evidencePanelOpen: true,
});

const doorSlot = (origin: FinalDoorSlotState['origin'], status: SlotStatus): FinalDoorSlotState => ({
  slotId: 'door-1',
  origin,
  conceptId: 'c1',
  returnNumber: origin === 'return' ? 1 : null,
  currentQuestionId: 'q3',
  currentQuestionType: 'rune-cipher',
  label: origin === 'return' ? 'review' : null,
  status,
  candleLit: status === 'solved',
  appliedHint: null,
  evidencePanelOpen: true,
});

describe('evidenceResult', () => {
  it.each<[string, LockSlotState, EvidenceResult]>([
    ['judgedResult correct', lockSlot('correct', 'solved'), 'correct'],
    ['judgedResult wrong', lockSlot('wrong'), 'wrong'],
    ['judgedResult invalid', lockSlot('invalid', 'open'), null],
    ['judgedResult null', lockSlot(null, 'open'), null],
  ])('Lock_Slot with %s', (_name, slot, expected) => {
    expect(evidenceResult(slot)).toBe(expected);
  });

  const byStatus: ReadonlyArray<[SlotStatus, EvidenceResult]> = [
    ['solved', 'correct'],
    ['settled', 'wrong'],
    ['challenged', null],
    ['open', null],
  ];

  it.each(byStatus)('Return_Slot with status %s', (status, expected) => {
    expect(evidenceResult(returnSlot(status))).toBe(expected);
  });

  it.each(
    (['reserved', 'return'] as const).flatMap((origin) =>
      byStatus.map(([status, expected]) => [origin, status, expected] as const),
    ),
  )('Final_Door slot, origin %s, status %s', (origin, status, expected) => {
    expect(evidenceResult(doorSlot(origin, status))).toBe(expected);
  });
});
