import { z } from '@escape-the-crypt/core';

/**
 * The `ratings` section of a rated result file. Counts, rates, names of raters and code-assigned
 * keys only: no question text, no prompts, no rater comments.
 */
const count = z.number().int().nonnegative();
const rate = z.number().min(0).max(1).nullable();

export const TypeStatsSchema = z.strictObject({
  accepted: count,
  rejected: count,
  acceptedCorrect: count,
  acceptedWrong: count,
  acceptedUnsure: count,
  rejectedCorrect: count,
  rejectedWrong: count,
  rejectedUnsure: count,
  /** Accepted questions rated wrong, over accepted questions rated. "Unsure" is not counted as wrong. */
  wrongAcceptedRate: rate,
  /** The same with every "unsure" counted as wrong: the worst case. */
  wrongAcceptedRateMax: rate,
  /** Rejected questions rated correct, over rejected questions rated. "Unsure" is not counted. */
  correctRejectedRate: rate,
  /** The same with every "unsure" counted as correct: the worst case. */
  correctRejectedRateMax: rate,
});

const ByType = z.record(z.string(), TypeStatsSchema);

export const DisagreementSchema = z.strictObject({
  note: z.string(),
  conceptIndex: count,
  role: z.enum(['primary', 'alternate']),
  lockType: z.string(),
  result: z.string(),
  verdicts: z.record(z.string(), z.enum(['correct', 'wrong', 'unsure'])),
});

export const RatingsSectionSchema = z.strictObject({
  ratingsSchemaVersion: z.literal(1),
  importedAt: z.string().min(1),
  csvFiles: z.array(z.string()),
  raters: z.array(z.string()),
  /** Per rater: rateable questions in the result file, rated, left blank, and missing from the CSV. */
  coverage: z.record(z.string(), z.strictObject({ rateable: count, rated: count, unrated: count, missing: count })),
  perRater: z.record(z.string(), ByType),
  /** Only questions both raters rated the same. Null with one rater. */
  consensus: ByType.nullable(),
  agreement: z
    .strictObject({
      overlap: count,
      agreed: count,
      agreementRate: rate,
      /** Cohen's kappa over correct, wrong and unsure. Null when undefined (no overlap, or no spread). */
      kappa: z.number().min(-1).max(1).nullable(),
      /** Every question the raters rated differently, listed one by one. Never averaged. */
      disagreements: z.array(DisagreementSchema),
    })
    .nullable(),
});

export type TypeStats = z.infer<typeof TypeStatsSchema>;
export type Disagreement = z.infer<typeof DisagreementSchema>;
export type RatingsSection = z.infer<typeof RatingsSectionSchema>;
