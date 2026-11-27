import { AuthoringQuestionSchema, type AuthoringQuestion } from '../authoring/schema';
import type { Result } from '../types';
import { z } from '../zod';
import { translateChunkId, type PreparedDocument } from './prepare-input';
import type { PipelineStageError } from './stage-error';

/**
 * Strict-compatible model schema: z.strictObject everywhere, every property required, and any
 * field the Authoring_Schema treats as optional is `.nullable()` here. The arms mirror
 * AuthoringQuestionSchema minus `id`/`conceptId`/`role`/`note`, with `chunkId` where the
 * authoring format has `paragraph`. `note` is a human aside, so the model is not asked for it.
 */
const GeneratedEvidenceSchema = z.strictObject({
  chunkId: z.string().min(1),
  quote: z.string(),
});

export const RuneCipherGeneratedSchema = z.strictObject({
  lockType: z.literal('rune-cipher'),
  prompt: z.string().min(1),
  answer: z.string().min(1),
  aliases: z.array(z.string()),
  caseSensitive: z.boolean(),
  evidence: z.array(GeneratedEvidenceSchema).min(1),
  explanation: z.string(),
  hint: z
    .strictObject({
      kind: z.literal('first-letter-and-length'),
      firstLetter: z.string().length(1),
      length: z.number().int().positive(),
    })
    .nullable(),
});

export const SeanceBoardGeneratedSchema = z.strictObject({
  lockType: z.literal('seance-board'),
  prompt: z.string().min(1),
  options: z
    .array(
      z.strictObject({
        id: z.string().min(1),
        text: z.string().min(1),
        label: z.enum(['supported', 'contradicted']),
        evidence: GeneratedEvidenceSchema,
      }),
    )
    .min(3)
    .max(4),
  answer: z.string().min(1),
  explanation: z.string(),
});

const GeneratedQuestionSchema = z.union([
  RuneCipherGeneratedSchema,
  SeanceBoardGeneratedSchema,
  z.null(),
]);

export const GenerationResponseSchema = z.strictObject({
  /** One line on why the primary type fits (G3). Read by nothing; asking for it first makes the model commit to a reason. */
  justification: z.string(),
  primary: GeneratedQuestionSchema,
  alternate: GeneratedQuestionSchema,
});

export type GenerationResponse = z.infer<typeof GenerationResponseSchema>;
export type GeneratedQuestion = NonNullable<GenerationResponse['primary']>;

export interface QuestionIdentity {
  readonly id: string;
  readonly conceptId: string;
  readonly role: 'primary' | 'alternate';
}

type Translated = Result<number, PipelineStageError>;

function evidenceOf(
  doc: PreparedDocument,
  ref: { readonly chunkId: string; readonly quote: string },
): Result<{ paragraph: number; quote: string }, PipelineStageError> {
  const ordinal: Translated = translateChunkId(doc, ref.chunkId);
  if (!ordinal.ok) return ordinal;
  return { ok: true, value: { paragraph: ordinal.value, quote: ref.quote } };
}

function collect<T, R>(
  items: readonly T[],
  fn: (item: T) => Result<R, PipelineStageError>,
): Result<readonly R[], PipelineStageError> {
  const out: R[] = [];
  for (const item of items) {
    const r = fn(item);
    if (!r.ok) return r;
    out.push(r.value);
  }
  return { ok: true, value: out };
}

/**
 * Attaches identity, translates each cited chunk ID to its ordinal (an unassigned ID is a typed
 * rejection), drops `null` values and re-parses with the real AuthoringQuestionSchema.
 */
export function toAuthoringQuestion(
  generated: GeneratedQuestion,
  identity: QuestionIdentity,
  doc: PreparedDocument,
): Result<AuthoringQuestion, PipelineStageError> {
  let candidate: Record<string, unknown>;
  if (generated.lockType === 'rune-cipher') {
    const evidence = collect(generated.evidence, (e) => evidenceOf(doc, e));
    if (!evidence.ok) return evidence;
    // The model's hint is not used. The mapper always computes the first-letter hint from the
    // answer (Requirement 6.8), so a miscounted length would only cost a good question its slot
    // (it failed the mapper's hint-mismatch rule, 6.11, on 13 of 78 accepted rune questions in the
    // first dev-set run). Hand-written authoring questions still get that rule.
    const { hint, ...rest } = generated;
    void hint;
    candidate = { ...rest, ...identity, evidence: evidence.value };
  } else {
    const options = collect(generated.options, (o) => {
      const ev = evidenceOf(doc, o.evidence);
      return ev.ok ? { ok: true as const, value: { ...o, evidence: ev.value } } : ev;
    });
    if (!options.ok) return options;
    candidate = { ...generated, ...identity, options: options.value };
  }
  const parsed = AuthoringQuestionSchema.safeParse(candidate);
  if (!parsed.success) return { ok: false, error: { kind: 'schema-rejected', stage: 'generation' } };
  return { ok: true, value: parsed.data };
}
