import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { chunkDocument } from './chunker';
import { normaliseWithMap } from './normalise';
import { buildConceptExtractionUserMessage } from './pipeline/concept-extraction-prompt';
import { prepareDocument } from './pipeline/prepare-input';
import { resolveQuote } from './quote-resolver';
import { reflowLineBreaks } from './reflow';
import {
  unwrappedParagraphArb,
  wrapOptionsArb,
  wrapParagraph,
} from './test-support/wrap-arbitraries';
const pdf = (text: string) => ({
  sourceType: 'pdf' as const,
  pages: [{ pdfPageIndex: 0, printedPageLabel: null, text, originalText: text }],
});
const paste = (text: string) => ({ sourceType: 'paste' as const, text, originalText: text });
describe('reflowLineBreaks', () => {
  it('joins a soft hyphen break and keeps a hyphen before a digit', () => {
    expect(reflowLineBreaks('an exam-\nple of it')).toBe('an example of it');
    expect(reflowLineBreaks('an exam- \n  ple')).toBe('an example');
    expect(reflowLineBreaks('see pages 5-\n10 now')).toBe('see pages 5-10 now');
    expect(reflowLineBreaks('see pp. 5-\n10.')).toBe('see pp. 5-10.');
  });
  it('keeps real compounds that are not at a line end', () => {
    expect(reflowLineBreaks('a well-known\nfinding on self-esteem')).toBe(
      'a well-known finding on self-esteem',
    );
  });
  it('joins single line breaks inside a paragraph into one space', () => {
    expect(reflowLineBreaks('one two\nthree four\r\nfive')).toBe('one two three four five');
    expect(reflowLineBreaks('trailing  \n  spaces')).toBe('trailing spaces');
  });
  it('keeps paragraph breaks exactly', () => {
    expect(reflowLineBreaks('one\ntwo\n\nthree\nfour')).toBe('one two\n\nthree four');
    expect(reflowLineBreaks('a.\n \t\nb.')).toBe('a.\n \t\nb.');
    expect(reflowLineBreaks('exam-\n\nple')).toBe('exam-\n\nple');
  });
  it('keeps heading lines on their own line', () => {
    expect(reflowLineBreaks('STAGES OF SLEEP\nA night of sleep\nmoves on.')).toBe(
      'STAGES OF SLEEP\nA night of sleep moves on.',
    );
    expect(reflowLineBreaks('End of one.\nWHY IT MATTERS\nStudies show it.')).toBe(
      'End of one.\nWHY IT MATTERS\nStudies show it.',
    );
  });
  it('joins an all-caps line that is part of a wrapped sentence', () => {
    expect(reflowLineBreaks('the mission was run by\nNASA\nin 1969.')).toBe(
      'the mission was run by NASA in 1969.',
    );
    expect(reflowLineBreaks('It ended.\nNASA\nlater said so.')).toBe('It ended. NASA later said so.');
  });
  it('keeps list items on their own lines and joins their wrapped continuations', () => {
    const text = 'The stages are:\n1. Light sleep, when the body\n   relaxes.\n2. Deeper sleep.\n- a dash item\n\u2022 a bullet';
    expect(reflowLineBreaks(text)).toBe(
      'The stages are:\n1. Light sleep, when the body relaxes.\n2. Deeper sleep.\n- a dash item\n\u2022 a bullet',
    );
  });
  it('does not treat a number that ends a wrapped line as a list item', () => {
    expect(reflowLineBreaks('it was founded in\n1999. Later it grew.')).toBe(
      'it was founded in 1999. Later it grew.',
    );
  });
  it('agrees with normaliseWithMap on which hyphens are line-break hyphens', () => {
    // Same hyphen decisions; whitespace may differ ("5-10" here, "5- 10" after normalise alone).
    const squash = (s: string): string => normaliseWithMap(s).text.replace(/ /g, '');
    for (const s of ['exam-\nple', 'pages 5-\n10', 'x-\n"y"', 'a- \n b', 'Anglo-\nSaxon']) {
      expect(squash(reflowLineBreaks(s))).toBe(squash(s));
    }
  });
});
describe('PDF-shaped dev fixture (eval/dev/notes/dev-11)', () => {
  const [fsName, urlName]: string[] = ['node:fs', 'node:url'];
  it('chunks into whole headings, joined prose and kept list items', async () => {
    const fs = (await import(fsName!)) as unknown as { readFileSync(p: string, e: string): string };
    const url = (await import(urlName!)) as unknown as { fileURLToPath(h: string): string };
    const here = url
      .fileURLToPath((import.meta as unknown as { url: string }).url)
      .replace(/\\/g, '/')
      .replace(/\/[^/]*$/, '');
    const path = `${here}/../../../eval/dev/notes/dev-11-pdf-sleep-and-memory.txt`;
    const texts = chunkDocument(pdf(fs.readFileSync(path, 'utf8'))).map((c) => c.text);
    // Headings shorter than MIN_CHUNK_CHARS are merged into the next piece (mergeShort).
    expect(texts).toEqual([
      'SLEEP AND MEMORY\n\nSleep is a well-known aid to learning, although the reasons are still being studied. During sleep the brain replays recent experiences, and this replay is thought to help move new information into long-term storage. The process is called memory consolidation. Researchers who study consolidation often compare sleep-deprived volunteers with rested ones.',
      'STAGES OF SLEEP\n\nA night of sleep moves through four stages in a fixed order. The stages are:',
      '1. Light sleep, when the body begins to relax.\n2. Deeper sleep, when heart rate and breathing slow down.\n3. Slow-wave sleep, the deepest stage, when the brain is hardest to wake.\n4. REM sleep, when most vivid dreams occur.',
      'WHY IT MATTERS\n\nStudies of students suggest that self-esteem and mood also depend on sleep. In one well-known experiment, volunteers who slept for eight hours recalled more word pairs than volunteers who stayed awake. The full results appear on pp. 5-10 of the lab report.',
      'The effect is strongest for facts that were studied just before bed. Adults need about seven to nine hours of sleep, while teenagers need about eight to ten hours.',
    ]);
  });
});
// Feature: generation-and-evaluation, PDF line-break reflow (phase 4 quality fix)
describe('Property: a wrapped paragraph reads the same as the unwrapped paragraph', () => {
  it('reflow restores the unwrapped paragraph for any width, with or without soft hyphens', () => {
    fc.assert(
      fc.property(unwrappedParagraphArb(), wrapOptionsArb, (paragraph, options) => {
        expect(reflowLineBreaks(wrapParagraph(paragraph, options))).toBe(paragraph);
      }),
      { numRuns: 300 },
    );
  });
  it('the chunks the model reads join back to the unwrapped paragraph (PDF and paste)', () => {
    fc.assert(
      fc.property(unwrappedParagraphArb(30), wrapOptionsArb, (paragraph, options) => {
        const wrapped = wrapParagraph(paragraph, options);
        for (const input of [pdf(wrapped), paste(wrapped)]) {
          const doc = prepareDocument(input);
          const texts = [...doc.quotableChunksByOrdinal.values()].map((c) => c.text);
          expect(texts.join(' ')).toBe(paragraph);
          const prompt = buildConceptExtractionUserMessage(doc);
          for (const t of texts) expect(prompt).toContain(t);
        }
      }),
      { numRuns: 150 },
    );
  });
  it('wrapped and unwrapped input give the same chunks, IDs included', () => {
    fc.assert(
      fc.property(unwrappedParagraphArb(30), wrapOptionsArb, (paragraph, options) => {
        const wrapped = wrapParagraph(paragraph, options);
        expect(chunkDocument(pdf(wrapped))).toEqual(chunkDocument(pdf(paragraph)));
      }),
      { numRuns: 150 },
    );
  });
  it('a quote copied from the unwrapped text resolves against the chunk the model saw', () => {
    fc.assert(
      fc.property(
        unwrappedParagraphArb(),
        wrapOptionsArb,
        fc.nat(),
        fc.integer({ min: 4, max: 12 }),
        (paragraph, options, at, length) => {
          const words = paragraph.split(' ');
          fc.pre(words.length >= length);
          const start = at % (words.length - length + 1);
          const quote = words.slice(start, start + length).join(' ');
          fc.pre(quote.length >= 20 && paragraph.indexOf(quote) === paragraph.lastIndexOf(quote));
          const chunks = chunkDocument(pdf(wrapParagraph(paragraph, options)));
          fc.pre(chunks.length === 1);
          const chunk = chunks[0]!;
          const resolved = resolveQuote(new Map([[chunk.id, chunk]]), chunk.id, quote);
          expect(resolved.ok).toBe(true);
          if (resolved.ok) expect(chunk.text.slice(resolved.value.start, resolved.value.end)).toBe(quote);
        },
      ),
      { numRuns: 200 },
    );
  });
  it('is idempotent, so re-chunking the confirmed chunks gives the same chunks', () => {
    fc.assert(
      fc.property(unwrappedParagraphArb(30), wrapOptionsArb, (paragraph, options) => {
        const once = reflowLineBreaks(wrapParagraph(paragraph, options));
        expect(reflowLineBreaks(once)).toBe(once);
        const first = chunkDocument(pdf(wrapParagraph(paragraph, options)));
        const notesText = first.map((c) => c.text).join('\n\n');
        const again = chunkDocument(paste(notesText));
        expect(again.map((c) => c.text)).toEqual(first.map((c) => c.text));
      }),
      { numRuns: 100 },
    );
  });
});
