import { describe, expect, it } from 'vitest';
import { generationReducer, INITIAL_GENERATION, isGenerating } from './generation-flow';
import type { GenerationEvent, GenerationState } from './generation-flow';
import { SAMPLE_BUNDLE } from '../../test-support/sample-bundle';

const STARTING: GenerationState = { status: 'starting', key: 'k1' };
const POLLING: GenerationState = { status: 'polling', key: 'k1', jobId: 'j1' };
const READY: GenerationState = { status: 'ready', bundle: SAMPLE_BUNDLE };
const FAILED: GenerationState = { status: 'failed', kind: 'generation-failed' };
const CANCELLED: GenerationState = { status: 'cancelled' };
const ALL: readonly GenerationState[] = [INITIAL_GENERATION, STARTING, POLLING, READY, FAILED, CANCELLED];

const run = (state: GenerationState, event: GenerationEvent): GenerationState => generationReducer(state, event);

describe('generationReducer', () => {
  it('press starts from idle, failed and cancelled with the new key', () => {
    for (const from of [INITIAL_GENERATION, FAILED, CANCELLED]) {
      expect(run(from, { type: 'press', key: 'k2' })).toEqual({ status: 'starting', key: 'k2' });
    }
  });

  it('press is ignored while starting, polling or ready', () => {
    for (const from of [STARTING, POLLING, READY]) expect(run(from, { type: 'press', key: 'k2' })).toBe(from);
  });

  it('started moves starting to polling with the job id and keeps the key', () => {
    expect(run(STARTING, { type: 'started', jobId: 'j9' })).toEqual({ status: 'polling', key: 'k1', jobId: 'j9' });
  });

  it('startFailed moves starting to failed generation-failed', () => {
    expect(run(STARTING, { type: 'startFailed' })).toEqual(FAILED);
  });

  it('queued and running keep polling unchanged', () => {
    expect(run(POLLING, { type: 'polled', job: { kind: 'queued' } })).toBe(POLLING);
    expect(run(POLLING, { type: 'polled', job: { kind: 'running' } })).toBe(POLLING);
  });

  it('completed moves polling to ready with the bundle', () => {
    expect(run(POLLING, { type: 'polled', job: { kind: 'completed', bundle: SAMPLE_BUNDLE } })).toEqual(READY);
  });

  it('a failed job keeps its failure kind', () => {
    for (const failure of ['expired', 'budget-exhausted', 'not-enough-material', 'generation-failed'] as const) {
      expect(run(POLLING, { type: 'polled', job: { kind: 'failed', failure } })).toEqual({ status: 'failed', kind: failure });
    }
  });

  it('an expired job maps to the expired failure', () => {
    expect(run(POLLING, { type: 'polled', job: { kind: 'expired' } })).toEqual({ status: 'failed', kind: 'expired' });
  });

  it('a cancelled job from the worker maps to cancelled', () => {
    expect(run(POLLING, { type: 'polled', job: { kind: 'cancelled' } })).toEqual(CANCELLED);
  });

  it('pollFailed, capReached and bundleRejected move polling to generation-failed', () => {
    for (const type of ['pollFailed', 'capReached', 'bundleRejected'] as const) {
      expect(run(POLLING, { type })).toEqual(FAILED);
    }
  });

  it('cancel moves starting and polling to cancelled and is ignored elsewhere', () => {
    expect(run(STARTING, { type: 'cancel' })).toEqual(CANCELLED);
    expect(run(POLLING, { type: 'cancel' })).toEqual(CANCELLED);
    for (const from of [INITIAL_GENERATION, READY, FAILED, CANCELLED]) expect(run(from, { type: 'cancel' })).toBe(from);
  });

  it('a late result after cancel changes nothing', () => {
    const events: GenerationEvent[] = [
      { type: 'started', jobId: 'j' },
      { type: 'polled', job: { kind: 'completed', bundle: SAMPLE_BUNDLE } },
      { type: 'pollFailed' },
      { type: 'capReached' },
    ];
    for (const event of events) expect(run(CANCELLED, event)).toBe(CANCELLED);
  });

  it('ignores events that do not fit any other status', () => {
    for (const from of ALL) {
      if (from.status !== 'starting') expect(run(from, { type: 'started', jobId: 'x' })).toBe(from);
      if (from.status !== 'starting') expect(run(from, { type: 'startFailed' })).toBe(from);
      if (from.status !== 'polling') expect(run(from, { type: 'polled', job: { kind: 'expired' } })).toBe(from);
    }
  });

  it('isGenerating is true only for starting and polling', () => {
    expect(ALL.filter(isGenerating).map((s) => s.status)).toEqual(['starting', 'polling']);
  });
});