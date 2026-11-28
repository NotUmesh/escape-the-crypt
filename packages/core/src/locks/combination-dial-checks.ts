import type { CombinationDialAuthoringQuestion } from '../authoring/schema';
import { checkQuote, resolvesUniquely, type QuoteContext } from '../checks/evidence';
import type { CheckFailure } from '../checks/types';

/**
 * Every check here accepts raw, pre-schema input (typed as the authoring question for callers):
 * the authoring schema's closed template enum and strict objects reject some adversarial shapes
 * (an unlisted template, an `expression` key) before a Code_Check could name them. Fields are
 * therefore read defensively, and a malformed field fails the relevant check instead of throwing.
 */
type Q = CombinationDialAuthoringQuestion;

/** The two-entry template allowlist. Values are computed in code only, never by the model. */
export const ALLOWED_TEMPLATES = ['difference', 'percent-change'] as const;

export type DialTemplate = (typeof ALLOWED_TEMPLATES)[number];

export function isAllowedTemplate(template: unknown): template is DialTemplate {
  return typeof template === 'string' && (ALLOWED_TEMPLATES as readonly string[]).includes(template);
}

/**
 * `difference(a, b)` is a - b. `percent-change(from, to)` is (to - from) / from * 100.
 * Returns null for the wrong input count, non-finite inputs, or a percent change from zero.
 */
export function computeTemplate(template: DialTemplate, inputs: readonly number[]): number | null {
  if (inputs.length !== 2) return null;
  const [a, b] = inputs;
  if (a === undefined || b === undefined || !Number.isFinite(a) || !Number.isFinite(b)) return null;
  if (template === 'difference') return a - b;
  if (a === 0) return null;
  return ((b - a) / a) * 100;
}

const NUMBER_WORDS: Readonly<Record<string, number>> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17,
  eighteen: 18, nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70,
  eighty: 80, ninety: 90,
};

// A digit token: optional sign (not glued to a preceding word character, so "7-10" is 7 and 10),
// thousands groups ("150,000") or plain digits, optional decimals. Trailing "." is not a decimal.
const NUMBER_TOKEN = /(?<![\w.])[-\u2212]?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?/g;
const WORD_TOKEN = new RegExp(`\\b(?:${Object.keys(NUMBER_WORDS).join('|')})\\b`, 'gi');

function numbersIn(quote: string): number[] {
  const out: number[] = [];
  for (const token of quote.match(NUMBER_TOKEN) ?? []) {
    out.push(Number(token.replace(/,/g, '').replace('\u2212', '-')));
  }
  for (const word of quote.match(WORD_TOKEN) ?? []) {
    const n = NUMBER_WORDS[word.toLowerCase()];
    if (n !== undefined) out.push(n);
  }
  return out;
}

/**
 * True when `n` is stated in `quote` as a whole number token, after thousands-separator
 * normalisation ("150,000" matches 150000) or as a written-out number word ("two" matches 2).
 * "970" never matches 97. Never throws.
 */
