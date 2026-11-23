import { splitBalanced } from './chunker-rebalance';
import { MAX_CHUNK_CHARS, type Span, spanLength } from './chunker-split';

export const MIN_CHUNK_CHARS = 40;

/**
 * Merges short pieces of ONE unit (one page or one paragraph) in a single
 * left-to-right pass. `pieces` are spans into `source`, the unit's original
 * text, in source order. The caller passes the pieces of one unit only, so a
 * merge can never cross a page or paragraph boundary.
 *
 * A merge covers the source range from the first piece's start to the last
 * piece's end, so the original text between them (a newline, a blank line,
 * a line-break hyphen) is kept exactly.
 *
 * - A piece shorter than `min` is merged into the following piece.
 *   Consecutive short pieces are carried forward until the merged range
 *   reaches `min` or the unit ends.
 * - A short piece at the end of the unit is merged into the preceding piece.
 * - A short piece that is alone in the unit is kept unchanged.
 *
 * A merged range can exceed `max`, so it is split to the limit. If that leaves
 * a tail under `min`, the last two pieces are rebalanced (see chunker-rebalance).
 */
export function mergeShort(
  source: string,
  pieces: readonly Span[],
  min: number = MIN_CHUNK_CHARS,
  max: number = MAX_CHUNK_CHARS,
): Span[] {
  const out: Span[] = [];
  let carry: Span | null = null;
  for (let i = 0; i < pieces.length; i++) {
    const piece = pieces[i] as Span;
    const current: Span = carry === null ? piece : { start: carry.start, end: piece.end };
    const merged = carry !== null;
    carry = null;
    const hasFollowing = i < pieces.length - 1;
    if (spanLength(current) < min && hasFollowing) {
      carry = current;
      continue;
    }
    if (spanLength(current) < min && out.length > 0) {
      const previous = out.pop() as Span;
      out.push(...splitBalanced(source, { start: previous.start, end: current.end }, min, max));
      continue;
    }
    out.push(...(merged ? splitBalanced(source, current, min, max) : [current]));
  }
  return out;
}
