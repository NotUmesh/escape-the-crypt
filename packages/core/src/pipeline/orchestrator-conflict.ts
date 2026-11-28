import type { AuthoringQuestion } from '../authoring/schema';
import type { Provider } from '../provider/types';
import type { Result } from '../types';
import type { OutcomeLog } from './candidate-outcomes';
import type { ExtractedConcept } from './concept-extraction';
import { runConflictStage } from './conflict-stage';
import { assembleForTarget } from './crypt-assembly';
import { manifestIdOf } from './crypt-manifest-id';
import type { PipelineOptions } from './orchestrator';
import { withSufficiencyNotice } from './orchestrator-sufficiency';
import type { PipelineNotices } from './pipeline-notices';
import type { PreparedDocument } from './prepare-input';
import type { AssemblyConcept, RoomAssembly, RoomAssemblyError } from './room-assembly';
import type { PipelineRunCounts, TimedStage } from './run-metadata';
import type { PipelineStageError } from './stage-error';

export interface AssemblyPhaseInput {
  readonly doc: PreparedDocument;
  /** The concepts of this run, in extraction order. */
  readonly concepts: readonly ExtractedConcept[];
  /** Accepted questions per concept: `[primary, alternate]`. */
  readonly accepted: readonly (readonly (AuthoringQuestion | null)[])[];
  /** The run's recording provider. */
  readonly provider: Provider;
  /** The run's options, with the stop check the stages share. */
  readonly options: PipelineOptions;
  readonly counts: PipelineRunCounts;
  readonly outcomes: OutcomeLog;
  readonly timed: <T>(stage: TimedStage, run: () => Promise<T> | T) => Promise<T>;
}

export interface AssemblyPhaseOutput {
  readonly assembly: RoomAssembly;
  /** Absent, not empty, when there is nothing to report. */
  readonly notices?: PipelineNotices;
}

/**
 * Final assembly of the crypt. With `options.conflictCheck` off this is the plain assembly, as
 * before. With it on, the conflict stage runs between blind review and the final assembly:
 * its counts and timing go to the run metadata, questions of excluded concepts are marked
 * `conflict-rejected`, and the excluded concepts become `notices.excluded`.
 */
export async function runAssemblyPhase(
  input: AssemblyPhaseInput,
): Promise<Result<AssemblyPhaseOutput, PipelineStageError | RoomAssemblyError>> {
  const { doc, options, counts } = input;
  const assemblyConcepts: AssemblyConcept[] = input.concepts.map((concept, i) => ({
    conceptId: concept.conceptId,
    label: concept.label,
    primary: input.accepted[i]?.[0] ?? null,
    alternate: input.accepted[i]?.[1] ?? null,
  }));
  const assemble = (concepts: readonly AssemblyConcept[]): Result<RoomAssembly, RoomAssemblyError> =>
    assembleForTarget(
      { manifestId: manifestIdOf(doc), document: doc, concepts, ...(options.assemblyPolicy && { policy: options.assemblyPolicy }) },
      options.target,
    );

  const good = assemblyConcepts.filter((c) => c.primary !== null || c.alternate !== null).length;
  const withNotice = (assembly: RoomAssembly, notices?: PipelineNotices): AssemblyPhaseOutput => {
    const merged = withSufficiencyNotice(notices, options.sufficiency, options.target, good, assembly.manifest.rooms.length);
    return { assembly, ...(merged !== undefined && { notices: merged }) };
  };

  if (options.conflictCheck !== true) {
    if (options.sufficiency === true) counts.goodConcepts = good;
    const assembled = await input.timed('assembly', () => assemble(assemblyConcepts));
    return assembled.ok ? { ok: true, value: withNotice(assembled.value) } : assembled;
  }

  counts.goodConcepts = good;
  const staged = await input.timed('conflict-check', () =>
    runConflictStage({
      concepts: assemblyConcepts,
      extracted: input.concepts,
      doc,
      assemble,
      provider: input.provider,
      ledger: options.ledger,
      options,
    }),
  );
  if (!staged.ok) return staged;
  const { assembly, excluded, counts: stageCounts } = staged.value;
  Object.assign(counts, stageCounts);
  const gone = new Set(excluded.map((e) => e.conceptId));
  input.outcomes.candidates.forEach((c, i) => {
    if (c.result === 'accepted' && gone.has(c.conceptId)) {
      input.outcomes.candidates[i] = { ...c, result: 'conflict-rejected' };
    }
  });
  return {
    ok: true,
    value: withNotice(assembly, excluded.length > 0 ? { excluded, sufficiency: null } : undefined),
  };
}
