import { runRoomChecks, type CheckableQuestion, type EvidenceContext } from '../checks/run-checks';
import type { CheckFailure } from '../checks/types';
import type { Chunk } from '../types';

const CHUNK: Chunk = {
  id: 'chk_dup_0',
  documentDigest: 'dup',
  position: 0,
  text:
    'Mitochondria produce most of the energy a cell uses. Ribosomes build proteins from amino acids. ' +
    'The nucleus stores the genetic material of the cell.',
  location: { sourceType: 'paste', paragraphNumber: 1 },
  edited: false,
};
export const DUPLICATE_CONTEXT: EvidenceContext = {
  chunks: new Map([[CHUNK.id, CHUNK]]),
  paragraphChunkIds: new Map([[1, CHUNK.id]]),
};
const Q_ENERGY = 'Mitochondria produce most of the energy';
const Q_PROTEINS = 'Ribosomes build proteins from amino acids';
const Q_NUCLEUS = 'The nucleus stores the genetic material';

/** A rune cipher question of concept `c` whose answer is "Mitochondria". */
export function runeMitochondria(conceptId = 'c', id = 'q'): CheckableQuestion {
  return {
    id,
    conceptId,
    role: 'primary',
    lockType: 'rune-cipher',
    prompt: 'According to your notes, the ______ produce most of the energy a cell uses.',
    answer: 'Mitochondria',
    aliases: [],
    caseSensitive: false,
    evidence: [{ paragraph: 1, quote: Q_ENERGY }],
    explanation: '-',
  };
}

/** A séance question whose key option reads `keyText`, with sound evidence for every option. */
export function seanceWithKey(keyText: string, conceptId: string, id: string, role: 'primary' | 'alternate' = 'primary'): CheckableQuestion {
  return {
    id,
    conceptId,
    role,
    lockType: 'seance-board',
    prompt: 'According to your notes, which part of the cell produces most of its energy?',
    options: [
      { id: 'a', text: keyText, label: 'supported', evidence: { paragraph: 1, quote: Q_ENERGY } },
      { id: 'b', text: 'The ribosomes', label: 'contradicted', evidence: { paragraph: 1, quote: Q_PROTEINS } },
      { id: 'c', text: 'The nucleus', label: 'contradicted', evidence: { paragraph: 1, quote: Q_NUCLEUS } },
    ],
    answer: 'a',
    explanation: '-',
  };
}

/**
 * Registry input for `duplicate-answer-in-room`: "The mitochondria" (concept c2's séance key)
 * and "Mitochondria" (concept c's rune answer) normalise alike. Failures for question `q` only.
 */
export function duplicateAnswerCase(): readonly CheckFailure[] {
  return runRoomChecks([runeMitochondria(), seanceWithKey('The mitochondria', 'c2', 'other')], DUPLICATE_CONTEXT).filter(
    (f) => f.questionId === 'q',
  );
}
