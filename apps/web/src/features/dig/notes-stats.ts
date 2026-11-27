import type { Chunk } from '@escape-the-crypt/core';

/** The real size of the confirmed notes, as the dig shows it: pieces (chunks) and words. */
export interface NotesStats {
  readonly pieces: number;
  readonly words: number;
}

/** Counts from the confirmed chunks and the text sent. Nothing but two numbers is kept. */
export function notesStats(chunks: readonly Chunk[], text: string): NotesStats {
  const trimmed = text.trim();
  return { pieces: chunks.length, words: trimmed === '' ? 0 : trimmed.split(/\s+/).length };
}
