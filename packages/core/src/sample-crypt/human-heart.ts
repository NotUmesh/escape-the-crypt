import { parseAuthoringQuestion } from '../authoring/parse';
import type { AuthoringQuestion } from '../authoring/schema';
import { buildDocumentChunkMaps, mapAuthoringQuestionToSpec } from '../mapper/manifest-mapper';
import type { DocumentChunkMaps, MapperError, MappedQuestion } from '../mapper/manifest-mapper';
import type { CryptContent } from '../mapper/crypt-content';
import type { InvalidManifestError } from '../runtime/manifest-check';
import type { ManifestSchemaError } from '../runtime/manifest-schema';
import type {
  CryptManifest,
  FinalDoorSlotSpec,
  LockSlotSpec,
} from '../runtime/manifest-types';
import { validateManifestForPublish } from '../runtime/publish-manifest';
import type { Chunk, LockType, Result } from '../types';

/**
 * Shape of `samples/questions/human-heart.json`. Questions stay `unknown` here because the
 * file also holds lock types that Phase 1 cannot yet map; the builder parses only the ones it
 * selects. `status` is the human-review record and is read as data.
 */
export interface HumanHeartQuestionsFile {
  readonly notes: string;
  readonly status: string;
  readonly questions: readonly unknown[];
}

/** A selected sample question is absent from the file, or fails the authoring schema. */
export type SampleQuestionError =
  | { readonly kind: 'sample-question-missing'; readonly questionId: string }
  | { readonly kind: 'sample-question-invalid'; readonly questionId: string; readonly path: string };

/** The sample crypt: manifest, learner-facing content and the document chunks it cites. */
export interface SampleCryptResult {
  readonly manifest: CryptManifest;
  readonly content: CryptContent;
  readonly chunks: ReadonlyMap<string, Chunk>;
}

export type SampleCryptError =
  | MapperError
  | SampleQuestionError
  | ManifestSchemaError
  | InvalidManifestError;

/** True only when the sample file records `status === 'human-reviewed'`. A data read, never inferred. */
export function isHumanReviewed(file: HumanHeartQuestionsFile): boolean {
  return file.status === 'human-reviewed';
}

interface RoomSelection {
  readonly slotId: string;
  readonly stationType: LockType;
  readonly conceptId: string;
  readonly primaryId: string;
  readonly alternateId: string;
}

interface FinalDoorSelection {
  readonly slotId: string;
  readonly conceptId: string;
  readonly questionId: string;
}

// Fixed selection, not a search: the sample is fixed data. Only hh-c01 and hh-c02 have both a
// primary and an alternate among the rune cipher and séance board questions. hh-c03, hh-c04 and
// hh-c07 each have one usable question left for the final door; hh-c05 and hh-c06 have none.
const ROOM_ID = 'hh-room-1';
const ROOM_SELECTION: readonly RoomSelection[] = [
  { slotId: 'hh-slot-1', stationType: 'rune-cipher', conceptId: 'hh-c01', primaryId: 'hh-q01', alternateId: 'hh-q02' },
  { slotId: 'hh-slot-2', stationType: 'seance-board', conceptId: 'hh-c02', primaryId: 'hh-q03', alternateId: 'hh-q04' },
];
const FINAL_DOOR_SELECTION: readonly FinalDoorSelection[] = [
  { slotId: 'hh-final-1', conceptId: 'hh-c03', questionId: 'hh-q06' },
  { slotId: 'hh-final-2', conceptId: 'hh-c04', questionId: 'hh-q08' },
  { slotId: 'hh-final-3', conceptId: 'hh-c07', questionId: 'hh-q12' },
];

// Plain-text concept titles for the sample. The questions file carries none.
export const SAMPLE_CONCEPT_TITLES: Readonly<Record<string, string>> = {
  'hh-c01': 'The atrioventricular valves',
  'hh-c02': 'What each chamber does',
  'hh-c03': 'The path of blood through the right side',
  'hh-c04': 'Blood vessels and their jobs',
  'hh-c05': 'The four chambers',
  'hh-c06': 'Resting heart rate',
  'hh-c07': "The heart's natural pacemaker",
};

