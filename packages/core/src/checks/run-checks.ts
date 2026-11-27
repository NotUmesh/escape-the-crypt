import type { AuthoringQuestion } from '../authoring/schema';
import { boneOrderingChecks } from '../locks/bone-ordering-checks';
import { boundThreadsChecks } from '../locks/bound-threads-checks';
import { combinationDialChecks } from '../locks/combination-dial-checks';
import { cursedObjectChecks } from '../locks/cursed-object-checks';
import { runeCipherChecks } from '../locks/rune-cipher-checks';
import { checkSeanceBoard } from '../locks/seance-board-checks';
import type { Chunk } from '../types';
import { checkAlternate, checkMaxOneAlternate } from './alternate';
import { answerKeysOfAuthoring, duplicateAnswerScan } from './duplicate-answers';
import { checkBannedPhrase, checkNegativeQuestion, checkQuote } from './evidence';
import { leakScanRoom, type LeakScanRoomEntry } from './leak-scan';
import type { CheckFailure } from './types';

/** Any question runChecks accepts. Narrow on `lockType`. */
export type CheckableQuestion = AuthoringQuestion;

/** Chunk lookup shared by every question of a job. */
export interface EvidenceContext {
  readonly chunks: ReadonlyMap<string, Chunk>;
  /**
   * Authoring paragraph number -> code-assigned chunk ID. Heading paragraphs ARE in the map, so
   * numbering matches citation labels; a cited heading fails on quote length, not on lookup.
   */
  readonly paragraphChunkIds: ReadonlyMap<number, string>;
}

/**
 * Input for one question.
 * - `question`: the question under test.
 * - `siblings`: the other questions of the same concept (any role). Used only for the
 *   alternate checks, and only when `question.role === 'alternate'`. Questions with a
 *   different `conceptId` are ignored. Omit when there are none.
 */
export interface RunChecksInput extends EvidenceContext {
  readonly question: CheckableQuestion;
  readonly siblings?: readonly CheckableQuestion[];
}

const SUPPORTED_LOCK_TYPES: readonly string[] = [
  'rune-cipher',
  'seance-board',
  'bone-ordering',
  'bound-threads',
  'cursed-object',
  'combination-dial',
];

/** Every learner-visible text of a question, for banned-phrase scanning and the leak scan. */
export function visibleTextOf(q: CheckableQuestion): readonly string[] {
  if (q.lockType === 'rune-cipher') return [q.prompt, q.explanation];
  if (q.lockType === 'seance-board') return [q.prompt, ...q.options.map((o) => o.text), q.explanation];
  if (q.lockType === 'bone-ordering') return [q.prompt, ...q.steps, q.explanation];
  if (q.lockType === 'bound-threads') {
    return [q.prompt, ...q.pairs.flatMap((p) => [p.left, p.right]), q.explanation];
  }
  if (q.lockType === 'cursed-object') return [q.prompt, ...q.items, q.explanation];
  if (q.lockType === 'combination-dial') return [q.prompt, q.units, q.explanation];
  return [];
}

