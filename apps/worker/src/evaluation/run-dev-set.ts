import {
  assertRecordedOnly,
  duplicateAnswerScan,
  keyedSpec,
  runRoomPipeline,
  type AssemblyPolicy,
  type BudgetLedger,
  type CassetteEntry,
  type CassetteFile,
  type PipelineResult,
  type Provider,
} from '@escape-the-crypt/core';
import type { PipelineSettings } from '../http/job-runner';
import { makeRecordingCassette } from './recording-cassette-provider';
import type { NoteRun } from './result-file';

export interface DevNote {
  /** File name, e.g. `dev-01-vaccines.txt`. */
  readonly name: string;
  readonly text: string;
}

export interface DevSetDeps {
  readonly notes: readonly DevNote[];
  readonly loadCassette: (note: string) => CassetteFile | null;
  /** Called only when `live` is set: replay never writes. */
  readonly saveCassette: (note: string, file: CassetteFile) => void;
  /** Null replays only, at no cost. */
  readonly live: Provider | null;
  readonly ledger: BudgetLedger;
  readonly settings: PipelineSettings;
  readonly providerName: string;
  readonly checkVersion: string;
  readonly policy?: AssemblyPolicy;
  readonly now: () => number;
  /** Progress lines: counts and IDs only. */
  readonly log: (line: string) => void;
  /** Wraps the cassette provider, e.g. for replay inspection. */
  readonly wrap?: (provider: Provider) => Provider;
}

export interface DevSetRun {
  readonly notes: readonly NoteRun[];
  readonly stopped: 'completed' | 'budget-refused';
}

function duplicateCount(result: PipelineResult): number {
  const entries = result.manifest.rooms
    .flatMap((r) => r.lockSlots)
    .flatMap((slot) =>
      [slot.primaryQuestion, slot.alternateQuestion].flatMap((q) =>
        q === null ? [] : [keyedSpec(slot.conceptId, q, result.content.questions[q.questionId])],
      ),
    );
  return duplicateAnswerScan(entries).length;
}

/** Entries to keep: this run's when it finished, else this run's plus everything already on file. */
function cassetteEntries(
  existing: CassetteFile | null,
  used: readonly CassetteEntry[],
  finished: boolean,
): readonly CassetteEntry[] {
  if (finished) return used;
  const seen = new Set(used.map((e) => e.digest));
  return [...used, ...(existing?.entries ?? []).filter((e) => !seen.has(e.digest))];
}

/**
 * Runs the room pipeline over each dev note in order, replaying cassette hits and (with a live
 * provider) recording misses. Stops after the note in which the ledger refused a reservation.
 * A finished note's cassette is rewritten to exactly the calls it used, so a changed prompt drops
 * the stale entries; a stopped note keeps every entry it had.
 */
export async function runDevSet(deps: DevSetDeps): Promise<DevSetRun> {
  const out: NoteRun[] = [];
  for (const note of deps.notes) {
    const existing = deps.loadCassette(note.name);
    const cassette = makeRecordingCassette(existing, deps.live);
    const result = await runRoomPipeline(note.text, {
      ...deps.settings,
      provider: deps.wrap === undefined ? cassette.provider : deps.wrap(cassette.provider),
      providerName: deps.providerName,
      ledger: deps.ledger,
      now: deps.now,
      ...(deps.policy === undefined ? {} : { assemblyPolicy: deps.policy }),
    });
    const refused = !result.ok && result.error.error.kind === 'budget-exhausted';
    if (deps.live !== null && cassette.recorded().length > 0) {
      const entries = cassetteEntries(existing, cassette.entries(), !refused);
      const recordedOnly = assertRecordedOnly(entries);
      if (recordedOnly.ok) deps.saveCassette(note.name, { checkVersion: deps.checkVersion, entries });
    }
    const metadata = result.ok ? result.value.metadata : result.error.metadata;
    out.push({
      note: note.name,
      ok: result.ok,
      errorKind: result.ok ? null : result.error.error.kind,
      promptDigests: [...metadata.promptDigests],
      liveCalls: cassette.liveCalls(),
      replayedCalls: cassette.replayedCalls(),
      stageTimingsMs: { ...metadata.stageTimingsMs },
      tokens: { inputTokens: metadata.tokens.inputTokens, outputTokens: metadata.tokens.outputTokens },
      costUsd: metadata.costUsd,
      concepts: metadata.outcomes.concepts.map((c) => ({ ...c })),
      candidates: metadata.outcomes.candidates.map((c) => ({ ...c, checkIds: [...c.checkIds] })),
      codeCheckRejections: { ...metadata.counts.codeCheckRejections },
      room: result.ok
        ? {
            slots: result.value.manifest.rooms.flatMap((r) =>
              r.lockSlots.map((s) => ({
                stationType: s.stationType,
                conceptId: s.conceptId,
                primaryQuestionId: s.primaryQuestion.questionId,
                alternateQuestionId: s.alternateQuestion?.questionId ?? null,
              })),
            ),
            duplicateAnswers: duplicateCount(result.value),
          }
        : null,
    });
    const room = out[out.length - 1]?.room;
    deps.log(
      `${note.name}: ${result.ok ? `${room?.slots.length ?? 0} lock(s)` : `failed (${result.error.error.kind})`}, ` +
        `${cassette.liveCalls()} live / ${cassette.replayedCalls()} replayed call(s), $${metadata.costUsd.toFixed(4)}`,
    );
    if (refused) return { notes: out, stopped: 'budget-refused' };
  }
  return { notes: out, stopped: 'completed' };
}
