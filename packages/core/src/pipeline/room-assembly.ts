import { visibleTextOf } from '../checks/run-checks';
import { leakScanRoom, type LeakScanRoomEntry } from '../checks/leak-scan';
import type { CryptContent, CryptContentEntry } from '../mapper/crypt-content';
import { mapAuthoringQuestionToSpec, type MapperError } from '../mapper/manifest-mapper';
import type { CryptManifest, LockSlotSpec, QuestionSpec } from '../runtime/manifest-types';
import { validateManifestForPublish, type PublishManifestError } from '../runtime/publish-manifest';
import type { LockType, Result } from '../types';
import { toDocumentChunkMaps, type PreparedDocument } from './prepare-input';
import {
  DEFAULT_ASSEMBLY_POLICY,
  selectSlots,
  type AssemblyConcept,
  type AssemblyPolicy,
  type Candidate,
  type Role,
  type Slot,
} from './room-assembly-select';

export type { AssemblyConcept, AssemblyPolicy } from './room-assembly-select';
export { DEFAULT_ASSEMBLY_POLICY, LEGACY_ASSEMBLY_POLICY } from './room-assembly-select';

export interface RoomAssemblyInput {
  /** Deterministic from the caller's inputs, e.g. the document digest. */
  readonly manifestId: string;
  readonly document: PreparedDocument;
  /** In extraction order. */
  readonly concepts: readonly AssemblyConcept[];
  /** Default DEFAULT_ASSEMBLY_POLICY. */
  readonly policy?: AssemblyPolicy;
}

/** An accepted question that did not get a room slot. Never published. */
export interface UnplacedAccepted {
  readonly conceptId: string;
  readonly conceptTitle: string;
  readonly question: QuestionSpec;
  readonly content: CryptContentEntry;
}

/** A question the mapper refused. The question is set aside, never published. */
export interface MapperRejection {
  readonly conceptId: string;
  readonly role: Role;
  readonly error: MapperError;
}

export interface RoomAssembly {
  readonly manifest: CryptManifest;
  readonly content: CryptContent;
  readonly unplacedAccepted: readonly UnplacedAccepted[];
  readonly mapperRejections: readonly MapperRejection[];
  /** Concepts removed from the room by the Leak_Scan. They are not in `unplacedAccepted`. */
  readonly leakDroppedConceptIds: readonly string[];
  /** Questions left out by duplicate-answer-in-room. They are not in `unplacedAccepted`. */
  readonly duplicateSkipped: readonly { readonly conceptId: string; readonly role: Role }[];
}

export type RoomAssemblyError = { readonly kind: 'empty-room' } | PublishManifestError;

const ROOM_ID = 'room-1';

function mapCandidate(
  concept: AssemblyConcept,
  role: Role,
  input: RoomAssemblyInput,
  rejections: MapperRejection[],
): Candidate | null {
  const question = role === 'primary' ? concept.primary : concept.alternate;
  if (question === null) return null;
  const questionId = `${concept.conceptId}-${role}`;
  if (question.conceptId !== concept.conceptId) {
    const error: MapperError = {
      kind: 'authoring-schema-invalid',
      questionId,
      conceptId: concept.conceptId,
    };
    rejections.push({ conceptId: concept.conceptId, role, error });
    return null;
  }
  const mapped = mapAuthoringQuestionToSpec(
    question,
    toDocumentChunkMaps(input.document),
    questionId,
    concept.label,
  );
  if (!mapped.ok) {
    rejections.push({ conceptId: concept.conceptId, role, error: mapped.error });
    return null;
  }
  return { role, question, mapped: mapped.value };
}

function entriesOf(slots: readonly Slot[]): readonly LeakScanRoomEntry[] {
  const entries: LeakScanRoomEntry[] = [];
  for (const slot of slots) {
    for (const c of [slot.lead, slot.alternate]) {
      if (c === null) continue;
      entries.push({
        conceptId: slot.conceptId,
        question: c.question,
        visibleText: visibleTextOf(c.question),
      });
    }
  }
  return entries;
}

/**
 * Handles one leaking question. A leaking alternate is removed. A leaking lead is replaced by
 * the slot's alternate when that alternate's type is free in the room, else the concept is dropped.
 */
function resolveLeak(slots: readonly Slot[], questionId: string): readonly Slot[] {
  const index = slots.findIndex(
    (s) => s.lead.question.id === questionId || s.alternate?.question.id === questionId,
  );
  const slot = slots[index];
  if (slot === undefined) return [];
  const rest = slots.filter((_, i) => i !== index);
  if (slot.alternate !== null && slot.alternate.question.id === questionId) {
    return slots.map((s, i) => (i === index ? { ...s, alternate: null } : s));
  }
  const alt = slot.alternate;
  const typeTaken = (t: LockType): boolean => rest.some((s) => s.lead.mapped.spec.lockType === t);
  if (alt !== null && !typeTaken(alt.mapped.spec.lockType)) {
    return slots.map((s, i) => (i === index ? { ...s, lead: alt, alternate: null } : s));
  }
  return rest;
}

