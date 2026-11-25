import { z } from '../zod';
import type { Result } from '../types';

export const CryptContentExcerptSchema = z.strictObject({
  chunkId: z.string().min(1),
  quote: z.string().min(1),
  /** Present only on an Option_Excerpt: the séance option whose own evidence this is. */
  optionId: z.string().min(1).optional(),
});

export const CryptContentEntrySchema = z
  .strictObject({
    prompt: z.string().min(1),
    /** Option ID -> option text. Never a correctness flag; no answer key exists in this type. */
    options: z.record(z.string(), z.string().min(1)).optional(),
    excerpts: z.array(CryptContentExcerptSchema).min(1),
    explanation: z.string(),
  })
  .superRefine((entry, ctx) => {
    // An optionId is accepted only when the same entry's `options` holds it.
    entry.excerpts.forEach((excerpt, i) => {
      if (excerpt.optionId !== undefined && entry.options?.[excerpt.optionId] === undefined) {
        ctx.addIssue({
          code: 'custom',
          path: ['excerpts', i, 'optionId'],
          message: 'optionId must name an option of the same entry',
        });
      }
    });
  });

export const CryptContentConceptSchema = z.strictObject({ title: z.string().trim().min(1) });

export const CryptContentSchema = z.strictObject({
  questions: z.record(z.string(), CryptContentEntrySchema),
  concepts: z.record(z.string(), CryptContentConceptSchema),
});

export type CryptContentExcerpt = z.infer<typeof CryptContentExcerptSchema>;
export type CryptContentEntry = z.infer<typeof CryptContentEntrySchema>;
export type CryptContentConcept = z.infer<typeof CryptContentConceptSchema>;

/**
 * `questions`: question ID -> its text. `concepts`: concept ID -> its title.
 * No answer key field exists anywhere in this type.
 */
export interface CryptContent {
  readonly questions: Record<string, CryptContentEntry>;
  readonly concepts: Record<string, CryptContentConcept>;
}

export interface CryptContentSchemaError {
  readonly kind: 'crypt-content-schema-invalid';
  readonly questionId: string;
  readonly issues: readonly {
    readonly path: readonly (string | number)[];
    readonly message: string;
  }[];
}

/** Validates one content entry. Never throws. */
export function parseCryptContentEntry(
  questionId: string,
  raw: unknown,
): Result<CryptContentEntry, CryptContentSchemaError> {
  const parsed = CryptContentEntrySchema.safeParse(raw);
  if (parsed.success) return { ok: true, value: parsed.data };
  return {
    ok: false,
    error: {
      kind: 'crypt-content-schema-invalid',
      questionId,
      issues: parsed.error.issues.map((issue) => ({
        path: issue.path.map((p) => (typeof p === 'number' ? p : String(p))),
        message: issue.message,
      })),
    },
  };
}
