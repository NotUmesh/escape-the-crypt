import { describe, expect, it } from 'vitest';
import { countingProvider } from '../budget/mock-ledger';
import { isCassetteMissing, makeCassetteProvider } from '../cassette/cassette-provider';
import { parseCassetteFile } from '../cassette/types';
import { CHECK_VERSION } from '../checks/registry';
import { promptDigest } from '../provider/prompt-digest';
import type { Provider } from '../provider/types';
import { validateManifestForPublish } from '../runtime/publish-manifest';
import {
  BONE_NOTES,
  BONE_ORDERING_E2E_CASSETTE_PATH,
  BONE_ORDERING_E2E_OPTIONS,
  BONE_PROMPT,
  BONE_STEPS,
  boneE2eLedger,
  captureBoneOrderingE2e,
} from './bone-ordering-e2e-fixtures';
import { runRoomPipeline } from './orchestrator';

const [fsName]: string[] = ['node:fs'];
const fs = (await import(fsName!)) as unknown as { readFileSync(p: string, enc: string): string };
const env = (globalThis as unknown as { process?: { env: Record<string, string | undefined> } }).process
  ?.env;

function loadCassette() {
  const parsed = parseCassetteFile(JSON.parse(fs.readFileSync(BONE_ORDERING_E2E_CASSETTE_PATH, 'utf8')));
  if (!parsed.ok) throw new Error('bone-ordering-e2e.json does not parse as a cassette');
  return parsed.value;
}

describe('bone-ordering cassette-driven pipeline', () => {
  it('prints the cassette JSON when REGENERATE is set (never writes a file)', async () => {
    if (env?.REGENERATE === undefined) return;
    const { entries } = await captureBoneOrderingE2e();
    const out = (globalThis as unknown as { console: { log(s: string): void } }).console;
    out.log(`<<<CASSETTE\n${JSON.stringify({ checkVersion: CHECK_VERSION, entries }, null, 2)}\nCASSETTE>>>`);
  });

  it('is a synthetic cassette at the current check version, with digests of pipeline-built requests', async () => {
    const file = loadCassette();
    expect(file.checkVersion).toBe(CHECK_VERSION);
    expect(file.entries.every((e) => e.origin === 'synthetic')).toBe(true);
    const { entries, stages, requests } = await captureBoneOrderingE2e();
    // 1 extraction, 2 generation (one per concept), 2 review (one per question past Code_Checks).
    expect(stages).toEqual(['concept-extraction', 'generation', 'generation', 'review', 'review']);
    const built = requests.map((r) => promptDigest(r));
    expect(file.entries.map((e) => e.digest)).toEqual(built);
    expect(new Set(built).size).toBe(built.length);
    expect(file.entries.map((e) => e.response)).toEqual(entries.map((e) => e.response));
  });

  it('generates a bone-ordering primary that passes checks and review, maps, and publishes', async () => {
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
    const ledger = boneE2eLedger();
    const result = await runRoomPipeline(BONE_NOTES, {
      ...BONE_ORDERING_E2E_OPTIONS,
      provider: counted,
      ledger,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const { manifest, content, metadata } = result.value;

    // Generated, past Code_Checks and blind review.
    expect(missing).toBe(0);
    expect(counted.calls).toBe(cassette.entries.length);
    expect(metadata.counts.candidates).toBe(2);
    expect(metadata.counts.codeCheckRejections).toEqual({});
    expect(metadata.counts.reviewRejections).toBe(0);
    expect(metadata.counts.accepted).toBe(2);
    expect(metadata.counts.mapperRejected).toBe(0);
    expect(metadata.checkVersion).toBe(CHECK_VERSION);
    expect(ledger.reservations).toBe(5);
    expect(ledger.outstandingMicroUsd).toBe(0);

    // Mapped by the real mapper into a bone-ordering slot that keeps the step order.
    const slots = manifest.rooms.flatMap((r) => r.lockSlots);
    const bone = slots.find((s) => s.primaryQuestion.lockType === 'bone-ordering');
    expect(bone).toBeDefined();
    const payload = bone?.primaryQuestion.payload as { itemIds: string[]; keyOrder: string[] };
    expect(payload.keyOrder).toHaveLength(BONE_STEPS.length);
    expect([...payload.keyOrder].sort()).toEqual([...payload.itemIds].sort());
    const entry = content.questions[bone!.primaryQuestion.questionId];
    expect(entry?.prompt).toBe(BONE_PROMPT);
    expect(entry?.excerpts.length ?? 0).toBeGreaterThanOrEqual(1);

    expect(validateManifestForPublish(manifest).ok).toBe(true);
  });
});
