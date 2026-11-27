import { describe, expect, it } from 'vitest';
import { leakScanRoom } from '../checks/leak-scan';
import { visibleTextOf } from '../checks/run-checks';
import { validateManifestForPublish } from '../runtime/publish-manifest';
import {
  conceptC01,
  conceptC02,
  concept,
  heart,
  hh,
} from './room-assembly-heart-fixtures';
import {
  LEGACY_ASSEMBLY_POLICY,
  assembleRoom,
  type AssemblyConcept,
  type RoomAssembly,
} from './room-assembly';

function assemble(concepts: readonly AssemblyConcept[]): RoomAssembly {
  const result = assembleRoom({ manifestId: 'm-1', document: heart, concepts });
  if (!result.ok) throw new Error(`assembly failed: ${result.error.kind}`);
  return result.value;
}

const slotsOf = (a: RoomAssembly) => a.manifest.rooms.flatMap((r) => r.lockSlots);

function placedQuestionIds(a: RoomAssembly): string[] {
  return slotsOf(a).flatMap((s) =>
    [s.primaryQuestion, s.alternateQuestion].flatMap((q) => (q === null ? [] : [q.questionId])),
  );
}

describe('assembleRoom: two-slot assembly', () => {
  const assembly = assemble([conceptC01(), conceptC02()]);

  it('places one slot per type in extraction order with deterministic ids', () => {
    expect(assembly.manifest.manifestId).toBe('m-1');
    expect(assembly.manifest.rooms).toHaveLength(1);
    expect(assembly.manifest.rooms[0]!.roomId).toBe('room-1');
    const slots = slotsOf(assembly);
    expect(slots.map((s) => s.slotId)).toEqual(['slot-rune-cipher', 'slot-seance-board']);
    expect(slots.map((s) => s.stationType)).toEqual(['rune-cipher', 'seance-board']);
    expect(slots.map((s) => s.conceptId)).toEqual(['hh-c01', 'hh-c02']);
    expect(slots[0]!.primaryQuestion.questionId).toBe('hh-c01-primary');
    expect(slots[0]!.alternateQuestion?.questionId).toBe('hh-c01-alternate');
    expect(slots[1]!.primaryQuestion.questionId).toBe('hh-c02-primary');
    expect(slots[1]!.alternateQuestion?.questionId).toBe('hh-c02-alternate');
  });

  it('has an empty final door, no leftovers and a content entry for every placed question', () => {
    expect(assembly.manifest.finalDoor).toEqual({ slots: [] });
    expect(assembly.unplacedAccepted).toEqual([]);
    expect(assembly.mapperRejections).toEqual([]);
    expect(assembly.leakDroppedConceptIds).toEqual([]);
    expect(Object.keys(assembly.content.questions).sort()).toEqual([...placedQuestionIds(assembly)].sort());
    expect(Object.keys(assembly.content.concepts).sort()).toEqual(['hh-c01', 'hh-c02']);
    expect(assembly.content.concepts['hh-c01']).toEqual({ title: 'Label hh-c01' });
  });

  it('is deterministic', () => {
    expect(assemble([conceptC01(), conceptC02()])).toEqual(assembly);
  });

  it('ignores a repeated conceptId after its first occurrence', () => {
    const dup = assemble([conceptC01(), conceptC02(), concept('hh-c01', hh('hh-q12', { conceptId: 'hh-c01' }))]);
    expect(dup).toEqual(assembly);
  });
});

