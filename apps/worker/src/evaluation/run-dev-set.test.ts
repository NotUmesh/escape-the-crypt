import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  CHECK_VERSION,
  countingProvider,
  makeCassetteProvider,
  makeMockLedger,
  parseCassetteFile,
  type CassetteFile,
  type Provider,
} from '@escape-the-crypt/core';
import { HEART_NOTES, HEART_PROVIDER_NAME, HEART_SETTINGS } from '../http/http-test-support';
import { makeRecordingCassette } from './recording-cassette-provider';
import { runDevSet, type DevSetDeps } from './run-dev-set';

const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url));
const heartCassette = (): CassetteFile => {
  const raw = readFileSync(`${repoRoot}packages/core/src/test-support/cassettes/human-heart-e2e.json`, 'utf8');
  const parsed = parseCassetteFile(JSON.parse(raw));
  if (!parsed.ok) throw new Error('cassette does not parse');
  return parsed.value;
};
// Stands in for the live provider: answers by digest from the synthetic human-heart cassette.
const fakeLive = () => countingProvider(makeCassetteProvider(heartCassette()));
const failingLive: Provider = {
  complete: () => Promise.resolve({ ok: false, error: { kind: 'provider-error', retryable: false } }),
};
const NOTE = { name: 'dev-00-heart.txt', text: HEART_NOTES };
// Usage-priced like production (costOf is not part of any Prompt_Digest): a replay costs nothing.
const SETTINGS = { ...HEART_SETTINGS, costOf: (u: { inputTokens: number; outputTokens: number }) => (u.inputTokens + u.outputTokens) * 1e-6 };

function deps(store: Map<string, CassetteFile>, live: Provider | null, over: Partial<DevSetDeps> = {}): DevSetDeps {
  return {
    notes: [NOTE],
    loadCassette: (n) => store.get(n) ?? null,
    saveCassette: (n, f) => void store.set(n, f),
    live,
    ledger: makeMockLedger({ dailyCapUsd: 1 }),
    settings: SETTINGS,
    providerName: HEART_PROVIDER_NAME,
    checkVersion: CHECK_VERSION,
    now: () => 0,
    log: () => undefined,
    ...over,
  };
}

describe('makeRecordingCassette', () => {
  const request = (content: string) =>
    ({
      stage: 'review',
      promptVersion: 'v1',
      modelId: 'm',
      system: 's',
      messages: [{ role: 'user', content }],
      temperature: 0,
      maxOutputTokens: 10,
      jsonSchema: {},
      timeoutMs: 1000,
      retryLimit: 0,
    }) as const;
  const liveOk = countingProvider({
    complete: () => Promise.resolve({ ok: true, json: { answer: 'a' }, usage: { inputTokens: 7, outputTokens: 3 } }),
  });

  it('records a live reply once and replays a repeat of it in the same run with zero usage', async () => {
    const rec = makeRecordingCassette(null, liveOk);
    const first = await rec.provider.complete(request('q1'));
    const again = await rec.provider.complete(request('q1'));
    expect(first).toEqual({ ok: true, json: { answer: 'a' }, usage: { inputTokens: 7, outputTokens: 3 } });
    expect(again).toEqual({ ok: true, json: { answer: 'a' }, usage: { inputTokens: 0, outputTokens: 0 } });
    expect([rec.liveCalls(), rec.replayedCalls(), rec.recorded().length]).toEqual([1, 1, 1]);
    // The cassette keeps the usage that was billed.
    expect(rec.entries()[0]?.response).toEqual(first);
  });

  it('replay only: a hit replays, a miss is cassette-missing and calls nothing', async () => {
    const rec = makeRecordingCassette(null, liveOk);
    await rec.provider.complete(request('q1'));
    const replay = makeRecordingCassette({ checkVersion: CHECK_VERSION, entries: rec.recorded() }, null);
    expect((await replay.provider.complete(request('q1'))).ok).toBe(true);
    const miss = await replay.provider.complete(request('q2'));
    expect(miss.ok ? null : (miss.error.kind as string)).toBe('cassette-missing');
    expect([replay.liveCalls(), replay.replayedCalls()]).toEqual([0, 1]);
  });

  it('never records a failed live call', async () => {
    const rec = makeRecordingCassette(null, failingLive);
    expect((await rec.provider.complete(request('q1'))).ok).toBe(false);
    expect(rec.recorded()).toEqual([]);
    expect(rec.entries()).toEqual([]);
  });
});

describe('runDevSet', () => {
  it('records every call on the first run and replays all of them, at no cost, on the second', async () => {
    const store = new Map<string, CassetteFile>();
    const live = fakeLive();
    const first = await runDevSet(deps(store, live));
    expect(first.stopped).toBe('completed');
    expect(first.notes[0]?.ok).toBe(true);
    expect(first.notes[0]?.liveCalls).toBe(9);
    const saved = store.get(NOTE.name);
    expect(saved?.entries).toHaveLength(9);
    expect(saved?.entries.every((e) => e.origin === 'recorded')).toBe(true);
    expect(saved?.checkVersion).toBe(CHECK_VERSION);

    const second = await runDevSet(deps(store, failingLive));
    expect(second.notes[0]?.liveCalls).toBe(0);
    expect(second.notes[0]?.replayedCalls).toBe(9);
    expect(second.notes[0]?.costUsd).toBe(0);
    expect(second.notes[0]?.room).toEqual(first.notes[0]?.room);
    expect(second.notes[0]?.candidates).toEqual(first.notes[0]?.candidates);
  });

  it('stops after the note whose reservation was refused and keeps what it recorded', async () => {
    const store = new Map<string, CassetteFile>();
    // Each call reserves 0.01 and costs 0.005: the fourth reservation (0.015 + 0.01) passes the 0.022 cap.
    const ledger = makeMockLedger({ dailyCapUsd: 0.022 });
    const settings = { ...HEART_SETTINGS, costOf: () => 0.005 };
    const run = await runDevSet(deps(store, fakeLive(), { ledger, settings, notes: [NOTE, { ...NOTE, name: 'dev-99.txt' }] }));
    expect(run.stopped).toBe('budget-refused');
    expect(run.notes.map((n) => [n.note, n.errorKind])).toEqual([[NOTE.name, 'budget-exhausted']]);
    expect(store.get(NOTE.name)?.entries).toHaveLength(3);
  });

  it('replay only: a missing cassette fails the note and writes nothing', async () => {
    const store = new Map<string, CassetteFile>();
    const run = await runDevSet(deps(store, null));
    expect(run.notes[0]?.ok).toBe(false);
    expect(run.notes[0]?.liveCalls).toBe(0);
    expect(store.size).toBe(0);
  });

  it('the note record holds IDs, kinds and numbers, never notes or question text', async () => {
    const run = await runDevSet(deps(new Map(), fakeLive()));
    const json = JSON.stringify(run.notes);
    expect(json).not.toContain(HEART_NOTES.slice(0, 60));
    expect(json).not.toContain('According to your notes');
  });
});
