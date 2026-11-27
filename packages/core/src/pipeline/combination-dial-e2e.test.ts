import { describe, expect, it } from 'vitest';
import { countingProvider } from '../budget/mock-ledger';
import { isCassetteMissing, makeCassetteProvider } from '../cassette/cassette-provider';
import { parseCassetteFile } from '../cassette/types';
import { CHECK_VERSION } from '../checks/registry';
import { promptDigest } from '../provider/prompt-digest';
import type { Provider } from '../provider/types';
import { CombinationDialPayloadSchema } from '../runtime/manifest-schema';
import { validateManifestForPublish } from '../runtime/publish-manifest';
import {
  COMBINATION_DIAL_E2E_CASSETTE_PATH,
  COMBINATION_DIAL_E2E_OPTIONS,
  DIAL_NOTES,
  EXACT_PROMPT,
  TEMPLATE_PROMPT,
  captureDialE2e,
  dialE2eLedger,
} from './combination-dial-e2e-fixtures';
import { runRoomPipeline } from './orchestrator';

const [fsName]: string[] = ['node:fs'];
const fs = (await import(fsName!)) as unknown as { readFileSync(p: string, enc: string): string };
const env = (globalThis as unknown as { process?: { env: Record<string, string | undefined> } }).process
  ?.env;

function loadCassette() {
  const parsed = parseCassetteFile(JSON.parse(fs.readFileSync(COMBINATION_DIAL_E2E_CASSETTE_PATH, 'utf8')));
  if (!parsed.ok) throw new Error('combination-dial-e2e.json does not parse as a cassette');
  return parsed.value;
}

describe('combination-dial cassette-driven pipeline', () => {
  it('prints the cassette JSON when REGENERATE is set (never writes a file)', async () => {
    if (env?.REGENERATE === undefined) return;
    const { entries } = await captureDialE2e();
    const out = (globalThis as unknown as { console: { log(s: string): void } }).console;
    out.log(`<<<CASSETTE\n${JSON.stringify({ checkVersion: CHECK_VERSION, entries }, null, 2)}\nCASSETTE>>>`);
  });

  it('is a synthetic cassette at the current check version, with digests of pipeline-built requests', async () => {
    const file = loadCassette();
    expect(file.checkVersion).toBe(CHECK_VERSION);
    expect(file.entries.every((e) => e.origin === 'synthetic')).toBe(true);
    const { entries, stages, requests } = await captureDialE2e();
    // 1 extraction, 3 generation (one per concept), 3 review (one per question past Code_Checks).
    expect(stages).toEqual([
      'concept-extraction',
      'generation',
      'generation',
      'generation',
      'review',
      'review',
      'review',
    ]);
    const built = requests.map((r) => promptDigest(r));
    expect(file.entries.map((e) => e.digest)).toEqual(built);
    expect(new Set(built).size).toBe(built.length);
    expect(file.entries.map((e) => e.response)).toEqual(entries.map((e) => e.response));
  });

  it('accepts an exact and a template dial; one is placed, the other goes to unplacedAccepted', async () => {
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
    const ledger = dialE2eLedger();
    const result = await runRoomPipeline(DIAL_NOTES, {
      ...COMBINATION_DIAL_E2E_OPTIONS,
      provider: counted,
      ledger,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const { manifest, content, unplacedAccepted, metadata } = result.value;

    expect(missing).toBe(0);
    expect(counted.calls).toBe(cassette.entries.length);
    expect(metadata.counts.candidates).toBe(3);
    expect(metadata.counts.codeCheckRejections).toEqual({});
    expect(metadata.counts.reviewRejections).toBe(0);
    expect(metadata.counts.accepted).toBe(3);
    expect(metadata.counts.mapperRejected).toBe(0);
    expect(metadata.checkVersion).toBe(CHECK_VERSION);
    expect(ledger.reservations).toBe(7);
    expect(ledger.outstandingMicroUsd).toBe(0);

    // Exact case: the first dial concept keeps the room's one dial slot.
    const slots = manifest.rooms.flatMap((r) => r.lockSlots);
    expect(slots.filter((s) => s.primaryQuestion.lockType === 'combination-dial')).toHaveLength(1);
    const dial = slots.find((s) => s.primaryQuestion.lockType === 'combination-dial');
    const exact = CombinationDialPayloadSchema.safeParse(dial?.primaryQuestion.payload);
    expect(exact.success && exact.data).toEqual({ kind: 'exact', exactValue: 4, unit: 'chambers' });
    const entry = content.questions[dial!.primaryQuestion.questionId];
    expect(entry?.prompt).toBe(EXACT_PROMPT);
    expect(entry?.excerpts.length ?? 0).toBeGreaterThanOrEqual(1);
    expect(validateManifestForPublish(manifest).ok).toBe(true);

    // Template case: accepted, and exactly this one is left over. Its value is computed by code.
    expect(unplacedAccepted).toHaveLength(1);
    const left = unplacedAccepted[0]!;
    expect(left.question.lockType).toBe('combination-dial');
    expect(left.content.prompt).toBe(TEMPLATE_PROMPT);
    const template = CombinationDialPayloadSchema.safeParse(left.question.payload);
    expect(template.success && template.data).toEqual({
      kind: 'exact',
      exactValue: 40,
      unit: 'beats per minute',
    });
    expect(JSON.stringify(manifest)).not.toContain(left.question.questionId);
  });
});
