import type { AuthoringQuestion } from '../authoring/schema';
import { duplicateAnswerScan, keyedSpec, type KeyedAnswer } from '../checks/duplicate-answers';
import type { MappedQuestion } from '../mapper/manifest-mapper';
import type { LockType } from '../types';

/** One extracted concept with its accepted questions (past Code_Checks and blind review). */
export interface AssemblyConcept {
  readonly conceptId: string;
  /** The concept title shown to the learner. */
  readonly label: string;
  readonly primary: AuthoringQuestion | null;
  readonly alternate: AuthoringQuestion | null;
}

/**
 * How assembly fills the room. `promoteAlternates`: an accepted alternate may take a lock type no
 * primary filled (also when its own primary was rejected). `dedupeAnswers`: two concepts never
 * share an answer (`duplicate-answer-in-room`). The legacy policy is the pre-2026-11-27 behaviour,
 * kept for evaluation ablations only.
 */
export interface AssemblyPolicy {
  readonly promoteAlternates: boolean;
  readonly dedupeAnswers: boolean;
}
export const DEFAULT_ASSEMBLY_POLICY: AssemblyPolicy = { promoteAlternates: true, dedupeAnswers: true };
export const LEGACY_ASSEMBLY_POLICY: AssemblyPolicy = { promoteAlternates: false, dedupeAnswers: false };

export type Role = 'primary' | 'alternate';

export interface Candidate {
  readonly role: Role;
  readonly question: AuthoringQuestion;
  readonly mapped: MappedQuestion;
}

/** A lock slot before the Leak_Scan. `lead` sets the station type. */
export interface Slot {
  readonly conceptId: string;
  readonly title: string;
  readonly lead: Candidate;
  readonly alternate: Candidate | null;
}

export interface Selection {
  readonly slots: readonly Slot[];
  /** Accepted primaries that got no slot, in concept order. */
  readonly unplaced: readonly { readonly concept: AssemblyConcept; readonly candidate: Candidate }[];
  /** Questions left out because another concept already uses their answer. */
  readonly duplicateSkipped: readonly { readonly conceptId: string; readonly role: Role }[];
}

export interface SelectDeps {
  /** Maps one accepted question; null when the mapper refused it (the caller records why). */
  readonly map: (concept: AssemblyConcept, role: Role) => Candidate | null;
  /** True when the Leak_Scan fails anywhere in these slots. */
  readonly leaks: (slots: readonly Slot[]) => boolean;
}

const typeOf = (c: Candidate): LockType => c.mapped.spec.lockType;
const idOf = (c: Candidate): string => c.mapped.spec.questionId;
const entryOf = (conceptId: string, c: Candidate): KeyedAnswer =>
  keyedSpec(conceptId, c.mapped.spec, c.mapped.content);

function uniqueConcepts(concepts: readonly AssemblyConcept[]): AssemblyConcept[] {
  const seen = new Set<string>();
  return concepts.filter((c) => (seen.has(c.conceptId) ? false : (seen.add(c.conceptId), true)));
}

/**
 * Picks the room's slots, at most one per lock type.
 * - Pass 1 gives each type to the first accepted primary of that type, in extraction order.
 * - Pass 2 (promoteAlternates) gives each type still free to the first remaining concept whose
 *   accepted alternate has that type; its primary becomes the slot's alternate. A promotion never
 *   makes the Leak_Scan fail: it is placed without its slot alternate, or not at all, instead.
 * - With dedupeAnswers no two concepts keep the same answer. A lead that clashes with another
 *   slot's lead is skipped. A lead that clashes only with other slots' alternates removes those
 *   alternates (an alternate is the spare). A clashing slot alternate is dropped.
 * Pure and deterministic.
 */
