import { citationLabel, resolveQuote } from '@escape-the-crypt/core';
import type { Chunk, JobBundle } from '@escape-the-crypt/core';

/** What the worker says about the crypt beyond its rooms, as `?notices=1` sends it. */
export type WorkerNotices = NonNullable<JobBundle['notices']>;

/** One passage of a conflict, checked against the learner's own notes. */
export interface NoticePassage {
  readonly quote: string;
  /** "Paragraph 3 of your notes", or the edited-PDF wording. */
  readonly citationLabel: string;
}

/** A concept that was left out because two passages seem to disagree. */
export interface LeftOutConcept {
  readonly conceptId: string;
  readonly title: string;
  /**
   * Both passages, or none. A passage is kept only when its chunk is one of the learner's chunks and
   * its quote resolves to exactly one place in it; if either fails, neither is shown.
   */
  readonly passages: readonly NoticePassage[];
}

/** The notice the app shows. Present only when at least one concept was left out. */
export interface CryptNotices {
  readonly leftOut: readonly LeftOutConcept[];
}

/**
 * Checks the worker's notices against the chunks of the notes that were sent. The app never trusts
 * a passage the worker names: the chunk must be the learner's, and the quote must be in it (the same
 * resolver the evidence panel uses). The title is shown as plain text. Returns `undefined` when there
 * is nothing to say. Pure; never throws.
 */
export function checkedNotices(
  notices: WorkerNotices | undefined,
  chunks: ReadonlyMap<string, Chunk>,
): CryptNotices | undefined {
  if (notices === undefined || notices.excluded.length === 0) return undefined;
  const leftOut = notices.excluded.map((concept): LeftOutConcept => {
    const passages: NoticePassage[] = [];
    for (const passage of concept.passages) {
      const chunk = chunks.get(passage.chunkId);
      if (chunk === undefined || !resolveQuote(chunks, passage.chunkId, passage.quote).ok) break;
      passages.push({ quote: passage.quote, citationLabel: citationLabel(chunk, 'notes') });
    }
    return {
      conceptId: concept.conceptId,
      title: concept.conceptTitle,
      passages: passages.length === 2 ? passages : [],
    };
  });
  return { leftOut };
}
