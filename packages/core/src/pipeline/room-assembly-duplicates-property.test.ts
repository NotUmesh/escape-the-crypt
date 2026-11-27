import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { AuthoringQuestion } from '../authoring/schema';
import { duplicateAnswerScan, keyedSpec } from '../checks/duplicate-answers';
import type { RoomAssembly } from './room-assembly';
import { LEGACY_ASSEMBLY_POLICY, assembleRoom, type AssemblyConcept, type AssemblyPolicy } from './room-assembly';
import { heart, hh } from './room-assembly-heart-fixtures';

/** A séance question with its key option's text replaced (a near-duplicate of another answer). */
function withKeyText(id: string, text: string): AuthoringQuestion {
  const q = hh(id);
  if (q.lockType !== 'seance-board') throw new Error(`${id} is not a séance question`);
  return { ...q, options: q.options.map((o) => (o.id === q.answer ? { ...o, text } : o)) };
}

// Real sample questions. Answers: q01 atrioventricular/AV, q04 left ventricle, q08 pulmonary
// artery, q12 sinoatrial node/SA node (rune); q02 The mitral valve, q03 Left ventricle, q06 The
// tricuspid valve (séance). The variants differ from another answer only by case, article,
// punctuation or a hyphen.
const POOL: readonly (() => AuthoringQuestion)[] = [
  () => hh('hh-q01'),
  () => hh('hh-q04'),
  () => hh('hh-q08'),
  () => hh('hh-q12'),
  () => hh('hh-q02'),
  () => hh('hh-q03'),
  () => hh('hh-q06'),
  () => withKeyText('hh-q03', 'The left ventricle.'),
  () => withKeyText('hh-q03', 'LEFT VENTRICLE'),
  () => withKeyText('hh-q03', 'left-ventricle'),
  () => withKeyText('hh-q02', 'Mitral valve'),
  () => withKeyText('hh-q06', 'pulmonary artery'),
];

const questionArb = (conceptId: string, role: 'primary' | 'alternate') =>
  fc.option(
    fc.nat({ max: POOL.length - 1 }).map((i) => ({ ...POOL[i]!(), conceptId, role }) as AuthoringQuestion),
    { nil: null, freq: 4 },
  );

const conceptArb: fc.Arbitrary<AssemblyConcept> = fc
  .constantFrom('k0', 'k1', 'k2', 'k3', 'k4', 'k5')
  .chain((conceptId) =>
    fc.record({
      conceptId: fc.constant(conceptId),
      label: fc.constant(`Label ${conceptId}`),
      primary: questionArb(conceptId, 'primary'),
      alternate: questionArb(conceptId, 'alternate'),
    }),
  );
const conceptsArb = fc.array(conceptArb, { minLength: 1, maxLength: 7 });

function assemble(concepts: readonly AssemblyConcept[], policy?: AssemblyPolicy): RoomAssembly | null {
  const result = assembleRoom({ manifestId: 'm-1', document: heart, concepts, ...(policy ? { policy } : {}) });
  return result.ok ? result.value : null;
}

/** Every placed question, keyed by the concept of the slot it sits in. */
function placed(a: RoomAssembly) {
  return a.manifest.rooms
    .flatMap((r) => r.lockSlots)
    .flatMap((slot) =>
      [slot.primaryQuestion, slot.alternateQuestion].flatMap((q) =>
        q === null ? [] : [keyedSpec(slot.conceptId, q, a.content.questions[q.questionId])],
      ),
    );
}

/** Independent of answerKey: lower case, letters and digits only, no leading article. */
const plain = (s: string): string =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().replace(/^(?:a|an|the) /, '');

function hasCrossConceptDuplicate(a: RoomAssembly): boolean {
  return duplicateAnswerScan(placed(a)).length > 0;
}

// Feature: generation-and-evaluation, Requirement 5.4a: no two concepts in a crypt share an answer
describe('Property: no assembled crypt has two slots with equal normalised answers', () => {
  it('holds for every assembly under the default policy', () => {
    fc.assert(
      fc.property(conceptsArb, (concepts) => {
        const a = assemble(concepts);
        if (a === null) return;
        expect(duplicateAnswerScan(placed(a))).toEqual([]);
        // The same claim checked with a separate normaliser, slot against slot.
        const slots = a.manifest.rooms.flatMap((r) => r.lockSlots);
        const answersOf = (conceptId: string) =>
          placed(a).filter((e) => e.conceptId === conceptId).flatMap((e) => e.keys.map(plain));
        for (const s of slots) {
          for (const t of slots) {
            if (s.conceptId === t.conceptId) continue;
            const mine = answersOf(s.conceptId);
            expect(answersOf(t.conceptId).filter((k) => mine.includes(k))).toEqual([]);
          }
        }
      }),
      { numRuns: 300 },
    );
  });

  it('places every question in a slot of its own concept, at most once', () => {
    fc.assert(
      fc.property(conceptsArb, (concepts) => {
        const a = assemble(concepts);
        if (a === null) return;
        const ids = placed(a).map((e) => e.questionId);
        expect(new Set(ids).size).toBe(ids.length);
        for (const e of placed(a)) expect(e.questionId.startsWith(`${e.conceptId}-`)).toBe(true);
      }),
      { numRuns: 200 },
    );
  });

  it('the generator does reach duplicates: the legacy policy publishes some', () => {
    const samples = fc.sample(conceptsArb, { numRuns: 300, seed: 20261127 });
    const legacyWithDuplicates = samples.filter((concepts) => {
      const a = assemble(concepts, LEGACY_ASSEMBLY_POLICY);
      return a !== null && hasCrossConceptDuplicate(a);
    });
    expect(legacyWithDuplicates.length).toBeGreaterThan(0);
  });
});
