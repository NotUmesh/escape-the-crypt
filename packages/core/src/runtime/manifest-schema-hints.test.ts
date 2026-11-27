import { describe, expect, it } from 'vitest';
import { buildManifest } from '../test-support/manifest-fixture';
import { parseManifest } from './manifest-schema';
import type { CryptManifest, QuestionSpec } from './manifest-types';

const TYPES = ['rune-cipher', 'seance-board'] as const;

/** Valid manifest holding one rune primary and one séance alternate in the first slot. */
function base(): CryptManifest {
  return buildManifest({ rooms: 1, conceptsPerRoom: 2, lockTypes: [...TYPES], finalDoorQuestions: 1 });
}

function withFirstSlot(
  m: CryptManifest,
  edit: (primary: QuestionSpec, alternate: QuestionSpec | null) => { primary?: QuestionSpec; alternate?: QuestionSpec | null; stationType?: QuestionSpec['lockType'] },
): unknown {
  const room = m.rooms[0]!;
  const slot = room.lockSlots[0]!;
  const out = edit(slot.primaryQuestion, slot.alternateQuestion);
  const newSlot = {
    ...slot,
    primaryQuestion: out.primary ?? slot.primaryQuestion,
    alternateQuestion: out.alternate === undefined ? slot.alternateQuestion : out.alternate,
    stationType: out.stationType ?? slot.stationType,
  };
  return { ...m, rooms: [{ ...room, lockSlots: [newSlot, ...room.lockSlots.slice(1)] }] };
}

const runeWith = (q: QuestionSpec, hintEffect: unknown): QuestionSpec =>
  ({ ...q, hintEffect }) as QuestionSpec;

const issues = (raw: unknown): string =>
  JSON.stringify((() => {
    const r = parseManifest(raw);
    return r.ok ? [] : r.error.issues;
  })());

describe('parseManifest: fixture manifests and shapes', () => {
  it('accepts fixture manifests, with and without hint effects', () => {
    expect(parseManifest(base()).ok).toBe(true);
    const hinted = buildManifest({ lockTypes: [...TYPES], hintEffects: true, finalDoorQuestions: 4 });
    expect(parseManifest(hinted).ok).toBe(true);
  });

  it('returns a typed error with path and message for invalid input', () => {
    const r = parseManifest({ ...base(), manifestId: '' });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.kind).toBe('manifest-schema-invalid');
      expect(r.error.issues[0]?.path).toEqual(['manifestId']);
    }
  });

  it('rejects unknown keys and bad payload shapes', () => {
    expect(parseManifest({ ...base(), extra: 1 }).ok).toBe(false);
    const badRune = withFirstSlot(base(), (p) => ({ primary: { ...p, payload: { answer: '', aliases: [], caseSensitive: false } } }));
    expect(parseManifest(badRune).ok).toBe(false);
    const missingAliases = withFirstSlot(base(), (p) => ({ primary: { ...p, payload: { answer: 'x', caseSensitive: false } } }));
    expect(parseManifest(missingAliases).ok).toBe(false);
  });

  it('rejects séance payloads with a key outside the options or the wrong option count', () => {
    const m = buildManifest({ rooms: 1, conceptsPerRoom: 1, lockTypes: ['seance-board', 'rune-cipher'], finalDoorQuestions: 0 });
    const q = m.rooms[0]!.lockSlots[0]!.primaryQuestion;
    expect(q.lockType).toBe('seance-board');
    const mk = (payload: unknown) => withFirstSlot(m, (p) => ({ primary: { ...p, payload } as QuestionSpec }));
    expect(parseManifest(mk({ optionIds: ['a', 'b', 'c'], keyOptionId: 'z' })).ok).toBe(false);
    expect(parseManifest(mk({ optionIds: ['a', 'b'], keyOptionId: 'a' })).ok).toBe(false);
    expect(parseManifest(mk({ optionIds: ['a', 'b', 'c', 'd', 'e'], keyOptionId: 'a' })).ok).toBe(false);
    expect(parseManifest(mk({ optionIds: ['a', 'b', 'c', 'd'], keyOptionId: 'd' })).ok).toBe(true);
  });

  it('rejects a primary whose lockType differs from the station type', () => {
    const raw = withFirstSlot(base(), (p) => ({ stationType: p.lockType === 'rune-cipher' ? 'seance-board' : 'rune-cipher' }));
    expect(parseManifest(raw).ok).toBe(false);
  });

  it('rejects an alternate of the same lock type and accepts a null alternate', () => {
    const raw = withFirstSlot(base(), (p) => ({ alternate: { ...p, questionId: 'other' } }));
    expect(parseManifest(raw).ok).toBe(false);
    expect(parseManifest(withFirstSlot(base(), () => ({ alternate: null }))).ok).toBe(true);
  });

  it('rejects two slots of the same station type in one room', () => {
    const m = base();
    const room = m.rooms[0]!;
    const first = room.lockSlots[0]!;
    const dupe = { ...room.lockSlots[1]!, stationType: first.stationType, primaryQuestion: { ...room.lockSlots[1]!.primaryQuestion, lockType: first.stationType, payload: first.primaryQuestion.payload } };
    const raw = { ...m, rooms: [{ ...room, lockSlots: [first, dupe] }] };
    expect(parseManifest(raw).ok).toBe(false);
  });

  it('accepts 0 to 4 final-door slots and rejects 5', () => {
    for (const n of [0, 1, 4]) {
      expect(parseManifest(buildManifest({ lockTypes: [...TYPES], finalDoorQuestions: n })).ok).toBe(true);
    }
    const four = buildManifest({ lockTypes: [...TYPES], finalDoorQuestions: 4 });
    const extra = { ...four.finalDoor.slots[0]!, slotId: 'f5', question: { ...four.finalDoor.slots[0]!.question, questionId: 'q-extra' } };
    expect(parseManifest({ ...four, finalDoor: { slots: [...four.finalDoor.slots, extra] } }).ok).toBe(false);
  });

  it('rejects lock types that have no payload schema, naming the type', () => {
    // All six types now have a schema (combination-dial in task 35.5); an unknown type is still rejected.
    const m = buildManifest({ rooms: 1, conceptsPerRoom: 1, lockTypes: ['rune-cipher', 'seance-board'], finalDoorQuestions: 0 });
    const unknown = 'not-a-lock-type' as QuestionSpec['lockType'];
    const raw = withFirstSlot(m, (p) => ({ primary: { ...p, lockType: unknown }, stationType: unknown }));
    expect(parseManifest(raw).ok).toBe(false);
    expect(issues(raw)).toContain('lockType');
  });
});

