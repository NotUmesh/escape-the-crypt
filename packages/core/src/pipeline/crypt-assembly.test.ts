import { describe, expect, it } from 'vitest';
import { duplicateAnswerScan, keyedSpec } from '../checks/duplicate-answers';
import { cryptTargetFor } from '../run-length';
import { validateManifestForPublish } from '../runtime/publish-manifest';
import { assembleCrypt, assembleForTarget } from './crypt-assembly';
import { concept, heart, hh } from './room-assembly-heart-fixtures';
import { assembleRoom, type AssemblyConcept, type RoomAssembly } from './room-assembly';

// Human-heart sample questions. Rune answers: q08 pulmonary artery, q12 sinoatrial node,
// q04 left ventricle. Séance keys: q02 The mitral valve, q06 The tricuspid valve, q03 Left ventricle.
const rune = (id: string, conceptId: string) => hh(id, { conceptId, role: 'primary' });
const seance = (id: string, conceptId: string) => hh(id, { conceptId, role: 'primary' });
const alt = (id: string, conceptId: string) => hh(id, { conceptId, role: 'alternate' });

const input = (concepts: readonly AssemblyConcept[]) => ({ manifestId: 'crypt-abc', document: heart, concepts });
const crypt = (concepts: readonly AssemblyConcept[], length: 'short' | 'standard' | 'long' = 'short'): RoomAssembly => {
  const result = assembleCrypt(input(concepts), cryptTargetFor(length));
  if (!result.ok) throw new Error(`assembly failed: ${result.error.kind}`);
  return result.value;
};
const roomsOf = (a: RoomAssembly) =>
  a.manifest.rooms.map((r) => ({ room: r.roomId, concepts: r.lockSlots.map((s) => s.conceptId), types: r.lockSlots.map((s) => s.stationType) }));

