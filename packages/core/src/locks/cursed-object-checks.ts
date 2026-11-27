import type { CursedObjectAuthoringQuestion } from '../authoring/schema';
import { checkQuote, resolvesUniquely, type QuoteContext } from '../checks/evidence';
import type { CheckFailure } from '../checks/types';
import { normaliseWithMap } from '../normalise';

export const ITEM_COUNT = 4;
export const MIN_CATEGORY_RULE_LENGTH = 10;

type ItemsInput = Pick<CursedObjectAuthoringQuestion, 'id' | 'items'>;

function norm(text: string): string {
  return normaliseWithMap(text).text.toLowerCase();
}

/** `item-count`: exactly 4 items. */
export function checkItemCount(question: ItemsInput): readonly CheckFailure[] {
  return question.items.length === ITEM_COUNT ? [] : [{ checkId: 'item-count', questionId: question.id }];
}

/** `answer-not-an-item`: the answer must equal one of the items verbatim. */
export function checkAnswerNotAnItem(
  question: Pick<CursedObjectAuthoringQuestion, 'id' | 'items' | 'answer'>,
): readonly CheckFailure[] {
  return question.items.includes(question.answer)
    ? []
    : [{ checkId: 'answer-not-an-item', questionId: question.id }];
}

/** `missing-category-rule`: the category rule must be real prose, not empty or a placeholder. */
export function checkMissingCategoryRule(
  question: Pick<CursedObjectAuthoringQuestion, 'id' | 'categoryRule'>,
): readonly CheckFailure[] {
  return question.categoryRule.trim().length >= MIN_CATEGORY_RULE_LENGTH
    ? []
    : [{ checkId: 'missing-category-rule', questionId: question.id }];
}

/** Wording that places something outside a group (negation or contrast). */
const OUTSIDE_MARKER = /\b(?:not|isn't|aren't|doesn't|don't|wasn't|weren't|never|unlike|rather than|outside|instead)\b/i;

const STOP_WORDS = new Set([
  'the', 'and', 'for', 'are', 'was', 'were', 'has', 'have', 'had', 'with', 'that', 'this', 'these', 'those',
  'from', 'into', 'its', 'their', 'there', 'than', 'but', 'you', 'who', 'which', 'what', 'all', 'any', 'can',
]);

function stem(word: string): string {
  return word.length > 3 ? word.replace(/s$/, '') : word;
}

/** Content words (length > 2, no stop words), lower-cased and with a trailing plural "s" removed. */
function contentWords(text: string): string[] {
  return (norm(text).match(/[a-z0-9]+(?:['-][a-z0-9]+)*/g) ?? [])
    .filter((w) => w.length > 2 && !STOP_WORDS.has(w))
    .map(stem);
}

/**
 * `needs-category-and-outside-quotes` (a conservative heuristic over resolved quotes only).
 *
 * What it implements, exactly:
 *  - Only quotes that resolve uniquely are read; others are ignored (they already fail a
 *    quote check).
 *  - A CATEGORY quote is a resolved quote that either contains at least one of the three
 *    non-odd items, or whose content words are at least half found in `categoryRule`
 *    (so "The crew had three astronauts." counts when the rule restates it). It
 *    establishes the category rule and/or covers the non-odd items.
 *  - An OUTSIDE quote is a resolved quote that contains an exclusion marker
 *    (not, isn't, unlike, rather than, outside, instead, never, ...) or the odd item's text.
 *  - The question passes only if some category quote and some OUTSIDE quote are two
 *    DIFFERENT evidence entries (one quote cannot serve both roles).
 *
 * It deliberately does NOT require the odd item's text to appear in the quotes: whether
 * the notes explicitly place the odd item outside the category is judged by the blind
 * review (adv-20, whose quotes never mention "Moths", must pass this code stage and is
 * rejected at review as `odd-item-not-explicitly-outside`). This check only rejects
 * questions whose evidence has no category quote or no separate exclusion/odd-item quote.
 */
export function checkNeedsCategoryAndOutsideQuotes(
  question: CursedObjectAuthoringQuestion,
  context: QuoteContext,
): readonly CheckFailure[] {
  const quotes = question.evidence.filter((e) => resolvesUniquely(context, e)).map((e) => e.quote);
  const odd = norm(question.answer);
  const others = question.items.filter((i) => i !== question.answer).map(norm);
  const ruleWords = new Set(contentWords(question.categoryRule));

  const isCategory = (quote: string): boolean => {
    const text = norm(quote);
    if (others.some((o) => o.length > 0 && text.includes(o))) return true;
    const words = contentWords(quote);
    return words.length > 0 && words.filter((w) => ruleWords.has(w)).length * 2 >= words.length;
  };
  const isOutside = (quote: string): boolean =>
    OUTSIDE_MARKER.test(norm(quote)) || (odd.length > 0 && norm(quote).includes(odd));

  const ok = quotes.some((c, i) => isCategory(c) && quotes.some((o, j) => j !== i && isOutside(o)));
  return ok ? [] : [{ checkId: 'needs-category-and-outside-quotes', questionId: question.id }];
}

/** All cursed-object Code_Checks plus each evidence quote's own checks. Pure; never throws. */
export function cursedObjectChecks(
  question: CursedObjectAuthoringQuestion,
  context: QuoteContext,
): readonly CheckFailure[] {
  const failures: CheckFailure[] = [];
  for (const e of question.evidence) {
    const failure = checkQuote(
      context.chunks,
      { paragraphChunkId: context.paragraphChunkIds.get(e.paragraph) ?? '', quote: e.quote },
      question.id,
    );
    if (failure) failures.push(failure);
  }
  failures.push(
    ...checkItemCount(question),
    ...checkAnswerNotAnItem(question),
    ...checkMissingCategoryRule(question),
    ...checkNeedsCategoryAndOutsideQuotes(question, context),
  );
  return failures;
}
