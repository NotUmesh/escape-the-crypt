import type { RuneCipherAuthoringQuestion } from '../authoring/schema';
import { resolvesUniquely, type QuoteContext } from '../checks/evidence';
import type { CheckFailure } from '../checks/types';
import { normaliseRuneAnswer } from './rune-cipher';

const BLANK_RUN = /_{3,}/g;

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Exactly one run of 3+ underscores in the prompt. */
export function checkRuneNeedsOneBlank(q: RuneCipherAuthoringQuestion): CheckFailure[] {
  const blanks = q.prompt.match(BLANK_RUN) ?? [];
  return blanks.length === 1 ? [] : [{ checkId: 'rune-needs-one-blank', questionId: q.id }];
}

/**
 * The normalised answer must appear in at least one normalised evidence quote.
 * Aliases are exempt: valid synonyms are often not copied from the notes.
 * Only quotes that resolved uniquely are read. If none did, the check does not
 * run: the quote failure already blocks.
 */
export function checkAnswerInQuote(
  q: RuneCipherAuthoringQuestion,
  context: QuoteContext,
): CheckFailure[] {
  const resolved = q.evidence.filter((e) => resolvesUniquely(context, e));
  if (resolved.length === 0) return [];
  const answer = normaliseRuneAnswer(q.answer, q.caseSensitive);
  const found = resolved.some((e) =>
    normaliseRuneAnswer(e.quote, q.caseSensitive).includes(answer),
  );
  return found ? [] : [{ checkId: 'answer-not-in-quote', questionId: q.id }];
}

/** The answer must not appear, on word boundaries, in the prompt with the blank removed. */
export function checkAnswerLeakInPrompt(q: RuneCipherAuthoringQuestion): CheckFailure[] {
  const answer = normaliseRuneAnswer(q.answer, q.caseSensitive);
  if (answer === '') return [];
  const visible = normaliseRuneAnswer(q.prompt.replace(BLANK_RUN, ' '), q.caseSensitive);
  const pattern = new RegExp(`(^|\\W)${escapeRegExp(answer)}(\\W|$)`);
  return pattern.test(visible) ? [{ checkId: 'answer-leak-in-prompt', questionId: q.id }] : [];
}

/** Runs the three rune cipher checks in Requirement 5 order. */
export function runeCipherChecks(
  q: RuneCipherAuthoringQuestion,
  context: QuoteContext,
): CheckFailure[] {
  return [
    ...checkRuneNeedsOneBlank(q),
    ...checkAnswerInQuote(q, context),
    ...checkAnswerLeakInPrompt(q),
  ];
}
