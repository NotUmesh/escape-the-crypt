import type { BoundThreadsAuthoringQuestion } from '../authoring/schema';
import { checkQuote, type QuoteContext } from '../checks/evidence';
import type { CheckFailure } from '../checks/types';
import { normaliseWithMap } from '../normalise';

export const MIN_PAIRS = 3;
export const MAX_PAIRS = 4;

type PairsInput = Pick<BoundThreadsAuthoringQuestion, 'id'> & {
  readonly pairs: readonly { readonly left: string; readonly right: string }[];
};

function key(text: string): string {
  return normaliseWithMap(text).text.toLowerCase();
}

function hasRepeat(texts: readonly string[]): boolean {
  const keys = texts.map(key);
  return new Set(keys).size !== keys.length;
}

/** `pair-count`: 3 to 4 pairs. */
export function checkPairCount(question: PairsInput): readonly CheckFailure[] {
  const n = question.pairs.length;
  return n < MIN_PAIRS || n > MAX_PAIRS ? [{ checkId: 'pair-count', questionId: question.id }] : [];
}

/** `not-one-to-one`: a left or right text repeated after case and whitespace normalisation. */
export function checkNotOneToOne(question: PairsInput): readonly CheckFailure[] {
  return hasRepeat(question.pairs.map((p) => p.left)) || hasRepeat(question.pairs.map((p) => p.right))
    ? [{ checkId: 'not-one-to-one', questionId: question.id }]
    : [];
}

/** All bound-threads Code_Checks plus each pair's own quote checks. Pure; never throws. */
export function boundThreadsChecks(
  question: BoundThreadsAuthoringQuestion,
  context: QuoteContext,
): readonly CheckFailure[] {
  const failures: CheckFailure[] = [];
  for (const p of question.pairs) {
    const failure = checkQuote(
      context.chunks,
      { paragraphChunkId: context.paragraphChunkIds.get(p.evidence.paragraph) ?? '', quote: p.evidence.quote },
      question.id,
    );
    if (failure) failures.push(failure);
  }
  failures.push(...checkPairCount(question), ...checkNotOneToOne(question));
  return failures;
}
