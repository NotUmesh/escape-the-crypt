import { describe, expect, it } from 'vitest';
import { makeCassetteProvider } from '../cassette/cassette-provider';
import { parseCassetteFile } from '../cassette/types';
import { cryptTargetFor, type CryptTarget } from '../run-length';
import {
  HUMAN_HEART_E2E_CASSETTE_PATH,
  HUMAN_HEART_E2E_OPTIONS,
  humanHeartE2eLedger,
} from './e2e-cassette-fixtures';
import { HEART } from './generation-fixtures';
import { runRoomPipeline } from './orchestrator';

const [fsName]: string[] = ['node:fs'];
const fs = (await import(fsName!)) as unknown as { readFileSync(p: string, enc: string): string };

async function run(target?: CryptTarget) {
  const parsed = parseCassetteFile(JSON.parse(fs.readFileSync(HUMAN_HEART_E2E_CASSETTE_PATH, 'utf8')));
  if (!parsed.ok) throw new Error('cassette does not parse');
  const result = await runRoomPipeline(HEART, {
    ...HUMAN_HEART_E2E_OPTIONS,
    provider: makeCassetteProvider(parsed.value),
    ledger: humanHeartE2eLedger(),
    ...(target === undefined ? {} : { target }),
  });
  if (!result.ok) throw new Error(`pipeline failed: ${result.error.error.kind}`);
  return result.value;
}

// The human-heart cassette holds three concepts: two make a room, the third has no partner.
describe('runRoomPipeline with a crypt target', () => {
  it('without a target keeps the one-room crypt and the legacy manifest ID', async () => {
    const { manifest } = await run();
    expect(manifest.rooms.map((r) => r.roomId)).toEqual(['room-1']);
    expect(manifest.rooms[0]?.lockSlots.map((s) => s.slotId)).toEqual(['slot-rune-cipher', 'slot-seance-board']);
    expect(manifest.manifestId).toMatch(/^crypt-[0-9a-f]{16}$/);
  });

  it('with a target returns the rooms the notes fill, without padding, under a content manifest ID', async () => {
    const { manifest, unplacedAccepted, metadata } = await run(cryptTargetFor('standard'));
    // Three concepts cannot fill three rooms: one room, the third concept left over.
    expect(manifest.rooms).toHaveLength(1);
    expect(unplacedAccepted.map((u) => u.conceptId)).toEqual(['concept-3']);
    expect(manifest.manifestId).toMatch(/^crypt-[0-9a-f]{16}-[0-9a-f]{8}$/);
    expect(metadata.counts.conceptsNotSelected).toBe(0);
  });

  it('changes no prompt, so every recorded digest still matches: a target only removes calls', async () => {
    const all = await run();
    const capped = await run({ rooms: 2, locksPerRoom: 2, maxConcepts: 2 });
    expect(capped.metadata.counts.conceptsNotSelected).toBe(1);
    expect(capped.metadata.counts.concepts).toBe(2);
    const sent = new Set(all.metadata.promptDigests);
    expect(capped.metadata.promptDigests.every((d) => sent.has(d))).toBe(true);
    expect(capped.metadata.promptDigests.length).toBeLessThan(all.metadata.promptDigests.length);
  });

  it('is deterministic', async () => {
    const target = cryptTargetFor('short');
    expect((await run(target)).manifest).toEqual((await run(target)).manifest);
  });
});
