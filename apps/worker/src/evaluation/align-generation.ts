import type { CassetteFile } from '@escape-the-crypt/core';
import { parseGenerationReply, type RaterQuestion } from './rater-question';
import type { NoteRun } from './result-file';

export interface GeneratedPair {
  readonly primary: RaterQuestion | null;
  readonly alternate: RaterQuestion | null;
}

export type Alignment =
  | { readonly ok: true; readonly byConcept: ReadonlyMap<number, GeneratedPair> }
  | { readonly ok: false; readonly reason: string };

/**
 * Finds, for each concept of one note run, the generation reply the model gave, using only the
 * result file and the note's cassette. The result file stores Prompt_Digests in the order calls
 * started, not which concept each belonged to, so the match is by order:
 *
 *   - the cassette entries a note's digests point at that parse as generation replies, in order,
 *     are matched to the concepts whose generation outcome is `questions` or `no-lock`, in concept
 *     order (generation tasks are queued, and so start, in concept order);
 *   - then every candidate in the result file must find a question of the same lock type in its
 *     role. The counts must match too.
 *
 * Anything else (a retried call, a failed call, a re-recorded cassette) is refused with a reason
 * rather than guessed: a rater must never be shown the wrong question under a result's label.
 */
export function alignGeneration(note: NoteRun, cassette: CassetteFile): Alignment {
  const byDigest = new Map(cassette.entries.map((e) => [e.digest, e] as const));
  const replies: GeneratedPair[] = [];
  for (const digest of note.promptDigests) {
    const entry = byDigest.get(digest);
    const parsed = entry === undefined ? null : parseGenerationReply(entry.response.json);
    if (parsed !== null) replies.push(parsed);
  }
  const concepts = [...note.concepts]
    .filter((c) => c.generation === 'questions' || c.generation === 'no-lock')
    .sort((a, b) => a.conceptIndex - b.conceptIndex);
  if (replies.length !== concepts.length) {
    return { ok: false, reason: `${concepts.length} concept(s) generated but ${replies.length} generation reply(ies) found in the cassette` };
  }
  const byConcept = new Map<number, GeneratedPair>();
  concepts.forEach((c, i) => byConcept.set(c.conceptIndex, replies[i] as GeneratedPair));
  for (const candidate of note.candidates) {
    const question = byConcept.get(candidate.conceptIndex)?.[candidate.role];
    if (question === undefined || question === null || question.lockType !== candidate.lockType) {
      return { ok: false, reason: `concept ${candidate.conceptIndex} ${candidate.role} does not match the cassette (expected ${candidate.lockType})` };
    }
  }
  return { ok: true, byConcept };
}
