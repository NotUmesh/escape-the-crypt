import type { CryptContentEntry } from '../mapper/crypt-content';
import { normaliseWithMap } from '../normalise';
import { CursedObjectPayloadSchema, RuneCipherPayloadSchema, SeanceBoardPayloadSchema } from '../runtime/manifest-schema';
import type { QuestionSpec } from '../runtime/manifest-types';
import type { CheckFailure } from './types';

const LEADING_ARTICLE = /^(?:a|an|the) /;
const NOT_LETTER_OR_DIGIT = /[^\p{L}\p{N}]+/gu;

/**
 * Comparison key for an answer: quote and ligature folding (normaliseWithMap), case folded,
 * every run of punctuation or space turned into one space, then one leading article removed.
 * "A booster." and "booster" give the same key; "well-known" and "well known" do too.
 */
export function answerKey(text: string): string {
  const folded = normaliseWithMap(text).text.toLowerCase();
  return folded.replace(NOT_LETTER_OR_DIGIT, ' ').trim().replace(LEADING_ARTICLE, '');
}

const keysFrom = (raw: readonly string[]): readonly string[] =>
  [...new Set(raw.map(answerKey).filter((key) => key !== ''))];

/** The minimal authoring shape the keys need: rune answer and aliases, séance key option text. */
export type AnswerBearing =
  | { readonly lockType: 'rune-cipher'; readonly answer: string; readonly aliases: readonly string[] }
  | {
      readonly lockType: 'seance-board';
      readonly answer: string;
      readonly options: readonly { readonly id: string; readonly text: string }[];
    }
  | { readonly lockType: 'cursed-object'; readonly answer: string; readonly items: readonly string[] }
  | { readonly lockType: string };

/** Answer keys of an authoring question: what a learner can give as its answer. */
export function answerKeysOfAuthoring(question: AnswerBearing): readonly string[] {
  if (question.lockType === 'rune-cipher' && 'aliases' in question) {
    return keysFrom([question.answer, ...question.aliases]);
  }
  if (question.lockType === 'seance-board' && 'options' in question) {
    return keysFrom(question.options.filter((o) => o.id === question.answer).map((o) => o.text));
  }
  if (question.lockType === 'cursed-object' && 'items' in question) {
    return keysFrom([question.answer]);
  }
  return [];
}

/** Answer keys of a published question. A payload or entry that does not parse gives no keys. */
export function answerKeysOf(spec: QuestionSpec, content: CryptContentEntry | undefined): readonly string[] {
  if (spec.lockType === 'rune-cipher') {
    const parsed = RuneCipherPayloadSchema.safeParse(spec.payload);
    return parsed.success ? keysFrom([parsed.data.answer, ...parsed.data.aliases]) : [];
  }
  if (spec.lockType === 'seance-board') {
    const parsed = SeanceBoardPayloadSchema.safeParse(spec.payload);
    const text = parsed.success ? content?.options?.[parsed.data.keyOptionId] : undefined;
    return text === undefined ? [] : keysFrom([text]);
  }
  if (spec.lockType === 'cursed-object') {
    const parsed = CursedObjectPayloadSchema.safeParse(spec.payload);
    const text = parsed.success ? content?.options?.[parsed.data.oddOneOutId] : undefined;
    return text === undefined ? [] : keysFrom([text]);
  }
  return [];
}

export interface KeyedAnswer {
  readonly conceptId: string;
  readonly questionId: string;
  readonly keys: readonly string[];
}

/**
 * Duplicate-answer scan over one crypt: fails with `duplicate-answer-in-room` for each question
 * that shares an answer key with a question of ANOTHER concept. A concept's primary and its own
 * alternate ask about the same thing and may share an answer, as in the Leak_Scan. Pure.
 */
export function duplicateAnswerScan(entries: readonly KeyedAnswer[]): readonly CheckFailure[] {
  const failures: CheckFailure[] = [];
  for (const entry of entries) {
    const clash = entries.some(
      (other) => other.conceptId !== entry.conceptId && other.keys.some((k) => entry.keys.includes(k)),
    );
    if (clash) failures.push({ checkId: 'duplicate-answer-in-room', questionId: entry.questionId });
  }
  return failures;
}

/** Keyed entry for a published question. */
export function keyedSpec(
  conceptId: string,
  spec: QuestionSpec,
  content: CryptContentEntry | undefined,
): KeyedAnswer {
  return { conceptId, questionId: spec.questionId, keys: answerKeysOf(spec, content) };
}
