import { AUTOPSY_LABELS, RETURN_LABEL } from '../copy';
import { deriveAllOutcomes } from './outcomes';
import type { ConceptOutcome, State } from './state-types';

export interface AutopsyEntry {
  readonly conceptId: string;
  readonly outcome: ConceptOutcome;
  readonly label: string;
}

/** The five outcome counts (Req 22.1, 22.9). They sum to the number of concepts. */
export type AutopsyCounts = Readonly<Record<ConceptOutcome, number>>;

export type AutopsyView =
  | {
      readonly available: false;
      readonly entries: readonly [];
      readonly counts: null;
      readonly returnLabel: string;
    }
  | {
      readonly available: true;
      readonly entries: readonly AutopsyEntry[];
      readonly counts: AutopsyCounts;
      readonly returnLabel: string;
    };

/**
 * The Autopsy, available only when the run has Escaped (Req 21.6). Before that it returns an
 * unavailable result with no outcomes. Entries follow the manifest's concept order; labels come
 * from `copy.ts` (Req 23.1). JSON-safe.
 */
export function selectAutopsy(state: State): AutopsyView {
  if (state.status !== 'escaped') {
    return { available: false, entries: [], counts: null, returnLabel: RETURN_LABEL };
  }
  const outcomes = deriveAllOutcomes(state);
  const counts: Record<ConceptOutcome, number> = {
    'first-try-correct': 0,
    assisted: 0,
    retried: 0,
    challenged: 0,
    'review-due': 0,
  };
  const entries: AutopsyEntry[] = state.concepts.map((record) => {
    const outcome = outcomes[record.conceptId] as ConceptOutcome;
    counts[outcome] += 1;
    return { conceptId: record.conceptId, outcome, label: AUTOPSY_LABELS[outcome] };
  });
  return { available: true, entries, counts, returnLabel: RETURN_LABEL };
}
