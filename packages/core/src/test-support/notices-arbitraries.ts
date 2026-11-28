import fc from 'fast-check';

/** Arbitraries for the notices on a completed job bundle (excluded concepts and the sufficiency notice). */

const text = fc.string({ minLength: 1, maxLength: 40 });
const passage = fc.record({ chunkId: text, quote: text });
const count = fc.integer({ min: 0, max: 1000 });

export const excludedConceptArb = fc.record({
  conceptId: text,
  conceptTitle: fc.string({ maxLength: 40 }),
  source: fc.constantFrom('code' as const, 'model' as const),
  passages: fc.tuple(passage, passage),
});

export const sufficiencyNoticeArb = fc.record({
  goodConcepts: count,
  conceptsNeeded: count,
  requestedRooms: count,
  builtRooms: count,
});

/** Any notices value the schema accepts, including an empty `excluded` list and a null sufficiency. */
export const jobNoticesArb = fc.record({
  excluded: fc.array(excludedConceptArb, { maxLength: 5 }),
  sufficiency: fc.option(sufficiencyNoticeArb, { nil: null }),
});
