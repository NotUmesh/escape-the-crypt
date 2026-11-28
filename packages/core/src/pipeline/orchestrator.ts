import type { BudgetLedger } from '../budget/types';
import { CHECK_VERSION } from '../checks/registry';
import type { CryptContent } from '../mapper/crypt-content';
import type { Provider } from '../provider/types';
import type { CryptManifest } from '../runtime/manifest-types';
import type { CryptTarget } from '../run-length';
import type { Result } from '../types';
import { blindReview, type ReviewVerdict } from './blind-review';
import {
  newOutcomeLog,
  recordPlacements,
  snapshotOutcomes,
} from './candidate-outcomes';
import { runCodeCheckStage } from './code-check-stage';
import { collectCandidates, SKIPPED, type Slot } from './orchestrator-candidates';
import { runAssemblyPhase } from './orchestrator-conflict';
import { selectRunConcepts } from './orchestrator-sufficiency';
import { progressReporter, type PipelineProgress } from './pipeline-progress';
import { tallyReviews } from './review-tally';
import { extractConcepts, type ExtractedConcept } from './concept-extraction';
import { DEFAULT_CONCURRENCY, runWithConcurrency } from './concurrency';
import {
  generateForConcept,
  type GeneratedConceptQuestions,
  type GenerationOptions,
} from './generation';
import type { PipelineNotices } from './pipeline-notices';
import { prepareDocument } from './prepare-input';
import { recordCalls } from './recording-provider';
import type { AssemblyPolicy, RoomAssemblyError, UnplacedAccepted } from './room-assembly';
import {
  TIMED_STAGES,
  buildRunMetadata,
  newCounts,
  type PipelineRunMetadata,
  type TimedStage,
} from './run-metadata';
import type { PipelineStageError } from './stage-error';

export type { UnplacedAccepted } from './room-assembly';

/**
 * Minimal structural view of an AbortSignal. Core's lib has no DOM or Node types, so it cannot
 * name the global; a real AbortSignal satisfies this.
 */
export interface AbortSignalLike {
  readonly aborted: boolean;
}

/** Everything the run needs, injected: no globals, no timers, no I/O. */
export interface PipelineOptions extends GenerationOptions {
  readonly provider: Provider;
  readonly ledger: BudgetLedger;
  /** Name recorded in the run metadata, e.g. `openai`. */
  readonly providerName: string;
  /** Cap on provider calls in flight per stage. Default 4. */
  readonly concurrency?: number;
  /** Millisecond clock for timings. Default: a clock that always reads 0. */
  readonly now?: () => number;
  /**
   * Cancellation. Once borted is true no new reservation or provider call starts, and the run
   * ends as cancelled. Calls already in flight are not aborted and are never given this signal.
   */
  readonly signal?: AbortSignalLike;
  /** Room assembly policy. Default DEFAULT_ASSEMBLY_POLICY; the legacy one is for ablations. */
  readonly assemblyPolicy?: AssemblyPolicy;
  /** Crypt size (`cryptTargetFor`). Absent: every concept, one room. Present: capped spread, up to `rooms` rooms. */
  readonly target?: CryptTarget;
  /** Stage and counts as the run goes. Advisory: a throwing callback is ignored. */
  readonly onProgress?: (progress: PipelineProgress) => void;
  /**
   * Run the conflict-check stage (Phase 6). Default off.
   * Pinned `false` in every existing cassette fixture so a future change of this default
   * cannot silently alter recorded digests.
   */
  readonly conflictCheck?: boolean;
  /**
   * Run the thin-concept filter and sufficiency notice (Phase 6). Default off.
   * Pinned `false` in every existing cassette fixture so a future change of this default
   * cannot silently alter recorded digests.
   */
  readonly sufficiency?: boolean;
}

export interface PipelineResult {
  readonly manifest: CryptManifest;
  readonly content: CryptContent;
  /** Accepted questions without a room slot. Not in the manifest, not playable. */
  readonly unplacedAccepted: readonly UnplacedAccepted[];
  readonly metadata: PipelineRunMetadata;
  /** Absent, not empty, when there is nothing to report. */
  readonly notices?: PipelineNotices;
}

/** Closed set. Kinds and stage names only: no notes, prompts or model output. */
export type PipelineJobError = PipelineStageError | RoomAssemblyError;

/** A failed run still reports what it spent and counted. */
export interface PipelineJobFailure {
  readonly error: PipelineJobError;
  readonly metadata: PipelineRunMetadata;
}

/**
 * Notes text in, published room out. Stages run in order: prepare, concept extraction,
 * generation, Code_Checks, blind review, assembly. Generation and review run under
 * `runWithConcurrency`; results keep extraction order, so assembly does not depend on completion
 * order. A budget stop (or a code defect in a model-facing schema) ends the job: calls not yet
 * started are skipped and nothing is published. Any other per-question failure sets only that
 * question aside. An abort (options.signal) works like a stop that nothing can outrank: it is
 * checked before every call, at every exit and once before assembly, and the run then returns
 * cancelled, even if a budget stop also happened. Never throws; failures are `PipelineJobFailure` values.
 */
