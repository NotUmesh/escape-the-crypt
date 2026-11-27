import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { screenFor } from './screen-flow';
import type { GenerationPhase, RunPhase, ScreenInput } from './screen-flow';

const routes = fc.constantFrom<ScreenInput['route']>('home', 'ingest');
const generations = fc.constantFrom<GenerationPhase>('idle', 'starting', 'polling', 'ready', 'failed', 'cancelled');
const phases = fc.constantFrom<RunPhase>('not-started', 'running', 'start-failed');
const inputs = fc.record({ route: routes, generation: generations, phase: phases, descending: fc.boolean() });

describe('screenFor', () => {
  it('shows the hub at / and the book at /ingest when nothing is running', () => {
    expect(screenFor({ route: 'home', generation: 'idle', phase: 'not-started', descending: false })).toBe('hub');
    expect(screenFor({ route: 'ingest', generation: 'idle', phase: 'not-started', descending: false })).toBe('bring');
  });

  it('shows the dig only while a job is starting or polling', () => {
    for (const generation of ['starting', 'polling'] as const) {
      expect(screenFor({ route: 'ingest', generation, phase: 'not-started', descending: false })).toBe('dig');
    }
  });

  it('returns to the book after a cancel or a failure, and to the hub at /', () => {
    for (const generation of ['cancelled', 'failed'] as const) {
      expect(screenFor({ route: 'ingest', generation, phase: 'not-started', descending: false })).toBe('bring');
      expect(screenFor({ route: 'home', generation, phase: 'not-started', descending: false })).toBe('hub');
    }
  });

  it('shows the crypt for a running run, with the descent over it only while descending', () => {
    expect(screenFor({ route: 'ingest', generation: 'ready', phase: 'running', descending: false })).toBe('crypt');
    expect(screenFor({ route: 'ingest', generation: 'ready', phase: 'running', descending: true })).toBe('descent');
  });

  it('shows a start failure on the pre-crypt screen of the route', () => {
    expect(screenFor({ route: 'ingest', generation: 'idle', phase: 'start-failed', descending: true })).toBe('bring');
  });

  it('property: crypt and descent need a running run; descent also needs descending; dig needs a live job', () => {
    fc.assert(
      fc.property(inputs, (input) => {
        const screen = screenFor(input);
        if (screen === 'crypt' || screen === 'descent') expect(input.phase).toBe('running');
        if (screen === 'descent') expect(input.descending).toBe(true);
        if (screen === 'crypt') expect(input.descending).toBe(false);
        if (screen === 'dig') {
          expect(input.phase).not.toBe('running');
          expect(['starting', 'polling']).toContain(input.generation);
        }
        if (input.phase !== 'running' && screen !== 'dig') expect(['hub', 'bring']).toContain(screen);
      }),
      { numRuns: 200 },
    );
  });
});
