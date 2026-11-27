import { describe, expect, it } from 'vitest';
import { countingProvider } from '../budget/mock-ledger';
import { isCassetteMissing, makeCassetteProvider } from '../cassette/cassette-provider';
import { parseCassetteFile } from '../cassette/types';
import { CHECK_VERSION } from '../checks/registry';
import { promptDigest } from '../provider/prompt-digest';
import type { Provider } from '../provider/types';
import { validateManifestForPublish } from '../runtime/publish-manifest';
import {
  BOUND_THREADS_E2E_CASSETTE_PATH,
  BOUND_THREADS_E2E_OPTIONS,
  THREADS_NOTES,
  THREADS_PAIRS,
  THREADS_PROMPT,
  captureBoundThreadsE2e,
  threadsE2eLedger,
} from './bound-threads-e2e-fixtures';
import { runRoomPipeline } from './orchestrator';

const [fsName]: string[] = ['node:fs'];
const fs = (await import(fsName!)) as unknown as { readFileSync(p: string, enc: string): string };
const env = (globalThis as unknown as { process?: { env: Record<string, string | undefined> } }).process
  ?.env;

function loadCassette() {
  const parsed = parseCassetteFile(JSON.parse(fs.readFileSync(BOUND_THREADS_E2E_CASSETTE_PATH, 'utf8')));
  if (!parsed.ok) throw new Error('bound-threads-e2e.json does not parse as a cassette');
  return parsed.value;
}

describe('bound-threads cassette-driven pipeline', () => {
  it('prints the cassette JSON when REGENERATE is set (never writes a file)', async () => {
    if (env?.REGENERATE === undefined) return;
    const { entries } = await captureBoundThreadsE2e();
    const out = (globalThis as unknown as { console: { log(s: string): void } }).console;
    out.log(`<<<CASSETTE\n${JSON.stringify({ checkVersion: CHECK_VERSION, entries }, null, 2)}\nCASSETTE>>>`);
  });

  it('is a synthetic cassette at the current check version, with digests of pipeline-built requests', async () => {
    const file = loadCassette();
    expect(file.checkVersion).toBe(CHECK_VERSION);
    expect(file.entries.every((e) => e.origin === 'synthetic')).toBe(true);
    const { entries, stages, requests } = await captureBoundThreadsE2e();
    // 1 extraction, 2 generation (one per concept), 2 review (one per question past Code_Checks).
    expect(stages).toEqual(['concept-extraction', 'generation', 'generation', 'review', 'review']);
    const built = requests.map((r) => promptDigest(r));
    expect(file.entries.map((e) => e.digest)).toEqual(built);
    expect(new Set(built).size).toBe(built.length);
    expect(file.entries.map((e) => e.response)).toEqual(entries.map((e) => e.response));
  });

  it('generates a bound-threads primary that passes checks and review, maps, and publishes', async () => {
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
    const ledger = threadsE2eLedger();
    const result = await runRoomPipeline(THREADS_NOTES, {
      ...BOUND_THREADS_E2E_OPTIONS,
      provider: counted,
      ledger,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const { manifest, content, metadata } = result.value;

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

    const slots = manifest.rooms.flatMap((r) => r.lockSlots);
    const threads = slots.find((s) => s.primaryQuestion.lockType === 'bound-threads');
    expect(threads).toBeDefined();
    const payload = threads?.primaryQuestion.payload as {
      leftIds: string[];
      rightIds: string[];
      keyPairs: [string, string][];
    };
    expect(payload.keyPairs).toHaveLength(THREADS_PAIRS.length);
    expect(new Set(payload.keyPairs.map((p) => p[0]))).toEqual(new Set(payload.leftIds));
    expect(new Set(payload.keyPairs.map((p) => p[1]))).toEqual(new Set(payload.rightIds));
    expect(new Set(payload.leftIds).size).toBe(payload.leftIds.length);
    expect(new Set(payload.rightIds).size).toBe(payload.rightIds.length);
    const entry = content.questions[threads!.primaryQuestion.questionId];
    expect(entry?.prompt).toBe(THREADS_PROMPT);
    expect(entry?.excerpts.length ?? 0).toBeGreaterThanOrEqual(1);

    expect(validateManifestForPublish(manifest).ok).toBe(true);
  });
});
