import { FRONT_OF_HOUSE_COPY, formatShelfDate } from '@escape-the-crypt/core';

/**
 * One saved crypt on this device. The shape `listShelf` in `state/storage` is asked to return;
 * until it exists, `use-shelf.ts` builds at most one from the latest active run.
 */
export interface ShelfEntry {
  readonly manifestId: string;
  /** The run to continue, or null when the crypt has no run that can be opened. */
  readonly runId: string | null;
  readonly status: 'active' | 'escaped' | 'left';
  /** Epoch ms of the latest run. */
  readonly createdAt: number;
  readonly source: 'sample' | 'generated';
  readonly roomCount: number;
  /** Concepts still due for review. Absent when it is not known, and then nothing is shown. */
  readonly dueConceptCount?: number;
}

/** A sample the hub offers. Building and restoring it is the sample registry's job, not the hub's. */
export interface SampleEntry {
  readonly id: string;
  readonly title: string;
}

export interface BookLabel {
  readonly title: string;
  readonly meta: string;
  readonly status: string;
  readonly reviewDue: string | null;
}

/** What the spine and the card say about a crypt. Never a file name. */
export function bookLabel(entry: ShelfEntry): BookLabel {
  const copy = FRONT_OF_HOUSE_COPY.book;
  const due = entry.dueConceptCount;
  return {
    title: entry.source === 'sample' ? copy.sample : copy.fromNotes,
    meta: `${formatShelfDate(entry.createdAt)} · ${copy.rooms(entry.roomCount)}`,
    status: copy.status[entry.status],
    reviewDue: due === undefined || due <= 0 ? null : copy.reviewDue(due),
  };
}

/** A stable key for a crypt on the shelf. */
export function shelfKey(entry: ShelfEntry): string {
  return entry.manifestId;
}
