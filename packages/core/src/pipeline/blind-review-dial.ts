import type { CombinationDialAuthoringQuestion } from '../authoring/schema';
import { judge, type CombinationDialQuestion } from '../locks/combination-dial';
import { computeTemplate } from '../locks/combination-dial-checks';

const GROUPED = /^\d{1,3}(?:,\d{3})+(?:\.\d+)?$/;
const TOKEN = /[-\u2212]?\d[\d,]*(?:\.\d+)?/g;

/**
 * The one number in a reviewer reply, as plain text for the dial judge, or null. Thousands
 * separators are removed, unit words and symbols are ignored. Zero or several numbers (for
 * example "7 to 10") are unparseable. Pure.
 */
export function parseReviewerNumber(reply: string): string | null {
  const tokens = reply.trim().match(TOKEN);
  if (tokens === null || tokens.length !== 1) return null;
  const negative = tokens[0]!.startsWith('-') || tokens[0]!.startsWith('\u2212');
  const digits = tokens[0]!.replace(/^[-\u2212]/, '');
  if (digits.includes(',') && !GROUPED.test(digits)) return null;
  const n = Number(digits.replace(/,/g, ''));
  if (!Number.isFinite(n)) return null;
  const text = String(n);
  if (text.includes('e')) return null;
  return negative && n !== 0 ? `-${text}` : text;
}

/** The judge's view of the key. Null when a template cannot be computed. */
function keyOfDial(question: CombinationDialAuthoringQuestion): CombinationDialQuestion | null {
  const a = question.answer;
  if (a.kind === 'exact') return { kind: 'exact', exactValue: a.value, unit: question.units };
  if (a.kind === 'range') return { kind: 'range', min: a.min, max: a.max, unit: question.units };
  // The authored `value` is only a claim and is never used.
  const value = computeTemplate(a.template, a.inputs);
  return value === null ? null : { kind: 'exact', exactValue: value, unit: question.units };
}

/** True when the reviewer's number is accepted by the dial judge against the key. Pure. */
export function dialMatches(question: CombinationDialAuthoringQuestion, reply: string): boolean {
  const number = parseReviewerNumber(reply);
  if (number === null) return false;
  const key = keyOfDial(question);
  if (key === null) return false;
  return judge(key, { rawInput: number }, null) === 'correct';
}
