import { describe, expect, it } from 'vitest';
import { countingProvider } from '../budget/mock-ledger';
import { isCassetteMissing, makeCassetteProvider } from '../cassette/cassette-provider';
import { parseCassetteFile } from '../cassette/types';
import { CHECK_VERSION } from '../checks/registry';
import { runChecks } from '../checks/run-checks';
import { promptDigest } from '../provider/prompt-digest';
import type { Provider } from '../provider/types';
import { resolveQuote } from '../quote-resolver';
import { conflictShownId, type ConflictResponse } from './conflict-prompt';
import { resolveConflictReports } from './conflict-report';
import {
  CONFLICT_CHECK_E2E_CASSETTE_PATH,
  CONFLICT_CHECK_E2E_OPTIONS,
  CONFLICT_NOTES,
  DIAL_LABEL,
  OTHER_QUOTE,
  PHASES_QUOTE,
  adv18Question,
  captureConflictE2e,
  chunkIdOfQuote,
  conflictDoc,
  conflictE2eLedger,
  ordinalOfChunk,
  readAdv18,
} from './conflict-check-e2e-fixtures';
import { runRoomPipeline } from './orchestrator';
import { toEvidenceContext } from './prepare-input';

const [fsName]: string[] = ['node:fs'];
const fs = (await import(fsName!)) as unknown as { readFileSync(p: string, enc: string): string };

function loadCassette() {
  const parsed = parseCassetteFile(JSON.parse(fs.readFileSync(CONFLICT_CHECK_E2E_CASSETTE_PATH, 'utf8')));
  if (!parsed.ok) throw new Error('conflict-check-e2e.json does not parse as a cassette');
  return parsed.value;
}

const reply = (r: { conflict: boolean; paragraph: number | null; quote: string | null }): ConflictResponse => ({
  results: [{ questionId: conflictShownId(0), ...r }],
});
const dial = adv18Question();
const resolve = (r: Parameters<typeof reply>[0]) => {
  const out = resolveConflictReports(reply(r), [dial], conflictDoc);
  if (!out.ok) throw new Error(out.error.kind);
  return out.value;
};

describe('adv-18 against the checks', () => {
  it('numbers the passages as the fixture does (27 days in paragraph 4, 35 days in paragraph 7)', () => {
    expect(ordinalOfChunk(chunkIdOfQuote('The Moon takes about 27 days to orbit Earth.'))).toBe(4);
    expect(ordinalOfChunk(chunkIdOfQuote(OTHER_QUOTE))).toBe(7);
    expect(readAdv18().question.evidence[0]?.paragraph).toBe(4);
  });

  it('passes Code_Checks with no blocking failure (asserted, not assumed)', () => {
    const failures = runChecks({ question: dial, ...toEvidenceContext(conflictDoc) });
    expect(failures).toEqual([]);
  });
});

describe('adv-18 conflict reports resolved in code', () => {
  it('confirms the 35-day passage, which resolves uniquely and holds a different number', () => {
    const out = resolve({ conflict: true, paragraph: 7, quote: OTHER_QUOTE });
    expect(out.confirmed).toHaveLength(1);
    expect(out.conflictReportsIgnored).toBe(0);
    const hit = out.confirmed[0]!;
    for (const passage of [hit.own, hit.other]) {
      expect(resolveQuote(conflictDoc.chunks, passage.chunkId, passage.quote).ok).toBe(true);
    }
    expect(hit.own.chunkId).not.toBe(hit.other.chunkId);
  });

  // One cassette entry holds the one reply for the one room request, so the three counter-cases
  // are asserted at unit level through resolveConflictReports, not as separate pipeline runs.
  it('ignores a quote that is not in the notes', () => {
    const out = resolve({ conflict: true, paragraph: 7, quote: 'The Moon takes about 40 days to orbit Earth.' });
    expect(out.confirmed).toEqual([]);
    expect(out.conflictReportsIgnored).toBe(1);
  });

  it("ignores a quote of the question's own 27-day sentence", () => {
    const out = resolve({ conflict: true, paragraph: 4, quote: 'The Moon takes about 27 days to orbit Earth.' });
    expect(out.confirmed).toEqual([]);
    expect(out.conflictReportsIgnored).toBe(1);
  });

  it('ignores a passage with no number different from 27', () => {
    const out = resolve({
      conflict: true,
      paragraph: 6,
      quote: 'The Moon always shows the same face to Earth, because it spins once on its axis',
    });
    expect(out.confirmed).toEqual([]);
    expect(out.conflictReportsIgnored).toBe(1);
  });

  it('records the known gap: the 29.5-day sentence passes the code rules', () => {
    const out = resolve({ conflict: true, paragraph: 4, quote: PHASES_QUOTE });
    // Same paragraph as the key but a different span, so no overlap; 29.5 differs from 27.
    expect(out.confirmed).toHaveLength(1);
  });
});

