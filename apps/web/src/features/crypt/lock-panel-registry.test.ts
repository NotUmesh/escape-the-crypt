import { describe, expect, it } from 'vitest';
import { LOCK_TYPES } from '../../../../../packages/core/src/types';
import { LOCK_PANELS } from './lock-panel-registry';

describe('LOCK_PANELS', () => {
  it('has exactly one panel per lock type', () => {
    expect(Object.keys(LOCK_PANELS).sort()).toEqual([...LOCK_TYPES].sort());
  });
});
