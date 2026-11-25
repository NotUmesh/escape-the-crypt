import type { RuneCipherAuthoringQuestion } from '../authoring/schema';
import { normaliseRuneAnswer } from '../locks/rune-cipher';
import type { CheckFailure } from './types';

export interface LeakScanEntry {
  readonly conceptId: string;
  readonly question: RuneCipherAuthoringQuestion;
  /** Everything the learner can see for this question: prompt, option text, explanation. */
  readonly visibleText: readonly string[];
}

/** Entries for any lock type; only rune cipher questions are scanned for. */
export interface LeakScanRoomEntry {
  readonly conceptId: string;
  readonly question: { readonly id: string; readonly lockType: string };
  readonly visibleText: readonly string[];
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function isRune(entry: LeakScanRoomEntry | LeakScanEntry): entry is LeakScanEntry {
  return entry.question.lockType === 'rune-cipher';
}

/**
 * Leak_Scan: fails with `answer-leak-in-room` for each rune cipher answer found,
 * on word boundaries, in another concept's visible text. Keyed by `conceptId`, so
 * a concept's own alternate may mention its own answer. Pure.
 */
export function leakScanRoom(roomQuestions: readonly LeakScanRoomEntry[]): readonly CheckFailure[] {
  const failures: CheckFailure[] = [];
  for (const entry of roomQuestions) {
    if (!isRune(entry)) continue;
    const { question } = entry;
    const answer = normaliseRuneAnswer(question.answer, question.caseSensitive);
    if (answer === '') continue;
    const pattern = new RegExp(`(^|\\W)${escapeRegExp(answer)}(\\W|$)`);
    const leaked = roomQuestions.some(
      (other) =>
        other.conceptId !== entry.conceptId &&
        other.visibleText.some((text) =>
          pattern.test(normaliseRuneAnswer(text, question.caseSensitive)),
        ),
    );
    if (leaked) failures.push({ checkId: 'answer-leak-in-room', questionId: question.id });
  }
  return failures;
}
