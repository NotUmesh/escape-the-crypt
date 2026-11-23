import { normaliseWithMap } from './normalise';
import type { Chunk, QuoteError, ResolvedLocation, Result } from './types';

export const MIN_QUOTE_WORDS = 4;
export const MIN_QUOTE_CHARS = 20;

function err(error: QuoteError): Result<ResolvedLocation, QuoteError> {
  return { ok: false, error };
}

/**
 * Resolves a quote to offsets in the original chunk text.
 * Check order: too-short, unknown-chunk, not-found / ambiguous, then offsets.
 * Matching is case-sensitive on normalised text. Never throws.
 */
export function resolveQuote(
  chunks: ReadonlyMap<string, Chunk>,
  chunkId: string,
  quote: string,
): Result<ResolvedLocation, QuoteError> {
  try {
    const q = normaliseWithMap(quote).text;
    const wordCount = q === '' ? 0 : q.split(' ').length;
    if (!(wordCount >= MIN_QUOTE_WORDS && q.length >= MIN_QUOTE_CHARS)) {
      return err({ kind: 'too-short' });
    }

    const chunk = chunks.get(chunkId);
    if (!chunk) return err({ kind: 'unknown-chunk' });

    const { text, originalRange } = normaliseWithMap(chunk.text);
    let count = 0;
    let first = -1;
    for (let at = text.indexOf(q); at !== -1; at = text.indexOf(q, at + 1)) {
      if (count === 0) first = at;
      count++;
    }
    if (count === 0) return err({ kind: 'not-found' });
    if (count > 1) return err({ kind: 'ambiguous', count });

    return {
      ok: true,
      value: {
        chunkId,
        start: originalRange[first]![0],
        end: originalRange[first + q.length - 1]![1],
      },
    };
  } catch {
    return err({ kind: 'not-found' });
  }
}
