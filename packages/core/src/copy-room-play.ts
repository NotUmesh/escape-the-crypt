import type { SampleCryptError } from './sample-crypt/human-heart';
import type { SlotStatus } from './runtime/state-types';
import type { ErrorCopy } from './copy';

/** Strings for playing a crypt. Re-exported from `copy.ts`. Every string here is covered by the banned-words test. */

/** Requirement 1.3: shown beside "Enter the crypt". */
export const SAMPLE_CRYPT_LINE =
  "Questions from your own notes are coming later. For now, this is a sample crypt.";

/** Requirement 1.6: always visible while a run is on screen. */
export const SAMPLE_CRYPT_LABEL = 'Sample crypt';

export const ENTER_CRYPT_LABEL = 'Enter the crypt';

/** Failures while building or starting the sample crypt, plus a rejected start event. */
export type RoomStartErrorKind = SampleCryptError['kind'] | 'start-rejected';

const SAMPLE_BROKEN_NEXT = 'Reload the page and try again.';

export const ROOM_START_ERROR_COPY: Readonly<Record<RoomStartErrorKind, ErrorCopy>> = {
  'sample-question-missing': {
    what: "A question for the sample crypt couldn't be found.",
    next: SAMPLE_BROKEN_NEXT,
  },
  'sample-question-invalid': {
    what: "A question in the sample crypt isn't readable.",
    next: SAMPLE_BROKEN_NEXT,
  },
  'paragraph-not-found': {
    what: "A question points to a paragraph that isn't in the sample notes, so we set the crypt aside.",
    next: SAMPLE_BROKEN_NEXT,
  },
  'check-failed': {
    what: "A question in the sample crypt didn't pass its checks, so we set the crypt aside.",
    next: SAMPLE_BROKEN_NEXT,
  },
  'hint-mismatch': {
    what: "A hint in the sample crypt doesn't match its answer, so we set the crypt aside.",
    next: SAMPLE_BROKEN_NEXT,
  },
  'option-evidence-missing': {
    what: "An answer choice in the sample crypt has no evidence from the notes, so we set the crypt aside.",
    next: SAMPLE_BROKEN_NEXT,
  },
  'content-schema-invalid': {
    what: "The text of a sample question isn't in the shape we expect.",
    next: SAMPLE_BROKEN_NEXT,
  },
  'concept-label-missing': {
    what: "A concept in the sample crypt has no title, so we can't show it.",
    next: SAMPLE_BROKEN_NEXT,
  },
  'authoring-schema-invalid': {
    what: "A question in the sample crypt is missing some of its text, so we set the crypt aside.",
    next: SAMPLE_BROKEN_NEXT,
  },
  'manifest-schema-invalid': {
    what: "The sample crypt isn't in the shape we expect.",
    next: SAMPLE_BROKEN_NEXT,
  },
  'invalid-manifest': {
    what: "The sample crypt didn't pass its checks, so we can't open it.",
    next: SAMPLE_BROKEN_NEXT,
  },
  'start-rejected': {
    what: "The crypt didn't open.",
    next: 'Choose "Enter the crypt" to try again.',
  },
};

/** Final door slot status labels (Requirements 19.2, 20.11). */
export const FINAL_DOOR_STATUS_LABELS: Readonly<Record<SlotStatus, string>> = {
  open: 'Not yet answered',
  solved: 'Solved',
  settled: 'Excluded from score',
  challenged: 'Challenged: excluded from score',
};

/** Messages for the polite live region while playing (Requirement 21). */
export const ROOM_ANNOUNCEMENT_COPY = {
  notice: {
    candleLit: 'The candle catches. One step closer to the light.',
    ghostSpawned: "A ghost rises. You'll meet this one again before the final door.",
    ghostLaidToRest: 'The ghost is laid to rest.',
    sealCracked: 'A seal cracks. A new question takes its place.',
    roomCleared: 'The room is clear. The door opens.',
    escaped: 'You escaped the crypt.',
  },
  status: {
    solved: 'Question solved.',
    settled: 'Question settled. It is excluded from the score.',
    challenged: 'Question challenged. It is excluded from the score.',
  },
  evidence: {
    correct: 'Correct. Your notes are shown.',
    wrong: "Not this time. Here's what your notes say.",
  },
} as const;

export const ESCAPE_COPY = {
  message: 'You stepped out into the light. The crypt is behind you.',
} as const;

/** Text for the button that opens the final door. `doorButtonName()` uses it. */
export const FINAL_DOOR_BUTTON_TEXT = 'Open the final door';

export const ROOM_PLAY_LABELS = {
  openAutopsy: 'Open the Autopsy',
  playAgain: 'Play again',
  submitAnswer: 'Submit answer',
  hint: 'Hint',
  skip: 'Skip',
  challenge: 'Challenge',
  continue: 'Continue',
  noHintsLeft: 'No hints left',
  hintsLeft: (n: number): string => (n === 1 ? '1 hint left' : `${n} hints left`),
  noPenalty: 'Skipping or challenging a question costs nothing. It is left out of your score.',
  emptyAnswer: 'Type an answer first.',
  chooseOption: 'Choose an answer first.',
  wrongOpening: "Not this time. Here's what your notes say.",
  excerptMatched: 'Source excerpt matched',
  challengedLabel: 'Challenged: excluded from score',
  ghostReturnsLater: 'This ghost returns later.',
  ghostName: (n: number): string => `Ghost ${n}: returns later`,
  returnSlotName: (isReview: boolean): string =>
    isReview ? 'Returning question: Review' : 'Returning question',
  unplayableType: "This kind of question can't be played in this version. You can skip it.",
} as const;
