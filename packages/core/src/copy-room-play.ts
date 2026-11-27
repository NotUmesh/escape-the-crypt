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

/** Label shown when a question passed the blind model review (Requirement 15.7). */
export const REVIEW_PASSED_LABEL = 'Blind model review passed';

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
  runeHint: (firstLetter: string, length: number): string =>
    `Hint: the answer starts with "${firstLetter}" and has ${length} letters.`,
  seanceGroupLabel: 'Choose one answer',
  removedByHint: 'Removed by the hint',
  wrongOpening: "Not this time. Here's what your notes say.",
  excerptMatched: 'Source excerpt matched',
  reviewPassed: REVIEW_PASSED_LABEL,
  evidenceChosenOption: 'Your answer',
  evidenceKeyOption: 'The answer your notes support',
  evidenceExcerptsHeading: 'From your notes',
  challengedLabel: 'Challenged: excluded from score',
  ghostReturnsLater: 'This ghost returns later.',
  spiritCandleLit: 'Spirit candle lit',
  /** Text for the lit Spirit_Candles; the singular form is `spiritCandleLit`. */
  spiritCandlesLit: (n: number): string => (n === 1 ? 'Spirit candle lit' : `Spirit candles lit: ${n}`),
  ghostName: (n: number): string => `Ghost ${n}: returns later`,
  returnSlotName: (isReview: boolean): string =>
    isReview ? 'Returning question: Review' : 'Returning question',
  unplayableType: "This kind of question can't be played in this version. You can skip it.",
  autopsyHeading: 'The Autopsy',
  autopsyCountsHeading: 'Outcomes',
  autopsyConceptsHeading: 'Concepts',
  autopsyChallengedStatement: 'Challenged: excluded from the score.',
  autopsyFinalDoorHeading: 'The final door',
  autopsyExcludedStatement: 'Excluded from the score.',
  showExcerpt: 'Show source excerpt',
  hideExcerpt: 'Hide source excerpt',
  excerptUnavailable: 'No source excerpt is available for this concept.',
  lanternToggle: 'Lantern mode',
} as const;

/** Names of the lock objects, keyed by lock type (Requirement 10.3). */
export const LOCK_OBJECT_NAMES = {
  'rune-cipher': { object: 'Rune tablet', kind: 'rune cipher' },
  'seance-board': { object: 'Séance board', kind: 'séance board' },
  'bone-ordering': { object: 'Ossuary shelf', kind: 'bone ordering' },
  'bound-threads': { object: 'Pin frame', kind: 'bound threads' },
  'cursed-object': { object: 'Cursed casket', kind: 'cursed object' },
  'combination-dial': { object: 'Safe', kind: 'combination dial' },
} as const;

/** Display names of the art rooms, by room order: 1st, 2nd, 3rd. */
export const ROOM_DISPLAY_NAMES: readonly string[] = ['Burial chamber', 'Library of bones', 'Sunken chapel'];

/** Name for the room at a zero-based order index; later rooms cycle through the art rooms. */
export function roomDisplayName(orderIndex: number): string {
  const names = ROOM_DISPLAY_NAMES;
  const i = Number.isInteger(orderIndex) && orderIndex >= 0 ? orderIndex : 0;
  return names[i % names.length] ?? 'Burial chamber';
}

/** Status in words for accessible names (Requirement 21.6). */
export const SLOT_STATUS_WORDS: Readonly<Record<SlotStatus, string>> = {
  open: 'unsolved',
  solved: 'solved',
  settled: 'settled, excluded from score',
  challenged: 'challenged, excluded from score',
};

/** Learner-visible failures of a generation job (generation-and-evaluation Requirement 29.9). */
export type GenerationFailureKind = 'expired' | 'budget-exhausted' | 'not-enough-material' | 'generation-failed';
/** Copy for building a crypt from the learner's own notes. */
export const GENERATION_COPY = {
  generateButton: 'Generate from my notes',
  progress: 'Building your crypt from your notes. This can take a minute or two.',
  cancel: 'Cancel',
  cancelled: 'Stopped. Your notes are still here.',
  sampleOffer: 'Play the sample crypt instead',
  failures: {
    expired: {
      what: 'This crypt was cleared away before it could be opened.',
      next: 'Generate it again from your notes, or play the sample crypt.',
    },
    'budget-exhausted': {
      what: "We can't build new crypts right now. Today's generation budget is used up.",
      next: 'Try again tomorrow, or play the sample crypt.',
    },
    'not-enough-material': {
      what: "Your notes don't hold enough to build questions from.",
      next: 'Add more notes and try again, or play the sample crypt.',
    },
    'generation-failed': {
      what: "Something went wrong while building your crypt, so we set it aside.",
      next: 'Try again, or play the sample crypt.',
    },
  } satisfies Readonly<Record<GenerationFailureKind, ErrorCopy>>,
} as const;