import { AUTOPSY_LABELS } from '@escape-the-crypt/core';
import type { ConceptOutcome, selectAutopsy } from '@escape-the-crypt/core';

/** What `selectAutopsy` returns. */
export type AutopsyViewLike = ReturnType<typeof selectAutopsy>;

/**
 * What the card may say about the crypt. A bundled sample crypt has a public title. A crypt made from
 * the learner's notes has none: nothing is taken from their notes, not even a heading.
 */
export type ShareCrypt = { readonly kind: 'sample'; readonly title: string } | { readonly kind: 'notes' };

export interface ShareCount {
  readonly outcome: ConceptOutcome;
  readonly label: string;
  readonly count: number;
}

/** Everything the card is made from. Numbers, fixed labels and at most one public sample title. */
export interface ShareCardData {
  /** The sample's title, or null for a crypt made from the learner's notes. */
  readonly title: string | null;
  readonly sample: boolean;
  /** Concepts still due for review when the run ended: the ghosts that linger. */
  readonly ghostsRemaining: number;
  readonly counts: readonly ShareCount[];
}

export const OUTCOME_ORDER: readonly ConceptOutcome[] = [
  'first-try-correct',
  'assisted',
  'retried',
  'challenged',
  'review-due',
];

const MAX_TITLE_LENGTH = 80;

/** A whole number of 0 or more; anything else reads as 0. */
function wholeCount(value: unknown): number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : 0;
}

/** One line of plain text: control characters and runs of spaces are removed, and the length is capped. */
export function cleanTitle(raw: string): string | null {
  // eslint-disable-next-line no-control-regex
  const clean = raw.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (clean === '') return null;
  return clean.length > MAX_TITLE_LENGTH ? `${clean.slice(0, MAX_TITLE_LENGTH - 1).trimEnd()}\u2026` : clean;
}

/**
 * The card's data from the Autopsy view. It reads only the five outcome counts, so no concept ID,
 * title, question, answer or note text can reach the card. `null` until the run has escaped.
 */
export function buildShareCardData(view: AutopsyViewLike, crypt: ShareCrypt): ShareCardData | null {
  if (!view.available) return null;
  const counts = OUTCOME_ORDER.map((outcome) => ({
    outcome,
    label: AUTOPSY_LABELS[outcome],
    count: wholeCount(view.counts[outcome]),
  }));
  const title = crypt.kind === 'sample' ? cleanTitle(crypt.title) : null;
  return {
    title,
    sample: crypt.kind === 'sample',
    ghostsRemaining: wholeCount(view.counts['review-due']),
    counts,
  };
}
