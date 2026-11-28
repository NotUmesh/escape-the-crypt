import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { judge as judgeBoundThreads } from '../locks/bound-threads';
import type { BoundThreadsQuestion } from '../locks/bound-threads';
import type { CursedObjectQuestion } from '../locks/cursed-object';
import { buildPayload } from '../test-support/question-payloads';
import type { HintEffectSpec, LockType } from '../types';
import { QuestionSpecSchema } from './manifest-schema';

// A hint must never give the answer away or contradict it. These cases use IDs that exist in the
// payload, so only the narrowing rules, and not a missing-ID check, can reject them.
const nArb = fc.integer({ min: 1, max: 200 });

function accepts(lockType: LockType, payload: unknown, hint: HintEffectSpec | null): boolean {
  return QuestionSpecSchema.safeParse({
    questionId: 'q1',
    lockType,
    payload,
    evidenceRefs: ['chk_1'],
    hintEffect: hint,
  }).success;
}

describe('hint effects never reveal or contradict the answer', () => {
  it('cursed object: removing any wrong item is accepted, removing the odd one out is rejected', () => {
    fc.assert(
      fc.property(nArb, (n) => {
        const payload = buildPayload('cursed-object', `q${n}`, n).payload as CursedObjectQuestion;
        for (const optionId of payload.optionIds) {
          const accepted = accepts('cursed-object', payload, { kind: 'remove-option', optionId });
          expect(accepted, optionId).toBe(optionId !== payload.oddOneOutId);
        }
      }),
      { numRuns: 100 },
    );
  });

  it('bound threads: tying a key pair is accepted; a crossed pair is rejected', () => {
    fc.assert(
      fc.property(nArb, (n) => {
        const payload = buildPayload('bound-threads', `q${n}`, n).payload as BoundThreadsQuestion;
        const keys = new Set(payload.keyPairs.map(([l, r]) => `${l}|${r}`));
        for (const left of payload.leftIds) {
          for (const right of payload.rightIds) {
            const accepted = accepts('bound-threads', payload, { kind: 'tie-thread', pair: [left, right] });
            expect(accepted, `${left} ${right}`).toBe(keys.has(`${left}|${right}`));
          }
        }
      }),
      { numRuns: 100 },
    );
  });

  it('bound threads: a hint the schema accepts never makes the correct answer invalid at the judge', () => {
    fc.assert(
      fc.property(nArb, (n) => {
        const payload = buildPayload('bound-threads', `q${n}`, n).payload as BoundThreadsQuestion;
        for (const pair of payload.keyPairs) {
          const hint = { kind: 'tie-thread', pair } as const;
          expect(accepts('bound-threads', payload, hint)).toBe(true);
          expect(judgeBoundThreads(payload, { pairs: payload.keyPairs }, hint)).toBe('correct');
        }
      }),
      { numRuns: 100 },
    );
  });

  // KNOWN GAP, owned by the schema and judge (not by the panels). `narrowHint` accepts a key pair "in
  // either order", but the judge looks for the hint pair in the exact order [left, right]. A manifest
  // whose hint is [right, left] passes validation and then every answer, the correct one too, is
  // judged invalid. The mapper always writes [left, right], so generated and sample crypts are safe;
  // an imported crypt file is untrusted input. Fix either `narrowHint` (require [left, right]) or the
  // judge (compare the pair unordered). This test fails until then: remove `.fails` when it is fixed.
  it.fails('bound threads: a reversed key pair passes the schema and then breaks the judge', () => {
    const payload = buildPayload('bound-threads', 'q1', 1).payload as BoundThreadsQuestion;
    const [first] = payload.keyPairs;
    const reversed = { kind: 'tie-thread', pair: [first?.[1] ?? '', first?.[0] ?? ''] } as const;
    if (accepts('bound-threads', payload, reversed)) {
      expect(judgeBoundThreads(payload, { pairs: payload.keyPairs }, reversed)).toBe('correct');
    }
  });

  it('a hint of the wrong kind is rejected for each type that has one', () => {
    const cases: readonly [LockType, HintEffectSpec][] = [
      ['cursed-object', { kind: 'lock-first-bone', boneId: 'x' }],
      ['bound-threads', { kind: 'remove-option', optionId: 'x' }],
      ['bone-ordering', { kind: 'tie-thread', pair: ['a', 'b'] }],
    ];
    for (const [type, hint] of cases) {
      expect(accepts(type, buildPayload(type, 'q1', 1).payload, hint), type).toBe(false);
    }
  });
});
