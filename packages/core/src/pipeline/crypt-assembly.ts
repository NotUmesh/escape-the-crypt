import { duplicateAnswerScan, keyedSpec } from '../checks/duplicate-answers';
import { leakScanRoom, type LeakScanRoomEntry } from '../checks/leak-scan';
import { visibleTextOf } from '../checks/run-checks';
import type { CryptContentEntry } from '../mapper/crypt-content';
import { mapAuthoringQuestionToSpec, type MapperError } from '../mapper/manifest-mapper';
import type { CryptTarget } from '../run-length';
import type { CryptManifest, LockSlotSpec, QuestionSpec } from '../runtime/manifest-types';
import { validateManifestForPublish } from '../runtime/publish-manifest';
import type { Result } from '../types';
import { contentManifestId } from './crypt-manifest-id';
import { toDocumentChunkMaps } from './prepare-input';
import {
  assembleRoom,
  type AssemblyConcept,
  type MapperRejection,
  type RoomAssembly,
  type RoomAssemblyError,
  type RoomAssemblyInput,
  type UnplacedAccepted,
} from './room-assembly';

type Role = 'primary' | 'alternate';

/** A room that two concepts fill on their own: exactly two locks, no leak, nothing set aside. */
interface Pair {
  readonly a: number;
  readonly b: number;
  readonly slots: readonly LockSlotSpec[];
  readonly content: Readonly<Record<string, CryptContentEntry>>;
  readonly answers: ReturnType<typeof keyedSpec>[];
  readonly leakEntries: LeakScanRoomEntry[];
}

const roleOf = (questionId: string): Role => (questionId.endsWith('-alternate') ? 'alternate' : 'primary');

/** Two rooms may share a crypt when no placed answer repeats and no rune answer shows in the other room. */
function compatible(x: Pair, y: Pair): boolean {
  if (duplicateAnswerScan([...x.answers, ...y.answers]).length > 0) return false;
  return leakScanRoom([...x.leakEntries, ...y.leakEntries]).length === 0;
}

function buildPair(
  a: number,
  b: number,
  concepts: readonly AssemblyConcept[],
  input: RoomAssemblyInput,
): Pair | null {
  const first = concepts[a] as AssemblyConcept;
  const second = concepts[b] as AssemblyConcept;
  // Selection depends on order (the first concept's primary is placed first), so try both.
  for (const order of [[first, second], [second, first]] as const) {
    const built = assembleRoom({ ...input, concepts: order });
    if (!built.ok) continue;
    const slots = built.value.manifest.rooms.flatMap((r) => r.lockSlots);
    if (slots.length !== 2) continue;
    const specs = slots.flatMap((s) => [s.primaryQuestion, s.alternateQuestion]).filter((q): q is QuestionSpec => q !== null);
    const owner = new Map(slots.flatMap((s) => [s.primaryQuestion, s.alternateQuestion].flatMap((q) => (q === null ? [] : [[q.questionId, s.conceptId] as const]))));
    const byConcept = new Map(concepts.map((c) => [c.conceptId, c] as const));
    const leakEntries: LeakScanRoomEntry[] = [];
    for (const spec of specs) {
      const concept = byConcept.get(owner.get(spec.questionId) ?? '');
      const question = concept === undefined ? null : roleOf(spec.questionId) === 'primary' ? concept.primary : concept.alternate;
      if (concept !== undefined && question !== null) {
        leakEntries.push({ conceptId: concept.conceptId, question, visibleText: visibleTextOf(question) });
      }
    }
    return {
      a,
      b,
      slots,
      content: built.value.content.questions,
      answers: specs.map((q) => keyedSpec(owner.get(q.questionId) ?? '', q, built.value.content.questions[q.questionId])),
      leakEntries,
    };
  }
  return null;
}

/** The first set of `size` pairwise-compatible, concept-disjoint rooms, by concept order; or null. */
function findRooms(pairs: readonly Pair[], size: number, fits: (i: number, j: number) => boolean): Pair[] | null {
  const chosen: number[] = [];
  const used = new Set<number>();
  const go = (from: number): boolean => {
    if (chosen.length === size) return true;
    for (let p = from; p < pairs.length; p += 1) {
      const pair = pairs[p] as Pair;
      if (used.has(pair.a) || used.has(pair.b) || !chosen.every((c) => fits(c, p))) continue;
      chosen.push(p);
      used.add(pair.a);
      used.add(pair.b);
      if (go(p + 1)) return true;
      chosen.pop();
      used.delete(pair.a);
      used.delete(pair.b);
    }
    return false;
  };
  return go(0) ? chosen.map((p) => pairs[p] as Pair) : null;
}