export function numberAppearsVerbatim(quote: string, n: number): boolean {
  if (typeof quote !== 'string' || typeof n !== 'number' || !Number.isFinite(n)) return false;
  return numbersIn(quote).some((m) => m === n);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function answerOf(q: Q): Record<string, unknown> {
  const answer: unknown = (q as unknown as { answer?: unknown }).answer;
  return isRecord(answer) ? answer : {};
}

function evidenceOf(q: Q): readonly { readonly paragraph: number; readonly quote: string }[] {
  const evidence: unknown = (q as unknown as { evidence?: unknown }).evidence;
  if (!Array.isArray(evidence)) return [];
  return evidence.filter(
    (e): e is { paragraph: number; quote: string } =>
      isRecord(e) && typeof e['paragraph'] === 'number' && typeof e['quote'] === 'string',
  );
}

/** Quotes that resolve uniquely; a quote that does not resolve is reported by its own quote check. */
function resolvedQuotes(q: Q, context: QuoteContext): string[] {
  return evidenceOf(q).filter((e) => resolvesUniquely(context, e)).map((e) => e.quote);
}

const fail = (checkId: CheckFailure['checkId'], q: Q): readonly CheckFailure[] => [{ checkId, questionId: q.id }];

/** `missing-units`: units must be non-blank ("(no units)" is a valid literal). */
export function checkMissingUnits(q: Q): readonly CheckFailure[] {
  const units: unknown = (q as unknown as { units?: unknown }).units;
  return typeof units === 'string' && units.trim() !== '' ? [] : fail('missing-units', q);
}

/**
 * `units-reveal-number`: the units are shown next to the dial, so they must not
 * carry a number (for example answer 20 with units "July 20").
 */
export function checkUnitsRevealNumber(q: Q): readonly CheckFailure[] {
  const units: unknown = (q as unknown as { units?: unknown }).units;
  return typeof units === 'string' && /[0-9]/.test(units) ? fail('units-reveal-number', q) : [];
}

/** `number-not-in-quote`: an exact answer must appear verbatim in a resolved quote. */
export function checkNumberNotInQuote(q: Q, context: QuoteContext): readonly CheckFailure[] {
  const answer = answerOf(q);
  if (answer['kind'] !== 'exact') return [];
  const value = answer['value'];
  const quotes = resolvedQuotes(q, context);
  return typeof value === 'number' && quotes.some((quote) => numberAppearsVerbatim(quote, value))
    ? []
    : fail('number-not-in-quote', q);
}

/**
 * `range-not-in-quote`: both endpoints must appear verbatim in one resolved quote (a stated range),
 * and min must not exceed max (a reversed range could never be answered).
 */
export function checkRangeNotInQuote(q: Q, context: QuoteContext): readonly CheckFailure[] {
  const answer = answerOf(q);
  if (answer['kind'] !== 'range') return [];
  const { min, max } = answer;
  if (typeof min !== 'number' || typeof max !== 'number' || min > max) return fail('range-not-in-quote', q);
  const ok = resolvedQuotes(q, context).some((quote) => numberAppearsVerbatim(quote, min) && numberAppearsVerbatim(quote, max));
  return ok ? [] : fail('range-not-in-quote', q);
}

/** `template-not-allowlisted`: only `difference` and `percent-change` exist. */
export function checkTemplateNotAllowlisted(q: Q): readonly CheckFailure[] {
  const answer = answerOf(q);
  if (answer['kind'] !== 'template') return [];
  return isAllowedTemplate(answer['template']) ? [] : fail('template-not-allowlisted', q);
}

/** `template-input-not-in-quote`: each template input must appear verbatim in a resolved quote. */
export function checkTemplateInputNotInQuote(q: Q, context: QuoteContext): readonly CheckFailure[] {
  const answer = answerOf(q);
  if (answer['kind'] !== 'template') return [];
  const inputs = answer['inputs'];
  if (!Array.isArray(inputs) || inputs.length === 0) return fail('template-input-not-in-quote', q);
  const quotes = resolvedQuotes(q, context);
  const ok = inputs.every((n) => typeof n === 'number' && quotes.some((quote) => numberAppearsVerbatim(quote, n)));
  return ok ? [] : fail('template-input-not-in-quote', q);
}

/**
 * `template-value-mismatch`: recomputes the value with `computeTemplate`; the model's `value` is
 * only a claim. Silent for a template that is not allowlisted (that has its own check).
 */
export function checkTemplateValueMismatch(q: Q): readonly CheckFailure[] {
  const answer = answerOf(q);
  if (answer['kind'] !== 'template') return [];
  const { template, inputs, value } = answer;
  if (!isAllowedTemplate(template)) return [];
  const numeric = Array.isArray(inputs) && inputs.every((n): n is number => typeof n === 'number');
  const computed = numeric ? computeTemplate(template, inputs) : null;
  return computed !== null && typeof value === 'number' && Math.abs(computed - value) < 1e-9
    ? []
    : fail('template-value-mismatch', q);
}

const EXPRESSION_KEYS = ['expression', 'formula', 'code'] as const;

/**
 * `model-written-expression`: a defensive scan of the RAW model object. The authoring schema has no
 * expression field, so on parsed questions this never fires; it names the attack on raw input.
 */
export function checkModelWrittenExpression(raw: unknown, questionId: string): readonly CheckFailure[] {
  if (!isRecord(raw)) return [];
  const holders = [raw, raw['answer']].filter(isRecord);
  const found = holders.some((h) => EXPRESSION_KEYS.some((k) => k in h));
  return found ? [{ checkId: 'model-written-expression', questionId }] : [];
}

/** Req 22.7: a range answer's prompt must ask for one value, not both endpoints. */
const RANGE_PLURAL_PROMPT =
  /\b(?:both|two values?|the range|endpoints?|minimum and maximum|min and max|lower and upper|lowest and highest|smallest and largest)\b/i;

/** `dial-range-prompt`. */
export function checkDialRangePrompt(q: Q): readonly CheckFailure[] {
  if (answerOf(q)['kind'] !== 'range') return [];
  const prompt: unknown = (q as unknown as { prompt?: unknown }).prompt;
  return typeof prompt === 'string' && RANGE_PLURAL_PROMPT.test(prompt) ? fail('dial-range-prompt', q) : [];
}

/**
 * All combination-dial Code_Checks plus each evidence quote's own checks. Pure; never throws.
 * A question has one root cause per ID: `model-written-expression` is not added when the template
 * is already reported as not allowlisted (the fixture carries both; its expected catch is the template).
 */
export function combinationDialChecks(q: Q, context: QuoteContext): readonly CheckFailure[] {
  const failures: CheckFailure[] = [];
  for (const e of evidenceOf(q)) {
    const failure = checkQuote(
      context.chunks,
      { paragraphChunkId: context.paragraphChunkIds.get(e.paragraph) ?? '', quote: e.quote },
      q.id,
    );
    if (failure) failures.push(failure);
  }
  const notAllowlisted = checkTemplateNotAllowlisted(q);
  failures.push(
    ...checkMissingUnits(q),
    ...checkUnitsRevealNumber(q),
    ...checkNumberNotInQuote(q, context),
    ...checkRangeNotInQuote(q, context),
    ...notAllowlisted,
    ...checkTemplateInputNotInQuote(q, context),
    ...checkTemplateValueMismatch(q),
    ...(notAllowlisted.length === 0 ? checkModelWrittenExpression(q, q.id) : []),
    ...checkDialRangePrompt(q),
  );
  return failures;
}
