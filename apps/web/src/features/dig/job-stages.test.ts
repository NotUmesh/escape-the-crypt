import { describe, expect, it } from 'vitest';
import { digStageRows } from './dig-stages';
import { digStagesFromGeneration } from './job-stages';

describe('digStagesFromGeneration', () => {
  it('gives no stage data while the job status carries none', () => {
    for (const state of [
      { status: 'idle' },
      { status: 'starting', key: 'k' },
      { status: 'polling', key: 'k', jobId: 'j' },
      { status: 'cancelled' },
    ] as const) {
      expect(digStagesFromGeneration(state)).toBeUndefined();
    }
  });

  it('leaves the dig with no rows, so no stage list is drawn', () => {
    expect(digStageRows(digStagesFromGeneration({ status: 'polling', key: 'k', jobId: 'j' }))).toEqual([]);
  });
});
