import type {
  AuthoringQuestion,
  RuneCipherAuthoringQuestion,
  SeanceBoardAuthoringQuestion,
} from '../authoring/schema';
import { chunkDocument } from '../chunker';
import { CHECK_REGISTRY } from '../checks/registry';
import { runChecks } from '../checks/run-checks';
import type { CheckId } from '../checks/types';
import type { QuestionSpec } from '../runtime/manifest-types';
import type { Chunk, HintEffectSpec, Result } from '../types';

export type MapperError =
  | { readonly kind: 'paragraph-not-found'; readonly questionId: string; readonly paragraph: number }
  | { readonly kind: 'check-failed'; readonly questionId: string; readonly checkId: CheckId }
  | { readonly kind: 'hint-mismatch'; readonly questionId: string };

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
  return question.lockType === 'rune-cipher'
    ? question.evidence.map((e) => e.paragraph)
    : question.options.map((o) => o.evidence.paragraph);
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