function findQuestion(file: HumanHeartQuestionsFile, questionId: string): unknown {
  return file.questions.find(
    (q) => typeof q === 'object' && q !== null && (q as { id?: unknown }).id === questionId,
  );
}

function loadMappedQuestion(
  file: HumanHeartQuestionsFile,
  maps: DocumentChunkMaps,
  questionId: string,
): Result<MappedQuestion, SampleCryptError> {
  const raw = findQuestion(file, questionId);
  if (raw === undefined) return { ok: false, error: { kind: 'sample-question-missing', questionId } };
  const parsed = parseAuthoringQuestion(raw);
  if (!parsed.ok) {
    return { ok: false, error: { kind: 'sample-question-invalid', questionId, path: parsed.error.path } };
  }
  const question: AuthoringQuestion = parsed.value;
  // The authoring id is unique within this file, so it is the manifest question ID.
  return mapAuthoringQuestionToSpec(question, maps, questionId, SAMPLE_CONCEPT_TITLES[question.conceptId]);
}

function record(content: CryptContent, questionId: string, mapped: MappedQuestion): void {
  content.questions[questionId] = mapped.content;
  content.concepts[mapped.concept.conceptId] = { title: mapped.concept.title };
}

/**
 * Builds the Gate 1 sample crypt from `samples/human-heart.txt` and its questions file.
 * Pure: the caller reads the files. Any failure is a typed error naming the question (or the
 * manifest check that failed); no partial result is ever returned.
 *
 * Ghosts: the room has 2 locks and `GHOST_DELAY` is 3, so a missed concept cannot return inside
 * the room. Ghosts return only at the final door. This is expected runtime behaviour.
 */
export function buildHumanHeartSampleCrypt(
  notesText: string,
  questionsJson: HumanHeartQuestionsFile,
): Result<SampleCryptResult, SampleCryptError> {
  const maps = buildDocumentChunkMaps(notesText);
  const content: CryptContent = { questions: {}, concepts: {} };

  const lockSlots: LockSlotSpec[] = [];
  for (const sel of ROOM_SELECTION) {
    const primary = loadMappedQuestion(questionsJson, maps, sel.primaryId);
    if (!primary.ok) return primary;
    const alternate = loadMappedQuestion(questionsJson, maps, sel.alternateId);
    if (!alternate.ok) return alternate;
    lockSlots.push({
      slotId: sel.slotId,
      stationType: sel.stationType,
      conceptId: sel.conceptId,
      primaryQuestion: primary.value.spec,
      alternateQuestion: alternate.value.spec,
    });
    record(content, sel.primaryId, primary.value);
    record(content, sel.alternateId, alternate.value);
  }

  const slots: FinalDoorSlotSpec[] = [];
  for (const sel of FINAL_DOOR_SELECTION) {
    const mapped = loadMappedQuestion(questionsJson, maps, sel.questionId);
    if (!mapped.ok) return mapped;
    slots.push({ slotId: sel.slotId, conceptId: sel.conceptId, question: mapped.value.spec });
    record(content, sel.questionId, mapped.value);
  }

  const manifest: CryptManifest = {
    manifestId: 'human-heart-sample',
    rooms: [{ roomId: ROOM_ID, lockSlots }],
    finalDoor: { slots },
  };

  const owners: readonly { conceptId: string; questionId: string }[] = [
    ...lockSlots.map((s) => ({ conceptId: s.conceptId, questionId: s.primaryQuestion.questionId })),
    ...slots.map((s) => ({ conceptId: s.conceptId, questionId: s.question.questionId })),
  ];
  for (const o of owners) {
    if (content.concepts[o.conceptId] === undefined) {
      return { ok: false, error: { kind: 'concept-label-missing', questionId: o.questionId, conceptId: o.conceptId } };
    }
  }

  const published = validateManifestForPublish(manifest);
  if (!published.ok) return published;
  return { ok: true, value: { manifest: published.value, content, chunks: maps.chunks } };
}