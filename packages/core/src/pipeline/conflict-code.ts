import { normaliseWithMap } from '../normalise';
import { resolveQuote } from '../quote-resolver';
import type { ExtractedConcept } from './concept-extraction';
import type { PreparedDocument } from './prepare-input';

/** A number with its unit, read from one resolved quote of one concept. */
export interface NumericFact {
  readonly value: number;
  readonly unit: string;
  readonly chunkId: string;
  readonly quote: string;
}

/** Two concepts with the same label that state different numbers in different chunks. */
export interface CodeConflict {
  readonly conceptIds: readonly [string, string];
  readonly unit: string;
  readonly passages: readonly [
    { readonly chunkId: string; readonly quote: string },
    { readonly chunkId: string; readonly quote: string },
  ];
}

/** Words that follow a number without naming a unit ("3 of the", "5 and 6"). */
const NOT_UNITS: ReadonlySet<string> = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'but', 'by', 'for', 'from', 'has', 'have', 'in',
  'is', 'it', 'of', 'on', 'or', 'the', 'then', 'to', 'was', 'were', 'which', 'while', 'with',
]);

/** A number (digits, optional thousands commas, optional decimals), then `%` or a unit word. */
const FACT_PATTERN =
  /(?<![\p{L}\p{N}.,])(\d{1,3}(?:,\d{3})+|\d+)(\.\d+)?\s*(%|\p{L}+)/gu;

/** Folds the label like quotes are folded, lower-cases it and keeps letters and digits only. */
export function labelKey(label: string): string {
  return normaliseWithMap(label)
    .text.toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, '');
}

function singular(word: string): string {
  const w = word.toLowerCase();
  if (w.length > 4 && w.endsWith('ies')) return `${w.slice(0, -3)}y`;
  if (w.length > 3 && w.endsWith('s') && !w.endsWith('ss')) return w.slice(0, -1);
  return w;
}

function factsInQuote(quote: string, chunkId: string): NumericFact[] {
  const text = normaliseWithMap(quote).text;
  const out: NumericFact[] = [];
  for (const m of text.matchAll(FACT_PATTERN)) {
    const whole = (m[1] ?? '').replace(/,/g, '');
    const value = Number(`${whole}${m[2] ?? ''}`);
    const word = m[3] ?? '';
    const unit = word === '%' ? '%' : singular(word);
    if (!Number.isFinite(value) || unit === '' || NOT_UNITS.has(unit)) continue;
    out.push({ value, unit, chunkId, quote });
  }
  return out;
}

function compareFacts(a: NumericFact, b: NumericFact): number {
  if (a.chunkId !== b.chunkId) return a.chunkId < b.chunkId ? -1 : 1;
  if (a.unit !== b.unit) return a.unit < b.unit ? -1 : 1;
  if (a.value !== b.value) return a.value - b.value;
  return a.quote < b.quote ? -1 : a.quote > b.quote ? 1 : 0;
}

/**
 * Numeric facts inside the concept's own resolved quotes (never the whole chunk). The chunk ID is
 * the cited chunk the quote resolves in. A quote that resolves nowhere yields no facts. Sorted and
 * de-duplicated, so the result does not depend on quote order.
 */
export function numericFactsOf(
  concept: ExtractedConcept,
  doc: PreparedDocument,
): readonly NumericFact[] {
  const facts: NumericFact[] = [];
  for (const quote of concept.quotes) {
    for (const chunkId of new Set(concept.chunkIds)) {
      if (!resolveQuote(doc.chunks, chunkId, quote).ok) continue;
      facts.push(...factsInQuote(quote, chunkId));
      break;
    }
  }
  facts.sort(compareFacts);
  return facts.filter((f, i) => i === 0 || compareFacts(facts[i - 1]!, f) !== 0);
}

function firstDisagreement(
  a: readonly NumericFact[],
  b: readonly NumericFact[],
): [NumericFact, NumericFact] | null {
  for (const x of a) {
    for (const y of b) {
      if (x.unit === y.unit && x.value !== y.value && x.chunkId !== y.chunkId) return [x, y];
    }
  }
  return null;
}

/**
 * Concept pairs with equal label keys whose facts share a unit, differ in value and sit in
 * different chunks. Pure: no provider, no budget. Both concepts of a pair are to be excluded.
 * One entry per pair, sorted by `conceptIds`, independent of input order.
 */
export function findCodeConflicts(
  concepts: readonly ExtractedConcept[],
  doc: PreparedDocument,
): readonly CodeConflict[] {
  const byKey = new Map<string, ExtractedConcept[]>();
  for (const concept of concepts) {
    const key = labelKey(concept.label);
    if (key === '') continue;
    byKey.set(key, [...(byKey.get(key) ?? []), concept]);
  }

  const out: CodeConflict[] = [];
  for (const group of byKey.values()) {
    const ordered = [...group].sort((p, q) =>
      p.conceptId < q.conceptId ? -1 : p.conceptId > q.conceptId ? 1 : 0,
    );
    for (let i = 0; i < ordered.length; i += 1) {
      for (let j = i + 1; j < ordered.length; j += 1) {
        const a = ordered[i]!;
        const b = ordered[j]!;
        if (a.conceptId === b.conceptId) continue;
        const hit = firstDisagreement(numericFactsOf(a, doc), numericFactsOf(b, doc));
        if (hit === null) continue;
        out.push({
          conceptIds: [a.conceptId, b.conceptId],
          unit: hit[0].unit,
          passages: [
            { chunkId: hit[0].chunkId, quote: hit[0].quote },
            { chunkId: hit[1].chunkId, quote: hit[1].quote },
          ],
        });
      }
    }
  }
  return out.sort((p, q) => {
    const l = p.conceptIds[0] < q.conceptIds[0] ? -1 : p.conceptIds[0] > q.conceptIds[0] ? 1 : 0;
    if (l !== 0) return l;
    return p.conceptIds[1] < q.conceptIds[1] ? -1 : p.conceptIds[1] > q.conceptIds[1] ? 1 : 0;
  });
}
