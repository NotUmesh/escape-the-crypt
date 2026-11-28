import type { AuthoringQuestion } from '../authoring/schema';
import type { BudgetLedger } from '../budget/types';
import type { Provider } from '../provider/types';
import type { CryptManifest } from '../runtime/manifest-types';
import type { Result } from '../types';
import type { ExtractedConcept } from './concept-extraction';
import { DEFAULT_CONCURRENCY, runWithConcurrency } from './concurrency';
import { checkRoomForConflicts, type ConflictCheckOptions, type RoomConflictOutcome } from './conflict-check';
import { findCodeConflicts } from './conflict-code';
import type { PreparedDocument } from './prepare-input';
import type { AssemblyConcept, RoomAssembly, RoomAssemblyError } from './room-assembly';
import type { PipelineStageError } from './stage-error';

/** One passage of a notice: a chunk ID that code resolved, and the quote as it appears. */
export interface Passage {
  readonly chunkId: string;
  readonly quote: string;
}

/** A concept left out of the crypt because two passages of the notes seem to disagree. */
export interface ExcludedConcept {
  readonly conceptId: string;
  readonly conceptTitle: string;
  readonly source: 'code' | 'model';
  readonly passages: readonly [Passage, Passage];
}

/** Counts for the run metadata. Numbers only. */
export interface ConflictStageCounts {
  /** Rooms whose check returned a valid reply. */
  readonly conflictRoomsChecked: number;
  /** Rooms whose check failed (provider or schema failure): left out of the crypt, fail closed. */
  readonly conflictRoomsUnchecked: number;
  readonly conceptsExcludedByConflict: number;
  /** Reports that said "conflict" but failed a rule in code. */
  readonly conflictReportsIgnored: number;
}

export interface ConflictStageOutcome {
  readonly assembly: RoomAssembly;
  readonly excluded: readonly ExcludedConcept[];
  readonly counts: ConflictStageCounts;
}

export type ConflictStageOptions = ConflictCheckOptions & { readonly concurrency?: number };

export interface ConflictStageInput {
  /** Accepted questions per concept. */
  readonly concepts: readonly AssemblyConcept[];
  readonly extracted: readonly ExtractedConcept[];
  readonly doc: PreparedDocument;
  /** The run's crypt assembly (pure and free), injected so the stage stays decoupled. */
  readonly assemble: (concepts: readonly AssemblyConcept[]) => Result<RoomAssembly, RoomAssemblyError>;
  readonly provider: Provider;
  readonly ledger: BudgetLedger;
  readonly options: ConflictStageOptions;
}

type Room = CryptManifest['rooms'][number];
interface ShownQuestion {
  readonly questionId: string;
  readonly question: AuthoringQuestion;
}
type RoomSlot =
  | { readonly skipped: true }
  | { readonly skipped: false; readonly value: Result<RoomConflictOutcome, PipelineStageError> };

const idOf = (conceptId: string, role: 'primary' | 'alternate'): string => `${conceptId}-${role}`;

/** The room's questions in the order the checker is shown them: each slot's primary, then alternate. */
function shownQuestions(room: Room, byId: ReadonlyMap<string, AssemblyConcept>): readonly ShownQuestion[] {
  const out: ShownQuestion[] = [];
  for (const slot of room.lockSlots) {
    const concept = byId.get(slot.conceptId);
    if (concept === undefined) continue;
    for (const spec of [slot.primaryQuestion, slot.alternateQuestion]) {
      if (spec == null) continue;
      const question = spec.questionId.endsWith('-alternate') ? concept.alternate : concept.primary;
      if (question !== null) out.push({ questionId: spec.questionId, question });
    }
  }
  return out;
}

function codeExclusions(
  concepts: readonly AssemblyConcept[],
  extracted: readonly ExtractedConcept[],
  doc: PreparedDocument,
): ExcludedConcept[] {
  const titles = new Map(concepts.map((c) => [c.conceptId, c.label] as const));
  const out = new Map<string, ExcludedConcept>();
  const present = extracted.filter((c) => titles.has(c.conceptId));
  for (const conflict of findCodeConflicts(present, doc)) {
    const [p, q] = conflict.passages;
    conflict.conceptIds.forEach((conceptId, i) => {
      if (out.has(conceptId)) return;
      out.set(conceptId, {
        conceptId,
        conceptTitle: titles.get(conceptId) ?? '',
        source: 'code',
        passages: i === 0 ? [p, q] : [q, p],
      });
    });
  }
  return [...out.values()];
}

