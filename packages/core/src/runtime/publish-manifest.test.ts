import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildManifest } from '../test-support/manifest-fixture';
import { manifestCheck } from './manifest-check';
import type { InvalidManifestError } from './manifest-check';
import { validateManifestForPublish } from './publish-manifest';

// Pass-through spy: real behaviour by default, so tests can observe calls and
// force a failure for a schema-valid manifest (the schema mirrors every rule
// manifestCheck enforces, so no real input separates the two layers).
vi.mock('./manifest-check', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./manifest-check')>();
  return { ...actual, manifestCheck: vi.fn(actual.manifestCheck) };
});

const checkSpy = vi.mocked(manifestCheck);

/** Phase 1 schema supports only these two lock types. */
const validManifest = () => buildManifest({ lockTypes: ['rune-cipher', 'seance-board'], conceptsPerRoom: 2 });

describe('validateManifestForPublish', () => {
  beforeEach(() => {
    checkSpy.mockClear();
  });

  it('returns the manifest when schema and manifestCheck both pass', () => {
    const manifest = validManifest();
    const result = validateManifestForPublish(JSON.parse(JSON.stringify(manifest)));
    expect(result).toEqual({ ok: true, value: manifest });
    expect(checkSpy).toHaveBeenCalledTimes(1);
  });

  it('reports manifest-schema-invalid and skips manifestCheck for non-manifest input', () => {
    const result = validateManifestForPublish({ nope: true });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe('manifest-schema-invalid');
    expect(checkSpy).not.toHaveBeenCalled();
  });

  it('reports the schema error when the manifest would fail both layers', () => {
    // Duplicate questionId (manifestCheck pass 3) plus an empty manifestId (schema).
    const base = validManifest();
    const first = base.rooms[0]!.lockSlots[0]!;
    const second = base.rooms[0]!.lockSlots[1]!;
    const broken = {
      ...base,
      manifestId: '',
      rooms: [
        {
          ...base.rooms[0]!,
          lockSlots: [first, { ...second, primaryQuestion: { ...second.primaryQuestion, questionId: first.primaryQuestion.questionId } }],
        },
        ...base.rooms.slice(1),
      ],
    };
    const result = validateManifestForPublish(broken);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe('manifest-schema-invalid');
    expect(checkSpy).not.toHaveBeenCalled();
  });

  it('blocks publishing when the schema fails on an otherwise valid manifest', () => {
    const result = validateManifestForPublish({ ...validManifest(), manifestId: '' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe('manifest-schema-invalid');
  });

  it('reports invalid-manifest when a schema-valid manifest fails manifestCheck', () => {
    const failure: InvalidManifestError = { kind: 'invalid-manifest', questionId: 'q1' };
    checkSpy.mockReturnValueOnce({ ok: false, error: failure });
    const manifest = validManifest();
    const result = validateManifestForPublish(JSON.parse(JSON.stringify(manifest)));
    expect(result).toEqual({ ok: false, error: failure });
    expect(checkSpy).toHaveBeenCalledTimes(1);
  });

  it('passes the schema-parsed manifest to manifestCheck', () => {
    const manifest = validManifest();
    validateManifestForPublish(JSON.parse(JSON.stringify(manifest)));
    expect(checkSpy).toHaveBeenCalledWith(manifest);
  });
});
