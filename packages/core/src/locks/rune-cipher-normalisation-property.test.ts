import fc from 'fast-check';
import { describe, it } from 'vitest';
import type { RuneCipherAuthoringQuestion } from '../authoring/schema';
import type { QuoteContext } from '../checks/evidence';
import type { Chunk } from '../types';
import { judge, normaliseRuneAnswer } from './rune-cipher';
import { checkAnswerInQuote } from './rune-cipher-checks';

/** Lead-in so any typed text forms a quote long enough to resolve. */
const PAD = 'Ward the old crypt door';

/** A context in which the typed text resolves as a quote (the check only reads resolved quotes). */
function contextFor(text: string): QuoteContext {
  const chunk: Chunk = {
    id: 'chk_p7',
    documentDigest: 'p7',
    position: 0,
    text,
    location: { sourceType: 'paste', paragraphNumber: 1 },
    edited: false,
  };
  return { chunks: new Map([[chunk.id, chunk]]), paragraphChunkIds: new Map([[1, chunk.id]]) };
}

const WS = [' ', '  ', '\t', '\n', '\r\n', '\u00a0', '\u2003'];

const wordArb = fc.string({ minLength: 1, maxLength: 8 }).filter((w) => w.trim() !== '' && !/\s/.test(w));
const gapArb = fc.constantFrom(...WS);

/** A non-blank answer made of words and arbitrary whitespace gaps, with optional padding. */
const spacedArb = fc
  .tuple(
    fc.array(fc.tuple(wordArb, gapArb), { minLength: 1, maxLength: 4 }),
    gapArb,
    fc.boolean(),
  )
  .map(([parts, pad, padded]) => {
    const body = parts.map(([w, g]) => w + g).join('');
    return padded ? pad + body : body;
  });

const caseArb = fc.constantFrom<'same' | 'upper' | 'lower'>('same', 'upper', 'lower');

function recase(text: string, mode: 'same' | 'upper' | 'lower'): string {
  if (mode === 'upper') return text.toUpperCase();
  if (mode === 'lower') return text.toLowerCase();
  return text;
}

function question(answer: string, caseSensitive: boolean): RuneCipherAuthoringQuestion {
  return {
    id: 'u1',
    conceptId: 'c1',
    role: 'primary',
    lockType: 'rune-cipher',
    prompt: 'According to your notes, the thing is the ______.',
    answer,
    aliases: [],
    caseSensitive,
    evidence: [{ paragraph: 1, quote: '' }],
    explanation: 'x',
  };
}

// Feature: generation-and-evaluation, Property 7: Rune cipher check and judge agree on normalisation
describe('Property 7: Rune cipher check and judge agree on normalisation', () => {
  // **Validates: Requirements 5.5**
  it('judge match, normalised equality and the check agree for any answer, typed input and caseSensitive flag', () => {
    fc.assert(
      fc.property(spacedArb, spacedArb, caseArb, fc.boolean(), (answer, other, mode, caseSensitive) => {
        // Typed input is either a re-spaced/re-cased copy of the answer or an unrelated string.
        const typedVariants = [recase(answer, mode).replace(/\s+/g, '  '), other];
        for (const typed of typedVariants) {
          const normalisedEqual =
            normaliseRuneAnswer(typed, caseSensitive) === normaliseRuneAnswer(answer, caseSensitive);
          const judged = judge(
            { answer, aliases: [], caseSensitive },
            { text: typed },
            null,
          );
          if ((judged === 'correct') !== normalisedEqual) return false;

          // The check, given the typed text inside a resolvable quote, accepts whenever the judge does.
          const quote = `${PAD} ${typed}`;
          const checkPasses =
            checkAnswerInQuote(
              {
                ...question(answer, caseSensitive),
                evidence: [{ paragraph: 1, quote }],
              },
              contextFor(quote),
            ).length === 0;
          const included = normaliseRuneAnswer(quote, caseSensitive).includes(
            normaliseRuneAnswer(answer, caseSensitive),
          );
          if (checkPasses !== included) return false;
          if (judged === 'correct' && !checkPasses) return false;
        }
        return true;
      }),
      { numRuns: 200 },
    );
  });
});
