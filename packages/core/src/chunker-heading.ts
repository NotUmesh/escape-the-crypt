import { isAllCapsHeading } from './chunker-split';
import type { Chunk } from './types';

/** A chunk is heading-only when its text is one line and that line is an all-caps heading. */
export function isHeadingOnlyChunk(chunk: Pick<Chunk, 'text'>): boolean {
  return !/[\n\r]/.test(chunk.text) && isAllCapsHeading(chunk.text);
}
