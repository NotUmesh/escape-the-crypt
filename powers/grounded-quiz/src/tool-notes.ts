import {
  CHECK_VERSION,
  MAX_EXTRACTED_WORDS,
  MAX_QUOTE_WORDS,
  MIN_QUOTE_CHARS,
  MIN_QUOTE_WORDS,
  checkWordCount,
  countWords,
  normaliseWithMap,
  prepareDocument,
  resolveQuote,
  toEvidenceContext,
} from './core-imports';
import type { CheckId } from './core-imports';
import { hintFor } from './check-hints';
import { fail, ok, positiveIntArg, stringArg } from './tool-types';
import type { ToolContext, ToolOutcome } from './tool-types';

/** Generous bound on the text of one call; the real limit is the 6,000-word cap on notes. */
const MAX_NOTES_CHARS = 200_000;
const MAX_QUOTE_CHARS = 2_000;
const MAX_NORMALISE_CHARS = 20_000;

type Args = Readonly<Record<string, unknown>>;

/** prepare_notes: split the notes into numbered paragraphs the questions can cite. */
export function prepareNotes(args: Args, ctx: ToolContext): ToolOutcome {
  const text = stringArg(args, 'text', MAX_NOTES_CHARS);
  if ('error' in text) return text.error;
  if (text.value.trim() === '') return fail('empty-notes', 'The notes are empty.');
  const words = countWords(text.value);
  if (!checkWordCount(words).ok) {
    return fail('too-many-words', `The notes have ${words} words. The limit is ${MAX_EXTRACTED_WORDS}. Send a shorter section.`);
  }
  const prepared = prepareDocument(text.value);
  const first = [...prepared.chunks.values()][0];
  if (first === undefined || prepared.quotableChunksByOrdinal.size === 0) {
    return fail('no-quotable-text', 'The notes have no paragraph that can be quoted (only headings or nothing).');
  }
  const notesId = `notes_${first.documentDigest.slice(0, 12)}`;
  ctx.store.put({ notesId, prepared, wordCount: words });
  return ok({
    notesId,
    wordCount: words,
    paragraphCount: prepared.quotableChunksByOrdinal.size,
    headings: prepared.headingContext,
    paragraphs: [...prepared.quotableChunksByOrdinal].map(([paragraph, chunk]) => ({
      paragraph,
      chunkId: chunk.id,
      words: countWords(chunk.text),
      text: chunk.text,
    })),
    quoteRules: { minWords: MIN_QUOTE_WORDS, minChars: MIN_QUOTE_CHARS, maxWords: MAX_QUOTE_WORDS },
    checkVersion: CHECK_VERSION,
  });
}

const RESOLVER_CHECK: Readonly<Record<string, CheckId>> = {
  'not-found': 'quote-not-found',
  ambiguous: 'quote-ambiguous',
  'too-short': 'quote-too-short',
  'unknown-chunk': 'unknown-paragraph/chunk',
};

/** resolve_quote: does this exact quote appear once in this paragraph? Offsets are found by code, never supplied. */
export function resolveQuoteTool(args: Args, ctx: ToolContext): ToolOutcome {
  const id = stringArg(args, 'notesId', 100);
  if ('error' in id) return id.error;
  const paragraph = positiveIntArg(args, 'paragraph');
  if ('error' in paragraph) return paragraph.error;
  const quote = stringArg(args, 'quote', MAX_QUOTE_CHARS);
  if ('error' in quote) return quote.error;
  const notes = ctx.store.get(id.value);
  if (notes === undefined) return unknownNotes();
  const evidence = toEvidenceContext(notes.prepared);
  const chunkId = evidence.paragraphChunkIds.get(paragraph.value);
  if (chunkId === undefined) {
    const checkId: CheckId = 'unknown-paragraph/chunk';
    return ok({
      resolves: false,
      reason: 'unknown-paragraph',
      checkId,
      paragraphCount: notes.prepared.quotableChunksByOrdinal.size,
      ...hintFor(checkId),
    });
  }
  const resolved = resolveQuote(evidence.chunks, chunkId, quote.value);
  if (!resolved.ok) {
    const checkId = RESOLVER_CHECK[resolved.error.kind] ?? 'quote-not-found';
    return ok({
      resolves: false,
      reason: resolved.error.kind,
      ...(resolved.error.kind === 'ambiguous' ? { count: resolved.error.count } : {}),
      checkId,
      ...hintFor(checkId),
    });
  }
  const chunk = evidence.chunks.get(chunkId);
  const matched = chunk === undefined ? '' : chunk.text.slice(resolved.value.start, resolved.value.end);
  const quoteWords = countWords(quote.value);
  const tooLong = quoteWords > MAX_QUOTE_WORDS;
  return ok({
    resolves: true,
    paragraph: paragraph.value,
    chunkId,
    start: resolved.value.start,
    end: resolved.value.end,
    matchedText: matched,
    words: quoteWords,
    lengthOk: !tooLong,
    ...(tooLong ? { checkId: 'quote-too-long', ...hintFor('quote-too-long') } : {}),
    label: 'Source excerpt matched',
  });
}

/** normalise_text: what the resolver compares (NFC, ligatures, curly quotes, line-break hyphens, whitespace). */
export function normaliseTextTool(args: Args): ToolOutcome {
  const text = stringArg(args, 'text', MAX_NORMALISE_CHARS);
  if ('error' in text) return text.error;
  const normalised = normaliseWithMap(text.value).text;
  return ok({ normalised, changed: normalised !== text.value });
}

export function unknownNotes(): ToolOutcome {
  return fail('unknown-notes', 'Unknown notesId. The server forgets notes when it restarts; call prepare_notes again.');
}