/**
 * Conflict stage (design 1c). A code scan sets aside concepts whose notes state different numbers
 * for one label. The rest are assembled provisionally (free), and each provisional room is
 * checked with one call, up to `concurrency` at a time (default 4, no second round). Replies are
 * resolved in code. The final crypt is assembled only from questions of rooms that were checked,
 * minus excluded concepts. A room whose check failed is left out (fail closed). If checks failed
 * and no checked question is left, the stage returns `conflict-check-failed`. With every room
 * checked and no model conflict, the provisional assembly is returned as it is. Accepted
 * questions without a room stay in the bundle, never playable and never model-checked; excluded
 * concepts are removed from them. Budget stops and aborts end the stage with their own error.
 * Never throws.
 */
export async function runConflictStage(
  input: ConflictStageInput,
): Promise<Result<ConflictStageOutcome, PipelineStageError | RoomAssemblyError>> {
  const { concepts, doc, options } = input;
  const aborted = (): boolean => options.signal?.aborted === true;
  const excluded = codeExclusions(concepts, input.extracted, doc);
  const isExcluded = (conceptId: string): boolean => excluded.some((e) => e.conceptId === conceptId);

  const provisional = input.assemble(concepts.filter((c) => !isExcluded(c.conceptId)));
  if (!provisional.ok) return provisional;
  const first = provisional.value;

  const byId = new Map(concepts.map((c) => [c.conceptId, c] as const));
  const rooms = first.manifest.rooms.map((room) => shownQuestions(room, byId));
  const halt: { error: PipelineStageError | null } = { error: null };
  const results = await runWithConcurrency(
    rooms.map((room) => async (): Promise<RoomSlot> => {
      if (halt.error !== null || aborted()) return { skipped: true };
      const checked = await checkRoomForConflicts(
        input.provider,
        input.ledger,
        room.map((r) => r.question),
        doc,
        options,
      );
      if (!checked.ok && halt.error === null) halt.error = checked.error;
      return { skipped: false, value: checked };
    }),
    options.concurrency ?? DEFAULT_CONCURRENCY,
  );
  if (aborted()) return { ok: false, error: { kind: 'cancelled' } };
  if (halt.error !== null) return { ok: false, error: halt.error };

  const clean = new Set<string>();
  let checkedRooms = 0;
  let uncheckedRooms = 0;
  let ignored = 0;
  let modelConflicts = 0;
  results.forEach((result, index) => {
    const slot = result.ok ? result.value : null;
    const outcome = slot !== null && !slot.skipped && slot.value.ok ? slot.value.value : null;
    if (outcome === null || outcome.status !== 'checked') {
      uncheckedRooms += 1;
      return;
    }
    checkedRooms += 1;
    ignored += outcome.conflictReportsIgnored;
    for (const shown of rooms[index] ?? []) clean.add(shown.questionId);
    for (const hit of outcome.confirmed) {
      if (isExcluded(hit.conceptId)) continue;
      modelConflicts += 1;
      excluded.push({
        conceptId: hit.conceptId,
        conceptTitle: byId.get(hit.conceptId)?.label ?? '',
        source: 'model',
        passages: [hit.own, hit.other],
      });
    }
  });
  const counts: ConflictStageCounts = {
    conflictRoomsChecked: checkedRooms,
    conflictRoomsUnchecked: uncheckedRooms,
    conceptsExcludedByConflict: excluded.length,
    conflictReportsIgnored: ignored,
  };

  // Every room checked and no model conflict: the provisional crypt already leaves out the code set.
  if (uncheckedRooms === 0 && modelConflicts === 0) {
    return { ok: true, value: { assembly: first, excluded, counts } };
  }

  const kept = concepts
    .filter((c) => !isExcluded(c.conceptId))
    .map((c) => ({
      ...c,
      primary: clean.has(idOf(c.conceptId, 'primary')) ? c.primary : null,
      alternate: clean.has(idOf(c.conceptId, 'alternate')) ? c.alternate : null,
    }))
    .filter((c) => c.primary !== null || c.alternate !== null);
  if (rooms.length > 0 && uncheckedRooms > 0 && kept.length === 0) {
    return { ok: false, error: { kind: 'conflict-check-failed' } };
  }

  const final = input.assemble(kept);
  if (!final.ok) return final;
  const seen = new Set([
    ...final.value.manifest.rooms.flatMap((r) => r.lockSlots.map((s) => s.conceptId)),
    ...final.value.unplacedAccepted.map((u) => u.conceptId),
  ]);
  const carried = first.unplacedAccepted.filter((u) => !isExcluded(u.conceptId) && !seen.has(u.conceptId));
  const unplacedAccepted = [...final.value.unplacedAccepted, ...carried].filter((u) => !isExcluded(u.conceptId));
  return { ok: true, value: { assembly: { ...final.value, unplacedAccepted }, excluded, counts } };
}
