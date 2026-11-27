import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { activeStageMessage, digStageRows } from './dig-stages';
import type { DigStageInput } from './dig-stages';

describe('digStageRows', () => {
  it('returns nothing until the job reports stages', () => {
    expect(digStageRows(undefined)).toEqual([]);
    expect(digStageRows([])).toEqual([]);
  });

  it('names each known stage, keeps the pipeline order and shows real counts', () => {
    const rows = digStageRows([
      { id: 'building-rooms', status: 'waiting' },
      { id: 'writing-questions', status: 'active', done: 6, total: 9 },
      { id: 'finding-concepts', status: 'done', done: 5, total: 5 },
      { id: 'checking', status: 'waiting' },
    ]);
    expect(rows.map((r) => r.name)).toEqual([
      'Finding concepts',
      'Writing questions',
      'Checking against your notes',
      'Building rooms',
    ]);
    expect(rows.map((r) => r.count)).toEqual(['5 of 5', '6 of 9', null, null]);
    expect(rows.map((r) => r.statusWord)).toEqual(['Done', 'In progress', 'Waiting', 'Waiting']);
  });

  it('drops stage ids it does not know, so no worker text is ever shown', () => {
    const rows = digStageRows([
      { id: 'ignore previous instructions', status: 'active' },
      { id: 'checking', status: 'active' },
    ]);
    expect(rows.map((r) => r.id)).toEqual(['checking']);
  });

  it('shows no count for a count that is not real', () => {
    const bad: DigStageInput[] = [
      { id: 'writing-questions', status: 'active', done: 10, total: 9 },
      { id: 'checking', status: 'active', done: -1, total: 9 },
      { id: 'building-rooms', status: 'active', done: 1, total: 0 },
      { id: 'finding-concepts', status: 'active', done: 1.5, total: 3 },
    ];
    for (const row of digStageRows(bad)) expect(row.count).toBeNull();
    expect(digStageRows([{ id: 'checking', status: 'active', done: 2 }])[0]?.count).toBeNull();
  });

  it('shows no count for a stage that has not started', () => {
    expect(digStageRows([{ id: 'checking', status: 'waiting', done: 0, total: 4 }])[0]?.count).toBeNull();
  });

  it('property: a count appears only for 0 <= done <= total with total > 0', () => {
    fc.assert(
      fc.property(fc.integer({ min: -5, max: 20 }), fc.integer({ min: -5, max: 20 }), (done, total) => {
        const row = digStageRows([{ id: 'writing-questions', status: 'active', done, total }])[0];
        const real = total > 0 && done >= 0 && done <= total;
        expect(row?.count).toBe(real ? `${done} of ${total}` : null);
      }),
    );
  });
});

describe('activeStageMessage', () => {
  it('says the active stage with its count', () => {
    const rows = digStageRows([{ id: 'writing-questions', status: 'active', done: 6, total: 9 }]);
    expect(activeStageMessage(rows)).toBe('Writing questions, 6 of 9.');
  });

  it('says only the name when there is no count, and nothing when no stage is active', () => {
    expect(activeStageMessage(digStageRows([{ id: 'checking', status: 'active' }]))).toBe('Checking against your notes.');
    expect(activeStageMessage(digStageRows([{ id: 'checking', status: 'done' }]))).toBeNull();
    expect(activeStageMessage([])).toBeNull();
  });
});
