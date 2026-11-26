import { describe, expect, it } from 'vitest';
import { assignGhostAnchors } from './ghost-assignment';

describe('assignGhostAnchors', () => {
  const cases: ReadonlyArray<readonly [number, number, readonly (number | null)[]]> = [
    [0, 3, []],
    [1, 3, [0]],
    [3, 3, [0, 1, 2]],
    [5, 3, [0, 1, 2, 0, 1]],
    [4, 1, [0, 0, 0, 0]],
    [2, 0, [null, null]],
  ];
  it.each(cases)('%i ghosts over %i anchors', (ghostCount, anchors, expected) => {
    const ghosts = Array.from({ length: ghostCount }, (_, i) => `g${i}`);
    const result = assignGhostAnchors(ghosts, anchors);
    expect(result.map((r) => r.anchorIndex)).toEqual(expected);
    expect(result.map((r) => r.ghost)).toEqual(ghosts);
  });
});
