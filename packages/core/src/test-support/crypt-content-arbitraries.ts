import fc from 'fast-check';
import type { CryptContent, CryptContentEntry } from '../mapper/crypt-content';

const idArb = fc.stringMatching(/^[a-z][a-z0-9-]{0,9}$/);
const textArb = fc.stringMatching(/^[A-Za-z][A-Za-z ,.]{0,38}[A-Za-z.]$/);
/** Plain text, already trimmed and never blank, so schema output equals input. */
const titleArb = fc.stringMatching(/^[A-Za-z][A-Za-z ]{0,30}[A-Za-z]$/);

/** Options first, then each excerpt `optionId` is drawn from those option IDs. */
const withOptionsArb: fc.Arbitrary<CryptContentEntry> = fc
  .dictionary(idArb, textArb, { minKeys: 1, maxKeys: 5 })
  .chain((options) =>
    fc.record({
      prompt: textArb,
      options: fc.constant(options),
      excerpts: fc.array(
        fc.record(
          { chunkId: idArb, quote: textArb, optionId: fc.constantFrom(...Object.keys(options)) },
          { requiredKeys: ['chunkId', 'quote'] },
        ),
        { minLength: 1, maxLength: 4 },
      ),
      explanation: fc.string({ maxLength: 40 }),
    }),
  );

const withoutOptionsArb: fc.Arbitrary<CryptContentEntry> = fc.record({
  prompt: textArb,
  excerpts: fc.array(fc.record({ chunkId: idArb, quote: textArb }), {
    minLength: 1,
    maxLength: 4,
  }),
  explanation: fc.string({ maxLength: 40 }),
});

export const cryptContentEntryArb: fc.Arbitrary<CryptContentEntry> = fc.oneof(
  withOptionsArb,
  withoutOptionsArb,
);

/** A value that passes `CryptContentSchema`, with a non-empty `concepts` record. */
export const cryptContentArb: fc.Arbitrary<CryptContent> = fc.record({
  questions: fc.dictionary(idArb, cryptContentEntryArb, { maxKeys: 5 }),
  concepts: fc.dictionary(idArb, fc.record({ title: titleArb }), { minKeys: 1, maxKeys: 5 }),
});
