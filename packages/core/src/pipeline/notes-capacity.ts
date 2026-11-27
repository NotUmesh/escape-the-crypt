import { lengthAvailability, type LengthAvailability } from '../run-length';
import { prepareDocument } from './prepare-input';

/**
 * Which crypt lengths a note can plausibly fill, from its quotable chunk count. Chunks the same
 * way the worker does (the text is chunked as pasted notes), so the setup screen and the pipeline
 * agree on what "a chunk" is. An estimate: it only switches off lengths the notes clearly cannot fill.
 */
export function lengthAvailabilityForNotes(notesText: string): LengthAvailability {
  return lengthAvailability(prepareDocument(notesText).quotableChunksByOrdinal.size);
}