function dedupe(failures: readonly CheckFailure[]): CheckFailure[] {
  const seen = new Set<string>();
  const out: CheckFailure[] = [];
  for (const f of failures) {
    const key = `${f.questionId}\u0000${f.checkId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(f);
  }
  return out;
}

function compareCodeUnits(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function sortFailures(failures: readonly CheckFailure[]): readonly CheckFailure[] {
  return [...failures].sort(
    (a, b) =>
      compareCodeUnits(a.questionId, b.questionId) || compareCodeUnits(a.checkId, b.checkId),
  );
}

function alternateChecks(
  question: AuthoringQuestion,
  siblings: readonly CheckableQuestion[],
  context: EvidenceContext,
): CheckFailure[] {
  if (question.role !== 'alternate') return [];
  const sameConcept = siblings.filter(
    (s) => s.conceptId === question.conceptId && s.id !== question.id,
  );
  const failures: CheckFailure[] = [];
  // Lowest-id primary, so the result does not depend on input order.
  const primary = sameConcept
    .filter((s) => s.role === 'primary')
    .sort((a, b) => compareCodeUnits(a.id, b.id))[0];
  if (primary) failures.push(...checkAlternate(primary, question, context));
  // Sort by id so the "first" alternate does not depend on input order.
  const alternates = [question, ...sameConcept.filter((s) => s.role === 'alternate')].sort(
    (a, b) => compareCodeUnits(a.id, b.id),
  );
  failures.push(
    ...checkMaxOneAlternate(question.conceptId, alternates).filter((f) => f.questionId === question.id),
  );
  return failures;
}

/**
 * Runs every implemented Code_Check for one question. Pure, total and deterministic:
 * the same input gives the same failures in the same order, with duplicates removed.
 * All six lock types have checks, so `lock-type-not-supported` is never returned for them. It stays
 * registered (Req 3.5) and is returned only for a `lockType` outside the six, which the types cannot express
 * but untrusted input can carry.
 * `answer-leak-in-room` is room-level; see `runRoomChecks`.
 */
export function runChecks(input: RunChecksInput): readonly CheckFailure[] {
  const { question, siblings = [], chunks, paragraphChunkIds } = input;
  if (!SUPPORTED_LOCK_TYPES.includes((question as { lockType: string }).lockType)) {
    return [{ checkId: 'lock-type-not-supported', questionId: question.id }];
  }

  const failures: CheckFailure[] = [];
  if (question.lockType === 'rune-cipher') {
    for (const e of question.evidence) {
      const failure = checkQuote(
        chunks,
        { paragraphChunkId: paragraphChunkIds.get(e.paragraph) ?? '', quote: e.quote },
        question.id,
      );
      if (failure) failures.push(failure);
    }
    failures.push(...runeCipherChecks(question, { chunks, paragraphChunkIds }));
  } else if (question.lockType === 'bone-ordering') {
    // Includes each evidence quote's own checks.
    failures.push(...boneOrderingChecks(question, { chunks, paragraphChunkIds }));
  } else if (question.lockType === 'bound-threads') {
    // Includes each pair's quote checks.
    failures.push(...boundThreadsChecks(question, { chunks, paragraphChunkIds }));
  } else if (question.lockType === 'cursed-object') {
    // Includes each evidence quote's own checks.
    failures.push(...cursedObjectChecks(question, { chunks, paragraphChunkIds }));
  } else if (question.lockType === 'combination-dial') {
    // Includes each evidence quote's own checks.
    failures.push(...combinationDialChecks(question, { chunks, paragraphChunkIds }));
  } else {
    // Includes each option's quote checks.
    failures.push(...checkSeanceBoard(question, { chunks, paragraphChunkIds }));
  }

  const banned = checkBannedPhrase(visibleTextOf(question), question.id);
  if (banned) failures.push(banned);
  const negative = checkNegativeQuestion(question.prompt, question.id, question.lockType);
  if (negative) failures.push(negative);
  failures.push(...alternateChecks(question, siblings, { chunks, paragraphChunkIds }));
  return dedupe(failures);
}

/**
 * Runs `runChecks` for every question of a room (siblings derived from `conceptId`)
 * plus the room-level Leak_Scan and duplicate-answer scan. The result is sorted by question ID then Check_ID,
 * so it does not depend on the order of `questions`.
 */
export function runRoomChecks(
  questions: readonly CheckableQuestion[],
  context: EvidenceContext,
): readonly CheckFailure[] {
  const failures: CheckFailure[] = [];
  for (const question of questions) {
    const siblings = questions.filter((q) => q.conceptId === question.conceptId && q !== question);
    failures.push(...runChecks({ question, siblings, ...context }));
  }
  const entries: LeakScanRoomEntry[] = questions.map((q) => ({
    conceptId: q.conceptId,
    question: q,
    visibleText: visibleTextOf(q),
  }));
  failures.push(...leakScanRoom(entries));
  failures.push(
    ...duplicateAnswerScan(
      questions.map((q) => ({ conceptId: q.conceptId, questionId: q.id, keys: answerKeysOfAuthoring(q) })),
    ),
  );
  return sortFailures(dedupe(failures));
}
