import { describe, expect, it } from 'vitest';
import { countingProvider } from '../budget/mock-ledger';
import { assertRecordedOnly } from '../cassette/recorded-only';
import { isCassetteMissing, makeCassetteProvider } from '../cassette/cassette-provider';
import { parseCassetteFile } from '../cassette/types';
import { CHECK_VERSION } from '../checks/registry';
import { apply } from '../runtime/apply';
import { initial } from '../runtime/initial';
import { validateManifestForPublish } from '../runtime/publish-manifest';
import { SETTINGS } from '../test-support/run-settings';
import type { Provider } from '../provider/types';
import {
  HUMAN_HEART_E2E_CASSETTE_PATH,
  HUMAN_HEART_E2E_OPTIONS,
  humanHeartE2eLedger,
} from './e2e-cassette-fixtures';
import { HEART, heart } from './generation-fixtures';
import { runRoomPipeline } from './orchestrator';

const [fsName]: string[] = ['node:fs'];
const fs = (await import(fsName!)) as unknown as { readFileSync(p: string, enc: string): string };

function loadCassette() {
  const parsed = parseCassetteFile(JSON.parse(fs.readFileSync(HUMAN_HEART_E2E_CASSETTE_PATH, 'utf8')));
  if (!parsed.ok) throw new Error('human-heart-e2e.json does not parse as a cassette');
  return parsed.value;
}

/** Runs the pipeline once over the cassette; counts hits and watches for `cassette-missing`. */
async function runOnce() {
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
  const ledger = humanHeartE2eLedger();
  const result = await runRoomPipeline(HEART, { ...HUMAN_HEART_E2E_OPTIONS, provider: counted, ledger });
  return { cassette, counted, ledger, result, missing: () => missing };
}

describe('human-heart cassette-driven pipeline (end to end)', () => {
  it('publishes one playable room from the sample notes', async () => {
    const { cassette, counted, ledger, result, missing } = await runOnce();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const { manifest, content, unplacedAccepted, metadata } = result.value;

    // One room, two slots, each with its alternate.
    expect(manifest.rooms).toHaveLength(1);
    const slots = manifest.rooms[0]?.lockSlots ?? [];
    expect(slots.map((s) => s.slotId)).toEqual(['slot-rune-cipher', 'slot-seance-board']);
    expect(slots.map((s) => s.conceptId)).toEqual(['concept-1', 'concept-2']);
    expect(slots.map((s) => s.alternateQuestion?.lockType)).toEqual(['seance-board', 'rune-cipher']);
    expect(manifest.finalDoor.slots).toEqual([]);
    expect(validateManifestForPublish(manifest).ok).toBe(true);

    // Content covers every manifest question and placed concept.
    const manifestQuestionIds = slots.flatMap((s) => [
      s.primaryQuestion.questionId,
      ...(s.alternateQuestion === null ? [] : [s.alternateQuestion.questionId]),
    ]);
    expect(manifestQuestionIds).toHaveLength(4);
    for (const id of manifestQuestionIds) {
      const entry = content.questions[id];
      expect(entry, id).toBeDefined();
      expect(entry?.excerpts.length ?? 0).toBeGreaterThanOrEqual(1);
    }
    for (const s of slots) expect(content.concepts[s.conceptId]).toBeDefined();

    // The accepted concept-3 question is set aside, not in the manifest.
    expect(unplacedAccepted.map((u) => u.conceptId)).toContain('concept-3');
    const manifestJson = JSON.stringify(manifest);
    for (const u of unplacedAccepted.filter((x) => x.conceptId === 'concept-3')) {
      expect(manifestJson).not.toContain(u.question.questionId);
      expect(content.questions[u.question.questionId]).toBeUndefined();
    }

    // Metadata: one digest per cassette hit, no misses, current check version.
    expect(missing()).toBe(0);
    expect(metadata.promptDigests).toHaveLength(9);
    expect(metadata.promptDigests).toHaveLength(counted.calls);
    expect(new Set(metadata.promptDigests)).toEqual(new Set(cassette.entries.map((e) => e.digest)));
    expect(metadata.checkVersion).toBe(CHECK_VERSION);

    // Ledger: 9 reservations, all reconciled, nothing outstanding.
    expect(ledger.reservations).toBe(9);
    expect(ledger.reconciles).toBe(9);
    expect(ledger.releases).toBe(0);
    expect(ledger.outstandingMicroUsd).toBe(0);

    // Metadata carries no notes text.
    const metaJson = JSON.stringify(metadata);
    const sentences = [...heart.chunks.values()].map((c) => c.text).filter((t) => t.length >= 20);
    expect(sentences.length).toBeGreaterThan(0);
    for (const text of sentences) expect(metaJson).not.toContain(text);
    for (const entry of Object.values(content.questions)) {
      for (const excerpt of entry.excerpts) expect(metaJson).not.toContain(excerpt.quote);
    }

    // A synthetic cassette must be refused by the evaluation guard.
    const guard = assertRecordedOnly(cassette.entries);
    expect(guard.ok).toBe(false);
    if (!guard.ok) expect(guard.error.kind).toBe('synthetic-cassette-in-evaluation');

    // Smoke check: the runtime accepts the published manifest.
    const started = apply(initial(manifest, SETTINGS), { kind: 'RunStarted', manifestId: manifest.manifestId });
    expect(started.ok).toBe(true);
  });
});
