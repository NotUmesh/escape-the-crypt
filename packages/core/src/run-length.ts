import type { RunSettings } from './runtime/manifest-types';

/** The three crypt sizes a learner can ask for. */
export const RUN_LENGTHS = ['short', 'standard', 'long'] as const;
export type RunLength = RunSettings['length'];

/** What one length asks of generation. Every room has two locks. */
export interface CryptTarget {
  readonly rooms: number;
  readonly locksPerRoom: 2;
  /** Concepts generated and reviewed for this length: three per room, two locks plus one spare. */
  readonly maxConcepts: number;
}

const ROOMS: Readonly<Record<RunLength, number>> = { short: 2, standard: 3, long: 4 };
const CONCEPTS_PER_ROOM = 3;

/**
 * The one place a run length becomes numbers. Web, worker and pipeline all read it, so the room
 * count a learner is promised, the room count generation aims for and the room count the
 * "shortened" notice compares against cannot drift apart.
 */
export function cryptTargetFor(length: RunLength): CryptTarget {
  const rooms = ROOMS[length];
  return { rooms, locksPerRoom: 2, maxConcepts: rooms * CONCEPTS_PER_ROOM };
}

/**
 * Quotable chunks a note needs before a length is offered. Short is always offered: a note too
 * thin for it ends as "not enough material" instead.
 *
 * Calibrated on the 12 recorded dev notes (4 to 9 quotable chunks), where the chunk count is a
 * weak signal: the notes that filled 3 and 4 rooms had 6 to 9 chunks, and so did notes that did
 * not. The thresholds are therefore the lowest counts that never switch off a length a dev note
 * could fill ("clearly can't"). Below them, no recorded note filled the length.
 */
const MIN_QUOTABLE_CHUNKS: Readonly<Record<RunLength, number>> = { short: 0, standard: 6, long: 6 };

export interface LengthAvailability {
  readonly enabled: Readonly<Record<RunLength, boolean>>;
  /** The longest length that is enabled. Always at least `short`. */
  readonly largest: RunLength;
}

/** Which lengths a note of `quotableChunks` chunks can plausibly fill. Pure. */
export function lengthAvailability(quotableChunks: number): LengthAvailability {
  const enabled = {
    short: true,
    standard: quotableChunks >= MIN_QUOTABLE_CHUNKS.standard,
    long: quotableChunks >= MIN_QUOTABLE_CHUNKS.long,
  };
  const largest = [...RUN_LENGTHS].reverse().find((l) => enabled[l]) ?? 'short';
  return { enabled, largest };
}