describe('parseManifest: hint effect narrowing', () => {
  const seanceManifest = () =>
    buildManifest({ rooms: 1, conceptsPerRoom: 1, lockTypes: ['seance-board', 'rune-cipher'], finalDoorQuestions: 0 });
  const seanceWith = (hint: unknown) =>
    withFirstSlot(seanceManifest(), (p) => ({ primary: runeWith(p, hint) }));
  const seancePayload = () => seanceManifest().rooms[0]!.lockSlots[0]!.primaryQuestion.payload as { optionIds: string[]; keyOptionId: string };

  it('rejects remove-option on a rune cipher', () => {
    const raw = withFirstSlot(base(), (p) => ({ primary: runeWith(p, { kind: 'remove-option', optionId: 'a' }) }));
    expect(base().rooms[0]!.lockSlots[0]!.primaryQuestion.lockType).toBe('rune-cipher');
    expect(issues(raw)).toContain('hint-kind-not-allowed');
  });

  it('rejects a séance remove-option naming an id outside optionIds', () => {
    expect(issues(seanceWith({ kind: 'remove-option', optionId: 'not-an-option' }))).toContain('hint-option-unknown');
  });

  it('rejects a séance remove-option naming the key option', () => {
    const { keyOptionId } = seancePayload();
    expect(issues(seanceWith({ kind: 'remove-option', optionId: keyOptionId }))).toContain('hint-option-is-key');
  });

  it('accepts a séance remove-option naming a wrong option', () => {
    const { optionIds, keyOptionId } = seancePayload();
    const wrong = optionIds.find((o) => o !== keyOptionId)!;
    expect(parseManifest(seanceWith({ kind: 'remove-option', optionId: wrong })).ok).toBe(true);
  });

  it('rejects reveal-first-letter on a séance', () => {
    const raw = seanceWith({ kind: 'reveal-first-letter', firstLetter: 'h', length: 5 });
    expect(issues(raw)).toContain('hint-kind-not-allowed');
  });

  it('rejects reveal-first-letter with a 2-character letter or a non-positive length', () => {
    const rune = (hint: unknown) => withFirstSlot(base(), (p) => ({ primary: runeWith(p, hint) }));
    expect(parseManifest(rune({ kind: 'reveal-first-letter', firstLetter: 'h', length: 5 })).ok).toBe(true);
    expect(parseManifest(rune({ kind: 'reveal-first-letter', firstLetter: 'he', length: 5 })).ok).toBe(false);
    expect(parseManifest(rune({ kind: 'reveal-first-letter', firstLetter: 'h', length: 0 })).ok).toBe(false);
    expect(parseManifest(rune({ kind: 'reveal-first-letter', firstLetter: 'h', length: -1 })).ok).toBe(false);
  });
});
