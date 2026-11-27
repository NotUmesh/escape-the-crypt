import { describe, expect, it } from 'vitest';
import { boneMoveName, placeName, threadStateName, wheelName } from './accessible-names';

describe('lock panel names', () => {
  it('names bone moves by position', () => {
    expect(boneMoveName('up', 'Plan', 2, 4)).toBe('Move up: Plan, position 2 of 4');
    expect(boneMoveName('down', 'Plan', 2, 4)).toBe('Move down: Plan, position 2 of 4');
  });
  it('names thread state', () => {
    expect(threadStateName('A', 'tied', 'B')).toBe('A, tied to B');
    expect(threadStateName('A', 'selected')).toBe('A, selected');
    expect(threadStateName('A', 'untied')).toBe('A, not tied');
  });
  it('names wheels by place', () => {
    expect([2, 1, 0, -1].map(placeName)).toEqual(['hundreds', 'tens', 'ones', 'tenths']);
    expect(wheelName('increase', 1, 4)).toBe('Increase tens wheel, now 4');
    expect(wheelName('wheel', 0, 4)).toBe('ones wheel');
  });
});
