import { AuthoringQuestionSchema, type AuthoringQuestion } from '../authoring/schema';
import type { LockType, Result } from '../types';
import { z } from '../zod';
import { DEFAULT_ALLOWED_LOCK_TYPES } from './generation-prompt';
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

// No hint field: boneId names an item ID the Manifest_Mapper assigns, which the model cannot know.
export const BoneOrderingGeneratedSchema = z.strictObject({
  lockType: z.literal('bone-ordering'),
  prompt: z.string().min(1),
  steps: z.array(z.string().min(1)).min(3).max(5),
  evidence: z.array(GeneratedEvidenceSchema).min(1),
  explanation: z.string(),
});

// No hint field: the tie-thread pair names item IDs the Manifest_Mapper assigns.
export const BoundThreadsGeneratedSchema = z.strictObject({
  lockType: z.literal('bound-threads'),
  prompt: z.string().min(1),
  pairs: z
    .array(
      z.strictObject({
        left: z.string().min(1),
        right: z.string().min(1),
        evidence: GeneratedEvidenceSchema,
      }),
    )
    .min(3)
    .max(4),
  explanation: z.string(),
});

// No hint field: a hint would name item IDs the Manifest_Mapper assigns, which the model cannot know.
export const CursedObjectGeneratedSchema = z.strictObject({
  lockType: z.literal('cursed-object'),
  prompt: z.string().min(1),
  items: z.array(z.string().min(1)).length(4),
  answer: z.string().min(1),
  categoryRule: z.string().min(1),
  evidence: z.array(GeneratedEvidenceSchema).min(1),
  explanation: z.string(),
});

type GeneratedArm =
  | z.infer<typeof CursedObjectGeneratedSchema>
  | z.infer<typeof RuneCipherGeneratedSchema>
  | z.infer<typeof SeanceBoardGeneratedSchema>
  | z.infer<typeof BoneOrderingGeneratedSchema>
  | z.infer<typeof BoundThreadsGeneratedSchema>;

export type GeneratedQuestion = GeneratedArm;

export interface GenerationResponse {
  justification: string;
  primary: GeneratedQuestion | null;
  alternate: GeneratedQuestion | null;
}

// Fixed order, so the schema for a given allowed list is deterministic (and the two-type default
// is identical to the schema before bone-ordering existed).
const ARMS: ReadonlyArray<readonly [LockType, z.ZodType<GeneratedArm>]> = [
  ['rune-cipher', RuneCipherGeneratedSchema],
  ['seance-board', SeanceBoardGeneratedSchema],
  ['bone-ordering', BoneOrderingGeneratedSchema],
  ['bound-threads', BoundThreadsGeneratedSchema],
  ['cursed-object', CursedObjectGeneratedSchema],
];

/**
 * The response schema offering the model only the arms for `allowed`. One arm is used directly
 * (a union needs two); primary and alternate stay nullable. Types without an arm are ignored.
 */
export function buildGenerationResponseSchema(
  allowed: readonly LockType[],
): z.ZodType<GenerationResponse> {
  const arms = ARMS.filter(([type]) => allowed.includes(type)).map(([, arm]) => arm);
  const nullable: z.ZodType<GeneratedQuestion | null> =
    arms.length === 0
      ? z.null()
      : arms.length === 1
        ? z.union([arms[0] as z.ZodType<GeneratedArm>, z.null()])
        : z.union([...arms, z.null()]);
  return z.strictObject({
    /** One line on why the primary type fits (G3). Read by nothing; asking for it first makes the model commit to a reason. */
    justification: z.string(),
    primary: nullable,
    alternate: nullable,
  });
}

/** The default two-type schema (rune cipher and s�ance board). */
export const GenerationResponseSchema = buildGenerationResponseSchema(DEFAULT_ALLOWED_LOCK_TYPES);

/**
 * Every arm. Responses are parsed with this, so a well-formed question of a type the caller did
 * not allow is handled by the allowed-type filter rather than rejected as malformed.
 */
export const FullGenerationResponseSchema = buildGenerationResponseSchema([
  'rune-cipher',
  'seance-board',
  'bone-ordering',
  'bound-threads',
  'cursed-object',
]);
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
  } else if (generated.lockType === 'bone-ordering' || generated.lockType === 'cursed-object') {
    const evidence = collect(generated.evidence, (e) => evidenceOf(doc, e));
    if (!evidence.ok) return evidence;
    candidate = { ...generated, ...identity, evidence: evidence.value };
  } else if (generated.lockType === 'bound-threads') {
    const pairs = collect(generated.pairs, (p) => {
      const ev = evidenceOf(doc, p.evidence);
      return ev.ok ? { ok: true as const, value: { ...p, evidence: ev.value } } : ev;
    });
    if (!pairs.ok) return pairs;
    candidate = { ...generated, ...identity, pairs: pairs.value };
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
