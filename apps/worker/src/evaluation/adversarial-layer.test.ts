import { describe, expect, it } from 'vitest';
import { expectedLayerOf, layerOfResult, rejectedByExpectedLayer } from './adversarial-layer';

describe('adversarial layer mapping', () => {
  it('maps a conflict-rejected candidate to the conflict-check layer', () => {
    expect(layerOfResult('conflict-rejected')).toBe('conflict-check');
    expect(layerOfResult('accepted')).toBe('none');
  });

  it('counts a pipeline:conflict-check fixture only when the Conflict_Checker rejected it', () => {
    expect(expectedLayerOf('pipeline:conflict-check')).toBe('conflict-check');
    expect(rejectedByExpectedLayer('pipeline:conflict-check', 'conflict-check')).toBe(true);
    expect(rejectedByExpectedLayer('pipeline:conflict-check', 'code')).toBe(false);
    expect(rejectedByExpectedLayer('pipeline:conflict-check', 'review')).toBe(false);
    expect(rejectedByExpectedLayer('pipeline:conflict-check', 'none')).toBe(false);
  });

  it('keeps code and review fixtures on their own layers', () => {
    expect(rejectedByExpectedLayer('code:quote-not-found', 'code')).toBe(true);
    expect(rejectedByExpectedLayer('review:unit-mismatch', 'conflict-check')).toBe(false);
    expect(rejectedByExpectedLayer('pipeline:other', 'none')).toBe(false);
  });
});