/**
 * Builds a crypt of up to `target.rooms` rooms, each with exactly two locks from two different
 * concepts. Every pair of concepts is tried as a room through `assembleRoom`; then the earliest
 * set of rooms that share no concept, no answer and no rune-answer leak is kept. Fewer rooms than
 * the target are returned as they are: no weak question is added to fill a room, and no question
 * the checks refused is brought back. Concepts without a room go to `unplacedAccepted`. The
 * manifest ID follows the content, so a different crypt from the same notes never collides. Pure.
 */
export function assembleCrypt(
  input: RoomAssemblyInput,
  target: CryptTarget,
): Result<RoomAssembly, RoomAssemblyError> {
  const concepts = input.concepts.filter((c, i, all) => all.findIndex((o) => o.conceptId === c.conceptId) === i);
  const maps = toDocumentChunkMaps(input.document);
  const rejections: MapperRejection[] = [];
  const mapped = new Map<string, { readonly spec: QuestionSpec; readonly content: CryptContentEntry } | null>();
  const mapOne = (concept: AssemblyConcept, role: Role): void => {
    const question = role === 'primary' ? concept.primary : concept.alternate;
    if (question === null) return;
    const questionId = `${concept.conceptId}-${role}`;
    if (question.conceptId !== concept.conceptId) {
      const error: MapperError = { kind: 'authoring-schema-invalid', questionId, conceptId: concept.conceptId };
      rejections.push({ conceptId: concept.conceptId, role, error });
      mapped.set(questionId, null);
      return;
    }
    const result = mapAuthoringQuestionToSpec(question, maps, questionId, concept.label);
    if (!result.ok) rejections.push({ conceptId: concept.conceptId, role, error: result.error });
    mapped.set(questionId, result.ok ? result.value : null);
  };
  for (const concept of concepts) {
    mapOne(concept, 'primary');
    mapOne(concept, 'alternate');
  }
  const usable = (c: AssemblyConcept): boolean =>
    mapped.get(`${c.conceptId}-primary`) != null || mapped.get(`${c.conceptId}-alternate`) != null;

  const pairs: Pair[] = [];
  for (let a = 0; a < concepts.length; a += 1) {
    for (let b = a + 1; b < concepts.length; b += 1) {
      if (!usable(concepts[a] as AssemblyConcept) || !usable(concepts[b] as AssemblyConcept)) continue;
      const pair = buildPair(a, b, concepts, input);
      if (pair !== null) pairs.push(pair);
    }
  }
  const memo = new Map<string, boolean>();
  const fits = (i: number, j: number): boolean => {
    const key = `${i}|${j}`;
    if (!memo.has(key)) memo.set(key, compatible(pairs[i] as Pair, pairs[j] as Pair));
    return memo.get(key) as boolean;
  };
  let rooms: Pair[] | null = null;
  for (let size = Math.min(target.rooms, Math.floor(concepts.length / 2)); size >= 1 && rooms === null; size -= 1) {
    rooms = findRooms(pairs, size, fits);
  }
  if (rooms === null) return { ok: false, error: { kind: 'empty-room' } };

  const placed = new Set(rooms.flatMap((r) => [r.a, r.b]));
  const questions: Record<string, CryptContentEntry> = {};
  const conceptTitles: Record<string, { title: string }> = {};
  const roomSpecs = rooms.map((room, k) => {
    Object.assign(questions, room.content);
    const lockSlots = room.slots.map((slot) => {
      conceptTitles[slot.conceptId] = { title: concepts.find((c) => c.conceptId === slot.conceptId)?.label ?? '' };
      return { ...slot, slotId: `room-${k + 1}-${slot.slotId}` };
    });
    return { roomId: `room-${k + 1}`, lockSlots };
  });
  const content = { questions, concepts: conceptTitles };
  const published = validateManifestForPublish({
    manifestId: contentManifestId(input.manifestId, roomSpecs, content),
    rooms: roomSpecs,
    finalDoor: { slots: [] },
  });
  if (!published.ok) return published;

  const unplacedAccepted: UnplacedAccepted[] = [];
  concepts.forEach((concept, i) => {
    const primary = mapped.get(`${concept.conceptId}-primary`);
    if (placed.has(i) || primary == null) return;
    unplacedAccepted.push({ conceptId: concept.conceptId, conceptTitle: concept.label, question: primary.spec, content: primary.content });
  });
  const manifest: CryptManifest = published.value;
  return {
    ok: true,
    value: { manifest, content, unplacedAccepted, mapperRejections: rejections, leakDroppedConceptIds: [], duplicateSkipped: [] },
  };
}

/** One call for the pipeline: the legacy one-room assembly without a target, a multi-room crypt with one. */
export function assembleForTarget(
  input: RoomAssemblyInput,
  target: CryptTarget | undefined,
): Result<RoomAssembly, RoomAssemblyError> {
  return target === undefined ? assembleRoom(input) : assembleCrypt(input, target);
}
