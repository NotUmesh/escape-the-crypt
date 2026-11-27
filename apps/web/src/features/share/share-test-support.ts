import type { ConceptOutcome } from '@escape-the-crypt/core';
import type { AutopsyViewLike } from './share-card-data';

type AutopsyCounts = Readonly<Record<ConceptOutcome, number>>;

/** An escaped Autopsy view with the given counts. The entries carry text a card must never show. */
export function escapedView(counts: Partial<AutopsyCounts> = {}, entryText = 'ENTRY-TEXT'): AutopsyViewLike {
  const full: AutopsyCounts = {
    'first-try-correct': 0,
    assisted: 0,
    retried: 0,
    challenged: 0,
    'review-due': 0,
    ...counts,
  };
  return {
    available: true,
    counts: full,
    entries: [{ conceptId: entryText, outcome: 'review-due', label: entryText }],
    returnLabel: entryText,
  };
}

export const NOT_ESCAPED: AutopsyViewLike = { available: false, entries: [], counts: null, returnLabel: 'Review' };
