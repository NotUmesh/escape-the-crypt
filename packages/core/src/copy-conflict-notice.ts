/**
 * The wording around the conflict notice on a generated crypt. The sentences about what was left
 * out and what to do next are `conflictLeftOut` and `conflictNext` in `copy-conflict.ts`; this file
 * holds only the few labels the notice adds. Messages, not evidence labels (decision D9).
 */
export const CONFLICT_NOTICE_COPY = {
  heading: 'Left out of this crypt',
  /** The disclosure that opens the two passages. */
  showPassages: 'Show passages',
  /** The accessible name of one disclosure when several are on screen. It starts with the visible text. */
  showPassagesFor: (title: string): string => `Show passages, ${title}`,
  passages: 'The two passages',
} as const;
