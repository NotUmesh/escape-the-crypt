/**
 * Learner-facing text for the desk, the open book, the dig and the descent. Checked against the
 * banned-wording list in `copy-front-of-house.test.ts`.
 */

export const DIG_STAGE_IDS = ['finding-concepts', 'writing-questions', 'checking', 'building-rooms'] as const;
export type DigStageId = (typeof DIG_STAGE_IDS)[number];

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

export const FRONT_OF_HOUSE_COPY = {
  hub: {
    title: 'Escape the Crypt',
    lede: 'Bring your notes to the desk. Every lock is a question from them.',
    bringNotes: 'Bring your notes',
    shelfTitle: 'Your crypts',
    shelfNote: 'Saved on this device only.',
    shelfEmpty: 'No crypts on this device yet. Bring your notes to start one.',
    moreCrypts: (n: number): string => `More crypts (${n})`,
    samplesTitle: 'Sample crypts',
    menuLabel: 'Desk',
    resumeLookupFailed: 'Saved crypts could not be checked on this device. You can still play a sample crypt.',
  },
  book: {
    fromNotes: 'Crypt from your notes',
    sample: 'Sample crypt',
    rooms: (n: number): string => plural(n, 'room', 'rooms'),
    status: {
      active: 'In progress',
      escaped: 'Escaped',
      left: 'Not finished',
    },
    reviewDue: (n: number): string => `Review due: ${n}`,
    selected: 'selected',
  },
  bring: {
    title: 'Bring your notes',
    back: 'Back to the desk',
  },
  dig: {
    title: 'Digging your crypt',
    elapsed: 'Time so far',
    notes: 'Your notes',
    notesStats: (pieces: number, words: number): string =>
      `${plural(pieces, 'piece', 'pieces')} · ${plural(words, 'word', 'words')}`,
    stagesLabel: 'Where your crypt is',
    stageNames: {
      'finding-concepts': 'Finding concepts',
      'writing-questions': 'Writing questions',
      checking: 'Checking against your notes',
      'building-rooms': 'Building rooms',
    } satisfies Record<DigStageId, string>,
    stageStatus: {
      done: 'Done',
      active: 'In progress',
      waiting: 'Waiting',
    },
    stageCount: (done: number, total: number): string => `${done} of ${total}`,
    stillWorking: (minutes: number): string => `Still working. ${plural(minutes, 'minute', 'minutes')} so far.`,
    stageNow: (name: string, count: string | null): string =>
      count === null ? `${name}.` : `${name}, ${count}.`,
  },
  descent: {
    label: 'Descending into the crypt',
    announce: 'Descending into the crypt.',
    finalDoor: 'The final door opens',
    escape: 'Escaping the crypt',
    skip: 'Skip',
  },
} as const;

/** Whole seconds as `m:ss`. Negative or non-finite input reads as 0:00. */
export function formatElapsed(totalSeconds: number): string {
  const safe = Number.isFinite(totalSeconds) && totalSeconds > 0 ? Math.floor(totalSeconds) : 0;
  const minutes = Math.floor(safe / 60);
  const seconds = safe % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

/** A calendar date for a book, in the learner's own time zone. */
export function formatShelfDate(epochMs: number): string {
  return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(epochMs));
}
