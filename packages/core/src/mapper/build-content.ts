import type { AuthoringQuestion } from '../authoring/schema';
import { mapBoneOrderingPayload } from '../locks/bone-ordering';
import { mapBoundThreadsPayload } from '../locks/bound-threads';
import { mapCursedObjectPayload } from '../locks/cursed-object';
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
  if (question.lockType === 'bound-threads') {
    // Item text is addressable by the same generated IDs the payload uses; excerpts are per pair.
    const mapped = mapBoundThreadsPayload(questionId, question.pairs);
    const { leftIds, rightIds } = mapped?.payload ?? { leftIds: [], rightIds: [] };
    return {
      prompt: question.prompt,
      options: Object.fromEntries([
        ...leftIds.map((id, i) => [id, question.pairs[i]?.left ?? ''] as const),
        ...rightIds.map((id, i) => [id, question.pairs[i]?.right ?? ''] as const),
      ]),
      excerpts: question.pairs.map((p) => ({
        chunkId: maps.chunksByParagraph.get(p.evidence.paragraph) ?? '',
        quote: p.evidence.quote,
      })),
      explanation: question.explanation,
    };
  }
  if (question.lockType === 'cursed-object') {
    // Item text is addressable by the same generated IDs the payload uses, in `items` order.
    // The category rule is part of the prompt the learner reads; the judge does not use it.
    const optionIds = mapCursedObjectPayload(questionId, question.items, question.answer)?.payload
      .optionIds ?? [];
    return {
      prompt: question.prompt,
      options: Object.fromEntries(optionIds.map((id, i) => [id, question.items[i] ?? ''])),
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
