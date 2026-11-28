import { parseAuthoringQuestion } from '../authoring/parse';
import type { AuthoringQuestion } from '../authoring/schema';
import { buildDocumentChunkMaps, mapAuthoringQuestionToSpec } from '../mapper/manifest-mapper';
import type { DocumentChunkMaps, MapperError, MappedQuestion } from '../mapper/manifest-mapper';
import type { CryptContent } from '../mapper/crypt-content';
import type { InvalidManifestError } from '../runtime/manifest-check';
import type { ManifestSchemaError } from '../runtime/manifest-schema';
import type { CryptManifest, FinalDoorSlotSpec, LockSlotSpec } from '../runtime/manifest-types';
import { validateManifestForPublish } from '../runtime/publish-manifest';
import type { Chunk, LockType, Result } from '../types';

/** Shape of a `samples/questions/*.json` file. Questions stay `unknown`; only selected ones are parsed. */
export interface SampleQuestionsFile {
  readonly notes: string;
  readonly status: string;
  readonly questions: readonly unknown[];
}

/** A selected sample question is absent from the file, or fails the authoring schema. */
export type SampleQuestionError =
  | { readonly kind: 'sample-question-missing'; readonly questionId: string }
  | { readonly kind: 'sample-question-invalid'; readonly questionId: string; readonly path: string };

/** A built sample crypt: manifest, learner-facing content and the document chunks it cites. */
export interface SampleCryptResult {
  readonly manifest: CryptManifest;
  readonly content: CryptContent;
  readonly chunks: ReadonlyMap<string, Chunk>;
}

/** The sample ID names no sample. The hub only offers known ones; this guards every other caller. */
export type UnknownSampleError = { readonly kind: 'unknown-sample'; readonly id: string };

export type SampleCryptError =
  | MapperError
  | SampleQuestionError
  | UnknownSampleError
  | ManifestSchemaError
  | InvalidManifestError;

export interface SlotSelection {
  readonly slotId: string;
  readonly stationType: LockType;
  readonly conceptId: string;
  readonly primaryId: string;
  /** Null when the file holds no suitable alternate. */
  readonly alternateId: string | null;
}
export interface DoorSelection {
  readonly slotId: string;
  readonly conceptId: string;
  readonly questionId: string;
}
export interface RoomLayout {
  readonly roomId: string;
  readonly slots: readonly SlotSelection[];
}
/** Fixed data for one sample: the selection is not a search. */
export interface SampleLayout {
  readonly manifestId: string;
  readonly rooms: readonly RoomLayout[];
  readonly finalDoor: readonly DoorSelection[];
  readonly conceptTitles: Readonly<Record<string, string>>;
}

function findQuestion(file: SampleQuestionsFile, questionId: string): unknown {
  return file.questions.find((q) => typeof q === 'object' && q !== null && (q as { id?: unknown }).id === questionId);
}

function load(
  file: SampleQuestionsFile,
  maps: DocumentChunkMaps,
  layout: SampleLayout,
  questionId: string,
): Result<MappedQuestion, SampleCryptError> {
  const raw = findQuestion(file, questionId);
  if (raw === undefined) return { ok: false, error: { kind: 'sample-question-missing', questionId } };
  const parsed = parseAuthoringQuestion(raw);
  if (!parsed.ok) return { ok: false, error: { kind: 'sample-question-invalid', questionId, path: parsed.error.path } };
  const question: AuthoringQuestion = parsed.value;
  // The authoring id is unique within the file, so it is the manifest question ID. The mapper does every lock type.
  return mapAuthoringQuestionToSpec(question, maps, questionId, layout.conceptTitles[question.conceptId]);
}

function record(content: CryptContent, questionId: string, mapped: MappedQuestion): void {
  content.questions[questionId] = mapped.content;
  content.concepts[mapped.concept.conceptId] = { title: mapped.concept.title };
}

/**
 * Builds a sample crypt from its notes and question file, through the core mapper only. Pure: the
 * caller reads the files. Any failure is a typed error naming the question or the failed check; no
 * partial result is ever returned.
 */
export function buildSampleFromLayout(
  layout: SampleLayout,
  notesText: string,
  file: SampleQuestionsFile,
): Result<SampleCryptResult, SampleCryptError> {
  const maps = buildDocumentChunkMaps(notesText);
  const content: CryptContent = { questions: {}, concepts: {} };
  const rooms: CryptManifest['rooms'][number][] = [];
  for (const room of layout.rooms) {
    const lockSlots: LockSlotSpec[] = [];
    for (const sel of room.slots) {
      const primary = load(file, maps, layout, sel.primaryId);
      if (!primary.ok) return primary;
      record(content, sel.primaryId, primary.value);
      let alternate: LockSlotSpec['alternateQuestion'] = null;
      if (sel.alternateId !== null) {
        const alt = load(file, maps, layout, sel.alternateId);
        if (!alt.ok) return alt;
        record(content, sel.alternateId, alt.value);
        alternate = alt.value.spec;
      }
      lockSlots.push({
        slotId: sel.slotId,
        stationType: sel.stationType,
        conceptId: sel.conceptId,
        primaryQuestion: primary.value.spec,
        alternateQuestion: alternate,
      });
    }
    rooms.push({ roomId: room.roomId, lockSlots });
  }
  const slots: FinalDoorSlotSpec[] = [];
  for (const sel of layout.finalDoor) {
    const mapped = load(file, maps, layout, sel.questionId);
    if (!mapped.ok) return mapped;
    slots.push({ slotId: sel.slotId, conceptId: sel.conceptId, question: mapped.value.spec });
    record(content, sel.questionId, mapped.value);
  }
  const owners = [
    ...rooms.flatMap((r) => r.lockSlots.map((s) => ({ conceptId: s.conceptId, questionId: s.primaryQuestion.questionId }))),
    ...slots.map((s) => ({ conceptId: s.conceptId, questionId: s.question.questionId })),
  ];
  for (const o of owners) {
    if (content.concepts[o.conceptId] === undefined) {
      return { ok: false, error: { kind: 'concept-label-missing', questionId: o.questionId, conceptId: o.conceptId } };
    }
  }
  const manifest: CryptManifest = { manifestId: layout.manifestId, rooms, finalDoor: { slots } };
  const published = validateManifestForPublish(manifest);
  if (!published.ok) return published;
  return { ok: true, value: { manifest: published.value, content, chunks: maps.chunks } };
}

/** True only when the sample file records `status === 'human-reviewed'`. A data read, never inferred. */
export function isSampleHumanReviewed(file: SampleQuestionsFile): boolean {
  return file.status === 'human-reviewed';
}
