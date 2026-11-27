import { describe, expect, it } from 'vitest';
import { concept, heart, hh } from './room-assembly-heart-fixtures';
import {
  LEGACY_ASSEMBLY_POLICY,
  assembleRoom,
  type AssemblyConcept,
  type AssemblyPolicy,
  type RoomAssembly,
} from './room-assembly';

function assemble(concepts: readonly AssemblyConcept[], policy?: AssemblyPolicy): RoomAssembly {
  const result = assembleRoom({ manifestId: 'm-1', document: heart, concepts, ...(policy ? { policy } : {}) });
  if (!result.ok) throw new Error(`assembly failed: ${result.error.kind}`);
  return result.value;
}

const slots = (a: RoomAssembly) =>
  a.manifest.rooms.flatMap((r) => r.lockSlots).map((s) => ({
    type: s.stationType,
    concept: s.conceptId,
    primary: s.primaryQuestion.questionId,
    alternate: s.alternateQuestion?.questionId ?? null,
  }));

// hh-q12: rune "sinoatrial node". hh-q01: rune "atrioventricular". hh-q02: séance "The mitral valve".
// hh-q03: séance "Left ventricle". hh-q04: rune "left ventricle".
const runeOnly = (): AssemblyConcept => concept('hh-c07', hh('hh-q12'));

describe('assembleRoom: alternates fill free lock types', () => {
  it('promotes a séance alternate when its rune primary lost the rune slot', () => {
    const concepts = [runeOnly(), concept('hh-c01', hh('hh-q01'), hh('hh-q02'))];
    expect(slots(assemble(concepts))).toEqual([
      { type: 'rune-cipher', concept: 'hh-c07', primary: 'hh-c07-primary', alternate: null },
      // The promoted alternate leads; the concept's own primary becomes the slot's alternate.
      { type: 'seance-board', concept: 'hh-c01', primary: 'hh-c01-alternate', alternate: 'hh-c01-primary' },
    ]);
    // Before: one lock, and the séance question sat unused.
    const legacy = assemble(concepts, LEGACY_ASSEMBLY_POLICY);
    expect(slots(legacy).map((s) => s.type)).toEqual(['rune-cipher']);
    expect(legacy.unplacedAccepted.map((u) => u.conceptId)).toEqual(['hh-c01']);
  });

  it('promotes an accepted alternate whose primary was rejected', () => {
    const concepts = [runeOnly(), concept('hh-c01', null, hh('hh-q02'))];
    expect(slots(assemble(concepts))).toEqual([
      { type: 'rune-cipher', concept: 'hh-c07', primary: 'hh-c07-primary', alternate: null },
      { type: 'seance-board', concept: 'hh-c01', primary: 'hh-c01-alternate', alternate: null },
    ]);
  });

  it('gives a free type to a later accepted primary before any alternate', () => {
    const concepts = [
      runeOnly(),
      concept('hh-c01', hh('hh-q01'), hh('hh-q02')),
      concept('hh-c02', hh('hh-q03'), hh('hh-q04')),
    ];
    const assembly = assemble(concepts);
    expect(slots(assembly).map((s) => [s.type, s.concept, s.primary])).toEqual([
      ['rune-cipher', 'hh-c07', 'hh-c07-primary'],
      ['seance-board', 'hh-c02', 'hh-c02-primary'],
    ]);
    expect(assembly.unplacedAccepted.map((u) => u.conceptId)).toEqual(['hh-c01']);
  });
});

