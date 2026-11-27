import { describe, expect, it } from 'vitest';
import { parseManifest } from './manifest-schema';

const rune = (id: string, hintEffect: unknown = null) => ({
  questionId: id,
  lockType: 'rune-cipher',
  payload: { answer: 'heart', aliases: [], caseSensitive: false },
  evidenceRefs: ['c1'],
  hintEffect,
});
const seance = (id: string, hintEffect: unknown = null) => ({
  questionId: id,
  lockType: 'seance-board',
  payload: { optionIds: ['a', 'b', 'c'], keyOptionId: 'a' },
  evidenceRefs: ['c1'],
  hintEffect,
});
const manifest = (primary: unknown, alternate: unknown = null, stationType = 'rune-cipher') => ({
  manifestId: 'm1',
  rooms: [
    {
      roomId: 'r1',
      lockSlots: [
        { slotId: 's1', stationType, conceptId: 'k1', primaryQuestion: primary, alternateQuestion: alternate },
      ],
    },
  ],
  finalDoor: { slots: [] },
});

describe('parseManifest', () => {
  it('accepts a rune primary with a seance alternate and matching hints', () => {
    const hint = { kind: 'reveal-first-letter', firstLetter: 'h', length: 5 };
    const r = parseManifest(manifest(rune('q1', hint), seance('q2', { kind: 'remove-option', optionId: 'b' })));
    expect(r.ok).toBe(true);
  });

  it('rejects lock types without a payload schema', () => {
    // bone-ordering gained its payload schema in task 29.5; bound-threads in 31.5; cursed-object in 33.6; combination-dial is still unsupported.
    const q = { ...rune('q1'), lockType: 'combination-dial' };
    const r = parseManifest(manifest(q, null, 'combination-dial'));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.issues[0]?.message).toContain('lock-type-not-supported');
  });

  it('rejects wrong hint kinds and bad remove-option targets', () => {
    expect(parseManifest(manifest(rune('q1', { kind: 'remove-option', optionId: 'x' }))).ok).toBe(false);
    const bad = (optionId: string) =>
      parseManifest(manifest(seance('q1', { kind: 'remove-option', optionId }), null, 'seance-board')).ok;
    expect(bad('zzz')).toBe(false);
    expect(bad('a')).toBe(false);
    expect(bad('b')).toBe(true);
    expect(
      parseManifest(manifest(seance('q1', { kind: 'reveal-digit', position: 0 }), null, 'seance-board')).ok,
    ).toBe(false);
  });

  it('rejects an alternate of the same type and duplicate question ids', () => {
    expect(parseManifest(manifest(rune('q1'), rune('q2'))).ok).toBe(false);
    expect(parseManifest(manifest(rune('q1'), seance('q1'))).ok).toBe(false);
  });

  it('rejects more than 4 final-door slots and never throws on junk', () => {
    const m = manifest(rune('q1'));
    const slot = (i: number) => ({ slotId: `f${i}`, conceptId: 'k', question: rune(`fq${i}`) });
    expect(parseManifest({ ...m, finalDoor: { slots: [1, 2, 3, 4, 5].map(slot) } }).ok).toBe(false);
    expect(parseManifest({ ...m, finalDoor: { slots: [1, 2, 3, 4].map(slot) } }).ok).toBe(true);
    expect(parseManifest(null).ok).toBe(false);
    expect(parseManifest(undefined).ok).toBe(false);
  });
});
