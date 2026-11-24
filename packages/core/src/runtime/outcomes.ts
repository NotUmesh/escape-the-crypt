import type { ConceptOutcome, ConceptRecord, State } from './state-types';

/**
 * Every question asked for the concept was challenged (Req 22.3). A challenged primary whose
 * Alternate was then answered does not qualify: the Alternate's own result decides (Req 22.4).
 */
function allQuestionsChallenged(record: ConceptRecord): boolean {
  if (record.firstQuestionResult !== 'challenged') return false;
  return !record.alternateUsed || record.alternateResult === 'challenged';
}

function isReviewDue(record: ConceptRecord): boolean {
  return (
    record.isLingeringSpirit ||
    record.wasSkippedWithNoAlternate ||
    record.reviewDueFlag ||
    record.return1Result === 'challenged' ||
    record.return2Result === 'challenged'
  );
}

function wasRetried(record: ConceptRecord): boolean {
  return record.return1Result === 'correct' || record.return2Result === 'correct';
}

/**
 * True when the first judged question was correct with no earlier wrong answer or skip: the
 * primary was correct, or the primary was challenged and the Alternate was correct.
 */
function answeredCorrectFirst(record: ConceptRecord): boolean {
  return (
    record.firstQuestionResult === 'correct' ||
    (record.firstQuestionResult === 'challenged' && record.alternateResult === 'correct')
  );
}

/**
 * The one outcome for a concept (Req 22.2). Precedence, highest first: Challenged, Review due,
 * Retried, Assisted, First-try correct. Reserved Final_Door results never reach the record
 * (Req 20.10), so they cannot change the outcome.
 */
export function deriveConceptOutcome(record: ConceptRecord): ConceptOutcome {
  if (allQuestionsChallenged(record)) return 'challenged';
  if (isReviewDue(record)) return 'review-due';
  if (wasRetried(record)) return 'retried';
  if (answeredCorrectFirst(record) && record.hintUsedOnCorrectQuestion) return 'assisted';
  if (answeredCorrectFirst(record)) return 'first-try-correct';
  // Not reachable in an escaped run (every concept is settled); an unfinished concept is due.
  return 'review-due';
}

/** One outcome per concept in the manifest, keyed by concept ID (Req 22.1, 22.9, 20.11). */
export function deriveAllOutcomes(state: State): Readonly<Record<string, ConceptOutcome>> {
  const outcomes: Record<string, ConceptOutcome> = {};
  for (const record of state.concepts) {
    outcomes[record.conceptId] = deriveConceptOutcome(record);
  }
  return outcomes;
}