function removeLeaks(initial: readonly Slot[]): readonly Slot[] {
  let slots = initial;
  // Every pass removes an alternate, swaps one in, or drops a slot, so this bound always suffices.
  const bound = initial.length * 2 + 1;
  for (let pass = 0; pass < bound; pass += 1) {
    const failure = leakScanRoom(entriesOf(slots))[0];
    if (failure === undefined) return slots;
    slots = resolveLeak(slots, failure.questionId);
  }
  return leakScanRoom(entriesOf(slots)).length === 0 ? slots : [];
}

function toLockSlot(slot: Slot): LockSlotSpec {
  const stationType = slot.lead.mapped.spec.lockType;
  return {
    slotId: `slot-${stationType}`,
    stationType,
    conceptId: slot.conceptId,
    primaryQuestion: slot.lead.mapped.spec,
    alternateQuestion: slot.alternate?.mapped.spec ?? null,
  };
}

/**
 * Builds the one-room crypt: at most one slot per lock type, chosen by `selectSlots` (accepted
 * primaries first, then accepted alternates for lock types still free; no two concepts share an
 * answer). Leak_Scan swaps or drops until clean. The final door is always empty. Pure and total;
 * never throws.
 */
export function assembleRoom(input: RoomAssemblyInput): Result<RoomAssembly, RoomAssemblyError> {
  const rejections: MapperRejection[] = [];
  // Mapped once per question across all passes, so a mapper rejection is recorded once.
  const mappedCache = new Map<string, Candidate | null>();
  const deps = {
    map: (concept: AssemblyConcept, role: Role): Candidate | null => {
      const key = `${concept.conceptId}\u0000${role}`;
      if (!mappedCache.has(key)) mappedCache.set(key, mapCandidate(concept, role, input, rejections));
      return mappedCache.get(key) ?? null;
    },
    leaks: (slots: readonly Slot[]): boolean => leakScanRoom(entriesOf(slots)).length > 0,
  };
  const policy = input.policy ?? DEFAULT_ASSEMBLY_POLICY;

  // A concept the Leak_Scan drops frees its lock type. Select again without it, so another
  // accepted question can take the type, until no concept is dropped. Each pass drops at least one
  // concept, so this ends.
  const leakDropped = new Set<string>();
  let selection = selectSlots(input.concepts, deps, policy);
  let slots = removeLeaks(selection.slots);
  for (let pass = 0; pass < input.concepts.length; pass += 1) {
    const kept = new Set(slots.map((s) => s.conceptId));
    const dropped = selection.slots.map((s) => s.conceptId).filter((id) => !kept.has(id));
    if (dropped.length === 0 || !policy.promoteAlternates) break;
    for (const id of dropped) leakDropped.add(id);
    selection = selectSlots(input.concepts.filter((c) => !leakDropped.has(c.conceptId)), deps, policy);
    slots = removeLeaks(selection.slots);
  }
  if (!policy.promoteAlternates) {
    const kept = new Set(slots.map((s) => s.conceptId));
    for (const s of selection.slots) if (!kept.has(s.conceptId)) leakDropped.add(s.conceptId);
  }
  if (slots.length === 0) return { ok: false, error: { kind: 'empty-room' } };

  const leakDroppedConceptIds = input.concepts
    .map((c) => c.conceptId)
    .filter((id, i, all) => leakDropped.has(id) && all.indexOf(id) === i);

  const questions: Record<string, CryptContentEntry> = {};
  const concepts: Record<string, { title: string }> = {};
  for (const slot of slots) {
    concepts[slot.conceptId] = { title: slot.title };
    for (const c of [slot.lead, slot.alternate]) {
      if (c !== null) questions[c.mapped.spec.questionId] = c.mapped.content;
    }
  }

  const published = validateManifestForPublish({
    manifestId: input.manifestId,
    rooms: [{ roomId: ROOM_ID, lockSlots: slots.map(toLockSlot) }],
    finalDoor: { slots: [] },
  });
  if (!published.ok) return published;

  return {
    ok: true,
    value: {
      manifest: published.value,
      content: { questions, concepts },
      unplacedAccepted: selection.unplaced.map(({ concept, candidate }) => ({
        conceptId: concept.conceptId,
        conceptTitle: concept.label,
        question: candidate.mapped.spec,
        content: candidate.mapped.content,
      })),
      mapperRejections: rejections,
      leakDroppedConceptIds,
      duplicateSkipped: selection.duplicateSkipped,
    },
  };
}