describe('assembleCrypt', () => {
  const four = (): AssemblyConcept[] => [
    concept('k1', rune('hh-q08', 'k1')),
    concept('k2', rune('hh-q12', 'k2')),
    concept('k3', seance('hh-q02', 'k3')),
    concept('k4', seance('hh-q06', 'k4')),
  ];

  it('builds the target rooms, two locks each, from different concepts', () => {
    const a = crypt(four());
    expect(roomsOf(a)).toEqual([
      { room: 'room-1', concepts: ['k1', 'k3'], types: ['rune-cipher', 'seance-board'] },
      { room: 'room-2', concepts: ['k2', 'k4'], types: ['rune-cipher', 'seance-board'] },
    ]);
    expect(a.manifest.finalDoor).toEqual({ slots: [] });
    expect(a.unplacedAccepted).toEqual([]);
  });

  it('gives every slot a room-prefixed ID and every question its own entry', () => {
    const a = crypt(four());
    const slotIds = a.manifest.rooms.flatMap((r) => r.lockSlots.map((s) => s.slotId));
    expect(slotIds).toEqual(['room-1-slot-rune-cipher', 'room-1-slot-seance-board', 'room-2-slot-rune-cipher', 'room-2-slot-seance-board']);
    const questionIds = a.manifest.rooms.flatMap((r) => r.lockSlots.flatMap((s) => [s.primaryQuestion.questionId]));
    expect(Object.keys(a.content.questions).sort()).toEqual([...questionIds].sort());
    expect(Object.keys(a.content.concepts).sort()).toEqual(['k1', 'k2', 'k3', 'k4']);
    expect(validateManifestForPublish({ ...a.manifest }).ok).toBe(true);
  });

  it('returns fewer rooms as they are when the notes cannot fill the target, and adds nothing', () => {
    const a = crypt(four(), 'long');
    expect(a.manifest.rooms).toHaveLength(2);
    const three = crypt(four().slice(0, 3), 'standard');
    expect(three.manifest.rooms).toHaveLength(1);
    expect(three.unplacedAccepted.map((u) => u.conceptId)).toEqual(['k2']);
  });

  it('fails with empty-room when no two concepts can make a room', () => {
    expect(assembleCrypt(input([concept('k1', rune('hh-q08', 'k1'))]), cryptTargetFor('short'))).toEqual({
      ok: false,
      error: { kind: 'empty-room' },
    });
    // Two rune-only concepts: no séance lock is possible.
    const same = [concept('k1', rune('hh-q08', 'k1')), concept('k2', rune('hh-q12', 'k2'))];
    expect(assembleCrypt(input(same), cryptTargetFor('short')).ok).toBe(false);
  });

  it('finds rooms a one-room-at-a-time pass would miss', () => {
    // A: rune only. B: rune, with a séance alternate. C: séance only. D: rune only.
    // First-come placement would pair A with C and strand B and D (both rune).
    const concepts = [
      concept('k1', rune('hh-q08', 'k1')),
      concept('k2', rune('hh-q12', 'k2'), alt('hh-q06', 'k2')),
      concept('k3', seance('hh-q02', 'k3')),
      concept('k4', rune('hh-q04', 'k4')),
    ];
    const a = crypt(concepts);
    expect(a.manifest.rooms).toHaveLength(2);
    expect(roomsOf(a).flatMap((r) => r.concepts).sort()).toEqual(['k1', 'k2', 'k3', 'k4']);
    // The single-room assembly of the same concepts finds one room only.
    const single = assembleRoom(input(concepts));
    expect(single.ok && single.value.manifest.rooms).toHaveLength(1);
  });

  it('never puts two concepts with the same answer in one crypt', () => {
    // q03 (séance, "Left ventricle") and q04 (rune, "left ventricle") are one answer.
    const concepts = [
      concept('k1', rune('hh-q08', 'k1')),
      concept('k2', seance('hh-q03', 'k2')),
      concept('k3', rune('hh-q04', 'k3')),
      concept('k4', seance('hh-q06', 'k4')),
    ];
    const a = crypt(concepts);
    const entries = a.manifest.rooms.flatMap((r) =>
      r.lockSlots.flatMap((s) => [s.primaryQuestion, s.alternateQuestion].flatMap((q) => (q === null ? [] : [keyedSpec(s.conceptId, q, a.content.questions[q.questionId])]))),
    );
    expect(duplicateAnswerScan(entries)).toEqual([]);
    expect(a.manifest.rooms).toHaveLength(1);
  });

  it('is deterministic and gives the same manifest ID for the same content', () => {
    const a = crypt(four());
    expect(crypt(four())).toEqual(a);
    expect(a.manifest.manifestId).toMatch(/^crypt-abc-[0-9a-f]{8}$/);
  });

  it('gives a different crypt from the same notes its own manifest ID', () => {
    const short = crypt(four(), 'short');
    const [k1, , k3] = four();
    const one = crypt([k1 as AssemblyConcept, k3 as AssemblyConcept], 'short');
    expect(one.manifest.manifestId).not.toBe(short.manifest.manifestId);
    expect(one.manifest.manifestId.startsWith('crypt-abc-')).toBe(true);
  });

  it('lists accepted primaries without a room as unplaced', () => {
    const five = [...four(), concept('k5', rune('hh-q04', 'k5'))];
    const a = crypt(five);
    expect(a.unplacedAccepted.map((u) => u.conceptId)).toEqual(['k5']);
  });
});

describe('assembleForTarget', () => {
  const concepts = [concept('k1', rune('hh-q08', 'k1')), concept('k2', seance('hh-q02', 'k2'))];

  it('is the one-room assembly, unchanged, without a target', () => {
    expect(assembleForTarget(input(concepts), undefined)).toEqual(assembleRoom(input(concepts)));
  });

  it('builds the multi-room crypt with a target', () => {
    const result = assembleForTarget(input(concepts), cryptTargetFor('short'));
    expect(result.ok && result.value.manifest.rooms.map((r) => r.roomId)).toEqual(['room-1']);
  });
});
