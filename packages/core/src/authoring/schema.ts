import { z } from '../zod';

/**
 * Authoring_Schema (P1): rune cipher and séance board payloads.
 * No field accepts a character offset; code resolves quotes to offsets.
 * The other four lock types are added in P5.
 */

const EvidenceRefSchema = z.strictObject({
  paragraph: z.number().int().positive(),
  // Length is a Code_Check (quote-too-short / quote-too-long), not a schema bound.
  quote: z.string(),
});

const RuneCipherAuthoringSchema = z.strictObject({
  id: z.string().min(1),
  conceptId: z.string().min(1),
  role: z.enum(['primary', 'alternate']),
  lockType: z.literal('rune-cipher'),
  prompt: z.string().min(1),
  answer: z.string().min(1),
  aliases: z.array(z.string()),
  caseSensitive: z.boolean(),
  evidence: z.array(EvidenceRefSchema).min(1),
  explanation: z.string(),
  hint: z
    .strictObject({
      kind: z.literal('first-letter-and-length'),
      firstLetter: z.string().length(1),
      length: z.number().int().positive(),
    })
    .optional(),
  note: z.string().optional(),
});

const SeanceOptionSchema = z.strictObject({
  id: z.string().min(1),
  text: z.string().min(1),
  // No 'not-mentioned' value exists: such options cannot be expressed.
  label: z.enum(['supported', 'contradicted']),
  evidence: EvidenceRefSchema,
});

// No hint field: the Manifest_Mapper decides the séance hint in code.
const SeanceBoardAuthoringSchema = z.strictObject({
  id: z.string().min(1),
  conceptId: z.string().min(1),
  role: z.enum(['primary', 'alternate']),
  lockType: z.literal('seance-board'),
  prompt: z.string().min(1),
  // Arity is re-checked by a Code_Check for a clear Check_ID.
  options: z.array(SeanceOptionSchema).min(3).max(4),
  answer: z.string().min(1),
  explanation: z.string(),
  note: z.string().optional(),
});

const BoneOrderingAuthoringSchema = z.strictObject({
  id: z.string().min(1),
  conceptId: z.string().min(1),
  role: z.enum(['primary', 'alternate']),
  lockType: z.literal('bone-ordering'),
  prompt: z.string().min(1),
  // The answer order itself. The count is re-checked by the step-count Code_Check.
  steps: z.array(z.string().min(1)).min(3).max(5),
  evidence: z.array(EvidenceRefSchema).min(1),
  explanation: z.string(),
  // boneId names an item ID assigned by the Manifest_Mapper, not a step's text.
  hint: z.strictObject({ kind: z.literal('lock-first-bone'), boneId: z.string().min(1) }).optional(),
  note: z.string().optional(),
});

const BoundThreadsPairSchema = z.strictObject({
  left: z.string().min(1),
  right: z.string().min(1),
  // Each stated pairing cites its own passage (as in the real dev and sample fixtures).
  evidence: EvidenceRefSchema,
});

const BoundThreadsAuthoringSchema = z.strictObject({
  id: z.string().min(1),
  conceptId: z.string().min(1),
  role: z.enum(['primary', 'alternate']),
  lockType: z.literal('bound-threads'),
  prompt: z.string().min(1),
  // Authoring order is the key order. The count is re-checked by the pair-count Code_Check.
  pairs: z.array(BoundThreadsPairSchema).min(3).max(4),
  explanation: z.string(),
  // The pair names item IDs the Manifest_Mapper assigns; the mapper decides the hint in code.
  hint: z
    .strictObject({ kind: z.literal('tie-thread'), pair: z.tuple([z.string().min(1), z.string().min(1)]) })
    .optional(),
  note: z.string().optional(),
});

// No hint field: the Manifest_Mapper decides the hint in code (it names item IDs it assigns).
const CursedObjectAuthoringSchema = z.strictObject({
  id: z.string().min(1),
  conceptId: z.string().min(1),
  role: z.enum(['primary', 'alternate']),
  lockType: z.literal('cursed-object'),
  prompt: z.string().min(1),
  // Exactly four, re-checked by the item-count Code_Check for a clear Check_ID.
  items: z.array(z.string().min(1)).length(4),
  // The text of the odd item. That it is one of `items` is the answer-not-an-item Code_Check.
  answer: z.string().min(1),
  categoryRule: z.string().min(1),
  // Top-level, as in the real dev and sample fixtures (not per item).
  evidence: z.array(EvidenceRefSchema).min(1),
  explanation: z.string(),
  note: z.string().optional(),
});

// P5 appends the remaining lock type (combination dial) here.
export const AuthoringQuestionSchema = z.discriminatedUnion('lockType', [
  RuneCipherAuthoringSchema,
  SeanceBoardAuthoringSchema,
  BoneOrderingAuthoringSchema,
  BoundThreadsAuthoringSchema,
  CursedObjectAuthoringSchema,
]);

export type AuthoringQuestion = z.infer<typeof AuthoringQuestionSchema>;
export type RuneCipherAuthoringQuestion = z.infer<typeof RuneCipherAuthoringSchema>;
export type SeanceBoardAuthoringQuestion = z.infer<typeof SeanceBoardAuthoringSchema>;
export type BoneOrderingAuthoringQuestion = z.infer<typeof BoneOrderingAuthoringSchema>;
export type BoundThreadsAuthoringQuestion = z.infer<typeof BoundThreadsAuthoringSchema>;
export type CursedObjectAuthoringQuestion = z.infer<typeof CursedObjectAuthoringSchema>;