describe('assembleRoom: empty room', () => {
  it('is empty-room when every concept is set aside', () => {
    const result = assembleRoom({
      manifestId: 'm-1',
      document: heart,
      concepts: [concept('hh-c01', null), concept('hh-c02', null)],
    });
    expect(result).toEqual({ ok: false, error: { kind: 'empty-room' } });
  });

  it('is empty-room under the legacy policy when only an alternate was accepted', () => {
    const result = assembleRoom({
      manifestId: 'm-1',
      document: heart,
      concepts: [concept('hh-c01', null, hh('hh-q02')), concept('hh-c02', null)],
      policy: LEGACY_ASSEMBLY_POLICY,
    });
    expect(result).toEqual({ ok: false, error: { kind: 'empty-room' } });
  });

  it('is empty-room when there are no concepts', () => {
    expect(assembleRoom({ manifestId: 'm-1', document: heart, concepts: [] })).toEqual({
      ok: false,
      error: { kind: 'empty-room' },
    });
  });

  it('is empty-room when the only primary is rejected by the mapper', () => {
    const bad = hh('hh-q01', { evidence: [{ paragraph: 1, quote: 'no such sentence anywhere in the notes' }] });
    const result = assembleRoom({ manifestId: 'm-1', document: heart, concepts: [concept('hh-c01', bad)] });
    expect(result).toEqual({ ok: false, error: { kind: 'empty-room' } });
  });
});

describe('assembleRoom: final door', () => {
  it('stays empty and the manifest is still accepted by validateManifestForPublish', () => {
    const { manifest } = assemble([conceptC01(), conceptC02()]);
    expect(manifest.finalDoor.slots).toEqual([]);
    const again = validateManifestForPublish({
      manifestId: manifest.manifestId,
      rooms: manifest.rooms,
      finalDoor: { slots: [] },
    });
    expect(again.ok).toBe(true);
  });
});

describe('assembleRoom: unplaced accepted concepts', () => {
  const concepts = [conceptC01(), concept('hh-c07', hh('hh-q12'), hh('hh-q02', { conceptId: 'hh-c07' }))];
  const assembly = assemble(concepts);

  it('lists a concept whose type is taken in unplacedAccepted with its primary', () => {
    expect(assembly.unplacedAccepted).toHaveLength(1);
    const unplaced = assembly.unplacedAccepted[0]!;
    expect(unplaced.conceptId).toBe('hh-c07');
    expect(unplaced.conceptTitle).toBe('Label hh-c07');
    expect(unplaced.question.questionId).toBe('hh-c07-primary');
    expect(unplaced.question.lockType).toBe('rune-cipher');
    expect(unplaced.content).toBeDefined();
  });

  it('keeps every unplaced question out of the rooms, final door and content', () => {
    const json = JSON.stringify({ rooms: assembly.manifest.rooms, finalDoor: assembly.manifest.finalDoor });
    expect(json).not.toContain('hh-c07');
    expect(slotsOf(assembly).map((s) => s.conceptId)).toEqual(['hh-c01']);
    expect(assembly.content.questions['hh-c07-primary']).toBeUndefined();
    expect(assembly.content.questions['hh-c07-alternate']).toBeUndefined();
    expect(assembly.content.concepts['hh-c07']).toBeUndefined();
  });

  it('does not promote an alternate that would make the Leak_Scan fail', () => {
    // hh-c07's séance alternate is free to take the séance slot, but its text contains hh-c01's rune
    // answer ("atrioventricular"). Promoting it would cost the room its rune slot, so it stays out.
    expect(slotsOf(assembly).map((s) => s.stationType)).toEqual(['rune-cipher']);
  });
});

