import type { PreparedDocument } from './core-imports';

/** What the server keeps about one set of notes. Held in memory only; never written anywhere. */
export interface StoredNotes {
  readonly notesId: string;
  readonly prepared: PreparedDocument;
  readonly wordCount: number;
}

/** How many sets of notes one server process remembers. The oldest is forgotten first. */
export const MAX_STORED_NOTES = 8;

export interface NotesStore {
  get(notesId: string): StoredNotes | undefined;
  put(notes: StoredNotes): void;
  readonly size: number;
}

/** An in-memory store with a small cap. A restart forgets everything, which is the intended privacy behaviour. */
export function createNotesStore(max = MAX_STORED_NOTES): NotesStore {
  const items = new Map<string, StoredNotes>();
  return {
    get(notesId) {
      const found = items.get(notesId);
      if (found === undefined) return undefined;
      // Touch: a note in use stays.
      items.delete(notesId);
      items.set(notesId, found);
      return found;
    },
    put(notes) {
      items.delete(notes.notesId);
      items.set(notes.notesId, notes);
      while (items.size > max) {
        const oldest = items.keys().next().value;
        if (oldest === undefined) break;
        items.delete(oldest);
      }
    },
    get size() {
      return items.size;
    },
  };
}
