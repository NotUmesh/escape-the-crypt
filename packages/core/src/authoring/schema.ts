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

export const AuthoringQuestionSchema = z.discriminatedUnion('lockType', [
  RuneCipherAuthoringSchema,
  SeanceBoardAuthoringSchema,
]);

export type AuthoringQuestion = z.infer<typeof AuthoringQuestionSchema>;
export type RuneCipherAuthoringQuestion = z.infer<typeof RuneCipherAuthoringSchema>;
export type SeanceBoardAuthoringQuestion = z.infer<typeof SeanceBoardAuthoringSchema>;
