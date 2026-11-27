import { isAllCapsHeading } from './chunker-split';
import { LINE_BREAK_HYPHEN_SOURCE } from './normalise';
/**
 * Undoes hard line wrapping, so that the text the model reads and the text a quote is
 * resolved against are the same string. This is the one place line breaks are repaired.
 *
 * - `exam-\nple` becomes `example`: the same rule as `normaliseWithMap` (a hyphen, a line
 *   break, then a letter). `pages 5-\n10` keeps its hyphen and becomes `pages 5-10`.
 * - Any other single line break inside a paragraph becomes one space.
 * - Blank lines (paragraph breaks) are never touched.
 * - A heading line (the chunker's own all-caps rule) keeps its line breaks, and so does a
 *   list item. A line that is all caps only because a wrapped line ends on an acronym
 *   ("sent by\nNASA\nin 1969") is not a heading and is joined.
 *
 * Pure, and idempotent: reflowing reflowed text changes nothing.
 */
const HYPHEN_BREAK = new RegExp(LINE_BREAK_HYPHEN_SOURCE, 'uy');
const LINE_BREAK = /(\r\n|\r|\n)/;
const SENTENCE_END = /[.!?:;]["')\]\u201D\u2019]*$/;
const SYMBOL_BULLET = /^\s*[\u2022\u25AA\u25E6\u25CF\u00B7]/u;
const LIST_MARKER = /^\s*(?:[-*\u2013]|\d{1,3}[.)])(?:\s|$)/u;
const STARTS_LOWERCASE = /^\s*\p{Ll}/u;
const STARTS_DIGIT = /^\d/;
const isBlank = (line: string): boolean => line.trim().length === 0;
const isListStart = (line: string): boolean => SYMBOL_BULLET.test(line) || LIST_MARKER.test(line);
/** True when the break after `left` is a hyphen break before a letter. */
function endsInHyphenBreak(left: string, right: string): boolean {
  HYPHEN_BREAK.lastIndex = left.length - 1;
  return left.endsWith('-') && HYPHEN_BREAK.exec(`${left}\n${right}`) !== null;
}
/** Whether the `lines[index]` line stands as a heading, given the text group before it. */
function standsAsHeading(
  lines: readonly string[],
  index: number,
  previous: string,
  previousIsHeading: boolean,
): boolean {
  const line = lines[index] as string;
  if (!isAllCapsHeading(line)) return false;
  const next = lines[index + 1];
  if (next !== undefined && STARTS_LOWERCASE.test(next)) return false;
  return (
    isBlank(previous) ||
    previousIsHeading ||
    SENTENCE_END.test(previous.trimEnd()) ||
    isListStart(previous)
  );
}
/** Whether a break before `next` belongs to a list: bullets always, numbers after a sentence or an item. */
function startsListItem(current: string, next: string): boolean {
  if (SYMBOL_BULLET.test(next)) return true;
  return LIST_MARKER.test(next) && (SENTENCE_END.test(current.trimEnd()) || isListStart(current));
}
function joinLines(current: string, next: string): string {
  const left = current.replace(/[ \t]+$/, '');
  const right = next.replace(/^[ \t]+/, '');
  if (endsInHyphenBreak(left, right)) return left.slice(0, -1) + right;
  if (left.endsWith('-') && STARTS_DIGIT.test(right)) return left + right;
  return `${left} ${right}`;
}
export function reflowLineBreaks(text: string): string {
  const parts = text.split(LINE_BREAK);
  if (parts.length === 1) return text;
  const lines: string[] = [];
  const separators: string[] = [];
  parts.forEach((part, i) => (i % 2 === 0 ? lines : separators).push(part));
  let out = '';
  let current = lines[0] as string;
  let currentIsHeading = standsAsHeading(lines, 0, '', false);
  for (let i = 1; i < lines.length; i++) {
    const next = lines[i] as string;
    const separator = separators[i - 1] as string;
    const nextIsHeading = standsAsHeading(lines, i, current, currentIsHeading);
    const keep =
      isBlank(current) ||
      isBlank(next) ||
      currentIsHeading ||
      nextIsHeading ||
      startsListItem(current, next);
    if (keep) {
      out += current + separator;
      current = next;
      currentIsHeading = nextIsHeading;
    } else {
      current = joinLines(current, next);
      currentIsHeading = false;
    }
  }
  return out + current;
}
