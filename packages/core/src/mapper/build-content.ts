import type { AuthoringQuestion } from '../authoring/schema';
import { mapBoneOrderingPayload } from '../locks/bone-ordering';
import type { CryptContentExcerpt } from './crypt-content';

interface ChunkLookup {
  readonly chunksByParagraph: ReadonlyMap<number, string>;
}

export interface BuiltContent {
  readonly prompt: string;
  readonly options?: Record<string, string>;
  readonly excerpts: CryptContentExcerpt[];
  readonly explanation: string;
}

/**
 * True when every option of a séance question carries its own evidence object.
 * A guard: the schema already requires this, so it only fails on malformed input.
 */
export function everyOptionHasEvidence(input: AuthoringQuestion): boolean {
  const question: unknown = input;
  if (typeof question !== 'object' || question === null) return true;
  const q = question as { lockType?: unknown; options?: unknown };
  if (q.lockType !== 'seance-board') return true;
  const options: unknown = q.options;
  if (!Array.isArray(options)) return false;
  return options.every((o: unknown) => {
    const evidence = typeof o === 'object' && o !== null ? (o as { evidence?: unknown }).evidence : undefined;
    return typeof evidence === 'object' && evidence !== null;
  });
}

/**
 * Builds the unvalidated Crypt_Content entry. Rune questions get question-level excerpts
 * (no optionId); séance questions get one Option_Excerpt per option, in option order.
 * Paragraphs are already known to resolve when this runs.
 */
export function buildContentEntry(
  question: AuthoringQuestion,
  maps: ChunkLookup,
  questionId: string = question.id,
): BuiltContent {
  if (question.lockType === 'rune-cipher') {
    return {
      prompt: question.prompt,
      excerpts: question.evidence.map((e) => ({
        chunkId: maps.chunksByParagraph.get(e.paragraph) ?? '',
        quote: e.quote,
      })),
      explanation: question.explanation,
    };
  }
  if (question.lockType === 'bone-ordering') {
    // Step text is addressable by the same generated item IDs the payload uses.
    const { itemIds } = mapBoneOrderingPayload(questionId, question.steps).payload;
    return {
      prompt: question.prompt,
      options: Object.fromEntries(itemIds.map((id, i) => [id, question.steps[i] ?? ''])),
      excerpts: question.evidence.map((e) => ({
        chunkId: maps.chunksByParagraph.get(e.paragraph) ?? '',
        quote: e.quote,
      })),
      explanation: question.explanation,
    };
  }
  return {
    prompt: question.prompt,
    options: Object.fromEntries(question.options.map((o) => [o.id, o.text])),
    excerpts: question.options.map((o) => ({
      chunkId: maps.chunksByParagraph.get(o.evidence.paragraph) ?? '',
      quote: o.evidence.quote,
      optionId: o.id,
    })),
    explanation: question.explanation,
  };
}
