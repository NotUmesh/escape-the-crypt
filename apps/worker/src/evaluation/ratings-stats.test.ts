import { describe, expect, it } from 'vitest';
import { cohenKappa, compareRaters, statsByType, type RatedItem, type Verdict } from './ratings-stats';

let n = 0;
function item(lockType: string, accepted: boolean, verdict: Verdict, key = `k${(n += 1)}`): RatedItem {
  return { key, note: 'n.txt', conceptIndex: n, role: 'primary', lockType, result: accepted ? 'accepted' : 'code-check-rejected', accepted, verdict };
}

describe('statsByType', () => {
  it('counts and rates Wrong_Accepted and Correct_Rejected per type, with unsure kept apart', () => {
    const stats = statsByType([
      item('rune-cipher', true, 'correct'),
      item('rune-cipher', true, 'correct'),
      item('rune-cipher', true, 'wrong'),
      item('rune-cipher', true, 'unsure'),
      item('rune-cipher', false, 'correct'),
      item('rune-cipher', false, 'wrong'),
      item('seance-board', true, 'correct'),
    ]);
    expect(stats['rune-cipher']).toEqual({
      accepted: 4,
      rejected: 2,
      acceptedCorrect: 2,
      acceptedWrong: 1,
      acceptedUnsure: 1,
      rejectedCorrect: 1,
      rejectedWrong: 1,
      rejectedUnsure: 0,
      wrongAcceptedRate: 0.25,
      wrongAcceptedRateMax: 0.5,
      correctRejectedRate: 0.5,
      correctRejectedRateMax: 0.5,
    });
    expect(stats['seance-board']).toMatchObject({ accepted: 1, rejected: 0, wrongAcceptedRate: 0, correctRejectedRate: null, correctRejectedRateMax: null });
  });

  it('gives null rates, not zero, when a side has no questions, and lists types in a stable order', () => {
    const stats = statsByType([item('seance-board', false, 'unsure'), item('bone-ordering', true, 'wrong')]);
    expect(Object.keys(stats)).toEqual(['bone-ordering', 'seance-board']);
    expect(stats['seance-board']).toMatchObject({ wrongAcceptedRate: null, correctRejectedRate: 0, correctRejectedRateMax: 1 });
  });
});

describe('cohenKappa', () => {
  it('is 1 for perfect agreement with spread, 0 for chance level, and null when it is undefined', () => {
    expect(cohenKappa([['correct', 'correct'], ['wrong', 'wrong']])).toBe(1);
    expect(cohenKappa([['correct', 'correct'], ['correct', 'wrong'], ['wrong', 'correct'], ['wrong', 'wrong']])).toBe(0);
    expect(cohenKappa([['correct', 'correct'], ['correct', 'correct']])).toBeNull();
    expect(cohenKappa([])).toBeNull();
  });
});

describe('compareRaters', () => {
  it('lists every disagreement with both verdicts and keeps consensus to the agreed items', () => {
    const a = [item('rune-cipher', true, 'correct', 'x'), item('rune-cipher', true, 'wrong', 'y'), item('seance-board', false, 'correct', 'z')];
    const b = [item('rune-cipher', true, 'correct', 'x'), item('rune-cipher', true, 'correct', 'y'), item('seance-board', false, 'correct', 'extra')];
    const out = compareRaters({ name: 'Ann', items: a }, { name: 'Bo', items: b });
    expect(out.overlap).toBe(2);
    expect(out.agreed).toBe(1);
    expect(out.agreementRate).toBe(0.5);
    expect(out.disagreements).toHaveLength(1);
    expect(out.disagreements[0]?.verdicts).toEqual({ Ann: 'wrong', Bo: 'correct' });
    expect(out.consensus.map((i) => i.key)).toEqual(['x']);
  });
});