export function selectSlots(
  concepts: readonly AssemblyConcept[],
  deps: SelectDeps,
  policy: AssemblyPolicy,
): Selection {
  const unique = uniqueConcepts(concepts);
  // Map each question at most once, so a mapper rejection is recorded once.
  const memo = new Map<string, Candidate | null>();
  const mapped = (concept: AssemblyConcept, role: Role): Candidate | null => {
    const key = `${concept.conceptId}\u0000${role}`;
    if (!memo.has(key)) {
      const question = role === 'primary' ? concept.primary : concept.alternate;
      memo.set(key, question === null ? null : deps.map(concept, role));
    }
    return memo.get(key) ?? null;
  };

  let slots: Slot[] = [];
  const duplicateSkipped: { conceptId: string; role: Role }[] = [];
  const skip = (conceptId: string, c: Candidate): void => {
    duplicateSkipped.push({ conceptId, role: c.role });
  };
  const taken = (t: LockType): boolean => slots.some((s) => typeOf(s.lead) === t);

  // The registered duplicate-answer-in-room check decides; it ignores the concept's own questions.
  const clashingIds = (base: readonly Slot[], conceptId: string, c: Candidate): ReadonlySet<string> => {
    if (!policy.dedupeAnswers) return new Set();
    const placed = base.flatMap((s) =>
      [s.lead, ...(s.alternate === null ? [] : [s.alternate])].map((q) => entryOf(s.conceptId, q)),
    );
    const failures = duplicateAnswerScan([...placed, entryOf(conceptId, c)]);
    if (!failures.some((f) => f.questionId === idOf(c))) return new Set();
    return new Set(failures.map((f) => f.questionId).filter((q) => q !== idOf(c)));
  };

  /** The slots with `lead` admitted (clashing alternates removed), or null when it must be skipped. */
  const admit = (concept: AssemblyConcept, lead: Candidate): Slot[] | null => {
    const ids = clashingIds(slots, concept.conceptId, lead);
    if (slots.some((s) => ids.has(idOf(s.lead)))) return null;
    return slots.map((s) => (s.alternate !== null && ids.has(idOf(s.alternate)) ? { ...s, alternate: null } : s));
  };
  const commit = (next: Slot[], removedFrom: readonly Slot[]): void => {
    for (const before of removedFrom) {
      const after = next.find((s) => s.conceptId === before.conceptId);
      if (before.alternate !== null && after?.alternate === null) skip(before.conceptId, before.alternate);
    }
    slots = next;
  };
  const slotFor = (base: readonly Slot[], concept: AssemblyConcept, lead: Candidate, second: Candidate | null): Slot => {
    let alternate = second !== null && typeOf(second) !== typeOf(lead) ? second : null;
    if (alternate !== null && clashingIds(base, concept.conceptId, alternate).size > 0) {
      skip(concept.conceptId, alternate);
      alternate = null;
    }
    return { conceptId: concept.conceptId, title: concept.label, lead, alternate };
  };

  for (const concept of unique) {
    const primary = mapped(concept, 'primary');
    if (primary === null || taken(typeOf(primary))) continue;
    const base = admit(concept, primary);
    if (base === null) {
      skip(concept.conceptId, primary);
      continue;
    }
    // As before: an alternate is mapped only when its primary is placed and the types differ.
    const usable = concept.alternate !== null && concept.alternate.lockType !== primary.question.lockType;
    const slot = slotFor(base, concept, primary, usable ? mapped(concept, 'alternate') : null);
    commit([...base, slot], slots);
  }

  if (policy.promoteAlternates) {
    for (const concept of unique) {
      if (slots.some((s) => s.conceptId === concept.conceptId) || concept.alternate === null) continue;
      const alternate = mapped(concept, 'alternate');
      if (alternate === null || taken(typeOf(alternate))) continue;
      const base = admit(concept, alternate);
      if (base === null) {
        skip(concept.conceptId, alternate);
        continue;
      }
      const primary = concept.primary === null ? null : mapped(concept, 'primary');
      const full = { conceptId: concept.conceptId, title: concept.label, lead: alternate, alternate: primary };
      const bare = { ...full, alternate: null };
      // Never trade a placed slot for a promotion: try with the slot alternate, then without.
      const pick = [full, bare].find((s) => (s.alternate === null || typeOf(s.alternate) !== typeOf(s.lead)) && !deps.leaks([...base, s]));
      if (pick === undefined) continue;
      const slot = slotFor(base, concept, pick.lead, pick.alternate);
      commit([...base, slot], slots);
    }
  }

  const unplaced = unique.flatMap((concept) => {
    if (slots.some((s) => s.conceptId === concept.conceptId)) return [];
    const candidate = memo.get(`${concept.conceptId}\u0000primary`) ?? null;
    return candidate === null ? [] : [{ concept, candidate }];
  });
  return { slots, unplaced, duplicateSkipped };
}
