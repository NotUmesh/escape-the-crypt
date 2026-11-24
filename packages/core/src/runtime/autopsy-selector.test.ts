import { describe, expect, it } from 'vitest';
import { AUTOPSY_LABELS, RETURN_LABEL } from '../copy';
import { buildManifest } from '../test-support/manifest-fixture';
import { SETTINGS } from '../test-support/run-settings';
import { selectAutopsy } from './autopsy-selector';
import { initial } from './initial';
import type { RunStatus, State } from './state-types';

function stateWith(status: RunStatus): State {
  const base = initial(buildManifest({ rooms: 2, conceptsPerRoom: 2 }), SETTINGS);
  const [a, b, c, d] = base.concepts;
  if (!a || !b || !c || !d) throw new Error('fixture');
  return {
    ...base,
    status,
    concepts: [
      { ...a, firstQuestionResult: 'correct' },
      { ...b, firstQuestionResult: 'correct', hintUsedOnCorrectQuestion: true },
      { ...c, firstQuestionResult: 'challenged' },
      { ...d, firstQuestionResult: 'wrong', return1Result: 'correct' },
    ],
  };
}

describe('selectAutopsy', () => {
  it.each<RunStatus>(['not started', 'in progress', 'left'])(
    'is unavailable with no outcomes while %s',
    (status) => {
      const view = selectAutopsy(stateWith(status));
      expect(view).toEqual({ available: false, entries: [], counts: null, returnLabel: RETURN_LABEL });
    },
  );

  it('exposes outcomes, labels and the five counts once escaped', () => {
    const state = stateWith('escaped');
    const view = selectAutopsy(state);
    if (!view.available) throw new Error('expected available');
    expect(view.entries.map((e) => e.outcome)).toEqual(['first-try-correct', 'assisted', 'challenged', 'retried']);
    for (const e of view.entries) expect(e.label).toBe(AUTOPSY_LABELS[e.outcome]);
    expect(view.entries.map((e) => e.conceptId)).toEqual(state.concepts.map((c) => c.conceptId));
    expect(view.counts).toEqual({
      'first-try-correct': 1,
      assisted: 1,
      retried: 1,
      challenged: 1,
      'review-due': 0,
    });
    expect(Object.values(view.counts).reduce((x, y) => x + y, 0)).toBe(state.concepts.length);
  });

  it('is JSON-safe and does not change State', () => {
    const state = stateWith('escaped');
    const before = JSON.stringify(state);
    const view = selectAutopsy(state);
    expect(JSON.parse(JSON.stringify(view))).toEqual(view);
    expect(JSON.stringify(state)).toBe(before);
  });
});
