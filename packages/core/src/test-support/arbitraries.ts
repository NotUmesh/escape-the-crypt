import fc from 'fast-check';
import type { CryptManifest } from '../runtime/manifest-types';
import type { Event } from '../types';
import { buildManifest } from './manifest-fixture';

const word = fc.stringMatching(/^[a-z]{2,9}$/);

/** A sentence of 3-12 words ending in a full stop. */
export const sentenceArb: fc.Arbitrary<string> = fc
  .array(word, { minLength: 3, maxLength: 12 })
  .map((ws) => `${ws.join(' ')}.`);

/** A paragraph of 1-4 sentences. */
export const paragraphArb: fc.Arbitrary<string> = fc
  .array(sentenceArb, { minLength: 1, maxLength: 4 })
  .map((ss) => ss.join(' '));

/** Blank-line separator: 1 or more empty lines (possibly with spaces). */
const blankRunArb: fc.Arbitrary<string> = fc
  .tuple(fc.integer({ min: 2, max: 5 }), fc.boolean())
  .map(([n, spaced]) => (spaced ? '\n \t'.repeat(n - 1) + '\n' : '\n'.repeat(n)));

/** Pasted text: paragraphs separated by runs of blank lines. */
export const pastedTextArb: fc.Arbitrary<string> = fc
  .array(fc.tuple(paragraphArb, blankRunArb), { minLength: 1, maxLength: 6 })
  .map((parts) => parts.map(([p, sep]) => p + sep).join(''));

export interface PdfPageArb {
  pdfPageIndex: number;
  printedPageLabel: string | null;
  text: string;
}

/** PDF page list with unique ascending indexes and printed labels or null. */
export const pdfPagesArb: fc.Arbitrary<PdfPageArb[]> = fc
  .array(
    fc.record({
      label: fc.option(fc.stringMatching(/^[ivx]{1,4}$|^[1-9][0-9]{0,2}$/), { nil: null }),
      text: paragraphArb,
    }),
    { minLength: 1, maxLength: 10 },
  )
  .map((pages) =>
    pages.map((p, i) => ({ pdfPageIndex: i, printedPageLabel: p.label, text: p.text })),
  );

/** Text in which the same paragraph appears at least twice. */
export const duplicateParagraphsArb: fc.Arbitrary<string> = fc
  .tuple(paragraphArb, fc.array(paragraphArb, { maxLength: 3 }), fc.integer({ min: 2, max: 4 }))
  .map(([dup, others, times]) => [...Array<string>(times).fill(dup), ...others].join('\n\n'));

/** A single sentence longer than `minChars` (default 1500) made of short words. */
export function overLongSentenceArb(minChars = 1500): fc.Arbitrary<string> {
  return fc
    .array(word, { minLength: Math.ceil(minChars / 4), maxLength: Math.ceil(minChars / 4) + 40 })
    .map((ws) => `${ws.join(' ')}.`)
    .filter((s) => s.length > minChars);
}

/** A single whitespace-free token longer than `minChars` (default 1500). */
export function overLongTokenArb(minChars = 1500): fc.Arbitrary<string> {
  return fc
    .stringMatching(/^[a-z]{20}$/)
    .chain((seed) =>
      fc.integer({ min: minChars + 1, max: minChars + 400 }).map((n) =>
        seed.repeat(Math.ceil(n / seed.length)).slice(0, n),
      ),
    );
}

const LIGATURES = ['\uFB01', '\uFB02', '\uFB00', '\uFB03', '\uFB04'];
const DECOMPOSED = ['e\u0301', 'a\u0300', 'o\u0308', 'n\u0303', 'c\u0327'];

const noisyPieceArb: fc.Arbitrary<string> = fc.oneof(
  { weight: 6, arbitrary: word },
  { weight: 1, arbitrary: fc.constantFrom(...LIGATURES) },
  { weight: 1, arbitrary: fc.constantFrom('\u2018s', '\u2019', '\u201Cquoted\u201D') },
  { weight: 1, arbitrary: fc.constantFrom(...DECOMPOSED) },
  { weight: 1, arbitrary: word.map((w) => `${w}-\n${w}`) },
  { weight: 1, arbitrary: word.map((w) => `${w}-  \n  ${w}`) },
);

/** Chunk text with line-break hyphens, ligatures, curly quotes and decomposed accents. */
export const noisyChunkTextArb: fc.Arbitrary<string> = fc
  .array(noisyPieceArb, { minLength: 12, maxLength: 40 })
  .map((pieces) => pieces.join(' '));

