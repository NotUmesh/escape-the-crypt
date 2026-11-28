import { buildSampleFromLayout } from './sample-builder';
import type { SampleCryptError, SampleCryptResult, SampleLayout, SampleQuestionsFile } from './sample-builder';
import type { Result } from '../types';

export const HTTPS_CONCEPT_TITLES: Readonly<Record<string, string>> = {
  'hs-c01': 'The TLS 1.2 handshake',
  'hs-c02': 'What TLS protects',
  'hs-c03': 'Keys and certificates',
  'hs-c04': 'The HTTPS port',
  'hs-c05': 'TLS 1.3 round trips',
  'hs-c06': 'What the padlock means',
  'hs-c07': 'Who signs certificates',
};

// Room 1: bone ordering, cursed object. Room 2: bound threads, rune cipher.
// Final door: combination dial (twice) and séance board. All six types, each cited from the notes.
const LAYOUT: SampleLayout = {
  manifestId: 'https-sample',
  rooms: [
    {
      roomId: 'hs-room-1',
      slots: [
        { slotId: 'hs-slot-1', stationType: 'bone-ordering', conceptId: 'hs-c01', primaryId: 'hs-q01', alternateId: 'hs-q02' },
        { slotId: 'hs-slot-2', stationType: 'cursed-object', conceptId: 'hs-c02', primaryId: 'hs-q03', alternateId: 'hs-q04' },
      ],
    },
    {
      roomId: 'hs-room-2',
      slots: [
        { slotId: 'hs-slot-3', stationType: 'bound-threads', conceptId: 'hs-c03', primaryId: 'hs-q05', alternateId: 'hs-q06' },
        { slotId: 'hs-slot-4', stationType: 'rune-cipher', conceptId: 'hs-c07', primaryId: 'hs-q10', alternateId: null },
      ],
    },
  ],
  finalDoor: [
    { slotId: 'hs-final-1', conceptId: 'hs-c04', questionId: 'hs-q07' },
    { slotId: 'hs-final-2', conceptId: 'hs-c05', questionId: 'hs-q08' },
    { slotId: 'hs-final-3', conceptId: 'hs-c06', questionId: 'hs-q09' },
  ],
  conceptTitles: HTTPS_CONCEPT_TITLES,
};

/** Builds the HTTPS sample crypt from `samples/https.txt` and its questions file. */
export function buildHttpsSampleCrypt(
  notesText: string,
  questionsJson: SampleQuestionsFile,
): Result<SampleCryptResult, SampleCryptError> {
  return buildSampleFromLayout(LAYOUT, notesText, questionsJson);
}
