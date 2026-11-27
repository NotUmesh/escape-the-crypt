import { parseAuthoringQuestion } from '../authoring/parse';
import type {
  AuthoringQuestion,
  RuneCipherAuthoringQuestion,
  SeanceBoardAuthoringQuestion,
} from '../authoring/schema';
import { chunkDocument } from '../chunker';
import { CHECK_REGISTRY } from '../checks/registry';
import { runChecks } from '../checks/run-checks';
import type { CheckId } from '../checks/types';
import { mapBoneOrderingPayload } from '../locks/bone-ordering';
import { mapBoundThreadsPayload } from '../locks/bound-threads';
import { mapCursedObjectPayload } from '../locks/cursed-object';
import type { QuestionSpec } from '../runtime/manifest-types';
import type { Chunk, HintEffectSpec, Result } from '../types';
import { buildContentEntry, everyOptionHasEvidence } from './build-content';
import { parseCryptContentEntry, type CryptContentEntry } from './crypt-content';

export type MapperError =
  | { readonly kind: 'paragraph-not-found'; readonly questionId: string; readonly paragraph: number }
  | { readonly kind: 'check-failed'; readonly questionId: string; readonly checkId: CheckId }
  | { readonly kind: 'hint-mismatch'; readonly questionId: string }
  | { readonly kind: 'option-evidence-missing'; readonly questionId: string; readonly conceptId: string }
  | { readonly kind: 'content-schema-invalid'; readonly questionId: string; readonly conceptId: string }
  | { readonly kind: 'concept-label-missing'; readonly questionId: string; readonly conceptId: string }
  /** A missing or mistyped field broke a check, hint or content read. `conceptId` is '' when unreadable. */
  | { readonly kind: 'authoring-schema-invalid'; readonly questionId: string; readonly conceptId: string };

/** Reads `conceptId` from an unvalidated value without throwing. */
function readConceptId(value: unknown): string {
  try {
    if (typeof value !== 'object' || value === null) return '';
    const id = (value as { conceptId?: unknown }).conceptId;
    return typeof id === 'string' ? id : '';
  } catch {
    return '';
  }
}

/** One mapped question: the manifest spec, its learner-facing content and its concept title. */
export interface MappedQuestion {
  readonly spec: QuestionSpec;
  readonly content: CryptContentEntry;
  readonly concept: { readonly conceptId: string; readonly title: string };
}

/** Chunk lookups for one document, built once. */
export interface DocumentChunkMaps {
  readonly chunks: ReadonlyMap<string, Chunk>;
  /** Paragraph number -> ID of the first chunk at that paragraph number. */
  readonly chunksByParagraph: ReadonlyMap<number, string>;
}

/** Chunks pasted text with `chunkDocument`. The first chunk wins for a paragraph number. */
export function buildDocumentChunkMaps(text: string): DocumentChunkMaps {
  const chunks = new Map<string, Chunk>();
  const chunksByParagraph = new Map<number, string>();
  for (const chunk of chunkDocument({ sourceType: 'paste', text, originalText: text })) {
    chunks.set(chunk.id, chunk);
    if (chunk.location.sourceType !== 'paste') continue;
    const n = chunk.location.paragraphNumber;
    if (!chunksByParagraph.has(n)) chunksByParagraph.set(n, chunk.id);
  }
  return { chunks, chunksByParagraph };
}

const BLOCKING_IDS: ReadonlySet<CheckId> = new Set(
  CHECK_REGISTRY.filter((r) => r.severity === 'blocking').map((r) => r.id),
);

function evidenceParagraphs(question: AuthoringQuestion): readonly number[] {
  switch (question.lockType) {
    case 'seance-board':
      return question.options.map((o) => o.evidence.paragraph);
    case 'bound-threads':
      return question.pairs.map((p) => p.evidence.paragraph);
    case 'rune-cipher':
    case 'bone-ordering':
    case 'cursed-object':
      return question.evidence.map((e) => e.paragraph);
  }
}

function runeHint(
  question: RuneCipherAuthoringQuestion,
): Extract<HintEffectSpec, { kind: 'reveal-first-letter' }> | null {
  const letters = Array.from(question.answer.trim());
  const firstLetter = letters[0];
  if (firstLetter === undefined) return null;
  const hint = { kind: 'reveal-first-letter', firstLetter, length: letters.length } as const;
  const given = question.hint;
  if (given && (given.firstLetter !== hint.firstLetter || given.length !== hint.length)) return null;
  return hint;
}

/**
 * An accepted séance question has exactly one supported option and at least three options, so
 * it always has at least two contradicted ones. The hint removes the first, in authoring order.
 * `undefined` only satisfies the type checker; blocking checks make it unreachable.
 */
function seanceHint(
  question: SeanceBoardAuthoringQuestion,
): Extract<HintEffectSpec, { kind: 'remove-option' }> | undefined {
  const option = question.options.find((o) => o.label === 'contradicted');
  return option ? { kind: 'remove-option', optionId: option.id } : undefined;
}

/**
 * Maps one authoring question to a QuestionSpec. Pure and total: any problem is a typed
 * MapperError and no partial QuestionSpec is produced. Blocking Code_Checks are re-run here.
 * `chunks` and `chunksByParagraph` come from `buildDocumentChunkMaps`.
 */
