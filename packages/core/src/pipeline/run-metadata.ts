import type { ProviderStage } from '../provider/types';
import type { RecordedCall } from './recording-provider';

/** Pipeline phases that get a timing, in run order. */
export type TimedStage =
  | 'prepare'
  | 'concept-extraction'
  | 'generation'
  | 'code-checks'
  | 'review'
  | 'assembly';

export const TIMED_STAGES: readonly TimedStage[] = [
  'prepare',
  'concept-extraction',
  'generation',
  'code-checks',
  'review',
  'assembly',
];

/**
 * Counts for one run. Question-level unless noted. `discarded` counts every generated question
 * that did not pass Code_Checks and blind review, so `candidates - discarded` is the number of
 * accepted questions at the point the run ended.
 */
export interface PipelineRunCounts {
  /** Concepts that survived extraction filtering. */
  concepts: number;
  /** Concepts whose generation ended in an error other than a budget stop (concept-level). */
  conceptsSetAside: number;
  /** Questions returned by generation, primaries and alternates. */
  candidates: number;
  /** Generation concepts and review replies that failed their schema twice. */
  schemaRejected: number;
  /** Blocking Code_Check failures by Check_ID. A question counts once per distinct Check_ID. */
  codeCheckRejections: Record<string, number>;
  /** Questions the blind reviewer rejected (not counting questions that failed Code_Checks). */
  reviewRejections: number;
  /** Questions that passed Code_Checks and blind review. */
  accepted: number;
  discarded: number;
  /** Accepted questions the mapper refused at assembly. */
  mapperRejected: number;
  /** Concepts the Leak_Scan removed from the room at assembly. */
  leakDroppedConcepts: number;
}

export function newCounts(): PipelineRunCounts {
  return {
    concepts: 0,
    conceptsSetAside: 0,
    candidates: 0,
    schemaRejected: 0,
    codeCheckRejections: {},
    reviewRejections: 0,
    accepted: 0,
    discarded: 0,
    mapperRejected: 0,
    leakDroppedConcepts: 0,
  };
}

/**
 * Run facts for the evaluation result file and the cassette tests (Req 21.3, 25.8).
 * Holds no notes text, prompt text, model response or credential: digests, numbers and
 * closed-set names only.
 */
export interface PipelineRunMetadata {
  readonly provider: string;
  readonly modelId: string;
  readonly temperature: number;
  readonly checkVersion: string;
  /** One Prompt_Digest per Provider call, in the order the calls started. */
  readonly promptDigests: readonly string[];
  readonly calls: readonly RecordedCall[];
  readonly stageTimingsMs: Readonly<Record<TimedStage, number>>;
  readonly tokens: {
    readonly inputTokens: number;
    readonly outputTokens: number;
    readonly byStage: Readonly<Record<ProviderStage, { inputTokens: number; outputTokens: number }>>;
  };
  readonly costUsd: number;
  readonly counts: PipelineRunCounts;
}

export interface MetadataInput {
  readonly provider: string;
  readonly modelId: string;
  readonly temperature: number;
  readonly checkVersion: string;
  readonly calls: readonly RecordedCall[];
  readonly costUsd: number;
  readonly stageTimingsMs: Readonly<Record<TimedStage, number>>;
  readonly counts: PipelineRunCounts;
}

const PROVIDER_STAGES: readonly ProviderStage[] = ['concept-extraction', 'generation', 'review'];

/** Pure. Copies its inputs so later mutation of the accumulators cannot change the result. */
export function buildRunMetadata(input: MetadataInput): PipelineRunMetadata {
  const byStage = {} as Record<ProviderStage, { inputTokens: number; outputTokens: number }>;
  for (const stage of PROVIDER_STAGES) byStage[stage] = { inputTokens: 0, outputTokens: 0 };
  for (const call of input.calls) {
    byStage[call.stage].inputTokens += call.inputTokens;
    byStage[call.stage].outputTokens += call.outputTokens;
  }
  const total = PROVIDER_STAGES.reduce(
    (acc, s) => ({
      inputTokens: acc.inputTokens + byStage[s].inputTokens,
      outputTokens: acc.outputTokens + byStage[s].outputTokens,
    }),
    { inputTokens: 0, outputTokens: 0 },
  );
  return {
    provider: input.provider,
    modelId: input.modelId,
    temperature: input.temperature,
    checkVersion: input.checkVersion,
    promptDigests: input.calls.map((c) => c.promptDigest),
    calls: input.calls.map((c) => ({ ...c })),
    stageTimingsMs: { ...input.stageTimingsMs },
    tokens: { ...total, byStage },
    costUsd: input.costUsd,
    counts: { ...input.counts, codeCheckRejections: { ...input.counts.codeCheckRejections } },
  };
}
