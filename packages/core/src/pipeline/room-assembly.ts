import type { AuthoringQuestion } from '../authoring/schema';
import { visibleTextOf } from '../checks/run-checks';
import { leakScanRoom, type LeakScanRoomEntry } from '../checks/leak-scan';
import type { CryptContent, CryptContentEntry } from '../mapper/crypt-content';
import {
  mapAuthoringQuestionToSpec,
  type MapperError,
  type MappedQuestion,
} from '../mapper/manifest-mapper';
import type { CryptManifest, LockSlotSpec, QuestionSpec } from '../runtime/manifest-types';
import { validateManifestForPublish, type PublishManifestError } from '../runtime/publish-manifest';
import type { LockType, Result } from '../types';
import { toDocumentChunkMaps, type PreparedDocument } from './prepare-input';

/** One extracted concept with its accepted questions (past Code_Checks and blind review). */
export interface AssemblyConcept {
  readonly conceptId: string;
  /** The concept title shown to the learner. */
  readonly label: string;
  readonly primary: AuthoringQuestion | null;
  readonly alternate: AuthoringQuestion | null;
}

export interface RoomAssemblyInput {
  /** Deterministic from the caller's inputs, e.g. the document digest. */
  readonly manifestId: string;
  readonly document: PreparedDocument;
  /** In extraction order. */
  readonly concepts: readonly AssemblyConcept[];
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
  readonly role: 'primary' | 'alternate';
  readonly error: MapperError;
}

export interface RoomAssembly {
  readonly manifest: CryptManifest;
  readonly content: CryptContent;
  readonly unplacedAccepted: readonly UnplacedAccepted[];
  readonly mapperRejections: readonly MapperRejection[];
  /** Concepts removed from the room by the Leak_Scan. They are not in `unplacedAccepted`. */
  readonly leakDroppedConceptIds: readonly string[];
}

export type RoomAssemblyError = { readonly kind: 'empty-room' } | PublishManifestError;

interface Candidate {
  readonly question: AuthoringQuestion;
  readonly mapped: MappedQuestion;
}

interface Slot {
  readonly conceptId: string;
  readonly title: string;
  readonly primary: Candidate;
  readonly alternate: Candidate | null;
}

const ROOM_ID = 'room-1';

function mapCandidate(
  question: AuthoringQuestion,
  concept: AssemblyConcept,
  role: 'primary' | 'alternate',
  input: RoomAssemblyInput,
  rejections: MapperRejection[],
): Candidate | null {
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
  return { question, mapped: mapped.value };
}

function entriesOf(slots: readonly Slot[]): readonly LeakScanRoomEntry[] {
  const entries: LeakScanRoomEntry[] = [];
  for (const slot of slots) {
    for (const c of [slot.primary, slot.alternate]) {
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
 * Handles one leaking question. A leaking alternate is removed. A leaking primary is replaced by
 * the slot's alternate when that alternate's type is free in the room, else the concept is dropped.
 */
function resolveLeak(slots: readonly Slot[], questionId: string): readonly Slot[] {
  const index = slots.findIndex(
    (s) => s.primary.question.id === questionId || s.alternate?.question.id === questionId,
  );
  const slot = slots[index];
  if (slot === undefined) return [];
  const rest = slots.filter((_, i) => i !== index);
  if (slot.alternate !== null && slot.alternate.question.id === questionId) {
    return slots.map((s, i) => (i === index ? { ...s, alternate: null } : s));
  }
  const alt = slot.alternate;
  const typeTaken = (t: LockType): boolean => rest.some((s) => s.primary.mapped.spec.lockType === t);
  if (alt !== null && !typeTaken(alt.mapped.spec.lockType)) {
    return slots.map((s, i) => (i === index ? { ...s, primary: alt, alternate: null } : s));
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
  const stationType = slot.primary.mapped.spec.lockType;
  return {
    slotId: `slot-${stationType}`,
    stationType,
    conceptId: slot.conceptId,
    primaryQuestion: slot.primary.mapped.spec,
    alternateQuestion: slot.alternate?.mapped.spec ?? null,
  };
}

/**
 * Builds the one-room crypt: at most one slot per lock type, the first accepted primary of each
 * type in extraction order taking it. Leak_Scan swaps or drops until clean. The final door is
 * always empty. Pure and total; never throws.
 */
export function assembleRoom(input: RoomAssemblyInput): Result<RoomAssembly, RoomAssemblyError> {
  const rejections: MapperRejection[] = [];
  const seenConcepts = new Set<string>();
  const placed: Slot[] = [];
  const unplacedCandidates: { concept: AssemblyConcept; candidate: Candidate }[] = [];
  const takenTypes = new Set<LockType>();

  for (const concept of input.concepts) {
    if (seenConcepts.has(concept.conceptId)) continue;
    seenConcepts.add(concept.conceptId);
    // A concept without an accepted primary is not eligible; its alternate is not promoted.
    if (concept.primary === null) continue;
    const primary = mapCandidate(concept.primary, concept, 'primary', input, rejections);
    if (primary === null) continue;
    const type = primary.mapped.spec.lockType;
    if (takenTypes.has(type)) {
      unplacedCandidates.push({ concept, candidate: primary });
      continue;
    }
    takenTypes.add(type);
    let alternate: Candidate | null = null;
    if (concept.alternate !== null && concept.alternate.lockType !== concept.primary.lockType) {
      alternate = mapCandidate(concept.alternate, concept, 'alternate', input, rejections);
    }
    placed.push({ conceptId: concept.conceptId, title: concept.label, primary, alternate });
  }

  const slots = removeLeaks(placed);
  if (slots.length === 0) return { ok: false, error: { kind: 'empty-room' } };

  const keptIds = new Set(slots.map((s) => s.conceptId));
  const leakDroppedConceptIds = placed.map((s) => s.conceptId).filter((id) => !keptIds.has(id));

  const questions: Record<string, CryptContentEntry> = {};
  const concepts: Record<string, { title: string }> = {};
  for (const slot of slots) {
    concepts[slot.conceptId] = { title: slot.title };
    for (const c of [slot.primary, slot.alternate]) {
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
      unplacedAccepted: unplacedCandidates.map(({ concept, candidate }) => ({
        conceptId: concept.conceptId,
        conceptTitle: concept.label,
        question: candidate.mapped.spec,
        content: candidate.mapped.content,
      })),
      mapperRejections: rejections,
      leakDroppedConceptIds,
    },
  };
}