describe('assembleRoom: mapper rejections', () => {
  it('records a rejected primary and still places the other concept', () => {
    const bad = hh('hh-q01', { evidence: [{ paragraph: 1, quote: 'no such sentence anywhere in the notes' }] });
    const assembly = assemble([concept('hh-c01', bad, hh('hh-q02')), conceptC02()]);
    expect(assembly.mapperRejections).toHaveLength(1);
    expect(assembly.mapperRejections[0]).toMatchObject({ conceptId: 'hh-c01', role: 'primary' });
    expect(slotsOf(assembly).map((s) => s.conceptId)).toEqual(['hh-c02']);
    expect(placedQuestionIds(assembly).some((id) => id.startsWith('hh-c01'))).toBe(false);
  });

  it('records a rejected alternate and keeps the primary placed with no alternate', () => {
    const good = hh('hh-q02');
    if (good.lockType !== 'seance-board') throw new Error('fixture must be a séance question');
    const options = good.options.map((o, i) =>
      i === 0 ? { ...o, evidence: { ...o.evidence, quote: 'no such sentence anywhere in the notes' } } : o,
    );
    const assembly = assemble([concept('hh-c01', hh('hh-q01'), hh('hh-q02', { options }))]);
    expect(assembly.mapperRejections).toHaveLength(1);
    expect(assembly.mapperRejections[0]).toMatchObject({ conceptId: 'hh-c01', role: 'alternate' });
    const slot = slotsOf(assembly)[0]!;
    expect(slot.primaryQuestion.questionId).toBe('hh-c01-primary');
    expect(slot.alternateQuestion).toBeNull();
  });

  it('rejects a question whose conceptId differs from its concept', () => {
    const assembly = assemble([concept('hh-c01', hh('hh-q01', { conceptId: 'other' })), conceptC02()]);
    expect(assembly.mapperRejections).toEqual([
      expect.objectContaining({
        conceptId: 'hh-c01',
        role: 'primary',
        error: expect.objectContaining({ kind: 'authoring-schema-invalid' }),
      }),
    ]);
  });
});

// Known limitation: the Leak_Scan swap path (a leaking primary replaced by its alternate) is
// unreachable through assembleRoom while only rune cipher and séance board exist, because an
// alternate always has a lock type that the room already uses. It becomes reachable in P5, when
// more lock types land. Do not export internals to test it before then.
describe('assembleRoom: Leak_Scan', () => {
  it('drops a concept whose rune primary leaks when its alternate type is taken, then rescans clean', () => {
    const leaky = hh('hh-q03', {
      explanation: 'The left ventricle pumps oxygen-rich blood; atrioventricular valves sit above it.',
    });
    const b = concept('hh-c02', leaky, hh('hh-q04'));
    const assembly = assemble([conceptC01(), b]);

    expect(assembly.leakDroppedConceptIds).toEqual(['hh-c01']);
    expect(assembly.unplacedAccepted).toEqual([]);
    expect(slotsOf(assembly).map((s) => s.conceptId)).toEqual(['hh-c02']);
    expect(Object.keys(assembly.content.questions).sort()).toEqual(['hh-c02-alternate', 'hh-c02-primary']);
    expect(Object.keys(assembly.content.concepts)).toEqual(['hh-c02']);

    const remaining = [leaky, hh('hh-q04')].map((q) => ({
      conceptId: 'hh-c02',
      question: q,
      visibleText: visibleTextOf(q),
    }));
    expect(leakScanRoom(remaining)).toEqual([]);
  });

  it('removes a leaking alternate and keeps its concept placed', () => {
    const leakyOther = hh('hh-q02', {
      explanation: 'The mitral valve is on the left; compare the left ventricle.',
    });
    const a = concept('hh-c01', hh('hh-q01'), leakyOther);
    const assembly = assemble([a, conceptC02()]);

    expect(assembly.leakDroppedConceptIds).toEqual([]);
    const c02 = slotsOf(assembly).find((s) => s.conceptId === 'hh-c02')!;
    expect(c02.alternateQuestion).toBeNull();
    expect(c02.primaryQuestion.questionId).toBe('hh-c02-primary');
    expect(assembly.content.questions['hh-c02-alternate']).toBeUndefined();
    expect(assembly.unplacedAccepted).toEqual([]);

    const remaining = [hh('hh-q01'), leakyOther, hh('hh-q03')].map((q) => ({
      conceptId: q.conceptId,
      question: q,
      visibleText: visibleTextOf(q),
    }));
    expect(leakScanRoom(remaining)).toEqual([]);
  });

  it('never publishes an id of a dropped or removed question', () => {
    const leaky = hh('hh-q03', { explanation: 'It sits beyond the atrioventricular valves.' });
    const assembly = assemble([conceptC01(), concept('hh-c02', leaky, hh('hh-q04'))]);
    expect(JSON.stringify(assembly.manifest)).not.toContain('hh-c01');
  });
});
