import { describe, expect, it } from 'vitest';
import { SAMPLE_IDS, sampleIdForManifestId } from '@escape-the-crypt/core';
import { BUILDABLE_SAMPLE_IDS, SAMPLE_LIST } from '../desk/sample-list';
import { buildCryptForSample } from './sample-sources';

describe('buildCryptForSample', () => {
  it('builds a crypt for every sample, each under its own manifest ID', () => {
    for (const id of SAMPLE_IDS) {
      const built = buildCryptForSample(id)();
      expect(built.ok, id).toBe(true);
      if (built.ok) expect(sampleIdForManifestId(built.value.manifest.manifestId), id).toBe(id);
    }
  });
  it('builds three different crypts', () => {
    const manifests = SAMPLE_IDS.map((id) => {
      const built = buildCryptForSample(id)();
      return built.ok ? built.value.manifest.manifestId : '';
    });
    expect(new Set(manifests).size).toBe(3);
  });
  it('gives a typed error for an unknown ID and never another sample', () => {
    for (const id of ['', 'nope', 'HTTPS']) {
      expect(buildCryptForSample(id)()).toEqual({ ok: false, error: { kind: 'unknown-sample', id } });
    }
  });
  it('matches the hub: the registry IDs are the hub list IDs, and every buildable ID has a builder', () => {
    expect([...SAMPLE_IDS]).toEqual(SAMPLE_LIST.map((entry) => entry.id));
    for (const id of BUILDABLE_SAMPLE_IDS) expect(buildCryptForSample(id)().ok, id).toBe(true);
  });
});
