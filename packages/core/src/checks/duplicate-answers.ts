import type { CryptContentEntry } from '../mapper/crypt-content';
import { normaliseWithMap } from '../normalise';
import { CombinationDialPayloadSchema, CursedObjectPayloadSchema, RuneCipherPayloadSchema, SeanceBoardPayloadSchema } from '../runtime/manifest-schema';
import type { QuestionSpec } from '../runtime/manifest-types';
import { computeTemplate, isAllowedTemplate } from '../locks/combination-dial-checks';
import type { CheckFailure } from './types';

const LEADING_ARTICLE = /^(?:(?:a|an|the) )+/;
const NOT_LETTER_OR_DIGIT = /[^\p{L}\p{N}]+/gu;

/**
 * Comparison key for an answer: quote and ligature folding (normaliseWithMap), case folded,
 * every run of punctuation or space turned into one space, then every leading article removed
 * (repeated until none is left, so the key is idempotent: "A A 0" gives "0").
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
  | { readonly lockType: 'combination-dial'; readonly answer: unknown; readonly units: string }
  | { readonly lockType: string };

/** Canonical number text: finite only, -0 as 0, float noise from template maths rounded away. */
function numberText(n: unknown): string | null {
  if (typeof n !== 'number' || !Number.isFinite(n)) return null;
  const rounded = Number(n.toFixed(9));
  return String(Object.is(rounded, -0) ? 0 : rounded);
}

/** One dial key: "value unit" or "low-high unit". Null when the number or unit is unusable. */
function dialKey(value: string | null, unit: unknown): readonly string[] {
  if (value === null || typeof unit !== 'string' || unit.trim() === '') return [];
  return [`${value} ${unit.trim().toLowerCase()}`];
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Key of an authoring dial answer. A template uses the value code recomputes, not the authored one. */
function dialAuthoringKeys(answer: unknown, units: unknown): readonly string[] {
  if (!isRecord(answer)) return [];
  if (answer['kind'] === 'exact') return dialKey(numberText(answer['value']), units);
  if (answer['kind'] === 'range') {
    const lo = numberText(answer['min']);
    const hi = numberText(answer['max']);
    return lo === null || hi === null ? [] : dialKey(`${lo}-${hi}`, units);
  }
  if (answer['kind'] === 'template') {
    const { template, inputs } = answer;
    if (!isAllowedTemplate(template) || !Array.isArray(inputs) || !inputs.every((n) => typeof n === 'number')) return [];
    return dialKey(numberText(computeTemplate(template, inputs)), units);
  }
  return [];
}

/** Key of a published dial payload. Tolerance is not valid in a manifest, so it has no key. */
function dialPublishedKeys(payload: unknown): readonly string[] {
  const parsed = CombinationDialPayloadSchema.safeParse(payload);
  if (!parsed.success) return [];
  const d = parsed.data;
  if (d.kind === 'exact') return dialKey(numberText(d.exactValue), d.unit);
  const lo = numberText(d.min);
  const hi = numberText(d.max);
  return lo === null || hi === null ? [] : dialKey(`${lo}-${hi}`, d.unit);
}

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
  if (question.lockType === 'combination-dial' && 'units' in question) {
    return dialAuthoringKeys(question.answer, question.units);
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
  if (spec.lockType === 'combination-dial') return dialPublishedKeys(spec.payload);
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
