import type { AuthoringQuestion } from '../authoring/schema';
import type { BudgetLedger } from '../budget/types';
import { CHECK_REGISTRY, CHECK_VERSION } from '../checks/registry';
import { runChecks } from '../checks/run-checks';
import type { CryptContent } from '../mapper/crypt-content';
import type { Provider } from '../provider/types';
import type { CryptManifest } from '../runtime/manifest-types';
import type { Result } from '../types';
import { blindReview, type ReviewVerdict } from './blind-review';
import { extractConcepts, type ExtractedConcept } from './concept-extraction';
import { DEFAULT_CONCURRENCY, runWithConcurrency } from './concurrency';
import {
  generateForConcept,
  type GeneratedConceptQuestions,
  type GenerationOptions,
} from './generation';
import { prepareDocument, toEvidenceContext, type PreparedDocument } from './prepare-input';
import { recordCalls } from './recording-provider';
import {
  assembleRoom,
  type AssemblyConcept,
  type RoomAssemblyError,
  type UnplacedAccepted,
} from './room-assembly';
import {
  TIMED_STAGES,
  buildRunMetadata,
  newCounts,
  type PipelineRunMetadata,
  type TimedStage,
} from './run-metadata';
import type { PipelineStageError } from './stage-error';

export type { UnplacedAccepted } from './room-assembly';

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
}

export interface PipelineResult {
  readonly manifest: CryptManifest;
  readonly content: CryptContent;
  /** Accepted questions without a room slot. Not in the manifest, not playable. */
  readonly unplacedAccepted: readonly UnplacedAccepted[];
  readonly metadata: PipelineRunMetadata;
}

/** Closed set. Kinds and stage names only: no notes, prompts or model output. */
export type PipelineJobError = PipelineStageError | RoomAssemblyError;

/** A failed run still reports what it spent and counted. */
export interface PipelineJobFailure {
  readonly error: PipelineJobError;
  readonly metadata: PipelineRunMetadata;
}

const BLOCKING_IDS: ReadonlySet<string> = new Set(
  CHECK_REGISTRY.filter((r) => r.severity !== 'advisory').map((r) => r.id),
);

interface Candidate {
  readonly conceptIndex: number;
  readonly role: 'primary' | 'alternate';
  readonly question: AuthoringQuestion;
}

type Slot<T> = { readonly skipped: true } | { readonly skipped: false; readonly value: T };
const SKIPPED = { skipped: true } as const;

function manifestIdOf(doc: PreparedDocument): string {
  for (const chunk of doc.chunks.values()) return `crypt-${chunk.documentDigest.slice(0, 16)}`;
  return 'crypt-empty';
}

/**
 * Notes text in, published room out. Stages run in order: prepare, concept extraction,
 * generation, Code_Checks, blind review, assembly. Generation and review run under
 * `runWithConcurrency`; results keep extraction order, so assembly does not depend on completion
 * order. A budget stop (or a code defect in a model-facing schema) ends the job: calls not yet
 * started are skipped and nothing is published. Any other per-question failure sets only that
 * question aside. Never throws; failures are `PipelineJobFailure` values.
 */