/** A chunk text together with a quote cut from it at random offsets (quote may be short). */
export const chunkAndQuoteArb: fc.Arbitrary<{ chunkText: string; quote: string }> =
  noisyChunkTextArb.chain((chunkText) =>
    fc
      .tuple(
        fc.integer({ min: 0, max: chunkText.length - 1 }),
        fc.integer({ min: 0, max: chunkText.length - 1 }),
      )
      .map(([a, b]) => {
        const start = Math.min(a, b);
        const end = Math.max(a, b) + 1;
        return { chunkText, quote: chunkText.slice(start, end) };
      }),
  );

// --- Room runtime arbitraries ------------------------------------------------

/** Concepts per room: 1-6 in most cases, 4-6 in a share of cases so Returns fall due in-room. */
const conceptsPerRoomArb: fc.Arbitrary<number> = fc.oneof(
  { weight: 3, arbitrary: fc.integer({ min: 1, max: 6 }) },
  { weight: 1, arbitrary: fc.integer({ min: 4, max: 6 }) },
);

/**
 * Valid manifests over all six lock types: 1-5 rooms, Alternates present or absent per
 * concept, optional hint effects, 2-4 reserved final-door questions, plain JSON payloads
 * and a unique questionId on every question. Built through `buildManifest`.
 */
export const manifestArb: fc.Arbitrary<CryptManifest> = fc
  .record({
    rooms: fc.integer({ min: 1, max: 5 }),
    conceptsPerRoom: conceptsPerRoomArb,
    alternateMask: fc.array(fc.boolean(), { minLength: 30, maxLength: 30 }),
    hintEffects: fc.boolean(),
    finalDoorQuestions: fc.integer({ min: 2, max: 4 }),
    seed: fc.integer({ min: 0, max: 2 ** 31 - 1 }),
  })
  .map(({ alternateMask, ...rest }) =>
    buildManifest({
      ...rest,
      alternates: (roomIndex, conceptIndex) => alternateMask[roomIndex * 6 + conceptIndex] ?? true,
    }),
  );

const idArb = fc.stringMatching(/^[a-z0-9-]{1,12}$/);

/** A JSON-only submission shaped like one of the six lock types (bound-threads as tuple arrays). */
export const submissionArb: fc.Arbitrary<unknown> = fc
  .oneof(
    fc.record({ text: fc.string({ maxLength: 20 }) }),
    fc.record({ selectedOptionId: fc.option(idArb, { nil: null }) }),
    fc.record({ order: fc.array(idArb, { maxLength: 5 }) }),
    fc.record({ pairs: fc.array(fc.tuple(idArb, idArb), { maxLength: 4 }) }),
    fc.record({ selectedId: fc.option(idArb, { nil: null }) }),
    fc.record({ rawInput: fc.string({ maxLength: 8 }) }),
  )
  // fast-check records have a null prototype; copy to an ordinary object.
  .map((record): unknown => ({ ...record }));

/** Any of the 14 Event variants with small ID pools; always plain JSON. */
export const eventArb: fc.Arbitrary<Event> = fc.oneof(
  idArb.map((manifestId): Event => ({ kind: 'RunStarted', manifestId })),
  idArb.map((roomId): Event => ({ kind: 'RoomPublished', roomId })),
  fc.nat(6).map((finalRoomCount): Event => ({ kind: 'CryptFinalised', finalRoomCount })),
  fc.nat(6).map((finalRoomCount): Event => ({ kind: 'CryptShortened', finalRoomCount })),
  idArb.map((roomId): Event => ({ kind: 'RoomEntered', roomId })),
  idArb.map((slotId): Event => ({ kind: 'LockOpened', slotId })),
  idArb.map((slotId): Event => ({ kind: 'HintUsed', slotId })),
  fc
    .tuple(idArb, submissionArb)
    .map(([slotId, submission]): Event => ({ kind: 'AnswerSubmitted', slotId, submission })),
  idArb.map((slotId): Event => ({ kind: 'Skipped', slotId })),
  idArb.map((slotId): Event => ({ kind: 'Challenged', slotId })),
  idArb.map((slotId): Event => ({ kind: 'EvidenceContinued', slotId })),
  fc.constant<Event>({ kind: 'FinalDoorEntered' }),
  fc.constant<Event>({ kind: 'RunLeft' }),
  fc.constant<Event>({ kind: 'RunResumed' }),
);
