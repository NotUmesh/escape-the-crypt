// Feature: persistence, Property 20: New feature copy avoids banned wording
// **Validates: Requirements 10.9, 12.15**
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { StorageErrorKind } from '../../state/storage/storage-error';
import {
  EXPORT_BUTTON_LABEL,
  EXPORT_DONE_TEXT,
  EXPORT_FAILED_TEXT,
  EXPORT_NO_NOTES_TEXT,
} from './export-control';
import {
  ESCAPED_TEXT,
  FINAL_DOOR_TEXT,
  READ_ONLY_HINT,
  READ_ONLY_RESTORE_FAILED,
  READ_ONLY_TITLE,
  TAKE_OVER_LABEL,
} from './read-only-screen';
import {
  CONTINUE_LABEL,
  NOTES_MISSING_TEXT,
  RESTORE_FAILED_TEXT,
  RESUME_GROUP_LABEL,
  START_AGAIN_LABEL,
  restoreFailureText,
} from './resume-entry';
import { SAVE_BANNER_TEXT } from './save-banner';

const BANNED_WORDING: readonly string[] = [
  'verified',
  'guaranteed',
  '100% accurate',
  'hallucination-free',
  'mastered',
  'exam-ready',
];
const LEARNING_GAIN_CLAIMS: readonly string[] = [
  'learn faster',
  'learn more',
  'improve your',
  'better grades',
  'higher grades',
  'retention',
  'remember more',
  'boost your',
];
const FORBIDDEN: readonly string[] = [...BANNED_WORDING, ...LEARNING_GAIN_CLAIMS];

const STORAGE_ERROR_KINDS: readonly StorageErrorKind[] = [
  'storage-unavailable',
  'unsupported-version',
  'crypt-invalid',
  'manifest-conflict',
  'record-unreadable',
  'run-not-found',
  'event-log-gap',
  'event-log-rejected',
  'notes-unavailable',
  'write-failed',
  'quota-exceeded',
];

const NEW_COPY: readonly string[] = [
  RESTORE_FAILED_TEXT,
  NOTES_MISSING_TEXT,
  CONTINUE_LABEL,
  START_AGAIN_LABEL,
  RESUME_GROUP_LABEL,
  READ_ONLY_TITLE,
  READ_ONLY_HINT,
  READ_ONLY_RESTORE_FAILED,
  TAKE_OVER_LABEL,
  FINAL_DOOR_TEXT,
  ESCAPED_TEXT,
  SAVE_BANNER_TEXT,
  EXPORT_BUTTON_LABEL,
  EXPORT_DONE_TEXT,
  EXPORT_NO_NOTES_TEXT,
  EXPORT_FAILED_TEXT,
  ...STORAGE_ERROR_KINDS.map(restoreFailureText),
];

function forbiddenIn(text: string): string[] {
  const lower = text.toLowerCase();
  return FORBIDDEN.filter((term) => lower.includes(term));
}

describe('new feature copy wording', () => {
  it('Property 20: no new string uses banned wording or claims learning gains', () => {
    fc.assert(
      fc.property(fc.constantFrom(...NEW_COPY), (text) => {
        expect(text.length).toBeGreaterThan(0);
        expect(forbiddenIn(text)).toEqual([]);
      }),
      { numRuns: Math.max(100, NEW_COPY.length * 3) },
    );
  });

  it('checks every string, not only a sample', () => {
    for (const text of NEW_COPY) expect(forbiddenIn(text)).toEqual([]);
  });

  it('the banned list catches each term, in any letter case', () => {
    for (const term of FORBIDDEN) {
      expect(forbiddenIn(`Your crypt is ${term.toUpperCase()} today.`)).toContain(term);
    }
  });
});