describe('conflict-check cassette-driven pipeline (adv-18)', () => {
  it('is a synthetic cassette at the current check version, with digests of pipeline-built requests', async () => {
    const file = loadCassette();
    expect(file.checkVersion).toBe(CHECK_VERSION);
    expect(file.entries.every((e) => e.origin === 'synthetic')).toBe(true);
    const { entries, stages, requests } = await captureConflictE2e();
    expect(stages).toEqual([
      'concept-extraction',
      'generation',
      'generation',
      'review',
      'review',
      'conflict-check',
    ]);
    const built = requests.map((r) => promptDigest(r));
    expect(file.entries.map((e) => e.digest)).toEqual(built);
    expect(new Set(built).size).toBe(built.length);
    expect(file.entries.map((e) => e.response)).toEqual(entries.map((e) => e.response));
  });

  it('rejects adv-18 in the conflict layer only: checks and blind review accept it', async () => {
    const cassette = loadCassette();
    const replay = makeCassetteProvider(cassette);
    let missing = 0;
    const watched: Provider = {
      async complete(request) {
        const result = await replay.complete(request);
        if (isCassetteMissing(result)) missing += 1;
        return result;
      },
    };
    const counted = countingProvider(watched);
    const ledger = conflictE2eLedger();
    const result = await runRoomPipeline(CONFLICT_NOTES, {
      ...CONFLICT_CHECK_E2E_OPTIONS,
      provider: counted,
      ledger,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const { manifest, metadata, notices } = result.value;

    expect(missing).toBe(0);
    expect(counted.calls).toBe(cassette.entries.length);
    expect(metadata.checkVersion).toBe(CHECK_VERSION);
    expect(ledger.outstandingMicroUsd).toBe(0);

    // Not rejected by Code_Checks or blind review (Requirement 24.5).
    expect(metadata.counts.candidates).toBe(2);
    expect(metadata.counts.codeCheckRejections).toEqual({});
    expect(metadata.counts.reviewRejections).toBe(0);
    expect(metadata.counts.accepted).toBe(2);
    // Rejected by the conflict layer.
    expect(metadata.counts.conflictRoomsChecked).toBe(1);
    expect(metadata.counts.conceptsExcludedByConflict).toBe(1);
    expect(metadata.counts.conflictReportsIgnored).toBe(0);
    const excluded = notices?.excluded ?? [];
    expect(excluded).toHaveLength(1);
    const hit = excluded[0]!;
    expect(hit.conceptTitle).toBe(DIAL_LABEL);
    expect(hit.source).toBe('model');
    expect(metadata.outcomes.candidates.filter((c) => c.conceptId === hit.conceptId).map((c) => c.result)).toEqual([
      'conflict-rejected',
    ]);

    // The notice holds both passages, and each resolves uniquely.
    expect(hit.passages.map((p) => p.quote)).toEqual(['The Moon takes about 27 days to orbit Earth.', OTHER_QUOTE]);
    for (const p of hit.passages) {
      expect(resolveQuote(conflictDoc.chunks, p.chunkId, p.quote).ok).toBe(true);
    }
    expect(hit.passages[0].chunkId).not.toBe(hit.passages[1].chunkId);

    // The concept is out of the crypt.
    const inManifest = manifest.rooms.flatMap((r) => r.lockSlots.map((s) => s.conceptId));
    expect(inManifest).not.toContain(hit.conceptId);
    expect(inManifest.length).toBeGreaterThan(0);
  });
});
