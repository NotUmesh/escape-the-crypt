import type { AuthoringQuestion } from '../authoring/schema';
import { MAX_QUOTE_WORDS } from '../checks/evidence';
import { resolveQuote } from '../quote-resolver';
import type { ResolvedLocation, Result } from '../types';
import { conflictShownId, evidenceOfQuestion, type ConflictResponse } from './conflict-prompt';
import type { PreparedDocument } from './prepare-input';

/** One passage of a notice: a chunk ID that code resolved, and the quote as it appears. */
export interface ConflictPassage {
  readonly chunkId: string;
  readonly quote: string;
}

/** A conflict that passed every rule. Both passages were resolved by code. */
export interface ConfirmedConflict {
  readonly shownId: string;
  readonly questionId: string;
  readonly conceptId: string;
  /** The question's own supporting passage (its first evidence that resolves). */
  readonly own: ConflictPassage;
  /** The passage the checker reported. */
  readonly other: ConflictPassage;
}

export interface ConflictResolution {
  /** In shown order. A concept may appear more than once (one per question). */
  readonly confirmed: readonly ConfirmedConflict[];
  /** Reports with `conflict: true` that failed a rule. Feeds `conflictReportsIgnored`. */
  readonly conflictReportsIgnored: number;
}

/** The reply did not hold exactly one entry for each shown id. The caller retries once. */
export type ConflictReplyError =
  | { readonly kind: 'conflict-reply-repeated-id'; readonly shownId: string }
  | { readonly kind: 'conflict-reply-missing-id'; readonly shownId: string }
  | { readonly kind: 'conflict-reply-unknown-id'; readonly shownId: string };

interface OwnEvidence {
  readonly passage: ConflictPassage;
  readonly location: ResolvedLocation;
}

function overlaps(a: ResolvedLocation, b: ResolvedLocation): boolean {
  return a.chunkId === b.chunkId && a.start < b.end && b.start < a.end;
}

function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

/** Numbers in a text; thousands commas are dropped. */
function numbersIn(text: string): readonly number[] {
  const found = text.match(/\d[\d,]*(?:\.\d+)?/g) ?? [];
  return found.map((raw) => Number(raw.replace(/,/g, ''))).filter((n) => Number.isFinite(n));
}

/**
 * Rule 4. Only a dial with an `exact` or `range` key has a numeric key; every other question
 * passes. For `exact` the quote needs a number different from the key. For `range` it needs a
 * number outside the range. This rule can only ignore more reports, never confirm more.
 */
function holdsDifferingNumber(question: AuthoringQuestion, quote: string): boolean {
  if (question.lockType !== 'combination-dial') return true;
  const key = question.answer;
  const numbers = numbersIn(quote);
  if (key.kind === 'exact') return numbers.some((n) => n !== key.value);
  if (key.kind === 'range') return numbers.some((n) => n < key.min || n > key.max);
  return true;
}

function ownEvidenceOf(question: AuthoringQuestion, doc: PreparedDocument): readonly OwnEvidence[] {
  const out: OwnEvidence[] = [];
  for (const line of evidenceOfQuestion(question)) {
    const chunk = doc.quotableChunksByOrdinal.get(line.paragraph);
    if (!chunk) continue;
    const resolved = resolveQuote(doc.chunks, chunk.id, line.quote);
    if (resolved.ok) {
      out.push({ passage: { chunkId: chunk.id, quote: line.quote }, location: resolved.value });
    }
  }
  return out;
}

/** Exactly one entry for each shown id, or a typed error. Never throws. */
function checkIds(reply: ConflictResponse, count: number): ConflictReplyError | null {
  const shown = new Set<string>();
  for (let i = 0; i < count; i += 1) shown.add(conflictShownId(i));
  const seen = new Set<string>();
  for (const r of reply.results) {
    if (!shown.has(r.questionId)) return { kind: 'conflict-reply-unknown-id', shownId: r.questionId };
    if (seen.has(r.questionId)) return { kind: 'conflict-reply-repeated-id', shownId: r.questionId };
    seen.add(r.questionId);
  }
  for (const id of shown) {
    if (!seen.has(id)) return { kind: 'conflict-reply-missing-id', shownId: id };
  }
  return null;
}

/**
 * Resolves a checker reply in code (design 1b). `room` lists the questions in the order they
 * were shown: question `i` was shown as `conflictShownId(i)`. A report with `conflict: true`
 * confirms a conflict only when:
 *  1. its paragraph is a shown ordinal, which code translates to a chunk ID;
 *  2. `resolveQuote` resolves its quote uniquely, in at most MAX_QUOTE_WORDS words;
 *  3. the resolved location overlaps no evidence location of that same question;
 *  4. for a numeric dial key, the quote holds a number different from the key.
 * Every other `conflict: true` report is ignored and counted. A question with no resolvable
 * evidence of its own is ignored too, because the notice needs both passages.
 */
export function resolveConflictReports(
  reply: ConflictResponse,
  room: readonly AuthoringQuestion[],
  doc: PreparedDocument,
): Result<ConflictResolution, ConflictReplyError> {
  const idError = checkIds(reply, room.length);
  if (idError) return { ok: false, error: idError };

  const byShownId = new Map(reply.results.map((r) => [r.questionId, r] as const));
  const confirmed: ConfirmedConflict[] = [];
  let ignored = 0;

  room.forEach((question, index) => {
    const shownId = conflictShownId(index);
    const report = byShownId.get(shownId);
    if (!report || !report.conflict) return;

    const chunk = report.paragraph === null ? undefined : doc.quotableChunksByOrdinal.get(report.paragraph);
    const quote = report.quote;
    if (!chunk || quote === null || wordCount(quote) > MAX_QUOTE_WORDS) {
      ignored += 1;
      return;
    }
    const resolved = resolveQuote(doc.chunks, chunk.id, quote);
    const own = ownEvidenceOf(question, doc);
    const first = own[0];
    if (
      !resolved.ok ||
      first === undefined ||
      own.some((e) => overlaps(e.location, resolved.value)) ||
      !holdsDifferingNumber(question, quote)
    ) {
      ignored += 1;
      return;
    }
    confirmed.push({
      shownId,
      questionId: question.id,
      conceptId: question.conceptId,
      own: first.passage,
      other: { chunkId: chunk.id, quote },
    });
  });

  return { ok: true, value: { confirmed, conflictReportsIgnored: ignored } };
}
