import { buildSampleFromLayout } from './sample-builder';
import type { SampleCryptError, SampleCryptResult, SampleLayout, SampleQuestionsFile } from './sample-builder';
import type { Result } from '../types';

export const PRINTING_PRESS_CONCEPT_TITLES: Readonly<Record<string, string>> = {
  'pp-c01': 'Printing a page, step by step',
  'pp-c02': "What Gutenberg did not invent",
  'pp-c03': 'Earlier movable type',
  'pp-c04': 'Lines on a Gutenberg Bible page',
  'pp-c05': 'How many copies were printed',
  'pp-c06': 'Where the press was built',
  'pp-c07': 'What the press changed',
};

// Room 1: bone ordering, cursed object. Room 2: bound threads, rune cipher.
// Final door: combination dial (twice) and séance board. All six types, each cited from the notes.
const LAYOUT: SampleLayout = {
  manifestId: 'printing-press-sample',
  rooms: [
    {
      roomId: 'pp-room-1',
      slots: [
        { slotId: 'pp-slot-1', stationType: 'bone-ordering', conceptId: 'pp-c01', primaryId: 'pp-q01', alternateId: 'pp-q02' },
        { slotId: 'pp-slot-2', stationType: 'cursed-object', conceptId: 'pp-c02', primaryId: 'pp-q03', alternateId: 'pp-q04' },
      ],
    },
    {
      roomId: 'pp-room-2',
      slots: [
        { slotId: 'pp-slot-3', stationType: 'bound-threads', conceptId: 'pp-c03', primaryId: 'pp-q05', alternateId: 'pp-q06' },
        { slotId: 'pp-slot-4', stationType: 'rune-cipher', conceptId: 'pp-c06', primaryId: 'pp-q09', alternateId: null },
      ],
    },
  ],
  finalDoor: [
    { slotId: 'pp-final-1', conceptId: 'pp-c04', questionId: 'pp-q07' },
    { slotId: 'pp-final-2', conceptId: 'pp-c05', questionId: 'pp-q08' },
    { slotId: 'pp-final-3', conceptId: 'pp-c07', questionId: 'pp-q10' },
  ],
  conceptTitles: PRINTING_PRESS_CONCEPT_TITLES,
};

/** Builds the printing-press sample crypt from `samples/printing-press.txt` and its questions file. */
export function buildPrintingPressSampleCrypt(
  notesText: string,
  questionsJson: SampleQuestionsFile,
): Result<SampleCryptResult, SampleCryptError> {
  return buildSampleFromLayout(LAYOUT, notesText, questionsJson);
}