export async function runRoomPipeline(
  notesText: string,
  options: PipelineOptions,
): Promise<Result<PipelineResult, PipelineJobFailure>> {
  const now = options.now ?? ((): number => 0);
  const limit = options.concurrency ?? DEFAULT_CONCURRENCY;
  const recorder = recordCalls(options.provider, now, options.costOf);
  const counts = newCounts();
  const outcomes = newOutcomeLog();
  const progress = progressReporter(options.onProgress);
  const timings = Object.fromEntries(TIMED_STAGES.map((s) => [s, 0])) as Record<TimedStage, number>;
  const metadata = (): PipelineRunMetadata =>
    buildRunMetadata({
      provider: options.providerName,
      modelId: options.modelId,
      temperature: options.temperature,
      checkVersion: CHECK_VERSION,
      calls: recorder.calls(),
      costUsd: recorder.costUsd(),
      stageTimingsMs: timings,
      counts,
      outcomes: snapshotOutcomes(outcomes),
    });
  const fail = (error: PipelineJobError): Result<PipelineResult, PipelineJobFailure> => ({
    ok: false,
    error: { error, metadata: metadata() },
  });
  const timed = async <T>(stage: TimedStage, run: () => Promise<T> | T): Promise<T> => {
    const started = now();
    const value = await run();
    timings[stage] = now() - started;
    return value;
  };

  // Set once by the first budget stop or code defect; tasks check it before starting a call.
  const halt: { error: PipelineStageError | null } = { error: null };
  const stopOn = (error: PipelineStageError): void => {
    if (halt.error === null) halt.error = error;
  };

  const aborted = (): boolean => options.signal?.aborted === true;
  const cancelled = (): Result<PipelineResult, PipelineJobFailure> => fail({ kind: 'cancelled' });
  // Handed to every stage, which checks it before each attempt (retries included).
  const stageOptions: PipelineOptions = {
    ...options,
    shouldStop: () => aborted() || options.shouldStop?.() === true,
  };

  const doc = await timed('prepare', () => prepareDocument(notesText));

  if (aborted()) return cancelled();
  progress.stage('extracting');
  const extracted = await timed('concept-extraction', () =>
    extractConcepts(recorder.provider, options.ledger, doc, stageOptions),
  );
  if (aborted()) return cancelled();
  if (!extracted.ok) return fail(extracted.error);
  const selection = selectRunConcepts(extracted.value, doc, options.target, options.sufficiency, counts);
  if (selection.insufficient !== null) {
    return fail({ kind: 'insufficient-concepts', found: selection.insufficient.found });
  }
  const concepts: readonly ExtractedConcept[] = selection.concepts;
  counts.concepts = concepts.length;
  counts.conceptsNotSelected = selection.candidates - concepts.length;

  // Generation: one task per concept, in extraction order.
  const generatedOne = progress.counted('generating', concepts.length);
  const generated = await timed('generation', () =>
    runWithConcurrency(
      concepts.map((concept) => async (): Promise<Slot<Result<GeneratedConceptQuestions | null, PipelineStageError>>> => {
        if (halt.error !== null || aborted()) return SKIPPED;
        const result = await generateForConcept(recorder.provider, options.ledger, concept, doc, stageOptions);
        if (
          !result.ok &&
          (result.error.kind === 'budget-exhausted' ||
            result.error.kind === 'schema-not-representable' ||
            result.error.kind === 'cancelled')
        ) {
          stopOn(result.error);
        }
        generatedOne();
        return { skipped: false, value: result };
      }),
      limit,
    ),
  );
  if (aborted()) return cancelled();
  if (halt.error !== null) return fail(halt.error);

  const candidates = collectCandidates(generated, concepts, doc, counts, outcomes);

  // Code_Checks, once per question. Blind review is only asked about questions that pass.
  const conceptIdOf = (i: number): string => concepts[i]?.conceptId ?? '';
  const survivors = await timed('code-checks', () =>
    runCodeCheckStage(candidates, doc, conceptIdOf, counts, outcomes),
  );

  // Blind review: one task per surviving question, primary and alternate separately.
  const reviewedOne = progress.counted('reviewing', survivors.length);
  const reviewed = await timed('review', () =>
    runWithConcurrency(
      survivors.map((c) => async (): Promise<Slot<ReviewVerdict>> => {
        if (halt.error !== null || aborted()) return SKIPPED;
        const verdict = await blindReview(recorder.provider, options.ledger, c.question, doc, stageOptions);
        if (verdict.verdict === 'rejected') {
          if (verdict.reason.kind === 'cancelled') stopOn({ kind: 'cancelled' });
          if (verdict.reason.kind === 'budget-exhausted') stopOn({ kind: 'budget-exhausted' });
          if (verdict.reason.kind === 'schema-not-representable') {
            stopOn({ kind: 'schema-not-representable', stage: 'review' });
          }
        }
        reviewedOne();
        return { skipped: false, value: verdict };
      }),
      limit,
    ),
  );

  const accepted = tallyReviews(survivors, reviewed, concepts.length, counts, outcomes);
  // One check before assembly: an abort after the last call still ends as cancelled.
  if (aborted()) return cancelled();
  if (halt.error !== null) return fail(halt.error);

  progress.stage('assembling');
  const built = await runAssemblyPhase({
    doc,
    concepts,
    accepted,
    provider: recorder.provider,
    options: stageOptions,
    counts,
    outcomes,
    timed,
  });
  if (!built.ok) return fail(built.error);
  const { assembly, notices } = built.value;
  recordPlacements(outcomes, assembly);
  counts.mapperRejected = assembly.mapperRejections.length;
  counts.leakDroppedConcepts = assembly.leakDroppedConceptIds.length;

  return {
    ok: true,
    value: {
      manifest: assembly.manifest,
      content: assembly.content,
      unplacedAccepted: assembly.unplacedAccepted,
      metadata: metadata(),
      ...(notices !== undefined && { notices }),
    },
  };
}