export function mapAuthoringQuestionToSpec(
  input: AuthoringQuestion,
  maps: DocumentChunkMaps,
  questionId: string,
  conceptTitle: string | undefined,
): Result<MappedQuestion, MapperError> {
  const conceptId = readConceptId(input);
  if (typeof conceptTitle !== 'string' || conceptTitle.trim() === '') {
    return { ok: false, error: { kind: 'concept-label-missing', questionId, conceptId } };
  }
  if (!everyOptionHasEvidence(input)) {
    return { ok: false, error: { kind: 'option-evidence-missing', questionId, conceptId } };
  }
  // The type says the question is valid, but callers can hand over anything. A malformed
  // question that reaches a check, hint or content read and breaks it is reported as
  // `authoring-schema-invalid`; problems the existing guards find keep their own kinds.
  const invalid: Result<MappedQuestion, MapperError> = {
    ok: false,
    error: { kind: 'authoring-schema-invalid', questionId, conceptId },
  };
  try {
    const result = mapValidated(input, maps, questionId, conceptId, conceptTitle);
    // A question the schema rejects never maps, even if every read happened to succeed.
    if (result.ok && !parseAuthoringQuestion(input as unknown).ok) return invalid;
    return result;
  } catch {
    return invalid;
  }
}

function mapValidated(
  question: AuthoringQuestion,
  maps: DocumentChunkMaps,
  questionId: string,
  conceptId: string,
  conceptTitle: string,
): Result<MappedQuestion, MapperError> {
  const specResult = mapSpec(question, maps, questionId);
  if (!specResult.ok) return specResult;
  const spec = specResult.value;

  const entry = buildContentEntry(question, maps, questionId);
  const parsed = parseCryptContentEntry(questionId, entry);
  if (!parsed.ok) {
    return { ok: false, error: { kind: 'content-schema-invalid', questionId, conceptId } };
  }
  // evidenceRefs come from the same excerpts as the content.
  const evidenceRefs = [...new Set(parsed.value.excerpts.map((e) => e.chunkId))];
  return {
    ok: true,
    value: {
      spec: { ...spec, evidenceRefs },
      content: parsed.value,
      concept: { conceptId, title: conceptTitle },
    },
  };
}

function mapSpec(
  question: AuthoringQuestion,
  maps: DocumentChunkMaps,
  questionId: string,
): Result<QuestionSpec, MapperError> {
  const resolved: string[] = [];
  for (const paragraph of evidenceParagraphs(question)) {
    const chunkId = maps.chunksByParagraph.get(paragraph);
    if (chunkId === undefined) {
      return { ok: false, error: { kind: 'paragraph-not-found', questionId, paragraph } };
    }
    resolved.push(chunkId);
  }

  const failures = runChecks({
    question,
    chunks: maps.chunks,
    paragraphChunkIds: maps.chunksByParagraph,
  });
  const blocking = failures.find((f) => BLOCKING_IDS.has(f.checkId));
  if (blocking) {
    return { ok: false, error: { kind: 'check-failed', questionId, checkId: blocking.checkId } };
  }

  const evidenceRefs = [...new Set(resolved)];

  if (question.lockType === 'rune-cipher') {
    const hintEffect = runeHint(question);
    if (hintEffect === null) return { ok: false, error: { kind: 'hint-mismatch', questionId } };
    return {
      ok: true,
      value: {
        questionId,
        lockType: 'rune-cipher',
        payload: {
          answer: question.answer,
          aliases: [...question.aliases],
          caseSensitive: question.caseSensitive,
        },
        evidenceRefs,
        hintEffect,
      },
    };
  }

  if (question.lockType === 'bone-ordering') {
    // An authored hint that disagrees with keyOrder[0] is rejected, not overridden.
    const mapped = mapBoneOrderingPayload(questionId, question.steps, question.hint?.boneId);
    if (mapped === null) return { ok: false, error: { kind: 'hint-mismatch', questionId } };
    return {
      ok: true,
      value: {
        questionId,
        lockType: 'bone-ordering',
        payload: mapped.payload,
        evidenceRefs,
        hintEffect: mapped.hintEffect,
      },
    };
  }
  if (question.lockType === 'bound-threads') {
    // An authored hint that disagrees with the authored pairs is rejected, not overridden.
    const mapped = mapBoundThreadsPayload(questionId, question.pairs, question.hint?.pair);
    if (mapped === null) return { ok: false, error: { kind: 'hint-mismatch', questionId } };
    return {
      ok: true,
      value: {
        questionId,
        lockType: 'bound-threads',
        payload: mapped.payload,
        evidenceRefs,
        hintEffect: mapped.hintEffect,
      },
    };
  }
  if (question.lockType === 'cursed-object') {
    // The hint is chosen in code (first non-odd item); there is no authored hint field.
    const mapped = mapCursedObjectPayload(questionId, question.items, question.answer);
    if (mapped === null) return { ok: false, error: { kind: 'hint-mismatch', questionId } };
    return {
      ok: true,
      value: {
        questionId,
        lockType: 'cursed-object',
        payload: mapped.payload,
        evidenceRefs,
        hintEffect: mapped.hintEffect,
      },
    };
  }
  const hintEffect = seanceHint(question);
  if (hintEffect === undefined) {
    return { ok: false, error: { kind: 'check-failed', questionId, checkId: 'not-exactly-one-supported' } };
  }
  return {
    ok: true,
    value: {
      questionId,
      lockType: 'seance-board',
      payload: { optionIds: question.options.map((o) => o.id), keyOptionId: question.answer },
      evidenceRefs,
      hintEffect,
    },
  };
}