export async function runRoomPipeline(
  notesText: string,
  options: PipelineOptions,
): Promise<Result<PipelineResult, PipelineJobFailure>> {
  const now = options.now ?? ((): number => 0);
  const limit = options.concurrency ?? DEFAULT_CONCURRENCY;
  const recorder = recordCalls(options.provider, now, options.costOf);
  const counts = newCounts();
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

  const doc = await timed('prepare', () => prepareDocument(notesText));

  const extracted = await timed('concept-extraction', () =>
    extractConcepts(recorder.provider, options.ledger, doc, options),
  );
  if (!extracted.ok) return fail(extracted.error);
  const concepts: readonly ExtractedConcept[] = extracted.value;
  counts.concepts = concepts.length;

  // Generation: one task per concept, in extraction order.
  const generated = await timed('generation', () =>
    runWithConcurrency(
      concepts.map((concept) => async (): Promise<Slot<Result<GeneratedConceptQuestions | null, PipelineStageError>>> => {
        if (halt.error !== null) return SKIPPED;
        const result = await generateForConcept(recorder.provider, options.ledger, concept, doc, options);
        if (
          !result.ok &&
          (result.error.kind === 'budget-exhausted' || result.error.kind === 'schema-not-representable')
        ) {
          stopOn(result.error);
        }
        return { skipped: false, value: result };
      }),
      limit,
    ),
  );
  if (halt.error !== null) return fail(halt.error);

  const candidates: Candidate[] = [];
  generated.forEach((outcome, conceptIndex) => {
    const slot = outcome.ok ? outcome.value : SKIPPED;
    if (slot.skipped || !slot.value.ok) {
      if (!slot.skipped && !slot.value.ok && slot.value.error.kind === 'schema-rejected') {
        counts.schemaRejected += 1;
      }
      counts.conceptsSetAside += 1;
      return;
    }
    const pair = slot.value.value;
    if (pair === null) return; // the model chose no lock: not a failure
    candidates.push({ conceptIndex, role: 'primary', question: pair.primary });
    if (pair.alternate !== null) {
      candidates.push({ conceptIndex, role: 'alternate', question: pair.alternate });
    }
  });
  counts.candidates = candidates.length;

  // Code_Checks, once per question. Blind review is only asked about questions that pass.
  const survivors = await timed('code-checks', () => {
    const evidence = toEvidenceContext(doc);
    return candidates.filter((c) => {
      const siblings = candidates
        .filter((o) => o.conceptIndex === c.conceptIndex && o !== c)
        .map((o) => o.question);
      const ids = new Set(
        runChecks({ question: c.question, siblings, ...evidence })
          .filter((f) => BLOCKING_IDS.has(f.checkId))
          .map((f) => f.checkId),
      );
      if (ids.size === 0) return true;
      for (const id of ids) counts.codeCheckRejections[id] = (counts.codeCheckRejections[id] ?? 0) + 1;
      counts.discarded += 1;
      return false;
    });
  });

  // Blind review: one task per surviving question, primary and alternate separately.
  const reviewed = await timed('review', () =>
    runWithConcurrency(
      survivors.map((c) => async (): Promise<Slot<ReviewVerdict>> => {
        if (halt.error !== null) return SKIPPED;
        const verdict = await blindReview(recorder.provider, options.ledger, c.question, doc, options);
        if (verdict.verdict === 'rejected') {
          if (verdict.reason.kind === 'budget-exhausted') stopOn({ kind: 'budget-exhausted' });
          if (verdict.reason.kind === 'schema-not-representable') {
            stopOn({ kind: 'schema-not-representable', stage: 'review' });
          }
        }
        return { skipped: false, value: verdict };
      }),
      limit,
    ),
  );

  const accepted: (AuthoringQuestion | null)[][] = concepts.map(() => [null, null]);
  survivors.forEach((c, i) => {
    const outcome = reviewed[i];
    if (outcome === undefined || (outcome.ok && outcome.value.skipped)) return;
    // A task that rejected despite the never-throws contract sets only its question aside.
    const verdict: ReviewVerdict | null = outcome.ok && !outcome.value.skipped ? outcome.value.value : null;
    if (verdict?.verdict === 'passed') {
      counts.accepted += 1;
      const row = accepted[c.conceptIndex];
      if (row !== undefined) row[c.role === 'primary' ? 0 : 1] = c.question;
      return;
    }
    // A budget/defect stop is not a judgement on the question.
    if (verdict?.verdict === 'rejected') {
      const kind = verdict.reason.kind;
      if (kind === 'budget-exhausted' || kind === 'schema-not-representable') return;
      if (kind === 'schema-rejected') counts.schemaRejected += 1;
    }
    counts.reviewRejections += 1;
    counts.discarded += 1;
  });
  if (halt.error !== null) return fail(halt.error);

  const assemblyConcepts: AssemblyConcept[] = concepts.map((concept, i) => ({
    conceptId: concept.conceptId,
    label: concept.label,
    primary: accepted[i]?.[0] ?? null,
    alternate: accepted[i]?.[1] ?? null,
  }));
  const assembled = await timed('assembly', () =>
    assembleRoom({ manifestId: manifestIdOf(doc), document: doc, concepts: assemblyConcepts }),
  );
  if (!assembled.ok) return fail(assembled.error);
  counts.mapperRejected = assembled.value.mapperRejections.length;
  counts.leakDroppedConcepts = assembled.value.leakDroppedConceptIds.length;

  return {
    ok: true,
    value: {
      manifest: assembled.value.manifest,
      content: assembled.value.content,
      unplacedAccepted: assembled.value.unplacedAccepted,
      metadata: metadata(),
    },
  };
}
