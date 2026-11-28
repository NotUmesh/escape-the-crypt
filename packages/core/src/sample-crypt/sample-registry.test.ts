import { describe, expect, it } from 'vitest';
import {
  SAMPLE_IDS,
  SAMPLE_MANIFEST_IDS,
  getSampleBuilder,
  isSampleId,
  sampleIdForManifestId,
} from './sample-registry';

describe('sample registry', () => {
  it('lists the three samples in hub order', () => {
    expect([...SAMPLE_IDS]).toEqual(['human-heart', 'https', 'printing-press']);
  });
  it('has a builder for every sample ID', () => {
    for (const id of SAMPLE_IDS) {
      const builder = getSampleBuilder(id);
      expect(builder.ok, id).toBe(true);
    }
  });
  it('returns a typed error for an unknown ID and never falls back to another sample', () => {
    for (const id of ['', 'nope', 'HTTPS', 'human-heart ', '__proto__']) {
      expect(getSampleBuilder(id)).toEqual({ ok: false, error: { kind: 'unknown-sample', id } });
      expect(isSampleId(id)).toBe(false);
    }
  });
  it('maps manifest IDs back to sample IDs, and an unknown manifest ID to null', () => {
    for (const id of SAMPLE_IDS) expect(sampleIdForManifestId(SAMPLE_MANIFEST_IDS[id])).toBe(id);
    expect(sampleIdForManifestId('generated-abc')).toBeNull();
    expect(sampleIdForManifestId('')).toBeNull();
  });
  it('uses a different manifest ID for each sample', () => {
    expect(new Set(Object.values(SAMPLE_MANIFEST_IDS)).size).toBe(SAMPLE_IDS.length);
  });
});
