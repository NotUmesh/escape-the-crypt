import { buildSampleFromLayout } from './sample-builder';
import type { SampleCryptError, SampleCryptResult, SampleLayout, SampleQuestionError, SampleQuestionsFile } from './sample-builder';
import type { Result } from '../types';

export type { SampleCryptError, SampleCryptResult, SampleQuestionError };
/** Kept under its original name: the web app and tests import it. */
export type HumanHeartQuestionsFile = SampleQuestionsFile;

/** True only when the sample file records `status === 'human-reviewed'`. A data read, never inferred. */
export function isHumanReviewed(file: HumanHeartQuestionsFile): boolean {
  return file.status === 'human-reviewed';
}

// Plain-text concept titles for the sample. The questions file carries none.
export const SAMPLE_CONCEPT_TITLES: Readonly<Record<string, string>> = {
  'hh-c01': 'The atrioventricular valves',
  'hh-c02': 'What each chamber does',
  'hh-c03': 'The path of blood through the right side',
  'hh-c04': 'Blood vessels and their jobs',
  'hh-c05': 'The four chambers',
  'hh-c06': 'Resting heart rate',
  'hh-c07': "The heart's natural pacemaker",
};

// Fixed selection. Room 1: rune cipher, séance board. Room 2: bone ordering, bound threads.
// Final door: cursed object, combination dial, rune cipher. All six types, each cited from the notes.
const LAYOUT: SampleLayout = {
  manifestId: 'human-heart-sample',
  rooms: [
    {
      roomId: 'hh-room-1',
      slots: [
        { slotId: 'hh-slot-1', stationType: 'rune-cipher', conceptId: 'hh-c01', primaryId: 'hh-q01', alternateId: 'hh-q02' },
        { slotId: 'hh-slot-2', stationType: 'seance-board', conceptId: 'hh-c02', primaryId: 'hh-q03', alternateId: 'hh-q04' },
      ],
    },
  ],
  finalDoor: [
    { slotId: 'hh-final-1', conceptId: 'hh-c03', questionId: 'hh-q06' },
    { slotId: 'hh-final-2', conceptId: 'hh-c04', questionId: 'hh-q08' },
    { slotId: 'hh-final-3', conceptId: 'hh-c07', questionId: 'hh-q12' },
  ],
  conceptTitles: SAMPLE_CONCEPT_TITLES,
};

/** Builds the human-heart sample crypt from `samples/human-heart.txt` and its questions file. */
export function buildHumanHeartSampleCrypt(
  notesText: string,
  questionsJson: HumanHeartQuestionsFile,
): Result<SampleCryptResult, SampleCryptError> {
  return buildSampleFromLayout(LAYOUT, notesText, questionsJson);
}
