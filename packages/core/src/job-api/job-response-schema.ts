import { z } from '../zod';
import { CryptContentEntrySchema, CryptContentSchema } from '../mapper/crypt-content';
import { CryptManifestSchema, QuestionSpecSchema } from '../runtime/manifest-schema';
import { PIPELINE_STAGES } from '../pipeline/pipeline-progress';
import type { PipelineNotices } from '../pipeline/pipeline-notices';

/**
 * The worker's HTTP bodies, as one contract for the worker (which builds them) and the web
 * client (which parses them). Every object is strict, so a new or renamed field fails on
 * both sides at once.
 */

/** Job statuses a `Job` can hold. `cancelling` is not terminal. */
export const JOB_STATUSES = ['queued', 'running', 'cancelling', 'completed', 'failed', 'cancelled'] as const;
export const JobStatusNameSchema = z.enum(JOB_STATUSES);
export type JobStatusName = z.infer<typeof JobStatusNameSchema>;

/** Statuses a response can carry: the job statuses plus the content-free tombstone. */
export const JobAckStatusSchema = z.enum([...JOB_STATUSES, 'expired']);

export const JOB_FAILURE_KINDS = [
  'budget-exhausted',
  'not-enough-material',
  'generation-failed',
  'cancelled',
  'expired',
] as const;
export const JobFailureKindSchema = z.enum(JOB_FAILURE_KINDS);
export type JobFailureKindName = z.infer<typeof JobFailureKindSchema>;

const JobIdSchema = z.string().min(1);

/**
 * Mirrors `UnplacedAccepted` in `pipeline/room-assembly.ts`: an accepted question the room had
 * no slot for. `QuestionSpecSchema` only admits the lock types the manifest supports. That is
 * the same set the mapper emits, and a type outside it would fail the manifest check too.
 */
export const UnplacedAcceptedSchema = z.strictObject({
  conceptId: z.string().min(1),
  conceptTitle: z.string(),
  question: QuestionSpecSchema,
  content: CryptContentEntrySchema,
});

const PassageSchema = z.strictObject({ chunkId: z.string().min(1), quote: z.string().min(1) });

/** Mirrors `ExcludedConcept` in `pipeline/conflict-stage.ts`. */
export const ExcludedConceptSchema = z.strictObject({
  conceptId: z.string().min(1),
  conceptTitle: z.string(),
  source: z.enum(['code', 'model']),
  passages: z.tuple([PassageSchema, PassageSchema]),
});

/** Mirrors `SufficiencyNotice` in `pipeline/sufficiency.ts`. */
export const SufficiencyNoticeSchema = z.strictObject({
  goodConcepts: z.number().int().nonnegative(),
  conceptsNeeded: z.number().int().nonnegative(),
  requestedRooms: z.number().int().nonnegative(),
  builtRooms: z.number().int().nonnegative(),
});

/**
 * Optional, and sent only to clients that ask with `?notices=1`: a client built before it parses
 * the bundle strictly and would refuse the extra field.
 */
export const JobNoticesSchema = z.strictObject({
  excluded: z.array(ExcludedConceptSchema),
  sufficiency: SufficiencyNoticeSchema.nullable(),
});

export const JobBundleSchema = z.strictObject({
  manifest: CryptManifestSchema,
  content: CryptContentSchema,
  unplacedAccepted: z.array(UnplacedAcceptedSchema),
  notices: JobNoticesSchema.optional(),
});

/** `message` is the worker's plain-language copy. The web shows its own copy instead. */
export const JobFailureSchema = z.strictObject({ kind: JobFailureKindSchema, message: z.string() });

/**
 * Where a running job is (contract version 2). `done` and `total` appear together, only for the
 * counted stages (generating, reviewing), with `done <= total`. Optional: a worker that predates it
 * never sends it, and the worker sends it only to clients that ask with `?progress=1`, because a
 * client built before it parses `running` strictly and would refuse the extra field.
 */
export const JobProgressSchema = z
  .strictObject({
    stage: z.enum(PIPELINE_STAGES),
    done: z.number().int().nonnegative().optional(),
    total: z.number().int().nonnegative().optional(),
  })
  .refine((p) => (p.done === undefined) === (p.total === undefined), { message: 'done and total come together' })
  .refine((p) => p.done === undefined || p.total === undefined || p.done <= p.total, { message: 'done exceeds total' });

/** `GET /jobs/:id`. */
export const JobStatusResponseSchema = z.discriminatedUnion('status', [
  z.strictObject({ jobId: JobIdSchema, status: z.literal('queued') }),
  z.strictObject({ jobId: JobIdSchema, status: z.literal('running'), progress: JobProgressSchema.optional() }),
  z.strictObject({ jobId: JobIdSchema, status: z.literal('cancelling') }),
  z.strictObject({ jobId: JobIdSchema, status: z.literal('completed'), bundle: JobBundleSchema }),
  z.strictObject({ jobId: JobIdSchema, status: z.literal('failed'), failure: JobFailureSchema }),
  z.strictObject({ jobId: JobIdSchema, status: z.literal('cancelled'), failure: JobFailureSchema }),
  z.strictObject({ jobId: JobIdSchema, status: z.literal('expired') }),
]);

/** `POST /jobs` (202 or 200) and `DELETE /jobs/:id` (202 or 200). Never carries a bundle. */
export const JobAckResponseSchema = z.strictObject({ jobId: JobIdSchema, status: JobAckStatusSchema });

/** The body `sendError` writes for every 4xx and 5xx. `error` is a closed-set kind. */
export const JobErrorResponseSchema = z.strictObject({ error: z.string().min(1), message: z.string() });

/** Zod infers mutable arrays; the worker holds readonly ones. Normalise the inferred side. */
type DeepReadonly<T> = T extends readonly (infer U)[]
  ? T extends readonly [unknown, ...unknown[]]
    ? { readonly [K in keyof T]: DeepReadonly<T[K]> }
    : readonly DeepReadonly<U>[]
  : T extends object
    ? { readonly [K in keyof T]: DeepReadonly<T[K]> }
    : T;

/** Compile-time checks: the schemas and the pipeline types accept each other's values. */
type Equivalent<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
const noticesMatchTypes: Equivalent<DeepReadonly<z.infer<typeof JobNoticesSchema>>, PipelineNotices> = true;
void noticesMatchTypes;

export type JobBundle = DeepReadonly<z.infer<typeof JobBundleSchema>>;
export type JobFailureBody = DeepReadonly<z.infer<typeof JobFailureSchema>>;
export type JobStatusResponse = DeepReadonly<z.infer<typeof JobStatusResponseSchema>>;
export type JobProgress = DeepReadonly<z.infer<typeof JobProgressSchema>>;
export type JobAckResponse = DeepReadonly<z.infer<typeof JobAckResponseSchema>>;
export type JobErrorResponse = DeepReadonly<z.infer<typeof JobErrorResponseSchema>>;
