import { BANNED_COPY_PHRASES } from '../copy';
import { resolveQuote } from '../quote-resolver';
import type { Chunk, LockType } from '../types';
import type { CheckFailure } from './types';

export const MAX_QUOTE_WORDS = 25;

/** Negation markers that make a prompt a negative question. */
const NEGATION_PATTERN = /\b(?:not|never|except|incorrect|false)\b|\b(?:isn't|aren't|doesn't)\b/i;

/**
 * Cursed-object prompts may ask "which one is not ..." or "which item does not
 * belong ..." (odd one out): the negation is the mechanic, not a trick.
 */
const CURSED_OBJECT_EXEMPTION = /\bwhich\b.*\bnot\b/i;

function checkQuoteLength(quote: string, questionId: string): CheckFailure | null {
  const words = quote.trim().split(/\s+/).filter(Boolean).length;
  return words > MAX_QUOTE_WORDS ? { checkId: 'quote-too-long', questionId } : null;
}

/**
 * Resolves one evidence quote against the chunk map. Too-long runs only
 * after the quote has resolved. Never throws.
 */
export function checkQuote(
  chunks: ReadonlyMap<string, Chunk>,
  chunkRef: { paragraphChunkId: string; quote: string },
  questionId: string,
): CheckFailure | null {
  const resolved = resolveQuote(chunks, chunkRef.paragraphChunkId, chunkRef.quote);
  if (!resolved.ok) {
    switch (resolved.error.kind) {
      case 'not-found':
        return { checkId: 'quote-not-found', questionId };
      case 'ambiguous':
        return { checkId: 'quote-ambiguous', questionId };
      case 'too-short':
        return { checkId: 'quote-too-short', questionId };
      case 'unknown-chunk':
        return { checkId: 'unknown-paragraph/chunk', questionId };
    }
  }
  return checkQuoteLength(chunkRef.quote, questionId);
}

/** The chunk lookup needed to resolve an authoring quote. */
export interface QuoteContext {
  readonly chunks: ReadonlyMap<string, Chunk>;
  /** Authoring paragraph number -> code-assigned chunk ID. */
  readonly paragraphChunkIds: ReadonlyMap<number, string>;
}

/**
 * True when the quote resolves to exactly one place in its paragraph's chunk.
 * Checks that read a quote's text as evidence use only such quotes, so one
 * quote failure is never double-reported by a second check.
 */
export function resolvesUniquely(
  context: QuoteContext,
  evidence: { readonly paragraph: number; readonly quote: string },
): boolean {
  const chunkId = context.paragraphChunkIds.get(evidence.paragraph) ?? '';
  return resolveQuote(context.chunks, chunkId, evidence.quote).ok;
}

/** Scans every given text field (prompt, option texts, explanation) for banned copy. */
export function checkBannedPhrase(
  texts: readonly string[],
  questionId: string,
): CheckFailure | null {
  for (const text of texts) {
    const lower = text.toLowerCase();
    if (BANNED_COPY_PHRASES.some((phrase) => lower.includes(phrase.toLowerCase()))) {
      return { checkId: 'banned-phrase', questionId };
    }
  }
  return null;
}

/**
 * Flags negation markers in the prompt only. A cursed-object prompt of the
 * form "which ... not" is exempt.
 */
export function checkNegativeQuestion(
  prompt: string,
  questionId: string,
  lockType?: LockType,
): CheckFailure | null {
  if (!NEGATION_PATTERN.test(prompt)) return null;
  if (lockType === 'cursed-object' && CURSED_OBJECT_EXEMPTION.test(prompt)) return null;
  return { checkId: 'negative-question', questionId };
}
