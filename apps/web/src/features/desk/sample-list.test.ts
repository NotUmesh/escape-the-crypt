import { describe, expect, it } from 'vitest';
import { SAMPLE_CRYPT_LABEL } from '@escape-the-crypt/core';
import { BUILDABLE_SAMPLE_IDS, SAMPLE_LIST, playableSamples, sampleTitleFor } from './sample-list';

describe('sample list', () => {
  it('offers only samples that can be built', () => {
    expect(playableSamples().map((entry) => entry.id)).toEqual([...BUILDABLE_SAMPLE_IDS]);
    for (const id of BUILDABLE_SAMPLE_IDS) expect(SAMPLE_LIST.some((entry) => entry.id === id)).toBe(true);
  });

  it('names the sample for the share card, and falls back to the generic label', () => {
    expect(sampleTitleFor('human-heart')).toBe('The human heart');
    expect(sampleTitleFor(undefined)).toBe('The human heart');
    expect(sampleTitleFor('nope')).toBe(SAMPLE_CRYPT_LABEL);
  });
});