describe('assembleRoom: no two concepts share an answer (duplicate-answer-in-room)', () => {
  // A second concept whose rune answer is "left ventricle".
  const other = (): AssemblyConcept => concept('hh-x', hh('hh-q04', { conceptId: 'hh-x', role: 'primary' }));

  it('skips a primary whose answer another concept already uses', () => {
    const concepts = [other(), concept('hh-c02', hh('hh-q03'), hh('hh-q04'))];
    const assembly = assemble(concepts);
    expect(slots(assembly)).toEqual([
      { type: 'rune-cipher', concept: 'hh-x', primary: 'hh-x-primary', alternate: null },
    ]);
    // Its alternate is a rune cipher too, and that type is taken, so the concept is left out.
    expect(assembly.duplicateSkipped).toEqual([{ conceptId: 'hh-c02', role: 'primary' }]);
    // Before, the Leak_Scan already caught this pair (the rune answer appears in the séance text)
    // and dropped the rune concept instead.
    const legacy = assemble(concepts, LEGACY_ASSEMBLY_POLICY);
    expect(slots(legacy).map((s) => s.concept)).toEqual(['hh-c02']);
    expect(legacy.leakDroppedConceptIds).toEqual(['hh-x']);
  });

  it('drops only a clashing slot alternate and keeps the slot', () => {
    const y = concept('hh-y', hh('hh-q02', { conceptId: 'hh-y', role: 'primary' }), hh('hh-q04', { conceptId: 'hh-y' }));
    const assembly = assemble([other(), y]);
    expect(slots(assembly)).toEqual([
      { type: 'rune-cipher', concept: 'hh-x', primary: 'hh-x-primary', alternate: null },
      { type: 'seance-board', concept: 'hh-y', primary: 'hh-y-primary', alternate: null },
    ]);
    expect(assembly.duplicateSkipped).toEqual([{ conceptId: 'hh-y', role: 'alternate' }]);
  });

  it('makes an earlier slot alternate give way to a later lead with the same answer', () => {
    // hh-x's séance alternate and hh-y's séance primary are both "Left ventricle".
    // The Leak_Scan reads rune answers only, so before this check both were playable.
    const x = concept('hh-x', hh('hh-q12', { conceptId: 'hh-x' }), hh('hh-q03', { conceptId: 'hh-x', role: 'alternate' }));
    const y = concept('hh-y', hh('hh-q03', { conceptId: 'hh-y' }));
    const assembly = assemble([x, y]);
    expect(slots(assembly)).toEqual([
      { type: 'rune-cipher', concept: 'hh-x', primary: 'hh-x-primary', alternate: null },
      { type: 'seance-board', concept: 'hh-y', primary: 'hh-y-primary', alternate: null },
    ]);
    expect(assembly.duplicateSkipped).toEqual([{ conceptId: 'hh-x', role: 'alternate' }]);
    expect(slots(assemble([x, y], LEGACY_ASSEMBLY_POLICY))).toEqual([
      { type: 'rune-cipher', concept: 'hh-x', primary: 'hh-x-primary', alternate: 'hh-x-alternate' },
      { type: 'seance-board', concept: 'hh-y', primary: 'hh-y-primary', alternate: null },
    ]);
  });
  it('lets a concept keep its own alternate with the same answer', () => {
    const assembly = assemble([concept('hh-c02', hh('hh-q03'), hh('hh-q04'))]);
    expect(slots(assembly)).toEqual([
      { type: 'seance-board', concept: 'hh-c02', primary: 'hh-c02-primary', alternate: 'hh-c02-alternate' },
    ]);
    expect(assembly.duplicateSkipped).toEqual([]);
  });
});

describe('assembleRoom: a lock type freed by the Leak_Scan is refilled', () => {
  // hh-c01's rune answer "atrioventricular" appears in hh-c02's séance prompt, so the Leak_Scan
  // drops hh-c01. hh-c07 has an accepted rune primary that selection had ruled out because the
  // rune type looked taken.
  const concepts = (): AssemblyConcept[] => [
    concept('hh-c01', hh('hh-q01')),
    concept('hh-c02', hh('hh-q02', { conceptId: 'hh-c02', role: 'primary' })),
    concept('hh-c07', hh('hh-q12')),
  ];

  it('gives the freed rune slot to the next accepted rune question', () => {
    const assembly = assemble(concepts());
    expect(slots(assembly).map((s) => [s.type, s.concept])).toEqual([
      ['seance-board', 'hh-c02'],
      ['rune-cipher', 'hh-c07'],
    ]);
    expect(assembly.leakDroppedConceptIds).toEqual(['hh-c01']);
    expect(assembly.unplacedAccepted).toEqual([]);
  });

  it('the legacy policy left the room with one lock', () => {
    const legacy = assemble(concepts(), LEGACY_ASSEMBLY_POLICY);
    expect(slots(legacy).map((s) => s.concept)).toEqual(['hh-c02']);
    expect(legacy.leakDroppedConceptIds).toEqual(['hh-c01']);
    expect(legacy.unplacedAccepted.map((u) => u.conceptId)).toEqual(['hh-c07']);
  });
});