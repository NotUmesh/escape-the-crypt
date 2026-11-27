import type { AuthoringQuestion } from '../authoring/schema';
import { normaliseRuneAnswer } from '../locks/rune-cipher';
import { resolvesUniquely, type QuoteContext } from './evidence';
import type { CheckFailure } from './types';

/** `alternate-same-lock-type`: an alternate must differ in lock type from its primary. */
export function checkAlternateSameLockType(
  primary: AuthoringQuestion,
  alternate: AuthoringQuestion,
): CheckFailure[] {
  return alternate.lockType === primary.lockType
    ? [{ checkId: 'alternate-same-lock-type', questionId: alternate.id }]
    : [];
}

/**
 * `max-one-alternate`: one failure per alternate beyond the first, for the
 * questions of a single concept. Questions of other concepts are ignored.
 */
export function checkMaxOneAlternate(
  conceptId: string,
  questions: readonly AuthoringQuestion[],
): CheckFailure[] {
  const alternates = questions.filter((q) => q.conceptId === conceptId && q.role === 'alternate');
  return alternates.slice(1).map((q) => ({ checkId: 'max-one-alternate', questionId: q.id }));
}

function foldQuote(quote: string): string {
  return normaliseRuneAnswer(quote, false);
}

type Evidence = { readonly paragraph: number; readonly quote: string };

/**
 * The uniquely resolved quotes that carry the answer; falls back to every
 * resolved quote when none can be singled out.
 */
function answerBearingQuotes(q: AuthoringQuestion, context: QuoteContext): string[] {
  if (q.lockType === 'rune-cipher') {
    const resolved = q.evidence.filter((e) => resolvesUniquely(context, e));
    const answer = normaliseRuneAnswer(q.answer, q.caseSensitive);
    const bearing = resolved.filter((e) =>
      normaliseRuneAnswer(e.quote, q.caseSensitive).includes(answer),
    );
    return (bearing.length > 0 ? bearing : resolved).map((e) => e.quote);
  }
  // bone-ordering: no answer-bearing quote of its own; its checks arrive in task 29.2.
  if (q.lockType === 'bone-ordering') return q.evidence.filter((e) => resolvesUniquely(context, e)).map((e) => e.quote);
  const key = q.options.filter((o) => o.id === q.answer || o.text === q.answer);
  return (key.length > 0 ? key : q.options)
    .map((o) => o.evidence as Evidence)
    .filter((e) => resolvesUniquely(context, e))
    .map((e) => e.quote);
}

function allQuotes(q: AuthoringQuestion, context: QuoteContext): string[] {
  const evidence: readonly Evidence[] =
    q.lockType === 'seance-board' ? q.options.map((o) => o.evidence) : q.evidence;
  return evidence.filter((e) => resolvesUniquely(context, e)).map((e) => e.quote);
}

/**
 * Advisory `alternate-off-concept`: the alternate's answer-bearing quote is not
 * among the concept's own quotes (those of the primary). Never rejects a question.
 * Reads only uniquely resolved quotes; if either side has none, the check does not run.
 */
export function checkAlternateOffConcept(
  primary: AuthoringQuestion,
  alternate: AuthoringQuestion,
  context: QuoteContext,
): CheckFailure[] {
  const own = allQuotes(primary, context).map(foldQuote);
  const bearing = answerBearingQuotes(alternate, context).map(foldQuote);
  if (own.length === 0 || bearing.length === 0) return [];
  const onConcept = bearing.some((quote) => own.some((o) => o.includes(quote) || quote.includes(o)));
  return onConcept ? [] : [{ checkId: 'alternate-off-concept', questionId: alternate.id }];
}

/** All three alternate checks for one concept's primary and alternate. */
export function checkAlternate(
  primary: AuthoringQuestion,
  alternate: AuthoringQuestion,
  context: QuoteContext,
): CheckFailure[] {
  return [
    ...checkAlternateSameLockType(primary, alternate),
    ...checkAlternateOffConcept(primary, alternate, context),
  ];
}