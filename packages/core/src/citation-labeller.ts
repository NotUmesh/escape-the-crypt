import { CITATION_COPY } from './copy';
import type { Chunk } from './types';

/** Display label for a chunk, from its location and edited flag only. */
export function citationLabel(chunk: Chunk): string {
  const loc = chunk.location;
  if (loc.sourceType === 'paste') {
    return CITATION_COPY.pasteParagraph(loc.paragraphNumber);
  }
  const page = loc.pdfPageIndex + 1;
  return chunk.edited
    ? CITATION_COPY.editedPdf(page, loc.printedPageLabel)
    : CITATION_COPY.pdfPage(page, loc.printedPageLabel);
}
