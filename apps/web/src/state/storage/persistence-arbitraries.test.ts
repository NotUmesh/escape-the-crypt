import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { apply, initial } from '@escape-the-crypt/core';
import { acceptedRunArb } from './persistence-arbitraries';

describe('acceptedRunArb', () => {
  it('yields logs the real reducer accepts and folds to the recorded state', () => {
    fc.assert(
      fc.property(acceptedRunArb(30), ({ manifest, settings, events, state }) => {
        let folded = initial(manifest, settings);
        for (const event of events) {
          const result = apply(folded, event);
          expect(result.ok).toBe(true);
          if (result.ok) folded = result.state;
        }
        expect(folded).toEqual(state);
        expect(events.length).toBeGreaterThanOrEqual(4);
      }),
      { numRuns: 30 },
    );
  });
});
